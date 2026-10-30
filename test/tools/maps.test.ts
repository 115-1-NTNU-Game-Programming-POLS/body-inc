import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { TAGS } from '../../src/app/content.ts';
import { OBJECT_CLASSES } from '../../src/core/rooms/classes.ts';
import { readRoom, type RoomProblemCode, type TiledMap, type TiledObject } from '../../src/core/rooms/tiled.ts';
import { parseCsv } from '../../src/core/dialogue/csv.ts';
import { checkChapters, checkMaps, loadMapContent } from '../../tools/check-maps.ts';
import { buildProject } from '../../tools/maps/make-tiled-project.ts';

type Prop = { name: string; value: string | number | boolean };
const prop = (name: string, value: string | number | boolean): Prop => ({ name, value });
const ROOM_PROPS = [prop('organ', 'brain'), prop('role', 'combat'), prop('estSeconds', 30)];

function map(objects: Partial<TiledObject>[], opts: { cols?: number; rows?: number; props?: Prop[]; layers?: object[] } = {}): TiledMap {
  const cols = opts.cols ?? 20;
  const rows = opts.rows ?? 12;
  return {
    width: cols, height: rows, tilewidth: 32, tileheight: 32, properties: opts.props ?? ROOM_PROPS,
    layers: [
      { type: 'tilelayer', name: 'walls', data: new Array(cols * rows).fill(0) },
      { type: 'objectgroup', name: 'objects', objects: objects.map((o, i) => ({ id: i + 1, x: 0, y: 0, ...o })) },
      ...(opts.layers ?? []),
    ] as TiledMap['layers'],
  };
}

const codes = (m: TiledMap): RoomProblemCode[] => readRoom('t', m, TAGS).problems.map((p) => p.code);
const door = (socket: string, x: number, y: number, width: number, height: number): Partial<TiledObject> =>
  ({ type: 'Door', x, y, width, height, properties: [prop('socket', socket)] });

describe('room parser: Tiled classes', () => {
  it('fills in class defaults Tiled leaves out of the file', () => {
    const { room, problems } = readRoom('t', map([{ type: 'Spawn', properties: [prop('enemyType', 'adenosine')] }]), TAGS);
    expect(problems).toEqual([]);
    expect(room.objects[0]!.props).toEqual({ enemyType: 'adenosine', count: 1, respawnSeconds: 0, when: '' });
    expect(room.props).toMatchObject({ difficulty: 1, needsClock: false, storyOnly: false });
  });

  it('accepts the "class" field as well as "type"', () => {
    expect(readRoom('t', map([{ class: 'PlayerStart' }]), TAGS).room.objects[0]!.kind).toBe('PlayerStart');
  });

  it.each<[string, Partial<TiledObject>, RoomProblemCode]>([
    ['no class', {}, 'unknown-class'],
    ['an unknown class', { type: 'Chest' }, 'unknown-class'],
    ['a property the class lacks', { type: 'PlayerStart', properties: [prop('hp', 3)] }, 'unknown-property'],
    ['a value outside the enum', { type: 'Bed', properties: [prop('bedType', 'sofa')] }, 'enum-value'],
    ['a number below its minimum', { type: 'Spawn', properties: [prop('enemyType', 'flyer'), prop('count', 0)] }, 'out-of-range'],
    ['a float where an int is needed', { type: 'Spawn', properties: [prop('enemyType', 'flyer'), prop('count', 1.5)] }, 'property-type'],
    ['a missing required ref', { type: 'Spawn' }, 'required'],
    ['a bad condition', { type: 'Hazard', properties: [prop('when', 'sugar>1')] }, 'condition'],
    ['a switch aimed at nothing', { type: 'Switch', properties: [prop('target', 99)] }, 'switch-target'],
    ['a switch aimed at itself, which is not a door', { type: 'Switch', properties: [prop('target', 1)] }, 'switch-target-kind'],
    ['a door drawn as a point', { type: 'Door', properties: [prop('socket', 'N')] }, 'door-shape'],
  ])('reports %s', (_name, obj, code) => {
    expect(codes(map([obj]))).toEqual([code]);
  });

  it('requires organ, role and estSeconds on the map', () => {
    expect(codes(map([], { props: [] })).sort()).toEqual(['required', 'required', 'required']);
  });

  it('rejects room sizes other than 1x1, 2x1 and 2x2 cells', () => {
    expect(codes(map([], { cols: 21 }))).toEqual(['room-size']);
    expect(codes(map([], { cols: 40, rows: 24 }))).toEqual([]);
  });

  it('tile objects are anchored at the bottom', () => {
    const { room } = readRoom('t', map([{ type: 'Bed', gid: 5, x: 64, y: 96, width: 64, height: 32 }]), TAGS);
    expect(room.objects[0]).toMatchObject({ x: 64, y: 64 });
  });
});

describe('room parser: door sockets (design doc 13.3)', () => {
  it.each([
    ['N', 288, 0, 64, 96], ['S', 288, 352, 64, 32], ['W', 0, 192, 32, 64], ['E', 608, 192, 32, 64],
  ])('accepts %s at its socket', (s, x, y, w, h) => {
    expect(codes(map([door(s, x, y, w, h)]))).toEqual([]);
  });

  it.each([
    ['N one column off', 'N', 320, 0, 64, 96],
    ['N three tiles wide', 'N', 288, 0, 96, 96],
    ['S on the north wall', 'S', 288, 0, 64, 96],
    ['W one row off', 'W', 0, 224, 32, 64],
    ['E on the west wall', 'E', 0, 192, 32, 64],
  ])('rejects %s', (_n, s, x, y, w, h) => {
    expect(codes(map([door(s as string, x as number, y as number, w as number, h as number)]))).toEqual(['door-position']);
  });

  it('a 2x1 room has a north socket in each cell', () => {
    expect(codes(map([door('N', (20 + 9) * 32, 0, 64, 96)], { cols: 40 }))).toEqual([]);
    expect(codes(map([door('N', (20 + 9) * 32, 0, 64, 96)]))).toEqual(['door-position']);
  });
});

describe('room parser: door locks', () => {
  const locked = (lock: string, param?: string, id = 1): Partial<TiledObject> => ({
    id, type: 'Door', x: 288, y: 352, width: 64, height: 32,
    properties: [prop('socket', 'S'), prop('lock', lock), ...(param !== undefined ? [prop('lockParam', param)] : [])],
  });
  const lever = (target: number, mode = 'toggle'): Partial<TiledObject> => ({ id: 2, type: 'Switch', x: 300, y: 300, properties: [prop('target', target), prop('mode', mode)] });

  it.each(['08:00-10:00', '17:00-24:00', '22:00-02:00', '00:00-00:30', '23:59-24:00'])('a clock lock accepts the window %s', (w) => {
    expect(codes(map([locked('clock', w)]))).toEqual([]);
  });

  it.each(['', '8:00-10:00', '08:00', '08:00-08:00', '24:00-02:00', '08:60-10:00', '08:00-24:30', '08:00 - 10:00', '08:00-10:00-12:00'])(
    'a clock lock rejects the window "%s"',
    (w) => expect(codes(map([locked('clock', w)]))).toEqual(['lock-param']),
  );

  it('a resource lock needs a condition the dictionary knows, and keeps it compiled', () => {
    expect(codes(map([locked('resource', '')]))).toEqual(['lock-param']);
    expect(codes(map([locked('resource', 'sugar>1')]))).toEqual(['condition']);
    const { room, problems } = readRoom('t', map([locked('resource', 'caffeine<50')]), TAGS);
    expect(problems).toEqual([]);
    expect(room.objects[0]!.conditions['lockParam']?.text).toBe('caffeine<50');
  });

  it('a switch lock needs a switch aimed at it, and a switch must aim at a switch-locked door', () => {
    expect(codes(map([locked('switch')]))).toEqual(['switch-missing']);
    expect(codes(map([locked('switch'), lever(1)]))).toEqual([]);
    expect(codes(map([locked('switch'), lever(1, 'hold')]))).toEqual([]);
    expect(codes(map([locked('none'), lever(1)]))).toEqual(['switch-target-kind']);
  });

  describe('a port', () => {
    const port = (extra: Partial<TiledObject> = {}, need = 1, target = 1): Partial<TiledObject> =>
      ({ id: 3, type: 'Port', x: 320, y: 192, width: 64, height: 32, properties: [prop('need', need), prop('target', target)], ...extra });
    const crate = (id: number, x: number, when = ''): Partial<TiledObject> => ({ id, type: 'Box', x, y: 112, properties: when ? [prop('when', when)] : [] });

    it('opens a switch lock on its own, and aims only where a switch may', () => {
      expect(codes(map([locked('switch'), port(), crate(4, 112)]))).toEqual([]);
      expect(codes(map([locked('none'), port(), crate(4, 112)]))).toEqual(['switch-target-kind']);
      // Aimed at nothing, it is a sink that only counts.
      expect(codes(map([locked('key'), port({}, 1, 0), crate(4, 112)]))).toEqual([]);
    });

    it('must be a rectangle, alone in its room, and fillable by boxes that are always there', () => {
      expect(codes(map([locked('switch'), port({ width: 0, height: 0 }), crate(4, 112)]))).toEqual(['port-shape']);
      expect(codes(map([locked('switch'), port(), { ...port(), id: 5, x: 448 }, crate(4, 112)]))).toEqual(['port-multiple']);
      expect(codes(map([locked('switch'), port({}, 2), crate(4, 112)]))).toEqual(['port-need']);
      // A box with a `when` may be missing, so it does not count towards the need.
      expect(codes(map([locked('switch'), port({}, 2), crate(4, 112), crate(5, 176, 'deadline')]))).toEqual(['port-need']);
      expect(codes(map([locked('switch'), port({}, 2), crate(4, 112), crate(5, 176)]))).toEqual([]);
    });

    it('must cover a floor tile\'s centre, the rule that decides where a box is taken in', () => {
      // 10 x 10 inside tile (6, 6), clear of its centre: no tile is the port's.
      expect(codes(map([locked('switch'), port({ x: 196, y: 196, width: 10, height: 10 }), crate(4, 112)]))).toEqual(['port-shape']);
      // Its tiles are (10, 6) and (11, 6); walling both leaves no box a place to rest on it.
      const walled = map([locked('switch'), port(), crate(4, 112)]);
      const walls = (walled.layers[0] as unknown as { data: number[] }).data;
      walls[6 * 20 + 10] = 1;
      expect(codes(walled)).toEqual([]);
      walls[6 * 20 + 11] = 1;
      expect(readRoom('t', walled, TAGS).problems).toEqual([{ code: 'port-wall', object: 3 }]);
    });

    it('cannot start with a box on it', () => {
      const r = readRoom('t', map([locked('switch'), port(), crate(4, 112), { id: 5, type: 'Box', x: 336, y: 208, properties: [] }]), TAGS);
      expect(r.problems).toEqual([{ code: 'box-blocked', object: 5, args: { other: 3, kind: 'Port' } }]);
    });
  });

  it('a key lock with a lockParam needs a pickup with that itemId; an empty one is a sealed door', () => {
    const item = (itemId: string): Partial<TiledObject> => ({ id: 2, type: 'Pickup', x: 300, y: 300, properties: [prop('itemType', 'file'), prop('itemId', itemId)] });
    expect(codes(map([locked('key')]))).toEqual([]);
    expect(codes(map([locked('key', 'k')]))).toEqual(['key-missing']);
    expect(codes(map([locked('key', 'k'), item('other')]))).toEqual(['key-missing']);
    expect(codes(map([locked('key', 'k'), item('k')]))).toEqual([]);
    // Spaces around the name do not make it a different key.
    expect(codes(map([locked('key', ' k '), item('k')]))).toEqual([]);
    expect(codes(map([locked('key', 'k'), item(' k ')]))).toEqual([]);
  });
});

describe('room parser: variant layers', () => {
  const variant = (name: string, when?: string) => ({
    type: 'objectgroup', name, objects: [{ id: 50, type: 'Spawn', x: 0, y: 0, properties: [prop('enemyType', 'adenosine')] }],
    ...(when !== undefined ? { properties: [prop('when', when)] } : {}),
  });

  it('reads the condition and tags the objects with their variant', () => {
    const { room, problems } = readRoom('t', map([], { layers: [variant('variant:vents', 'sleep_debt>=2')] }), TAGS);
    expect(problems).toEqual([]);
    expect(room.variants).toEqual([{ id: 'vents', when: { text: 'sleep_debt>=2', terms: [{ kind: 'compare', name: 'sleep_debt', op: '>=', value: 2 }] } }]);
    expect(room.objects[0]!.variant).toBe('vents');
  });

  it('requires a when, rejects unknown tags and duplicate names', () => {
    expect(codes(map([], { layers: [variant('variant:a')] }))).toEqual(['variant-when']);
    expect(codes(map([], { layers: [variant('variant:a', 'sleepy')] }))).toEqual(['condition']);
    expect(codes(map([], { layers: [variant('variant:a', 'deadline'), variant('variant:a', 'deadline')] }))).toEqual(['variant-duplicate']);
  });
});

describe('map check', () => {
  it('passes on the real maps and on the good fixture', () => {
    expect(checkMaps('public/assets/maps')).toEqual([]);
    expect(checkMaps('test/fixtures/maps/good')).toEqual([]);
  });

  it('fails on the broken fixture with one readable Chinese message per fault', () => {
    const out = checkMaps('test/fixtures/maps/broken');
    expect(out).toHaveLength(3);
    expect(out).toContainEqual(expect.stringContaining('物件 #2（Door）：北門必須在北牆（第 0 至 2 列）的第 9 至 10 欄，目前在第 4 至 5 欄'));
    expect(out).toContainEqual(expect.stringContaining('「sleepy」不在狀態標籤字典'));
    expect(out).toContainEqual(expect.stringContaining('「alcohol_barrel」打不掉（immune），解法是 conveyor，但 test/fixtures/maps/broken/brain 這一章沒有任何 Conveyor 物件'));
  });

  it('the command exits 1 on the broken fixture and 0 on the real maps', () => {
    const run = (dir: string) => spawnSync(process.execPath, ['tools/check-maps.ts', dir], { encoding: 'utf8' }).status;
    expect(run('test/fixtures/maps/broken')).toBe(1);
    expect(run('public/assets/maps')).toBe(0);
  });

  describe('cross-references within a chapter', () => {
    const dir = mkdtempSync(join(tmpdir(), 'maps-'));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));
    let n = 0;
    const check = (rooms: Record<string, TiledMap>) => {
      const ch = join(dir, `ch${n++}`);
      mkdirSync(ch);
      for (const [name, m] of Object.entries(rooms)) writeFileSync(join(ch, `${name}.tmj`), JSON.stringify(m));
      return checkMaps(ch).map((l) => l.slice(l.indexOf('：') + 1));
    };
    const spawn = (enemy: string) => ({ type: 'Spawn', properties: [prop('enemyType', enemy)] });
    const tutorial = (enemy: string) => [...ROOM_PROPS, prop('tutorialFor', enemy)];

    it('props must be tiles whose image exists next to the map', () => {
      const withProps = (image: string, objects: object[]) => ({
        ...map([]), tilesets: [{ firstgid: 50, name: 'props', tiles: [{ id: 0, image }] }],
        layers: [...map([]).layers, { type: 'objectgroup', name: 'props', objects }],
      }) as unknown as TiledMap;
      writeFileSync(join(dir, 'prop-real.png'), '');
      const tile = { id: 3, gid: 50, x: 0, y: 64, width: 64, height: 64 };
      expect(check({ a: withProps('../prop-real.png', [tile]) })).toEqual([]);
      expect(check({ a: withProps('../prop-gone.png', [tile]) })).toEqual(['圖片 ../prop-gone.png 不存在']);
      expect(check({ a: withProps('../prop-real.png', [{ id: 4, x: 0, y: 0 }]) }))
        .toEqual(['圖層「props」的物件 #4 不是圖塊物件；道具請從道具圖塊集拖曳']);
    });

    it('a solution object in another room of the chapter counts', () => {
      expect(check({
        a: map([spawn('adenosine')], { props: tutorial('adenosine') }),
        b: map([{ type: 'Bed', width: 64, height: 32 }]),
      })).toEqual([]);
    });

    it('a reforming enemy without a tutorial room fails', () => {
      const out = check({ a: map([spawn('adenosine'), { type: 'Bed', width: 64, height: 32 }]) });
      expect(out).toEqual([expect.stringContaining('沒有 tutorialFor 包含它')]);
    });

    it('a tutorial flag on a room that does not spawn the enemy does not count', () => {
      const out = check({
        a: map([{ type: 'Bed', width: 64, height: 32 }], { props: tutorial('adenosine') }),
        b: map([spawn('adenosine')]),
      });
      expect(out).toEqual([expect.stringContaining('沒有 tutorialFor 包含它')]);
    });

    it('a clock_advance trigger needs a whole number of minutes', () => {
      const trigger = (eventId?: string) => ({
        type: 'Trigger', properties: [prop('event', 'clock_advance'), ...(eventId === undefined ? [] : [prop('eventId', eventId)])],
      });
      expect(check({ a: map([trigger('20')]) })).toEqual([]);
      for (const bad of [undefined, '', 'soon', '1e1', '0x10', ' ']) {
        expect(check({ a: map([trigger(bad)]) }), String(bad)).toEqual([expect.stringContaining('clock_advance 的 eventId')]);
      }
    });

    it('tutorialFor must name a non-defeatable enemy, and spawns must name a known one', () => {
      expect(check({ a: map([], { props: tutorial('salesman') }) })).toEqual([expect.stringContaining('不是打不掉的敵人種類')]);
      expect(check({ a: map([spawn('ghost')]) })).toEqual([expect.stringContaining('enemyType「ghost」不存在')]);
    });

    it('a card Trigger must name an event card of its own chapter (the map folder) deck', () => {
      const ch = join(dir, 'cards');
      mkdirSync(ch);
      const card = (id: string) => ({ type: 'Trigger', properties: [prop('event', 'card'), prop('eventId', id)] });
      const content = { ...loadMapContent(), cardIds: new Map([['cards', new Set(['group_chat'])], ['other', new Set(['elsewhere'])]]) };
      const at = (id: string) => {
        writeFileSync(join(ch, 'a.tmj'), JSON.stringify(map([card(id)])));
        return checkMaps(ch, content).map((l) => l.slice(l.indexOf('：') + 1));
      };
      expect(at('group_chat')).toEqual([]);
      expect(at('elsewhere')).toEqual(['eventId「elsewhere」不是這一章的事件卡（content/decks/cards.json 的 events）']);
      expect(loadMapContent().cardIds?.get('greybox')?.has('group_chat')).toBe(true);
    });

    it('a rescue Trigger must name a rescue of content/rescue.json', () => {
      const ch = join(dir, 'rescues');
      mkdirSync(ch);
      const at = (id: string) => {
        writeFileSync(join(ch, 'a.tmj'), JSON.stringify(map([{ type: 'Trigger', properties: [prop('event', 'rescue'), prop('eventId', id)] }])));
        return checkMaps(ch).map((l) => l.slice(l.indexOf('：') + 1));
      };
      expect(at('akai')).toEqual([]);
      expect(at('nobody')).toEqual(['eventId「nobody」不存在於急救（content/rescue.json 的 rescues）']);
    });

    it('a bed may unlock only a handbook page that exists', () => {
      const bed = (page: string) => ({ type: 'Bed', properties: [prop('bedType', 'nap'), prop('unlocks', page)] });
      expect(check({ a: map([bed('short_nap')]) })).toEqual([]);
      expect(check({ a: map([bed('nope')]) })).toEqual([expect.stringContaining('unlocks「nope」不存在於手冊頁')]);
    });

    it('dialogue and handbook ids must exist', () => {
      const out = check({
        a: map([
          { type: 'NPC', properties: [prop('npcId', 'liver'), prop('dialogueId', 'liver_intro')] },
          { type: 'Trigger', properties: [prop('eventId', 'missing_line')] },
          { type: 'Pickup', properties: [prop('itemId', 'handbook_caffeine')] },
        ]),
      });
      expect(out).toEqual([
        expect.stringContaining('dialogueId「liver_intro」不存在'),
        expect.stringContaining('eventId「missing_line」不存在'),
        expect.stringContaining('itemId「handbook_caffeine」不存在'),
      ]);
      // The real handbook's pages pass.
      expect(check({ a: map([{ type: 'Pickup', properties: [prop('itemType', 'handbook'), prop('itemId', 'caffeine')] }]) })).toEqual([]);
    });

    it('a key lock names an item in its room, and that item is always there', () => {
      const keyDoor = { id: 2, type: 'Door', x: 288, y: 352, width: 64, height: 32, properties: [prop('socket', 'S'), prop('lock', 'key'), prop('lockParam', 'k')] };
      const key = (when = '') => ({ id: 3, type: 'Pickup', x: 300, y: 300, properties: [prop('itemType', 'file'), prop('itemId', 'k'), ...(when ? [prop('when', when)] : [])] });
      expect(check({ a: map([keyDoor, key()]) })).toEqual([]);
      expect(check({ a: map([keyDoor]) })).toEqual(['lock 是 key，lockParam 是「k」，但房間裡沒有 itemId 為「k」的道具（Pickup），門永遠打不開；不打算開的門請把 lockParam 留空']);
      expect(check({ a: map([keyDoor, key('breakfast')]) })).toEqual([expect.stringContaining('這個道具是門 #2 的鑰匙，必須放在 objects 圖層、when 留空')]);
    });

    it('a box may not start where the operator appears or an enemy comes back to', () => {
      const crate = (col: number, row: number) => ({ type: 'Box', x: col * 32 + 16, y: row * 32 + 16, properties: [] });
      const start = { type: 'PlayerStart', x: 320, y: 256 };
      const southDoor = { type: 'Door', x: 288, y: 352, width: 64, height: 32, properties: [prop('socket', 'S')] };
      const salesman = { type: 'Spawn', x: 200, y: 200, properties: [prop('enemyType', 'salesman')] };
      expect(check({ a: map([start, southDoor, salesman, crate(4, 4)]) })).toEqual([]);
      expect(check({ a: map([start, crate(9, 7)]) })).toEqual([expect.stringContaining('箱子壓到PlayerStart')]);
      expect(check({ a: map([southDoor, crate(9, 10)]) })).toEqual([expect.stringContaining('箱子壓到門 #1 進房時營運長站的位置')]);
      expect(check({ a: map([salesman, crate(6, 5)]) })).toEqual([expect.stringContaining('箱子壓到Spawn #1 敵人出現的位置')]);
      // An enemy and a box that are never in the room on the same visit do not clash.
      const fedOnly = { ...salesman, properties: [...salesman.properties, prop('when', 'breakfast')] };
      const hungryCrate = { ...crate(6, 5), properties: [prop('when', '!breakfast')] };
      expect(check({ a: map([fedOnly, hungryCrate]) })).toEqual([]);
      expect(check({ a: map([fedOnly, crate(6, 5)]) })).toEqual([expect.stringContaining('箱子壓到Spawn #1 敵人出現的位置')]);
    });
  });
});

describe('chapter check (build plan P0)', () => {
  const root = mkdtempSync(join(tmpdir(), 'chapters-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  let n = 0;
  const named = (name: string, d: Partial<TiledObject>): Partial<TiledObject> => ({ ...d, name });
  const start = { type: 'PlayerStart', x: 320, y: 256 };
  const southDoor = (name = 'door-s', extra: Prop[] = []) => named(name, { ...door('S', 288, 352, 64, 32), properties: [prop('socket', 'S'), ...extra] });
  const northDoor = (name = 'door-n', extra: Prop[] = []) => named(name, { ...door('N', 288, 0, 64, 96), properties: [prop('socket', 'N'), ...extra] });
  const a = () => map([start, southDoor()]);
  const b = () => map([start, northDoor()]);
  const link = (x: string, y: string) => ({ a: x, b: y });
  const AB = [link('lab/a#door-s', 'lab/b#door-n')];

  /** Writes rooms into lab/ and checks them against a chapter file; messages are returned without the path prefix. */
  const check = (rooms: Record<string, TiledMap>, links = AB, chapter: Partial<{
    id: string; start: string; next: string; intro: string; carry: string[]; archive: { held: string; hands: number; desk: string; total: number; into: string };
    climax: { flag: string; summonFactor?: number; archiveFactor?: number };
  }> = {}) => {
    const dir = join(root, `maps${n++}`);
    mkdirSync(join(dir, 'lab'), { recursive: true });
    for (const [name, m] of Object.entries(rooms)) writeFileSync(join(dir, 'lab', `${name}.tmj`), JSON.stringify(m));
    const content = { ...loadMapContent(), chapters: new Map([['lab', { version: 1 as const, id: 'lab', start: 'lab/a', links, ...chapter }]]) };
    return checkChapters(dir, content).map((l) => l.slice(l.indexOf('：') + 1));
  };

  it('passes a healthy two-room chapter', () => {
    expect(check({ a: a(), b: b() })).toEqual([]);
  });

  it('passes the greybox chapter in the real maps', () => {
    expect(checkChapters('public/assets/maps')).toEqual([]);
  });

  it('a link to a room outside the chapter folder fails', () => {
    // The door left unjoined by the bad link is reported too, which is true and points at the same fix.
    expect(check({ a: a(), b: b() }, [link('lab/a#door-s', 'lab/zzz#door-n')])).toContainEqual(expect.stringContaining('房間「lab/zzz」不在這一章的資料夾裡'));
  });

  it('a link to a door that does not exist fails', () => {
    expect(check({ a: a(), b: b() }, [link('lab/a#door-s', 'lab/b#door-x')])).toContainEqual(expect.stringContaining('房間 lab/b 沒有名叫「door-x」的門'));
  });

  it('doors whose sockets do not face each other fail', () => {
    const south = map([start, named('door-n', door('S', 288, 352, 64, 32))]);
    expect(check({ a: a(), b: south })).toEqual([expect.stringContaining('必須一個朝北一個朝南，或一個朝東一個朝西')]);
  });

  it('a door joined twice fails', () => {
    const c = map([start, northDoor()]);
    expect(check({ a: a(), b: b(), c }, [...AB, link('lab/a#door-s', 'lab/c#door-n')])).toEqual([expect.stringContaining('門 lab/a#door-s 被接了 2 次')]);
  });

  it('a door that can open and leads nowhere fails, a key-locked one is a closed door', () => {
    const lever = { type: 'Switch', x: 560, y: 224, properties: [prop('target', 3)] };
    const extra = (lock: string, param = '') => map([start, northDoor(), named('door-e', {
      ...door('E', 608, 192, 32, 64), properties: [prop('socket', 'E'), prop('lock', lock), ...(param ? [prop('lockParam', param)] : [])],
    }), ...(lock === 'switch' ? [lever] : [])]);
    expect(check({ a: a(), b: extra('none') })).toEqual([expect.stringContaining('門「door-e」沒有接到任何房間，卻打得開（lock 為 none）')]);
    expect(check({ a: a(), b: extra('switch') })).toEqual([expect.stringContaining('卻打得開（lock 為 switch）')]);
    expect(check({ a: a(), b: extra('clock', '08:00-10:00') })).toEqual([expect.stringContaining('卻打得開（lock 為 clock）')]);
    expect(check({ a: a(), b: extra('resource', 'caffeine<50') })).toEqual([expect.stringContaining('卻打得開（lock 為 resource）')]);
    expect(check({ a: a(), b: extra('key') })).toEqual([]);
  });

  it('switch, clock and resource locks are a way across; a key lock and a plate-only switch lock are not', () => {
    const lever = (mode: string, extra: Partial<TiledObject> = {}) => ({ type: 'Switch', x: 300, y: 300, properties: [prop('target', 2), prop('mode', mode)], ...extra });
    const lockedA = (lock: string, param: string, more: Partial<TiledObject>[] = []) =>
      map([start, southDoor('door-s', [prop('lock', lock), ...(param ? [prop('lockParam', param)] : [])]), ...more]);
    const unreachable = expect.stringContaining('房間 lab/b 從起點 lab/a 走不到');
    expect(check({ a: lockedA('switch', '', [lever('toggle')]), b: b() })).toEqual([]);
    expect(check({ a: lockedA('clock', '22:00-02:00'), b: b() })).toEqual([]);
    expect(check({ a: lockedA('resource', '!deadline'), b: b() })).toEqual([]);
    expect(check({ a: lockedA('key', ''), b: b() })).toEqual([unreachable]);
    expect(check({ a: lockedA('switch', '', [lever('hold')]), b: b() })).toEqual([unreachable]);
    // A lever and a plate on the same door: the plate still cannot be held down while walking through.
    expect(check({ a: lockedA('switch', '', [lever('toggle'), lever('hold')]), b: b() })).toEqual([unreachable]);
    // A lever that exists only in a variant may be absent, and then the door never opens.
    const variantLever = {
      type: 'objectgroup', name: 'variant:night', properties: [prop('when', 'deadline')],
      objects: [{ id: 60, type: 'Switch', x: 300, y: 300, properties: [prop('target', 2)] }],
    };
    expect(check({ a: map([start, southDoor('door-s', [prop('lock', 'switch')])], { layers: [variantLever] }), b: b() })).toEqual([unreachable]);
  });

  it('a plate-only switch lock is a way across when a box that is always there can rest on the plate', () => {
    const plate = { type: 'Switch', x: 300, y: 300, properties: [prop('target', 2), prop('mode', 'hold')] };
    const crate = (extra: Partial<TiledObject> = {}) => ({ type: 'Box', x: 400, y: 300, properties: [], ...extra });
    const lockedA = (more: Partial<TiledObject>[], opts: Parameters<typeof map>[1] = {}) =>
      map([start, southDoor('door-s', [prop('lock', 'switch')]), plate, ...more], opts);
    const unreachable = expect.stringContaining('房間 lab/b 從起點 lab/a 走不到');
    expect(check({ a: lockedA([crate()]), b: b() })).toEqual([]);
    // A box that only some states bring is not enough.
    expect(check({ a: lockedA([crate({ properties: [prop('when', 'deadline')] })]), b: b() })).toEqual([unreachable]);
    const variantBox = { type: 'objectgroup', name: 'variant:night', properties: [prop('when', 'deadline')], objects: [{ id: 61, type: 'Box', x: 400, y: 300 }] };
    expect(check({ a: lockedA([], { layers: [variantBox] }), b: b() })).toEqual([unreachable]);
  });

  it('a switch lock that a port opens is a way across: a filled port stays filled', () => {
    const port = { type: 'Port', x: 320, y: 192, width: 32, height: 32, properties: [prop('target', 2)] };
    const crate = { type: 'Box', x: 400, y: 300, properties: [] };
    expect(check({ a: map([start, southDoor('door-s', [prop('lock', 'switch')]), port, crate]), b: b() })).toEqual([]);
  });

  it('next must name another chapter and intro a conversation that exists', () => {
    expect(check({ a: a(), b: b() }, AB, { next: 'nowhere' })).toEqual(['next「nowhere」不是任何一章的 id（content/chapters/*.json）']);
    expect(check({ a: a(), b: b() }, AB, { next: 'lab' })).toEqual(['next 不能是自己這一章']);
    expect(check({ a: a(), b: b() }, AB, { intro: 'no.such.talk' })).toEqual(['intro「no.such.talk」不存在於對話（content/dialogue/*.csv）']);
    expect(check({ a: a(), b: b() }, AB, { intro: 'prologue.interview' })).toEqual([]);
  });

  it('an archive must name number tags, match the memory files in the rooms and carry its result on', () => {
    const memory = (id: number) => ({ id, type: 'Pickup', x: 300, y: 300, properties: [prop('itemType', 'memory')] });
    const rooms = () => ({ a: map([start, southDoor(), memory(4), memory(5)]), b: b() });
    const archive = { held: 'memory_held', hands: 1, desk: 'memory_desk', total: 2, into: 'exam_archived' };
    const carry = ['exam_archived'];
    expect(check(rooms(), AB, { archive, carry })).toEqual([]);
    expect(check(rooms(), AB, { archive: { ...archive, total: 3 }, carry })).toEqual([expect.stringMatching(/archive\.total 是 3，房間裡卻有 2 份記憶文件/)]);
    expect(check(rooms(), AB, { archive, carry: [] })).toEqual([expect.stringMatching(/archive\.into「exam_archived」不在 carry 裡/)]);
    expect(check(rooms(), AB, { archive: { ...archive, held: 'breakfast' }, carry })).toEqual([expect.stringMatching(/archive\.held「breakfast」必須是.*數值標籤/)]);
    // The desk must fade and the hands must be able to fill.
    expect(check(rooms(), AB, { archive: { ...archive, desk: 'memory_held' }, carry })).toEqual([expect.stringMatching(/archive\.desk「memory_held」沒有 fadePerHour/)]);
    expect(check(rooms(), AB, { archive: { ...archive, hands: 3 }, carry })).toEqual([expect.stringMatching(/archive\.hands 3 比 total 2 還大/)]);
    expect(check(rooms(), AB, { archive: { ...archive, into: 'nowhere' }, carry: ['nowhere'] })).toEqual([
      expect.stringMatching(/carry 的「nowhere」不在狀態標籤字典/), expect.stringMatching(/archive\.into「nowhere」必須是/),
    ]);
    expect(check(rooms(), AB)).toEqual([expect.stringMatching(/有 2 份記憶文件.*沒有 archive/)]);
  });

  it('a climax must name a flag that an event card can set, and an archive factor needs an archive', () => {
    const memory = (id: number) => ({ id, type: 'Pickup', x: 300, y: 300, properties: [prop('itemType', 'memory')] });
    const rooms = () => ({ a: map([start, southDoor(), memory(4)]), b: b() });
    const archive = { held: 'memory_held', hands: 1, desk: 'memory_desk', total: 1, into: 'exam_archived' };
    const carry = ['exam_archived'];
    const climax = (c: { flag: string; summonFactor?: number; archiveFactor?: number }) => check(rooms(), AB, { archive, carry, climax: c });
    expect(climax({ flag: 'one_more_cup', summonFactor: 2, archiveFactor: 0.5 })).toEqual([]);
    expect(climax({ flag: 'memory_held' })).toEqual([expect.stringMatching(/climax\.flag「memory_held」必須是.*布林標籤/)]);
    expect(climax({ flag: 'breakfast' })).toEqual([expect.stringMatching(/climax\.flag「breakfast」的來源要有 event/)]);
    const bare = check({ a: a(), b: b() }, AB, { climax: { flag: 'one_more_cup', archiveFactor: 0.5 } });
    expect(bare).toEqual([expect.stringMatching(/climax\.archiveFactor 要有 archive/)]);
    expect(check({ a: a(), b: b() }, AB, { climax: { flag: 'one_more_cup', summonFactor: 2 } })).toEqual([]);
  });

  it('a key lock whose key lies in its room is a way across, and then it must be linked', () => {
    const key = { type: 'Pickup', x: 300, y: 300, properties: [prop('itemType', 'file'), prop('itemId', 'k')] };
    const keyed = (name: string) => map([start, northDoor(), named(name, {
      ...door('E', 608, 192, 32, 64), properties: [prop('socket', 'E'), prop('lock', 'key'), prop('lockParam', 'k')],
    }), key]);
    expect(check({ a: map([start, southDoor('door-s', [prop('lock', 'key'), prop('lockParam', 'k')]), key]), b: b() })).toEqual([]);
    expect(check({ a: a(), b: keyed('door-e') })).toEqual([expect.stringContaining('門「door-e」沒有接到任何房間，卻打得開（lock 為 key）')]);
  });

  it('a room no link reaches fails', () => {
    expect(check({ a: a(), b: b(), c: map([start]) })).toEqual([expect.stringContaining('房間 lab/c 從起點 lab/a 走不到')]);
  });

  it('a link through a locked door is no way across, but only in the direction the locked door blocks', () => {
    const lockedA = map([start, southDoor('door-s', [prop('lock', 'key')])]);
    expect(check({ a: lockedA, b: b() })).toEqual([expect.stringContaining('房間 lab/b 從起點 lab/a 走不到')]);
    expect(check({ a: lockedA, b: b() }, AB, { start: 'lab/b' })).toEqual([]);
    const lockedB = map([start, northDoor('door-n', [prop('lock', 'key')])]);
    expect(check({ a: a(), b: lockedB })).toEqual([]);
    expect(check({ a: a(), b: lockedB }, AB, { start: 'lab/b' })).toEqual([expect.stringContaining('房間 lab/a 從起點 lab/b 走不到')]);
  });

  it('an unlocked door in a variant layer cannot be linked, so it has to be locked', () => {
    const variantDoor = (lock: string) => ({
      type: 'objectgroup', name: 'variant:vents', properties: [prop('when', 'deadline')],
      objects: [{ id: 50, type: 'Door', name: 'door-v', x: 0, y: 192, width: 32, height: 64, properties: [prop('socket', 'W'), prop('lock', lock)] }],
    });
    const withVariant = (lock: string) => map([start, northDoor()], { layers: [variantDoor(lock)] });
    expect(check({ a: a(), b: withVariant('none') })).toEqual([expect.stringContaining('變體圖層裡的門沒辦法在章節檔接到別的房間')]);
    expect(check({ a: a(), b: withVariant('key') })).toEqual([]);
    // Any lock that can open is a way through the variant door too.
    const clockVariant = map([start, northDoor()], { layers: [{ ...variantDoor('clock'), objects: [{ ...variantDoor('clock').objects[0]!, properties: [prop('socket', 'W'), prop('lock', 'clock'), prop('lockParam', '08:00-09:00')] }] }] });
    expect(check({ a: a(), b: clockVariant })).toEqual([expect.stringContaining('卻打得開（lock 為 clock）')]);
  });

  it('a chapter file that is not valid says so, instead of reporting that the folder has none', () => {
    const content = join(root, `content${n++}`);
    mkdirSync(join(content, 'chapters'), { recursive: true });
    for (const f of ['tags.json', 'enemies.json']) cpSync(join('content', f), join(content, f));
    writeFileSync(join(content, 'chapters', 'broken.json'), '{ "version": 1,');
    writeFileSync(join(content, 'chapters', 'wrong.json'), JSON.stringify({ version: 1, id: 'wrong', start: 'wrong/a', links: [], extra: 1 }));
    const loaded = loadMapContent(content);
    expect(loaded.chapters?.size).toBe(0);
    expect(loaded.problems).toEqual([
      expect.stringMatching(/^content\/chapters\/broken\.json：不是有效的 JSON/),
      expect.stringMatching(/^content\/chapters\/wrong\.json .*不認得的欄位.*extra.*完整清單請執行 node tools\/check-content\.ts/),
    ]);
  });

  it('a door without a name, a repeated name and a room without PlayerStart each fail', () => {
    expect(check({ a: a(), b: map([start, northDoor('')]) })).toContainEqual(expect.stringContaining('沒有名字'));
    const twice = map([start, northDoor(), named('door-n', { ...door('W', 0, 192, 32, 64), properties: [prop('socket', 'W'), prop('lock', 'key')] })]);
    expect(check({ a: a(), b: twice })).toEqual([expect.stringContaining('有不只一扇門叫「door-n」')]);
    expect(check({ a: a(), b: map([northDoor()]) })).toEqual([expect.stringContaining('缺少 PlayerStart')]);
  });

  it('arriving through a door into a wall fails', () => {
    const walled = b();
    const walls = (walled.layers[0] as unknown as { data: number[] }).data;
    for (const c of [9, 10]) walls[3 * 20 + c] = 1;
    expect(check({ a: a(), b: walled })).toEqual([expect.stringContaining('lab/a#door-s 走到 lab/b#door-n 會站在牆裡')]);
  });

  it('the start room must be in the chapter, and the file id must match its folder', () => {
    expect(check({ a: a(), b: b() }, AB, { start: 'lab/zzz' })).toEqual([
      expect.stringContaining('start「lab/zzz」不是這一章的房間'),
    ]);
    expect(check({ a: a(), b: b() }, AB, { id: 'other' })).toEqual([expect.stringContaining('id「other」必須與地圖資料夾 lab 相同')]);
  });

  it('a map folder without a chapter file, and a chapter file without a folder, both fail', () => {
    const dir = join(root, `maps${n++}`);
    mkdirSync(join(dir, 'lab'), { recursive: true });
    writeFileSync(join(dir, 'lab', 'a.tmj'), JSON.stringify(a()));
    const none = { ...loadMapContent(), chapters: new Map() };
    expect(checkChapters(dir, none).map((l) => l.slice(l.indexOf('：') + 1))).toEqual(['地圖資料夾沒有對應的章節檔 content/chapters/lab.json']);
    const ghost = { ...loadMapContent(), chapters: new Map([['ghost', { version: 1 as const, id: 'ghost', start: 'ghost/a', links: [] }]]) };
    expect(checkChapters(dir, ghost)).toEqual(expect.arrayContaining([expect.stringContaining('沒有對應的地圖資料夾 ghost')]));
  });

  it('template folders (leading underscore) are not rooms of the game', () => {
    const dir = join(root, `maps${n++}`);
    mkdirSync(join(dir, '_template'), { recursive: true });
    writeFileSync(join(dir, '_template', 'room.tmj'), JSON.stringify(map([], { props: [] })));
    expect(checkMaps(dir)).toEqual([]);
    expect(checkChapters(dir, { ...loadMapContent(), chapters: new Map() })).toEqual([]);
  });

  it('the command fails when a chapter rule is broken and passes on the real maps', () => {
    const dir = join(root, `maps${n++}`);
    mkdirSync(join(dir, 'lab'), { recursive: true });
    writeFileSync(join(dir, 'lab', 'a.tmj'), JSON.stringify(a()));
    const run = (d: string) => spawnSync(process.execPath, ['tools/check-maps.ts', d], { encoding: 'utf8' });
    expect(run(dir).status).toBe(1);
    expect(run(dir).stdout).toContain('地圖資料夾沒有對應的章節檔');
    expect(run('public/assets/maps').status).toBe(0);
  });
});

describe('dialogue ids for the map check', () => {
  it('are read from every row of every CSV, even a conversation check-dialogue rejects', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ids-'));
    try {
      mkdirSync(join(dir, 'dialogue'));
      for (const f of ['tags.json', 'enemies.json']) cpSync(join('content', f), join(dir, f));
      writeFileSync(join(dir, 'dialogue', 'a.csv'), 'dialogueId,order,speaker,expression,text,condition,effect,next,fact\nfine,1,liver,normal,好,,,,\nbroken,0,liver,normal,壞,,,,\n,1,liver,normal,沒有編號,,,,\n');
      expect([...loadMapContent(dir).dialogueIds].sort()).toEqual(['broken', 'fine']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('include the shipped conversations', () => {
    expect(loadMapContent().dialogueIds.has('greybox.liver.hello')).toBe(true);
  });
});

describe('content readers', () => {
  it('parses quoted CSV fields', () => {
    expect(parseCsv('dialogueId,line\r\na,"說,""好"""\nb,"兩\n行"\n')).toEqual([['dialogueId', 'line'], ['a', '說,"好"'], ['b', '兩\n行']]);
  });

  it('loads the real content', () => {
    expect(loadMapContent().enemies.enemies.get('adenosine')).toEqual({ id: 'adenosine', category: 'reforming', solution: 'sleep', clings: true });
  });
});

describe('Tiled project file', () => {
  it('is up to date with the class definitions', () => {
    const r = spawnSync(process.execPath, ['tools/maps/make-tiled-project.ts', '--check'], { encoding: 'utf8' });
    expect(r.stdout).toContain('up to date');
    expect(r.status).toBe(0);
  });

  it('declares every object class with the parser defaults', () => {
    const project = JSON.parse(readFileSync('body-inc.tiled-project', 'utf8')) as { propertyTypes: { name: string; members?: { name: string; value: unknown }[] }[] };
    for (const [cls, spec] of Object.entries(OBJECT_CLASSES)) {
      const t = project.propertyTypes.find((p) => p.name === cls);
      expect(t, cls).toBeDefined();
      const { room } = readRoom('t', map([{ type: cls, width: 64, height: 32 }]), TAGS);
      const parsed = room.objects[0]?.props ?? {};
      for (const m of t!.members ?? []) expect([cls, m.name, m.value]).toEqual([cls, m.name, parsed[m.name] ?? 0]);
      expect(Object.keys(spec).sort()).toEqual((t!.members ?? []).map((m) => m.name).sort());
    }
  });

  it('builds an enum of enemy types from content', () => {
    const p = buildProject(['a', 'b']) as { propertyTypes: { name: string; values?: string[] }[] };
    expect(p.propertyTypes.find((t) => t.name === 'EnemyType')?.values).toEqual(['a', 'b']);
  });
});
