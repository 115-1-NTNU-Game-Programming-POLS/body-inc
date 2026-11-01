/**
 * Writes the rooms of the two patrols the semester mode plays (design doc 8.5): public/assets/maps/patrol-brain/*.tmj and
 * patrol-liver/*.tmj. A patrol is four rooms in a row, the entrance hall, two challenge rooms and the core room, joined west to east.
 *
 *   brain  lobby, desk and hall (flyers and salesmen; the lost intern in the hall is the side goal), core (the rest room:
 *          the adenosine the sleep debt leaves are led into the rest area and locked there)
 *   liver  lobby, party and stock (cheers kids, flyers and salesmen; the clerk in stock is the side goal), core (the production
 *          line: the acetaldehyde crates of the day's work orders pushed into the second line)
 *
 * The rooms are entered with the tags of the day the semester hands in and never run the chapter clock, so a variant reads the
 * day's state at the door. The way out of a core room is the elevator trigger on its east wall.
 *
 *   node tools/maps/make-patrol.ts
 */
import { shell, tileLayer, W, writeRoom } from './room-kit.ts';

const T = 32;
type Side = 'N' | 'S' | 'E' | 'W';
type Obj = { id: number };

const str = (name: string, propertytype: string | undefined, value: string) =>
  ({ name, type: 'string', ...(propertytype ? { propertytype } : {}), value });
const rect = (id: number, name: string, type: string, x: number, y: number, width: number, height: number, properties: object[] = []) =>
  ({ id, name, type, x, y, width, height, rotation: 0, visible: true, properties });
const point = (id: number, name: string, type: string, x: number, y: number, properties: object[] = []) =>
  ({ id, name, type, x, y, width: 0, height: 0, rotation: 0, visible: true, point: true, properties });
const at = (col: number, row: number) => [col * T + 16, row * T + 16] as const;

const start = (col: number, row: number) => point(1, 'start', 'PlayerStart', ...at(col, row));
const spawn = (id: number, enemyType: string, col: number, row: number, when = '', count = 1) =>
  point(id, enemyType, 'Spawn', ...at(col, row), [
    str('enemyType', 'EnemyType', enemyType), ...(count > 1 ? [{ name: 'count', type: 'int', value: count }] : []), ...(when ? [str('when', undefined, when)] : []),
  ]);
const npc = (id: number, npcId: string, dialogueId: string, col: number, row: number) =>
  point(id, npcId, 'NPC', ...at(col, row), [str('npcId', undefined, npcId), str('dialogueId', undefined, dialogueId)]);
const door = (id: number, socket: Side) => {
  const bounds: Record<Side, readonly [number, number, number, number]> = {
    W: [0, 6 * T, T, 2 * T], E: [(W - 1) * T, 6 * T, T, 2 * T], N: [9 * T, 0, 2 * T, 3 * T], S: [9 * T, 11 * T, 2 * T, T],
  };
  const [x, y, w, h] = bounds[socket];
  return rect(id, `door-${socket.toLowerCase()}`, 'Door', x, y, w, h, [str('socket', 'Socket', socket)]);
};
/** The way out of a patrol: stepping on it ends the patrol, with whatever the core room's goal stands at. */
const elevator = (id: number, col: number, row: number, cols: number, rows: number) =>
  rect(id, 'elevator', 'Trigger', col * T, row * T, cols * T, rows * T, [str('event', 'TriggerEvent', 'end'), str('eventId', undefined, 'elevator'), { name: 'once', type: 'bool', value: false }]);
const line = (id: number, stage: string, col: number, row: number, cols: number, rows: number) =>
  stage === 'outlet'
    ? point(id, stage, 'Line', ...at(col, row), [str('stage', 'LineStage', stage)])
    : rect(id, stage, 'Line', col * T, row * T, cols * T, rows * T, [str('stage', 'LineStage', stage)]);

type Shell = ReturnType<typeof shell>;

function opening(s: Shell, side: 'E' | 'W'): void {
  const { walls, set } = s;
  const x = side === 'W' ? 0 : W - 1;
  set(walls, x, 5, side === 'W' ? 'walltop-outer-se' : 'walltop-outer-sw');
  set(walls, x, 8, side === 'W' ? 'walltop-outer-ne' : 'walltop-outer-nw');
  for (const y of [6, 7]) walls[y * W + x] = 0;
}

function room(s: Shell, organ: string, role: string, est: number, objects: Obj[], extra: object[] = []) {
  return {
    type: 'map', version: '1.10', tiledversion: '1.11.0', orientation: 'orthogonal', renderorder: 'right-down',
    infinite: false, width: W, height: 12, tilewidth: T, tileheight: T, nextlayerid: 4,
    nextobjectid: Math.max(...objects.map((o) => o.id)) + 1, class: 'Room',
    properties: [
      { name: 'organ', type: 'string', value: organ },
      { name: 'role', type: 'string', value: role },
      { name: 'estSeconds', type: 'int', value: est },
      ...extra,
    ],
    layers: [
      tileLayer(1, 'floor', s.floor),
      tileLayer(2, 'walls', s.walls),
      { id: 3, name: 'objects', type: 'objectgroup', x: 0, y: 0, opacity: 1, visible: true, draworder: 'topdown', objects },
    ],
    tilesets: [s.tileset],
  };
}

/** A room with a door on each side that has a neighbour; `first` and `last` leave out the west or the east one. */
function chain(world: string, seed: number, doors: { w: boolean; e: boolean }) {
  const s = shell(world, seed);
  if (doors.w) opening(s, 'W');
  if (doors.e) opening(s, 'E');
  return s;
}

for (const floor of ['brain', 'liver'] as const) {
  const folder = `patrol-${floor}`;
  const seed = floor === 'brain' ? 101 : 131;

  // The entrance hall (design doc 8.5): the floor's employee says how the day stands.
  {
    const s = chain(floor === 'brain' ? 'lobby' : 'liver', seed, { w: false, e: true });
    writeRoom(`${folder}/lobby.tmj`, room(s, 'lobby', 'transit', 20, [
      start(3, 6),
      door(2, 'E'),
      npc(3, floor, `patrol.${floor}.lobby`, 9, 5),
    ]));
  }
}

// Brain: two challenge rooms and the rest room.
{
  const s = chain('brain', 103, { w: true, e: true });
  writeRoom('patrol-brain/desk.tmj', room(s, 'brain', 'combat', 45, [
    start(3, 6),
    door(2, 'W'),
    door(3, 'E'),
    spawn(4, 'flyer', 10, 4),
    spawn(5, 'flyer', 10, 9),
    spawn(6, 'salesman', 14, 6),
  ]));
}
{
  const s = chain('brain', 107, { w: true, e: true });
  writeRoom('patrol-brain/hall.tmj', room(s, 'brain', 'combat', 45, [
    start(3, 6),
    door(2, 'W'),
    door(3, 'E'),
    spawn(4, 'salesman', 8, 5),
    spawn(5, 'salesman', 8, 9),
    spawn(6, 'flyer', 14, 7),
    // The side goal (design doc 8.5): the intern is in the far corner, behind the two who guard the way to it.
    npc(7, 'intern', 'patrol.brain.intern', 17, 4),
  ]));
}
{
  const s = chain('brain', 109, { w: true, e: false });
  // The rest area is a band of mats across the middle of the room, so what chases the operator westwards from the east side crosses it.
  writeRoom('patrol-brain/core.tmj', room(s, 'brain', 'core', 70, [
    start(3, 6),
    door(2, 'W'),
    rect(3, 'rest-area', 'Pen', 8 * T, 3 * T, 3 * T, 8 * T),
    // The sleep debt the day left sets how many: a rested host gets a quiet room (design doc 8.5, 8.7).
    spawn(4, 'adenosine', 14, 5, 'sleep_debt>=0.5', 2),
    spawn(5, 'adenosine', 16, 8, 'sleep_debt>=2', 2),
    spawn(6, 'adenosine', 15, 4, 'sleep_debt>=4', 2),
    // The nap sofa shakes off what has latched on, as in the story.
    rect(7, 'nap', 'Bed', 2 * T, 9 * T, 2 * T, T, [str('bedType', 'BedType', 'nap')]),
    elevator(8, 18, 3, 1, 8),
  ], [{ name: 'tutorialFor', type: 'string', value: 'adenosine' }]));
}

// Liver: two challenge rooms and the production line.
{
  const s = chain('liver', 133, { w: true, e: true });
  writeRoom('patrol-liver/party.tmj', room(s, 'liver', 'combat', 45, [
    start(3, 6),
    door(2, 'W'),
    door(3, 'E'),
    spawn(4, 'cheers', 9, 5),
    spawn(5, 'cheers', 12, 9),
    spawn(6, 'flyer', 14, 6),
  ]));
}
{
  const s = chain('liver', 137, { w: true, e: true });
  writeRoom('patrol-liver/stock.tmj', room(s, 'liver', 'combat', 45, [
    start(3, 6),
    door(2, 'W'),
    door(3, 'E'),
    spawn(4, 'salesman', 8, 5),
    spawn(5, 'salesman', 8, 9),
    spawn(6, 'flyer', 14, 7),
    npc(7, 'clerk', 'patrol.liver.clerk', 17, 4),
  ]));
}
{
  const s = chain('liver', 139, { w: true, e: false });
  // The story's factory (design doc 7.7) without its queued door and its way south: the crates are the day's work orders, already out of
  // the first line, and the way out is the elevator.
  writeRoom('patrol-liver/core.tmj', room(s, 'liver', 'core', 70, [
    start(3, 6),
    door(2, 'W'),
    line(3, 'receiving', 2, 3, 6, 1),
    line(4, 'outlet', 9, 5, 0, 0),
    rect(5, 'belt-south', 'Conveyor', 1 * T, 10 * T, 14 * T, T, [str('direction', 'Direction', 'E')]),
    line(6, 'intake', 15, 9, 3, 2),
    elevator(7, 18, 3, 1, 5),
  ]));
}
