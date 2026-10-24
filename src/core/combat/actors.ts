import { boxAt, centeredBox, type Box } from '../collision/boxes.ts';
import { moveAndCollide, type Body, type SolidGrid } from '../collision/grid.ts';
import type { Archetype, Category } from './enemies.ts';
import { CLING, REFORM_TICKS, SALESMAN } from './frames.ts';
import type { Vec } from './movement.ts';

/**
 * Enemy runtime state. Behaviour is a pure function of (state, what it perceives); the salesman
 * here is the S9 prototype of the archetype (approach, 0.5 s tier-1 telegraph, short strike),
 * and other archetypes stand still until P4.
 *
 * Phases: idle, windup (telegraph), strike (hitbox live), recover; dispersed is a reforming
 * enemy waiting to reform; closed is a defeatable enemy whose case is closed; attached is a
 * clinging enemy riding on the operator as one slow stack.
 */
export type EnemyPhase = 'idle' | 'windup' | 'strike' | 'recover' | 'dispersed' | 'closed' | 'attached';

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
}

export const ENEMY_BODY: Body = { halfW: 7, height: 10 };
export const ENEMY_HURT: Body = { halfW: 9, height: 16 };

export const isHittable = (e: EnemyState): boolean => e.phase !== 'dispersed' && e.phase !== 'closed' && e.phase !== 'attached';

export const enemyHurtbox = (e: EnemyState): Box => boxAt(ENEMY_HURT, e.x, e.y);

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
}

export function stepEnemy(grid: SolidGrid, e0: EnemyState, target: Vec): EnemyStep {
  const out = (enemy: EnemyState, flags: Partial<Omit<EnemyStep, 'enemy'>> = {}): EnemyStep =>
    ({ enemy, telegraph: false, reformed: false, respawned: false, ...flags });
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
      return out(e);
    default:
      break;
  }
  if (e.clings) {
    // Contact and the stack it adds are resolved in game.ts, which knows the operator's i-frames.
    const dx = target.x - e.x;
    const dy = target.y - e.y;
    const d = Math.hypot(dx, dy);
    if (d === 0 || d > CLING.senseRangePx) return out(e);
    const m = moveAndCollide(grid, ENEMY_BODY, e.x, e.y, (dx / d) * CLING.driftSpeed, (dy / d) * CLING.driftSpeed);
    return out({ ...e, x: m.x, y: m.y });
  }
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
