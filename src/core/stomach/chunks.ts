import { overlaps, type Box } from '../collision/boxes.ts';
import type { SolidGrid } from '../collision/grid.ts';
import { conveyorTiles, tileBox, type Tile } from '../rooms/boxes.ts';
import type { RoomModel, RoomObject } from '../rooms/tiled.ts';
import { TICK_HZ } from '../time.ts';

/**
 * Food chunks (design doc 6.2, 7.5): a `Chunk` object is a rectangle of tiles that is solid like a
 * wall until the logistics chief's acid has lain on it for `dissolveTicks`, and then it is gone for
 * the rest of the chapter. The parser bakes every chunk into the room's grid, so every rule that
 * reads the grid sees one thing; a visit that starts with a chunk already dissolved, and the tick
 * that dissolves one, swap in a grid with its tiles cleared (`withoutChunks`). The rules for
 * authors are in docs/authoring/rooms-and-dialogue.md.
 */
export const CHUNK = {
  /** How long the acid has to lie on a chunk: a placeholder for playtesting, the design doc gives no time. */
  dissolveTicks: Math.round(1.5 * TICK_HZ),
} as const;

export interface Chunk {
  readonly object: RoomObject;
  /** The tiles whose centre it covers, in row then column order; none for a chunk drawn as a point. */
  readonly tiles: readonly Tile[];
}

const cache = new WeakMap<readonly RoomObject[], readonly Chunk[]>();

/** The room's chunks, in id order. */
export function chunksOf(room: Pick<RoomModel, 'objects'>): readonly Chunk[] {
  let list = cache.get(room.objects);
  if (!list) {
    list = room.objects.filter((o) => o.kind === 'Chunk').sort((a, b) => a.id - b.id)
      .map((o) => ({ object: o, tiles: o.width > 0 && o.height > 0 ? conveyorTiles(o) : [] }));
    cache.set(room.objects, list);
  }
  return list;
}

/** Marks every chunk's tiles solid in a parsed grid; the room parser calls this after the walls are known. */
export function solidChunks(objects: readonly RoomObject[], cols: number, rows: number, solid: boolean[]): void {
  for (const c of chunksOf({ objects })) {
    for (const t of c.tiles) if (t.col >= 0 && t.row >= 0 && t.col < cols && t.row < rows) solid[t.row * cols + t.col] = true;
  }
}

/** The room with these chunks gone from its grid; the same room when none of them is a chunk of it. Chunks never overlap each other or a wall, so clearing a tile cannot open anything else. */
export function withoutChunks<R extends { readonly grid: SolidGrid; readonly objects: readonly RoomObject[] }>(room: R, ids: readonly number[]): R {
  const gone = chunksOf(room).filter((c) => ids.includes(c.object.id) && c.tiles.length > 0);
  if (gone.length === 0) return room;
  const solid = [...room.grid.solid];
  for (const c of gone) for (const t of c.tiles) solid[t.row * room.grid.cols + t.col] = false;
  return { ...room, grid: { ...room.grid, solid } };
}

/** The chunks not yet in `dissolved` whose tiles `area` covers, in id order. */
export const chunksUnder = (room: Pick<RoomModel, 'objects'>, dissolved: readonly number[], area: Box): readonly Chunk[] =>
  chunksOf(room).filter((c) => !dissolved.includes(c.object.id) && c.tiles.some((t) => overlaps(tileBox(t), area)));
