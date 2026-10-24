import { ENEMIES, TAGS } from '../../src/app/content.ts';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bodyOverlapsSolid } from '../../src/core/collision/grid.ts';
import {
  createGame, EMPTY_TAGS, enterRoom, OPERATOR_BODY, parseRoom, RoomFormatError, stateHash, step, type GameState, type TickInput, type TiledMap,
} from '../../src/core/index.ts';
import { nextInt, seedRng } from '../../src/core/rng.ts';

const MAP = JSON.parse(readFileSync('public/assets/maps/greybox/greybox-room.tmj', 'utf8')) as TiledMap;
const room = enterRoom(parseRoom('greybox-room', MAP, TAGS), EMPTY_TAGS, TAGS);

/**
 * Seeded random fight: a new stick direction every 20 ticks, fire held half the time, and a
 * dodge pressed now and then, so replays and wall checks cover dodges, knockback and staples.
 */
function play(seed: number, ticks: number, onTick?: (s: GameState) => void): GameState {
  let s = createGame(room, 1, ENEMIES);
  let r = seedRng(seed);
  let move = { x: 0, y: 0 };
  let attack = false;
  for (let t = 0; t < ticks; t++) {
    let dodge = 0;
    if (t % 20 === 0) {
      let dx: number, dy: number, a: number;
      [dx, r] = nextInt(r, 3);
      [dy, r] = nextInt(r, 3);
      [a, r] = nextInt(r, 2);
      move = { x: dx - 1, y: dy - 1 };
      attack = a === 1;
    }
    if (t % 7 === 0) [dodge, r] = nextInt(r, 4);
    const input: TickInput = { move, attack, attackPressed: attack && t % 20 === 0, dodgePressed: dodge === 0 && t % 7 === 0 };
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
    expect(() => parseRoom('broken', broken, TAGS)).toThrow(RoomFormatError);
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

  it('pushing into a wall from a standstill still reports a bump every tick', () => {
    const start = createGame(room, 1, ENEMIES);
    const flush: GameState = { ...start, operator: { ...start.operator, x: 32 + OPERATOR_BODY.halfW, y: 160 } };
    const left: TickInput = { move: { x: -1, y: 0 } };
    const first = step(flush, left);
    const second = step(first.state, left);
    expect(first.events).toContainEqual({ type: 'bumpWall', axis: 'x' });
    expect(second.events).toContainEqual({ type: 'bumpWall', axis: 'x' });
    expect(step(second.state, { move: { x: 1, y: 0 } }).events).toEqual([]);
  });

  it('the random fight exercises dodges, hits taken and staples', () => {
    let dodged = false; let hurt = false; let shot = false;
    play(7, 5000, (s) => {
      if (s.operator.action.kind === 'dodge') dodged = true;
      if (s.operator.action.kind === 'hurt') hurt = true;
      if (s.projectiles.length > 0) shot = true;
    });
    expect([dodged, hurt, shot]).toEqual([true, true, true]);
  });

  it('the random walk actually moves the operator around', () => {
    const xs = new Set<number>();
    play(7, 2000, (s) => xs.add(Math.round(s.operator.x / 32)));
    expect(xs.size).toBeGreaterThan(5);
  });
});
