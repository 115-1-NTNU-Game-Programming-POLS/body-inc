/**
 * Writes the stomach chapter's greybox rooms (design doc 7.5) into public/assets/maps/stomach/.
 * For now these are three lab rooms. mixer-lab is for the mixer of core/stomach/mixer.ts: five food
 * boxes of the three portions, a belt into the hopper, two tiles of slow belt from the outlet to
 * the small intestine's timed gate (a port that takes parcels only, shut for 20 seconds and then
 * open for 8), and a belt loop along the walls so no box can be pushed into a dead corner. With the
 * gate shut, a third parcel has to wait inside the mixer, so feeding more then jams it. A sugar salesman
 * there hands out tea for the fatigue fog of design doc 7.5, and a large-portion salesman, whose
 * shield stops staples from the front, waits in the south-east corner. night-lab is for the sleep bar of core/rooms/sleep.ts: a bed that
 * takes 30 seconds to sleep in beside a mixer, so a box fed in just before bed sounds its alarm,
 * and a cold store, where a food box pushed in is chilled until tomorrow instead (the late-night
 * puzzle). A late-night courier stands by the head of the in-belt and throws an order (a food box)
 * onto it every few seconds: let go, it rides into the mixer, which works overtime; stamped, it is
 * returned and counted (design doc 7.5). It has no belt loop: a box pushed into a corner stays
 * there, but the bed needs no box. A spare food box sits in the north-east corner behind two food chunks
 * (design doc 6.2): the logistics chief's acid, on L, dissolves them after 1.5 seconds and the way is open for good.
 * sorting-lab is for the fork of core/rooms/boxes.ts and the lever cooldown of core/rooms/cooling.ts (the sorting
 * center): a line of four portions, a fork on it that a lever turns, a fast way to the hopper and a 22-tile slow way
 * round to it. boss-arena is for the snack boss (core/combat/bosses/snack.ts): a mixer of capacity 4 in the middle and four
 * docks in the corners that the boss throws his boxes from. Open them with ?room=stomach/mixer-lab, ?room=stomach/sorting-lab,
 * ?room=stomach/night-lab and ?room=stomach/boss-arena. The chapter's real rooms
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
/** The logistics chief (design doc 7.5), one in each lab, with that lab's conversation; see stomach.csv. */
const chief = (id: number, lab: string, col: number, row: number) => ({
  id, name: 'chief', type: 'NPC', x: col * T + 16, y: row * T + 16, width: 0, height: 0, rotation: 0, visible: true, point: true,
  properties: [str('npcId', undefined, 'stomach'), str('dialogueId', undefined, `stomach.chief.${lab}`)],
});
const food = (id: number, col: number, row: number, portion: string) => ({
  id, name: `food-${portion}`, type: 'Box', x: col * T + 16, y: row * T + 16, width: 0, height: 0, rotation: 0, visible: true, point: true,
  properties: [str('boxType', 'BoxType', 'food'), str('portion', 'Portion', portion)],
});

writeRoom('stomach/mixer-lab.tmj', {
  type: 'map', version: '1.10', tiledversion: '1.11.0', orientation: 'orthogonal', renderorder: 'right-down',
  infinite: false, width: W, height: 12, tilewidth: T, tileheight: T, nextlayerid: 4, nextobjectid: 19, class: 'Room',
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
        rect(9, 'belt-out', 'Conveyor', 12, 6, 2, 1, [str('direction', 'Direction', 'E'), str('speed', 'ConveyorSpeed', 'slow')]),
        // Three parcels through the gate open the way on to the night lab. The gate keeps its own hours
        // (design doc 7.5, the mixer-rhythm puzzle): a parcel that misses the 8 open seconds waits for the next.
        rect(10, 'gate', 'Port', 14, 6, 2, 1, [
          int('need', 3), str('accepts', 'PortAccepts', 'parcel'), obj('target', 15), int('openSeconds', 8), int('closedSeconds', 20),
        ]),
        // A loop along the walls, as in the prologue warehouse: a box pushed against a wall rides round
        // instead of sticking, and on the west side it passes the in-belt, where one push sends it in.
        rect(11, 'loop-north', 'Conveyor', 2, 3, 17, 1, [str('direction', 'Direction', 'W')]),
        rect(12, 'loop-west', 'Conveyor', 1, 3, 1, 7, [str('direction', 'Direction', 'S')]),
        rect(13, 'loop-south', 'Conveyor', 1, 10, 17, 1, [str('direction', 'Direction', 'E')]),
        rect(14, 'loop-east', 'Conveyor', 18, 4, 1, 7, [str('direction', 'Direction', 'N')]),
        rect(15, 'door-e', 'Door', 19, 6, 1, 2, [str('socket', 'Socket', 'E'), str('lock', 'Lock', 'switch')]),
        // Greybox: the sugar salesman of design doc 7.5 stands inside the loop to try the fatigue fog on; its tea costs no heart.
        // Once his case is closed (chapter file closedCases) he stays out, and his page 〈糖分與疲倦〉 comes with the closing (caseDrops).
        { id: 16, name: 'sugar-seller', type: 'Spawn', x: 15 * T + 16, y: 8 * T + 16, width: 0, height: 0, rotation: 0, visible: true, point: true,
          properties: [str('enemyType', 'EnemyType', 'sugar_seller'), str('when', undefined, '!sugar_seller_closed')] },
        // Greybox: the large-portion salesman of design doc 7.5 (the manager archetype, shield and all) in the south-east corner.
        { id: 17, name: 'large-seller', type: 'Spawn', x: 17 * T + 16, y: 9 * T + 16, width: 0, height: 0, rotation: 0, visible: true, point: true,
          properties: [str('enemyType', 'EnemyType', 'large_seller')] },
        // Off every box's lane and the sellers' corner.
        chief(18, 'mixer', 11, 9),
      ],
    },
  ],
  tilesets: [tileset],
});

const lever = (id: number, name: string, col: number, row: number, target: number, extra: object[] = []) => rect(id, name, 'Switch', col, row, 1, 1, [
  obj('target', target), str('mode', 'SwitchMode', 'toggle'), ...extra,
]);
const belt = (id: number, name: string, col: number, row: number, cols: number, rows: number, direction: string, speed?: string) =>
  rect(id, name, 'Conveyor', col, row, cols, rows, [str('direction', 'Direction', direction), ...(speed ? [str('speed', 'ConveyorSpeed', speed)] : [])]);

// The sorting center (design doc 7.5, 8.5, 8.8): a line of four portions runs to a fork, and the fork's lever sends
// the next box either straight to the hopper on a fast belt or round a 22-tile slow belt that comes back to it.
// The mixer holds three, so the fourth box jams it unless it takes the slow way; a large portion on the slow way
// reaches the timed gate a window late. The line waits for its own lever so the operator is ready. That lever cools
// down for 30 seconds, longer than the four boxes take to pass the fork, so it cannot pause the line to space the boxes
// out in place of the fork. Levers are remembered between visits and a cooldown is not: after a forced leave the line
// is already running on entry.
writeRoom('stomach/sorting-lab.tmj', {
  type: 'map', version: '1.10', tiledversion: '1.11.0', orientation: 'orthogonal', renderorder: 'right-down',
  infinite: false, width: W, height: 12, tilewidth: T, tileheight: T, nextlayerid: 4, nextobjectid: 22, class: 'Room',
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
        { id: 1, name: 'start', type: 'PlayerStart', x: 2 * T + 16, y: 8 * T + 16, width: 0, height: 0, rotation: 0, visible: true, point: true },
        // Nearest the fork first: a large, a small, a normal and a small portion, two tiles apart on the line.
        food(2, 8, 6, 'large'),
        food(3, 6, 6, 'small'),
        food(4, 4, 6, 'normal'),
        food(5, 2, 6, 'small'),
        belt(6, 'belt-in', 1, 6, 8, 1, 'E', 'slow'),
        lever(7, 'lever-start', 5, 4, 6, [int('cooldownSeconds', 30)]),
        // A fork turns to the south branch while its lever is on. The lever takes no new throw for 5 seconds.
        rect(8, 'fork', 'Conveyor', 9, 6, 1, 1, [str('direction', 'Direction', 'E'), str('altDirection', 'AltDirection', 'S'), str('speed', 'ConveyorSpeed', 'fast')]),
        lever(9, 'lever-fork', 9, 4, 8, [int('cooldownSeconds', 5)]),
        belt(10, 'belt-fast', 10, 6, 1, 1, 'E', 'fast'),
        rect(11, 'mixer', 'Mixer', 11, 6, 2, 1, [int('capacity', 3), str('outlet', 'Socket', 'E')]),
        belt(12, 'belt-out', 13, 6, 2, 1, 'E', 'slow'),
        rect(13, 'gate', 'Port', 15, 6, 2, 1, [
          int('need', 4), str('accepts', 'PortAccepts', 'parcel'), obj('target', 14), int('openSeconds', 8), int('closedSeconds', 20),
        ]),
        rect(14, 'door-e', 'Door', 19, 6, 1, 2, [str('socket', 'Socket', 'E'), str('lock', 'Lock', 'switch')]),
        rect(15, 'door-w', 'Door', 0, 6, 1, 2, [str('socket', 'Socket', 'W')]),
        // The slow way round: south, east along the bottom, north, west back under the gate's line, and up into the hopper.
        belt(16, 'slow-a', 9, 7, 1, 3, 'S', 'slow'),
        belt(17, 'slow-b', 9, 10, 9, 1, 'E', 'slow'),
        belt(18, 'slow-c', 18, 9, 1, 2, 'N', 'slow'),
        belt(19, 'slow-d', 13, 8, 6, 1, 'W', 'slow'),
        belt(20, 'slow-e', 12, 7, 1, 2, 'N', 'slow'),
        // Up in the open floor by the levers, clear of the belts below.
        chief(21, 'sorting', 14, 4),
      ],
    },
  ],
  tilesets: [tileset],
});

writeRoom('stomach/night-lab.tmj', {
  type: 'map', version: '1.10', tiledversion: '1.11.0', orientation: 'orthogonal', renderorder: 'right-down',
  infinite: false, width: W, height: 12, tilewidth: T, tileheight: T, nextlayerid: 4, nextobjectid: 17, class: 'Room',
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
        rect(10, 'cold', 'ColdStore', 6, 9, 3, 2, []),
        // The late-night courier of design doc 7.5 stands beside the head of the in-belt. Once his case is closed (chapter file closedCases) he stays out.
        { id: 11, name: 'courier', type: 'Spawn', x: 3 * T + 16, y: 5 * T + 16, width: 0, height: 0, rotation: 0, visible: true, point: true,
          properties: [str('enemyType', 'EnemyType', 'courier'), str('when', undefined, '!courier_closed')] },
        // A spare portion in the north-east corner, walled in by two chunks round a 2 x 2 pocket. The corner tile (16, 5) stays open: a body cannot slip through the diagonal gap, and the gate's count label sits above it.
        food(12, 17, 3, 'normal'),
        rect(13, 'chunk-south', 'Chunk', 17, 5, 2, 1, []),
        rect(14, 'chunk-west', 'Chunk', 16, 3, 1, 2, []),
        // The way on to the boss arena, open from the start: the lab has no rule that gates it yet.
        rect(15, 'door-e', 'Door', 19, 6, 1, 2, [str('socket', 'Socket', 'E')]),
        // West of the bed; row 10 still leads a box past him to the cold store.
        chief(16, 'night', 12, 9),
      ],
    },
  ],
  tilesets: [tileset],
});

// The snack boss's arena (design doc 7.5, 午夜外送): the mixer stands in the middle with the boss's capacity of 4, and
// the boss, at the north, calls the four docks in the corners one after another. Each box flies from its dock straight at the
// hopper. The operator stands in its way with the folder's guard up: a parry sends the box back at him, and a box nobody
// stops is digested for 20 seconds, so five in a row fill the mixer and the fifth makes it protest with an area round the hopper.
writeRoom('stomach/boss-arena.tmj', {
  type: 'map', version: '1.10', tiledversion: '1.11.0', orientation: 'orthogonal', renderorder: 'right-down',
  infinite: false, width: W, height: 12, tilewidth: T, tileheight: T, nextlayerid: 4, nextobjectid: 9, class: 'Room',
  properties: [
    { name: 'organ', type: 'string', value: 'stomach' },
    { name: 'role', type: 'string', value: 'combat' },
    { name: 'estSeconds', type: 'int', value: 120 },
    { name: 'storyOnly', type: 'bool', value: true },
  ],
  layers: [
    tileLayer(1, 'floor', floor),
    tileLayer(2, 'walls', walls),
    {
      id: 3, name: 'objects', type: 'objectgroup', x: 0, y: 0, opacity: 1, visible: true, draworder: 'topdown',
      objects: [
        { id: 1, name: 'start', type: 'PlayerStart', x: 3 * T + 16, y: 7 * T + 16, width: 0, height: 0, rotation: 0, visible: true, point: true },
        rect(2, 'door-w', 'Door', 0, 6, 1, 2, [str('socket', 'Socket', 'W')]),
        rect(3, 'mixer', 'Mixer', 9, 7, 2, 1, [int('capacity', 4), str('outlet', 'Socket', 'S')]),
        // Clockwise from the north-west: the order the boss calls them in.
        rect(4, 'dock-nw', 'Dock', 2, 4, 1, 1, []),
        rect(5, 'dock-ne', 'Dock', 17, 4, 1, 1, []),
        rect(6, 'dock-se', 'Dock', 17, 9, 1, 1, []),
        rect(7, 'dock-sw', 'Dock', 2, 9, 1, 1, []),
        { id: 8, name: 'snack-boss', type: 'Spawn', x: 10 * T, y: 4 * T + 16, width: 0, height: 0, rotation: 0, visible: true, point: true,
          properties: [str('enemyType', 'EnemyType', 'snack')] },
      ],
    },
  ],
  tilesets: [tileset],
});
