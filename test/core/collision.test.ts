import { describe, expect, it } from 'vitest';
import { bodyOverlapsSolid, moveAndCollide, type SolidGrid } from '../../src/core/collision/grid.ts';

const BODY = { halfW: 7, height: 10 };

/** '#' is solid, '.' is floor. */
function grid(rows: string[]): SolidGrid {
  return { cols: rows[0]!.length, rows: rows.length, solid: rows.join('').split('').map((c) => c === '#') };
}

const box = grid(['#####', '#...#', '#...#', '#...#', '#####']);

describe('core collision', () => {
  it('a body flush against a wall does not overlap it', () => {
    expect(bodyOverlapsSolid(box, BODY, 32 + 7, 64)).toBe(false);
    expect(bodyOverlapsSolid(box, BODY, 32 + 6.99, 64)).toBe(true);
  });

  it('moving diagonally into a corner stops flush on both axes', () => {
    const r = moveAndCollide(box, BODY, 80, 80, 200, 200);
    expect(r).toEqual({ x: 128 - 7, y: 128, blockedX: true, blockedY: true });
  });

  it('moving away from a wall is not blocked', () => {
    const r = moveAndCollide(box, BODY, 32 + 7, 64, 5, 0);
    expect(r.blockedX).toBe(false);
    expect(r.x).toBe(32 + 12);
  });

  it('a move long enough to land past a one-tile wall still stops at it, in either direction', () => {
    const corridor = grid(['########', '#..#...#', '#..#...#', '########']);
    const right = moveAndCollide(corridor, BODY, 40, 64, 120, 0);
    expect(right.x).toBe(96 - 7);
    const left = moveAndCollide(corridor, BODY, 200, 64, -120, 0);
    expect(left.x).toBe(128 + 7);
  });

  it('slides along a wall instead of sticking', () => {
    const r = moveAndCollide(box, BODY, 128 - 7, 64, 3, 2);
    expect(r.blockedX).toBe(true);
    expect(r.y).toBe(66);
  });
});
