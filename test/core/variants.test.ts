import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENEMIES, TAGS } from '../../src/app/content.ts';
import { tagsFromQuery } from '../../src/app/session.ts';
import {
  createGame, EMPTY_TAGS, enterRoom, listProps, parseRoom, selectActiveVariants, visibleProps,
  type TiledMap, type TiledMapFile,
} from '../../src/core/index.ts';
import { readRoom } from '../../src/core/rooms/tiled.ts';

const CORRIDOR = JSON.parse(readFileSync('public/assets/maps/greybox/brain-corridor.tmj', 'utf8')) as TiledMapFile;
const room = parseRoom('brain-corridor', CORRIDOR, TAGS);
const tags = (q: string) => tagsFromQuery(`?tags=${q}`, TAGS);
const entered = (q: string) => enterRoom(room, q ? tags(q) : EMPTY_TAGS, TAGS);
const vents = (q: string) => visibleProps(listProps(CORRIDOR).props, entered(q).active).filter((p) => p.frame === 'prop-clock-vent');
const adenosine = (q: string) => createGame(entered(q), 1, ENEMIES).enemies.filter((e) => e.type === 'adenosine');

describe('brain corridor variant (build plan P2)', () => {
  it.each(['', 'sleep_debt:1', 'sleep_debt:1.9'])('shows one vent and one adenosine below sleep_debt 2 (%s)', (q) => {
    expect(entered(q).active).toEqual([]);
    expect(vents(q)).toHaveLength(1);
    expect(adenosine(q)).toHaveLength(1);
  });

  it.each(['sleep_debt:2', 'sleep_debt:5'])('opens two more vents, each with its adenosine, at %s', (q) => {
    expect(selectActiveVariants(createGame(entered(q), 1, ENEMIES))).toEqual(['sleep_debt_2']);
    const v = vents(q);
    expect(v).toHaveLength(3);
    const extra = v.filter((p) => p.variant === 'sleep_debt_2');
    expect(extra).toHaveLength(2);
    // Each new adenosine starts on the floor under one of the new vents.
    const a = adenosine(q);
    expect(a).toHaveLength(3);
    for (const p of extra) expect(a.some((e) => e.x > p.x && e.x < p.x + p.width && e.y > p.y + p.height)).toBe(true);
  });

  it('keeps vents on the north wall face and spawns on walkable floor', () => {
    for (const p of listProps(CORRIDOR).props) {
      expect([p.y, p.y + p.height]).toEqual([32, 96]);
    }
    const r = entered('sleep_debt:2');
    for (const o of r.objects.filter((x) => x.kind === 'Spawn')) {
      expect(r.grid.solid[Math.floor(o.y / 32) * r.grid.cols + Math.floor(o.x / 32)]).toBe(false);
    }
  });
});

/** A bare room with one variant and Spawns, written inline so each rule is visible. */
function tiny(layers: object[], extra: object[] = []): TiledMap {
  return {
    width: 20, height: 12, tilewidth: 32, tileheight: 32,
    properties: [{ name: 'organ', value: 'brain' }, { name: 'role', value: 'combat' }, { name: 'estSeconds', value: 30 }],
    layers: [
      { type: 'tilelayer', name: 'walls', data: new Array(240).fill(0) },
      { type: 'objectgroup', name: 'objects', objects: [{ id: 1, type: 'PlayerStart', x: 100, y: 100 }, ...extra] },
      ...layers,
    ] as TiledMap['layers'],
  };
}
const spawn = (id: number, when?: string) => ({
  id, type: 'Spawn', x: 200, y: 200,
  properties: [{ name: 'enemyType', value: 'salesman' }, ...(when ? [{ name: 'when', value: when }] : [])],
});

describe('enterRoom', () => {
  it('drops the objects of inactive variants and keeps those of active ones', () => {
    const m = tiny([{
      type: 'group', name: 'variant:late', properties: [{ name: 'when', value: 'sleep_debt>=3' }],
      layers: [{ type: 'objectgroup', name: 'objects', objects: [spawn(5)] }],
    }]);
    const r = parseRoom('t', m, TAGS);
    expect(enterRoom(r, tags('sleep_debt:2'), TAGS).objects.map((o) => o.id)).toEqual([1]);
    expect(enterRoom(r, tags('sleep_debt:3'), TAGS).objects.map((o) => o.id)).toEqual([1, 5]);
  });

  it('evaluates a Spawn\'s own when, including negation on an empty tag state', () => {
    const r = parseRoom('t', tiny([], [spawn(2, 'breakfast'), spawn(3, '!breakfast')]), TAGS);
    expect(enterRoom(r, EMPTY_TAGS, TAGS).objects.map((o) => o.id)).toEqual([1, 3]);
    expect(enterRoom(r, tags('breakfast'), TAGS).objects.map((o) => o.id)).toEqual([1, 2]);
  });

  it('evaluates a Pickup\'s own when too: an item is there or not for the whole visit', () => {
    const pickup = { id: 4, type: 'Pickup', x: 50, y: 50, properties: [{ name: 'itemType', value: 'coffee' }, { name: 'when', value: 'breakfast' }] };
    const r = parseRoom('t', tiny([], [pickup]), TAGS);
    expect(enterRoom(r, EMPTY_TAGS, TAGS).objects.map((o) => o.id)).toEqual([1]);
    expect(enterRoom(r, tags('breakfast'), TAGS).objects.map((o) => o.id)).toEqual([1, 4]);
  });

  it('leaves the when of other kinds to their own systems', () => {
    const trigger = { id: 5, type: 'Trigger', x: 50, y: 50, width: 32, height: 32, properties: [{ name: 'eventId', value: 'x' }, { name: 'when', value: 'breakfast' }] };
    const r = parseRoom('t', tiny([], [trigger]), TAGS);
    expect(enterRoom(r, EMPTY_TAGS, TAGS).objects.map((o) => o.id)).toEqual([1, 5]);
  });

});

describe('listProps', () => {
  const collection = { firstgid: 100, name: 'props', tiles: [{ id: 0, image: '../../props/prop-a.png' }, { id: 3, image: 'x/prop-b.png' }] };
  const fileOf = (layers: object[], tilesets: object[] = [collection]) =>
    ({ ...tiny(layers), tilesets } as unknown as TiledMapFile);

  it('resolves gids through image collections, ignores flip bits, and anchors at the top-left', () => {
    const m = fileOf([{ type: 'objectgroup', name: 'props', objects: [
      { id: 7, gid: 100, x: 64, y: 96, width: 64, height: 64 },
      { id: 8, gid: (103 | 0x80000000) >>> 0, x: 0, y: 32, width: 32, height: 32 },
    ] }]);
    const { props, problems } = listProps(m);
    expect(problems).toEqual([]);
    expect(props.map((p) => [p.object, p.frame, p.x, p.y])).toEqual([[7, 'prop-a', 64, 32], [8, 'prop-b', 0, 0]]);
  });

  it('reports props that are not tiles, unknown gids, and tile layers inside variants', () => {
    const m = fileOf([
      { type: 'objectgroup', name: 'props', objects: [{ id: 1, x: 0, y: 0 }, { id: 2, gid: 1, x: 0, y: 0 }] },
      { type: 'group', name: 'variant:v', properties: [{ name: 'when', value: 'breakfast' }], layers: [
        { type: 'tilelayer', name: 'floor', data: [] },
      ] },
    ], [{ firstgid: 1, name: 'struct', image: 'struct.png' }, collection]);
    expect(listProps(m).problems).toEqual([
      { code: 'prop-not-tile', object: 1, layer: 'props' },
      { code: 'prop-unknown-gid', object: 2, layer: 'props', gid: 1 },
      { code: 'variant-tile-layer', layer: 'variant:v/floor' },
    ]);
  });

  it('a props layer inside a variant is decoration, not room objects', () => {
    const m = fileOf([{ type: 'group', name: 'variant:v', properties: [{ name: 'when', value: 'breakfast' }], layers: [
      { type: 'objectgroup', name: 'props', objects: [{ id: 9, gid: 100, x: 0, y: 64, width: 64, height: 64 }] },
    ] }]);
    const { problems, room: r } = readRoom('t', m, TAGS);
    expect(problems).toEqual([]);
    expect(r.objects.map((o) => o.id)).toEqual([1]);
    expect(visibleProps(listProps(m).props, []).length).toBe(0);
    expect(visibleProps(listProps(m).props, ['v']).map((p) => p.object)).toEqual([9]);
  });
});

