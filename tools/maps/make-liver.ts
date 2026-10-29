/**
 * Writes the greybox liver chapter (design doc 7.7, build plan L1): public/assets/maps/liver/*.tmj.
 *
 *   party      start; the time clock, the three sobering-up myth stalls, two cheers kids, the toast card on the way out
 *   factory    the dock where alcohol crates wait, the outlet of the first line and the second line's
 *              intake fed by a belt along the south wall; the east door opens once receiving is empty
 *   warehouse  the glycogen warehouse with the liver's sign; the fasting page appears once dizzy
 *   rooftop    the venue where the toast boss sings (乾杯三巡); the east door opens once he gives up
 *   corner     the classmate who will not wake up: the rescue, then the end of the night
 *
 * Real art and layout come later; this places every L1 mechanism once, wired as an author would.
 *
 *   node tools/maps/make-liver.ts
 */
import { shell, tileLayer, W, writeRoom } from './room-kit.ts';

const str = (name: string, propertytype: string | undefined, value: string) =>
  ({ name, type: 'string', ...(propertytype ? { propertytype } : {}), value });
const rect = (id: number, name: string, type: string, x: number, y: number, width: number, height: number, properties: object[] = []) =>
  ({ id, name, type, x, y, width, height, rotation: 0, visible: true, properties });
const point = (id: number, name: string, type: string, x: number, y: number, properties: object[] = []) =>
  ({ id, name, type, x, y, width: 0, height: 0, rotation: 0, visible: true, point: true, properties });
const T = 32;
const start = (x: number, y: number) => point(1, 'start', 'PlayerStart', x, y);
const npc = (id: number, npcId: string, dialogueId: string, col: number, row: number) =>
  point(id, npcId, 'NPC', col * T + 16, row * T + 16, [str('npcId', undefined, npcId), str('dialogueId', undefined, dialogueId)]);
const trigger = (id: number, name: string, event: string, eventId: string, col: number, row: number, cols: number, rows: number) =>
  rect(id, name, 'Trigger', col * T, row * T, cols * T, rows * T, [str('event', 'TriggerEvent', event), ...(eventId ? [str('eventId', undefined, eventId)] : [])]);
const spawn = (id: number, enemyType: string, col: number, row: number) =>
  point(id, enemyType, 'Spawn', col * T + 16, row * T + 16, [str('enemyType', 'EnemyType', enemyType)]);
const handbook = (id: number, page: string, col: number, row: number, when = '') =>
  point(id, page, 'Pickup', col * T + 16, row * T + 16, [str('itemType', 'ItemType', 'handbook'), str('itemId', undefined, page), ...(when ? [str('when', undefined, when)] : [])]);
const line = (id: number, stage: string, col: number, row: number, cols: number, rows: number) =>
  stage === 'outlet'
    ? point(id, stage, 'Line', col * T + 16, row * T + 16, [str('stage', 'LineStage', stage)])
    : rect(id, stage, 'Line', col * T, row * T, cols * T, rows * T, [str('stage', 'LineStage', stage)]);
const door = (id: number, socket: string, lock = 'none', lockParam = '') => {
  const at: Record<string, [number, number, number, number]> = {
    N: [9 * T, 0, 64, 96], S: [9 * T, 11 * T, 64, 32], W: [0, 6 * T, 32, 64], E: [(W - 1) * T, 6 * T, 32, 64],
  };
  const [x, y, w, h] = at[socket]!;
  return rect(id, `door-${socket.toLowerCase()}`, 'Door', x, y, w, h, [
    str('socket', 'Socket', socket), ...(lock !== 'none' ? [str('lock', 'Lock', lock)] : []), ...(lockParam ? [str('lockParam', undefined, lockParam)] : []),
  ]);
};

type Shell = ReturnType<typeof shell>;

/** Opens the wall at a socket. A locked door keeps its wall tiles, so the doorway cannot be walked through while shut. */
function socket(s: Shell, side: 'N' | 'S' | 'E' | 'W', open: boolean): void {
  const { walls, set } = s;
  if (side === 'N') {
    for (const x of [9, 10]) for (const y of [0, 1, 2]) walls[y * W + x] = 0;
    set(walls, 8, 0, 'walltop-outer-se'); set(walls, 11, 0, 'walltop-outer-sw');
  } else if (side === 'S') {
    walls[11 * W + 9] = 0; walls[11 * W + 10] = 0;
    set(walls, 8, 11, 'walltop-outer-ne'); set(walls, 11, 11, 'walltop-outer-nw');
  } else {
    const x = side === 'W' ? 0 : W - 1;
    set(walls, x, 5, side === 'W' ? 'walltop-outer-se' : 'walltop-outer-sw');
    set(walls, x, 8, side === 'W' ? 'walltop-outer-ne' : 'walltop-outer-nw');
    if (open) for (const y of [6, 7]) walls[y * W + x] = 0;
    else { set(walls, x, 6, 'door-closed-l'); set(walls, x, 7, 'door-closed-r'); }
  }
}

const room = (s: Shell, role: string, est: number, objects: { id: number }[]) => ({
  type: 'map', version: '1.10', tiledversion: '1.11.0', orientation: 'orthogonal', renderorder: 'right-down',
  infinite: false, width: W, height: 12, tilewidth: T, tileheight: T, nextlayerid: 4,
  nextobjectid: Math.max(...objects.map((o) => o.id)) + 1, class: 'Room',
  properties: [
    { name: 'organ', type: 'string', value: 'liver' },
    { name: 'role', type: 'string', value: role },
    { name: 'estSeconds', type: 'int', value: est },
  ],
  layers: [
    tileLayer(1, 'floor', s.floor),
    tileLayer(2, 'walls', s.walls),
    { id: 3, name: 'objects', type: 'objectgroup', x: 0, y: 0, opacity: 1, visible: true, draworder: 'topdown', objects },
  ],
  tilesets: [s.tileset],
});

{
  const s = shell('liver', 53);
  socket(s, 'E', true);
  writeRoom('liver/party.tmj', room(s, 'transit', 60, [
    start(96, 224),
    door(2, 'E'),
    trigger(3, 'time-clock', 'checkpoint', '', 2, 8, 2, 2),
    npc(4, 'stall-coffee', 'liver.stall.coffee', 7, 4),
    npc(5, 'stall-shower', 'liver.stall.shower', 10, 4),
    npc(6, 'stall-throat', 'liver.stall.throat', 13, 4),
    // Across the way out, so the toast card comes once the stalls are behind the operator.
    trigger(7, 'toast', 'card', 'toast', 16, 3, 1, 8),
    // Two cheers kids between the stalls and the way out: only the folder's guard sends them off.
    spawn(8, 'cheers', 9, 8),
    spawn(9, 'cheers', 13, 9),
  ]));
}

{
  const s = shell('liver', 59);
  socket(s, 'W', true);
  socket(s, 'S', true);
  socket(s, 'E', false);
  writeRoom('liver/factory.tmj', room(s, 'puzzle', 240, [
    start(64, 224),
    door(2, 'W'),
    door(3, 'S'),
    // The queued door (design doc 7.7): it opens only once receiving is empty, and nothing speeds that up.
    door(4, 'E', 'resource', 'alcohol==0'),
    line(5, 'receiving', 2, 3, 6, 1),
    line(6, 'outlet', 9, 5, 0, 0),
    // A crate pushed against the south wall rides the belt into the second line; one pushed into a
    // corner goes back to the outlet the next time the room is entered.
    rect(7, 'belt-south', 'Conveyor', 1 * T, 10 * T, 14 * T, T, [str('direction', 'Direction', 'E')]),
    line(8, 'intake', 15, 9, 3, 2),
    npc(9, 'liver', 'liver.factory.console', 12, 3),
    handbook(10, 'alcohol_metabolism', 14, 3),
  ]));
}

{
  const s = shell('liver', 61);
  socket(s, 'N', true);
  writeRoom('liver/warehouse.tmj', room(s, 'treasure', 30, [
    start(320, 160),
    door(2, 'N'),
    npc(3, 'liver', 'liver.warehouse.sign', 7, 6),
    // Shown only to a run that has been dizzy, as design doc 7.7 hangs it on the warehouse door.
    handbook(4, 'fasting_alcohol', 13, 6, 'dizzy'),
  ]));
}

{
  const s = shell('liver', 71);
  socket(s, 'W', true);
  socket(s, 'E', false);
  writeRoom('liver/rooftop.tmj', room(s, 'core', 120, [
    start(64, 224),
    door(2, 'W'),
    // He gives up rather than being beaten; that conversation sets the tag, and from then on the
    // way to the classmate is open and he is no longer at the venue.
    door(3, 'E', 'resource', 'toast_conceded'),
    point(4, 'toast', 'Spawn', 320, 168, [str('enemyType', 'EnemyType', 'toast'), str('when', undefined, '!toast_conceded')]),
    trigger(5, 'toast-intro', 'dialogue', 'liver.toast.intro', 3, 3, 1, 8),
  ]));
}

{
  const s = shell('liver', 67);
  socket(s, 'W', true);
  writeRoom('liver/corner.tmj', room(s, 'core', 90, [
    start(64, 224),
    door(2, 'W'),
    // Wall to wall, so nobody walks past the classmate.
    trigger(3, 'akai', 'rescue', 'akai', 5, 3, 1, 8),
    trigger(4, 'toast-again', 'dialogue', 'liver.end', 10, 3, 1, 8),
    trigger(5, 'go-home', 'end', '', 15, 3, 3, 8),
  ]));
}
