import { boxAt, centeredBox, overlaps, type Box } from './collision/boxes.ts';
import { isSolid, moveAndCollide } from './collision/grid.ts';
import { ENEMY_BODY, enemyCenter, enemyHurtbox, isHittable, isMelee, stepEnemy, strikeBox, type EnemyState } from './combat/actors.ts';
import { newBossState, type BossDef, type BossTable } from './combat/bosses/boss.ts';
import { proposalOpen, stepCaffeine } from './combat/bosses/caffeine.ts';
import type { Enemy } from './content/generated.ts';
import type { EnemyTable } from './combat/enemies.ts';
import { BASE_HALVES, BOSS, CLING, DODGE, ENEMY_HIT_FREEZE, GAUGE, HURT, STAMP, STAPLER } from './combat/frames.ts';
import { circleTouchesBox, shotBox, zoneContinues, zoneLive, type Shot, type ShotSpec, type Zone, type ZoneSpec } from './combat/hazards.ts';
import type { Vec } from './combat/movement.ts';
import {
  bufferInput, gaugeFull, hurtOperator, inDodgeIframes, isInvincible, newOperator, OPERATOR_BODY, OPERATOR_HURT, stepOperator, unit,
  type OperatorState, type TickInput,
} from './combat/operator.ts';
import { advance, startClock, type RuleClock } from './clock.ts';
import { seedStreams, type RngStreams } from './rng.ts';
import {
  advanceSlide, beltAt, boxAhead, boxPixel, canEnter, CONVEYOR_TICKS, conveyorRunning, conveyorsOf, directionOf, filledPorts, nearest, onPort,
  portOf, PUSH, pushDirection, settleBoxes, startSlide, tileAt, tileBox, withBoxes, type BoxState, type Occupants, type Tile,
} from './rooms/boxes.ts';
import type { EnteredRoom } from './rooms/entry.ts';
import { leverAt, objectBox, platesUnder, reachableObject, touchedObjects } from './rooms/interact.ts';
import { doorOpen } from './rooms/locks.ts';
import {
  ALCOHOL_CRATE, boxCentre, crateOnTile, crateTiles, isFactory, isSpawnedCrate, linesOf, MIST, onIntake, outletTile,
} from './liver/factory.ts';
import { playerStart, type RoomObject } from './rooms/tiled.ts';
import { TICK_HZ, TILE } from './time.ts';

export { NO_INPUT, OPERATOR_BODY, OPERATOR_HURT, type OperatorAction, type OperatorState, type TickInput } from './combat/operator.ts';
export type { EnemyPhase, EnemyState } from './combat/actors.ts';
export type { Shot, Zone } from './combat/hazards.ts';

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
  /** Set until the chairman hands over the stamp (design doc 5.4): the stamp key does nothing. */
  readonly stampLocked?: true;
  /**
   * How far clinging enemies can see the operator, when the caffeine cloak cuts it below
   * CLING.senseRangePx (design doc 7.4); 0 means they cannot see the operator at all. The chapter
   * sets it every tick from the caffeine tag, since the room knows no tags.
   */
  readonly senseCapPx?: number;
  /** Only in a liver factory room (core/liver/factory.ts). */
  readonly factory?: FactoryState;
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
  | { readonly type: 'dodge' }
  | { readonly type: 'perfectDodge'; readonly source: number }
  | { readonly type: 'telegraph'; readonly source: number; readonly tier: 1 | 2 | 3; readonly move?: string }
  | { readonly type: 'hit'; readonly target: number; readonly enemy: string; readonly hpLeft: number }
  | { readonly type: 'caseClosed'; readonly target: number; readonly enemy: string }
  | { readonly type: 'dispersed'; readonly target: number; readonly enemy: string }
  | { readonly type: 'reformed'; readonly target: number; readonly enemy: string }
  | { readonly type: 'respawned'; readonly target: number; readonly enemy: string }
  | { readonly type: 'immuneBounce'; readonly target: number; readonly enemy: string; readonly solution: string }
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
  | { readonly type: 'bossDefeated'; readonly target: number; readonly enemy: string }
  /** The operator stepped onto an unlocked door; the chapter decides where it leads. */
  | { readonly type: 'doorEntered'; readonly object: number; readonly door: string; readonly socket: string }
  | { readonly type: 'doorLocked'; readonly object: number; readonly lock: string }
  /** A switch went on or off; `by` says what moved it. Only toggle switches stay on after the operator leaves. */
  | { readonly type: 'switchChanged'; readonly object: number; readonly on: boolean; readonly mode: string; readonly by: 'interact' | 'staple' | 'step' | 'box' }
  /** A box started sliding to this tile, pushed by the operator or carried by a conveyor. */
  | { readonly type: 'boxMoved'; readonly object: number; readonly col: number; readonly row: number; readonly by: 'push' | 'conveyor' }
  /** A box came to rest on a Port, which took it; `count` is how many the port holds now. */
  | { readonly type: 'boxDelivered'; readonly object: number; readonly port: number; readonly count: number; readonly need: number }
  /** A Port took its last needed box: it now counts as a switch that is on, for good. */
  | { readonly type: 'portFilled'; readonly object: number }
  /** The second line took in an acetaldehyde crate; the chapter takes it off the `acetaldehyde` tag. */
  | { readonly type: 'crateTaken'; readonly object: number; readonly line: number }
  | { readonly type: 'triggerEntered'; readonly object: number; readonly trigger: string; readonly eventId: string }
  /** The operator took an item; what it does beyond leaving the room (and opening a key lock) is the chapter's. */
  | { readonly type: 'pickedUp'; readonly object: number; readonly itemType: string; readonly itemId: string }
  | { readonly type: 'talk'; readonly object: number; readonly npc: string; readonly dialogueId: string }
  | { readonly type: 'bedUse'; readonly object: number; readonly bedType: string };

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

const STAPLE_HALF = 2;
const STAPLE_LIFE = Math.ceil(STAPLER.rangePx / STAPLER.speed);

function enemyFrom(def: Enemy, id: number, x: number, y: number, respawnTicks: number, extra: Partial<EnemyState> = {}): EnemyState {
  const hp = def.performance ?? 0;
  return {
    id, type: def.id, category: def.category,
    ...(def.archetype ? { archetype: def.archetype } : {}),
    ...(def.solution ? { solution: def.solution } : {}),
    x, y, homeX: x, homeY: y, hp, maxHp: hp, phase: 'idle', phaseTicks: 0, frozen: 0,
    strikeDir: { x: 0, y: 1 }, strikeSpent: false, respawnTicks, clings: def.clings === true,
    ...extra,
  };
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
  /** The stamp is not handed over yet. */
  readonly stampLocked?: boolean;
  /** In a factory room: alcohol crates waiting in receiving. */
  readonly waiting?: number;
  /** In a factory room: acetaldehyde crates to put out round the outlet at entry. */
  readonly acetaldehyde?: number;
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

const switchMode = (room: EnteredRoom, id: number): string | undefined => {
  const o = room.objects.find((x) => x.id === id && x.kind === 'Switch');
  return o ? String(o.props['mode']) : undefined;
};

const ascending = (ids: Iterable<number>): number[] => [...new Set(ids)].sort((a, b) => a - b);

/** Plates held down by a box at rest; a sliding box has not arrived and presses nothing yet. */
const platesUnderBoxes = (room: EnteredRoom, boxes: readonly BoxState[]): number[] =>
  boxes.filter((b) => b.left === 0).flatMap((b) => platesUnder(room, tileBox(b)));

/**
 * Bodies a box must not slide into or settle on: the operator, every enemy still standing in the
 * room, and every enemy's home, since enemies reappear there (respawn, reform, a nap, a forced leave).
 */
function occupantsOf(op: OperatorState, enemies: Iterable<EnemyState>): Occupants {
  const bodies = [boxAt(OPERATOR_BODY, op.x, op.y)];
  for (const e of enemies) {
    if (e.phase !== 'attached' && e.phase !== 'closed') bodies.push(boxAt(ENEMY_BODY, e.x, e.y));
    bodies.push(boxAt(ENEMY_BODY, e.homeX, e.homeY));
  }
  return { bodies };
}

/** Doors open with these switches, state-opened doors and taken keys, in id order. */
function openDoors(room: EnteredRoom, switches: readonly number[], unlocked: readonly number[], taken: readonly number[]): number[] {
  return room.objects.filter((o) => o.kind === 'Door' && doorOpen(room.objects, o, switches, unlocked, taken)).map((o) => o.id).sort((a, b) => a - b);
}

/**
 * The enemy table is required: rooms with Spawns cannot start without it. The room must have
 * gone through enterRoom, so a caller cannot forget the tags and silently get the base room.
 */
export function createGame(room: EnteredRoom, seed: number, table: EnemyTable, options: GameOptions = {}): GameState {
  const p = options.p ?? 1;
  const gauge = options.gauge ?? 0;
  if (!(p > 0 && p <= 1)) throw new GameSetupError(`P must be in (0, 1], got ${p}`);
  if (!(gauge >= 0 && gauge <= STAMP.gaugeMax)) throw new GameSetupError(`gauge must be 0 to ${STAMP.gaugeMax}, got ${gauge}`);
  const halves = options.halves ?? BASE_HALVES;
  if (!Number.isInteger(halves) || halves < 1 || halves > BASE_HALVES) throw new GameSetupError(`halves must be a whole number from 1 to ${BASE_HALVES}, got ${halves}`);
  const carried = options.stacks ?? 0;
  if (!Number.isInteger(carried) || carried < 0 || carried >= CLING.maxStacks) {
    throw new GameSetupError(`stacks must be a whole number from 0 to ${CLING.maxStacks - 1}, got ${carried}`);
  }
  const start = options.start ?? playerStart(room);
  const spawned = spawnEnemies(room, table, options.bosses, 1);
  const operator = { ...newOperator(start.x, start.y, BASE_HALVES, gauge), halves, stacks: carried };
  const body = boxAt(OPERATOR_BODY, operator.x, operator.y);
  const delivered = ascending(options.delivered ?? []);
  const boxes = settleBoxes(room, options.boxes ?? new Map(), occupantsOf(operator, spawned.enemies).bodies, delivered);
  const switches = ascending([
    ...(options.switches ?? []).filter((id) => switchMode(room, id) === 'toggle'),
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
    ...(options.stampLocked ? { stampLocked: true as const } : {}),
    ...(factory ? { factory } : {}),
  };
}

/** Soft lock (design doc 5.2): the nearest defeatable target within 25 degrees of aim and 7 tiles. */
function aimFrom(op: OperatorState, origin: Vec, enemies: readonly EnemyState[]): Vec {
  const cos = Math.cos((STAPLER.lockHalfAngleDeg * Math.PI) / 180);
  let best: { e: EnemyState; d: number } | undefined;
  for (const e of enemies) {
    if (e.category !== 'defeatable' || !isHittable(e)) continue;
    const c = enemyCenter(e);
    const dx = c.x - origin.x;
    const dy = c.y - origin.y;
    const d = Math.hypot(dx, dy);
    if (d === 0 || d > STAPLER.lockRangePx) continue;
    if ((dx * op.aim.x + dy * op.aim.y) / d < cos) continue;
    if (!best || d < best.d) best = { e, d };
  }
  if (!best) return op.aim;
  const c = enemyCenter(best.e);
  return unit({ x: c.x - origin.x, y: c.y - origin.y });
}

/**
 * Back to the last checkpoint: room enemies reset, nothing is taken away (design doc 5.6). The
 * gauge stays, and so do clinging stacks: only sleep clears adenosine, not a retry. A boss
 * starts its fight over, and what it summoned leaves with the attempt unless it clings on; a
 * clinging one is no longer the boss's, so it does not count toward the next attempt's summons.
 */
function forcedLeave(state: GameState): GameState {
  const start = playerStart(state.room);
  const enemies = state.enemies.filter((e) => e.summoner === undefined || e.phase === 'attached').map((e) => {
    if (e.phase === 'attached') {
      if (e.summoner === undefined) return e;
      const { summoner: _, ...own } = e;
      return own;
    }
    const reset: EnemyState = { ...e, x: e.homeX, y: e.homeY, hp: e.maxHp, phase: 'idle', phaseTicks: 0, frozen: 0 };
    return e.boss ? { ...reset, boss: newBossState(state.bosses[e.boss.def]!) } : reset;
  });
  const operator = withStacks(newOperator(start.x, start.y, state.operator.maxHalves, state.operator.gauge), enemies, state.carried);
  // A solved switch stays solved (design doc 5.6); a plate is only down while someone or a box is on it.
  const body = boxAt(OPERATOR_BODY, operator.x, operator.y);
  const clear = occupantsOf(operator, enemies).bodies;
  const settled = settleBoxes(state.room, new Map(state.boxes.filter((b) => !isSpawnedCrate(b)).map((b) => [b.id, { col: b.col, row: b.row }])), clear, state.delivered);
  // Acetaldehyde crates are not the map's, so they have no home to settle on: they go back round the outlet, all of them.
  const crates = state.factory
    ? placeCrates(state.room, settled, clear, state.boxes.filter(isSpawnedCrate).length, state.factory.serial)
    : { boxes: settled, serial: 0 };
  const boxes = crates.boxes;
  const switches = ascending([
    ...state.switches.filter((id) => switchMode(state.room, id) === 'toggle'), ...platesUnder(state.room, body), ...platesUnderBoxes(state.room, boxes),
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
  };
}

/** A clinging stack goes back to where it spawned and reforms there; nothing is removed. */
const stackHome = (e: EnemyState): EnemyState =>
  e.phase === 'attached' ? { ...e, phase: 'dispersed', phaseTicks: 0, x: e.homeX, y: e.homeY } : e;

/** Sleep clears the stacks, not the adenosine: a nap on a bed does what the forced nap does. */
export function sendStacksHome(state: GameState): GameState {
  const enemies = state.enemies.map(stackHome);
  return { ...state, enemies, carried: 0, operator: withStacks(state.operator, enemies, 0) };
}

const stackCount = (enemies: Iterable<EnemyState>, carried: number): number =>
  carried + [...enemies].filter((e) => e.phase === 'attached').length;

function withStacks(op: OperatorState, enemies: Iterable<EnemyState>, carried: number): OperatorState {
  const stacks = stackCount(enemies, carried);
  return op.stacks === stacks ? op : { ...op, stacks };
}

/** Adds charge times P; rounded so that 125 staples at P = 1 fill the gauge exactly. */
function charge(op: OperatorState, amount: number, p: number, events: DomainEvent[]): OperatorState {
  if (gaugeFull(op)) return op;
  const gauge = Math.min(STAMP.gaugeMax, Math.round((op.gauge + amount * p) * 1e6) / 1e6);
  if (gauge >= STAMP.gaugeMax) events.push({ type: 'gaugeFull' });
  return { ...op, gauge };
}

/**
 * Damage to a defeatable enemy. A boss has no hit-stop, so hits never stretch its telegraphs,
 * and takes 1.5 times damage under review (design doc 5.4).
 */
function damage(e: EnemyState, amount: number, freeze: number, events: DomainEvent[]): EnemyState {
  const factor = e.boss && e.boss.review > 0 ? BOSS.reviewDamageFactor : 1;
  const hp = Math.round((e.hp - amount * factor) * 1e6) / 1e6;
  if (hp <= 0) {
    if (e.boss) {
      events.push({ type: 'bossDefeated', target: e.id, enemy: e.type });
      return { ...e, hp: 0, phase: 'closed', phaseTicks: 0, frozen: 0, boss: { ...e.boss, move: null } };
    }
    events.push({ type: 'caseClosed', target: e.id, enemy: e.type });
    return { ...e, hp: 0, phase: 'closed', phaseTicks: 0, frozen: 0 };
  }
  events.push({ type: 'hit', target: e.id, enemy: e.type, hpLeft: hp });
  return { ...e, hp, frozen: e.boss ? 0 : freeze };
}

function interactionOf(o: RoomObject): DomainEvent {
  return o.kind === 'NPC'
    ? { type: 'talk', object: o.id, npc: String(o.props['npcId']), dialogueId: String(o.props['dialogueId']) }
    : { type: 'bedUse', object: o.id, bedType: String(o.props['bedType']) };
}

/**
 * Boxes for this tick, in three passes: slides already under way move on, belts carry the boxes
 * resting on them, then the operator's push, so a box shoved onto a belt is carried from the next
 * tick. The switches are last tick's: a lever thrown this tick starts its conveyor on the next.
 * The array is kept when nothing moves, so the solid grid built from it stays cached.
 */
function moveBoxes(state: GameState, op: OperatorState, input: TickInput): MovedBoxes {
  if (state.boxes.length === 0) return { boxes: state.boxes, push: null, events: [], delivered: state.delivered };
  const room = state.room;
  const events: DomainEvent[] = [];
  const occupants = occupantsOf(op, state.enemies);
  let boxes = state.boxes.some((b) => b.left > 0) ? state.boxes.map((b) => (b.left > 0 ? advanceSlide(b) : b)) : state.boxes;
  const replace = (next: BoxState) => { boxes = boxes.map((b) => (b.id === next.id ? next : b)); };

  // A box that has come to rest on the port is taken in before belts or a push could move it on.
  const port = portOf(room);
  let delivered = state.delivered;
  if (port) {
    const need = Number(port.props['need']);
    for (const b of boxes.filter((x) => x.left === 0 && !isSpawnedCrate(x) && onPort(port, x))) {
      boxes = boxes.filter((x) => x.id !== b.id);
      delivered = ascending([...delivered, b.id]);
      events.push({ type: 'boxDelivered', object: b.id, port: port.id, count: delivered.length, need });
      if (delivered.length === need) events.push({ type: 'portFilled', object: port.id });
    }
  }
  // The second line takes in an acetaldehyde crate at rest on it in the same way (design doc 7.7).
  const intake = state.factory ? linesOf(room).intake : undefined;
  if (intake) {
    for (const b of boxes.filter((x) => x.left === 0 && isSpawnedCrate(x) && onIntake(room, x))) {
      boxes = boxes.filter((x) => x.id !== b.id);
      events.push({ type: 'crateTaken', object: b.id, line: intake.id });
    }
  }
  const out = (push: PushState | null): MovedBoxes => ({ boxes, push, events, delivered });

  for (const b of [...boxes]) {
    if (b.left > 0) continue;
    const belt = beltAt(room, b, state.switches);
    if (!belt) continue;
    const dir = directionOf(belt);
    const to = { col: b.col + dir.col, row: b.row + dir.row };
    if (!canEnter(room, boxes, to, occupants)) continue;
    replace(startSlide(b, dir, CONVEYOR_TICKS[String(belt.props['speed'])]!, true));
    events.push({ type: 'boxMoved', object: b.id, ...to, by: 'conveyor' });
  }

  const dir = op.action.kind === 'free' ? pushDirection(input.move) : undefined;
  if (!dir) return out(null);
  const same = state.push && state.push.dir.col === dir.col && state.push.dir.row === dir.row ? state.push : null;
  const ahead = boxAhead(boxes, boxAt(OPERATOR_BODY, op.x, op.y), dir);
  // Still pressing the same way while the box slides off and the operator catches up: the next
  // push follows without a fresh wait. Only that box gets the head start.
  if (!ahead) return out(same);
  const ticks = Math.min(PUSH.delayTicks, same?.box === ahead.id ? same.ticks + 1 : 1);
  if (ticks >= PUSH.delayTicks) {
    const to = { col: ahead.col + dir.col, row: ahead.row + dir.row };
    if (canEnter(room, boxes, to, occupants)) {
      replace(startSlide(ahead, dir, PUSH.slideTicks));
      events.push({ type: 'boxMoved', object: ahead.id, ...to, by: 'push' });
    }
  }
  return out({ box: ahead.id, dir, ticks });
}

interface MovedBoxes {
  readonly boxes: readonly BoxState[];
  readonly push: PushState | null;
  readonly events: DomainEvent[];
  readonly delivered: readonly number[];
}

export function step(state: GameState, pressed: TickInput): StepResult {
  const now = state.tick;
  const events: DomainEvent[] = [];
  const input = state.stampLocked && pressed.stampPressed ? { ...pressed, stampPressed: false } : pressed;

  if (state.freeze > 0) {
    return { state: { ...state, tick: now + 1, freeze: state.freeze - 1, operator: bufferInput(state.operator, input, now) }, events };
  }

  const room = state.room;
  let grid = withBoxes(room.grid, state.boxes);
  const senseRange = Math.min(CLING.senseRangePx, state.senseCapPx ?? CLING.senseRangePx);
  const s = stepOperator(grid, state.operator, input, now);
  let op = s.op;
  if (s.blockedX) events.push({ type: 'bumpWall', axis: 'x' });
  if (s.blockedY) events.push({ type: 'bumpWall', axis: 'y' });
  if (s.dodged) events.push({ type: 'dodge' });
  if (s.stampRaised) events.push({ type: 'stampRaised' });

  // A running belt under the feet carries the operator along. Walking against it is slower; a fast
  // belt (4 tiles/s) outruns an operator slowed below that, by held fire or clinging stacks.
  const underfoot = beltAt(room, tileAt(op.x, op.y - 1), state.switches);
  if (underfoot) {
    const d = directionOf(underfoot);
    const v = TILE / CONVEYOR_TICKS[String(underfoot.props['speed'])]!;
    const m = moveAndCollide(grid, OPERATOR_BODY, op.x, op.y, d.col * v, d.row * v);
    op = { ...op, x: m.x, y: m.y };
  }

  const moved = moveBoxes(state, op, input);
  const { boxes, push } = moved;
  events.push(...moved.events);
  grid = withBoxes(room.grid, boxes);

  // Switches and keys move before doors are judged, so a door opened this tick lets the operator
  // through at once. Their events are not room events: a switch thrown or an item taken on a
  // lethal tick counts as if done a tick earlier; the chapter's forced leave then decides what a
  // return to the punch undoes.
  const body = boxAt(OPERATOR_BODY, op.x, op.y);
  const used = input.interactPressed && op.action.kind === 'free' ? reachableObject(state.room, body, op, state.taken) : undefined;
  let levers = state.switches.filter((id) => switchMode(state.room, id) === 'toggle');
  if (used?.kind === 'Switch') {
    const on = !levers.includes(used.id);
    levers = on ? [...levers, used.id] : levers.filter((id) => id !== used.id);
    events.push({ type: 'switchChanged', object: used.id, on, mode: 'toggle', by: 'interact' });
  }
  let taken = state.taken;
  if (used?.kind === 'Pickup') {
    taken = ascending([...taken, used.id]);
    events.push({ type: 'pickedUp', object: used.id, itemType: String(used.props['itemType']), itemId: String(used.props['itemId']).trim() });
  }
  const stoodOn = platesUnder(state.room, body);
  const plates = ascending([...stoodOn, ...platesUnderBoxes(state.room, boxes)]);
  const wasDown = state.switches.filter((id) => switchMode(state.room, id) === 'hold');
  const boxWasOn = platesUnderBoxes(state.room, state.boxes);
  for (const id of ascending([...plates, ...wasDown])) {
    if (plates.includes(id) === wasDown.includes(id)) continue;
    const on = plates.includes(id);
    // Down: the operator wins when both arrive. Up: a box was holding it, so the box left.
    const byBox = on ? !stoodOn.includes(id) : boxWasOn.includes(id);
    events.push({ type: 'switchChanged', object: id, on, mode: 'hold', by: byBox ? 'box' : 'step' });
  }
  let switches = ascending([...levers, ...plates, ...filledPorts(state.room, moved.delivered)]);
  const doorsOpenNow = openDoors(state.room, switches, state.unlocked, taken);

  // Doors and triggers fire on the tick the operator steps onto them, not while standing there;
  // a locked door that opens while the operator is pressed against it counts as stepped onto.
  const onNow = touchedObjects(state.room, body);
  const roomEvents: DomainEvent[] = [];
  for (const o of onNow) {
    const opened = o.kind === 'Door' && doorsOpenNow.includes(o.id) && !state.doorsOpen.includes(o.id);
    if (state.touching.includes(o.id) && !opened) continue;
    if (o.kind === 'Door') {
      roomEvents.push(doorsOpenNow.includes(o.id)
        ? { type: 'doorEntered', object: o.id, door: o.name, socket: String(o.props['socket']) }
        : { type: 'doorLocked', object: o.id, lock: String(o.props['lock']) });
    } else roomEvents.push({ type: 'triggerEntered', object: o.id, trigger: String(o.props['event']), eventId: String(o.props['eventId']) });
  }
  if (used && used.kind !== 'Switch' && used.kind !== 'Pickup') roomEvents.push(interactionOf(used));
  events.push(...roomEvents);

  // Ids only ever grow, and every loop below runs in id order, so results never depend on
  // where an entity sits in its array.
  let nextId = state.nextId;
  let rng = state.rng;
  const projectiles: Projectile[] = [...state.projectiles];
  if (s.fired) {
    const origin = { x: op.x, y: op.y - 4 };
    const dir = aimFrom(op, origin, state.enemies);
    projectiles.push({ id: nextId++, x: origin.x, y: origin.y, vx: dir.x * STAPLER.speed, vy: dir.y * STAPLER.speed, ticksLeft: STAPLE_LIFE });
    events.push({ type: 'fire', weapon: 'stapler' });
  }

  // Zones age before new ones join, so a zone's first tick is its age 1.
  const zones = new Map<number, Zone>(state.zones.map((z) => [z.id, { ...z, age: z.age + 1 }]));
  const newShots: ShotSpec[] = [];
  const newZones: ZoneSpec[] = [];
  const target = { x: op.x, y: op.y };
  const enemies = new Map<number, EnemyState>();
  const ordered = [...state.enemies].sort((a, b) => a.id - b.id);
  for (const e of ordered) {
    if (e.boss && e.phase !== 'closed') {
      const def = state.bosses[e.boss.def]!;
      const summoned = ordered.filter((x) => x.summoner === e.id).length;
      const r = stepCaffeine(e, { grid, def, target, rng, summoned });
      rng = r.rng;
      enemies.set(e.id, r.enemy);
      events.push(...r.events);
      newShots.push(...r.shots);
      newZones.push(...r.zones);
      for (const at of r.summons) {
        const id = nextId++;
        enemies.set(id, enemyFrom(def.summon.enemy, id, at.x, at.y, 0, { summoner: e.id }));
      }
      if (r.powerCut) {
        // The adenosine at his feet piles onto him (design doc 7.4); what clings to the operator stays.
        for (const [id, z] of zones) if (z.owner === e.id) zones.delete(id);
        for (const x of ordered) {
          if (x.summoner === e.id && x.phase === 'idle') enemies.set(x.id, { ...x, phase: 'pinned', phaseTicks: 0, x: r.enemy.x, y: r.enemy.y });
        }
      }
      if (r.powerBack) {
        // They fall off as fluff and reform where they were summoned: the count never drops.
        for (const x of ordered) {
          if (x.summoner === e.id && x.phase === 'pinned') enemies.set(x.id, { ...x, phase: 'dispersed', phaseTicks: 0, x: x.homeX, y: x.homeY });
        }
      }
      continue;
    }
    if (enemies.has(e.id)) continue;
    const r = stepEnemy(grid, e, target, senseRange);
    enemies.set(e.id, r.enemy);
    newShots.push(...r.shots);
    if (r.telegraph) events.push({ type: 'telegraph', source: e.id, tier: 1 });
    if (r.reformed) events.push({ type: 'reformed', target: e.id, enemy: e.type });
    if (r.respawned) events.push({ type: 'respawned', target: e.id, enemy: e.type });
  }
  for (const z of newZones) zones.set(nextId, { ...z, id: nextId++, age: 1, spent: false });
  let shots: Shot[] = [...state.shots, ...newShots.map((sh) => ({ ...sh, id: nextId++, spent: false }))];
  // Within a tick enemies are only added, never removed, so the sorted ids change only with the size.
  let order: number[] = [];
  const byId = (): EnemyState[] => {
    if (order.length !== enemies.size) order = [...enemies.keys()].sort((a, b) => a - b);
    return order.map((id) => enemies.get(id)!);
  };

  // The stamp covers every hittable enemy whose feet are within the radius of the operator's.
  // Only defeatable ones take damage; on the rest it is void, and the gauge is gone either way.
  if (s.stampLanded) {
    events.push({ type: 'stampLanded', x: op.x, y: op.y, radius: STAMP.radiusPx });
    for (const e of byId()) {
      if (!isHittable(e) || Math.hypot(e.x - op.x, e.y - op.y) > STAMP.radiusPx) continue;
      if (e.category !== 'defeatable') {
        events.push({ type: 'stampVoid', target: e.id, enemy: e.type, solution: e.solution ?? '' });
        continue;
      }
      if (!e.boss) {
        enemies.set(e.id, damage(e, STAMP.damage, STAMP.hitFreeze, events));
        continue;
      }
      const def = state.bosses[e.boss.def]!;
      const rejected = proposalOpen(def, e.boss);
      let hit = damage(e, BOSS.stampDamage, 0, events);
      if (rejected && hit.phase !== 'closed') {
        // The proposal is stamped: the move is cancelled and the boss sits under review.
        for (const [id, z] of zones) if (z.owner === e.id) zones.delete(id);
        hit = { ...hit, boss: { ...hit.boss!, move: null, review: BOSS.reviewTicks } };
        events.push({ type: 'proposalRejected', target: e.id });
      }
      enemies.set(e.id, hit);
    }
    // Alcohol crates in reach take the grey stamp like any immune object; one note for the dock.
    const f = state.factory;
    if (f && crateTiles(room, f.waiting).some((t) => Math.hypot((t.col + 0.5) * TILE - op.x, (t.row + 0.5) * TILE - op.y) <= STAMP.radiusPx)) {
      events.push({ type: 'stampVoid', target: linesOf(room).receiving!.id, enemy: ALCOHOL_CRATE, solution: f.solution });
    }
  }

  // Staples: move, pin a lever they reach (design doc 6.1 shoots far switches), stop at walls,
  // hit the lowest-id hittable enemy they overlap. Levers come before walls because they are
  // usually mounted on one. A staple only ever turns a lever on: held fire would otherwise flick
  // it on and off six times a second.
  const flying: Projectile[] = [];
  for (const p0 of projectiles.sort((a, b) => a.id - b.id)) {
    const p = { ...p0, x: p0.x + p0.vx, y: p0.y + p0.vy, ticksLeft: p0.ticksLeft - 1 };
    if (p.ticksLeft < 0) continue;
    const box = centeredBox(p.x, p.y, STAPLE_HALF, STAPLE_HALF);
    const lever = leverAt(state.room, box);
    if (lever) {
      // A crate may sit on a lever (only doors and the like are kept clear), and then it takes the staple.
      // Only a crate over the lever itself counts: one beside it must not eat a staple that grazes it.
      const leverBox = objectBox(lever);
      const covers = (t: Box) => overlaps(box, t) && overlaps(leverBox, t);
      const crated = boxes.some((b) => covers(tileBox(b)) || (b.carried === true && b.from !== undefined && covers(tileBox(b.from))));
      if (!crated && !switches.includes(lever.id)) {
        switches = ascending([...switches, lever.id]);
        events.push({ type: 'switchChanged', object: lever.id, on: true, mode: 'toggle', by: 'staple' });
      }
      continue;
    }
    const col = Math.floor(p.x / TILE);
    const row = Math.floor(p.y / TILE);
    if (state.factory && crateOnTile(room, state.factory.waiting, col, row)) {
      // An alcohol crate only wobbles (design doc 7.7): the bounce of an immune object, never a hit.
      events.push({ type: 'immuneBounce', target: linesOf(room).receiving!.id, enemy: ALCOHOL_CRATE, solution: state.factory.solution });
      continue;
    }
    if (isSolid(grid, col, row)) continue;
    const target = byId().find((e) => isHittable(e) && overlaps(box, enemyHurtbox(e)));
    if (!target) { flying.push(p); continue; }
    if (target.category === 'immune') {
      // No hit-stop and no damage: the flag decides, not a large health pool (design doc 5.1, 5.5).
      events.push({ type: 'immuneBounce', target: target.id, enemy: target.type, solution: target.solution ?? '' });
    } else if (target.category === 'reforming') {
      enemies.set(target.id, { ...target, phase: 'dispersed', phaseTicks: 0, frozen: 0 });
      events.push({ type: 'dispersed', target: target.id, enemy: target.type });
      op = charge(op, GAUGE.staple, state.p, events);
    } else {
      op = charge(op, GAUGE.staple, state.p, events);
      enemies.set(target.id, damage(target, STAPLER.damage, ENEMY_HIT_FREEZE, events));
    }
  }

  // A closed boss stops attacking at once: its shots and areas go with it. A closed ordinary
  // enemy's shot already in the air still flies.
  const closed = new Set(byId().filter((e) => e.boss && e.phase === 'closed').map((e) => e.id));
  for (const [id, z] of zones) if (closed.has(z.owner)) zones.delete(id);
  shots = shots.filter((sh) => !closed.has(sh.owner));

  // Hits on the operator: at most one lands per tick. Strikes, then shots, then areas, each in
  // id order. Dodge i-frames absorb any of them; the first six i-frames make it perfect.
  let freeze = 0;
  const hurt = boxAt(OPERATOR_HURT, op.x, op.y);
  const absorb = (source: number, halves: number, from: Vec, cause: string): 'dodged' | 'ignored' | 'hit' => {
    const a = op.action;
    if (inDodgeIframes(a)) {
      if (a.frame <= DODGE.perfectLast && !a.perfect) {
        op = { ...op, action: { ...a, perfect: true } };
        events.push({ type: 'perfectDodge', source });
        op = charge(op, GAUGE.perfectDodge, state.p, events);
      }
      return 'dodged';
    }
    if (isInvincible(op, now) || freeze > 0) return 'ignored';
    op = hurtOperator(op, halves, from, now);
    freeze = HURT.freezeTicks;
    events.push({ type: 'heartLost', halves, cause });
    return 'hit';
  };
  const typeOf = (id: number) => enemies.get(id)?.type ?? 'unknown';

  for (const e of byId()) {
    if (!isMelee(e) || e.phase !== 'strike' || e.strikeSpent || e.frozen > 0 || !overlaps(strikeBox(e), hurt)) continue;
    if (absorb(e.id, 1, { x: e.x, y: e.y }, e.type) !== 'ignored') enemies.set(e.id, { ...e, strikeSpent: true });
  }

  const movedShots: Shot[] = [];
  for (const sh0 of shots.sort((a, b) => a.id - b.id)) {
    const sh = { ...sh0, x: sh0.x + sh0.vx, y: sh0.y + sh0.vy, ticksLeft: sh0.ticksLeft - 1 };
    if (sh.ticksLeft < 0 || isSolid(grid, Math.floor(sh.x / TILE), Math.floor(sh.y / TILE))) continue;
    if (!sh.spent && overlaps(shotBox(sh), hurt)) {
      const r = absorb(sh.owner, sh.halves, { x: sh.x - sh.vx, y: sh.y - sh.vy }, typeOf(sh.owner));
      if (r === 'hit') continue;
      if (r === 'dodged') { movedShots.push({ ...sh, spent: true }); continue; }
    }
    movedShots.push(sh);
  }

  for (const z of [...zones.values()].sort((a, b) => a.id - b.id)) {
    if (!z.spent && zoneLive(z) && circleTouchesBox(z.x, z.y, z.radius, hurt)) {
      if (absorb(z.owner, z.halves, { x: z.x, y: z.y }, typeOf(z.owner)) !== 'ignored') zones.set(z.id, { ...z, spent: true });
    }
    if (!zoneContinues(zones.get(z.id)!)) zones.delete(z.id);
  }

  // Acetaldehyde fog (design doc 7.7) is a place, not an attack: a dodge does not pass through it,
  // and it neither knocks back nor freezes. Only taking the crate to the second line clears it.
  let factory = state.factory;
  if (factory) {
    const inFog = boxes.some((b) => isSpawnedCrate(b) && circleTouchesBox(boxCentre(b).x, boxCentre(b).y, MIST.radiusPx, hurt));
    let mist = inFog ? factory.mist + 1 : 0;
    if (mist >= MIST.intervalTicks) {
      mist = 0;
      op = { ...op, halves: op.halves - MIST.halves };
      events.push({ type: 'heartLost', halves: MIST.halves, cause: 'acetaldehyde' });
    }
    if (mist !== factory.mist) factory = { ...factory, mist };
  }

  // Clinging: at most one enemy latches on per tick, and never through i-frames, so a dodge
  // through a crowd is still the answer. Reaching the cap is a forced nap (design doc 5.5); in
  // an exam fight it fails the current question instead, which arrives with the exam fight.
  let clock = state.clock;
  let carried = state.carried;
  // Under a full cloak they cannot see the operator, so they do not grab either (design doc 7.4).
  if (!isInvincible(op, now) && senseRange > 0) {
    const body = boxAt(OPERATOR_BODY, op.x, op.y);
    const clinger = byId().find((e) => e.clings && e.phase === 'idle' && e.frozen === 0 && overlaps(enemyHurtbox(e), body));
    if (clinger) {
      enemies.set(clinger.id, { ...clinger, phase: 'attached', phaseTicks: 0 });
      const stacks = stackCount(enemies.values(), carried);
      events.push({ type: 'clung', target: clinger.id, enemy: clinger.type, stacks });
      if (stacks >= CLING.maxStacks) {
        // The stacks go home and reform there: the nap clears the stacks, not the adenosine.
        for (const e of byId()) enemies.set(e.id, stackHome(e));
        carried = 0;
        clock = advance(clock, CLING.napMinutes);
        events.push({ type: 'forcedNap', minutes: CLING.napMinutes });
      }
    }
  }
  op = withStacks(op, enemies.values(), carried);

  const next: GameState = {
    ...state, tick: now + 1, rng, clock, operator: op, enemies: byId(), projectiles: flying,
    shots: movedShots, zones: [...zones.values()].sort((a, b) => a.id - b.id), nextId, freeze,
    // What the door check saw, not a fresh count: a lever pinned by a staple after the check must
    // still count as newly opened next tick for an operator already pressed against its door.
    touching: onNow.map((o) => o.id), carried, switches, doorsOpen: doorsOpenNow, taken, boxes, push, delivered: moved.delivered,
    ...(factory ? { factory } : {}),
  };
  // A forced leave clears the freeze, so the freeze event is only emitted when it will happen.
  if (op.halves <= 0) {
    // The room is already reset by now, so a door, trigger or bed touched on the lethal tick would
    // be read against the wrong place and state; dying wins.
    const settled = events.filter((e) => !roomEvents.includes(e));
    settled.push({ type: 'forcedLeave' });
    return { state: forcedLeave(next), events: settled };
  }
  if (freeze > 0) events.push({ type: 'freeze', frames: freeze });
  return { state: next, events };
}

export const selectOperator = (s: GameState): Readonly<OperatorState> => s.operator;
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
/** The NPC, bed, pickup or toggle switch the interact key would use right now, for the HUD prompt; same rule as the key. */
export function selectInteractable(s: GameState): { readonly object: number; readonly kind: string } | undefined {
  if (s.operator.action.kind !== 'free') return undefined;
  const o = reachableObject(s.room, boxAt(OPERATOR_BODY, s.operator.x, s.operator.y), s.operator, s.taken);
  return o ? { object: o.id, kind: o.kind } : undefined;
}
/** Every locked door of the room and whether it is open now, by the same rule the step uses. */
export function selectDoorLocks(s: GameState): readonly { readonly object: number; readonly lock: string; readonly open: boolean }[] {
  return s.room.objects.filter((o) => o.kind === 'Door' && o.props['lock'] !== 'none')
    .map((o) => ({ object: o.id, lock: String(o.props['lock']), open: doorOpen(s.room.objects, o, s.switches, s.unlocked, s.taken) }));
}
/** Every pickup of the room and whether it is still there to take. */
export function selectPickups(s: GameState): readonly { readonly object: number; readonly itemType: string; readonly present: boolean }[] {
  return s.room.objects.filter((o) => o.kind === 'Pickup')
    .map((o) => ({ object: o.id, itemType: String(o.props['itemType']), present: !s.taken.includes(o.id) }));
}
/** Every switch of the room and whether it is on. */
export function selectSwitches(s: GameState): readonly { readonly object: number; readonly mode: string; readonly on: boolean }[] {
  return s.room.objects.filter((o) => o.kind === 'Switch').map((o) => ({ object: o.id, mode: String(o.props['mode']), on: s.switches.includes(o.id) }));
}
/** Every box with where to draw it now (the top-left of its tile, part way along a slide). */
export function selectBoxes(s: GameState): readonly { readonly object: number; readonly boxType: string; readonly x: number; readonly y: number }[] {
  return s.boxes.map((b) => {
    const o = s.room.objects.find((x) => x.id === b.id);
    return { object: b.id, boxType: b.boxType ?? String(o?.props['boxType'] ?? 'crate'), ...boxPixel(b) };
  });
}
/** The factory for drawing it: the dock and the crates on it, the second line, and whether the operator is in the fog. */
export function selectFactory(s: GameState): {
  readonly receiving: RoomObject; readonly intake: RoomObject | undefined; readonly crates: readonly Tile[]; readonly inFog: boolean;
} | undefined {
  const f = s.factory;
  const lines = linesOf(s.room);
  if (!f || !lines.receiving) return undefined;
  const hurt = boxAt(OPERATOR_HURT, s.operator.x, s.operator.y);
  const inFog = s.boxes.some((b) => isSpawnedCrate(b) && circleTouchesBox(boxCentre(b).x, boxCentre(b).y, MIST.radiusPx, hurt));
  return { receiving: lines.receiving, intake: lines.intake, crates: crateTiles(s.room, f.waiting), inFog };
}
/** The room's port, if any, with how many boxes it holds of the ones it needs. */
export function selectPort(s: GameState): { readonly object: number; readonly count: number; readonly need: number } | undefined {
  const port = portOf(s.room);
  return port ? { object: port.id, count: s.delivered.length, need: Number(port.props['need']) } : undefined;
}
/** Every conveyor and whether it runs now, by the rule the step uses. */
export function selectConveyors(s: GameState): readonly { readonly object: number; readonly direction: string; readonly speed: string; readonly running: boolean }[] {
  return conveyorsOf(s.room).map((o) => ({
    object: o.id, direction: String(o.props['direction']), speed: String(o.props['speed']), running: conveyorRunning(s.room.objects, o, s.switches),
  }));
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
  readonly residue: number;
  readonly boostMin: number;
  readonly defeated: boolean;
}

/** The room's boss for the nameplate, or undefined in a room without one. */
export function selectBoss(s: GameState): BossSummary | undefined {
  const e = s.enemies.find((x) => x.boss);
  if (!e?.boss) return undefined;
  return {
    id: e.id, type: e.type, budget: e.hp, maxBudget: e.maxHp, stage: e.boss.stage, residue: e.boss.residue,
    boostMin: s.bosses[e.boss.def]!.boostMin, defeated: e.phase === 'closed',
  };
}
