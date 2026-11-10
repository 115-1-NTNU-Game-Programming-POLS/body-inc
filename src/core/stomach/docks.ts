import { TILE } from '../time.ts';
import { hopperTiles } from '../rooms/boxes.ts';
import { objectBox } from '../rooms/interact.ts';
import type { RoomModel } from '../rooms/tiled.ts';

/**
 * The delivery docks of the stomach boss's room (design doc 7.5, the four 外送口): a `Dock` object is
 * where the boss's boxes leave from, at the centre of its box. They are called in id order, so the
 * order the author drew them in is the order the boss uses them. The rules for authors are in
 * docs/authoring/rooms-and-dialogue.md.
 */
export interface Spot { readonly x: number; readonly y: number }

const cache = new WeakMap<RoomModel['objects'], readonly Spot[]>();

export function docksOf(room: Pick<RoomModel, 'objects'>): readonly Spot[] {
  let docks = cache.get(room.objects);
  if (docks === undefined) {
    docks = room.objects.filter((o) => o.kind === 'Dock' && o.variant === undefined).sort((a, b) => a.id - b.id).map((o) => {
      const b = objectBox(o);
      return { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
    });
    cache.set(room.objects, docks);
  }
  return docks;
}

/** The centre of the mixer's hopper, where a delivery is headed; undefined for a room without a mixer. */
export function mouthOf(room: Pick<RoomModel, 'objects'>): Spot | undefined {
  const tiles = hopperTiles(room);
  if (tiles.length === 0) return undefined;
  const sum = tiles.reduce((a, t) => ({ x: a.x + (t.col + 0.5) * TILE, y: a.y + (t.row + 0.5) * TILE }), { x: 0, y: 0 });
  return { x: sum.x / tiles.length, y: sum.y / tiles.length };
}
