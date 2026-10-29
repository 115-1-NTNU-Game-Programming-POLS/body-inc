import { centeredBox, type Box } from '../collision/boxes.ts';

/**
 * Enemy attacks that outlive the tick they start on. A shot is a thrown object (flyer sheet,
 * coffee cup); a zone is a ground area with a tier-2 or tier-3 telegraph that goes live once the
 * telegraph has run (design doc 5.3). Both hurt the operator only; staples are separate.
 */
export interface Shot {
  readonly id: number;
  readonly owner: number;
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly ticksLeft: number;
  readonly halves: number;
  /** A toast wave (design doc 7.7): landing adds this many cups instead of costing hearts, and the guard refuses it. */
  readonly cups?: number;
  /** The shots of one ring share this, so the ring lands at most one cup or one refusal however many of it touch the operator. */
  readonly wave?: number;
  /** Half the side of the shot's box. */
  readonly half: number;
  /** Dodged through: it flies on but can no longer hurt. */
  readonly spent: boolean;
}

/**
 * `age` is the zone's frame, counted like action frames: the tick it appears is age 1. Ages 1 to
 * telegraphTicks warn, the next activeTicks are live, and then it is gone.
 */
export interface Zone {
  readonly id: number;
  readonly owner: number;
  readonly move: string;
  readonly tier: 2 | 3;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly telegraphTicks: number;
  readonly activeTicks: number;
  readonly halves: number;
  readonly age: number;
  readonly spent: boolean;
}

export type ShotSpec = Omit<Shot, 'id' | 'spent'>;
export type ZoneSpec = Omit<Zone, 'id' | 'age' | 'spent'>;

export const shotBox = (s: Shot): Box => centeredBox(s.x, s.y, s.half, s.half);

export const zoneLive = (z: Zone): boolean => z.age > z.telegraphTicks && z.age <= z.telegraphTicks + z.activeTicks;

/** True while the zone still has a tick to run after this one. */
export const zoneContinues = (z: Zone): boolean => z.age < z.telegraphTicks + z.activeTicks;

/** Telegraph progress from 0 to 1; the view fills the hatch with it. */
export const zoneFill = (z: Zone): number => Math.min(1, z.age / z.telegraphTicks);

/** Strict, like box overlap: a circle that only touches the edge misses. */
export function circleTouchesBox(x: number, y: number, r: number, b: Box): boolean {
  const cx = Math.max(b.left, Math.min(x, b.right));
  const cy = Math.max(b.top, Math.min(y, b.bottom));
  return Math.hypot(cx - x, cy - y) < r;
}
