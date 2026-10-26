import { overlaps, type Box } from '../collision/boxes.ts';
import { isSolid, type SolidGrid } from '../collision/grid.ts';
import { TILE } from '../time.ts';
import { objectBox, platesUnder } from './interact.ts';
import { switchesFor } from './locks.ts';
import type { RoomModel, RoomObject } from './tiled.ts';

/**
 * Push boxes and conveyors (design doc 13.3 lists conveyors and leaves their rules open, and has
 * no class for boxes; the rules chosen here are written up in docs/authoring/rooms-and-dialogue.md).
 *
 * A box sits on one whole tile and moves a tile at a time, so a puzzle reads like a grid even
 * though the operator moves freely. While it slides it already owns the tile it is going to. A
 * pushed box frees the tile it left at once, so the operator pushing it never waits: a push slide
 * is faster than walking, so the two do not overlap on screen. A belt carries a box slower than
 * walking, so a carried box keeps the tile it left solid until it arrives, or the operator would
 * walk into it. Either way no other box enters the tile a box is leaving until it has left.
 */

export interface Tile {
  readonly col: number;
  readonly row: number;
}

export interface BoxState extends Tile {
  /** Tiled object id. */
  readonly id: number;
  /** Where the slide started; absent while resting. */
  readonly from?: Tile;
  /** Ticks of the slide still to run; 0 while resting. */
  readonly left: number;
  /** Ticks the whole slide takes, for drawing it. */
  readonly ticks: number;
  /** Set while a belt carries it: the tile it left stays solid until it arrives. */
  readonly carried?: true;
}

/** The operator presses against a box this many ticks before it moves; a brush past one does not shove it. */
export const PUSH = { delayTicks: 10, slideTicks: 12 } as const;

/** Ticks a conveyor takes to carry a box one tile: 1, 2 and 4 tiles per second. */
export const CONVEYOR_TICKS: Readonly<Record<string, number>> = { slow: 60, normal: 30, fast: 15 };

const STEP: Readonly<Record<string, Tile>> = { N: { col: 0, row: -1 }, S: { col: 0, row: 1 }, E: { col: 1, row: 0 }, W: { col: -1, row: 0 } };

/** Kinds a box may not cover: it would hide them or block the way through a door. */
export const KEEP_CLEAR: ReadonlySet<string> = new Set(['Door', 'NPC', 'Bed', 'Pickup', 'Trigger']);

export const tileBox = (t: Tile): Box => ({ left: t.col * TILE, top: t.row * TILE, right: (t.col + 1) * TILE, bottom: (t.row + 1) * TILE });

/** The tile holding the centre of an object's box: where a Box object starts. */
export function tileOf(o: RoomObject): Tile {
  const b = objectBox(o);
  return { col: Math.floor((b.left + b.right) / 2 / TILE), row: Math.floor((b.top + b.bottom) / 2 / TILE) };
}

/** Tiles whose centre lies inside a conveyor's rectangle, in row then column order. */
export function conveyorTiles(o: RoomObject): Tile[] {
  const b = objectBox(o);
  const out: Tile[] = [];
  for (let row = Math.floor(b.top / TILE); row * TILE < b.bottom; row++) {
    for (let col = Math.floor(b.left / TILE); col * TILE < b.right; col++) {
      const cx = (col + 0.5) * TILE;
      const cy = (row + 0.5) * TILE;
      if (cx >= b.left && cx < b.right && cy >= b.top && cy < b.bottom) out.push({ col, row });
    }
  }
  return out;
}

export const directionOf = (conveyor: RoomObject): Tile => STEP[String(conveyor.props['direction'])] ?? STEP['E']!;

/**
 * A conveyor runs unless switches are aimed at it, and then only while all of them are on: the
 * same rule as a switch lock, except that a conveyor with no switch simply runs.
 */
export function conveyorRunning(objects: readonly RoomObject[], conveyor: RoomObject, switchesOn: readonly number[]): boolean {
  return switchesFor(objects, conveyor.id).every((s) => switchesOn.includes(s.id));
}

/** The room's Port, if it has one; the map check allows one per room, since it counts every box delivered there. */
export const portOf = (room: RoomModel): RoomObject | undefined => indexOf(room).port;

const portTiles = new WeakMap<RoomObject, ReadonlySet<string>>();

/** Whether a box's tile is one of the port's, by the same centre rule as a conveyor. */
export function onPort(port: RoomObject, t: Tile): boolean {
  let tiles = portTiles.get(port);
  if (!tiles) {
    tiles = new Set(conveyorTiles(port).map(at));
    portTiles.set(port, tiles);
  }
  return tiles.has(at(t));
}

/** The port, once it holds as many boxes as it needs: from then on it counts as a switch that is on. */
export function filledPorts(room: RoomModel, delivered: readonly number[]): number[] {
  const port = portOf(room);
  return port && delivered.length >= Number(port.props['need']) ? [port.id] : [];
}

interface RoomBoxIndex {
  readonly keepClear: readonly Box[];
  readonly conveyors: readonly RoomObject[];
  /** The running conveyor's object for each tile, by `col,row`; the lowest id wins where two overlap. */
  readonly belt: ReadonlyMap<string, RoomObject>;
  readonly port: RoomObject | undefined;
}

const roomIndexes = new WeakMap<readonly RoomObject[], RoomBoxIndex>();
const at = (t: Tile) => `${t.col},${t.row}`;

function indexOf(room: RoomModel): RoomBoxIndex {
  let index = roomIndexes.get(room.objects);
  if (!index) {
    const byId = [...room.objects].sort((a, b) => a.id - b.id);
    const conveyors = byId.filter((o) => o.kind === 'Conveyor');
    const belt = new Map<string, RoomObject>();
    for (const c of conveyors) for (const t of conveyorTiles(c)) if (!belt.has(at(t))) belt.set(at(t), c);
    index = { keepClear: byId.filter((o) => KEEP_CLEAR.has(o.kind)).map(objectBox), conveyors, belt, port: room.objects.find((o) => o.kind === 'Port') };
    roomIndexes.set(room.objects, index);
  }
  return index;
}

export const conveyorsOf = (room: RoomModel): readonly RoomObject[] => indexOf(room).conveyors;

/** The conveyor under a tile and whether it runs now; undefined off the belts. */
export function beltAt(room: RoomModel, t: Tile, switchesOn: readonly number[]): RoomObject | undefined {
  const c = indexOf(room).belt.get(at(t));
  return c && conveyorRunning(room.objects, c, switchesOn) ? c : undefined;
}

/** The tile under a point, such as the operator's feet. */
export const tileAt = (x: number, y: number): Tile => ({ col: Math.floor(x / TILE), row: Math.floor(y / TILE) });

const gridCache = new WeakMap<readonly BoxState[], SolidGrid>();

/** The room's walls with every box's tile made solid, for everything that moves or flies. */
export function withBoxes(grid: SolidGrid, boxes: readonly BoxState[]): SolidGrid {
  if (boxes.length === 0) return grid;
  let g = gridCache.get(boxes);
  if (!g || g.cols !== grid.cols) {
    const solid = [...grid.solid];
    const mark = (t: Tile) => { if (t.col >= 0 && t.row >= 0 && t.col < grid.cols && t.row < grid.rows) solid[t.row * grid.cols + t.col] = true; };
    for (const b of boxes) {
      mark(b);
      if (b.carried && b.from) mark(b.from);
    }
    g = { ...grid, solid };
    gridCache.set(boxes, g);
  }
  return g;
}

/** Anything a box must not slide into, other than walls, boxes and the room's fixed objects. */
export interface Occupants {
  readonly bodies: readonly Box[];
}

const holds = (b: BoxState, t: Tile): boolean =>
  (b.col === t.col && b.row === t.row) || (b.left > 0 && b.from !== undefined && b.from.col === t.col && b.from.row === t.row);

/**
 * Whether a box may move onto the tile: floor, no box arriving or leaving, no fixed object it must
 * keep clear, no one standing there. Counting a tile being left as taken keeps two boxes from
 * overlapping on screen, and makes a line of boxes on a belt move the same whatever their ids.
 */
export function canEnter(room: RoomModel, boxes: readonly BoxState[], t: Tile, occupants: Occupants): boolean {
  if (isSolid(room.grid, t.col, t.row)) return false;
  if (boxes.some((b) => holds(b, t))) return false;
  const tb = tileBox(t);
  return !indexOf(room).keepClear.some((k) => overlaps(tb, k)) && !occupants.bodies.some((b) => overlaps(tb, b));
}

/** Whether a box resting on the tile holds a pressure plate down. */
export const onPlate = (room: RoomModel, t: Tile): boolean => platesUnder(room, tileBox(t)).length > 0;

/**
 * Where the boxes are as the room is entered or restarted. A box resting on a plate stays: the
 * puzzle it solved stays solved (design doc 5.6). Every other box goes back to where the map put
 * it, so a box pushed into a corner can never leave a room unsolvable. A box that cannot go home
 * stays where it was, or failing that takes the nearest free floor tile: no box is ever put on
 * another, or on any body in `clear` (the operator and every enemy's home, where enemies reappear).
 */
export function settleBoxes(room: RoomModel, remembered: ReadonlyMap<number, Tile>, clear: readonly Box[], delivered: readonly number[] = []): BoxState[] {
  const objects = room.objects.filter((o) => o.kind === 'Box' && !delivered.includes(o.id)).sort((a, b) => a.id - b.id);
  const placed = new Map<number, Tile>();
  const taken = (t: Tile) => [...placed.values()].some((p) => p.col === t.col && p.row === t.row);
  const free = (t: Tile) => !taken(t) && !clear.some((c) => overlaps(tileBox(t), c));
  for (const o of objects) {
    const t = remembered.get(o.id);
    if (t && onPlate(room, t) && free(t)) placed.set(o.id, t);
  }
  for (const o of objects) {
    if (placed.has(o.id)) continue;
    const home = tileOf(o);
    const t = remembered.get(o.id);
    const spot = [home, t].find((x): x is Tile => x !== undefined && free(x))
      ?? nearest(room, home, (x) => free(x) && !indexOf(room).keepClear.some((k) => overlaps(tileBox(x), k)));
    placed.set(o.id, spot ?? home);
  }
  return objects.map((o) => ({ id: o.id, ...placed.get(o.id)!, left: 0, ticks: 0 }));
}

/** The closest floor tile to `from` that passes `ok`, walking through floor only, in N, S, W, E order. */
function nearest(room: RoomModel, from: Tile, ok: (t: Tile) => boolean): Tile | undefined {
  const seen = new Set([at(from)]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const t = queue[i]!;
    if (ok(t)) return t;
    for (const d of [STEP['N']!, STEP['S']!, STEP['W']!, STEP['E']!]) {
      const n = { col: t.col + d.col, row: t.row + d.row };
      if (seen.has(at(n)) || isSolid(room.grid, n.col, n.row)) continue;
      seen.add(at(n));
      queue.push(n);
    }
  }
  return undefined;
}

/** A box starting a slide of `ticks` to the next tile in `dir`. */
export const startSlide = (b: BoxState, dir: Tile, ticks: number, carried = false): BoxState =>
  ({ id: b.id, col: b.col + dir.col, row: b.row + dir.row, from: { col: b.col, row: b.row }, left: ticks, ticks, ...(carried ? { carried: true as const } : {}) });

/** One tick of a slide; the box rests once it runs out. */
export function advanceSlide(b: BoxState): BoxState {
  if (b.left <= 1) return { id: b.id, col: b.col, row: b.row, left: 0, ticks: 0 };
  return { ...b, left: b.left - 1 };
}

/** Where to draw a box: the top-left of its tile, part way along a slide. */
export function boxPixel(b: BoxState): { x: number; y: number } {
  if (!b.from || b.ticks === 0) return { x: b.col * TILE, y: b.row * TILE };
  const t = 1 - b.left / b.ticks;
  return { x: (b.from.col + (b.col - b.from.col) * t) * TILE, y: (b.from.row + (b.row - b.from.row) * t) * TILE };
}

/** The axis direction of a stick input that points along exactly one axis; undefined otherwise. */
export function pushDirection(move: { readonly x: number; readonly y: number }): Tile | undefined {
  if ((move.x !== 0) === (move.y !== 0)) return undefined;
  return { col: Math.sign(move.x), row: Math.sign(move.y) };
}

/**
 * The resting box the body is pressed flush against in `dir`, when exactly one is: a body
 * straddling two boxes pushes neither, as in any block puzzle.
 */
export function boxAhead(boxes: readonly BoxState[], body: Box, dir: Tile): BoxState | undefined {
  const probe: Box = { left: body.left + dir.col, top: body.top + dir.row, right: body.right + dir.col, bottom: body.bottom + dir.row };
  const hit = boxes.filter((b) => b.left === 0 && overlaps(probe, tileBox(b)) && !overlaps(body, tileBox(b)));
  return hit.length === 1 ? hit[0] : undefined;
}
