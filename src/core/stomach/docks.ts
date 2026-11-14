import { TILE } from '../time.ts';
import { hopperTiles } from '../rooms/boxes.ts';
import type { Vec } from '../combat/movement.ts';
import { objectBox } from '../rooms/interact.ts';
import type { RoomModel, RoomObject } from '../rooms/tiled.ts';

/**
 * The delivery docks of the stomach boss's room (design doc 7.5, the four 外送口): a `Dock` object is
 * where the boss's boxes leave from, at the centre of its box. They are called in id order, so the
 * order the author drew them in is the order the boss uses them. The rules for authors are in
 * docs/authoring/rooms-and-dialogue.md.
 */
export const dockCentre = (o: RoomObject): Vec => {
  const b = objectBox(o);
  return { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
};

const cache = new WeakMap<RoomModel['objects'], readonly Vec[]>();

export function docksOf(room: Pick<RoomModel, 'objects'>): readonly Vec[] {
  let docks = cache.get(room.objects);
  if (docks === undefined) {
    docks = room.objects.filter((o) => o.kind === 'Dock' && o.variant === undefined).sort((a, b) => a.id - b.id).map(dockCentre);
    cache.set(room.objects, docks);
  }
  return docks;
}

/** The centre of the mixer's hopper, where a delivery is headed; undefined for a room without a mixer. */
export function mouthOf(room: Pick<RoomModel, 'objects'>): Vec | undefined {
  const tiles = hopperTiles(room);
  if (tiles.length === 0) return undefined;
  const sum = tiles.reduce((a, t) => ({ x: a.x + (t.col + 0.5) * TILE, y: a.y + (t.row + 0.5) * TILE }), { x: 0, y: 0 });
  return { x: sum.x / tiles.length, y: sum.y / tiles.length };
}
