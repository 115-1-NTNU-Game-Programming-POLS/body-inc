import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chapterContent } from '../../src/app/chapters.ts';
import { CHAPTERS } from '../../src/app/content.ts';
import { patrolChapter, patrolLoop, type PatrolPlay } from '../../src/app/patrol.ts';
import { tagsFromQuery } from '../../src/app/session.ts';
import { acetaldehydeCrates, amount, enemyCenter, roomsOf, TICK_MS, type ChapterContent, type FloorId, type GameEvent, type TiledMap, type TickInput } from '../../src/core/index.ts';

const content = (id: string): ChapterContent => {
  const chapter = CHAPTERS.get(id)!;
  return chapterContent(chapter, new Map(roomsOf(chapter).map((p) => [p, JSON.parse(readFileSync(`public/assets/maps/${p}.tmj`, 'utf8')) as TiledMap])));
};
const CONTENT = new Map(['patrol-brain', 'patrol-liver'].map((id) => [id, content(id)]));
const base = (floor: FloorId): ChapterContent => patrolChapter(CONTENT, floor)!;
const dict = base('brain').dict;

const play = (floor: FloorId, query: string, room?: string, seed = 1): PatrolPlay => patrolLoop(base(floor), floor, tagsFromQuery(query, dict), seed, room);

/** One tick with the operator steered towards (x, y), or standing still once within `reach` pixels of it; true when it was there already. */
function stepTo(p: PatrolPlay, x: number, y: number, reach = 8): boolean {
  const o = p.loop.state.game.operator;
  const d = Math.hypot(x - o.x, y - o.y);
  const input: TickInput = d <= reach ? { move: { x: 0, y: 0 } } : { move: { x: (x - o.x) / d, y: (y - o.y) / d } };
  p.loop.advance(TICK_MS, () => input);
  return d <= reach;
}
function walk(p: PatrolPlay, x: number, y: number, ticks = 600, reach = 8): boolean {
  for (let i = 0; i < ticks; i++) if (stepTo(p, x, y, reach)) return true;
  return false;
}
const wait = (p: PatrolPlay, ticks: number) => { for (let i = 0; i < ticks; i++) p.loop.advance(TICK_MS); };
const events = (p: PatrolPlay): GameEvent[] => {
  const seen: GameEvent[] = [];
  p.loop.onEvent((e) => seen.push(e));
  return seen;
};
const clinging = (p: PatrolPlay) => p.loop.state.game.enemies.filter((e) => e.clings);

/**
 * Leads the adenosine of the rest room across the rest area the way a player would: stands about four tiles west of the nearest one,
 * inside what it senses and out of what it clings to, and backs into the area as it drifts in. At most `ticks` of it.
 */
function lure(p: PatrolPlay, ticks = 3000): void {
  for (let i = 0; i < ticks; i++) {
    const open = clinging(p).filter((e) => e.phase !== 'closed');
    if (open.length === 0) return;
    const o = p.loop.state.game.operator;
    const near = open.map(enemyCenter).reduce((a, b) => (Math.hypot(a.x - o.x, a.y - o.y) <= Math.hypot(b.x - o.x, b.y - o.y) ? a : b));
    stepTo(p, Math.max(260, near.x - 120), near.y);
  }
}

describe.each([['brain', '?tags=sleep_debt:1'], ['liver', '?tags=alcohol:2']] as const)('the %s patrol, room by room', (floor, query) => {
  it('is four rooms joined west to east, so walking east from the entrance hall comes to the core room', () => {
    const p = play(floor, query);
    const rooms = [p.loop.state.run.roomId];
    p.loop.onEvent((e) => { if (e.type === 'roomChanged') rooms.push(e.to); });
    for (let i = 0; i < 6000 && !p.loop.state.run.roomId.endsWith('/core'); i++) {
      const o = p.loop.state.game.operator;
      const input: TickInput = { move: { x: 1, y: Math.abs(o.y - 224) < 6 ? 0 : Math.sign(224 - o.y) } };
      p.loop.advance(TICK_MS, () => input);
    }
    expect(rooms.map((r) => r.split('/')[1])).toEqual(roomsOf(base(floor).chapter).map((r) => r.split('/')[1]));
    expect(p.rate()).not.toEqual({ failed: true });
  });
});

describe('the brain patrol (design doc 8.5)', () => {
  it('has the entrance hall, two challenge rooms and the core room, in a row', () => {
    const ctx = base('brain');
    expect(roomsOf(ctx.chapter)).toEqual(['patrol-brain/lobby', 'patrol-brain/desk', 'patrol-brain/hall', 'patrol-brain/core']);
    expect(ctx.chapter.patrol).toBe('brain');
  });

  it('is rated A or better once every adenosine of the rest room is locked and the operator gets out clean', () => {
    const p = play('brain', '?tags=sleep_debt:3', 'patrol-brain/core');
    const seen = events(p);
    expect(clinging(p).length).toBe(4);
    expect(p.rate()).toEqual({ grade: 'C' });
    lure(p);
    expect(clinging(p).every((e) => e.phase === 'closed')).toBe(true);
    expect(seen.filter((e) => e.type === 'caseClosed')).toHaveLength(4);
    expect(p.rate()).toEqual({ grade: 'A' });
  });

  it('leaves the core goal undone while an adenosine is still loose, however clean the run', () => {
    const p = play('brain', '?tags=sleep_debt:3', 'patrol-brain/core');
    expect(clinging(p).length).toBe(4);
    wait(p, 30);
    expect(p.rate()).toEqual({ grade: 'C' });
  });

  it('gives a rested host an empty rest room, which is the core goal done from the start', () => {
    const p = play('brain', '?tags=sleep_debt:0', 'patrol-brain/core');
    expect(clinging(p)).toHaveLength(0);
    expect(p.rate()).toEqual({ grade: 'A' });
  });

  it('counts the core goal only from inside the core room, so a patrol that never got there is C at most', () => {
    for (const [floor, query] of [['brain', '?tags=sleep_debt:0'], ['liver', '?tags=alcohol:0']] as const) {
      const p = play(floor, query);
      expect(p.loop.state.run.roomId, floor).toBe(`patrol-${floor}/lobby`);
      expect(p.rate(), floor).toEqual({ grade: 'C' });
    }
  });

  it('puts more adenosine in the room the more sleep debt the day left', () => {
    const count = (debt: number) => clinging(play('brain', `?tags=sleep_debt:${debt}`, 'patrol-brain/core')).length;
    expect([count(0), count(1), count(3), count(5)]).toEqual([0, 2, 4, 6]);
  });

  it('cannot lure adenosine that cannot see the operator, so a heavy caffeine day caps the patrol at C', () => {
    const p = play('brain', '?tags=sleep_debt:3,caffeine:60', 'patrol-brain/core');
    lure(p, 900);
    expect(clinging(p).some((e) => e.phase !== 'closed')).toBe(true);
    expect(p.rate()).toEqual({ grade: 'C' });
  });

  it('has the adenosine cling to an operator who walks into them, and the rest room stays undone', () => {
    const p = play('brain', '?tags=sleep_debt:3', 'patrol-brain/core');
    walk(p, 560, 176);
    wait(p, 300);
    expect(p.loop.state.game.operator.stacks).toBeGreaterThan(0);
    expect(p.rate()).toEqual({ grade: 'C' });
  });

  it('ends at the elevator in the core room', () => {
    const p = play('brain', '?tags=sleep_debt:0', 'patrol-brain/core');
    const seen = events(p);
    walk(p, 18 * 32 + 16, 6 * 32, 600, 24);
    wait(p, 10);
    expect(seen.some((e) => e.type === 'chapterEnded')).toBe(true);
  });
});

describe('the liver patrol (design doc 8.5)', () => {
  it('has the entrance hall, two challenge rooms and the production line, in a row', () => {
    const ctx = base('liver');
    expect(roomsOf(ctx.chapter)).toEqual(['patrol-liver/lobby', 'patrol-liver/party', 'patrol-liver/stock', 'patrol-liver/core']);
    expect(ctx.chapter.patrol).toBe('liver');
  });

  it('starts the line with the day\'s crates already out of the first one, at least two and at most four', () => {
    const crates = (query: string) => acetaldehydeCrates(play('liver', query, 'patrol-liver/core').loop.state.run.tags, dict);
    expect([crates('?tags=alcohol:0'), crates('?tags=alcohol:1'), crates('?tags=alcohol:3'), crates('?tags=alcohol:9')]).toEqual([2, 2, 3, 4]);
    expect(amount(play('liver', '?tags=alcohol:3', 'patrol-liver/core').loop.state.run.tags, dict, 'alcohol')).toBe(0);
  });

  it('is C at most while a crate is left on the line, and rates the run once all of them are in the second line', () => {
    const p = play('liver', '?tags=alcohol:3', 'patrol-liver/core');
    expect(p.rate()).toEqual({ grade: 'C' });
    const seen = events(p);
    // The crates stand one above the other at column 9; each is pushed east off the stack, then south onto the belt along the bottom row.
    const centre = (n: number) => n * 32 + 16;
    const go = (...tiles: [number, number][]) => { for (const [c, r] of tiles) expect(walk(p, centre(c), centre(r), 400, 3), `to ${c},${r}`).toBe(true); };
    const crates = () => p.loop.state.game.boxes.map((b) => `${b.col},${b.row}`).sort();
    const push = (dx: number, dy: number, until: string, ticks = 300) => {
      const input: TickInput = { move: { x: dx, y: dy } };
      for (let i = 0; i < ticks && !crates().includes(until); i++) p.loop.advance(TICK_MS, () => input);
      expect(crates(), `pushed to ${until}`).toContain(until);
    };
    let taken = 0;
    for (const row of [6, 5, 4]) {
      go([8, row]);
      push(1, 0, `10,${row}`);
      go([9, row + 1], [11, row + 1], [11, row - 1], [10, row - 1]);
      push(0, 1, '10,10');
      go([9, 9]);
      wait(p, 600);
      expect(seen.filter((e) => e.type === 'crateTaken'), `after the crate of row ${row}`).toHaveLength(++taken);
      expect(acetaldehydeCrates(p.loop.state.run.tags, dict)).toBe(3 - taken);
      expect(p.rate(), `after the crate of row ${row}`).toEqual(taken < 3 ? { grade: 'C' } : { grade: 'A' });
    }
    // Staying by the crates cost hearts through their fog, which the rating does not count against the patrol.
    expect(seen.filter((e) => e.type === 'heartLost').length).toBeGreaterThan(2);
  });
});
