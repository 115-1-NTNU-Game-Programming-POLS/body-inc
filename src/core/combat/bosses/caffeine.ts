import { moveAndCollide, type SolidGrid } from '../../collision/grid.ts';
import type { DomainEvent } from '../../game.ts';
import { drawFloat, type RngStreams } from '../../rng.ts';
import { TICK_HZ } from '../../time.ts';
import { BOSS_BODY, type EnemyState } from '../actors.ts';
import type { ShotSpec, ZoneSpec } from '../hazards.ts';
import type { Vec } from '../movement.ts';
import { bossMove, boostFactor, moveLength, type BossDef, type BossMoveDef, type BossState } from './boss.ts';

/**
 * 續杯經理 卡費因 (design doc 7.4), v1. Stage 1: he drinks, and caffeine at or above the boost
 * threshold speeds his walking and shortens his rests, so the window to hit back is when the
 * residue is low. Stage 2 (budget at stage2Budget): a burst of cups, from the third on with the
 * tolerant boost, and adenosine summoned at his feet. Stage 3: the first time the residue falls
 * under the threshold after a burst, the adenosine at his feet piles onto him and he cannot act
 * for powerCutSeconds; then he drinks another burst, so the cycle repeats.
 *
 * Telegraphs keep their tier length whatever the caffeine: speed shortens rests, never warnings.
 */
export interface CaffeineContext {
  readonly grid: SolidGrid;
  readonly def: BossDef;
  readonly target: Vec;
  readonly rng: RngStreams;
  /** Enemies this boss summoned that still exist, whatever their phase. */
  readonly summoned: number;
}

export interface BossTick {
  readonly enemy: EnemyState;
  readonly rng: RngStreams;
  readonly shots: readonly ShotSpec[];
  readonly zones: readonly ZoneSpec[];
  readonly summons: readonly Vec[];
  readonly events: readonly DomainEvent[];
  /** The power cut starts: pin the summoned adenosine on him and drop his pending areas. */
  readonly powerCut: boolean;
  /** The power cut ends: the pinned adenosine falls off. */
  readonly powerBack: boolean;
}

/** Offsets of summoned adenosine around his feet, so a pair does not stack on one point. */
const SUMMON_OFFSETS: readonly Vec[] = [{ x: -24, y: 14 }, { x: 24, y: 14 }, { x: -12, y: 26 }, { x: 12, y: 26 }];

function pick(def: BossDef, rng: RngStreams): [BossMoveDef, RngStreams] {
  const total = def.moves.reduce((s, m) => s + m.weight, 0);
  const [f, next] = drawFloat(rng, 'enemies');
  let r = f * total;
  for (const m of def.moves) {
    r -= m.weight;
    if (r < 0) return [m, next];
  }
  return [def.moves[def.moves.length - 1]!, next];
}

/** Tier-1 shots fan around the aim, centred on it. */
function throwShots(e: EnemyState, m: BossMoveDef, target: Vec): ShotSpec[] {
  const ox = e.x;
  const oy = e.y - 4;
  const base = Math.atan2(target.y - 4 - oy, target.x - ox);
  return Array.from({ length: m.shots }, (_, i) => {
    const a = base + (i - (m.shots - 1) / 2) * m.spreadRad;
    return {
      owner: e.id, kind: 'cup', x: ox, y: oy, vx: Math.cos(a) * m.shotSpeed, vy: Math.sin(a) * m.shotSpeed,
      ticksLeft: m.shotTicks, halves: m.halves, half: 3,
    };
  });
}

export function stepCaffeine(e: EnemyState, ctx: CaffeineContext): BossTick {
  const { def, target } = ctx;
  let rng = ctx.rng;
  const shots: ShotSpec[] = [];
  const zones: ZoneSpec[] = [];
  const summons: Vec[] = [];
  const events: DomainEvent[] = [];
  let powerCut = false;
  let powerBack = false;
  let x = e.x;
  let y = e.y;

  const b0 = e.boss!;
  const residue = b0.residue * def.decayPerTick;
  let b: BossState = { ...b0, residue, boosted: b0.boosted || residue >= def.boostMin };
  const done = (): BossTick => ({ enemy: { ...e, x, y, boss: b }, rng, shots, zones, summons, events, powerCut, powerBack });

  if (b.review > 0) {
    b = { ...b, review: b.review - 1 };
    return done();
  }
  if (b.stunned > 0) {
    b = { ...b, stunned: b.stunned - 1 };
    if (b.stunned === 0) {
      powerBack = true;
      b = { ...b, burst: def.burstCups, rest: def.restTicks };
    }
    return done();
  }

  if (b.stage === 1 && e.hp <= def.stage2Budget) {
    b = { ...b, stage: 2, burst: def.burstCups, summonIn: 0 };
    events.push({ type: 'bossStage', target: e.id, stage: 2 });
  }
  // A drink in progress finishes first; the cut comes once its cup has failed to keep him up.
  if (b.stage >= 2 && b.burst === 0 && b.boosted && b.residue < def.boostMin && b.move?.id !== 'drink') {
    b = { ...b, stage: 3, stunned: def.powerCutTicks, move: null, boosted: false };
    powerCut = true;
    events.push({ type: 'powerCut', target: e.id, seconds: def.powerCutTicks / TICK_HZ });
    return done();
  }

  b = { ...b, lowTicks: b.residue < def.boostMin ? b.lowTicks + 1 : 0, summonIn: b.stage >= 2 ? Math.max(0, b.summonIn - 1) : 0 };
  const factor = boostFactor(def, b);

  if (b.move) {
    const frame = b.move.frame + 1;
    const restAfter = () => Math.round(def.restTicks / boostFactor(def, b));
    if (b.move.id === 'drink') {
      if (frame >= def.drinkTicks) {
        b = { ...b, residue: b.residue + def.cup, cups: b.cups + 1, burst: Math.max(0, b.burst - 1), move: null, lowTicks: 0 };
        b = { ...b, boosted: b.boosted || b.residue >= def.boostMin, rest: restAfter() };
        events.push({ type: 'bossDrink', target: e.id, residue: b.residue, cups: b.cups });
      } else b = { ...b, move: { id: 'drink', frame } };
      return done();
    }
    if (b.move.id === 'summon') {
      if (frame >= def.summon.ticks) {
        const n = Math.min(def.summon.count, def.summon.max - ctx.summoned);
        for (let i = 0; i < n; i++) {
          const o = SUMMON_OFFSETS[i % SUMMON_OFFSETS.length]!;
          summons.push({ x: e.x + o.x, y: e.y + o.y });
        }
        b = { ...b, move: null, summonIn: def.summon.everyTicks, rest: restAfter() };
        if (n > 0) events.push({ type: 'bossSummon', target: e.id, count: n });
      } else b = { ...b, move: { id: 'summon', frame } };
      return done();
    }
    const m = bossMove(def, b.move.id);
    if (m.tier === 1 && frame === m.telegraphTicks + 1) shots.push(...throwShots(e, m, target));
    b = frame >= moveLength(m) ? { ...b, move: null, rest: restAfter() } : { ...b, move: { id: m.id, frame } };
    return done();
  }

  // Between moves he keeps to his preferred range; caffeine makes him quicker on his feet.
  const dx = target.x - e.x;
  const dy = target.y - e.y;
  const d = Math.hypot(dx, dy);
  if (d > 0 && (d > def.farPx || d < def.nearPx)) {
    const sign = d > def.farPx ? 1 : -1;
    const m = moveAndCollide(ctx.grid, BOSS_BODY, e.x, e.y, (dx / d) * def.speed * factor * sign, (dy / d) * def.speed * factor * sign);
    x = m.x;
    y = m.y;
  }
  b = { ...b, rest: Math.max(0, b.rest - 1) };
  if (b.rest > 0) return done();

  const stage1Refill = b.stage === 1 && b.residue < def.boostMin && b.lowTicks >= def.refillDelayTicks;
  if (b.burst > 0 || stage1Refill) {
    b = { ...b, move: { id: 'drink', frame: 1 } };
  } else if (b.stage >= 2 && b.summonIn === 0 && ctx.summoned < def.summon.max) {
    b = { ...b, move: { id: 'summon', frame: 1 } };
  } else {
    let m: BossMoveDef;
    [m, rng] = pick(def, rng);
    b = { ...b, move: { id: m.id, frame: 1 } };
    events.push({ type: 'telegraph', source: e.id, tier: m.tier, move: m.id });
    if (m.tier !== 1) {
      const at = m.tier === 2 ? target : { x, y };
      zones.push({
        owner: e.id, move: m.id, tier: m.tier, x: at.x, y: at.y, radius: m.radius,
        telegraphTicks: m.telegraphTicks, activeTicks: m.activeTicks, halves: m.halves,
      });
    }
  }
  return done();
}

/** True while the boss shows a tier-3 proposal, which a landing stamp rejects (design doc 5.4). */
export function proposalOpen(def: BossDef, b: BossState): boolean {
  if (!b.move || b.move.id === 'drink' || b.move.id === 'summon') return false;
  const m = bossMove(def, b.move.id);
  return m.tier === 3 && b.move.frame <= m.telegraphTicks;
}
