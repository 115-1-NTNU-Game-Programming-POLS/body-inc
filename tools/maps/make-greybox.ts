/**
 * Writes the greybox test room as a Tiled map (public/assets/maps/greybox/greybox-room.tmj),
 * following the layer convention of src/core/rooms/tiled.ts.
 *
 *   node tools/maps/make-greybox.ts [world]     world defaults to brain
 */
import { shell, tileLayer, W, writeRoom } from './room-kit.ts';

const world = process.argv[2] ?? 'brain';
const { sheet, floor, walls, set, tileset } = shell(world);

for (const x of [5, 14]) { set(walls, x, 1, 'face-upper-v'); set(walls, x, 2, 'face-lower-v'); }
// North door (shut by a switch lock until the lever beside it is thrown), open south socket at
// columns 9-10, locked west door rows 6-7.
set(walls, 9, 0, 'door-n-l-top'); set(walls, 10, 0, 'door-n-r-top');
set(walls, 9, 1, 'door-n-l'); set(walls, 10, 1, 'door-n-r');
set(walls, 9, 2, 'door-n-l'); set(walls, 10, 2, 'door-n-r');
walls[11 * W + 9] = 0; walls[11 * W + 10] = 0;
set(walls, 8, 11, 'walltop-outer-ne'); set(walls, 11, 11, 'walltop-outer-nw');
set(walls, 0, 5, 'walltop-outer-se'); set(walls, 0, 8, 'walltop-outer-ne');
set(walls, 0, 6, 'door-locked-l'); set(walls, 0, 7, 'door-locked-r');
// A low partition inside the room, so collision is visible in the first playable build.
set(walls, 4, 7, 'partition-l'); set(walls, 5, 7, 'partition-m'); set(walls, 6, 7, 'partition-r');

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

writeRoom('greybox/greybox-room.tmj', {
  type: 'map', version: '1.10', tiledversion: '1.11.0', orientation: 'orthogonal', renderorder: 'right-down',
  infinite: false, width: W, height: 12, tilewidth: 32, tileheight: 32, nextlayerid: 4, nextobjectid: 12, class: 'Room',
  properties: [
    { name: 'organ', type: 'string', value: world },
    { name: 'role', type: 'string', value: 'combat' },
    { name: 'estSeconds', type: 'int', value: 30 },
    // The combat prototype room is also where the two non-defeatable kinds are first met.
    { name: 'tutorialFor', type: 'string', value: 'adenosine,alcohol_barrel' },
  ],
  layers: [
    tileLayer(1, 'floor', floor),
    tileLayer(2, 'walls', walls),
    {
      id: 3, name: 'objects', type: 'objectgroup', x: 0, y: 0, opacity: 1, visible: true, draworder: 'topdown',
      objects: [
        { id: 1, name: 'start', type: 'PlayerStart', x: 320, y: 256, width: 0, height: 0, rotation: 0, visible: true, point: true },
        door(2, 'N', 'switch', 9 * 32, 0, 64, 96),
        door(3, 'S', 'none', 9 * 32, 11 * 32, 64, 32),
        door(4, 'W', 'key', 0, 6 * 32, 32, 64),
        spawn(5, 'salesman', 480, 200, 3),
        spawn(6, 'adenosine', 160, 180, 0),
        spawn(7, 'alcohol_barrel', 520, 300, 0),
        { id: 8, name: 'nap', type: 'Bed', x: 64, y: 300, width: 64, height: 32, rotation: 0, visible: true, properties: [] },
        { id: 9, name: 'line', type: 'Conveyor', x: 384, y: 320, width: 96, height: 32, rotation: 0, visible: true, properties: [] },
        spawn(10, 'flyer', 560, 150, 3),
        // On the wall face two tiles left of the north door: the interact key reaches it from the
        // floor below, and a staple fired north pins it from anywhere in the column.
        {
          id: 11, name: 'lever', type: 'Switch', x: 7 * 32 + 16, y: 80, width: 0, height: 0, rotation: 0, visible: true, point: true,
          properties: [{ name: 'target', type: 'object', value: 2 }],
        },
      ],
    },
  ],
  tilesets: [tileset],
});
console.log(`greybox room (${world}), sheet ${sheet}`);
