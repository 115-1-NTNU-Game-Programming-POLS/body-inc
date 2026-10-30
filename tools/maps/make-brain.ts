/**
 * Writes the greybox brain chapter (design doc 7.4, build plan P7): public/assets/maps/brain/*.tmj.
 * It is chapter 1 of the story, between the prologue and the midterm.
 *
 *   lobby            1F reception: the time clock; the morning coffee machine behind a clock-locked
 *                    north door (08:00 to 10:00) and the afternoon one behind the west door (17:00 to 19:00)
 *   coffee-am        the 08:00 machine and the 〈咖啡因〉 page behind it
 *   coffee-pm        the 17:00 machine
 *   general-affairs  the clerk hands over the folder (grant:folder)
 *   tutorial         a flyer's sheets and an energy-drink salesman's cans to parry; the 〈咖啡因與能量飲料〉 page
 *   open-office      2F: clock vents with their adenosine (more at sleep_debt>=2), the nap sofa, the group-chat card
 *   hippocampus      3F: six memory files, three phone spirits that eat time until switched off; the time clock before the boss
 *   arena            4F: the caffeine boss; the east door opens once the renewal is settled
 *   rooftop          the sleep door (bed needing caffeine<50; the archive halves its crew as the residual rises), the 〈睡眠債〉 page, and the end of the chapter
 *
 * Real art, the staging desk and the hourly fade of design doc 7.4 come later; this places the mechanisms the
 * greybox already has, wired as an author would wire them in Tiled.
 *
 *   node tools/maps/make-brain.ts
 */
import { shell, tileLayer, W, writeRoom } from './room-kit.ts';

const T = 32;
const str = (name: string, propertytype: string | undefined, value: string) =>
  ({ name, type: 'string', ...(propertytype ? { propertytype } : {}), value });
const rect = (id: number, name: string, type: string, x: number, y: number, width: number, height: number, properties: object[] = []) =>
  ({ id, name, type, x, y, width, height, rotation: 0, visible: true, properties });
const point = (id: number, name: string, type: string, x: number, y: number, properties: object[] = []) =>
  ({ id, name, type, x, y, width: 0, height: 0, rotation: 0, visible: true, point: true, properties });

const start = (x: number, y: number) => point(1, 'start', 'PlayerStart', x, y);
const trigger = (id: number, name: string, event: string, eventId: string, col: number, row: number, cols: number, rows: number, when = '', once = false) =>
  rect(id, name, 'Trigger', col * T, row * T, cols * T, rows * T, [
    str('event', 'TriggerEvent', event), ...(eventId ? [str('eventId', undefined, eventId)] : []), ...(when ? [str('when', undefined, when)] : []),
    ...(once ? [{ name: 'once', type: 'bool', value: true }] : []),
  ]);
const door = (id: number, socket: 'N' | 'S' | 'E' | 'W', lock = 'none', lockParam = '') => {
  const bounds: Record<'N' | 'S' | 'E' | 'W', readonly [number, number, number, number]> = {
    W: [0, 6 * T, T, 2 * T], E: [(W - 1) * T, 6 * T, T, 2 * T], N: [9 * T, 0, 2 * T, 3 * T], S: [9 * T, 11 * T, 2 * T, T],
  };
  const [x, y, w, h] = bounds[socket];
  return rect(id, `door-${socket.toLowerCase()}`, 'Door', x, y, w, h, [
    str('socket', 'Socket', socket), ...(lock !== 'none' ? [str('lock', 'Lock', lock)] : []), ...(lockParam ? [str('lockParam', undefined, lockParam)] : []),
  ]);
};
const pickup = (id: number, itemType: string, itemId: string, x: number, y: number) =>
  point(id, '', 'Pickup', x, y, [str('itemType', 'ItemType', itemType), ...(itemId ? [str('itemId', undefined, itemId)] : [])]);
const spawn = (id: number, enemyType: string, x: number, y: number, when = '') =>
  point(id, enemyType, 'Spawn', x, y, [str('enemyType', 'EnemyType', enemyType), ...(when ? [str('when', undefined, when)] : [])]);
const npc = (id: number, npcId: string, dialogueId: string, x: number, y: number) =>
  point(id, npcId, 'NPC', x, y, [str('npcId', undefined, npcId), str('dialogueId', undefined, dialogueId)]);
const timeClock = (id: number, col: number, row: number) => trigger(id, 'time-clock', 'checkpoint', '', col, row, 2, 2);

type Shell = ReturnType<typeof shell>;

/** A side socket: open, or drawn closed so a locked doorway cannot be walked through. */
function side(s: Shell, edge: 'E' | 'W', open: boolean): void {
  const { walls, set } = s;
  const x = edge === 'W' ? 0 : W - 1;
  set(walls, x, 5, edge === 'W' ? 'walltop-outer-se' : 'walltop-outer-sw');
  set(walls, x, 8, edge === 'W' ? 'walltop-outer-ne' : 'walltop-outer-nw');
  if (open) for (const y of [6, 7]) walls[y * W + x] = 0;
  else { set(walls, x, 6, 'door-closed-l'); set(walls, x, 7, 'door-closed-r'); }
}

/** The north socket at columns 9 and 10, open or drawn closed. */
function north(s: Shell, open: boolean): void {
  const { walls, set } = s;
  if (open) {
    for (const x of [9, 10]) for (const y of [0, 1, 2]) walls[y * W + x] = 0;
    set(walls, 8, 0, 'walltop-outer-se'); set(walls, 11, 0, 'walltop-outer-sw');
  } else {
    set(walls, 9, 0, 'door-n-l-top'); set(walls, 10, 0, 'door-n-r-top');
    for (const y of [1, 2]) { set(walls, 9, y, 'door-n-l'); set(walls, 10, y, 'door-n-r'); }
  }
}

/** The south socket at columns 9 and 10, always open. */
function south(s: Shell): void {
  const { walls, set } = s;
  walls[11 * W + 9] = 0; walls[11 * W + 10] = 0;
  set(walls, 8, 11, 'walltop-outer-ne'); set(walls, 11, 11, 'walltop-outer-nw');
}

const room = (
  s: Shell, organ: string, role: string, est: number, objects: { id: number }[],
  extra: { tutorialFor?: string; layers?: object[]; tilesets?: object[]; storyOnly?: boolean } = {},
) => ({
  type: 'map', version: '1.10', tiledversion: '1.11.0', orientation: 'orthogonal', renderorder: 'right-down',
  infinite: false, width: W, height: 12, tilewidth: T, tileheight: T, nextlayerid: 20,
  nextobjectid: Math.max(...objects.map((o) => o.id), 100) + 1, class: 'Room',
  properties: [
    { name: 'organ', type: 'string', value: organ },
    { name: 'role', type: 'string', value: role },
    { name: 'estSeconds', type: 'int', value: est },
    ...(extra.storyOnly ? [{ name: 'storyOnly', type: 'bool', value: true }] : []),
    ...(extra.tutorialFor ? [{ name: 'tutorialFor', type: 'string', value: extra.tutorialFor }] : []),
  ],
  layers: [
    tileLayer(1, 'floor', s.floor),
    tileLayer(2, 'walls', s.walls),
    ...(extra.layers ?? []),
    { id: 3, name: 'objects', type: 'objectgroup', x: 0, y: 0, opacity: 1, visible: true, draworder: 'topdown', objects },
  ],
  tilesets: [s.tileset, ...(extra.tilesets ?? [])],
});

// 1F reception. West door: the 17:00 machine; north door: the 08:00 machine; east: the way up.
{
  const s = shell('lobby', 41);
  side(s, 'E', true);
  side(s, 'W', false);
  north(s, false);
  writeRoom('brain/lobby.tmj', room(s, 'lobby', 'transit', 30, [
    start(320, 288),
    door(2, 'E'),
    door(3, 'N', 'clock', '08:00-10:00'),
    door(4, 'W', 'clock', '17:00-19:00'),
    timeClock(5, 15, 8),
  ]));
}

// The 08:00 machine, and behind it the caffeine page (design doc 7.4: reachable only between 08:00 and 10:00).
{
  const s = shell('lobby', 43);
  south(s);
  writeRoom('brain/coffee-am.tmj', room(s, 'lobby', 'treasure', 20, [
    start(320, 288),
    door(2, 'S'),
    pickup(3, 'coffee', '', 224, 192),
    pickup(4, 'handbook', 'caffeine', 416, 192),
    trigger(5, 'machine-note', 'dialogue', 'brain.coffee.am', 8, 5, 4, 4),
  ]));
}

// The 17:00 machine: the corridor can be passed on this cup too, at the price of the sleep door.
{
  const s = shell('lobby', 45);
  side(s, 'E', true);
  writeRoom('brain/coffee-pm.tmj', room(s, 'lobby', 'treasure', 15, [
    start(560, 224),
    door(2, 'E'),
    pickup(3, 'coffee', '', 288, 192),
    trigger(4, 'machine-note', 'dialogue', 'brain.coffee.pm', 6, 4, 4, 6),
  ]));
}

// General affairs: the folder. No enemies, so it cannot be taken without being read.
{
  const s = shell('lobby', 47);
  side(s, 'W', true);
  side(s, 'E', true);
  writeRoom('brain/general-affairs.tmj', room(s, 'lobby', 'transit', 20, [
    start(64, 224),
    door(2, 'W'),
    door(3, 'E'),
    npc(4, 'clerk', 'brain.clerk', 320, 200),
  ]));
}

// The folder's tutorial (design doc 7.4): a flyer throws sheets and the energy-drink salesman throws cans, both to parry.
// A salesman whose case is closed does not come back (chapter file closedCases).
{
  const s = shell('brain', 49);
  side(s, 'W', true);
  side(s, 'E', true);
  writeRoom('brain/tutorial.tmj', room(s, 'brain', 'combat', 45, [
    start(64, 224),
    door(2, 'W'),
    door(3, 'E'),
    spawn(4, 'flyer', 480, 160),
    spawn(5, 'energy_seller', 480, 288, '!seller_closed'),
    trigger(6, 'sign', 'dialogue', 'brain.tutorial.sign', 2, 3, 1, 8),
    pickup(7, 'handbook', 'energy_drinks', 576, 224),
  ]));
}

// 2F open-plan office: clock vents, their adenosine and the nap sofa. The vent props are the corridor's.
{
  const s = shell('brain', 51);
  side(s, 'W', true);
  side(s, 'E', true);
  const PROPS_GID = s.tilecount + 1;
  const VENT = 64;
  const vent = (id: number, col: number) =>
    ({ id, name: 'clock-vent', type: '', gid: PROPS_GID, x: col * T, y: 3 * T, width: VENT, height: VENT, rotation: 0, visible: true });
  const adenosine = (id: number, col: number) => spawn(id, 'adenosine', (col + 1) * T, 4 * T + 16);
  const group = (id: number, name: string, objects: object[]) =>
    ({ id, name, type: 'objectgroup', x: 0, y: 0, opacity: 1, visible: true, draworder: 'topdown', objects });
  writeRoom('brain/open-office.tmj', room(s, 'brain', 'combat', 90, [
    start(64, 224),
    door(2, 'W'),
    door(3, 'E'),
    adenosine(4, 4),
    adenosine(5, 9),
    rect(6, 'nap', 'Bed', 3 * T, 9 * T, 2 * T, T, [str('bedType', 'BedType', 'nap'), str('unlocks', undefined, 'short_nap')]),
    // A strip across the floor before the east door, so the group chat comes on the way to the archive.
    trigger(7, 'group-chat', 'card', 'group_chat', 16, 3, 1, 8),
  ], {
    tutorialFor: 'adenosine',
    layers: [
      group(4, 'props', [vent(10, 4), vent(11, 9)]),
      {
        id: 5, name: 'variant:sleep_debt_2', type: 'group', class: 'Variant', x: 0, y: 0, opacity: 1, visible: true,
        properties: [{ name: 'when', type: 'string', value: 'sleep_debt>=2' }],
        layers: [
          group(6, 'props', [vent(12, 13), vent(13, 15)]),
          group(7, 'objects', [adenosine(14, 13), adenosine(15, 15)]),
        ],
      },
    ],
    tilesets: [{
      firstgid: PROPS_GID, name: 'props-brain', tilewidth: VENT, tileheight: VENT, tilecount: 1, columns: 0, margin: 0, spacing: 0,
      grid: { orientation: 'orthogonal', width: 1, height: 1 },
      tiles: [{ id: 0, image: '../../props/prop-clock-vent.png', imagewidth: VENT, imageheight: VENT }],
    }],
  }));
}

// 3F hippocampus: six memory files (filed only by sleep) and three phone spirits that cost half an
// hour a time until switched off.
{
  const s = shell('brain', 53);
  side(s, 'W', true);
  side(s, 'E', true);
  writeRoom('brain/hippocampus.tmj', room(s, 'brain', 'puzzle', 60, [
    start(64, 224),
    door(2, 'W'),
    door(3, 'E'),
    trigger(4, 'phone-1', 'dialogue', 'brain.phone', 3, 4, 2, 2),
    trigger(5, 'phone-2', 'dialogue', 'brain.phone', 9, 8, 2, 2),
    trigger(6, 'phone-3', 'dialogue', 'brain.phone', 14, 4, 2, 2),
    // The last punch before the boss, so a forced leave in the arena returns here.
    timeClock(7, 16, 8),
    // A strip across the floor at the west door, so the room explains its files before the first one is in reach.
    trigger(8, 'files-note', 'dialogue', 'brain.memory.intro', 2, 3, 1, 8, '', true),
    // The choice before the boss, on the way to the arena door; once, so a forced leave does not ask again.
    trigger(16, 'climax', 'card', 'climax', 18, 3, 1, 8, '', true),
    // The staging desk by the west wall, clear of the phone spirits and the files so its talk is not stolen.
    npc(15, 'desk', 'brain.desk', 80, 320),
    pickup(9, 'memory', '', 208, 144),
    pickup(10, 'memory', '', 144, 304),
    pickup(11, 'memory', '', 272, 208),
    pickup(12, 'memory', '', 400, 176),
    pickup(13, 'memory', '', 432, 304),
    pickup(14, 'memory', '', 560, 112),
  ]));
}

// 4F conference room: the caffeine boss. His case closing opens the renewal talk, which sets caffeine_settled.
{
  const s = shell('brain', 55);
  side(s, 'W', true);
  side(s, 'E', false);
  writeRoom('brain/arena.tmj', room(s, 'brain', 'core', 180, [
    start(64, 224),
    door(2, 'W'),
    door(3, 'E', 'resource', 'caffeine_settled'),
    spawn(4, 'caffeine', 320, 168, '!caffeine_settled'),
    trigger(5, 'greeting', 'dialogue', 'brain.caffeine.intro', 2, 3, 1, 8, '!caffeine_settled'),
  ], { storyOnly: true }));
}

// The roof: the sleep door needs the caffeine residue below 50, and ends the chapter by filing the memory files.
{
  const s = shell('brain-night', 57);
  side(s, 'W', true);
  writeRoom('brain/rooftop.tmj', room(s, 'brain', 'rest', 30, [
    start(64, 224),
    door(2, 'W'),
    rect(3, 'bedtime', 'Bed', 14 * T, 8 * T, 2 * T, 2 * T, [str('bedType', 'BedType', 'sleep'), str('requires', undefined, 'caffeine<50')]),
    npc(4, 'brain', 'brain.rooftop.door', 320, 200),
    pickup(5, 'handbook', 'sleep_debt', 480, 160),
  ]));
}
