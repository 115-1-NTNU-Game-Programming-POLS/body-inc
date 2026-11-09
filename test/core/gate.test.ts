import { describe, expect, it } from 'vitest';
import { BOSSES, DIALOGUES, ENEMIES, PARAMS, TAGS } from '../../src/app/content.ts';
import {
  parseRoom, selectPort, startChapter, stepChapter, TICK_HZ,
  type ChapterContent, type ChapterState, type GameEvent, type TickInput, type TiledMap,
} from '../../src/core/index.ts';
import { portOpenAt, portTicksLeft } from '../../src/core/rooms/boxes.ts';
import { readRoom } from '../../src/core/rooms/tiled.ts';

/**
 * The timed gate (design doc 7.5): a Port with `openSeconds` and `closedSeconds` is shut first,
 * then open, over and over from the start of the visit. Rooms are bare 20 x 12 floors as in
 * boxes.test.ts; the port covers tile (15, 6), and a belt on row 6 runs east into it.
 */

const p = (name: string, value: string | number | boolean) => ({ name, value });
const NONE: TickInput = { move: { x: 0, y: 0 } };
const types = (events: readonly GameEvent[]) => events.map((e) => e.type);

const mapOf = (objects: object[]) => ({
  width: 20, height: 12, tilewidth: 32, tileheight: 32,
  properties: [p('organ', 'stomach'), p('role', 'puzzle'), p('estSeconds', 10)],
  layers: [
    { type: 'tilelayer', name: 'walls', data: new Array(240).fill(0) },
    { type: 'objectgroup', name: 'objects', objects: [{ id: 1, type: 'PlayerStart', x: 64, y: 360 }, ...objects] },
  ],
}) as unknown as TiledMap;

const OPEN = 2;
const CLOSED = 3;
const PORT_ID = 30;
const port = (props: object[] = [p('openSeconds', OPEN), p('closedSeconds', CLOSED)], need = 1) =>
  ({ id: PORT_ID, type: 'Port', x: 15 * 32, y: 6 * 32, width: 32, height: 32, properties: [p('need', need), ...props] });
const crate = (id: number, col: number, row = 6) => ({ id, type: 'Box', x: col * 32 + 16, y: row * 32 + 16, properties: [] });
const belt = { id: 40, type: 'Conveyor', x: 10 * 32, y: 6 * 32, width: 5 * 32, height: 32, properties: [p('direction', 'E'), p('speed', 'fast')] };

function chapter(objects: object[]): ChapterContent {
  return {
    chapter: { version: 1, id: 'lab', start: 'lab/a', links: [] },
    rooms: new Map([['lab/a', parseRoom('lab/a', mapOf(objects), TAGS)]]),
    dialogues: DIALOGUES, dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS,
  };
}

function run(c: ChapterContent, s: ChapterState, n: number, input: TickInput = NONE): { state: ChapterState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    const r = stepChapter(c, s, input);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

/** Moves box `id` to rest on a tile, as if it had just slid there. */
const drop = (s: ChapterState, id: number, col: number, row = 6): ChapterState =>
  ({ ...s, game: { ...s.game, boxes: s.game.boxes.map((b) => (b.id === id ? { ...b, col, row, left: 0, ticks: 0 } : b)) } });

describe('the timed gate', () => {
  it('is shut first, opens after closedSeconds and shuts again after openSeconds, saying so each time', () => {
    const c = chapter([port(), crate(3, 4, 2)]);
    const o = c.rooms.get('lab/a')!.objects.find((x) => x.id === PORT_ID)!;
    expect([0, CLOSED * TICK_HZ - 1].map((t) => portOpenAt(o, t))).toEqual([false, false]);
    expect([CLOSED * TICK_HZ, (CLOSED + OPEN) * TICK_HZ - 1].map((t) => portOpenAt(o, t))).toEqual([true, true]);
    expect(portOpenAt(o, (CLOSED + OPEN) * TICK_HZ)).toBe(false);
    expect(portTicksLeft(o, 0)).toBe(CLOSED * TICK_HZ);
    expect(portTicksLeft(o, CLOSED * TICK_HZ)).toBe(OPEN * TICK_HZ);
    const r = run(c, startChapter(c), (CLOSED + OPEN) * TICK_HZ + 1);
    const flips = r.events.filter((e) => e.type === 'portOpened' || e.type === 'portClosed');
    expect(flips).toEqual([{ type: 'portOpened', object: PORT_ID }, { type: 'portClosed', object: PORT_ID }]);
  });

  it('takes nothing while shut, and a box left on it is taken on the first open tick', () => {
    const c = chapter([port(), crate(3, 4, 2)]);
    const s = drop(startChapter(c), 3, 15);
    const shut = run(c, s, CLOSED * TICK_HZ);
    expect(types(shut.events)).not.toContain('boxDelivered');
    // The selector reads the tick about to run, which is the first open one.
    expect(selectPort(shut.state.game)).toEqual({ object: PORT_ID, count: 0, need: 1, gate: { open: true, seconds: OPEN } });
    expect(selectPort(run(c, s, 1).state.game)!.gate).toEqual({ open: false, seconds: CLOSED });
    const open = run(c, shut.state, 1);
    expect(open.events).toContainEqual({ type: 'boxDelivered', object: 3, port: PORT_ID, count: 1, need: 1 });
  });

  it('holds a belt of boxes at its edge while shut, and lets them through once open', () => {
    const c = chapter([port(undefined, 2), belt, crate(3, 13), crate(4, 12)]);
    const shut = run(c, startChapter(c), CLOSED * TICK_HZ);
    expect(types(shut.events)).not.toContain('boxDelivered');
    expect(shut.state.game.boxes.map((b) => [b.id, b.col])).toEqual([[3, 14], [4, 13]]);
    const open = run(c, shut.state, OPEN * TICK_HZ);
    expect(open.events.filter((e) => e.type === 'boxDelivered').map((e) => (e as { object: number }).object)).toEqual([3, 4]);
  });

  it('stays open and quiet once full', () => {
    const c = chapter([port([p('openSeconds', OPEN), p('closedSeconds', CLOSED)], 1), crate(3, 4, 2), crate(4, 6, 2)]);
    const s = drop(startChapter(c), 3, 15);
    const filled = run(c, s, CLOSED * TICK_HZ + 1);
    expect(types(filled.events)).toContain('portFilled');
    expect(selectPort(filled.state.game)).toEqual({ object: PORT_ID, count: 1, need: 1 });
    // Ten ticks short of a whole cycle on from the first open tick lands in the next shut time.
    const later = run(c, filled.state, (CLOSED + OPEN) * TICK_HZ - 10);
    expect(types(later.events)).not.toContain('portClosed');
    expect(types(later.events)).not.toContain('portOpened');
    // In what would be its shut time, a full port still takes a box: it no longer keeps hours.
    const extra = run(c, drop(later.state, 4, 15), 1);
    expect(portOpenAt(c.rooms.get('lab/a')!.objects.find((x) => x.id === PORT_ID)!, later.state.game.tick)).toBe(false);
    expect(extra.events).toContainEqual({ type: 'boxDelivered', object: 4, port: PORT_ID, count: 2, need: 1 });
  });

  it('leaves a port without timing always open', () => {
    const c = chapter([port([]), crate(3, 4, 2)]);
    expect(selectPort(startChapter(c).game)).toEqual({ object: PORT_ID, count: 0, need: 1 });
    const r = run(c, drop(startChapter(c), 3, 15), 1);
    expect(types(r.events)).toContain('boxDelivered');
    expect(types(run(c, startChapter(c), 10 * TICK_HZ).events)).not.toContain('portOpened');
  });
});

describe('a port with one time only', () => {
  it('is always open, as the map check asks the author to fix', () => {
    for (const props of [[p('openSeconds', OPEN)], [p('closedSeconds', CLOSED)]]) {
      const o = readRoom('lab/a', mapOf([port(props), crate(3, 4, 2)]), TAGS).room.objects.find((x) => x.id === PORT_ID)!;
      expect([0, 1, CLOSED * TICK_HZ, 1000].map((t) => portOpenAt(o, t))).toEqual([true, true, true, true]);
      expect(portTicksLeft(o, 0)).toBeUndefined();
    }
  });
});

describe('the map check', () => {
  const codes = (objects: object[]) => readRoom('lab/a', mapOf([...objects, crate(3, 4, 2), crate(4, 5, 2)]), TAGS).problems.map((x) => x.code);

  it('reports a port with only one of its two times', () => {
    expect(codes([port([p('openSeconds', OPEN)])])).toEqual(['port-timing']);
    expect(codes([port([p('closedSeconds', CLOSED)])])).toEqual(['port-timing']);
    expect(codes([port()])).toEqual([]);
    expect(codes([port([])])).toEqual([]);
  });
});
