/**
 * Writes the map check fixtures under test/fixtures/maps/ (build plan S6):
 *   good/brain    a tutorial room and a corridor with a variant layer; must pass
 *   broken/brain  one room with a misplaced north door, an unknown tag in a `when`, and an
 *                 immune enemy whose solution object (Conveyor) exists nowhere in the chapter
 *
 *   node tools/maps/make-map-fixtures.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'test', 'fixtures', 'maps');
const W = 20;
const H = 12;

type Prop = { name: string; type: string; value: string | number | boolean };
const p = (name: string, value: string | number | boolean): Prop =>
  ({ name, type: typeof value === 'number' ? 'int' : typeof value === 'boolean' ? 'bool' : 'string', value });

let nextId = 1;
const obj = (type: string, x: number, y: number, props: Prop[] = [], width = 0, height = 0) =>
  ({ id: nextId++, name: '', type, x, y, width, height, rotation: 0, visible: true, ...(width ? {} : { point: true }), properties: props });

function walls(): number[] {
  const d = new Array(W * H).fill(0);
  for (let x = 0; x < W; x++) for (const y of [0, 1, 2, H - 1]) d[y * W + x] = 1;
  for (let y = 0; y < H; y++) { d[y * W] = 1; d[y * W + W - 1] = 1; }
  return d;
}

function room(props: Prop[], objects: object[], extraLayers: object[] = []) {
  return {
    type: 'map', version: '1.10', orientation: 'orthogonal', infinite: false, class: 'Room',
    width: W, height: H, tilewidth: 32, tileheight: 32, properties: props,
    layers: [
      { id: 1, name: 'walls', type: 'tilelayer', x: 0, y: 0, width: W, height: H, opacity: 1, visible: true, data: walls() },
      { id: 2, name: 'objects', type: 'objectgroup', x: 0, y: 0, opacity: 1, visible: true, objects },
      ...extraLayers,
    ],
    tilesets: [],
  };
}

function write(rel: string, map: object): void {
  const path = join(OUT, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(map, null, 1) + '\n');
  console.log(`-> ${path}`);
}

const roomProps = (role: string, extra: Prop[] = []) => [p('organ', 'brain'), p('role', role), p('estSeconds', 40), ...extra];

nextId = 1;
write('good/brain/tutorial-adenosine.tmj', room(roomProps('puzzle', [p('tutorialFor', 'adenosine')]), [
  obj('PlayerStart', 320, 256),
  obj('Spawn', 200, 220, [p('enemyType', 'adenosine')]),
  obj('Door', 9 * 32, 11 * 32, [p('socket', 'S')], 64, 32),
]));

nextId = 1;
write('good/brain/corridor.tmj', room(roomProps('combat'), [
  obj('Door', 9 * 32, 0, [p('socket', 'N')], 64, 96),
  obj('Door', 19 * 32, 6 * 32, [p('socket', 'E'), p('lock', 'switch')], 32, 64),
  obj('Switch', 100, 200, [p('target', 2)], 32, 32),
  obj('Bed', 500, 300, [p('bedType', 'nap'), p('requires', 'caffeine<15')], 64, 32),
], [{
  id: 3, name: 'variant:vents', type: 'objectgroup', x: 0, y: 0, opacity: 1, visible: true,
  properties: [p('when', 'sleep_debt>=2')],
  objects: [obj('Spawn', 160, 200, [p('enemyType', 'adenosine'), p('count', 2)])],
}]));

nextId = 1;
write('broken/brain/broken-room.tmj', room(roomProps('combat', [p('tutorialFor', 'alcohol_barrel')]), [
  obj('PlayerStart', 320, 256),
  obj('Door', 4 * 32, 0, [p('socket', 'N')], 64, 96),
  obj('Spawn', 200, 220, [p('enemyType', 'alcohol_barrel'), p('when', 'sleepy>=2')]),
]));
