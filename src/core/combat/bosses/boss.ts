import type { BossFile, Enemy } from '../../content/generated.ts';
import { schemaProblems } from '../../content/read.ts';
import { schemaProblemText } from '../../content/schema.ts';
import { TICK_HZ, TILE, tilesPerSecond } from '../../time.ts';
import type { Portion } from '../../stomach/mixer.ts';
import type { EnemyTable } from '../enemies.ts';
import { BOSS, TELEGRAPH, ZONE_MAX_ACTIVE } from '../frames.ts';

/**
 * Boss definitions from content/bosses/*.json, resolved into ticks and pixels. The checks here
 * are the design doc's fairness rules made mechanical: every telegraph has its tier's length,
 * and no area stays live longer than the dodge i-frames, so a dodge at the end of any telegraph
 * avoids the move (design doc 5.3). A boss file that breaks one does not load.
 */
export interface BossMoveDef {
  readonly id: string;
  readonly tier: 1 | 2 | 3;
  readonly weight: number;
  readonly telegraphTicks: number;
  /** Tier 1: the single release tick. Tier 2 and 3: ticks the area is live. */
  readonly activeTicks: number;
  readonly recoverTicks: number;
  readonly halves: number;
  readonly shots: number;
  readonly spreadRad: number;
  readonly shotSpeed: number;
  readonly shotTicks: number;
  readonly radius: number;
}

/** The caffeine rules of content/params.json the boss needs (design doc 9.6). */
export interface CaffeineParams {
  readonly cup: number;
  readonly halfLife: number;
  readonly boostMin: number;
  readonly boost: number;
  readonly boostTolerant: number;
  readonly bossSecondsPerHour: number;
}

export interface CaffeineDef {
  readonly behaviour: 'caffeine';
  readonly id: string;
  readonly budget: number;
  readonly stage2Budget: number;
  readonly speed: number;
  readonly nearPx: number;
  readonly farPx: number;
  readonly restTicks: number;
  readonly drinkTicks: number;
  readonly refillDelayTicks: number;
  readonly burstCups: number;
  readonly tolerantFromCup: number;
  readonly summon: { readonly enemy: Enemy; readonly count: number; readonly everyTicks: number; readonly max: number; readonly ticks: number };
  readonly powerCutTicks: number;
  /** Opened by the chapter once his case is closed; optional, since a chapter may end the fight without one. */
  readonly concedeDialogue?: string;
  /** Sorted by id, so a weighted draw does not depend on the order of keys in the file. */
  readonly moves: readonly BossMoveDef[];
  readonly cup: number;
  /** Residue multiplier per tick on the boss clock. */
  readonly decayPerTick: number;
  readonly boostMin: number;
  readonly boost: number;
  readonly boostTolerant: number;
}

/** The toast boss (design doc 7.7): a song of rounds, a ring of toast waves per line, a breath after each round. */
export interface ToastDef {
  readonly behaviour: 'toast';
  readonly id: string;
  readonly budget: number;
  /** Pixels from the operator's feet to his spawn point at which he stops waiting. */
  readonly wakeDistance: number;
  readonly introTicks: number;
  readonly rounds: readonly { readonly lines: number; readonly beatTicks: number }[];
  readonly breathTicks: number;
  readonly breathDamageFactor: number;
  readonly ring: { readonly shots: number; readonly shotSpeed: number; readonly shotTicks: number; readonly cups: number };
  readonly workOrder: { readonly slowPerStack: number; readonly maxStacks: number };
  /** Opened by the chapter when he gives up. */
  readonly concedeDialogue: string;
}

/**
 * The stomach's boss, 報復性宵夜部長 (design doc 7.5): he throws one food box at a time from a dock of the
 * room to the mixer's hopper. A box nobody stops is digested; a box taken in over the mixer's capacity makes
 * it protest with an area around the hopper. The folder's parry sends a box back at him.
 */
export interface SnackDelivery {
  /** From the start of the fight, or of the stage, to the first throw's telegraph. */
  readonly startTicks: number;
  /** From one throw to the next, so the telegraph is part of it. */
  readonly everyTicks: number;
  readonly speed: number;
  readonly portion: Portion;
  readonly halves: number;
  readonly returnDamage: number;
}

/**
 * The third stage (熄燈): the deliveries go on, and a sleep bar of `sleepTicks` fills, standing still for
 * `interruptTicks` each time the mixer finishes one of his boxes. Once it is full, the stamp closes the case
 * while the mixer is empty; nothing else hurts him in this stage.
 */
export interface SnackLightsOut extends SnackDelivery {
  readonly budget: number;
  readonly sleepTicks: number;
  readonly interruptTicks: number;
}

/**
 * Stage 1 is the fields of the def itself, stage 2 (加大份量) is `stage2` and stage 3 (熄燈) is `stage3`; each
 * starts when his budget is at most its `budget`. Before stage 3 no damage takes him below `stage3.budget`.
 */
export interface SnackDef extends SnackDelivery {
  readonly behaviour: 'snack';
  readonly id: string;
  readonly budget: number;
  readonly stage2: SnackDelivery & { readonly budget: number };
  readonly stage3: SnackLightsOut;
  readonly protest: { readonly telegraphTicks: number; readonly activeTicks: number; readonly radius: number; readonly halves: number };
  /** Opened by the chapter once his case is closed; optional, like the caffeine boss's. */
  readonly concedeDialogue?: string;
}

export type BossDef = CaffeineDef | ToastDef | SnackDef;

export type BossTable = ReadonlyMap<string, BossDef>;

export class BossTableError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`boss table is invalid:\n  ${problems.join('\n  ')}`);
    this.problems = problems;
  }
}

const ticks = (seconds: number): number => Math.round(seconds * TICK_HZ);

/** Actions every boss controller runs itself; BossState.move uses these ids beside the move table's. */
export const RESERVED_MOVES: readonly string[] = ['drink', 'summon', 'toast'];

const CAFFEINE_FIELDS = ['stage2Budget', 'speedTiles', 'rangeTiles', 'restSeconds', 'drink', 'summon', 'powerCutSeconds', 'moves'] as const;
const TOAST_FIELDS = ['song', 'workOrder', 'concedeDialogue'] as const;
/** A caffeine boss may also carry concedeDialogue; only these are refused on it. */
const TOAST_ONLY_FIELDS = ['song', 'workOrder'] as const;
const SNACK_FIELDS = ['deliveries', 'stage2', 'stage3', 'protest'] as const;

function moveProblems(where: string, m: NonNullable<BossFile['moves']>[string]): string[] {
  const out: string[] = [];
  const t = ticks(m.telegraphSeconds);
  const area = m.radiusTiles !== undefined || m.activeTicks !== undefined;
  const shot = m.shots !== undefined || m.shotSpeedTiles !== undefined || m.rangeTiles !== undefined || m.spreadDeg !== undefined;
  if (m.tier === 1) {
    if (t !== TELEGRAPH.tier1Ticks) out.push(`${where}: a tier-1 telegraph is 0.5 s, got ${m.telegraphSeconds} s`);
    if (m.shots === undefined || m.shotSpeedTiles === undefined || m.rangeTiles === undefined) out.push(`${where}: a tier-1 move throws shots and needs shots, shotSpeedTiles and rangeTiles`);
    if (area) out.push(`${where}: a tier-1 move has no area`);
    if (m.halves !== 1) out.push(`${where}: a tier-1 hit costs half a heart (halves 1)`);
  } else {
    if (m.tier === 2 && t !== TELEGRAPH.tier2Ticks) out.push(`${where}: a tier-2 telegraph is 0.8 s, got ${m.telegraphSeconds} s`);
    if (m.tier === 3 && (t < TELEGRAPH.tier3MinTicks || t > TELEGRAPH.tier3MaxTicks)) out.push(`${where}: a tier-3 telegraph is 1.2 to 1.5 s, got ${m.telegraphSeconds} s`);
    if (m.radiusTiles === undefined || m.activeTicks === undefined) out.push(`${where}: a tier-${m.tier} move marks an area and needs radiusTiles and activeTicks`);
    if (shot) out.push(`${where}: a tier-${m.tier} move throws no shots`);
    if (m.activeTicks !== undefined && m.activeTicks > ZONE_MAX_ACTIVE) {
      out.push(`${where}: activeTicks ${m.activeTicks} is longer than the ${ZONE_MAX_ACTIVE} dodge i-frames, so a dodge could not avoid it`);
    }
    if (m.tier === 3 && m.halves !== 2) out.push(`${where}: a signature move costs a whole heart (halves 2)`);
  }
  if (m.halves > 3) out.push(`${where}: no single hit takes more than a heart and a half`);
  return out;
}

/** The fields of the other behaviour are refused, so a file never carries numbers nothing reads. */
function fieldProblems(where: string, f: BossFile): string[] {
  const [need, foreign] = f.behaviour === 'caffeine'
    ? [CAFFEINE_FIELDS, [...TOAST_ONLY_FIELDS, ...SNACK_FIELDS]]
    : f.behaviour === 'toast'
      ? [TOAST_FIELDS, [...CAFFEINE_FIELDS, ...SNACK_FIELDS]]
      : [SNACK_FIELDS, [...CAFFEINE_FIELDS, ...TOAST_ONLY_FIELDS]];
  return [
    ...need.filter((k) => f[k] === undefined).map((k) => `${where}: a ${f.behaviour} boss needs ${k}`),
    ...foreign.filter((k) => f[k] !== undefined).map((k) => `${where}: ${k} belongs to another behaviour; a ${f.behaviour} boss does not read it`),
  ];
}

function caffeineDef(f: BossFile, where: string, enemies: EnemyTable, caffeine: CaffeineParams, problems: string[]): CaffeineDef | undefined {
  if (f.stage2Budget! >= f.budget) problems.push(`${where}: stage2Budget must be below budget`);
  const [near, far] = f.rangeTiles as [number, number];
  if (near >= far) problems.push(`${where}: rangeTiles must be [near, far] with near < far`);
  const summoned = enemies.enemies.get(f.summon!.enemy);
  if (!summoned) problems.push(`${where}: summon.enemy "${f.summon!.enemy}" is not in content/enemies.json`);
  else if (summoned.boss !== undefined) problems.push(`${where}: a boss cannot summon another boss`);
  const moves = f.moves!;
  const ids = Object.keys(moves).sort();
  if (ids.length === 0) problems.push(`${where}: needs at least one move`);
  for (const id of ids) problems.push(...moveProblems(`${where} move "${id}"`, moves[id]!));
  for (const id of ids.filter((m) => RESERVED_MOVES.includes(m))) problems.push(`${where}: "${id}" is a built-in action, not a move name`);
  if (!summoned) return undefined;
  return {
    behaviour: 'caffeine',
    id: f.id,
    budget: f.budget,
    stage2Budget: f.stage2Budget!,
    speed: tilesPerSecond(f.speedTiles!),
    nearPx: near * TILE,
    farPx: far * TILE,
    restTicks: ticks(f.restSeconds!),
    drinkTicks: ticks(f.drink!.seconds),
    refillDelayTicks: ticks(f.drink!.refillDelaySeconds),
    burstCups: f.drink!.burstCups,
    tolerantFromCup: f.drink!.tolerantFromCup,
    summon: { enemy: summoned, count: f.summon!.count, everyTicks: ticks(f.summon!.everySeconds), max: f.summon!.max, ticks: ticks(f.summon!.seconds) },
    powerCutTicks: ticks(f.powerCutSeconds!),
    ...(f.concedeDialogue !== undefined ? { concedeDialogue: f.concedeDialogue } : {}),
    moves: ids.map((id) => {
      const m = moves[id]!;
      const speed = tilesPerSecond(m.shotSpeedTiles ?? 1);
      return {
        id, tier: m.tier, weight: m.weight,
        telegraphTicks: ticks(m.telegraphSeconds),
        activeTicks: m.tier === 1 ? 1 : m.activeTicks ?? 1,
        recoverTicks: ticks(m.recoverSeconds),
        halves: m.halves,
        shots: m.shots ?? 0,
        spreadRad: ((m.spreadDeg ?? 0) * Math.PI) / 180,
        shotSpeed: speed,
        shotTicks: Math.ceil(((m.rangeTiles ?? 0) * TILE) / speed),
        radius: (m.radiusTiles ?? 0) * TILE,
      };
    }),
    cup: caffeine.cup,
    decayPerTick: 0.5 ** (1 / (caffeine.halfLife * caffeine.bossSecondsPerHour * TICK_HZ)),
    boostMin: caffeine.boostMin,
    boost: caffeine.boost,
    boostTolerant: caffeine.boostTolerant,
  };
}

function toastDef(f: BossFile, where: string, problems: string[]): ToastDef {
  const song = f.song!;
  const rounds = song.rounds.map((r) => ({ lines: r.lines, beatTicks: ticks(r.beatSeconds) }));
  // Each line telegraphs its wave for the whole tier-1 warning before the next line starts.
  rounds.forEach((r, i) => {
    if (r.beatTicks <= TELEGRAPH.tier1Ticks) problems.push(`${where}: round ${i + 1} beatSeconds must be longer than the 0.5 s tier-1 telegraph`);
  });
  const speed = tilesPerSecond(song.ring.shotSpeedTiles);
  return {
    behaviour: 'toast',
    id: f.id,
    budget: f.budget,
    wakeDistance: song.wakeTiles * TILE,
    introTicks: ticks(song.introSeconds),
    rounds,
    breathTicks: ticks(song.breathSeconds),
    breathDamageFactor: song.breathDamageFactor,
    ring: { shots: song.ring.shots, shotSpeed: speed, shotTicks: Math.ceil((song.ring.rangeTiles * TILE) / speed), cups: song.ring.cups },
    workOrder: { slowPerStack: f.workOrder!.slowPerStack, maxStacks: f.workOrder!.maxStacks },
    concedeDialogue: f.concedeDialogue!,
  };
}

function deliveryOf(d: NonNullable<BossFile['deliveries']>, name: string, where: string, problems: string[]): SnackDelivery {
  const everyTicks = ticks(d.everySeconds);
  if (everyTicks <= TELEGRAPH.tier1Ticks) problems.push(`${where}: ${name}.everySeconds must be longer than the 0.5 s tier-1 telegraph`);
  if (d.halves !== 1) problems.push(`${where}: ${name}.halves: a delivery is a tier-1 hit and costs half a heart (halves 1)`);
  return { startTicks: ticks(d.startSeconds), everyTicks, speed: tilesPerSecond(d.speedTiles), portion: d.portion, halves: d.halves, returnDamage: d.returnDamage };
}

function snackDef(f: BossFile, where: string, problems: string[]): SnackDef {
  const p = f.protest!;
  const one = deliveryOf(f.deliveries!, 'deliveries', where, problems);
  const two = deliveryOf(f.stage2!.deliveries, 'stage2.deliveries', where, problems);
  const three = deliveryOf(f.stage3!.deliveries, 'stage3.deliveries', where, problems);
  if (f.stage2!.budget >= f.budget) problems.push(`${where}: stage2.budget must be below budget`);
  if (f.stage3!.budget >= f.stage2!.budget) problems.push(`${where}: stage3.budget must be below stage2.budget`);
  // The stamp is what closes the case in stage 3, so it has to take the whole of what is left.
  if (f.stage3!.budget > BOSS.stampDamage) problems.push(`${where}: stage3.budget must be at most the stamp's ${BOSS.stampDamage}, or the stamp could not close the case`);
  const telegraphTicks = ticks(p.telegraphSeconds);
  if (telegraphTicks < TELEGRAPH.tier3MinTicks || telegraphTicks > TELEGRAPH.tier3MaxTicks) {
    problems.push(`${where}: protest.telegraphSeconds is a tier-3 telegraph of 1.2 to 1.5 s, got ${p.telegraphSeconds} s`);
  }
  if (p.activeTicks > ZONE_MAX_ACTIVE) {
    problems.push(`${where}: protest.activeTicks ${p.activeTicks} is longer than the ${ZONE_MAX_ACTIVE} dodge i-frames, so a dodge could not avoid it`);
  }
  if (p.halves !== 2) problems.push(`${where}: the protest is his signature move and costs a whole heart (halves 2)`);
  return {
    behaviour: 'snack',
    id: f.id,
    budget: f.budget,
    ...one,
    stage2: { budget: f.stage2!.budget, ...two },
    stage3: { budget: f.stage3!.budget, ...three, sleepTicks: ticks(f.stage3!.sleepSeconds), interruptTicks: ticks(f.stage3!.interruptSeconds) },
    protest: { telegraphTicks, activeTicks: p.activeTicks, radius: p.radiusTiles * TILE, halves: p.halves },
    ...(f.concedeDialogue !== undefined ? { concedeDialogue: f.concedeDialogue } : {}),
  };
}

/** Validates each file against the boss schema and cross-checks it with the enemy table. */
export function loadBossTable(files: readonly unknown[], enemies: EnemyTable, caffeine: CaffeineParams): BossTable {
  const problems: string[] = [];
  const out = new Map<string, BossDef>();
  for (const raw of files) {
    const shape = schemaProblems('boss', raw);
    if (shape.length > 0) {
      problems.push(...shape.map(schemaProblemText));
      continue;
    }
    const f = raw as BossFile;
    const where = `boss "${f.id}"`;
    if (out.has(f.id)) problems.push(`${where}: defined twice`);
    if (![...enemies.enemies.values()].some((e) => e.boss === f.id)) problems.push(`${where}: no enemy in content/enemies.json has boss "${f.id}"`);
    const missing = fieldProblems(where, f);
    problems.push(...missing);
    if (missing.length > 0) continue;
    const def = f.behaviour === 'caffeine' ? caffeineDef(f, where, enemies, caffeine, problems)
      : f.behaviour === 'toast' ? toastDef(f, where, problems) : snackDef(f, where, problems);
    if (def) out.set(f.id, def);
  }
  for (const e of enemies.enemies.values()) {
    if (e.boss !== undefined && !files.some((f) => (f as { id?: unknown }).id === e.boss)) {
      problems.push(`enemy "${e.id}": boss "${e.boss}" has no file in content/bosses`);
    }
  }
  if (problems.length > 0) throw new BossTableError(problems);
  return out;
}

/**
 * A boss's own state beside its EnemyState. `stage` is the fight stage (design doc 7.4), not
 * the enemy phase; `move.frame` counts from 1 on the tick the move starts.
 */
export interface CaffeineState {
  readonly behaviour: 'caffeine';
  readonly def: string;
  readonly stage: 1 | 2 | 3;
  readonly residue: number;
  readonly cups: number;
  /** Cups still to drink back to back before anything else. */
  readonly burst: number;
  /** The residue reached the boost threshold since the last power cut. */
  readonly boosted: boolean;
  /** Ticks the residue has been under the boost threshold. */
  readonly lowTicks: number;
  readonly move: { readonly id: string; readonly frame: number } | null;
  readonly rest: number;
  readonly review: number;
  readonly stunned: number;
  readonly summonIn: number;
}

/**
 * The toast boss's place in the song. `stage` is the round (乾杯三巡), held at the last once the
 * song repeats; `ticks` counts within the part, or within the line while singing.
 */
export interface ToastState {
  readonly behaviour: 'toast';
  readonly def: string;
  readonly stage: 1 | 2 | 3;
  /** `wait` until the operator comes within wakeDistance, then `intro` for introTicks. */
  readonly part: 'wait' | 'intro' | 'sing' | 'breath';
  /** Lines sung so far this round. */
  readonly line: number;
  readonly ticks: number;
  /** Waves sent so far: the id that ties a ring's shots together. */
  readonly waves: number;
  /** The line being telegraphed, so the view can raise the bubble; null between waves and while breathing. */
  readonly move: { readonly id: 'toast'; readonly frame: number } | null;
}

/**
 * The snack boss's place in his rhythm. `ticks` counts from the start of the fight or the last throw;
 * `dock` is the index of the dock he calls next (docks in id order); `move` is set for the tier-1
 * telegraph before a throw, with the dock being called, so the view can flash it.
 */
export interface SnackState {
  readonly behaviour: 'snack';
  readonly def: string;
  readonly stage: 1 | 2 | 3;
  readonly ticks: number;
  readonly dock: number;
  /** Boxes thrown in this stage; the first of a stage waits `startTicks`, the rest `everyTicks`. */
  readonly stageThrown: number;
  readonly move: { readonly id: 'deliver'; readonly frame: number } | null;
  /** The sleep bar of stage 3, absent before it. */
  readonly sleep?: SnackSleep;
}

export interface SnackSleep {
  /** Ticks filled, up to the def's `stage3.sleepTicks`; it never goes back. */
  readonly slept: number;
  /** Ticks the bar still stands still after the mixer finished a box. */
  readonly hold: number;
  /** Times the mixer has interrupted it. */
  readonly wakes: number;
}

export type BossState = CaffeineState | ToastState | SnackState;

/** The caffeine fight opens with a cup (design doc 7.4: each cup he drinks adds 100); the toast fight with him waiting. */
export function newBossState(def: BossDef): BossState {
  if (def.behaviour === 'snack') return { behaviour: 'snack', def: def.id, stage: 1, ticks: 0, dock: 0, stageThrown: 0, move: null };
  if (def.behaviour === 'toast') return { behaviour: 'toast', def: def.id, stage: 1, part: 'wait', line: 0, ticks: 0, waves: 0, move: null };
  return {
    behaviour: 'caffeine', def: def.id, stage: 1, residue: 0, cups: 0, burst: 1, boosted: false, lowTicks: 0, move: null,
    rest: def.restTicks, review: 0, stunned: 0, summonIn: 0,
  };
}

/** Strings the nameplate shows for a boss enemy: its name, a label per stage and, for toast, the breath. */
export function bossStringKeys(enemyType: string, def: BossDef): string[] {
  const stages = def.behaviour === 'toast' ? def.rounds.length : 3;
  return [
    `boss.${enemyType}.name`,
    ...Array.from({ length: stages }, (_, i) => `boss.${enemyType}.stage.${i + 1}`),
    ...(def.behaviour === 'toast' ? [`boss.${enemyType}.breath`] : []),
  ];
}

export function bossMove(def: CaffeineDef, id: string): BossMoveDef {
  const m = def.moves.find((x) => x.id === id);
  if (!m) throw new Error(`boss ${def.id} has no move ${id}`);
  return m;
}

export const moveLength = (m: BossMoveDef): number => m.telegraphTicks + m.activeTicks + m.recoverTicks;

/** Movement and attack-rate factor from caffeine (design doc 7.4); telegraphs never shorten. */
export function boostFactor(def: CaffeineDef, b: CaffeineState): number {
  if (b.residue < def.boostMin) return 1;
  return b.cups >= def.tolerantFromCup ? def.boostTolerant : def.boost;
}
