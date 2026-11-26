import { boxAt } from './collision/boxes.ts';
import { enemyFrom, reshield, type EnemyState } from './combat/actors.ts';
import { newBossState, type BossDef, type BossTable, type ToastState } from './combat/bosses/boss.ts';
import { sleepShare, snackExposed } from './combat/bosses/snack.ts';
import { breathing } from './combat/bosses/toast.ts';
import type { EnemyTable } from './combat/enemies.ts';
import { BASE_HALVES, BIND, CLING, FOLDER, heartCap, STAMP, STAPLER } from './combat/frames.ts';
import { circleCentre, isMarked } from './combat/highlighter.ts';
import { guardCovers, parryOpen, swingBox } from './combat/folder.ts';
import { type Perks } from './combat/perks.ts';
import { PIE_READY, sleepOfSpirit, type PieState } from './combat/pie.ts';
import { UNLOAD_READY, unloadAge, unloadBox, type UnloadState } from './combat/unload.ts';
import { type Shot, type Zone } from './combat/hazards.ts';
import type { Vec } from './combat/movement.ts';
import { bufferInput, gaugeFull, newOperator, OPERATOR_BODY, OPERATOR_HURT, type HeldTool, type OperatorState, type TickInput } from './combat/operator.ts';
import { advance, startClock, type RuleClock } from './clock.ts';
import { startExam, stepExam, type ExamDef, type ExamKind, type ExamState, type ExamTally, type ExamTick } from './exam/fight.ts';
import { seedStreams, type RngStreams } from './rng.ts';
import { boxPixel, canEnter, conveyorRunning, conveyorsOf, filledPorts, flowName, mixerOf, mixerOutlet, liveGate, nearest, onPort, portOf, portOpenAt, portTicksLeft, PUSH, settleBoxes, withBoxes, type BoxState, type Occupants, type Tile } from './rooms/boxes.ts';
import { boxTypeOf, EMPTY_MIXER, PORTION_SECONDS, portionOf, type MixerEvent, type MixerState, type Portion } from './stomach/mixer.ts';
import { CHUNK, chunksOf, chunksUnder, withoutChunks } from './stomach/chunks.ts';
import type { EnteredRoom } from './rooms/entry.ts';
import { cooldownTicks, coolingLeft, type Cooling } from './rooms/cooling.ts';
import { asleep, type SleepEvent, type SleepState } from './rooms/sleep.ts';
import { platesUnder, reachableObject, touchedObjects } from './rooms/interact.ts';
import { doorOpen } from './rooms/locks.ts';
import { ALCOHOL_CRATE, crateTiles, isFactory, isSpawnedCrate, linesOf, onIntake, outletTile } from './liver/factory.ts';
import { playerStart, type RoomObject } from './rooms/tiled.ts';
import { enemiesById, waveKey, type Tick } from './tick/tick.ts';
import { stepEnemies } from './tick/enemies.ts';
import { stepWeapons } from './tick/weapons.ts';
import { stepHits } from './tick/hits.ts';
import { stepAftermath } from './tick/aftermath.ts';
import { damage, handOf, stackHome, withStacks } from './tick/rules.ts';
import { beginTick } from './tick/begin.ts';
import { TICK_HZ } from './time.ts';
import { ascending, hiddenDoor, occupantsOf, openDoors, platesUnderBoxes, switchMode } from './tick/room.ts';

export { NO_INPUT, OPERATOR_BODY, OPERATOR_HURT, type HeldTool, type OperatorAction, type OperatorState, type TickInput } from './combat/operator.ts';
export { guardCovers, parryOpen, swingBox } from './combat/folder.ts';
export { circleCentre, isMarked, lineOf } from './combat/highlighter.ts';
export type { EnemyPhase, EnemyState } from './combat/actors.ts';
export type { Shot, Zone } from './combat/hazards.ts';
export { handOf, inMist, unrevealed } from './tick/rules.ts';

export interface PushState {
  readonly box: number;
  /** The direction pressed, one tile along one axis. */
  readonly dir: Tile;
  readonly ticks: number;
}

export interface Projectile {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly ticksLeft: number;
  /** A staple does STAPLER.damage; a shot the folder sent back does more (FOLDER.reflectDamage). */
  readonly damage?: number;
  /** Sent back by a parry: it charges no gauge (the parry already did) and throws no lever. */
  readonly reflected?: true;
  /** Half the side of the box a parried delivery was, so it is drawn as that box. Its hitbox stays a staple's: it flies straight at the boss. */
  readonly boxHalf?: number;
}

export interface GameState {
  readonly tick: number;
  readonly rng: RngStreams;
  /** Outer-layer clock; combat moves it only through rules such as the forced nap. */
  readonly clock: RuleClock;
  /** Chairman's spirit P, fixed at room entry from the tags (design doc 5.4). */
  readonly p: number;
  readonly room: EnteredRoom;
  readonly operator: OperatorState;
  readonly enemies: readonly EnemyState[];
  /** The operator's staples. */
  readonly projectiles: readonly Projectile[];
  /** Thrown enemy attacks: flyer sheets, coffee cups. */
  readonly shots: readonly Shot[];
  /** Tier-2 and tier-3 areas, from their telegraph to their last live tick. */
  readonly zones: readonly Zone[];
  /** Definitions of the bosses in this room, by boss id; kept in state so a replay needs nothing else. */
  readonly bosses: Readonly<Record<string, BossDef>>;
  readonly nextId: number;
  /** Whole-fight hit-stop: while above 0 only input buffering and the tick counter advance. */
  readonly freeze: number;
  /**
   * Ticks the room itself has run this visit: `tick` less the hit-stops. A timed gate keeps time by
   * it, so it stops with the slides, and a slide cleared to land while the gate is open still does.
   */
  readonly roomTicks: number;
  /** Doors and triggers the operator stood on last tick, so each fires once when stepped onto. */
  readonly touching: readonly number[];
  /** Switches that are on, in id order: toggle switches flipped on, and hold switches being stood on. */
  readonly switches: readonly number[];
  /**
   * Doors whose clock or resource lock is open, as the chapter judged them at the start of this
   * tick from the clock and the tags, which the room does not know.
   */
  readonly unlocked: readonly number[];
  /** Doors the last door check found open, so a door that opens while the operator is pressed against it lets them through. */
  readonly doorsOpen: readonly number[];
  /** Pickups gone from the room, in id order: taken on this visit or, as the chapter remembers, an earlier one. */
  readonly taken: readonly number[];
  /** Clinging stacks brought in from another room; they belong to no enemy here and only sleep clears them. */
  readonly carried: number;
  /** Push boxes in id order, at the tile each one rests on or is sliding to. */
  readonly boxes: readonly BoxState[];
  /** The box the operator is pressing against and for how many ticks, up to PUSH.delayTicks; null when none. */
  readonly push: PushState | null;
  /** Boxes a Port has taken, in id order: gone from the room for good, and what the port counts. */
  readonly delivered: readonly number[];
  /** Food boxes a cold store has taken, in id order: gone from the room for good, counted by no port. */
  readonly chilled: readonly number[];
  /** Food chunks the logistics chief's acid has dissolved, in id order: gone from this room's grid for good (core/stomach/chunks.ts). */
  readonly dissolved: readonly number[];
  /** Toggle switches still cooling down after a throw, in id order (core/rooms/cooling.ts); absent when none is. */
  readonly cooling?: readonly Cooling[];
  /** Orders the courier has thrown on this visit, so each gets an id of its own (core/stomach/orders.ts); absent before the first. */
  readonly orderSerial?: number;
  /** Set until the chairman hands over the stamp (design doc 5.4): the stamp key does nothing. */
  readonly stampLocked?: true;
  /** Set until the general affairs office hands over the folder (design doc 7.4): the swap key does nothing. */
  readonly folderLocked?: true;
  /**
   * Set once the liver chapter's general affairs office hands over the highlighter (design doc 7.7): the
   * swap key cycles to it. Unlike the folder it is absent by default, since only the liver chapter has it.
   */
  readonly highlighter?: true;
  /**
   * Ticks left in which the interact key does nothing. A closing conversation sets it: Enter both
   * advances a line and talks, so a quick press after the last line would reopen it (#81). A press
   * inside the rest starts it over, so it ends only after TALK_REST_TICKS without one.
   */
  readonly interactRest?: number;
  /**
   * How far clinging enemies can see the operator, when the caffeine cloak cuts it below
   * CLING.senseRangePx (design doc 7.4); 0 means they cannot see the operator at all. The chapter
   * sets it every tick from the caffeine tag, since the room knows no tags.
   */
  readonly senseCapPx?: number;
  /** Multiplier on how many enemies a boss summons and keeps alive; the chapter sets it every tick from the climax choice. */
  readonly summonScale?: number;
  /** Multiplier on how often the stomach boss throws in his stage 2; the chapter sets it every tick from the climax choice. */
  readonly paceScale?: number;
  /** The chairman's pie shield (core/combat/pie.ts); present only in a chapter whose partner has it. A new room starts it ready. */
  readonly pie?: PieState;
  /** The stomach logistics chief's acid (core/combat/unload.ts); present only in a chapter whose partner has it. A new room starts it ready. */
  readonly unload?: UnloadState;
  /** Only in a liver factory room (core/liver/factory.ts). */
  readonly factory?: FactoryState;
  /** Only in a room with the stomach's mixer (core/stomach/mixer.ts): what it is digesting. */
  readonly mixer?: MixerState;
  /** The sleep bar of a bed that takes time to sleep in (core/rooms/sleep.ts), from the first lying down on it in this visit. */
  readonly sleep?: SleepState;
  /** The exam being sat in this room, from the forecast's close on (core/exam/fight.ts). */
  readonly exam?: ExamState;
  /** Its definition, kept in state like the bosses' so a replay needs nothing else. */
  readonly examDef?: ExamDef;
  /** What the welfare cards held change in this fight (core/combat/perks.ts); the base rules when absent. */
  readonly perks?: Perks;
  /** The run of staple hits on one enemy so far, which `BIND.hits` of them turn into a pin. */
  readonly bind?: BindRun;
  /** The tick the speed-up of a parry ends (退件加速); only set with the card. */
  readonly boostUntil?: number;
}

export interface BindRun {
  readonly target: number;
  readonly hits: number;
  /** Tick of the latest hit; the run is dropped once `BIND.windowTicks` pass without another. */
  readonly at: number;
}

export interface FactoryState {
  /** Alcohol crates in receiving, as the chapter counts them from the `alcohol` tag every tick. */
  readonly waiting: number;
  /** Acetaldehyde crates put out so far on this visit; crate n has box id -n. */
  readonly serial: number;
  /** What a staple on an alcohol crate says, from the crate's enemy entry (design doc 5.5). */
  readonly solution: string;
  /** Ticks the operator has stood in acetaldehyde fog without a break. */
  readonly mist: number;
}

/**
 * Something that happened this tick, with logical ids and reasons only; the view maps each
 * type to feedback through content/feedback.json.
 */
export type DomainEvent =
  | { readonly type: 'bumpWall'; readonly axis: 'x' | 'y' }
  | { readonly type: 'fire'; readonly weapon: 'stapler' }
  /** A swing of the folder began; `combo` is its place in the string, 0 to 2. */
  | { readonly type: 'swing'; readonly combo: number }
  | { readonly type: 'toolSwapped'; readonly tool: HeldTool }
  | { readonly type: 'guardRaised' }
  /** The highlighter drew a line (design doc 6.1); what it crossed comes as hits. */
  | { readonly type: 'lineDrawn' }
  /** The highlighter's circle closed at (x, y); the enemies it marked follow as `marked`. */
  | { readonly type: 'circleDrawn'; readonly x: number; readonly y: number; readonly radius: number }
  /** A defeatable enemy took the highlighter's mark: the stapler's and the folder's hits on it count double for a while. */
  | { readonly type: 'marked'; readonly target: number; readonly enemy: string }
  /** The guard stopped an attack without the parry: shots vanish, a strike is spent. */
  | { readonly type: 'blocked'; readonly source: number; readonly kind: 'shot' | 'strike' }
  /** 退件: the parry window caught an attack. A shot flies back; a strike stuns its thrower. */
  | { readonly type: 'parry'; readonly source: number; readonly kind: 'shot' | 'strike' }
  /** A toast wave landed (design doc 7.7): no heart is lost, and the chapter adds the cups to receiving. */
  | { readonly type: 'toasted'; readonly source: number; readonly cups: number }
  /** The chairman raised the pie shield (design doc 7.4); `sleepy` when S is below 1, so he fumbles his line. */
  | { readonly type: 'pieRaised'; readonly radiusPx: number; readonly seconds: number; readonly sleepy: boolean }
  /** The shield stopped a thrown shot. */
  | { readonly type: 'pieBlocked'; readonly source: number }
  /** The logistics chief's acid was spat (design doc 6.2) from the operator at this point, along one of the four axes. */
  | { readonly type: 'unloadRaised'; readonly x: number; readonly y: number; readonly dir: Vec }
  /** An energy-drink can landed (design doc 7.4): no heart is lost, and the chapter adds the caffeine. */
  | { readonly type: 'canTaken'; readonly source: number }
  /** The sugar salesman's tea landed (design doc 7.5): no heart is lost, and the fatigue fog starts over at its full 45 seconds. */
  | { readonly type: 'teaTaken'; readonly source: number }
  /** The courier threw an order onto the belt whose head is this tile (design doc 7.5). */
  | { readonly type: 'orderThrown'; readonly source: number; readonly object: number; readonly col: number; readonly row: number }
  /** The stamp sent an order back (design doc 7.5): the chapter counts one return, the design doc's outer social -1. */
  | { readonly type: 'orderReturned'; readonly object: number; readonly col: number; readonly row: number }
  /** 婉拒: the guard met a toast wave, on any of its frames; `parry` when it was inside the parry window. */
  | { readonly type: 'refused'; readonly source: number; readonly parry: boolean }
  /** A weapon landed on a cheers kid, who only backs off (design doc 7.7). */
  | { readonly type: 'backedOff'; readonly target: number; readonly enemy: string }
  /** A staple or a light swing met a manager's shield from the front and did nothing (design doc 5.3). */
  | { readonly type: 'shieldBlocked'; readonly target: number; readonly enemy: string }
  /** 破防: a sent-back shot or the folder's heavy hit got through a manager's shield. It landed, and he is stunned with the shield down. */
  | { readonly type: 'shieldBroken'; readonly target: number; readonly enemy: string; readonly by: 'reflect' | 'folder' }
  | { readonly type: 'dodge' }
  /** `assisted` is set when only the automatic-perfect assist made the dodge perfect; it is absent otherwise, so a plain run is unchanged. */
  | { readonly type: 'perfectDodge'; readonly source: number; readonly assisted?: true }
  /** `ticks` is set only when the warning does not last its tier's usual time, so its caption can stay as long. */
  | { readonly type: 'telegraph'; readonly source: number; readonly tier: 1 | 2 | 3; readonly move?: string; readonly ticks?: number }
  | { readonly type: 'hit'; readonly target: number; readonly enemy: string; readonly hpLeft: number }
  | { readonly type: 'caseClosed'; readonly target: number; readonly enemy: string }
  /** 裝訂: enough staple hits in a row pinned the enemy for `Perks.pinTicks` (BIND.pinTicks without 加固包裝). */
  | { readonly type: 'bound'; readonly target: number; readonly enemy: string }
  | { readonly type: 'dispersed'; readonly target: number; readonly enemy: string }
  | { readonly type: 'reformed'; readonly target: number; readonly enemy: string }
  | { readonly type: 'respawned'; readonly target: number; readonly enemy: string }
  | { readonly type: 'immuneBounce'; readonly target: number; readonly enemy: string; readonly solution: string }
  /**
   * A hit landed. `halves` is what it cost: 0 for a hit the halved-damage assist made free, and under
   * hearts-that-never-run-out the sum can exceed the hearts really lost.
   */
  | { readonly type: 'heartLost'; readonly halves: number; readonly cause: string }
  | { readonly type: 'freeze'; readonly frames: number }
  | { readonly type: 'forcedLeave' }
  | { readonly type: 'gaugeFull' }
  | { readonly type: 'stampRaised' }
  | { readonly type: 'stampLanded'; readonly x: number; readonly y: number; readonly radius: number }
  | { readonly type: 'stampVoid'; readonly target: number; readonly enemy: string; readonly solution: string }
  | { readonly type: 'clung'; readonly target: number; readonly enemy: string; readonly stacks: number }
  | { readonly type: 'forcedNap'; readonly minutes: number }
  | { readonly type: 'bossStage'; readonly target: number; readonly stage: 2 | 3 }
  | { readonly type: 'bossDrink'; readonly target: number; readonly residue: number; readonly cups: number }
  | { readonly type: 'bossSummon'; readonly target: number; readonly count: number }
  | { readonly type: 'powerCut'; readonly target: number; readonly seconds: number }
  | { readonly type: 'proposalRejected'; readonly target: number }
  /** The snack boss threw a box from dock number `dock` (design doc 7.5); the telegraph came before it. */
  | { readonly type: 'deliveryThrown'; readonly source: number; readonly dock: number }
  /** A delivery landed on a full mixer (design doc 7.5, 胃抗議): it emptied and raised an area round the hopper at (`x`, `y`). */
  | { readonly type: 'mixerProtest'; readonly mixer: number; readonly x: number; readonly y: number }
  | { readonly type: 'bossDefeated'; readonly target: number; readonly enemy: string }
  /** The toast boss finished a round and breathes: his weak point (design doc 7.7). */
  | { readonly type: 'bossBreath'; readonly target: number; readonly seconds: number }
  /** The toast boss starts the next round of the song, at a quicker beat (乾杯三巡). */
  | { readonly type: 'bossRound'; readonly target: number; readonly round: 1 | 2 | 3 }
  /** The stomach boss moved to his next stage; he has a line of his own per stage, unlike the caffeine boss's bossStage. */
  | { readonly type: 'snackStage'; readonly target: number; readonly stage: 2 | 3 }
  /** A staple or a swing of the folder met the stomach boss, or a box sent back in his last stage: it does nothing to him. */
  | { readonly type: 'snackShrugged'; readonly target: number }
  /** In the stomach boss's last stage the mixer finished one of his boxes and held the sleep bar (design doc 7.5, 熄燈). */
  | { readonly type: 'snackWoken'; readonly target: number; readonly wakes: number }
  /** His sleep bar is full: from now on the stamp closes the case whenever the mixer is empty. */
  | { readonly type: 'snackRested'; readonly target: number }
  /** The stamp landed on him in his last stage while the bar was not full or the mixer was not empty: it is spent for nothing. */
  | { readonly type: 'snackStampRefused'; readonly target: number }
  /** The toast boss's budget ran out: he is not beaten but gives up toasting (design doc 7.7). */
  | { readonly type: 'bossConceded'; readonly target: number; readonly enemy: string }
  /** The operator stepped onto an unlocked door; the chapter decides where it leads. */
  | { readonly type: 'doorEntered'; readonly object: number; readonly door: string; readonly socket: string }
  | { readonly type: 'doorLocked'; readonly object: number; readonly lock: string }
  /** A switch went on or off; `by` says what moved it. Only toggle switches stay on after the operator leaves. */
  | { readonly type: 'switchChanged'; readonly object: number; readonly on: boolean; readonly mode: string; readonly by: 'interact' | 'staple' | 'step' | 'box' | 'highlighter' }
  /** The interact key was pressed at a switch that is still cooling down from its last throw; nothing changed. */
  | { readonly type: 'switchCooling'; readonly object: number; readonly seconds: number }
  /** A box started sliding to this tile, pushed by the operator or carried by a conveyor, or the mixer set it down there. */
  | { readonly type: 'boxMoved'; readonly object: number; readonly col: number; readonly row: number; readonly by: 'push' | 'conveyor' | 'mixer' }
  /** A box came to rest on a Port, which took it; `count` is how many the port holds now. */
  | { readonly type: 'boxDelivered'; readonly object: number; readonly port: number; readonly count: number; readonly need: number }
  /** A food box came to rest on a cold store, which chilled it until tomorrow (design doc 7.5). */
  | { readonly type: 'boxChilled'; readonly object: number; readonly store: number }
  /** The acid has lain on a food chunk long enough: its tiles are floor from the next tick, for good. */
  | { readonly type: 'chunkDissolved'; readonly object: number }
  /** A Port took its last needed box: it now counts as a switch that is on, for good. */
  | { readonly type: 'portFilled'; readonly object: number }
  /** A timed Port opened or shut (design doc 7.5); a filled one stays open and says nothing more. */
  | { readonly type: 'portOpened'; readonly object: number }
  | { readonly type: 'portClosed'; readonly object: number }
  /** The second line took in an acetaldehyde crate; the chapter takes it off the `acetaldehyde` tag. */
  | { readonly type: 'crateTaken'; readonly object: number; readonly line: number }
  | MixerEvent
  | SleepEvent
  | { readonly type: 'triggerEntered'; readonly object: number; readonly trigger: string; readonly eventId: string }
  /** The operator took an item; what it does beyond leaving the room (and opening a key lock) is the chapter's. */
  | { readonly type: 'pickedUp'; readonly object: number; readonly itemType: string; readonly itemId: string }
  | { readonly type: 'talk'; readonly object: number; readonly npc: string; readonly dialogueId: string }
  | { readonly type: 'bedUse'; readonly object: number; readonly bedType: string }
  /** The exam began, with this many adenosine in the room for the night's sleep debt. */
  | { readonly type: 'examStarted'; readonly exam: string; readonly adenosine: number }
  | { readonly type: 'examQuestion'; readonly segment: number; readonly kind: ExamKind; readonly question: string }
  /** A question ended with `share` of it answered: solved, out of time, or failed by three stacks. */
  | { readonly type: 'examAnswered'; readonly segment: number; readonly question: string; readonly share: number; readonly how: 'solved' | 'time' | 'stacks' }
  /** The pause before segment `segment` (from 0) begins. */
  | { readonly type: 'examBreak'; readonly segment: number; readonly kind: ExamKind }
  | { readonly type: 'examFinished'; readonly exam: string; readonly tallies: readonly ExamTally[] }
  /** A proof step was stamped; out of order (`ok` false) every stamp of the question is undone. `stamped` is how many stand now. */
  | { readonly type: 'proofStamped'; readonly order: number; readonly ok: boolean; readonly stamped: number }
  | { readonly type: 'bonusShown'; readonly target: number }
  /** A hit in the exam: no heart is lost (the exam never ends the story), but the performance counts it. */
  | { readonly type: 'examHit'; readonly source: number; readonly cause: string }
  /** Three stacks in the exam: the question being answered fails, in place of the forced nap (design doc 5.5). */
  | { readonly type: 'examStacked' };

export interface StepResult {
  readonly state: GameState;
  readonly events: readonly DomainEvent[];
}

export class GameSetupError extends Error {}

/** Spawn copies sit side by side so a count of 3 does not stack three sprites on one point. */
const COPY_SPACING = 20;

/** Where a Spawn's enemies stand at entry and come back to: their homes. */
export function spawnHomes(o: RoomObject): { x: number; y: number }[] {
  const count = Number(o.props['count']);
  return Array.from({ length: count }, (_, i) => ({ x: o.x + (i - (count - 1) / 2) * COPY_SPACING, y: o.y }));
}

/**
 * Enemies come from the Spawns enterRoom kept, so inactive variants and failed `when`s never
 * reach here. Ids come from the shared counter, taken in object id order, so no Spawn count
 * can make two enemies share an id.
 */
function spawnEnemies(room: EnteredRoom, table: EnemyTable, bosses: BossTable | undefined, firstId: number) {
  const out: EnemyState[] = [];
  const used: Record<string, BossDef> = {};
  let nextId = firstId;
  for (const o of [...room.objects].sort((a, b) => a.id - b.id)) {
    if (o.kind !== 'Spawn') continue;
    const type = String(o.props['enemyType']);
    const def = table.enemies.get(type);
    if (!def) throw new GameSetupError(`${room.id}: Spawn #${o.id} uses enemy "${type}", which content/enemies.json does not define`);
    const boss = def.boss === undefined ? undefined : bosses?.get(def.boss);
    if (def.boss !== undefined && !boss) throw new GameSetupError(`${room.id}: enemy "${type}" is a boss, but no definition for "${def.boss}" was given`);
    if (!boss && def.category === 'defeatable' && def.performance === undefined) {
      throw new GameSetupError(`${room.id}: enemy "${type}" has no performance in content/enemies.json, so it cannot be fought yet`);
    }
    for (const { x } of spawnHomes(o)) {
      const respawn = Math.round(Number(o.props['respawnSeconds']) * TICK_HZ);
      if (boss) {
        used[boss.id] = boss;
        out.push(enemyFrom(def, nextId++, x, o.y, 0, { hp: boss.budget, maxHp: boss.budget, boss: newBossState(boss) }));
      } else out.push(enemyFrom(def, nextId++, x, o.y, respawn));
    }
  }
  return { enemies: out, nextId, bosses: used };
}

export interface GameOptions {
  /** From sleepFactor and chairmanSpirit on the entry tags; 1 means fully rested. */
  readonly p?: number;
  readonly clock?: RuleClock;
  /** Starting gauge, e.g. 50 from the early-sleep bonus card (design doc 8.8). */
  readonly gauge?: number;
  /** Needed when the room spawns a boss. */
  readonly bosses?: BossTable;
  /** Where the operator stands instead of the PlayerStart: through a door, or back at a checkpoint. */
  readonly start?: Vec;
  /** Hearts in halves carried in from the previous room; defaults to full. */
  readonly halves?: number;
  /** Clinging stacks carried in, 0 up to one below the forced-nap cap; defaults to none. */
  readonly stacks?: number;
  /** A half-heart owed under the halved-damage assist (assists.ts), carried in like the hearts; defaults to none. */
  readonly halfCarry?: 0 | 1;
  /** Ticks left in the sugar fatigue fog, carried in through a door; defaults to none. */
  readonly fatigue?: number;
  /** Toggle switches already on, from an earlier visit; ids that are not toggle switches of this room are ignored. */
  readonly switches?: readonly number[];
  /** Doors open by their clock or resource lock at entry; the chapter refreshes this every tick. */
  readonly unlocked?: readonly number[];
  /** Pickups taken on an earlier visit; ids that are not pickups of this room are ignored. */
  readonly taken?: readonly number[];
  /** Where boxes were left on an earlier visit; settleBoxes decides which of them stay there. */
  readonly boxes?: ReadonlyMap<number, Tile>;
  /**
   * Boxes a Port took on an earlier visit, all counted. They must be box ids of the whole map: a
   * delivered box may be absent from this visit's room, and the port still holds it.
   */
  readonly delivered?: readonly number[];
  /** Food boxes a cold store took on an earlier visit, as box ids of the whole map like `delivered`. */
  readonly chilled?: readonly number[];
  /** Food chunks the acid dissolved on an earlier visit; ids that are not chunks of this room are ignored. */
  readonly dissolved?: readonly number[];
  /** The stamp is not handed over yet. */
  readonly stampLocked?: boolean;
  /** The folder is not handed over yet. */
  readonly folderLocked?: boolean;
  /** The highlighter is handed over. */
  readonly highlighter?: boolean;
  /** The tool in hand carried in from the last room; the stapler when absent. */
  readonly tool?: HeldTool;
  /** The chapter's partner has the pie shield, ready at entry. */
  readonly pie?: boolean;
  /** The chapter's partner has the unloading acid, ready at entry. */
  readonly unload?: boolean;
  /** In a factory room: alcohol crates waiting in receiving. */
  readonly waiting?: number;
  /** In a factory room: acetaldehyde crates to put out round the outlet at entry. */
  readonly acetaldehyde?: number;
  /** The welfare cards' effects; the base rules when absent. */
  readonly perks?: Perks;
}

/**
 * Puts out up to `n` acetaldehyde crates on the free floor nearest the outlet: not on a box, a
 * body, a tile boxes keep clear, the second line or the port (either would take it in at once).
 * A crate with no free tile left waits; syncFactory tries again on the next tick.
 */
function placeCrates(room: EnteredRoom, boxes: readonly BoxState[], bodies: Occupants['bodies'], n: number, serial: number): { boxes: BoxState[]; serial: number } {
  const from = outletTile(room);
  const all = [...boxes];
  if (!from || n <= 0) return { boxes: all, serial };
  const port = portOf(room);
  let next = serial;
  for (let i = 0; i < n; i++) {
    const t = nearest(room, from, (x) => canEnter(room, all, x, { bodies }) && !onIntake(room, x) && !(port && onPort(port, x)));
    if (!t) break;
    next++;
    all.push({ id: -next, col: t.col, row: t.row, left: 0, ticks: 0, boxType: 'acetaldehyde' });
  }
  return { boxes: all.sort((a, b) => a.id - b.id), serial: next };
}

/**
 * The factory brought in line with the chapter's tags, before a tick: the crates in receiving,
 * and as many acetaldehyde crates in the room as the body holds. The first line runs on the
 * chapter clock wherever the operator is, so a crate it finishes during the visit appears here.
 */
export function syncFactory(state: GameState, waiting: number, acetaldehyde: number): GameState {
  const f = state.factory;
  if (!f) return state;
  let next = f.waiting === waiting ? state : { ...state, factory: { ...f, waiting } };
  const spawned = next.boxes.filter(isSpawnedCrate);
  if (spawned.length < acetaldehyde) {
    const placed = placeCrates(next.room, next.boxes, occupantsOf(next.operator, next.enemies).bodies, acetaldehyde - spawned.length, next.factory!.serial);
    if (placed.serial !== next.factory!.serial) next = { ...next, boxes: placed.boxes, factory: { ...next.factory!, serial: placed.serial } };
  } else if (spawned.length > acetaldehyde) {
    // The newest crates go first: they are the ones the body has not caught up with.
    const drop = new Set(spawned.sort((a, b) => a.id - b.id).slice(0, spawned.length - acetaldehyde).map((b) => b.id));
    next = { ...next, boxes: next.boxes.filter((b) => !drop.has(b.id)), push: next.push && drop.has(next.push.box) ? null : next.push };
  }
  return next;
}


/** Levers and reveal switches stay on once on, so they outlive a visit; a plate and a port are judged afresh. */
const lasting = (room: EnteredRoom, id: number): boolean => {
  const mode = switchMode(room, id);
  return mode === 'toggle' || mode === 'reveal';
};






/**
 * The enemy table is required: rooms with Spawns cannot start without it. The room must have
 * gone through enterRoom, so a caller cannot forget the tags and silently get the base room.
 */
export function createGame(entered: EnteredRoom, seed: number, table: EnemyTable, options: GameOptions = {}): GameState {
  const dissolved = ascending((options.dissolved ?? []).filter((id) => chunksOf(entered).some((c) => c.object.id === id)));
  const room = withoutChunks(entered, dissolved);
  const p = options.p ?? 1;
  const gauge = options.gauge ?? 0;
  if (!(p > 0 && p <= 1)) throw new GameSetupError(`P must be in (0, 1], got ${p}`);
  if (!(gauge >= 0 && gauge <= STAMP.gaugeMax)) throw new GameSetupError(`gauge must be 0 to ${STAMP.gaugeMax}, got ${gauge}`);
  // Hearts carried in from another room are kept down to what the spirit of this one allows.
  const cap = heartCap(p);
  const asked = options.halves ?? BASE_HALVES;
  if (!Number.isInteger(asked) || asked < 1 || asked > BASE_HALVES) throw new GameSetupError(`halves must be a whole number from 1 to ${BASE_HALVES}, got ${asked}`);
  const halves = Math.min(asked, cap);
  const carried = options.stacks ?? 0;
  if (!Number.isInteger(carried) || carried < 0 || carried >= CLING.maxStacks) {
    throw new GameSetupError(`stacks must be a whole number from 0 to ${CLING.maxStacks - 1}, got ${carried}`);
  }
  const start = options.start ?? playerStart(room);
  const spawned = spawnEnemies(room, table, options.bosses, 1);
  // A tool carried in is only believed while it is handed over, so a locked one is never in hand.
  const tool: HeldTool = options.tool !== undefined && handOf(options).includes(options.tool) ? options.tool : 'stapler';
  const operator = { ...newOperator(start.x, start.y, cap, gauge), halves, stacks: carried, tool, ...(options.halfCarry ? { halfCarry: options.halfCarry } : {}), ...(options.fatigue ? { fatigue: options.fatigue } : {}) };
  const body = boxAt(OPERATOR_BODY, operator.x, operator.y);
  const delivered = ascending(options.delivered ?? []);
  const chilled = ascending(options.chilled ?? []);
  const boxes = settleBoxes(room, options.boxes ?? new Map(), occupantsOf(operator, spawned.enemies).bodies, [...delivered, ...chilled]);
  const switches = ascending([
    ...(options.switches ?? []).filter((id) => lasting(room, id)),
    ...platesUnder(room, body),
    ...platesUnderBoxes(room, boxes),
    ...filledPorts(room, delivered),
  ]);
  const unlocked = ascending(options.unlocked ?? []);
  const taken = ascending((options.taken ?? []).filter((id) => room.objects.some((o) => o.id === id && o.kind === 'Pickup')));
  let factory: FactoryState | undefined;
  let allBoxes: readonly BoxState[] = boxes;
  if (isFactory(room)) {
    // The crate's flags are data, like any immune object's (design doc 5.1): alcohol only goes through the line.
    const def = table.enemies.get(ALCOHOL_CRATE);
    if (!def || def.category !== 'immune') throw new GameSetupError(`${room.id}: a factory room needs "${ALCOHOL_CRATE}" in content/enemies.json as an immune enemy`);
    const placed = placeCrates(room, boxes, occupantsOf(operator, spawned.enemies).bodies, options.acetaldehyde ?? 0, 0);
    allBoxes = placed.boxes;
    factory = { waiting: options.waiting ?? 0, serial: placed.serial, solution: def.solution ?? '', mist: 0 };
  }
  return {
    tick: 0,
    rng: seedStreams(seed),
    clock: options.clock ?? startClock(1, 8),
    p,
    room,
    operator,
    enemies: spawned.enemies,
    projectiles: [],
    shots: [],
    zones: [],
    bosses: spawned.bosses,
    nextId: spawned.nextId,
    freeze: 0,
    roomTicks: 0,
    // Standing on a door or trigger at the start (a checkpoint return) must not fire it again.
    touching: touchedObjects(room, body).map((o) => o.id),
    carried,
    switches,
    unlocked,
    doorsOpen: openDoors(room, switches, unlocked, taken),
    taken,
    boxes: allBoxes,
    push: null,
    delivered,
    chilled,
    dissolved,
    ...(options.stampLocked ? { stampLocked: true as const } : {}),
    ...(options.folderLocked ? { folderLocked: true as const } : {}),
    ...(options.highlighter ? { highlighter: true as const } : {}),
    ...(options.pie ? { pie: PIE_READY } : {}),
    ...(options.unload ? { unload: UNLOAD_READY } : {}),
    ...(factory ? { factory } : {}),
    ...(mixerOf(room) ? { mixer: EMPTY_MIXER } : {}),
    ...(options.perks ? { perks: options.perks } : {}),
  };
}

/**
 * Back to the last checkpoint: room enemies reset, nothing is taken away (design doc 5.6). The
 * gauge stays, and so do clinging stacks: only sleep clears adenosine, not a retry. A boss
 * starts its fight over, and what it summoned leaves with the attempt unless it clings on; a
 * clinging one is no longer the boss's, so it does not count toward the next attempt's summons.
 */
function forcedLeave(before: GameState): GameState {
  // The operator is back at the start, out of bed: the sleep bar of the visit starts over.
  const { sleep: _, cooling: __, ...state } = before;
  const start = playerStart(state.room);
  const enemies = state.enemies.filter((e) => e.summoner === undefined || e.phase === 'attached').map((e) => {
    if (e.phase === 'attached') {
      if (e.summoner === undefined) return e;
      const { summoner: _, ...own } = e;
      return own;
    }
    const { shooed: _, ...fresh } = e;
    const reset: EnemyState = reshield({ ...fresh, x: e.homeX, y: e.homeY, hp: e.maxHp, phase: 'idle', phaseTicks: 0, frozen: 0 });
    return e.boss ? { ...reset, boss: newBossState(state.bosses[e.boss.def]!) } : reset;
  });
  // The tool in hand stays in hand: a retry takes nothing away (design doc 5.6).
  const operator = withStacks({ ...newOperator(start.x, start.y, state.operator.maxHalves, state.operator.gauge), tool: state.operator.tool }, enemies, state.carried);
  // A solved switch stays solved (design doc 5.6); a plate is only down while someone or a box is on it.
  const body = boxAt(OPERATOR_BODY, operator.x, operator.y);
  const clear = occupantsOf(operator, enemies).bodies;
  const settled = settleBoxes(state.room, new Map(state.boxes.filter((b) => !isSpawnedCrate(b)).map((b) => [b.id, { col: b.col, row: b.row }])), clear, [...state.delivered, ...state.chilled]);
  // Acetaldehyde crates are not the map's, so they have no home to settle on: they go back round the outlet, all of them.
  const crates = state.factory
    ? placeCrates(state.room, settled, clear, state.boxes.filter(isSpawnedCrate).length, state.factory.serial)
    : { boxes: settled, serial: 0 };
  const boxes = crates.boxes;
  const switches = ascending([
    ...state.switches.filter((id) => lasting(state.room, id)), ...platesUnder(state.room, body), ...platesUnderBoxes(state.room, boxes),
    ...filledPorts(state.room, state.delivered),
  ]);
  return {
    ...state,
    operator,
    enemies,
    projectiles: [],
    shots: [],
    zones: [],
    freeze: 0,
    touching: touchedObjects(state.room, body).map((o) => o.id),
    switches,
    doorsOpen: openDoors(state.room, switches, state.unlocked, state.taken),
    boxes,
    push: null,
    ...(state.factory ? { factory: { ...state.factory, serial: crates.serial, mist: 0 } } : {}),
    // What it held went home with the other boxes above, since settleBoxes rebuilds every box not delivered.
    ...(state.mixer ? { mixer: EMPTY_MIXER } : {}),
    // The acid lies where the operator no longer is, so a retry starts with none and the skill ready.
    ...(state.unload ? { unload: UNLOAD_READY } : {}),
  };
}

/** Sleep clears the stacks, not the adenosine: a nap on a bed does what the forced nap does. */
export function sendStacksHome(state: GameState): GameState {
  const enemies = state.enemies.map(stackHome);
  return { ...state, enemies, carried: 0, operator: withStacks(state.operator, enemies, 0) };
}



/**
 * The interact rest after a conversation closes (0.5 s). Someone pressing through text keeps
 * pressing at a steady pace, so each press inside the rest starts it over; one who means to talk
 * again stops for longer than this first.
 */
export const TALK_REST_TICKS = 30;

function restTick(s: GameState, pressed: boolean): GameState {
  if (!s.interactRest) return s;
  if (pressed) return { ...s, interactRest: TALK_REST_TICKS };
  const { interactRest, ...rest } = s;
  return interactRest > 1 ? { ...rest, interactRest: interactRest - 1 } : rest;
}

export function step(state: GameState, pressed: TickInput): StepResult {
  const now = state.tick;
  const events: DomainEvent[] = [];
  // Asleep, the operator does nothing: only something that wakes them gives the keys back.
  const input: TickInput = asleep(state.sleep) ? { move: { x: 0, y: 0 }, ...(pressed.assists ? { assists: pressed.assists } : {}) } : {
    ...pressed,
    ...(state.stampLocked && pressed.stampPressed ? { stampPressed: false } : {}),
    ...(handOf(state).length < 2 && pressed.swapPressed ? { swapPressed: false } : {}),
    ...(state.interactRest && pressed.interactPressed ? { interactPressed: false } : {}),
  };

  if (state.freeze > 0) {
    return { state: { ...state, tick: now + 1, freeze: state.freeze - 1, operator: bufferInput(state.operator, input, now, handOf(state).length) }, events };
  }

  const t = beginTick(state, pressed, input, events);
  stepEnemies(t);
  stepWeapons(t);
  stepHits(t);
  stepAftermath(t);
  return settleTick(t);
}

/**
 * The last phase of a tick: the next state from the working set, then what reads the whole tick.
 * The interact rest counts down, the exam reads what this tick did and moves its own clock, and
 * a lethal tick sends the operator back instead. Only fields that are set are written, so a room
 * without a pie, a factory or a sleep bar keeps the same state, and hash, as before.
 */
function settleTick(t: Tick): StepResult {
  const { state, events, op } = t;
  const { cooling: _cooled, ...uncooled } = state;
  let next: GameState = restTick({
    ...uncooled, tick: t.now + 1, roomTicks: state.roomTicks + 1, rng: t.rng, clock: t.clock, operator: op, enemies: enemiesById(t), projectiles: t.flying,
    shots: t.settled.size === 0 ? t.movedShots : t.movedShots.map((sh) => (t.settled.has(waveKey(sh) ?? '') ? { ...sh, spent: true } : sh)),
    zones: [...t.zones.values()].sort((a, b) => a.id - b.id), nextId: t.nextId, freeze: t.freeze,
    // What the door check saw, not a fresh count: a lever pinned by a staple after the check must
    // still count as newly opened next tick for an operator already pressed against its door.
    touching: t.touchingNow, carried: t.carried, switches: t.switches, doorsOpen: t.doorsOpen, taken: t.taken, boxes: t.boxes, push: t.push,
    delivered: t.delivered, chilled: t.chilled,
    ...(t.room === state.room ? {} : { room: t.room, dissolved: t.dissolved }),
    ...(t.pie ? { pie: t.pie } : {}),
    ...(t.unload ? { unload: t.unload } : {}),
    ...(t.factory ? { factory: t.factory } : {}),
    ...(t.mixer ? { mixer: t.mixer } : {}),
    ...(t.orderSerial > 0 ? { orderSerial: t.orderSerial } : {}),
    ...(t.cooling.length > 0 ? { cooling: t.cooling } : {}),
    ...(t.sleep ? { sleep: t.sleep } : {}),
    ...(t.bind ? { bind: t.bind } : {}),
    ...(t.boostUntil !== undefined ? { boostUntil: t.boostUntil } : {}),
  }, t.pressed.interactPressed === true);
  // The exam reads what this tick did (hits, answered cases, a stack failure) and moves its own clock.
  if (t.examining && next.exam && next.examDef) {
    const r = stepExam(next.examDef, {
      exam: next.exam, grid: t.grid, enemies: next.enemies, rng: next.rng, nextId: next.nextId, operator: op,
      interact: t.input.interactPressed === true, happened: events,
    });
    next = withExam(next, r);
    events.push(...r.events);
  }
  // A forced leave clears the freeze, so the freeze event is only emitted when it will happen.
  if (op.halves <= 0) {
    // The room is already reset by now, so a door, trigger or bed touched on the lethal tick would
    // be read against the wrong place and state; dying wins.
    // A bar filled on that tick does not count either: the chapter must not end and go back to the checkpoint at once.
    const kept = events.filter((e) => !t.roomEvents.includes(e) && e.type !== 'sleepFilled');
    kept.push({ type: 'forcedLeave' });
    return { state: forcedLeave(next), events: kept };
  }
  if (t.freeze > 0) events.push({ type: 'freeze', frames: t.freeze });
  return { state: next, events };
}

/** The room after an exam tick: its enemies, new shots (numbered from the shared counter) and clock. */
function withExam(state: GameState, r: ExamTick): GameState {
  let nextId = r.nextId;
  const kept = r.dropShotsOf === undefined ? state.shots : state.shots.filter((sh) => sh.owner !== r.dropShotsOf);
  const shots = [...kept, ...r.shots.map((sh) => ({ ...sh, id: nextId++, spent: false }))];
  return { ...state, exam: r.exam, enemies: r.enemies, shots, rng: r.rng, nextId };
}

/**
 * The forecast has been read: the exam begins in this room (core/exam/fight.ts). `residue` is the
 * caffeine as it begins and `sleepDebt` the night's, which set the cloak and the adenosine.
 */
export function beginExam(state: GameState, def: ExamDef, residue: number, sleepDebt: number): StepResult {
  const r = startExam(def, {
    grid: withBoxes(state.room.grid, state.boxes), enemies: state.enemies, rng: state.rng, nextId: state.nextId,
    op: { x: state.operator.x, y: state.operator.y }, residue, sleepDebt,
  });
  return { state: withExam({ ...state, examDef: def }, r), events: r.events };
}

export const selectExam = (s: GameState): { readonly state: ExamState; readonly def: ExamDef } | undefined =>
  (s.exam && s.examDef ? { state: s.exam, def: s.examDef } : undefined);

export const selectOperator = (s: GameState): Readonly<OperatorState> => s.operator;
/** Whole seconds left in the sugar fatigue fog, rounded up so the HUD never shows 0 while it still slows; undefined without it. */
export const selectFatigue = (s: GameState): number | undefined =>
  (s.operator.fatigue === undefined ? undefined : Math.ceil(s.operator.fatigue / TICK_HZ));
export const selectEnemies = (s: GameState): readonly Readonly<EnemyState>[] => s.enemies;
export const selectProjectiles = (s: GameState): readonly Readonly<Projectile>[] => s.projectiles;
export const selectShots = (s: GameState): readonly Readonly<Shot>[] => s.shots;
export const selectZones = (s: GameState): readonly Readonly<Zone>[] => s.zones;
export const selectHearts = (s: GameState): { readonly halves: number; readonly maxHalves: number } =>
  ({ halves: s.operator.halves, maxHalves: s.operator.maxHalves });
export const selectTick = (s: GameState): number => s.tick;
export const selectActiveVariants = (s: GameState): readonly string[] => s.room.active;
export const selectFrozen = (s: GameState): boolean => s.freeze > 0;
export const selectGauge = (s: GameState): { readonly value: number; readonly max: number } =>
  ({ value: s.operator.gauge, max: STAMP.gaugeMax });
export const selectClock = (s: GameState): RuleClock => s.clock;
/** The tool in hand, and whether a second one is handed over to swap to, for the HUD. */
export const selectTool = (s: GameState): { readonly tool: HeldTool; readonly canSwap: boolean } =>
  ({ tool: s.operator.tool, canSwap: handOf(s).length > 1 });

/** The partner's pie shield for the HUD: whether it is up, cooling or ready, the seconds left on that, and S. Absent without a partner. */
export function selectPie(s: GameState): { readonly phase: 'ready' | 'up' | 'cooling'; readonly seconds: number; readonly scale: number } | undefined {
  const p = s.pie;
  if (!p) return undefined;
  const scale = sleepOfSpirit(s.p);
  if (p.ticksLeft > 0) return { phase: 'up', seconds: Math.ceil(p.ticksLeft / TICK_HZ), scale };
  return p.cooldown > 0 ? { phase: 'cooling', seconds: Math.ceil(p.cooldown / TICK_HZ), scale } : { phase: 'ready', seconds: 0, scale };
}
/** The room's food chunks for the view: each with whether the acid has dissolved it, and how far the acid lying on it has got (0 to 1; 0 when none lies on it). */
export function selectChunks(s: GameState): readonly { readonly object: number; readonly dissolved: boolean; readonly melting: number }[] {
  const acid = s.unload && s.unload.ticksLeft > 0 ? unloadBox(s.unload) : undefined;
  const under = acid ? new Set(chunksUnder(s.room, s.dissolved, acid).map((c) => c.object.id)) : new Set<number>();
  const progress = s.unload ? Math.min(1, unloadAge(s.unload) / CHUNK.dissolveTicks) : 0;
  return chunksOf(s.room).map((c) => ({ object: c.object.id, dissolved: s.dissolved.includes(c.object.id), melting: under.has(c.object.id) ? progress : 0 }));
}
/** The partner's acid for the HUD: whether it lies, cools or is ready, and the seconds left on that. Absent without a partner that has it. */
export function selectUnload(s: GameState): { readonly phase: 'ready' | 'up' | 'cooling'; readonly seconds: number } | undefined {
  const u = s.unload;
  if (!u) return undefined;
  if (u.ticksLeft > 0) return { phase: 'up', seconds: Math.ceil(u.ticksLeft / TICK_HZ) };
  return u.cooldown > 0 ? { phase: 'cooling', seconds: Math.ceil(u.cooldown / TICK_HZ) } : { phase: 'ready', seconds: 0 };
}
/** The NPC, bed, pickup or toggle switch the interact key would use right now, for the HUD prompt; same rule as the key, except that a switch still cooling is not offered, since the key would only say so. */
export function selectInteractable(s: GameState): { readonly object: number; readonly kind: string } | undefined {
  if (s.operator.action.kind !== 'free' || s.interactRest || asleep(s.sleep)) return undefined;
  const o = reachableObject(s.room, boxAt(OPERATOR_BODY, s.operator.x, s.operator.y), s.operator, s.taken);
  if (!o || (o.kind === 'Switch' && coolingLeft(s.cooling ?? [], o.id) > 0)) return undefined;
  return { object: o.id, kind: o.kind };
}
/** Every locked door of the room and whether it is open now, by the same rule the step uses. */
/** Locked doors and whether each is open. A hidden passage is left out: it carries no lock plate, or the plate would give it away. */
export function selectDoorLocks(s: GameState): readonly { readonly object: number; readonly lock: string; readonly open: boolean }[] {
  return s.room.objects.filter((o) => o.kind === 'Door' && o.props['lock'] !== 'none' && !hiddenDoor(s.room, o, []))
    .map((o) => ({ object: o.id, lock: String(o.props['lock']), open: doorOpen(s.room.objects, o, s.switches, s.unlocked, s.taken) }));
}
/** Every pickup of the room and whether it is still there to take. */
export function selectPickups(s: GameState): readonly { readonly object: number; readonly itemType: string; readonly present: boolean }[] {
  return s.room.objects.filter((o) => o.kind === 'Pickup')
    .map((o) => ({ object: o.id, itemType: String(o.props['itemType']), present: !s.taken.includes(o.id) }));
}
/** Every switch of the room and whether it is on. */
export function selectSwitches(s: GameState): readonly { readonly object: number; readonly mode: string; readonly on: boolean; readonly figure: string }[] {
  return s.room.objects.filter((o) => o.kind === 'Switch')
    .map((o) => ({ object: o.id, mode: String(o.props['mode']), on: s.switches.includes(o.id), figure: String(o.props['figure'] ?? 'none') }));
}
/** Every box with where to draw it now (the top-left of its tile, part way along a slide). */
export function selectBoxes(s: GameState): readonly { readonly object: number; readonly boxType: string; readonly x: number; readonly y: number }[] {
  return s.boxes.map((b) => {
    const o = s.room.objects.find((x) => x.id === b.id);
    return { object: b.id, boxType: b.boxType ?? String(o?.props['boxType'] ?? 'crate'), ...boxPixel(b) };
  });
}
/** Every food box on the floor and its portion, for the pips on its label: the sorting center asks the player to tell them apart. */
export function selectPortions(s: GameState): readonly { readonly object: number; readonly portion: Portion }[] {
  return s.boxes.filter((b) => boxTypeOf(s.room, b) === 'food').map((b) => ({ object: b.id, portion: portionOf(s.room, b.id) }));
}
/** The factory for drawing it: the dock and the crates on it, and the second line. */
export function selectFactory(s: GameState): {
  readonly receiving: RoomObject; readonly intake: RoomObject | undefined; readonly crates: readonly Tile[];
} | undefined {
  const f = s.factory;
  const lines = linesOf(s.room);
  if (!f || !lines.receiving) return undefined;
  return { receiving: lines.receiving, intake: lines.intake, crates: crateTiles(s.room, f.waiting) };
}
/**
 * The room's port, if any, with how many boxes it holds of the ones it needs. A timed port that is
 * not full yet also says whether it is open and the whole seconds until that changes.
 */
export function selectPort(s: GameState): {
  readonly object: number; readonly count: number; readonly need: number; readonly gate?: { readonly open: boolean; readonly seconds: number };
} | undefined {
  const port = portOf(s.room);
  if (!port) return undefined;
  const base = { object: port.id, count: s.delivered.length, need: Number(port.props['need']) };
  const left = liveGate(s.room, s.delivered) ? portTicksLeft(port, s.roomTicks) : undefined;
  return left === undefined ? base : { ...base, gate: { open: portOpenAt(port, s.roomTicks), seconds: Math.ceil(left / TICK_HZ) } };
}
/** The room's mixer for drawing it: what it digests, each with the share done, and where parcels come out. */
export function selectMixer(s: GameState): {
  readonly mixer: RoomObject; readonly capacity: number; readonly outlet: Tile | undefined;
  readonly batches: readonly { readonly box: number; readonly portion: Portion; readonly done: number; readonly slots: number }[];
} | undefined {
  const m = mixerOf(s.room);
  if (!m || !s.mixer) return undefined;
  return {
    mixer: m, capacity: Number(m.props['capacity']), outlet: mixerOutlet(s.room),
    batches: s.mixer.batches.map((b) => ({ box: b.box, portion: b.portion, done: 1 - b.left / (PORTION_SECONDS[b.portion] * TICK_HZ), slots: b.slots ?? 1 })),
  };
}
/**
 * The stomach boss's sleep bar in his last stage (design doc 7.5, 熄燈), for the HUD: the share filled,
 * whether the mixer is holding it, whether the stamp would close the case now, and whether the gauge lets it be pressed. Undefined before the
 * stage and once he is beaten.
 */
export function selectFightSleep(s: GameState): {
  readonly share: number; readonly held: boolean; readonly full: boolean; readonly exposed: boolean; readonly stampReady: boolean;
} | undefined {
  const e = s.enemies.find((x) => x.boss?.behaviour === 'snack' && x.phase !== 'closed');
  const b = e?.boss;
  const def = b ? s.bosses[b.def] : undefined;
  if (b?.behaviour !== 'snack' || !b.sleep || def?.behaviour !== 'snack') return undefined;
  const share = sleepShare(def, b.sleep);
  const exposed = snackExposed(def, b, s.mixer);
  // The weak spot can be open with the gauge spent on an early stamp; the HUD must not call for a stamp that cannot be pressed.
  return { share, held: b.sleep.hold > 0, full: share >= 1, exposed, stampReady: exposed && gaugeFull(s.operator) };
}

/** The sleep bar for the HUD: the share slept, and whether the operator is up and has to lie down again. */
export function selectSleep(s: GameState): { readonly bed: number; readonly share: number; readonly awake: boolean; readonly wakes: number } | undefined {
  const z = s.sleep;
  return z ? { bed: z.bed, share: z.slept / z.need, awake: z.awake, wakes: z.wakes } : undefined;
}
/** Every conveyor and whether it runs now, by the rule the step uses. */
export function selectConveyors(s: GameState): readonly { readonly object: number; readonly direction: string; readonly speed: string; readonly running: boolean }[] {
  return conveyorsOf(s.room).map((o) => ({
    object: o.id, direction: flowName(s.room.objects, o, s.switches), speed: String(o.props['speed']), running: conveyorRunning(s.room.objects, o, s.switches),
  }));
}
/** The toggle switches still cooling down, with the share of the cooldown left (1 just after a throw, 0 when ready); none when all are ready. */
export function selectCooling(s: GameState): readonly { readonly object: number; readonly left: number; readonly seconds: number }[] {
  return (s.cooling ?? []).map((c) => {
    const o = s.room.objects.find((x) => x.id === c.id);
    return { object: c.id, left: o ? c.left / cooldownTicks(o) : 0, seconds: c.left / TICK_HZ };
  });
}
/** Clinging enemies in id order, for drawing them on the operator. */
export const selectStacks = (s: GameState): readonly Readonly<EnemyState>[] =>
  s.enemies.filter((e) => e.phase === 'attached');

export interface BossSummary {
  readonly id: number;
  readonly type: string;
  readonly budget: number;
  readonly maxBudget: number;
  readonly stage: 1 | 2 | 3;
  /** The caffeine boss's residue curve; absent for other bosses. */
  readonly caffeine?: { readonly residue: number; readonly boostMin: number };
  /** The toast boss is breathing, his weak point. */
  readonly breathing: boolean;
  readonly defeated: boolean;
}

/** The room's boss for the nameplate, or undefined in a room without one. */
export function selectBoss(s: GameState): BossSummary | undefined {
  const e = s.enemies.find((x) => x.boss);
  if (!e?.boss) return undefined;
  const b = e.boss;
  const def = s.bosses[b.def]!;
  return {
    id: e.id, type: e.type, budget: e.hp, maxBudget: e.maxHp, stage: b.stage,
    ...(b.behaviour === 'caffeine' && def.behaviour === 'caffeine' ? { caffeine: { residue: b.residue, boostMin: def.boostMin } } : {}),
    breathing: b.behaviour === 'toast' && breathing(b) && e.phase !== 'closed', defeated: e.phase === 'closed',
  };
}

/**
 * Alcohol work orders on the operator (design doc 7.7): once a toast boss in the room is awake, one
 * per cup waiting in receiving, up to the boss's cap, each a slow. His breath does not lift them:
 * the doc has them ease only as the line works the cups off. 0 without one, and 0 while he still
 * waits for the operator to come in.
 */
export function workOrders(s: GameState, waiting: number): { readonly stacks: number; readonly slow: number } {
  const e = s.enemies.find((x) => x.boss?.behaviour === 'toast' && x.phase !== 'closed' && (x.boss as ToastState).part !== 'wait');
  const def = e ? s.bosses[e.boss!.def] : undefined;
  if (def?.behaviour !== 'toast') return { stacks: 0, slow: 0 };
  const stacks = Math.min(def.workOrder.maxStacks, Math.max(0, waiting));
  return { stacks, slow: Math.round(stacks * def.workOrder.slowPerStack * 1e6) / 1e6 };
}
