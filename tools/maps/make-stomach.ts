/**
 * Writes the stomach chapter's greybox rooms (design doc 7.5) into public/assets/maps/stomach/.
 * For now that is one lab room for the mixer of core/stomach/mixer.ts: five food boxes of the three
 * portions, a belt into the hopper, and a slow belt from the outlet to the small intestine's gate, a
 * port that takes parcels only. Open it with ?room=stomach/mixer-lab. The chapter's real rooms
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
const rect = (id: number, name: string, type: string, col: number, row: number, cols: number, rows: number, properties: object[]) =>
  ({ id, name, type, x: col * T, y: row * T, width: cols * T, height: rows * T, rotation: 0, visible: true, properties });
const food = (id: number, col: number, row: number, portion: string) => ({
  id, name: `food-${portion}`, type: 'Box', x: col * T + 16, y: row * T + 16, width: 0, height: 0, rotation: 0, visible: true, point: true,
  properties: [str('boxType', 'BoxType', 'food'), str('portion', 'Portion', portion)],
});

writeRoom('stomach/mixer-lab.tmj', {
  type: 'map', version: '1.10', tiledversion: '1.11.0', orientation: 'orthogonal', renderorder: 'right-down',
  infinite: false, width: W, height: 12, tilewidth: T, tileheight: T, nextlayerid: 4, nextobjectid: 13, class: 'Room',
  properties: [
    { name: 'organ', type: 'string', value: 'stomach' },
    { name: 'role', type: 'string', value: 'puzzle' },
    { name: 'estSeconds', type: 'int', value: 90 },
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
        rect(7, 'belt-in', 'Conveyor', 3, 6, 7, 1, [str('direction', 'Direction', 'E')]),
        rect(8, 'mixer', 'Mixer', 10, 6, 2, 1, [int('capacity', 3), str('outlet', 'Socket', 'E')]),
        rect(9, 'belt-out', 'Conveyor', 12, 6, 4, 1, [str('direction', 'Direction', 'E'), str('speed', 'ConveyorSpeed', 'slow')]),
        rect(10, 'gate', 'Port', 16, 6, 2, 1, [int('need', 3), str('accepts', 'PortAccepts', 'parcel')]),
      ],
    },
  ],
  tilesets: [tileset],
});
