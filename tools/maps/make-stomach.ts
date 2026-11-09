/**
 * Writes the stomach chapter's greybox rooms (design doc 7.5) into public/assets/maps/stomach/.
 * For now these are two lab rooms. mixer-lab is for the mixer of core/stomach/mixer.ts: five food
 * boxes of the three portions, a belt into the hopper, a slow belt from the outlet to the small
 * intestine's timed gate (a port that takes parcels only, shut for 20 seconds and then open for 8),
 * and a belt loop along the walls so no box can be pushed into a dead corner. night-lab is for the sleep bar of core/rooms/sleep.ts: a bed that
 * takes 30 seconds to sleep in beside a mixer, so a box fed in just before bed sounds its alarm.
 * It has no belt loop: a box pushed into a corner stays there, but the bed needs no box.
 * Open them with ?room=stomach/mixer-lab and ?room=stomach/night-lab. The chapter's real rooms
 * (esophagus lift, warehouse, cold store, intestine corridor, night dock) come in later steps.
 *
 *   node tools/maps/make-stomach.ts
 */
import { shell, tileLayer, W, writeRoom } from './room-kit.ts';

const T = 32;
const { floor, walls, tileset } = shell('warehouse', 31);

const str = (name: string, propertytype: string | undefined, value: string) =>
  ({ name, type: 'string', ...(propertytype ? { propertytype } : {}), value });
const int = (name: string, value: number) => ({ name, type: 'int', value });
const obj = (name: string, value: number) => ({ name, type: 'object', value });
const rect = (id: number, name: string, type: string, col: number, row: number, cols: number, rows: number, properties: object[]) =>
  ({ id, name, type, x: col * T, y: row * T, width: cols * T, height: rows * T, rotation: 0, visible: true, properties });
const food = (id: number, col: number, row: number, portion: string) => ({
  id, name: `food-${portion}`, type: 'Box', x: col * T + 16, y: row * T + 16, width: 0, height: 0, rotation: 0, visible: true, point: true,
  properties: [str('boxType', 'BoxType', 'food'), str('portion', 'Portion', portion)],
});

writeRoom('stomach/mixer-lab.tmj', {
  type: 'map', version: '1.10', tiledversion: '1.11.0', orientation: 'orthogonal', renderorder: 'right-down',
  infinite: false, width: W, height: 12, tilewidth: T, tileheight: T, nextlayerid: 4, nextobjectid: 16, class: 'Room',
  properties: [
    { name: 'organ', type: 'string', value: 'stomach' },
    { name: 'role', type: 'string', value: 'puzzle' },
    { name: 'estSeconds', type: 'int', value: 120 },
    { name: 'storyOnly', type: 'bool', value: true },
  ],
  layers: [
    tileLayer(1, 'floor', floor),
    tileLayer(2, 'walls', walls),
    {
      id: 3, name: 'objects', type: 'objectgroup', x: 0, y: 0, opacity: 1, visible: true, draworder: 'topdown',
      objects: [
        { id: 1, name: 'start', type: 'PlayerStart', x: 2 * T + 16, y: 7 * T + 16, width: 0, height: 0, rotation: 0, visible: true, point: true },
        food(2, 4, 4, 'small'),
        food(3, 6, 4, 'normal'),
        food(4, 8, 4, 'large'),
        food(5, 4, 9, 'normal'),
        food(6, 6, 9, 'small'),
        rect(7, 'belt-in', 'Conveyor', 2, 6, 8, 1, [str('direction', 'Direction', 'E')]),
        rect(8, 'mixer', 'Mixer', 10, 6, 2, 1, [int('capacity', 3), str('outlet', 'Socket', 'E')]),
        rect(9, 'belt-out', 'Conveyor', 12, 6, 4, 1, [str('direction', 'Direction', 'E'), str('speed', 'ConveyorSpeed', 'slow')]),
        // Three parcels through the gate open the way on to the night lab. The gate keeps its own hours
        // (design doc 7.5, 攪拌機節奏): a parcel that misses the 8 open seconds waits on the belt for the next.
        rect(10, 'gate', 'Port', 16, 6, 2, 1, [
          int('need', 3), str('accepts', 'PortAccepts', 'parcel'), obj('target', 15), int('openSeconds', 8), int('closedSeconds', 20),
        ]),
        // A loop along the walls, as in the prologue warehouse: a box pushed against a wall rides round
        // instead of sticking, and on the west side it passes the in-belt, where one push sends it in.
        rect(11, 'loop-north', 'Conveyor', 2, 3, 17, 1, [str('direction', 'Direction', 'W')]),
        rect(12, 'loop-west', 'Conveyor', 1, 3, 1, 7, [str('direction', 'Direction', 'S')]),
        rect(13, 'loop-south', 'Conveyor', 1, 10, 17, 1, [str('direction', 'Direction', 'E')]),
        rect(14, 'loop-east', 'Conveyor', 18, 4, 1, 7, [str('direction', 'Direction', 'N')]),
        rect(15, 'door-e', 'Door', 19, 6, 1, 2, [str('socket', 'Socket', 'E'), str('lock', 'Lock', 'switch')]),
      ],
    },
  ],
  tilesets: [tileset],
});

writeRoom('stomach/night-lab.tmj', {
  type: 'map', version: '1.10', tiledversion: '1.11.0', orientation: 'orthogonal', renderorder: 'right-down',
  infinite: false, width: W, height: 12, tilewidth: T, tileheight: T, nextlayerid: 4, nextobjectid: 10, class: 'Room',
  properties: [
    { name: 'organ', type: 'string', value: 'stomach' },
    { name: 'role', type: 'string', value: 'puzzle' },
    { name: 'estSeconds', type: 'int', value: 75 },
    { name: 'storyOnly', type: 'bool', value: true },
  ],
  layers: [
    tileLayer(1, 'floor', floor),
    tileLayer(2, 'walls', walls),
    {
      id: 3, name: 'objects', type: 'objectgroup', x: 0, y: 0, opacity: 1, visible: true, draworder: 'topdown',
      objects: [
        { id: 1, name: 'start', type: 'PlayerStart', x: 2 * T + 16, y: 8 * T + 16, width: 0, height: 0, rotation: 0, visible: true, point: true },
        food(2, 4, 4, 'large'),
        food(3, 7, 4, 'small'),
        rect(4, 'belt-in', 'Conveyor', 2, 6, 8, 1, [str('direction', 'Direction', 'E')]),
        rect(5, 'mixer', 'Mixer', 10, 6, 2, 1, [int('capacity', 3), str('outlet', 'Socket', 'E')]),
        rect(6, 'belt-out', 'Conveyor', 12, 6, 3, 1, [str('direction', 'Direction', 'E'), str('speed', 'ConveyorSpeed', 'slow')]),
        rect(7, 'gate', 'Port', 15, 6, 2, 1, [int('need', 2), str('accepts', 'PortAccepts', 'parcel')]),
        rect(8, 'bedtime', 'Bed', 15, 8, 2, 2, [str('bedType', 'BedType', 'sleep'), int('sleepSeconds', 30)]),
        rect(9, 'door-w', 'Door', 0, 6, 1, 2, [str('socket', 'Socket', 'W')]),
      ],
    },
  ],
  tilesets: [tileset],
});
