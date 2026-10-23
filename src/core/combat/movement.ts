import { tilesPerSecond } from '../time.ts';

/** Movement feel numbers from design doc 5.3; content/params.json will own them once S4 lands. */
export const MOVE = {
  maxSpeed: tilesPerSecond(4.5),
  accelTicks: 4,
  stopTicks: 3,
  /** Sum of all visible slow sources is capped here (design doc 5.1). */
  slowCap: 0.15,
} as const;

export interface Vec {
  readonly x: number;
  readonly y: number;
}

export type Facing = 'down' | 'up' | 'left' | 'right';

/** Desired velocity for an 8-way stick input; diagonals are normalized. */
export function desiredVelocity(input: Vec, slows: readonly number[]): Vec {
  const len = Math.hypot(input.x, input.y);
  if (len === 0) return { x: 0, y: 0 };
  const slow = Math.min(MOVE.slowCap, slows.reduce((a, b) => a + b, 0));
  const speed = MOVE.maxSpeed * (1 - slow);
  const k = speed / Math.max(1, len);
  return { x: input.x * k, y: input.y * k };
}

/** Steps velocity toward the desired one: full speed in accelTicks, standstill in stopTicks. */
export function approach(v: Vec, desired: Vec): Vec {
  const dx = desired.x - v.x;
  const dy = desired.y - v.y;
  const dist = Math.hypot(dx, dy);
  const stopping = desired.x === 0 && desired.y === 0;
  const rate = MOVE.maxSpeed / (stopping ? MOVE.stopTicks : MOVE.accelTicks);
  if (dist <= rate + 1e-9) return desired;
  return { x: v.x + (dx / dist) * rate, y: v.y + (dy / dist) * rate };
}

/** Horizontal input wins on exact diagonals so side sprites (with flip) show while strafing. */
export function facingFor(input: Vec, previous: Facing): Facing {
  if (input.x === 0 && input.y === 0) return previous;
  if (Math.abs(input.x) >= Math.abs(input.y)) return input.x < 0 ? 'left' : 'right';
  return input.y < 0 ? 'up' : 'down';
}
