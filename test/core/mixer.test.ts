import { describe, expect, it } from 'vitest';
import { BOSSES, DIALOGUES, ENEMIES, PARAMS, TAGS } from '../../src/app/content.ts';
import {
  parseRoom, PORTION_SECONDS, portionTicks, selectBoxes, selectMixer, settleBoxes, startChapter, stepChapter, TICK_HZ,
  type ChapterContent, type ChapterState, type GameEvent, type TickInput, type TiledMap,
} from '../../src/core/index.ts';
import { onHopper } from '../../src/core/rooms/boxes.ts';
import { readRoom } from '../../src/core/rooms/tiled.ts';

/**
 * The stomach's mixer (design doc 7.5, core/stomach/mixer.ts). Rooms are bare 20 x 12 floors as in
 * boxes.test.ts. The hopper covers tiles (10, 6) and (11, 6) and puts parcels out to the east, on
 * tile (12, 6). Boxes are dropped onto the hopper by editing the state, since a map may not start
 * a box there and the push itself is boxes.test.ts's business.
 */

const p = (name: string, value: string | number | boolean) => ({ name, value });
const NONE: TickInput = { move: { x: 0, y: 0 } };
const types = (events: readonly GameEvent[]) => events.map((e) => e.type);

const mapOf = (objects: object[], solid: readonly (readonly [number, number])[] = []) => ({
  width: 20, height: 12, tilewidth: 32, tileheight: 32,
  properties: [p('organ', 'stomach'), p('role', 'puzzle'), p('estSeconds', 10)],
  layers: [
    { type: 'tilelayer', name: 'walls', data: Array.from({ length: 240 }, (_, i) => (solid.some(([c, r]) => r * 20 + c === i) ? 1 : 0)) },
    { type: 'objectgroup', name: 'objects', objects: [{ id: 1, type: 'PlayerStart', x: 64, y: 360 }, ...objects] },
  ],
}) as unknown as TiledMap;

const food = (id: number, col: number, row: number, portion = 'normal') => ({
  id, type: 'Box', x: col * 32 + 16, y: row * 32 + 16, properties: [p('boxType', 'food'), p('portion', portion)],
});
const crate = (id: number, col: number, row: number) => ({ id, type: 'Box', x: col * 32 + 16, y: row * 32 + 16, properties: [] });
const MIXER_ID = 20;
const mixer = (props: object[] = [p('outlet', 'E')], col = 10, cols = 2) => ({ id: MIXER_ID, type: 'Mixer', x: col * 32, y: 6 * 32, width: cols * 32, height: 32, properties: props });
const port = (accepts: string, need = 1, col = 15) => ({
  id: 30, type: 'Port', x: col * 32, y: 9 * 32, width: 32, height: 32, properties: [p('need', need), p('accepts', accepts)],
});
const southDoor = { id: 2, type: 'Door', name: 'door-s', x: 288, y: 352, width: 64, height: 32, properties: [p('socket', 'S')] };
const northDoor = { id: 2, type: 'Door', name: 'door-n', x: 288, y: 0, width: 64, height: 96, properties: [p('socket', 'N')] };

function chapter(objects: object[]): ChapterContent {
  return {
    chapter: { version: 1, id: 'lab', start: 'lab/a', links: [{ a: 'lab/a#door-s', b: 'lab/b#door-n' }] },
    rooms: new Map([['lab/a', parseRoom('lab/a', mapOf([southDoor, ...objects]), TAGS)], ['lab/b', parseRoom('lab/b', mapOf([northDoor]), TAGS)]]),
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
const drop = (s: ChapterState, id: number, col: number, row: number): ChapterState =>
  ({ ...s, game: { ...s.game, boxes: s.game.boxes.map((b) => (b.id === id ? { ...b, col, row, left: 0, ticks: 0 } : b)) } });
const tiles = (s: ChapterState) => s.game.boxes.map((b) => [b.id, b.col, b.row]);

describe('digesting', () => {
  it('takes a food box in and puts it out as a parcel at the outlet after exactly its portion time', () => {
    for (const portion of ['small', 'normal', 'large'] as const) {
      const c = chapter([mixer(), food(3, 4, 4, portion)]);
      const fed = run(c, drop(startChapter(c), 3, 10, 6), 1);
      expect(fed.events).toContainEqual({ type: 'mixerFed', object: 3, mixer: MIXER_ID, portion, count: 1, capacity: 3 });
      // Inside the mixer the box is not in the room, and the mixer runs with no box left anywhere.
      expect(fed.state.game.boxes).toEqual([]);
      const ticks = portionTicks(portion);
      expect(ticks).toBe(PORTION_SECONDS[portion] * TICK_HZ);
      const before = run(c, fed.state, ticks - 1);
      expect(types(before.events)).not.toContain('parcelOut');
      expect(selectMixer(before.state.game)!.batches[0]!.done).toBeCloseTo(1 - 1 / ticks, 6);
      const out = run(c, before.state, 1);
      expect(out.events).toContainEqual({ type: 'parcelOut', object: 3, mixer: MIXER_ID, col: 12, row: 6 });
      expect(selectBoxes(out.state.game)).toEqual([{ object: 3, boxType: 'parcel', x: 12 * 32, y: 6 * 32 }]);
      expect(selectMixer(out.state.game)!.batches).toEqual([]);
    }
  });

  it('digests every box inside at once, and two that finish together come out in the order they went in', () => {
    const c = chapter([mixer(), food(3, 4, 4, 'large'), food(4, 5, 4, 'small'), food(5, 6, 4, 'small')]);
    let s = run(c, drop(startChapter(c), 3, 10, 6), 1).state;
    s = run(c, drop(drop(s, 5, 10, 6), 4, 11, 6), 1).state;
    expect(selectMixer(s.game)!.batches.map((b) => b.box)).toEqual([3, 4, 5]);
    const r = run(c, s, portionTicks('small'));
    expect(r.events.filter((e) => e.type === 'parcelOut').map((e) => (e as { object: number }).object)).toEqual([4, 5]);
    // The second parcel takes the nearest free tile to the outlet, which the first already holds.
    expect(tiles(r.state)).toEqual([[4, 12, 6], [5, 12, 5]]);
    const rest = run(c, r.state, portionTicks('large') - portionTicks('small') - 1);
    expect(types(rest.events)).toContain('parcelOut');
  });

  it('leaves other boxes and parcels on the hopper alone', () => {
    const c = chapter([mixer(), crate(3, 4, 4)]);
    const r = run(c, drop(startChapter(c), 3, 10, 6), 5);
    expect(types(r.events)).not.toContain('mixerFed');
    expect(tiles(r.state)).toEqual([[3, 10, 6]]);
    const parcel = { ...r.state, game: { ...r.state.game, boxes: [{ id: 3, col: 11, row: 6, left: 0, ticks: 0, boxType: 'parcel' }] } };
    expect(types(run(c, parcel, 5).events)).not.toContain('mixerFed');
  });
});

describe('jamming', () => {
  it('takes in up to its capacity, and the box after that throws every box back out undigested', () => {
    const c = chapter([mixer(), food(3, 4, 4), food(4, 5, 4), food(5, 6, 4), food(6, 7, 4)]);
    let s = startChapter(c);
    for (const id of [3, 4, 5]) s = run(c, drop(s, id, 10, 6), 1).state;
    expect(selectMixer(s.game)!.batches).toHaveLength(3);
    const r = run(c, drop(s, 6, 11, 6), 1);
    expect(r.events).toContainEqual({ type: 'mixerJammed', mixer: MIXER_ID, boxes: 4 });
    expect(types(r.events)).not.toContain('mixerFed');
    expect(selectMixer(r.state.game)!.batches).toEqual([]);
    // All four are food again, on floor tiles off the hopper, one to a tile.
    expect(r.state.game.boxes.map((b) => b.id)).toEqual([3, 4, 5, 6]);
    for (const b of selectBoxes(r.state.game)) expect(b.boxType).toBe('food');
    const at = r.state.game.boxes.map((b) => `${b.col},${b.row}`);
    expect(new Set(at).size).toBe(4);
    expect(at.some((t) => t === '10,6' || t === '11,6')).toBe(false);
    // Nothing goes back in by itself: the hopper is clear.
    expect(types(run(c, r.state, 3).events)).not.toContain('mixerFed');
  });

  it('never throws a box onto a belt, running or stopped, which could carry it straight back in', () => {
    // The in-belt runs east into the hopper from column 4; a stopped belt lies north of the hopper.
    const belt = (id: number, col: number, row: number, cols: number) =>
      ({ id, type: 'Conveyor', x: col * 32, y: row * 32, width: cols * 32, height: 32, properties: [p('direction', 'E')] });
    const lever = { id: 42, type: 'Switch', x: 2 * 32 + 16, y: 2 * 32 + 16 + 64, properties: [p('target', 41), p('mode', 'toggle')] };
    const c = chapter([mixer(), belt(40, 4, 6, 6), belt(41, 9, 5, 4), lever, food(3, 4, 9), food(4, 5, 9), food(5, 6, 9), food(6, 7, 9)]);
    let s = startChapter(c);
    for (const id of [3, 4, 5]) s = run(c, drop(s, id, 10, 6), 1).state;
    const r = run(c, drop(s, 6, 11, 6), 1);
    expect(types(r.events)).toContain('mixerJammed');
    for (const b of r.state.game.boxes) {
      expect(b.row === 6 && b.col >= 4 && b.col <= 9, `box ${b.id} on the in-belt`).toBe(false);
      expect(b.row === 5 && b.col >= 9 && b.col <= 12, `box ${b.id} on the stopped belt`).toBe(false);
    }
    expect(types(run(c, r.state, 120).events)).not.toContain('mixerFed');
  });

  it('follows the capacity the map sets', () => {
    const c = chapter([mixer([p('outlet', 'E'), p('capacity', 4)]), food(3, 4, 4), food(4, 5, 4), food(5, 6, 4), food(6, 7, 4), food(7, 8, 4)]);
    let s = startChapter(c);
    for (const id of [3, 4, 5, 6]) s = run(c, drop(s, id, 10, 6), 1).state;
    expect(selectMixer(s.game)!.batches).toHaveLength(4);
    expect(run(c, drop(s, 7, 10, 6), 1).events).toContainEqual({ type: 'mixerJammed', mixer: MIXER_ID, boxes: 5 });
  });
});

describe('the parcel port', () => {
  it('takes in parcels only, and a plain port still takes anything', () => {
    const c = chapter([mixer(), food(3, 4, 4, 'small'), port('parcel')]);
    const s = startChapter(c);
    const raw = run(c, drop(s, 3, 15, 9), 5);
    expect(types(raw.events)).not.toContain('boxDelivered');
    const fed = run(c, drop(s, 3, 10, 6), 1 + portionTicks('small'));
    const parcel = fed.state.game.boxes.find((b) => b.id === 3)!;
    expect(parcel.boxType).toBe('parcel');
    const delivered = run(c, drop(fed.state, 3, 15, 9), 1);
    expect(delivered.events).toContainEqual({ type: 'boxDelivered', object: 3, port: 30, count: 1, need: 1 });

    const plain = chapter([mixer(), food(3, 4, 4), port('any')]);
    expect(types(run(plain, drop(startChapter(plain), 3, 15, 9), 1).events)).toContain('boxDelivered');
  });
});

describe('leaving the room', () => {
  it('empties the mixer: the boxes it held start from home on the next visit', () => {
    const c = chapter([mixer(), food(3, 4, 4, 'large')]);
    const fed = run(c, drop(startChapter(c), 3, 10, 6), 1).state;
    expect(selectMixer(fed.game)!.batches).toHaveLength(1);
    // Out through the south door and back through the north door of the other room.
    const walk = (s: ChapterState, y: number, dy: number, room: string) => {
      let at: ChapterState = { ...s, game: { ...s.game, touching: [], operator: { ...s.game.operator, x: 320, y } } };
      for (let i = 0; i < 60 && at.run.roomId !== room; i++) at = stepChapter(c, at, { move: { x: 0, y: dy } }).state;
      return at;
    };
    const out = walk(fed, 330, 1, 'lab/b');
    expect(out.run.roomId).toBe('lab/b');
    const back = walk(out, 110, -1, 'lab/a');
    expect(back.run.roomId).toBe('lab/a');
    expect(selectMixer(back.game)!.batches).toEqual([]);
    expect(tiles(back)).toEqual([[3, 4, 4]]);
  });

  it('never settles a box back onto the hopper, even when its home is taken', () => {
    // Box 4 rests on the plate on box 3's home, so it keeps that tile; box 3 was last seen in the mixer.
    const plateOn3 = { id: 40, type: 'Switch', x: 4 * 32, y: 4 * 32, width: 32, height: 32, properties: [p('target', 41), p('mode', 'hold')] };
    const belt = { id: 41, type: 'Conveyor', x: 2 * 32, y: 9 * 32, width: 64, height: 32, properties: [] };
    const room = parseRoom('lab/a', mapOf([mixer(), food(3, 4, 4), food(4, 6, 4), plateOn3, belt]), TAGS);
    const placed = settleBoxes(room, new Map([[3, { col: 10, row: 6 }], [4, { col: 4, row: 4 }]]), []);
    expect(placed.find((b) => b.id === 4)).toMatchObject({ col: 4, row: 4 });
    const three = placed.find((b) => b.id === 3)!;
    expect(onHopper(room, three)).toBe(false);
  });

  it('remembers where it set a box down, so a door and a forced leave agree about a parcel left on a plate', () => {
    const plateAtOutlet = { id: 40, type: 'Switch', x: 12 * 32, y: 6 * 32, width: 32, height: 32, properties: [p('target', 41), p('mode', 'hold')] };
    const belt = { id: 41, type: 'Conveyor', x: 2 * 32, y: 9 * 32, width: 64, height: 32, properties: [] };
    const c = chapter([mixer(), food(3, 4, 4, 'small'), plateAtOutlet, belt]);
    const out = run(c, drop(startChapter(c), 3, 10, 6), 1 + portionTicks('small'));
    expect(out.events).toContainEqual({ type: 'boxMoved', object: 3, col: 12, row: 6, by: 'mixer' });
    expect(out.state.run.boxes).toContainEqual({ key: 'lab/a#3', col: 12, row: 6 });
    expect(out.state.game.switches).toContain(40);

    const walk = (s: ChapterState, y: number, dy: number, room: string) => {
      let at: ChapterState = { ...s, game: { ...s.game, touching: [], operator: { ...s.game.operator, x: 320, y } } };
      for (let i = 0; i < 60 && at.run.roomId !== room; i++) at = stepChapter(c, at, { move: { x: 0, y: dy } }).state;
      return at;
    };
    const back = walk(walk(out.state, 330, 1, 'lab/b'), 110, -1, 'lab/a');
    const died = run(c, { ...out.state, game: { ...out.state.game, operator: { ...out.state.game.operator, halves: 0 } } }, 1).state;
    for (const s of [back, died]) {
      // Food again, still on the plate, which stays down.
      expect(selectBoxes(s.game)).toEqual([{ object: 3, boxType: 'food', x: 12 * 32, y: 6 * 32 }]);
      expect(s.game.switches).toContain(40);
    }
  });

  it('empties it on a forced leave too', () => {
    const c = chapter([mixer(), food(3, 4, 4, 'large')]);
    const fed = run(c, drop(startChapter(c), 3, 10, 6), 1).state;
    const dying = { ...fed, game: { ...fed.game, operator: { ...fed.game.operator, halves: 0 } } };
    // A forced leave is the room's own reset; zero hearts trigger it on the next tick.
    const r = run(c, dying, 1);
    expect(types(r.events)).toContain('forcedLeave');
    expect(selectMixer(r.state.game)!.batches).toEqual([]);
    expect(tiles(r.state)).toEqual([[3, 4, 4]]);
  });
});

describe('the map check', () => {
  const codes = (objects: object[], solid: readonly (readonly [number, number])[] = []) =>
    readRoom('lab/a', mapOf(objects, solid), TAGS).problems.map((x) => x.code);

  it('accepts a mixer room', () => {
    expect(codes([mixer(), food(3, 4, 4), port('parcel')])).toEqual([]);
  });

  it('reports a point mixer, a second mixer, a mixer on walls and an outlet in a wall', () => {
    expect(codes([{ ...mixer(), width: 0, height: 0 }])).toEqual(['mixer-shape']);
    expect(codes([mixer(), { ...mixer(), id: 21, y: 8 * 32 }])).toEqual(['mixer-multiple']);
    expect(codes([mixer()], [[10, 6], [11, 6]])).toEqual(['mixer-wall']);
    // One wall tile is enough: the outlet and the throws are reckoned from the whole rectangle.
    expect(codes([mixer()], [[11, 6]])).toEqual(['mixer-wall']);
    expect(codes([mixer()], [[12, 6]])).toEqual(['mixer-outlet']);
    // East of column 18 is the map's edge.
    expect(codes([mixer([p('outlet', 'E')], 18, 1)], [])).toEqual([]);
    expect(codes([mixer([p('outlet', 'E')], 19, 1)])).toEqual(['mixer-outlet']);
  });

  it('reports a parcel port without a mixer, and counts only food boxes toward its need', () => {
    expect(codes([food(3, 4, 4), port('parcel')])).toEqual(['port-parcel']);
    expect(codes([mixer(), crate(3, 4, 4), port('parcel')])).toEqual(['port-need']);
    expect(codes([mixer(), crate(3, 4, 4), food(4, 5, 4), port('parcel')])).toEqual([]);
  });

  it('reports a box that starts on the hopper', () => {
    expect(codes([mixer(), food(3, 10, 6)])).toEqual(['box-blocked']);
  });

  it('reports a mixer in a variant layer, so a parcel port is never judged against a mixer that can be absent', () => {
    const map = mapOf([food(3, 4, 4), port('parcel')]) as unknown as { layers: object[] };
    map.layers.push({ type: 'objectgroup', name: 'variant:fed', properties: [p('when', 'breakfast')], objects: [mixer()] });
    expect(readRoom('lab/a', map as unknown as TiledMap, TAGS).problems.map((x) => x.code)).toEqual(['mixer-variant']);
  });

  it('reports a trigger, port or switch over the hopper', () => {
    const trigger = { id: 40, type: 'Trigger', x: 11 * 32, y: 6 * 32, width: 32, height: 32, properties: [p('event', 'checkpoint')] };
    expect(codes([mixer(), trigger])).toEqual(['mixer-blocked']);
    expect(codes([mixer(), food(3, 4, 4), { ...port('any'), x: 10 * 32, y: 6 * 32 }])).toEqual(['mixer-blocked']);
    const belt = { id: 41, type: 'Conveyor', x: 2 * 32, y: 9 * 32, width: 64, height: 32, properties: [] };
    const plate = { id: 42, type: 'Switch', x: 10 * 32, y: 6 * 32, width: 32, height: 32, properties: [p('target', 41), p('mode', 'hold')] };
    expect(codes([mixer(), belt, plate])).toEqual(['mixer-blocked']);
  });

  it('reports a mixer over the liver dock', () => {
    const line = (id: number, stage: string, col: number, row: number, cols = 0) => (cols > 0
      ? { id, type: 'Line', x: col * 32, y: row * 32, width: cols * 32, height: 32, properties: [p('stage', stage)] }
      : { id, type: 'Line', x: col * 32 + 16, y: row * 32 + 16, properties: [p('stage', stage)] });
    const factory = [line(50, 'receiving', 11, 6, 3), line(51, 'outlet', 15, 8), line(52, 'intake', 3, 9, 2)];
    expect(codes([mixer([p('outlet', 'S')]), ...factory])).toContain('dock-blocked');
  });
});
