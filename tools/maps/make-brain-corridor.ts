/**
 * Writes the greybox brain corridor (public/assets/maps/greybox/brain-corridor.tmj), the
 * build-plan P2 room: one clock vent with its adenosine in the base room, and the variant
 * layer `variant:sleep_debt_2` (art direction 7.5) that opens two more vents, each with its own
 * adenosine, when sleep_debt>=2 at room entry. It sits in the greybox chapter, whose test room
 * already carries the adenosine tutorial and the bed; real brain rooms are build-plan P7. The
 * brain itself stands in the corridor with a briefing that offers three replies (build plan P5),
 * so the conversation system has a choice to play, and a Trigger before the east door shows the
 * chapter's event card (build plan P1).
 *
 *   node tools/maps/make-brain-corridor.ts
 */
import { shell, tileLayer, W, writeRoom } from './room-kit.ts';

const { floor, walls, set, tileset, tilecount } = shell('brain', 11);

// Open west and east sockets at rows 6-7; the corridor is walked through.
for (const x of [0, W - 1]) { walls[6 * W + x] = 0; walls[7 * W + x] = 0; }
set(walls, 0, 5, 'walltop-outer-se'); set(walls, 0, 8, 'walltop-outer-ne');
set(walls, W - 1, 5, 'walltop-outer-sw'); set(walls, W - 1, 8, 'walltop-outer-nw');

const PROPS_GID = tilecount + 1;
const VENT = 64;
/** A 2 x 2 clock vent hung on the north wall face (rows 1-2), columns `col` and `col + 1`. */
const vent = (id: number, col: number) => ({
  id, name: 'clock-vent', type: '', gid: PROPS_GID, x: col * 32, y: 3 * 32, width: VENT, height: VENT, rotation: 0, visible: true,
});
/** Adenosine comes out of the vent above it (design doc 7.4), so it starts on the floor just below. */
const adenosine = (id: number, col: number) => ({
  id, name: 'adenosine', type: 'Spawn', x: (col + 1) * 32, y: 4 * 32 + 16, width: 0, height: 0, rotation: 0, visible: true, point: true,
  properties: [{ name: 'enemyType', type: 'string', propertytype: 'EnemyType', value: 'adenosine' }],
});
const door = (id: number, socket: string, x: number) => ({
  id, name: `door-${socket.toLowerCase()}`, type: 'Door', x, y: 6 * 32, width: 32, height: 64, rotation: 0, visible: true,
  properties: [{ name: 'socket', type: 'string', propertytype: 'Socket', value: socket }],
});
const brain = (id: number) => ({
  id, name: 'brain', type: 'NPC', x: 448, y: 192, width: 0, height: 0, rotation: 0, visible: true, point: true,
  properties: [
    { name: 'npcId', type: 'string', value: 'brain' },
    { name: 'dialogueId', type: 'string', value: 'greybox.brain.briefing' },
  ],
});
/**
 * The chapter's event card (build plan P1), as a strip across the whole floor before the east
 * door, so the operator meets it on the way to the boss arena.
 */
const eventCard = (id: number) => ({
  id, name: 'group-chat', type: 'Trigger', x: 16 * 32, y: 3 * 32, width: 32, height: 8 * 32, rotation: 0, visible: true,
  properties: [
    { name: 'event', type: 'string', propertytype: 'TriggerEvent', value: 'card' },
    { name: 'eventId', type: 'string', value: 'group_chat' },
  ],
});
const group = (id: number, name: string, objects: object[]) => ({
  id, name, type: 'objectgroup', x: 0, y: 0, opacity: 1, visible: true, draworder: 'topdown', objects,
});

writeRoom('greybox/brain-corridor.tmj', {
  type: 'map', version: '1.10', tiledversion: '1.11.0', orientation: 'orthogonal', renderorder: 'right-down',
  infinite: false, width: W, height: 12, tilewidth: 32, tileheight: 32, nextlayerid: 8, nextobjectid: 12, class: 'Room',
  properties: [
    { name: 'organ', type: 'string', value: 'brain' },
    { name: 'role', type: 'string', value: 'combat' },
    { name: 'estSeconds', type: 'int', value: 25 },
  ],
  layers: [
    tileLayer(1, 'floor', floor),
    tileLayer(2, 'walls', walls),
    group(3, 'props', [vent(5, 2)]),
    group(4, 'objects', [
      { id: 1, name: 'start', type: 'PlayerStart', x: 64, y: 224, width: 0, height: 0, rotation: 0, visible: true, point: true },
      door(2, 'W', 0),
      door(3, 'E', (W - 1) * 32),
      adenosine(4, 2),
      brain(10),
      eventCard(11),
    ]),
    {
      id: 5, name: 'variant:sleep_debt_2', type: 'group', class: 'Variant', x: 0, y: 0, opacity: 1, visible: true,
      properties: [{ name: 'when', type: 'string', value: 'sleep_debt>=2' }],
      layers: [
        group(6, 'props', [vent(6, 7), vent(7, 12)]),
        group(7, 'objects', [adenosine(8, 7), adenosine(9, 12)]),
      ],
    },
  ],
  tilesets: [
    tileset,
    {
      firstgid: PROPS_GID, name: 'props-brain', tilewidth: VENT, tileheight: VENT, tilecount: 1, columns: 0, margin: 0, spacing: 0,
      grid: { orientation: 'orthogonal', width: 1, height: 1 },
      tiles: [{ id: 0, image: '../../props/prop-clock-vent.png', imagewidth: VENT, imageheight: VENT }],
    },
  ],
});
