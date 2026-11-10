import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOSSES, CHAPTERS, DIALOGUES, ENEMIES, PARAMS, RESCUES, TAGS } from '../../src/app/content.ts';
import {
  CHUNK, chunksOf, parseRoom, roomsOf, selectChunks, startChapter, stepChapter, UNLOAD,
  type ChapterContent, type ChapterState, type GameEvent, type TickInput, type TiledMap,
} from '../../src/core/index.ts';
import { isSolid } from '../../src/core/collision/grid.ts';
import { withBoxes, type BoxState } from '../../src/core/rooms/boxes.ts';
import { readRoom } from '../../src/core/rooms/tiled.ts';
import { createGame } from '../../src/core/index.ts';
import { enterRoom } from '../../src/core/rooms/entry.ts';

/**
 * Food chunks (design doc 6.2, 7.5): a rectangle of solid tiles that the logistics chief's acid
 * dissolves once it has lain on it for 1.5 seconds. Rooms are bare 20 x 12 floors as in cold.test.ts;
 * the chunk covers tiles (8, 5) to (9, 7), and the operator stands three tiles west of it, aiming at it.
 */

const p = (name: string, value: string | number | boolean) => ({ name, value });
const NONE: TickInput = { move: { x: 0, y: 0 } };
const SPIT: TickInput = { move: { x: 0, y: 0 }, partnerPressed: true };
const types = (events: readonly GameEvent[]) => events.map((e) => e.type);

const mapOf = (objects: object[], solid: readonly (readonly [number, number])[] = []) => ({
  width: 20, height: 12, tilewidth: 32, tileheight: 32,
  properties: [p('organ', 'stomach'), p('role', 'puzzle'), p('estSeconds', 10)],
  layers: [
    { type: 'tilelayer', name: 'walls', data: Array.from({ length: 240 }, (_, i) => (solid.some(([c, r]) => r * 20 + c === i) ? 1 : 0)) },
    { type: 'objectgroup', name: 'objects', objects: [{ id: 1, type: 'PlayerStart', x: 64, y: 360 }, ...objects] },
  ],
}) as unknown as TiledMap;

const CHUNK_ID = 50;
const chunk = (id = CHUNK_ID, col = 8, row = 5, cols = 2, rows = 3) =>
  ({ id, type: 'Chunk', x: col * 32, y: row * 32, width: cols * 32, height: rows * 32, properties: [] });
const food = (id: number, col: number, row: number) => ({
  id, type: 'Box', x: col * 32 + 16, y: row * 32 + 16, properties: [p('boxType', 'food'), p('portion', 'small')],
});
const southDoor = { id: 2, type: 'Door', name: 'door-s', x: 288, y: 352, width: 64, height: 32, properties: [p('socket', 'S')] };
const northDoor = { id: 2, type: 'Door', name: 'door-n', x: 288, y: 0, width: 64, height: 96, properties: [p('socket', 'N')] };
const clock = { id: 9, type: 'Trigger', x: 32, y: 96, width: 32, height: 32, properties: [p('event', 'checkpoint')] };

function chapter(objects: object[], partner: 'logistics' | 'chairman' | 'none' = 'logistics'): ChapterContent {
  return {
    chapter: { version: 1, id: 'lab', start: 'lab/a', ...(partner === 'none' ? {} : { partner }), links: [{ a: 'lab/a#door-s', b: 'lab/b#door-n' }] },
    rooms: new Map([['lab/a', parseRoom('lab/a', mapOf([southDoor, ...objects]), TAGS)], ['lab/b', parseRoom('lab/b', mapOf([northDoor]), TAGS)]]),
    dialogues: DIALOGUES, dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS,
  };
}

function run(c: ChapterContent, s: ChapterState, n: number, input: TickInput | ((t: number) => TickInput) = NONE): { state: ChapterState; events: GameEvent[][] } {
  const events: GameEvent[][] = [];
  for (let i = 0; i < n; i++) {
    const r = stepChapter(c, s, typeof input === 'function' ? input(i) : input);
    s = r.state;
    events.push([...r.events]);
  }
  return { state: s, events };
}
const ticksOf = (events: readonly (readonly GameEvent[])[], type: GameEvent['type']) => events.flatMap((es, t) => (es.some((e) => e.type === type) ? [t] : []));

/** The operator three tiles west of the chunk, aiming east: the acid spat from here covers its west face. */
const stand = (s: ChapterState, x = 208, y = 208): ChapterState =>
  ({ ...s, game: { ...s.game, touching: [], operator: { ...s.game.operator, x, y, vx: 0, vy: 0, aim: { x: 1, y: 0 } } } });
const spitAt = (t: number): TickInput => ({ move: { x: 0, y: 0 }, partnerPressed: t === 0 });
const solidAt = (s: ChapterState, col: number, row: number) => isSolid(s.game.room.grid, col, row);
const TILES: readonly (readonly [number, number])[] = [[8, 5], [9, 5], [8, 6], [9, 6], [8, 7], [9, 7]];

describe('the food chunk in the room', () => {
  it('is solid like a wall from the start, on exactly the tiles whose centre it covers', () => {
    const c = chapter([chunk()]);
    const s = startChapter(c);
    for (const [col, row] of TILES) expect(solidAt(s, col, row)).toBe(true);
    expect(s.game.room.grid.solid.filter(Boolean)).toHaveLength(TILES.length);
    expect(s.game.dissolved).toEqual([]);
    expect(chunksOf(s.game.room).map((x) => [x.object.id, x.tiles.length])).toEqual([[CHUNK_ID, 6]]);
  });

  it('stops the operator, and lets them through once it is dissolved', () => {
    const c = chapter([chunk(), food(3, 3, 9)]);
    const start = stand(startChapter(c));
    const stopped = run(c, start, 200, { move: { x: 1, y: 0 } }).state;
    expect(stopped.game.operator.x).toBeLessThan(8 * 32);
    const opened = run(c, stand(startChapter(c)), CHUNK.dissolveTicks + 2, spitAt).state;
    // The room holds a box, so this also runs on the grid the boxes are laid over.
    expect(opened.game.boxes.length).toBeGreaterThan(0);
    const through = run(c, opened, 200, { move: { x: 1, y: 0 } }).state;
    expect(through.game.operator.x).toBeGreaterThan(10 * 32);
  });
});

describe('dissolving it with the acid', () => {
  it('opens its tiles on the tick the acid has lain 1.5 s, and tells the room once', () => {
    const c = chapter([chunk()]);
    const r = run(c, stand(startChapter(c)), UNLOAD.ticks, spitAt);
    expect(CHUNK.dissolveTicks).toBe(Math.round(1.5 * 60));
    expect(ticksOf(r.events, 'chunkDissolved')).toEqual([CHUNK.dissolveTicks - 1]);
    expect(r.events[CHUNK.dissolveTicks - 1]).toContainEqual({ type: 'chunkDissolved', object: CHUNK_ID });
    expect(r.state.game.dissolved).toEqual([CHUNK_ID]);
    for (const [col, row] of TILES) expect(solidAt(r.state, col, row)).toBe(false);
    // One tick before, the chunk is still a wall.
    const before = run(c, stand(startChapter(c)), CHUNK.dissolveTicks - 1, spitAt).state;
    for (const [col, row] of TILES) expect(solidAt(before, col, row)).toBe(true);
    expect(before.game.dissolved).toEqual([]);
  });

  it('is judged on the acid\'s own clock, to the tick', () => {
    const c = chapter([chunk()]);
    const lying = (ticksLeft: number, x = 208): ChapterState => {
      const s = stand(startChapter(c));
      return { ...s, game: { ...s.game, unload: { ticksLeft, cooldown: 400, x, y: 208, dir: { x: 1, y: 0 } } } };
    };
    // Age 89 now, age 90 after the tick.
    const at = UNLOAD.ticks - CHUNK.dissolveTicks + 2;
    expect(run(c, lying(at), 1).state.game.dissolved).toEqual([CHUNK_ID]);
    expect(run(c, lying(at + 1), 1).state.game.dissolved).toEqual([]);
    // Past the age it does not go off again, and an acid that is not on the chunk never does.
    expect(run(c, lying(at - 1), 1).events.flat().map((e) => e.type)).not.toContain('chunkDissolved');
    expect(run(c, lying(at, 16), 1).state.game.dissolved).toEqual([]);
  });

  it('takes a chunk the acid only touches, whole, and leaves one it does not cover', () => {
    const far = chunk(51, 14, 2, 2, 2);
    const c = chapter([chunk(), far]);
    // The acid spat from (208, 208) reaches x = 312: the chunk's two columns, not the other one.
    const r = run(c, stand(startChapter(c)), CHUNK.dissolveTicks, spitAt).state;
    expect(r.game.dissolved).toEqual([CHUNK_ID]);
    expect(solidAt(r, 14, 2)).toBe(true);
    const edge = run(c, stand(startChapter(c), 208 + 40, 208), CHUNK.dissolveTicks, spitAt).state;
    expect(edge.game.dissolved).toEqual([CHUNK_ID]);
    for (const [col, row] of TILES) expect(solidAt(edge, col, row)).toBe(false);
  });

  it('needs the chapter\'s partner: without the logistics chief there is no acid, and the chunk stays', () => {
    for (const partner of ['none', 'chairman'] as const) {
      const c = chapter([chunk()], partner);
      const r = run(c, stand(startChapter(c)), 300, spitAt);
      expect(types(r.events.flat())).not.toContain('chunkDissolved');
      expect(solidAt(r.state, 8, 5)).toBe(true);
    }
  });

  it('shows the view how far the acid has got on each chunk', () => {
    const c = chapter([chunk(), chunk(51, 14, 2, 2, 2)]);
    const s = stand(startChapter(c));
    expect(selectChunks(s.game)).toEqual([
      { object: CHUNK_ID, dissolved: false, melting: 0 }, { object: 51, dissolved: false, melting: 0 },
    ]);
    const half = run(c, s, CHUNK.dissolveTicks / 2, spitAt).state.game;
    expect(selectChunks(half)[0]!.melting).toBeCloseTo(0.5, 6);
    expect(selectChunks(half)[1]!.melting).toBe(0);
    const done = run(c, s, CHUNK.dissolveTicks, spitAt).state.game;
    expect(selectChunks(done)[0]).toEqual({ object: CHUNK_ID, dissolved: true, melting: 0 });
  });
});

describe('a dissolved chunk stays dissolved', () => {
  it('is kept in the run, so the next visit starts with it gone, and through a forced leave', () => {
    const c = chapter([chunk(), clock]);
    const punched = (() => {
      let s = stand(startChapter(c), 48, 120);
      for (let n = 0; n < 300; n++) {
        const r = stepChapter(c, s, NONE);
        s = r.state;
        if (r.events.some((e) => e.type === 'checkpointSaved')) return s;
      }
      throw new Error('no checkpoint');
    })();
    const open = run(c, stand(punched), CHUNK.dissolveTicks, spitAt).state;
    expect(open.run.fired).toContain(`lab/a#dissolved.${CHUNK_ID}`);
    const dying = { ...open, game: { ...open.game, operator: { ...open.game.operator, halves: 0 } } };
    const back = run(c, dying, 1);
    expect(types(back.events.flat())).toContain('returnedToCheckpoint');
    expect(back.state.game.dissolved).toEqual([CHUNK_ID]);
    for (const [col, row] of TILES) expect(solidAt(back.state, col, row)).toBe(false);
  });

  it('is remembered under a key no pickup, box or port reads as an object id', () => {
    const c = chapter([chunk()]);
    const open = run(c, stand(startChapter(c)), CHUNK.dissolveTicks, spitAt).state;
    expect(open.game.taken).toEqual([]);
    expect(open.game.delivered).toEqual([]);
    expect(open.game.chilled).toEqual([]);
  });

  it('is brought in by a game that starts with it dissolved, ignoring ids that are not chunks', () => {
    const room = enterRoom(parseRoom('lab/a', mapOf([chunk(), food(3, 3, 9)]), TAGS), { values: {} } as never, TAGS);
    const g = createGame(room, 1, ENEMIES, { dissolved: [CHUNK_ID, 3, 99] });
    expect(g.dissolved).toEqual([CHUNK_ID]);
    for (const [col, row] of TILES) expect(isSolid(g.room.grid, col, row)).toBe(false);
    const closed = createGame(room, 1, ENEMIES);
    for (const [col, row] of TILES) expect(isSolid(closed.room.grid, col, row)).toBe(true);
  });
});

describe('the grid the boxes are laid over', () => {
  it('follows a new room grid under boxes that did not move', () => {
    const boxes: readonly BoxState[] = [{ id: 3, col: 3, row: 9, left: 0, ticks: 0 }];
    const closed = { cols: 4, rows: 4, solid: [true, true, false, false, false, false, false, false, false, false, false, false, false, false, false, false] };
    const open = { cols: 4, rows: 4, solid: closed.solid.map(() => false) };
    expect(withBoxes(closed, boxes).solid[0]).toBe(true);
    expect(withBoxes(open, boxes).solid[0]).toBe(false);
    expect(withBoxes(closed, boxes).solid[0]).toBe(true);
    // The same grid and boxes give the same answer, which is what the cache is for.
    expect(withBoxes(open, boxes)).toBe(withBoxes(open, boxes));
  });
});

describe('the map check', () => {
  const codes = (objects: object[], solid: readonly (readonly [number, number])[] = []) =>
    readRoom('lab/a', mapOf(objects, solid), TAGS).problems.map((x) => x.code);
  const at = (type: string, col: number, row: number, extra: object[] = []) =>
    ({ id: 60, type, x: col * 32 + 16, y: row * 32 + 16, properties: extra });
  const area = (id: number, type: string, col: number, row: number, cols: number, rows: number, props: object[] = []) =>
    ({ id, type, x: col * 32, y: row * 32, width: cols * 32, height: rows * 32, properties: props });

  it('passes a chunk on floor with nothing over it, and lets a trigger span it', () => {
    expect(codes([chunk()])).toEqual([]);
    expect(codes([chunk(), area(61, 'Trigger', 7, 5, 4, 3, [p('event', 'checkpoint')])])).toEqual([]);
    expect(codes([chunk(), chunk(51, 10, 5, 1, 3)])).toEqual([]);
  });

  it('reports a point or too small a rectangle', () => {
    expect(codes([{ ...chunk(), width: 0, height: 0 }])).toEqual(['chunk-shape']);
    expect(codes([{ ...chunk(), width: 10, height: 10 }])).toEqual(['chunk-shape']);
  });

  it('reports a chunk on a variant layer, since it is baked into the walls', () => {
    const map = mapOf([]) as unknown as { layers: object[] };
    map.layers.push({ type: 'objectgroup', name: 'variant:fed', properties: [p('when', 'breakfast')], objects: [chunk()] });
    expect(readRoom('lab/a', map as unknown as TiledMap, TAGS).problems.map((x) => x.code)).toEqual(['chunk-variant']);
  });

  it('reports a chunk with a tile on a wall, off the map, or on the liver dock, since dissolving it would open that wall', () => {
    expect(codes([chunk()], [[9, 6]])).toEqual(['chunk-wall']);
    expect(codes([chunk(50, 19, 5, 2, 1)])).toEqual(['chunk-wall']);
    const line = (id: number, stage: string, col: number, row: number, cols = 0) => (cols > 0
      ? { id, type: 'Line', x: col * 32, y: row * 32, width: cols * 32, height: 32, properties: [p('stage', stage)] }
      : { id, type: 'Line', x: col * 32 + 16, y: row * 32 + 16, properties: [p('stage', stage)] });
    const factory = [line(70, 'receiving', 8, 6, 2), line(71, 'outlet', 15, 9), line(72, 'intake', 3, 9, 2)];
    expect(codes([chunk(), ...factory])).toContain('chunk-wall');
  });

  it('reports two chunks that share a tile', () => {
    expect(codes([chunk(), chunk(51, 9, 7, 2, 1)])).toEqual(['chunk-overlap']);
  });

  it('reports what stands on a chunk or covers its tiles, and a box drawn on it', () => {
    const door = area(62, 'Door', 8, 5, 1, 2, [p('socket', 'E')]);
    for (const x of [
      at('PlayerStart', 8, 5), at('NPC', 8, 5), at('Pickup', 9, 6, [p('itemType', 'coffee')]), at('Bed', 8, 6, [p('bedType', 'sleep')]),
      at('Spawn', 9, 7, [p('enemyType', 'salesman')]), area(63, 'Switch', 9, 5, 1, 1, [p('target', 0), p('mode', 'hold')]), door,
      area(64, 'Conveyor', 7, 6, 3, 1, [p('direction', 'E')]), area(65, 'Port', 9, 6, 1, 1, [p('need', 1)]),
      area(66, 'Mixer', 8, 7, 2, 1, [p('outlet', 'W')]), area(67, 'ColdStore', 9, 5, 1, 1),
    ]) expect(codes([chunk(), x, food(3, 2, 9)]), x.type).toContain('chunk-blocked');
    // The second line's mouth takes boxes in, so it is one of the objects that cover tiles; the dock is solid already, which is a chunk-wall.
    const line = (id: number, stage: string, col: number, row: number, cols = 0) => (cols > 0
      ? { id, type: 'Line', x: col * 32, y: row * 32, width: cols * 32, height: 32, properties: [p('stage', stage)] }
      : { id, type: 'Line', x: col * 32 + 16, y: row * 32 + 16, properties: [p('stage', stage)] });
    expect(codes([chunk(), line(70, 'receiving', 3, 9, 2), line(71, 'outlet', 15, 9), line(72, 'intake', 8, 6, 2)])).toContain('chunk-blocked');
    expect(codes([chunk(), food(3, 8, 6)])).toEqual(['box-wall']);
    // Next to it is fine.
    expect(codes([chunk(), area(64, 'Conveyor', 5, 6, 3, 1, [p('direction', 'E')]), food(3, 7, 6)])).not.toContain('chunk-blocked');
  });
});

describe("the stomach chapter's night lab", () => {
  const loadMap = (path: string) => JSON.parse(readFileSync(`public/assets/maps/${path}.tmj`, 'utf8')) as TiledMap;
  const chapterFile = CHAPTERS.get('stomach')!;
  const content: ChapterContent = {
    chapter: chapterFile,
    rooms: new Map(roomsOf(chapterFile).map((path) => [path, parseRoom(path, loadMap(path), TAGS)])),
    dialogues: DIALOGUES, dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS, rescues: RESCUES,
  };
  const POCKET_WALLS: readonly (readonly [number, number])[] = [[16, 3], [16, 4], [17, 5], [18, 5]];

  it('keeps the pocket sealed against a body pushing in at every side and at the open corner', () => {
    const { pending: _, ...s } = startChapter(content, { room: 'stomach/night-lab' });
    const pushIn = (col: number, row: number, move: { x: number; y: number }) => {
      const from = { ...s, game: { ...s.game, touching: [], operator: { ...s.game.operator, x: col * 32 + 16, y: row * 32 + 16 } } };
      const op = run(content, from, 150, { move }).state.game.operator;
      return [Math.floor(op.x / 32), Math.floor(op.y / 32)];
    };
    const inPocket = ([col, row]: number[]) => col! >= 17 && row! >= 3 && row! <= 4;
    // Up and right from the open corner tile (16, 5), the diagonal between the two chunks; east from beside the west chunk; north from under the south one.
    for (const [col, row, move] of [[16, 5, { x: 1, y: -1 }], [15, 4, { x: 1, y: 0 }], [15, 3, { x: 1, y: 0 }], [17, 6, { x: 0, y: -1 }], [18, 6, { x: 0, y: -1 }]] as const) {
      expect(inPocket(pushIn(col, row, move)), `${col},${row}`).toBe(false);
    }
  });

  it('keeps a spare portion behind two chunks that one spit from the south opens for good', () => {
    const { pending: _, ...s } = startChapter(content, { room: 'stomach/night-lab' });
    expect(chunksOf(s.game.room).map((x) => x.object.id)).toEqual([13, 14]);
    const box = s.game.boxes.find((b) => b.id === 12)!;
    expect([box.col, box.row]).toEqual([17, 3]);
    // Walled in: the pocket's only ways out are the chunks.
    expect(POCKET_WALLS.map(([col, row]) => solidAt(s, col, row))).toEqual([true, true, true, true]);
    const below = { ...s, game: { ...s.game, touching: [], operator: { ...s.game.operator, x: 17 * 32 + 16, y: 7 * 32 + 16, aim: { x: 0, y: -1 } } } };
    const r = run(content, below, CHUNK.dissolveTicks, spitAt);
    expect(r.state.game.dissolved).toEqual([13, 14]);
    expect(POCKET_WALLS.map(([col, row]) => solidAt(r.state, col, row))).toEqual([false, false, false, false]);
  });
});
