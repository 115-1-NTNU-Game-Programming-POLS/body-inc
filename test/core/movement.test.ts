import { describe, expect, it } from 'vitest';
import { approach, desiredVelocity, facingFor, MOVE, type Vec } from '../../src/core/combat/movement.ts';

const speed = (v: Vec) => Math.hypot(v.x, v.y);
const run = (from: Vec, input: Vec, ticks: number): Vec => {
  let v = from;
  for (let i = 0; i < ticks; i++) v = approach(v, desiredVelocity(input, []));
  return v;
};

describe('operator movement (design doc 5.3)', () => {
  it('max speed is 4.5 tiles per second', () => {
    expect(MOVE.maxSpeed * 60 / 32).toBeCloseTo(4.5, 10);
  });

  it('reaches full speed in exactly 4 ticks', () => {
    expect(speed(run({ x: 0, y: 0 }, { x: 1, y: 0 }, 3))).toBeLessThan(MOVE.maxSpeed - 1e-6);
    expect(speed(run({ x: 0, y: 0 }, { x: 1, y: 0 }, 4))).toBeCloseTo(MOVE.maxSpeed, 10);
  });

  it('stops in exactly 3 ticks after release', () => {
    const full = { x: MOVE.maxSpeed, y: 0 };
    expect(speed(run(full, { x: 0, y: 0 }, 2))).toBeGreaterThan(0);
    expect(speed(run(full, { x: 0, y: 0 }, 3))).toBe(0);
  });

  it('normalizes diagonals', () => {
    expect(speed(desiredVelocity({ x: 1, y: 1 }, []))).toBeCloseTo(MOVE.maxSpeed, 10);
  });

  it('caps the sum of slow sources at 15%', () => {
    expect(speed(desiredVelocity({ x: 1, y: 0 }, [0.05]))).toBeCloseTo(MOVE.maxSpeed * 0.95, 10);
    expect(speed(desiredVelocity({ x: 1, y: 0 }, [0.1, 0.1, 0.1]))).toBeCloseTo(MOVE.maxSpeed * 0.85, 10);
  });

  it('keeps facing when idle and prefers side facing on diagonals', () => {
    expect(facingFor({ x: 0, y: 0 }, 'up')).toBe('up');
    expect(facingFor({ x: -1, y: 1 }, 'down')).toBe('left');
    expect(facingFor({ x: 0, y: -1 }, 'down')).toBe('up');
  });
});
