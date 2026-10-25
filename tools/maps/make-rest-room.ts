/**
 * Writes the greybox rest room (public/assets/maps/greybox/rest-room.tmj), the build-plan P0
 * room where the chapter shell is exercised: a time clock (checkpoint), a nap bed, a sleep bed
 * that needs the caffeine residue below 15 (design doc 7.4), and a talking NPC. It joins the
 * greybox test room by its north door and the brain corridor by its east door. Real lobby
 * rooms are build-plan P7.
 *
 *   node tools/maps/make-rest-room.ts
 */
import { shell, tileLayer, W, writeRoom } from './room-kit.ts';

const { floor, walls, set, tileset } = shell('lobby', 23);

// Open north socket (columns 9-10, rows 0-2) and east socket (rows 6-7), each with the outer wall corners.
for (const x of [9, 10]) for (const y of [0, 1, 2]) walls[y * W + x] = 0;
set(walls, 8, 0, 'walltop-outer-se'); set(walls, 11, 0, 'walltop-outer-sw');
for (const y of [6, 7]) walls[y * W + (W - 1)] = 0;
set(walls, W - 1, 5, 'walltop-outer-sw'); set(walls, W - 1, 8, 'walltop-outer-nw');

const str = (name: string, propertytype: string | undefined, value: string) =>
  ({ name, type: 'string', ...(propertytype ? { propertytype } : {}), value });
const rect = (id: number, name: string, type: string, x: number, y: number, width: number, height: number, properties: object[]) =>
  ({ id, name, type, x, y, width, height, rotation: 0, visible: true, properties });

writeRoom('greybox/rest-room.tmj', {
  type: 'map', version: '1.10', tiledversion: '1.11.0', orientation: 'orthogonal', renderorder: 'right-down',
  infinite: false, width: W, height: 12, tilewidth: 32, tileheight: 32, nextlayerid: 4, nextobjectid: 9, class: 'Room',
  properties: [
    { name: 'organ', type: 'string', value: 'lobby' },
    { name: 'role', type: 'string', value: 'rest' },
    { name: 'estSeconds', type: 'int', value: 20 },
  ],
  layers: [
    tileLayer(1, 'floor', floor),
    tileLayer(2, 'walls', walls),
    {
      id: 3, name: 'objects', type: 'objectgroup', x: 0, y: 0, opacity: 1, visible: true, draworder: 'topdown',
      objects: [
        { id: 1, name: 'start', type: 'PlayerStart', x: 320, y: 288, width: 0, height: 0, rotation: 0, visible: true, point: true },
        rect(2, 'door-n', 'Door', 9 * 32, 0, 64, 96, [str('socket', 'Socket', 'N')]),
        rect(3, 'door-e', 'Door', (W - 1) * 32, 6 * 32, 32, 64, [str('socket', 'Socket', 'E')]),
        rect(4, 'time-clock', 'Trigger', 3 * 32, 6 * 32, 64, 64, [str('event', 'TriggerEvent', 'checkpoint')]),
        rect(5, 'nap', 'Bed', 3 * 32, 9 * 32, 64, 32, [str('bedType', 'BedType', 'nap')]),
        rect(6, 'bedtime', 'Bed', 14 * 32, 8 * 32, 64, 64, [str('bedType', 'BedType', 'sleep'), str('requires', undefined, 'caffeine<15')]),
        {
          id: 7, name: 'liver', type: 'NPC', x: 320, y: 200, width: 0, height: 0, rotation: 0, visible: true, point: true,
          properties: [str('npcId', undefined, 'liver'), str('dialogueId', undefined, 'greybox.liver.hello')],
        },
      ],
    },
  ],
  tilesets: [tileset],
});
