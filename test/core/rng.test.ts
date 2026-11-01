import { describe, expect, it } from 'vitest';
import { drawDistinct, seedStreams } from '../../src/core/index.ts';

const POOL = [2, 3, 4, 6, 7, 8, 9];

describe('drawDistinct', () => {
  it('draws distinct members of the pool, the same ones for the same seed', () => {
    const [got] = drawDistinct(seedStreams(7), 'events', POOL, 4);
    expect(got).toHaveLength(4);
    expect(new Set(got).size).toBe(4);
    for (const v of got) expect(POOL).toContain(v);
    expect(drawDistinct(seedStreams(7), 'events', POOL, 4)[0]).toEqual(got);
    expect(drawDistinct(seedStreams(8), 'events', POOL, 4)[0]).not.toEqual(got);
  });

  it('advances only the stream it was asked to draw from', () => {
    const start = seedStreams(7);
    const [, after] = drawDistinct(start, 'setting', POOL, 3);
    expect(after.setting).not.toBe(start.setting);
    expect(after.events).toBe(start.events);
    expect(after.map).toBe(start.map);
    expect(after.enemies).toBe(start.enemies);
  });

  it('gives fewer when the pool runs out, and leaves the pool as it was', () => {
    const pool = [5, 6];
    expect(drawDistinct(seedStreams(1), 'events', pool, 5)[0].sort()).toEqual([5, 6]);
    expect(pool).toEqual([5, 6]);
    expect(drawDistinct(seedStreams(1), 'events', [], 2)[0]).toEqual([]);
  });
});
