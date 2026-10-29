/**
 * Writes the greybox midterm chapter (design doc 7.6, build plan L2): public/assets/maps/midterm/*.tmj.
 *
 *   hall        start; the time clock, and the liver's sticky note for a run that skipped breakfast
 *   exam-room   the brain's big meeting room: the paper's greeting, then the exam across the room;
 *               both doors stay shut until the exam has been sat
 *   corridor    the way out after the exam, and the end of the chapter
 *
 * Real art and layout come later; this places every L2 story mechanism once, wired as an author would.
 *
 *   node tools/maps/make-midterm.ts
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
const trigger = (id: number, name: string, event: string, eventId: string, col: number, row: number, cols: number, rows: number, when = '') =>
  rect(id, name, 'Trigger', col * T, row * T, cols * T, rows * T, [
    str('event', 'TriggerEvent', event), ...(eventId ? [str('eventId', undefined, eventId)] : []), ...(when ? [str('when', undefined, when)] : []),
  ]);
const door = (id: number, socket: 'E' | 'W', lock = 'none', lockParam = '') => {
  const x = socket === 'W' ? 0 : (W - 1) * T;
  return rect(id, `door-${socket.toLowerCase()}`, 'Door', x, 6 * T, 32, 64, [
    str('socket', 'Socket', socket), ...(lock !== 'none' ? [str('lock', 'Lock', lock)] : []), ...(lockParam ? [str('lockParam', undefined, lockParam)] : []),
  ]);
};

type Shell = ReturnType<typeof shell>;

/** Opens the side wall at a socket. A locked door keeps its wall tiles, so the doorway cannot be walked through while shut. */
function socket(s: Shell, side: 'E' | 'W', open: boolean): void {
  const { walls, set } = s;
  const x = side === 'W' ? 0 : W - 1;
  set(walls, x, 5, side === 'W' ? 'walltop-outer-se' : 'walltop-outer-sw');
  set(walls, x, 8, side === 'W' ? 'walltop-outer-ne' : 'walltop-outer-nw');
  if (open) for (const y of [6, 7]) walls[y * W + x] = 0;
  else { set(walls, x, 6, 'door-closed-l'); set(walls, x, 7, 'door-closed-r'); }
}

const room = (s: Shell, organ: string, role: string, est: number, objects: { id: number }[], tutorialFor = '') => ({
  type: 'map', version: '1.10', tiledversion: '1.11.0', orientation: 'orthogonal', renderorder: 'right-down',
  infinite: false, width: W, height: 12, tilewidth: T, tileheight: T, nextlayerid: 4,
  nextobjectid: Math.max(...objects.map((o) => o.id)) + 1, class: 'Room',
  properties: [
    { name: 'organ', type: 'string', value: organ },
    { name: 'role', type: 'string', value: role },
    { name: 'estSeconds', type: 'int', value: est },
    { name: 'storyOnly', type: 'bool', value: true },
    ...(tutorialFor ? [{ name: 'tutorialFor', type: 'string', value: tutorialFor }] : []),
  ],
  layers: [
    tileLayer(1, 'floor', s.floor),
    tileLayer(2, 'walls', s.walls),
    { id: 3, name: 'objects', type: 'objectgroup', x: 0, y: 0, opacity: 1, visible: true, draworder: 'topdown', objects },
  ],
  tilesets: [s.tileset],
});

{
  const s = shell('brain', 83);
  socket(s, 'E', true);
  writeRoom('midterm/hall.tmj', room(s, 'brain', 'transit', 30, [
    start(96, 224),
    door(2, 'E'),
    trigger(3, 'time-clock', 'checkpoint', '', 2, 8, 2, 2),
    // On the meeting room's door (design doc 8.9): skipping breakfast costs nothing, and the liver says so.
    trigger(4, 'sticky-note', 'dialogue', 'midterm.sticky', 16, 3, 1, 8, '!breakfast'),
  ]));
}

{
  const s = shell('exam', 89);
  socket(s, 'W', false);
  socket(s, 'E', false);
  writeRoom('midterm/exam-room.tmj', room(s, 'exam', 'core', 240, [
    start(64, 224),
    // Shut until the exam is sat, so the fight cannot be walked out of: leaving would rebuild the
    // room without it, and its trigger is already spent. Nothing in the exam costs a heart.
    door(2, 'W', 'resource', 'midterm_taken'),
    door(3, 'E', 'resource', 'midterm_taken'),
    point(4, 'exam_paper', 'Spawn', 320, 136, [str('enemyType', 'EnemyType', 'exam_paper'), str('when', undefined, '!midterm_taken')]),
    trigger(5, 'paper-greeting', 'dialogue', 'midterm.paper', 2, 3, 1, 8, '!midterm_taken'),
    // Wall to wall a step further in, so the greeting always comes first.
    trigger(6, 'exam', 'exam', 'midterm', 4, 3, 1, 8, '!midterm_taken'),
    // The paper cannot be beaten (design doc 5.5): its greeting and the forecast teach what it wants
    // before it throws anything, so this room is its tutorial too.
  ], 'exam_paper'));
}

{
  const s = shell('brain', 97);
  socket(s, 'W', true);
  writeRoom('midterm/corridor.tmj', room(s, 'brain', 'transit', 20, [
    start(64, 224),
    door(2, 'W'),
    trigger(3, 'go-home', 'end', '', 15, 3, 3, 8),
  ]));
}
