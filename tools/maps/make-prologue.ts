/**
 * Writes the greybox prologue (design doc 7.3), the template chapter content authors copy:
 * public/assets/maps/prologue/*.tmj. The rooms run in a line, west to east and then north:
 *
 *   lobby         start; HR desk (badge), time clock, the liver (handbook); the alarm on the way out
 *   freight-hall  two flyers, the combat lesson
 *   warehouse     three glucose crates, a belt and the dispatch port; filling the port opens the north door
 *   boardroom     the chairman hands over the stamp, a training dummy to try it on; the east door opens once the contract is on the table
 *   night-desk    the 2 a.m. signature, then the end of the chapter
 *
 * Real art and layout come later (build plan P7); what matters here is that every mechanism of
 * the prologue appears once, wired the way an author would wire it in Tiled.
 *
 *   node tools/maps/make-prologue.ts
 */
import { shell, tileLayer, W, writeRoom } from './room-kit.ts';

const str = (name: string, propertytype: string | undefined, value: string) =>
  ({ name, type: 'string', ...(propertytype ? { propertytype } : {}), value });
const int = (name: string, value: number) => ({ name, type: 'int', value });
const ref = (name: string, value: number) => ({ name, type: 'object', value });
const rect = (id: number, name: string, type: string, x: number, y: number, width: number, height: number, properties: object[] = []) =>
  ({ id, name, type, x, y, width, height, rotation: 0, visible: true, properties });
const point = (id: number, name: string, type: string, x: number, y: number, properties: object[] = []) =>
  ({ id, name, type, x, y, width: 0, height: 0, rotation: 0, visible: true, point: true, properties });
const start = (x: number, y: number) => point(1, 'start', 'PlayerStart', x, y);
const npc = (id: number, npcId: string, dialogueId: string, x: number, y: number) =>
  point(id, npcId, 'NPC', x, y, [str('npcId', undefined, npcId), str('dialogueId', undefined, dialogueId)]);
const trigger = (id: number, name: string, event: string, eventId: string, x: number, y: number, width: number, height: number) =>
  rect(id, name, 'Trigger', x, y, width, height, [str('event', 'TriggerEvent', event), ...(eventId ? [str('eventId', undefined, eventId)] : [])]);
const spawn = (id: number, enemyType: string, x: number, y: number, respawnSeconds = 0) =>
  point(id, enemyType, 'Spawn', x, y, [str('enemyType', undefined, enemyType), ...(respawnSeconds ? [{ name: 'respawnSeconds', type: 'float', value: respawnSeconds }] : [])]);
const crate = (id: number, col: number, row: number) => point(id, '', 'Box', col * 32 + 16, row * 32 + 16, [str('boxType', 'BoxType', 'glucose')]);
const door = (id: number, socket: string, lock = 'none', lockParam = '') => {
  const at: Record<string, [number, number, number, number]> = {
    N: [9 * 32, 0, 64, 96], S: [9 * 32, 11 * 32, 64, 32], W: [0, 6 * 32, 32, 64], E: [(W - 1) * 32, 6 * 32, 32, 64],
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
    if (open) {
      for (const x of [9, 10]) for (const y of [0, 1, 2]) walls[y * W + x] = 0;
      set(walls, 8, 0, 'walltop-outer-se'); set(walls, 11, 0, 'walltop-outer-sw');
    } else {
      set(walls, 9, 0, 'door-n-l-top'); set(walls, 10, 0, 'door-n-r-top');
      for (const y of [1, 2]) { set(walls, 9, y, 'door-n-l'); set(walls, 10, y, 'door-n-r'); }
    }
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

const room = (s: Shell, organ: string, role: string, est: number, objects: { id: number }[]) => ({
  type: 'map', version: '1.10', tiledversion: '1.11.0', orientation: 'orthogonal', renderorder: 'right-down',
  infinite: false, width: W, height: 12, tilewidth: 32, tileheight: 32, nextlayerid: 4,
  nextobjectid: Math.max(...objects.map((o) => o.id)) + 1, class: 'Room',
  properties: [
    { name: 'organ', type: 'string', value: organ },
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
  const s = shell('lobby', 31);
  socket(s, 'E', true);
  writeRoom('prologue/lobby.tmj', room(s, 'lobby', 'transit', 45, [
    start(96, 256),
    door(2, 'E'),
    npc(3, 'hr', 'prologue.hr.badge', 224, 160),
    trigger(4, 'time-clock', 'checkpoint', '', 9 * 32, 4 * 32, 64, 64),
    npc(5, 'liver', 'prologue.liver.welcome', 448, 192),
    // Across the way out, so the alarm sounds after the lobby, whatever order it was done in.
    trigger(6, 'alarm', 'dialogue', 'prologue.alarm', 16 * 32, 3 * 32, 32, 8 * 32),
  ]));
}

{
  const s = shell('warehouse', 37);
  socket(s, 'W', true);
  socket(s, 'E', true);
  writeRoom('prologue/freight-hall.tmj', room(s, 'liver', 'combat', 40, [
    start(96, 224),
    door(2, 'W'),
    door(3, 'E'),
    spawn(4, 'flyer', 448, 160),
    spawn(5, 'flyer', 480, 288),
  ]));
}

{
  const s = shell('warehouse', 41);
  socket(s, 'W', true);
  socket(s, 'N', false);
  // Belts run round three walls into the port in the north-west corner. A crate pushed against
  // any wall is carried in, or can still be pushed north into the port along the west wall, so no
  // push leaves a crate stuck where it can never be moved again.
  const port = 6;
  const dir = (d: string) => [str('direction', 'Direction', d)];
  writeRoom('prologue/warehouse.tmj', room(s, 'liver', 'puzzle', 60, [
    start(96, 224),
    door(2, 'W'),
    door(3, 'N', 'switch'),
    npc(4, 'liver', 'prologue.warehouse.liver', 112, 288),
    rect(5, 'belt-north', 'Conveyor', 3 * 32, 3 * 32, 16 * 32, 32, dir('W')),
    rect(port, 'dispatch', 'Port', 32, 3 * 32, 64, 32, [int('need', 3), ref('target', 3), str('dialogueId', undefined, 'prologue.port.done')]),
    crate(7, 6, 7),
    crate(8, 10, 7),
    crate(9, 14, 7),
    rect(10, 'belt-east', 'Conveyor', (W - 2) * 32, 4 * 32, 32, 7 * 32, dir('N')),
    rect(11, 'belt-south', 'Conveyor', 32, 10 * 32, (W - 3) * 32, 32, dir('E')),
  ]));
}

{
  const s = shell('lobby', 43);
  socket(s, 'S', true);
  socket(s, 'E', false);
  writeRoom('prologue/boardroom.tmj', room(s, 'lobby', 'core', 45, [
    start(320, 288),
    door(2, 'S'),
    // A resource lock on a story tag: the way on opens once the chairman has been talked to.
    door(3, 'E', 'resource', 'trial_contract'),
    npc(4, 'brain', 'prologue.chairman.stamp', 320, 144),
    spawn(5, 'dummy', 160, 224, 4),
  ]));
}

{
  const s = shell('lobby', 47);
  socket(s, 'W', true);
  writeRoom('prologue/night-desk.tmj', room(s, 'lobby', 'transit', 15, [
    start(96, 224),
    door(2, 'W'),
    trigger(3, 'night', 'dialogue', 'prologue.night', 6 * 32, 3 * 32, 32, 8 * 32),
    trigger(4, 'clock-out', 'end', '', 15 * 32, 3 * 32, 3 * 32, 8 * 32),
  ]));
}
