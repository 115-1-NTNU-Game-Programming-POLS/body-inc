import { boxAt, centeredBox, type Box } from '../collision/boxes.ts';
import { moveAndCollide, type Body, type SolidGrid } from '../collision/grid.ts';
import type { BossState } from './bosses/boss.ts';
import type { Archetype, Category } from './enemies.ts';
import { CHEERS, CLING, FLYER, REFORM_TICKS, SALESMAN } from './frames.ts';
import type { ShotSpec } from './hazards.ts';
import type { Vec } from './movement.ts';

/**
 * Enemy runtime state. Behaviour is a pure function of (state, what it perceives). Archetypes
 * with behaviour: salesman (approach, tier-1 telegraph, melee strike), flyer (keep range,
 * tier-1 telegraph, one thrown sheet) and the cheers kid (circle, tier-1 telegraph, one toast
 * wave); the others stand still until their packages. A boss is
 * an enemy with `boss` set, stepped by its controller in combat/bosses instead.
 *
 * Phases: idle, windup (telegraph), strike (melee hitbox live or throw pose), recover; dispersed
 * is a reforming enemy waiting to reform; closed is a defeatable enemy whose case is closed;
 * attached is a clinging enemy riding on the operator as one slow stack; pinned is a summoned
 * enemy piled on its boss during a power cut.
 */
export type EnemyPhase = 'idle' | 'windup' | 'strike' | 'recover' | 'dispersed' | 'closed' | 'attached' | 'pinned';

export interface EnemyState {
  readonly id: number;
  readonly type: string;
  readonly category: Category;
  readonly archetype?: Archetype;
  readonly solution?: string;
  readonly x: number;
  readonly y: number;
  readonly homeX: number;
  readonly homeY: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly phase: EnemyPhase;
  /** Ticks spent in the current phase. */
  readonly phaseTicks: number;
  /** Hit-stop on this enemy only (ENEMY_HIT_FREEZE). */
  readonly frozen: number;
  readonly strikeDir: Vec;
  /** Whether the current strike already landed or was dodged; a strike affects the operator once. */
  readonly strikeSpent: boolean;
  /** Ticks after a case closes before the enemy comes back; 0 means never. */
  readonly respawnTicks: number;
  readonly clings: boolean;
  readonly boss?: BossState;
  /** Id of the boss that summoned this enemy; summoned enemies leave on a forced leave. */
  readonly summoner?: number;
  /** Cheers kid: a weapon has made him back off since his last toast, so the next one cannot. */
  readonly shooed?: true;
}

export const ENEMY_BODY: Body = { halfW: 7, height: 10 };
export const ENEMY_HURT: Body = { halfW: 9, height: 16 };
/** Boss frames are 64 x 64 with about 56 to 60 visible (art direction 5.1). */
export const BOSS_BODY: Body = { halfW: 14, height: 12 };
export const BOSS_HURT: Body = { halfW: 20, height: 44 };

export const isHittable = (e: EnemyState): boolean =>
  e.phase !== 'dispersed' && e.phase !== 'closed' && e.phase !== 'attached' && e.phase !== 'pinned';

export const enemyHurtbox = (e: EnemyState): Box => boxAt(e.boss ? BOSS_HURT : ENEMY_HURT, e.x, e.y);

/** Middle of the hurtbox: soft lock aims here. */
export const enemyCenter = (e: EnemyState): Vec => ({ x: e.x, y: e.y - (e.boss ? BOSS_HURT : ENEMY_HURT).height / 2 });

/** Only melee archetypes have a strike box; a flyer's strike phase is its throwing pose. */
export const isMelee = (e: EnemyState): boolean => e.archetype === 'salesman' && e.boss === undefined;

/** The strike lands in front of the enemy on the ground plane, along the direction locked at windup. */
export function strikeBox(e: EnemyState): Box {
  return centeredBox(e.x + e.strikeDir.x * 18, e.y - 5 + e.strikeDir.y * 14, 12, 9);
}

const to = (e: EnemyState, phase: EnemyPhase, extra: Partial<EnemyState> = {}): EnemyState =>
  ({ ...e, ...extra, phase, phaseTicks: 0 });

/** Four-way, so the telegraph pose (drawn down or side) matches where the hit lands. */
function cardinal(dx: number, dy: number): Vec {
  if (Math.abs(dx) >= Math.abs(dy)) return { x: dx < 0 ? -1 : 1, y: 0 };
  return { x: 0, y: dy < 0 ? -1 : 1 };
}

export interface EnemyStep {
  readonly enemy: EnemyState;
  readonly telegraph: boolean;
  readonly reformed: boolean;
  readonly respawned: boolean;
  readonly shots: readonly ShotSpec[];
}

/** `senseRangePx` is how far a clinging enemy notices the operator; the caffeine cloak lowers it. */
export function stepEnemy(grid: SolidGrid, e0: EnemyState, target: Vec, senseRangePx: number = CLING.senseRangePx): EnemyStep {
  const out = (enemy: EnemyState, flags: Partial<Omit<EnemyStep, 'enemy'>> = {}): EnemyStep =>
    ({ enemy, telegraph: false, reformed: false, respawned: false, shots: [], ...flags });
  if (e0.frozen > 0) return out({ ...e0, frozen: e0.frozen - 1 });
  const e = { ...e0, phaseTicks: e0.phaseTicks + 1 };

  switch (e.phase) {
    case 'dispersed':
      return e.phaseTicks >= REFORM_TICKS ? out(to(e, 'idle'), { reformed: true }) : out(e);
    case 'closed':
      if (e.respawnTicks > 0 && e.phaseTicks >= e.respawnTicks) {
        return out(to(e, 'idle', { x: e.homeX, y: e.homeY, hp: e.maxHp }), { respawned: true });
      }
      return out(e);
    case 'attached':
    case 'pinned':
      return out(e);
    default:
      break;
  }
  if (e.clings) {
    // Contact and the stack it adds are resolved in game.ts, which knows the operator's i-frames.
    const dx = target.x - e.x;
    const dy = target.y - e.y;
    const d = Math.hypot(dx, dy);
    if (d === 0 || d > senseRangePx) return out(e);
    const m = moveAndCollide(grid, ENEMY_BODY, e.x, e.y, (dx / d) * CLING.driftSpeed, (dy / d) * CLING.driftSpeed);
    return out({ ...e, x: m.x, y: m.y });
  }
  if (e.archetype === 'flyer') return stepFlyer(grid, e, target, out);
  if (e.archetype === 'cheers') return stepCheers(grid, e, target, out);
  if (e.archetype !== 'salesman') return out(e);

  switch (e.phase) {
    case 'idle': {
      const dx = target.x - e.x;
      const dy = target.y - e.y;
      const d = Math.hypot(dx, dy);
      if (d <= SALESMAN.reachPx) {
        return out(to(e, 'windup', { strikeDir: cardinal(dx, dy), strikeSpent: false }), { telegraph: true });
      }
      const m = moveAndCollide(grid, ENEMY_BODY, e.x, e.y, (dx / d) * SALESMAN.speed, (dy / d) * SALESMAN.speed);
      return out({ ...e, x: m.x, y: m.y });
    }
    case 'windup':
      return out(e.phaseTicks >= SALESMAN.windupTicks ? to(e, 'strike') : e);
    case 'strike':
      return out(e.phaseTicks >= SALESMAN.strikeTicks ? to(e, 'recover') : e);
    case 'recover':
      return out(e.phaseTicks >= SALESMAN.recoverTicks ? to(e, 'idle') : e);
  }
}

type Out = (enemy: EnemyState, flags?: Partial<Omit<EnemyStep, 'enemy'>>) => EnemyStep;

/**
 * A weapon on a cheers kid only makes him back off for a while (design doc 7.7: 暫時退開), and
 * only once between two toasts: otherwise held stapler fire, a staple every 10 ticks against a
 * 45-tick back-off, would keep him from ever toasting, and refusing is meant to be the only answer.
 * A raised cup is not lowered. Returns the kid unchanged when the weapon does nothing.
 */
export const backOff = (e: EnemyState): EnemyState =>
  e.shooed || e.phase === 'windup' ? e : to(e, 'recover', { strikeSpent: true, shooed: true });

/**
 * Cheers kid: keeps to a ring round the operator and walks round it; once CHEERS.circleTicks have
 * passed since he last backed off and he is on the ring, he raises his cup for the tier-1
 * telegraph and sends a toast wave where the operator stands at release, then backs away. Which
 * way he circles follows his id, so the walk replays the same.
 */
function stepCheers(grid: SolidGrid, e: EnemyState, target: Vec, out: Out): EnemyStep {
  const dx = target.x - e.x;
  const dy = target.y - e.y;
  const d = Math.hypot(dx, dy);
  const walk = (ux: number, uy: number): EnemyState => {
    const m = moveAndCollide(grid, ENEMY_BODY, e.x, e.y, ux * CHEERS.speed, uy * CHEERS.speed);
    return { ...e, x: m.x, y: m.y };
  };
  switch (e.phase) {
    case 'idle': {
      if (d === 0) return out(e);
      if (d > CHEERS.farPx) return out(walk(dx / d, dy / d));
      if (d < CHEERS.nearPx) return out(walk(-dx / d, -dy / d));
      if (e.phaseTicks >= CHEERS.circleTicks) {
        return out(to(e, 'windup', { strikeDir: cardinal(dx, dy), strikeSpent: false }), { telegraph: true });
      }
      const turn = e.id % 2 === 0 ? 1 : -1;
      return out(walk((-dy / d) * turn, (dx / d) * turn));
    }
    case 'windup': {
      if (e.phaseTicks < CHEERS.windupTicks) return out(e);
      const oy = e.y - 4;
      const ax = target.x - e.x;
      const ay = target.y - 4 - oy;
      const len = Math.hypot(ax, ay) || 1;
      const { shooed: _, ...toasted } = e;
      return out(to(toasted, 'strike'), {
        shots: [{
          owner: e.id, kind: 'toast', x: e.x, y: oy, vx: (ax / len) * CHEERS.shotSpeed, vy: (ay / len) * CHEERS.shotSpeed,
          ticksLeft: Math.ceil(CHEERS.shotRangePx / CHEERS.shotSpeed), halves: 0, cups: CHEERS.cupsPerWave, half: CHEERS.shotHalf,
        }],
      });
    }
    case 'strike':
      return out(e.phaseTicks >= CHEERS.throwTicks ? to(e, 'recover') : e);
    case 'recover':
      if (e.phaseTicks >= CHEERS.backOffTicks) return out(to(e, 'idle'));
      return out(d === 0 ? e : walk(-dx / d, -dy / d));
    default:
      return out(e);
  }
}

/**
 * Flyer: backs off inside 3 tiles, closes in beyond 6, and in between raises a sheet for the
 * tier-1 telegraph. The sheet is aimed where the operator is on release, so stepping aside
 * during the warning is not enough on its own; a dodge or a wider step is.
 */
function stepFlyer(grid: SolidGrid, e: EnemyState, target: Vec, out: Out): EnemyStep {
  const dx = target.x - e.x;
  const dy = target.y - e.y;
  const d = Math.hypot(dx, dy);
  switch (e.phase) {
    case 'idle': {
      if (d === 0) return out(e);
      if (d >= FLYER.nearPx && d <= FLYER.farPx) {
        return out(to(e, 'windup', { strikeDir: cardinal(dx, dy), strikeSpent: false }), { telegraph: true });
      }
      const sign = d > FLYER.farPx ? 1 : -1;
      const m = moveAndCollide(grid, ENEMY_BODY, e.x, e.y, (dx / d) * FLYER.speed * sign, (dy / d) * FLYER.speed * sign);
      return out({ ...e, x: m.x, y: m.y });
    }
    case 'windup': {
      if (e.phaseTicks < FLYER.windupTicks) return out(e);
      const ox = e.x;
      const oy = e.y - 4;
      const ax = target.x - ox;
      const ay = target.y - 4 - oy;
      const len = Math.hypot(ax, ay) || 1;
      return out(to(e, 'strike'), {
        shots: [{
          owner: e.id, kind: 'sheet', x: ox, y: oy, vx: (ax / len) * FLYER.shotSpeed, vy: (ay / len) * FLYER.shotSpeed,
          ticksLeft: Math.ceil(FLYER.shotRangePx / FLYER.shotSpeed), halves: FLYER.damageHalves, half: FLYER.shotHalf,
        }],
      });
    }
    case 'strike':
      return out(e.phaseTicks >= FLYER.throwTicks ? to(e, 'recover') : e);
    case 'recover':
      return out(e.phaseTicks >= FLYER.recoverTicks ? to(e, 'idle') : e);
    default:
      return out(e);
  }
}
