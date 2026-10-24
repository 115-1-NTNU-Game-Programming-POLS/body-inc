import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { TAGS } from '../../src/app/content.ts';
import { OBJECT_CLASSES } from '../../src/core/rooms/classes.ts';
import { readRoom, type RoomProblemCode, type TiledMap, type TiledObject } from '../../src/core/rooms/tiled.ts';
import { checkMaps, loadMapContent, parseCsv } from '../../tools/check-maps.ts';
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

    it('tutorialFor must name a non-defeatable enemy, and spawns must name a known one', () => {
      expect(check({ a: map([], { props: tutorial('salesman') }) })).toEqual([expect.stringContaining('不是打不掉的敵人種類')]);
      expect(check({ a: map([spawn('ghost')]) })).toEqual([expect.stringContaining('enemyType「ghost」不存在')]);
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
    });
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
