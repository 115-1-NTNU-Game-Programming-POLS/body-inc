import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bodyOverlapsSolid } from '../../src/core/collision/grid.ts';
import {
  createGame, OPERATOR_BODY, parseRoom, RoomFormatError, stateHash, step, type GameState, type TickInput, type TiledMap,
} from '../../src/core/index.ts';
import { nextInt, seedRng } from '../../src/core/rng.ts';

const MAP = JSON.parse(readFileSync('public/assets/maps/greybox/greybox-room.tmj', 'utf8')) as TiledMap;
const room = parseRoom('greybox-room', MAP);

/** Seeded random walk: a different stick direction every 20 ticks. */
function play(seed: number, ticks: number, onTick?: (s: GameState) => void): GameState {
  let s = createGame(room, 1);
  let r = seedRng(seed);
  let input: TickInput = { move: { x: 0, y: 0 } };
  for (let t = 0; t < ticks; t++) {
    if (t % 20 === 0) {
      let dx: number, dy: number;
      [dx, r] = nextInt(r, 3);
      [dy, r] = nextInt(r, 3);
      input = { move: { x: dx - 1, y: dy - 1 } };
    }
    s = step(s, input).state;
    onTick?.(s);
  }
  return s;
}

describe('greybox room', () => {
  it('parses walls and the player start from the Tiled file', () => {
    expect(room.grid.cols).toBe(20);
    expect(room.grid.rows).toBe(12);
    expect(room.grid.solid[0]).toBe(true);
    expect(room.grid.solid[6 * 20 + 10]).toBe(false);
    expect(room.objects.find((o) => o.kind === 'PlayerStart')).toMatchObject({ x: 320, y: 256 });
  });

  it('rejects a map without a walls layer', () => {
    const broken = { ...MAP, layers: MAP.layers.filter((l) => l.name !== 'walls') };
    expect(() => parseRoom('broken', broken)).toThrow(RoomFormatError);
  });
});

describe('deterministic rules', () => {
  it('the same seed and inputs replay to the same state hash', () => {
    expect(stateHash(play(42, 1200))).toBe(stateHash(play(42, 1200)));
  });

  it('different inputs give a different hash (the replay check can fail)', () => {
    expect(stateHash(play(42, 1200))).not.toBe(stateHash(play(43, 1200)));
  });

  it('the operator never overlaps a wall during a long random walk', () => {
    let worst = 0;
    play(7, 5000, (s) => {
      if (bodyOverlapsSolid(s.room.grid, OPERATOR_BODY, s.operator.x, s.operator.y)) worst++;
    });
    expect(worst).toBe(0);
  });

  it('the random walk actually moves the operator around', () => {
    const xs = new Set<number>();
    play(7, 2000, (s) => xs.add(Math.round(s.operator.x / 32)));
    expect(xs.size).toBeGreaterThan(5);
  });
});
