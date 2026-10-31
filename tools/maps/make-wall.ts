/**
 * Writes the investigation wall (design doc 8.11, art direction 7.6): public/assets/maps/wall/hall.tmj,
 * a 40 x 12 story room with no doors and no enemies. The game pins the nodes of one report on its
 * EvidenceSlot objects, so this room only has to offer the slots and the way to the report desk.
 *
 *   columns 4 to 33   ten days of three columns; the upper track on row 1, the lower on row 2
 *   columns 30 to 33  the liver's board on the floor, rows 4 and 5, eight slots in two rows of four
 *   columns 34 to 38  the report desk (the handbook Pickup in front of it) and the filing cabinet
 *
 * The track rows are 1 and 2 where art direction 7.6 numbers them 1 and 2 from the top of the cork,
 * because row 0 of the standard shell is only the cap of the north wall. The desk's Pickup names a
 * placeholder page; the game puts the page the report unlocks in its place (app/wall.ts).
 *
 *   node tools/maps/make-wall.ts
 */
import { DAY_SLOTS, LIVER_SLOTS, WALL_DAYS } from '../../src/core/rooms/slots.ts';
import { shell, tileLayer, writeRoom } from './room-kit.ts';

const T = 32;
const COLS = 40;
const FIRST_DAY_COL = 4;
const BOARD = { col: 30, row: 4, cols: 4, rows: 2 };

const str = (name: string, propertytype: string | undefined, value: string) =>
  ({ name, type: 'string', ...(propertytype ? { propertytype } : {}), value });
const int = (name: string, value: number) => ({ name, type: 'int', value });
const rect = (id: number, name: string, type: string, x: number, y: number, width: number, height: number, properties: object[] = []) =>
  ({ id, name, type, x, y, width, height, rotation: 0, visible: true, properties });
const point = (id: number, name: string, type: string, x: number, y: number, properties: object[] = []) =>
  ({ id, name, type, x, y, width: 0, height: 0, rotation: 0, visible: true, point: true, properties });

const s = shell('lobby', 97, COLS);
const solid = (col: number, row: number, name: string) => { s.walls[row * COLS + col] = s.gid(name); };
// The liver's board and the desk stand on the floor, so they are drawn as wall faces the operator walks around.
for (let c = 0; c < BOARD.cols; c++) {
  solid(BOARD.col + c, BOARD.row, 'face-upper-m');
  solid(BOARD.col + c, BOARD.row + 1, 'face-lower-m');
}
for (const c of [35, 36, 37]) { solid(c, 5, 'face-upper-m'); solid(c, 6, 'face-lower-m'); }
solid(38, 4, 'face-upper-m');
solid(38, 5, 'face-lower-m');

const objects: object[] = [point(1, 'start', 'PlayerStart', 2 * T + 16, 8 * T)];
let id = 2;
for (let day = 1; day <= WALL_DAYS; day++) {
  for (const [lane, row] of [['upper', 1], ['lower', 2]] as const) {
    for (let order = 1; order <= DAY_SLOTS; order++) {
      const col = FIRST_DAY_COL + (day - 1) * DAY_SLOTS + (order - 1);
      objects.push(rect(id++, `slot-${lane}-${day}-${order}`, 'EvidenceSlot', col * T, row * T, T, T, [
        int('day', day), str('lane', 'SlotLane', lane), int('order', order),
      ]));
    }
  }
}
for (let order = 1; order <= LIVER_SLOTS; order++) {
  const col = BOARD.col + ((order - 1) % BOARD.cols);
  const row = BOARD.row + Math.floor((order - 1) / BOARD.cols);
  objects.push(rect(id++, `slot-liver-${order}`, 'EvidenceSlot', col * T, row * T, T, T, [str('lane', 'SlotLane', 'liver'), int('order', order)]));
}
objects.push(point(id++, 'report-desk', 'Pickup', 36 * T, 8 * T, [str('itemType', 'ItemType', 'handbook'), str('itemId', undefined, 'sleep_debt')]));

writeRoom('wall/hall.tmj', {
  type: 'map', version: '1.10', tiledversion: '1.11.0', orientation: 'orthogonal', renderorder: 'right-down',
  infinite: false, width: COLS, height: 12, tilewidth: T, tileheight: T, nextlayerid: 4, nextobjectid: id, class: 'Room',
  properties: [
    { name: 'organ', type: 'string', value: 'lobby' },
    { name: 'role', type: 'string', value: 'transit' },
    { name: 'estSeconds', type: 'int', value: 60 },
    { name: 'storyOnly', type: 'bool', value: true },
  ],
  layers: [
    tileLayer(1, 'floor', s.floor, COLS),
    tileLayer(2, 'walls', s.walls, COLS),
    { id: 3, name: 'objects', type: 'objectgroup', x: 0, y: 0, opacity: 1, visible: true, draworder: 'topdown', objects },
  ],
  tilesets: [s.tileset],
});
