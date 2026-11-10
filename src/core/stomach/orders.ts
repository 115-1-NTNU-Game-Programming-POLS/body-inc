import { TILE } from '../time.ts';
import {
  beltAt, canEnter, conveyorsOf, conveyorTiles, directionOf, onHopper, onPort, portOf, type BoxState, type Occupants, type Tile,
} from '../rooms/boxes.ts';
import type { RoomModel } from '../rooms/tiled.ts';

/**
 * The late-night courier's orders (design doc 7.5). An order is a food box that the courier throws
 * onto a belt; it is not a Tiled object, so it has an id of its own. Ids at or below `ORDER_ID_BASE`
 * are orders; they are negative like the liver's spawned crates, which makes every rule that skips
 * "a box the map did not place" (the chapter's box memory, the port's count, the cold store) skip
 * orders as well. A room with a factory would take them for acetaldehyde crates, so a courier does
 * not belong in one. An order belongs to the visit: a forced leave puts the map's boxes home and
 * leaves it out. The rules for authors are in docs/authoring/rooms-and-dialogue.md.
 */
export const ORDER_ID_BASE = -1_000_000;

export const isOrder = (b: { readonly id: number }): boolean => b.id <= ORDER_ID_BASE;

/** The id of the `serial`-th order of a visit, counted from 0. */
export const orderId = (serial: number): number => ORDER_ID_BASE - serial;

/** The tile of a conveyor that its boxes come from: the one furthest against its direction. */
function headOf(o: Parameters<typeof directionOf>[0]): Tile | undefined {
  const d = directionOf(o);
  return conveyorTiles(o).reduce<Tile | undefined>(
    (best, t) => (best === undefined || t.col * d.col + t.row * d.row < best.col * d.col + best.row * d.row ? t : best), undefined,
  );
}

/**
 * Where a courier standing at (`x`, `y`) can throw now: the head of the running belt nearest to him
 * whose head tile is free of boxes, bodies and fixed objects, and is not a mouth that would take
 * the order in at once (the hopper or a port). Nearest by distance to the tile's centre, the lower
 * object id on a tie. Undefined when no belt qualifies, and the courier then waits.
 */
export function orderSpot(
  room: RoomModel, boxes: readonly BoxState[], occupants: Occupants, switchesOn: readonly number[], x: number, y: number,
): Tile | undefined {
  const port = portOf(room);
  let best: { readonly t: Tile; readonly d: number } | undefined;
  for (const belt of [...conveyorsOf(room)].sort((a, b) => a.id - b.id)) {
    const t = headOf(belt);
    if (!t || !beltAt(room, t, switchesOn) || onHopper(room, t) || (port && onPort(port, t)) || !canEnter(room, boxes, t, occupants)) continue;
    const d = Math.hypot((t.col + 0.5) * TILE - x, (t.row + 0.5) * TILE - y);
    if (best === undefined || d < best.d) best = { t, d };
  }
  return best?.t;
}

/** The order on `spot`, a resting food box; the caller adds it to the room's boxes. */
export const newOrder = (serial: number, spot: Tile): BoxState => ({ id: orderId(serial), col: spot.col, row: spot.row, left: 0, ticks: 0, boxType: 'food' });
