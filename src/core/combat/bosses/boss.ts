import type { BossFile, Enemy } from '../../content/generated.ts';
import { schemaProblems } from '../../content/read.ts';
import { schemaProblemText } from '../../content/schema.ts';
import { TICK_HZ, TILE, tilesPerSecond } from '../../time.ts';
import type { EnemyTable } from '../enemies.ts';
import { TELEGRAPH, ZONE_MAX_ACTIVE } from '../frames.ts';

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

export interface BossDef {
  readonly id: string;
  readonly behaviour: BossFile['behaviour'];
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
  /** Sorted by id, so a weighted draw does not depend on the order of keys in the file. */
  readonly moves: readonly BossMoveDef[];
  readonly cup: number;
  /** Residue multiplier per tick on the boss clock. */
  readonly decayPerTick: number;
  readonly boostMin: number;
  readonly boost: number;
  readonly boostTolerant: number;
}

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
export const RESERVED_MOVES: readonly string[] = ['drink', 'summon'];

function moveProblems(where: string, m: BossFile['moves'][string]): string[] {
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
    if (f.stage2Budget >= f.budget) problems.push(`${where}: stage2Budget must be below budget`);
    const [near, far] = f.rangeTiles as [number, number];
    if (near >= far) problems.push(`${where}: rangeTiles must be [near, far] with near < far`);
    const summoned = enemies.enemies.get(f.summon.enemy);
    if (!summoned) problems.push(`${where}: summon.enemy "${f.summon.enemy}" is not in content/enemies.json`);
    else if (summoned.boss !== undefined) problems.push(`${where}: a boss cannot summon another boss`);
    const ids = Object.keys(f.moves).sort();
    if (ids.length === 0) problems.push(`${where}: needs at least one move`);
    for (const id of ids) problems.push(...moveProblems(`${where} move "${id}"`, f.moves[id]!));
    for (const id of ids.filter((m) => RESERVED_MOVES.includes(m))) problems.push(`${where}: "${id}" is a built-in action, not a move name`);
    if (!summoned) continue;

    out.set(f.id, {
      id: f.id,
      behaviour: f.behaviour,
      budget: f.budget,
      stage2Budget: f.stage2Budget,
      speed: tilesPerSecond(f.speedTiles),
      nearPx: near * TILE,
      farPx: far * TILE,
      restTicks: ticks(f.restSeconds),
      drinkTicks: ticks(f.drink.seconds),
      refillDelayTicks: ticks(f.drink.refillDelaySeconds),
      burstCups: f.drink.burstCups,
      tolerantFromCup: f.drink.tolerantFromCup,
      summon: { enemy: summoned, count: f.summon.count, everyTicks: ticks(f.summon.everySeconds), max: f.summon.max, ticks: ticks(f.summon.seconds) },
      powerCutTicks: ticks(f.powerCutSeconds),
      moves: ids.map((id) => {
        const m = f.moves[id]!;
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
    });
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
export interface BossState {
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

/** The fight opens with a cup (design doc 7.4: each cup he drinks adds 100). */
export function newBossState(def: BossDef): BossState {
  return {
    def: def.id, stage: 1, residue: 0, cups: 0, burst: 1, boosted: false, lowTicks: 0, move: null,
    rest: def.restTicks, review: 0, stunned: 0, summonIn: 0,
  };
}

export function bossMove(def: BossDef, id: string): BossMoveDef {
  const m = def.moves.find((x) => x.id === id);
  if (!m) throw new Error(`boss ${def.id} has no move ${id}`);
  return m;
}

export const moveLength = (m: BossMoveDef): number => m.telegraphTicks + m.activeTicks + m.recoverTicks;

/** Movement and attack-rate factor from caffeine (design doc 7.4); telegraphs never shorten. */
export function boostFactor(def: BossDef, b: BossState): number {
  if (b.residue < def.boostMin) return 1;
  return b.cups >= def.tolerantFromCup ? def.boostTolerant : def.boost;
}
