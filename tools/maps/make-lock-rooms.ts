/**
 * Writes three greybox rooms that show the door locks and pickups: the lock hall
 * (public/assets/maps/greybox/lock-hall.tmj), entered from the greybox test room's switch-locked
 * north door, the archive behind it (greybox/archive.tmj), and the storeroom behind the archive
 * (greybox/storeroom.tmj). The hall's west door has a clock lock open 08:00 to 10:00 and its north
 * door a resource lock open while caffeine is below 50, both into the archive, so either lock can
 * be seen opening and closing. The archive holds a cup of coffee, which shuts that north door, and
 * the file that is the key to its west door; the storeroom holds two handbook pages.
 *
 *   node tools/maps/make-lock-rooms.ts
 */
import { shell, tileLayer, W, writeRoom } from './room-kit.ts';

const str = (name: string, propertytype: string | undefined, value: string) =>
  ({ name, type: 'string', ...(propertytype ? { propertytype } : {}), value });
const door = (id: number, socket: string, lock: string, lockParam: string, x: number, y: number, width: number, height: number) => ({
  id, name: `door-${socket.toLowerCase()}`, type: 'Door', x, y, width, height, rotation: 0, visible: true,
  properties: [str('socket', 'Socket', socket), str('lock', 'Lock', lock), ...(lockParam ? [str('lockParam', undefined, lockParam)] : [])],
});
const pickup = (id: number, itemType: string, itemId: string, x: number, y: number) => ({
  id, name: '', type: 'Pickup', x, y, width: 0, height: 0, rotation: 0, visible: true, point: true,
  properties: [str('itemType', 'ItemType', itemType), ...(itemId ? [str('itemId', undefined, itemId)] : [])],
});
const start = (x: number, y: number) => ({ id: 1, name: 'start', type: 'PlayerStart', x, y, width: 0, height: 0, rotation: 0, visible: true, point: true });

const room = (organ: string, est: number, nextobjectid: number, floor: number[], walls: number[], tileset: object, objects: object[]) => ({
  type: 'map', version: '1.10', tiledversion: '1.11.0', orientation: 'orthogonal', renderorder: 'right-down',
  infinite: false, width: W, height: 12, tilewidth: 32, tileheight: 32, nextlayerid: 4, nextobjectid, class: 'Room',
  properties: [
    { name: 'organ', type: 'string', value: organ },
    { name: 'role', type: 'string', value: 'puzzle' },
    { name: 'estSeconds', type: 'int', value: est },
  ],
  layers: [
    tileLayer(1, 'floor', floor),
    tileLayer(2, 'walls', walls),
    { id: 3, name: 'objects', type: 'objectgroup', x: 0, y: 0, opacity: 1, visible: true, draworder: 'topdown', objects },
  ],
  tilesets: [tileset],
});

{
  const { floor, walls, set, tileset } = shell('brain', 11);
  // Locked doors stay drawn in the wall: a gap would let the operator walk out of a locked doorway.
  set(walls, 9, 0, 'door-n-l-top'); set(walls, 10, 0, 'door-n-r-top');
  set(walls, 9, 1, 'door-n-l'); set(walls, 10, 1, 'door-n-r');
  set(walls, 9, 2, 'door-n-l'); set(walls, 10, 2, 'door-n-r');
  set(walls, 0, 5, 'walltop-outer-se'); set(walls, 0, 8, 'walltop-outer-ne');
  set(walls, 0, 6, 'door-closed-l'); set(walls, 0, 7, 'door-closed-r');
  // The way back south is always open.
  walls[11 * W + 9] = 0; walls[11 * W + 10] = 0;
  set(walls, 8, 11, 'walltop-outer-ne'); set(walls, 11, 11, 'walltop-outer-nw');
  writeRoom('greybox/lock-hall.tmj', room('brain', 20, 5, floor, walls, tileset, [
    start(320, 288),
    door(2, 'N', 'resource', 'caffeine<50', 9 * 32, 0, 64, 96),
    door(3, 'W', 'clock', '08:00-10:00', 0, 6 * 32, 32, 64),
    door(4, 'S', 'none', '', 9 * 32, 11 * 32, 64, 32),
  ]));
}

{
  const { floor, walls, set, tileset } = shell('brain', 13);
  walls[11 * W + 9] = 0; walls[11 * W + 10] = 0;
  set(walls, 8, 11, 'walltop-outer-ne'); set(walls, 11, 11, 'walltop-outer-nw');
  for (const y of [6, 7]) walls[y * W + (W - 1)] = 0;
  set(walls, W - 1, 5, 'walltop-outer-sw'); set(walls, W - 1, 8, 'walltop-outer-nw');
  set(walls, 0, 5, 'walltop-outer-se'); set(walls, 0, 8, 'walltop-outer-ne');
  set(walls, 0, 6, 'door-closed-l'); set(walls, 0, 7, 'door-closed-r');
  writeRoom('greybox/archive.tmj', room('brain', 15, 7, floor, walls, tileset, [
    start(320, 224),
    door(2, 'S', 'none', '', 9 * 32, 11 * 32, 64, 32),
    door(3, 'E', 'none', '', (W - 1) * 32, 6 * 32, 32, 64),
    door(4, 'W', 'key', 'archive-key', 0, 6 * 32, 32, 64),
    pickup(5, 'file', 'archive-key', 480, 128),
    pickup(6, 'coffee', '', 160, 288),
  ]));
}

{
  const { floor, walls, set, tileset } = shell('brain', 17);
  for (const y of [6, 7]) walls[y * W + (W - 1)] = 0;
  set(walls, W - 1, 5, 'walltop-outer-sw'); set(walls, W - 1, 8, 'walltop-outer-nw');
  writeRoom('greybox/storeroom.tmj', room('brain', 10, 5, floor, walls, tileset, [
    start(320, 224),
    door(2, 'E', 'none', '', (W - 1) * 32, 6 * 32, 32, 64),
    pickup(3, 'handbook', 'caffeine', 256, 160),
    pickup(4, 'handbook', 'sleep_debt', 384, 160),
  ]));
}
