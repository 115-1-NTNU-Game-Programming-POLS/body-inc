/**
 * Writes the greybox test room as a Tiled map (public/assets/maps/greybox/greybox-room.tmj).
 * It follows the standard room of design doc 13.3 (20 x 12, north wall rows 0-2, south wall
 * row 11, side walls one column) and the layer convention of src/core/rooms/tiled.ts.
 * The tileset is embedded because Phaser cannot read external tilesets (art direction 13.6).
 *
 *   node tools/maps/make-greybox.ts [world]     world defaults to brain
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRoom, playerStart, type TiledMap } from '../../src/core/rooms/tiled.ts';
import { loadDictionary } from '../../src/core/tags/dictionary.ts';
import { seedRng, nextFloat } from '../../src/core/rng.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TS_DIR = join(ROOT, 'public', 'assets', 'tilesets');
const W = 20;
const H = 12;

const world = process.argv[2] ?? 'brain';
const sheet = `tiles-${world}-struct`;
const slots: Record<string, number> = JSON.parse(readFileSync(join(TS_DIR, 'struct-slots.json'), 'utf8'));
const tsj = JSON.parse(readFileSync(join(TS_DIR, `${sheet}.tsj`), 'utf8'));
const gid = (name: string): number => {
  const i = slots[name];
  if (i === undefined) throw new Error(`unknown struct slot ${name}`);
  return i + 1;
};

const floor: number[] = new Array(W * H).fill(gid('floor-0'));
const walls: number[] = new Array(W * H).fill(0);
const set = (layer: number[], x: number, y: number, name: string) => { layer[y * W + x] = gid(name); };

let rng = seedRng(7);
for (let y = 4; y < 11; y++) {
  for (let x = 1; x < W - 1; x++) {
    let r: number;
    [r, rng] = nextFloat(rng);
    if (r < 0.15) set(floor, x, y, 'floor-1');
    else if (r < 0.22) set(floor, x, y, 'floor-2');
  }
}
for (let x = 1; x < W - 1; x++) set(floor, x, 3, 'floor-shadow-n');
set(floor, 1, 3, 'floor-shadow-nw');

for (let x = 0; x < W; x++) {
  set(walls, x, 0, 'walltop-edge-s');
  set(walls, x, 1, 'face-upper-m');
  set(walls, x, 2, 'face-lower-m');
  set(walls, x, 11, 'walltop-edge-n');
}
for (let y = 1; y < 11; y++) {
  set(walls, 0, y, 'walltop-edge-e');
  set(walls, W - 1, y, 'walltop-edge-w');
}
set(walls, 0, 0, 'walltop-inner-se');
set(walls, W - 1, 0, 'walltop-inner-sw');
set(walls, 0, 11, 'walltop-inner-ne');
set(walls, W - 1, 11, 'walltop-inner-nw');
set(walls, 1, 1, 'face-upper-l');
set(walls, 1, 2, 'face-lower-l');
set(walls, W - 2, 1, 'face-upper-r');
set(walls, W - 2, 2, 'face-lower-r');
for (const x of [5, 14]) { set(walls, x, 1, 'face-upper-v'); set(walls, x, 2, 'face-lower-v'); }
// North door (closed in the greybox), open south socket at columns 9-10, locked west door rows 6-7.
set(walls, 9, 0, 'door-n-l-top'); set(walls, 10, 0, 'door-n-r-top');
set(walls, 9, 1, 'door-n-l'); set(walls, 10, 1, 'door-n-r');
set(walls, 9, 2, 'door-n-l'); set(walls, 10, 2, 'door-n-r');
walls[11 * W + 9] = 0; walls[11 * W + 10] = 0;
set(walls, 8, 11, 'walltop-outer-ne'); set(walls, 11, 11, 'walltop-outer-nw');
set(walls, 0, 5, 'walltop-outer-se'); set(walls, 0, 8, 'walltop-outer-ne');
set(walls, 0, 6, 'door-locked-l'); set(walls, 0, 7, 'door-locked-r');
// A low partition inside the room, so collision is visible in the first playable build.
set(walls, 4, 7, 'partition-l'); set(walls, 5, 7, 'partition-m'); set(walls, 6, 7, 'partition-r');

const layer = (id: number, name: string, data: number[]) => ({
  id, name, type: 'tilelayer', x: 0, y: 0, width: W, height: H, opacity: 1, visible: true, data,
});

const door = (id: number, socket: string, lock: string, x: number, y: number, width: number, height: number) => ({
  id, name: `door-${socket.toLowerCase()}`, type: 'Door', x, y, width, height, rotation: 0, visible: true,
  properties: [{ name: 'socket', type: 'string', propertytype: 'Socket', value: socket }, { name: 'lock', type: 'string', propertytype: 'Lock', value: lock }],
});

const spawn = (id: number, enemyType: string, x: number, y: number, respawnSeconds: number) => ({
  id, name: enemyType, type: 'Spawn', x, y, width: 0, height: 0, rotation: 0, visible: true, point: true,
  properties: [
    { name: 'enemyType', type: 'string', propertytype: 'EnemyType', value: enemyType },
    ...(respawnSeconds ? [{ name: 'respawnSeconds', type: 'float', value: respawnSeconds }] : []),
  ],
});

const map = {
  type: 'map', version: '1.10', tiledversion: '1.11.0', orientation: 'orthogonal', renderorder: 'right-down',
  infinite: false, width: W, height: H, tilewidth: 32, tileheight: 32, nextlayerid: 4, nextobjectid: 10, class: 'Room',
  properties: [
    { name: 'organ', type: 'string', value: world },
    { name: 'role', type: 'string', value: 'combat' },
    { name: 'estSeconds', type: 'int', value: 30 },
    // The combat prototype room is also where the two non-defeatable kinds are first met.
    { name: 'tutorialFor', type: 'string', value: 'adenosine,alcohol_barrel' },
  ],
  layers: [
    layer(1, 'floor', floor),
    layer(2, 'walls', walls),
    {
      id: 3, name: 'objects', type: 'objectgroup', x: 0, y: 0, opacity: 1, visible: true, draworder: 'topdown',
      objects: [
        { id: 1, name: 'start', type: 'PlayerStart', x: 320, y: 256, width: 0, height: 0, rotation: 0, visible: true, point: true },
        door(2, 'N', 'key', 9 * 32, 0, 64, 96),
        door(3, 'S', 'none', 9 * 32, 11 * 32, 64, 32),
        door(4, 'W', 'key', 0, 6 * 32, 32, 64),
        spawn(5, 'salesman', 480, 200, 3),
        spawn(6, 'adenosine', 160, 180, 0),
        spawn(7, 'alcohol_barrel', 520, 300, 0),
        { id: 8, name: 'nap', type: 'Bed', x: 64, y: 300, width: 64, height: 32, rotation: 0, visible: true, properties: [] },
        { id: 9, name: 'line', type: 'Conveyor', x: 384, y: 320, width: 96, height: 32, rotation: 0, visible: true, properties: [] },
      ],
    },
  ],
  tilesets: [{
    firstgid: 1, name: sheet, image: `../../tilesets/${sheet}-ex.png`,
    imagewidth: tsj.imagewidth, imageheight: tsj.imageheight, tilewidth: 32, tileheight: 32,
    margin: tsj.margin, spacing: tsj.spacing, columns: tsj.columns, tilecount: tsj.tilecount,
  }],
};

const dict = loadDictionary(JSON.parse(readFileSync(join(ROOT, 'content', 'tags.json'), 'utf8')));
const room = parseRoom('greybox-room', map as unknown as TiledMap, dict);
playerStart(room);
const out = join(ROOT, 'public', 'assets', 'maps', 'greybox', 'greybox-room.tmj');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(map, null, 1) + '\n');
console.log(`greybox room (${world}) -> ${out}`);
