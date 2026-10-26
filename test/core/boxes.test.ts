import { describe, expect, it } from 'vitest';
import { BOSSES, DIALOGUES, ENEMIES, PARAMS, TAGS } from '../../src/app/content.ts';
import { tagsFromQuery } from '../../src/app/session.ts';
import {
  CONVEYOR_TICKS, decode, encode, parseRoom, PUSH, resumeChapter, selectBoxes, selectConveyors, startChapter, stateHash, stepChapter, STORY,
  type ChapterContent, type ChapterState, type GameEvent, type TickInput, type TiledMap,
} from '../../src/core/index.ts';
import { readRoom } from '../../src/core/rooms/tiled.ts';

/**
 * Push boxes and conveyors (package 3 of the content-team plan). Rooms are bare 20 x 12 floors
 * built from Tiled objects, as in locks.test.ts and pickups.test.ts; the only solid cells are
 * outside the map.
 */

const p = (name: string, value: string | number | boolean) => ({ name, value });
const NONE: TickInput = { move: { x: 0, y: 0 } };
const RIGHT: TickInput = { move: { x: 1, y: 0 } };
const LEFT: TickInput = { move: { x: -1, y: 0 } };
const types = (events: readonly GameEvent[]) => events.map((e) => e.type);

const mapOf = (objects: object[], variants: object[] = [], solid: readonly (readonly [number, number])[] = []) => ({
  width: 20, height: 12, tilewidth: 32, tileheight: 32,
  properties: [p('organ', 'lobby'), p('role', 'puzzle'), p('estSeconds', 10)],
  layers: [
    { type: 'tilelayer', name: 'walls', data: Array.from({ length: 240 }, (_, i) => (solid.some(([c, r]) => r * 20 + c === i) ? 1 : 0)) },
    { type: 'objectgroup', name: 'objects', objects: [{ id: 1, type: 'PlayerStart', x: 64, y: 360 }, ...objects] },
    ...variants,
  ],
}) as unknown as TiledMap;

/** A box as a point at the centre of tile (col, row). */
const box = (id: number, col: number, row: number, when = '') => ({
  id, type: 'Box', x: col * 32 + 16, y: row * 32 + 16, properties: when ? [p('when', when)] : [],
});
const plate = (id: number, col: number, row: number, target: number) => ({
  id, type: 'Switch', x: col * 32, y: row * 32, width: 32, height: 32, properties: [p('target', target), p('mode', 'hold')],
});
const lever = (id: number, x: number, y: number, target: number) => ({ id, type: 'Switch', x, y, properties: [p('target', target), p('mode', 'toggle')] });
const belt = (id: number, col: number, row: number, cols: number, direction = 'E', speed = 'normal', rows = 1) => ({
  id, type: 'Conveyor', x: col * 32, y: row * 32, width: cols * 32, height: rows * 32, properties: [p('direction', direction), p('speed', speed)],
});
const southDoor = (lock = 'none') => ({
  id: 2, type: 'Door', name: 'door-s', x: 288, y: 352, width: 64, height: 32, properties: [p('socket', 'S'), p('lock', lock)],
});
const northDoor = { id: 2, type: 'Door', name: 'door-n', x: 288, y: 0, width: 64, height: 96, properties: [p('socket', 'N')] };
const timeClock = { id: 9, type: 'Trigger', x: 32, y: 96, width: 32, height: 32, properties: [p('event', 'checkpoint')] };

function chapter(objects: object[], door: object = southDoor(), solid: readonly (readonly [number, number])[] = []): ChapterContent {
  return {
    chapter: { version: 1, id: 'lab', start: 'lab/a', links: [{ a: 'lab/a#door-s', b: 'lab/b#door-n' }] },
    rooms: new Map([['lab/a', parseRoom('lab/a', mapOf([door, ...objects], [], solid), TAGS)], ['lab/b', parseRoom('lab/b', mapOf([northDoor]), TAGS)]]),
    dialogues: DIALOGUES, dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS,
  };
}

function run(c: ChapterContent, s: ChapterState, input: TickInput, n = 1): { state: ChapterState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    const r = stepChapter(c, s, input);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

/** Steps until an event of `type` appears; returns the tick count it took, or -1. */
function ticksUntil(c: ChapterContent, s: ChapterState, input: TickInput, type: GameEvent['type'], max = 200): { n: number; state: ChapterState } {
  for (let n = 1; n <= max; n++) {
    const r = stepChapter(c, s, input);
    s = r.state;
    if (r.events.some((e) => e.type === type)) return { n, state: s };
  }
  return { n: -1, state: s };
}

const place = (s: ChapterState, x: number, y: number): ChapterState =>
  ({ ...s, game: { ...s.game, touching: [], operator: { ...s.game.operator, x, y, vx: 0, vy: 0 } } });
/** Feet in row 6, just left of tile column 10. */
const leftOf10 = (s: ChapterState) => place(s, 300, 215);
const tiles = (s: ChapterState) => s.game.boxes.map((b) => [b.id, b.col, b.row]);

describe('pushing a box', () => {
  it('moves one tile only after the operator has pressed against it for the push delay', () => {
    const c = chapter([box(3, 10, 6)]);
    const s0 = leftOf10(startChapter(c));
    const pushed = ticksUntil(c, s0, RIGHT, 'boxMoved');
    expect(pushed.n).toBeGreaterThanOrEqual(PUSH.delayTicks);
    expect(tiles(pushed.state)).toEqual([[3, 11, 6]]);
    // A brush shorter than the delay does nothing.
    const brushed = run(c, run(c, s0, RIGHT, 8).state, NONE, 30).state;
    expect(tiles(brushed)).toEqual([[3, 10, 6]]);
  });

  it('slides over PUSH.slideTicks, drawn part way, then rests on the new tile', () => {
    const c = chapter([box(3, 10, 6)]);
    const pushed = ticksUntil(c, leftOf10(startChapter(c)), RIGHT, 'boxMoved').state;
    const half = run(c, pushed, NONE, PUSH.slideTicks / 2).state;
    expect(selectBoxes(half.game)[0]!.x).toBeCloseTo(10.5 * 32, 0);
    const rested = run(c, half, NONE, PUSH.slideTicks).state;
    expect(rested.game.boxes[0]).toEqual({ id: 3, col: 11, row: 6, left: 0, ticks: 0 });
    expect(selectBoxes(rested.game)[0]).toEqual({ object: 3, boxType: 'crate', x: 11 * 32, y: 6 * 32 });
  });

  it('keeps going tile after tile while the key is held, without waiting the delay again', () => {
    const c = chapter([box(3, 10, 6)]);
    const first = ticksUntil(c, leftOf10(startChapter(c)), RIGHT, 'boxMoved');
    const second = ticksUntil(c, first.state, RIGHT, 'boxMoved');
    expect(tiles(second.state)).toEqual([[3, 12, 6]]);
    // Catching up a tile at walking speed takes about 13 ticks; a fresh delay would add 10 more.
    expect(second.n).toBeLessThan(PUSH.slideTicks + PUSH.delayTicks);
  });

  it('a diagonal press does not push, even wedged in a corner with the diagonal tile free', () => {
    // A wall under the operator's tile stops the slide down the box's face; tile (11, 7) is free.
    const c = chapter([box(3, 10, 6)], southDoor(), [[9, 7]]);
    const r = run(c, place(startChapter(c), 300, 224), { move: { x: 1, y: 1 } }, 60);
    expect(r.state.game.operator.x).toBe(320 - 7);
    expect(r.state.game.operator.y).toBe(224);
    expect(types(r.events)).not.toContain('boxMoved');
  });

  it('no push while dodging into a box: the wait starts once the dodge is over', () => {
    const c = chapter([box(3, 10, 6)]);
    const s0 = run(c, leftOf10(startChapter(c)), RIGHT, 9).state;
    const dodge = run(c, s0, { move: { x: 1, y: 0 }, dodgePressed: true });
    expect(types(dodge.events)).toContain('dodge');
    expect(types(run(c, dodge.state, RIGHT, 18).events)).not.toContain('boxMoved');
  });

  it('the head start of a held push is only for the box being pushed, not the next one met', () => {
    // Box 3 is pushed onto a belt that carries it north out of the way; box 4 waits behind it.
    const c = chapter([box(3, 10, 6), belt(5, 11, 6, 1, 'N'), box(4, 12, 6)]);
    let s = leftOf10(startChapter(c));
    let pressedAt = -1;
    let movedAt = -1;
    for (let t = 1; t <= 120 && movedAt < 0; t++) {
      const r = stepChapter(c, s, RIGHT);
      s = r.state;
      if (pressedAt < 0 && s.game.push?.box === 4) pressedAt = t;
      if (r.events.some((e) => e.type === 'boxMoved' && e.object === 4)) movedAt = t;
    }
    expect(pressedAt).toBeGreaterThan(0);
    // Pressed on tick 1 of the wait, moved on tick PUSH.delayTicks.
    expect(movedAt - pressedAt).toBe(PUSH.delayTicks - 1);
  });

  it('the box stays put against another box, the room edge, or a door', () => {
    const c = chapter([box(3, 10, 6), box(4, 11, 6), box(5, 19, 6), box(6, 9, 10)]);
    const s0 = startChapter(c);
    expect(types(run(c, leftOf10(s0), RIGHT, 60).events)).not.toContain('boxMoved');
    // Flush against box 5 in the last column: the next tile is outside the room.
    expect(types(run(c, place(s0, 19 * 32 - 7, 215), RIGHT, 60).events)).not.toContain('boxMoved');
    // Box 6 sits in row 10; the tile below it is the south door, which boxes keep clear.
    expect(types(run(c, place(s0, 9 * 32 + 16, 10 * 32 - 1), { move: { x: 0, y: 1 } }, 60).events)).not.toContain('boxMoved');
  });

  it('a body straddling two boxes pushes neither', () => {
    const c = chapter([box(3, 10, 5), box(4, 10, 6)]);
    // Feet at y 197: the body spans y 187 to 197, across rows 5 and 6.
    const r = run(c, place(startChapter(c), 300, 197), RIGHT, 60);
    expect(types(r.events)).not.toContain('boxMoved');
  });

  it('a box is solid: the operator stops against it and a staple stops at it', () => {
    const c = chapter([box(3, 10, 6)]);
    const s = run(c, leftOf10(startChapter(c)), RIGHT, 9).state;
    expect(s.game.operator.x).toBe(320 - 7);
    const staple = (ch: ChapterContent): ChapterState => {
      const s0 = startChapter(ch);
      return { ...s0, game: { ...s0.game, projectiles: [{ id: 999, x: 250, y: 208, vx: 8, vy: 0, ticksLeft: 30 }] } };
    };
    expect(run(c, staple(c), NONE, 12).state.game.projectiles).toEqual([]);
    // The control: with no box the staple flies on past the tile.
    expect(run(chapter([]), staple(chapter([])), NONE, 12).state.game.projectiles[0]!.x).toBeGreaterThan(330);
  });
});

describe('boxes on plates', () => {
  it('a box resting on a plate holds the door open, and pushing it off shuts it', () => {
    const c = chapter([box(3, 10, 6), plate(4, 11, 6, 2)], southDoor('switch'));
    const s0 = startChapter(c);
    expect(s0.game.switches).toEqual([]);
    const pushed = ticksUntil(c, leftOf10(s0), RIGHT, 'boxMoved').state;
    // Still sliding: not arrived, not pressed.
    expect(pushed.game.switches).toEqual([]);
    const landed = ticksUntil(c, pushed, NONE, 'switchChanged');
    expect(landed.n).toBe(PUSH.slideTicks);
    expect(landed.state.game.switches).toEqual([4]);
    expect(landed.state.game.doorsOpen).toEqual([2]);
    const off = ticksUntil(c, place(landed.state, 11 * 32 - 7, 215), RIGHT, 'switchChanged').state;
    expect(off.game.switches).toEqual([]);
  });

  it('says the box pressed it, not the operator', () => {
    const c = chapter([box(3, 10, 6), plate(4, 11, 6, 2)], southDoor('switch'));
    const pushed = ticksUntil(c, leftOf10(startChapter(c)), RIGHT, 'boxMoved').state;
    const r = run(c, pushed, NONE, PUSH.slideTicks);
    expect(r.events).toContainEqual({ type: 'switchChanged', object: 4, on: true, mode: 'hold', by: 'box' });
  });

  it('a box that starts on a plate holds it from the first tick', () => {
    const c = chapter([box(3, 11, 6), plate(4, 11, 6, 2)], southDoor('switch'));
    expect(startChapter(c).game.doorsOpen).toEqual([2]);
  });
});

describe('conveyors', () => {
  it('carry a resting box a tile every CONVEYOR_TICKS and stop at the end of the room', () => {
    const c = chapter([belt(3, 14, 4, 6), box(4, 14, 4)]);
    const s0 = startChapter(c);
    const first = ticksUntil(c, s0, NONE, 'boxMoved');
    expect(first.n).toBe(1);
    expect(tiles(first.state)).toEqual([[4, 15, 4]]);
    const next = ticksUntil(c, first.state, NONE, 'boxMoved');
    expect(next.n).toBe(CONVEYOR_TICKS['normal']);
    const end = run(c, s0, NONE, 400).state;
    expect(tiles(end)).toEqual([[4, 19, 4]]);
  });

  it('a conveyor with a lever aimed at it runs only while the lever is on', () => {
    const c = chapter([belt(3, 14, 4, 4), box(4, 14, 4), lever(5, 200, 200, 3)]);
    const s0 = startChapter(c);
    expect(selectConveyors(s0.game)).toEqual([{ object: 3, direction: 'E', speed: 'normal', running: false }]);
    expect(types(run(c, s0, NONE, 60).events)).not.toContain('boxMoved');
    const on = run(c, place(s0, 200, 220), { move: { x: 0, y: 0 }, interactPressed: true }).state;
    expect(selectConveyors(on.game)[0]!.running).toBe(true);
    expect(ticksUntil(c, on, NONE, 'boxMoved').n).toBe(1);
  });

  it('carry the operator standing on them', () => {
    const c = chapter([belt(3, 4, 8, 10, 'E', 'fast')]);
    const s = run(c, place(startChapter(c), 160, 280), NONE, 30).state;
    expect(s.game.operator.x).toBeCloseTo(160 + 30 * (32 / CONVEYOR_TICKS['fast']!), 5);
    expect(s.game.operator.y).toBe(280);
  });

  it('a carried box waits while the operator stands in its way', () => {
    const c = chapter([belt(3, 14, 4, 4, 'E', 'slow'), box(4, 14, 4)]);
    // Feet in row 4, column 15: standing on the tile the box would move to.
    const s = run(c, place(startChapter(c), 15 * 32 + 16, 4 * 32 + 30), NONE, 1);
    expect(types(s.events)).not.toContain('boxMoved');
  });
});

describe('boxes between visits', () => {
  /** The box pushed onto the plate, then the operator walks out the south door. */
  function solvedAndLeft(c: ChapterContent) {
    const pushed = ticksUntil(c, leftOf10(startChapter(c)), RIGHT, 'boxMoved').state;
    const settled = run(c, pushed, NONE, PUSH.slideTicks).state;
    const out = ticksUntil(c, place(settled, 320, 340), { move: { x: 0, y: 1 } }, 'roomChanged').state;
    expect(out.run.roomId).toBe('lab/b');
    return out;
  }
  const backIn = (c: ChapterContent, s: ChapterState) =>
    ticksUntil(c, place(s, 320, 110), { move: { x: 0, y: -1 } }, 'roomChanged').state;

  it('a box left on a plate is still there on the next visit; the others are back where the map put them', () => {
    const c = chapter([box(3, 10, 6), plate(4, 11, 6, 2), box(5, 4, 4)], southDoor('switch'));
    const away = solvedAndLeft(c);
    expect(away.run.boxes).toEqual([{ key: 'lab/a#3', col: 11, row: 6 }]);
    const s = { ...away, run: { ...away.run, boxes: [...away.run.boxes, { key: 'lab/a#5', col: 6, row: 4 }] } };
    const back = backIn(c, s);
    expect(back.run.roomId).toBe('lab/a');
    expect(tiles(back)).toEqual([[3, 11, 6], [5, 4, 4]]);
    expect(back.game.doorsOpen).toContain(2);
  });

  it('a forced leave keeps a box on its plate and sends the rest home', () => {
    const c = chapter([box(3, 10, 6), plate(4, 11, 6, 2), box(5, 4, 4)], southDoor('switch'));
    const pushed = ticksUntil(c, leftOf10(startChapter(c)), RIGHT, 'boxMoved').state;
    const settled = run(c, pushed, NONE, PUSH.slideTicks).state;
    const moved: ChapterState = { ...settled, game: { ...settled.game, boxes: settled.game.boxes.map((b) => (b.id === 5 ? { ...b, col: 6 } : b)) } };
    const dying: ChapterState = { ...moved, game: { ...moved.game, operator: { ...moved.game.operator, halves: 0 } } };
    const r = run(c, dying, NONE);
    expect(types(r.events)).toContain('forcedLeave');
    expect(tiles(r.state)).toEqual([[3, 11, 6], [5, 4, 4]]);
    expect(r.state.game.switches).toEqual([4]);
  });

  it('a box whose home is held by a box kept on a plate stays where it was left', () => {
    const c = chapter([box(3, 10, 6), box(5, 11, 6), plate(4, 11, 6, 2)], southDoor('switch'));
    const s0 = startChapter(c);
    const remembered = { ...s0, run: { ...s0.run, boxes: [{ key: 'lab/a#5', col: 13, row: 6 }, { key: 'lab/a#3', col: 11, row: 6 }] } };
    const back = backIn(c, ticksUntil(c, place(remembered, 320, 340), { move: { x: 0, y: 1 } }, 'roomChanged').state);
    expect(tiles(back)).toEqual([[3, 11, 6], [5, 13, 6]]);
  });

  it('a box kept on a plate where the operator stands goes home instead of trapping them', () => {
    // The plate sits under the PlayerStart at (64, 360), which is where a continue puts the operator.
    const c = chapter([box(3, 6, 6), plate(4, 2, 11, 2)], southDoor('switch'));
    const s0 = startChapter(c);
    const cp = {
      chapter: 'lab', roomId: 'lab/a', x: 64, y: 360, tags: s0.run.tags, clock: s0.game.clock, fired: [], switches: [],
      boxes: [{ key: 'lab/a#3', col: 2, row: 11 }],
    };
    expect(tiles(resumeChapter(c, cp))).toEqual([[3, 6, 6]]);
    // The control: stood elsewhere, the same box stays on its plate.
    expect(tiles(resumeChapter(c, { ...cp, x: 320, y: 200 }))).toEqual([[3, 2, 11]]);
  });

  it('the time clock saves where boxes were left, through save and continue', () => {
    const c = chapter([box(3, 10, 6), plate(4, 11, 6, 2), timeClock], southDoor('switch'));
    const pushed = ticksUntil(c, leftOf10(startChapter(c)), RIGHT, 'boxMoved').state;
    const settled = run(c, pushed, NONE, PUSH.slideTicks).state;
    const punched = run(c, place(settled, 48, 120), NONE).state;
    expect(punched.run.checkpoint?.boxes).toEqual([{ key: 'lab/a#3', col: 11, row: 6 }]);
    const saved = decode(STORY, encode(STORY, { checkpoint: punched.run.checkpoint }));
    expect(tiles(resumeChapter(c, saved.data.checkpoint!))).toEqual([[3, 11, 6]]);
  });

  it('a version-2 story slot loads with no boxes moved', () => {
    const v2 = JSON.stringify({ schema: 2, data: { checkpoint: {
      chapter: 'lab', roomId: 'lab/a', x: 1, y: 2, tags: { values: {}, log: { nodes: [] } }, clock: { day: 1, minute: 480 }, fired: [], switches: [],
    } } });
    const d = decode(STORY, v2);
    expect(d.kind).toBe('migrated');
    expect(d.data.checkpoint?.boxes).toEqual([]);
  });

  it('a box whose when fails is not in the room', () => {
    const c = chapter([box(3, 10, 6, 'caffeine>50'), box(4, 4, 4)]);
    expect(tiles(startChapter(c))).toEqual([[4, 4, 4]]);
    expect(tiles(startChapter(c, { tags: tagsFromQuery('?tags=caffeine:80', TAGS) }))).toEqual([[3, 10, 6], [4, 4, 4]]);
  });
});

describe('the parser', () => {
  const problems = (objects: object[]) => readRoom('x', mapOf(objects), TAGS).problems.map((q) => [q.code, q.object]);

  it('wants a box on its own floor tile, clear of doors, NPCs, beds, pickups and triggers', () => {
    const walled = { ...mapOf([box(3, 4, 4)]) } as TiledMap;
    const data = new Array(240).fill(0);
    data[4 * 20 + 4] = 1;
    const withWall = { ...walled, layers: [{ type: 'tilelayer', name: 'walls', data }, ...walled.layers.slice(1)] } as unknown as TiledMap;
    expect(readRoom('x', withWall, TAGS).problems.map((q) => q.code)).toEqual(['box-wall']);
    expect(problems([box(3, 4, 4), box(4, 4, 4)])).toEqual([['box-stack', 4]]);
    expect(problems([southDoor(), box(3, 9, 11)])).toEqual([['box-blocked', 3]]);
    const item = { id: 5, type: 'Pickup', x: 4 * 32 + 16, y: 4 * 32 + 16, properties: [p('itemType', 'coffee')] };
    expect(problems([item, box(3, 4, 4)])).toEqual([['box-blocked', 3]]);
    expect(problems([box(3, 4, 4), box(4, 5, 4)])).toEqual([]);
  });

  it('wants a conveyor drawn as a rectangle, and lets a switch aim at one', () => {
    expect(problems([{ id: 3, type: 'Conveyor', x: 100, y: 100, properties: [] }])).toEqual([['conveyor-shape', 3]]);
    expect(problems([belt(3, 4, 4, 3), lever(4, 200, 200, 3)])).toEqual([]);
    expect(problems([box(3, 4, 4), lever(4, 200, 200, 3)])).toEqual([['switch-target-kind', 4]]);
  });
});

describe('replay', () => {
  it('a push onto a belt replays to the same hash', () => {
    // A belt down column 11 from row 6 to row 8 delivers the box onto the plate in row 9.
    const c = chapter([box(3, 10, 6), belt(4, 11, 6, 1, 'S', 'fast', 3), plate(5, 11, 9, 2)], southDoor('switch'));
    const play = () => {
      let s = leftOf10(startChapter(c));
      for (let i = 0; i < 40; i++) s = stepChapter(c, s, RIGHT).state;
      for (let i = 0; i < 120; i++) s = stepChapter(c, s, NONE).state;
      return s;
    };
    const a = play();
    expect(stateHash(a)).toBe(stateHash(play()));
    expect(a.game.boxes.map((b) => [b.col, b.row, b.left])).toEqual([[11, 9, 0]]);
    expect(a.game.switches).toEqual([5]);
  });
});
