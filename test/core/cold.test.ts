import { describe, expect, it } from 'vitest';
import { BOSSES, DIALOGUES, ENEMIES, PARAMS, TAGS } from '../../src/app/content.ts';
import {
  parseRoom, selectPort, settleBoxes, startChapter, stepChapter,
  type ChapterContent, type ChapterState, type GameEvent, type TickInput, type TiledMap,
} from '../../src/core/index.ts';
import { readRoom } from '../../src/core/rooms/tiled.ts';

/**
 * The stomach's cold store (design doc 7.5, the late-night puzzle). Rooms are bare 20 x 12 floors as
 * in mixer.test.ts; the cold store covers tiles (14, 6) to (14, 7), and boxes are dropped on it by
 * editing the state, since the push and the belts are boxes.test.ts's business.
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

const food = (id: number, col: number, row: number) => ({
  id, type: 'Box', x: col * 32 + 16, y: row * 32 + 16, properties: [p('boxType', 'food'), p('portion', 'small')],
});
const crate = (id: number, col: number, row: number) => ({ id, type: 'Box', x: col * 32 + 16, y: row * 32 + 16, properties: [] });
const STORE = 50;
const cold = (id = STORE, col = 14, row = 6, cols = 1, rows = 2) =>
  ({ id, type: 'ColdStore', x: col * 32, y: row * 32, width: cols * 32, height: rows * 32, properties: [] });
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

function until(c: ChapterContent, s: ChapterState, input: TickInput, type: GameEvent['type']): ChapterState {
  for (let n = 0; n < 300; n++) {
    const r = stepChapter(c, s, input);
    s = r.state;
    if (r.events.some((e) => e.type === type)) return s;
  }
  throw new Error(`no ${type}`);
}

const drop = (s: ChapterState, id: number, col: number, row: number): ChapterState =>
  ({ ...s, game: { ...s.game, boxes: s.game.boxes.map((b) => (b.id === id ? { ...b, col, row, left: 0, ticks: 0 } : b)) } });
const place = (s: ChapterState, x: number, y: number): ChapterState =>
  ({ ...s, game: { ...s.game, touching: [], operator: { ...s.game.operator, x, y, vx: 0, vy: 0 } } });
const tiles = (s: ChapterState) => s.game.boxes.map((b) => [b.id, b.col, b.row]);

describe('the cold store', () => {
  it('chills a food box that comes to rest on it, and lets any other box rest there like on floor', () => {
    const c = chapter([cold(), food(3, 4, 4), crate(4, 5, 4), food(5, 6, 4)]);
    const r = run(c, drop(drop(drop(startChapter(c), 3, 14, 6), 4, 14, 7), 5, 13, 6), 1);
    expect(r.events).toContainEqual({ type: 'boxChilled', object: 3, store: STORE });
    expect(r.state.game.chilled).toEqual([3]);
    expect(tiles(r.state)).toEqual([[4, 14, 7], [5, 13, 6]]);
    // A box still sliding onto it is not chilled until it stops.
    const sliding = { ...r.state, game: { ...r.state.game, boxes: r.state.game.boxes.map((b) => (b.id === 5 ? { ...b, col: 14, row: 6, left: 2, ticks: 12 } : b)) } };
    expect(types(run(c, sliding, 1).events)).not.toContain('boxChilled');
    expect(run(c, sliding, 2).events).toContainEqual({ type: 'boxChilled', object: 5, store: STORE });
    // The crate stays where it rests, and so does a parcel: it is already digested.
    const later = run(c, r.state, 60);
    expect(types(later.events)).not.toContain('boxChilled');
    expect(tiles(later.state)).toContainEqual([4, 14, 7]);
    const parcel = { ...r.state, game: { ...r.state.game, boxes: [{ id: 5, col: 14, row: 6, left: 0, ticks: 0, boxType: 'parcel' }] } };
    const kept = run(c, parcel, 5);
    expect(types(kept.events)).not.toContain('boxChilled');
    expect(tiles(kept.state)).toEqual([[5, 14, 6]]);
  });

  it('stays chilled after a return to a time clock punched before it was chilled', () => {
    const clock = { id: 9, type: 'Trigger', x: 32, y: 96, width: 32, height: 32, properties: [p('event', 'checkpoint')] };
    const c = chapter([cold(), clock, food(3, 4, 4)]);
    const punched = until(c, place(startChapter(c), 48, 120), NONE, 'checkpointSaved');
    const chilled = run(c, drop(punched, 3, 14, 6), 1).state;
    expect(chilled.game.chilled).toEqual([3]);
    const dying = { ...chilled, game: { ...chilled.game, operator: { ...chilled.game.operator, halves: 0 } } };
    const r = run(c, dying, 1);
    expect(types(r.events)).toContain('returnedToCheckpoint');
    expect(r.state.game.chilled).toEqual([3]);
    expect(r.state.game.boxes).toEqual([]);
  });

  it('keeps a chilled box gone for the chapter, through a door and a forced leave, and no port counts it', () => {
    const port = { id: 30, type: 'Port', x: 17 * 32, y: 2 * 32, width: 32, height: 32, properties: [p('need', 1)] };
    const c = chapter([cold(), port, food(3, 4, 4), crate(4, 5, 4)]);
    const chilled = run(c, drop(startChapter(c), 3, 14, 6), 1).state;
    expect(chilled.run.fired).toEqual(['lab/a#chilled.3']);
    const away = until(c, place(chilled, 320, 340), { move: { x: 0, y: 1 } }, 'roomChanged');
    expect(away.run.roomId).toBe('lab/b');
    const back = until(c, place(away, 320, 110), { move: { x: 0, y: -1 } }, 'roomChanged');
    expect(back.run.roomId).toBe('lab/a');
    expect(back.game.chilled).toEqual([3]);
    expect(back.game.delivered).toEqual([]);
    expect(tiles(back).map(([id]) => id)).toEqual([4]);
    expect(selectPort(back.game)).toMatchObject({ count: 0, need: 1 });
    const dying = { ...back, game: { ...back.game, operator: { ...back.game.operator, halves: 0 } } };
    const left = run(c, dying, 1);
    expect(types(left.events)).toContain('forcedLeave');
    expect(left.state.game.chilled).toEqual([3]);
    expect(tiles(left.state).map(([id]) => id)).toEqual([4]);
  });

  it('is never where a jammed mixer throws a box, since chilling it is the player\'s choice', () => {
    const mixer = { id: 20, type: 'Mixer', x: 10 * 32, y: 6 * 32, width: 64, height: 32, properties: [p('outlet', 'E'), p('capacity', 1)] };
    // Cold stores ring the hopper, so the nearest free tiles of a throw are all cold.
    const ring = [cold(51, 9, 5, 4, 1), cold(52, 9, 7, 4, 1), cold(53, 9, 6, 1, 1), cold(54, 12, 6, 1, 1)];
    const c = chapter([mixer, ...ring, food(3, 4, 4), food(4, 5, 4)]);
    const fed = run(c, drop(startChapter(c), 3, 10, 6), 1).state;
    const jammed = run(c, drop(fed, 4, 11, 6), 1);
    expect(types(jammed.events)).toContain('mixerJammed');
    const after = run(c, jammed.state, 5);
    expect(types(after.events)).not.toContain('boxChilled');
    expect(after.state.game.chilled).toEqual([]);
    expect(tiles(after.state)).toHaveLength(2);
  });

  it('is never where a box is set down on entry, even one last seen sliding onto it', () => {
    const room = chapter([cold(), food(3, 8, 6)]).rooms.get('lab/a')!;
    const home = { left: 8 * 32, top: 6 * 32, right: 9 * 32, bottom: 7 * 32 };
    const [b] = settleBoxes(room, new Map([[3, { col: 14, row: 6 }]]), [home]);
    expect(b!.col === 14 && (b!.row === 6 || b!.row === 7)).toBe(false);
    // Nor on the nearest free tile, when every neighbour of a blocked home is a cold store.
    const ringed = chapter([cold(51, 13, 5, 1, 1), cold(52, 13, 7, 1, 1), cold(53, 12, 6, 1, 1), cold(54, 14, 6, 1, 1), food(3, 13, 6)]).rooms.get('lab/a')!;
    const blocked = { left: 13 * 32, top: 6 * 32, right: 14 * 32, bottom: 7 * 32 };
    const [n] = settleBoxes(ringed, new Map(), [blocked]);
    expect([[13, 5], [13, 7], [12, 6], [14, 6]]).not.toContainEqual([n!.col, n!.row]);
  });
});

describe('the map check', () => {
  const codes = (objects: object[], solid: readonly (readonly [number, number])[] = []) =>
    readRoom('lab/a', mapOf([...objects, food(3, 4, 4)], solid), TAGS).problems.map((x) => x.code);
  const belt = { id: 40, type: 'Conveyor', x: 13 * 32, y: 6 * 32, width: 64, height: 32, properties: [p('direction', 'E')] };
  const port = { id: 30, type: 'Port', x: 14 * 32, y: 7 * 32, width: 32, height: 32, properties: [p('need', 1)] };
  const mixer = { id: 20, type: 'Mixer', x: 14 * 32, y: 6 * 32, width: 32, height: 32, properties: [p('outlet', 'W')] };
  const bed = { id: 60, type: 'Bed', x: 14 * 32, y: 7 * 32, width: 32, height: 32, properties: [p('bedType', 'sleep')] };
  const plate = { id: 61, type: 'Switch', x: 14 * 32, y: 6 * 32, width: 32, height: 32, properties: [p('target', 0), p('mode', 'hold')] };

  it('passes a cold store on floor with nothing over it', () => {
    expect(codes([cold()])).toEqual([]);
    expect(codes([cold(), { ...belt, x: 12 * 32 }])).toEqual([]);
  });

  it('reports a point or too small a rectangle, and one all on walls', () => {
    expect(codes([{ ...cold(), width: 0, height: 0 }])).toEqual(['cold-shape']);
    expect(codes([{ ...cold(), width: 10, height: 10 }])).toEqual(['cold-shape']);
    expect(codes([cold()], [[14, 6], [14, 7]])).toEqual(['cold-wall']);
    expect(codes([cold()], [[14, 6]])).toEqual([]);
  });

  it('reports a belt, port, mixer, bed, door, trigger, pickup or plate over it, and a box drawn on it', () => {
    const door = { id: 62, type: 'Door', name: 'door-e', x: 19 * 32, y: 6 * 32, width: 32, height: 64, properties: [p('socket', 'E')] };
    const trigger = { id: 63, type: 'Trigger', x: 14 * 32, y: 6 * 32, width: 32, height: 32, properties: [p('event', 'checkpoint')] };
    const pickup = { id: 64, type: 'Pickup', x: 14 * 32 + 16, y: 7 * 32 + 16, properties: [p('itemType', 'coffee')] };
    for (const x of [belt, port, mixer, bed, trigger, pickup, plate]) expect(codes([cold(), x])).toContain('cold-blocked');
    expect(codes([cold(51, 18, 6, 2, 2), door])).toContain('cold-blocked');
    expect(codes([cold(), crate(5, 14, 6)])).toEqual(['box-blocked']);
  });

  it('lets a cold store share tiles with what can never be in the room on the same visit', () => {
    const map = mapOf([food(3, 4, 4)]) as unknown as { layers: object[] };
    map.layers.push({ type: 'objectgroup', name: 'variant:fed', properties: [p('when', 'breakfast')], objects: [cold()] });
    map.layers.push({ type: 'objectgroup', name: 'variant:hungry', properties: [p('when', '!breakfast')], objects: [bed] });
    expect(readRoom('lab/a', map as unknown as TiledMap, TAGS).problems.map((x) => x.code)).toEqual([]);
    map.layers.pop();
    map.layers.push({ type: 'objectgroup', name: 'variant:late', properties: [p('when', 'sleep_debt>=3')], objects: [bed] });
    expect(readRoom('lab/a', map as unknown as TiledMap, TAGS).problems.map((x) => x.code)).toEqual(['cold-blocked']);
  });

  it('reports a cold store over the liver dock', () => {
    const line = (id: number, stage: string, col: number, row: number, cols = 0) => (cols > 0
      ? { id, type: 'Line', x: col * 32, y: row * 32, width: cols * 32, height: 32, properties: [p('stage', stage)] }
      : { id, type: 'Line', x: col * 32 + 16, y: row * 32 + 16, properties: [p('stage', stage)] });
    const factory = [line(70, 'receiving', 13, 6, 3), line(71, 'outlet', 15, 9), line(72, 'intake', 3, 9, 2)];
    expect(codes([cold(), ...factory])).toContain('dock-blocked');
  });
});
