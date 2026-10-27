import { isSolid } from '../collision/grid.ts';
import { TICK_HZ, TILE } from '../time.ts';
import { conveyorTiles, tileOf, type BoxState, type Tile } from '../rooms/boxes.ts';
import type { RoomModel, RoomObject } from '../rooms/tiled.ts';

/**
 * The liver factory room (design doc 7.7): a `Line` object of each stage. `receiving` is the dock
 * where the alcohol crates wait, one per cup; its tiles are solid like a counter, so a crate can
 * never appear on top of the operator, and staples bounce off the crates on it. `outlet` is where
 * the first line puts out each acetaldehyde crate. `intake` is the second line: an acetaldehyde
 * crate that comes to rest on it is taken in. The rules for authors are in
 * docs/authoring/rooms-and-dialogue.md.
 */

/**
 * Acetaldehyde's red fog (design doc 7.7): a 2-tile circle round every crate, and half a heart for
 * every 2 seconds the operator stays in it. Leaving the fog starts the count again (ASSUME: the doc
 * does not say whether a short dip counts).
 */
export const MIST = {
  radiusPx: 2 * TILE,
  intervalTicks: 2 * TICK_HZ,
  halves: 1,
} as const;

/** The enemy entry whose category and solution an alcohol crate carries (content/enemies.json). */
export const ALCOHOL_CRATE = 'alcohol_barrel';

/** Spawned acetaldehyde crates have negative ids, so they never collide with a Tiled object id. */
export const isSpawnedCrate = (b: { readonly id: number }): boolean => b.id < 0;

export interface FactoryLines {
  readonly receiving: RoomObject | undefined;
  readonly outlet: RoomObject | undefined;
  readonly intake: RoomObject | undefined;
}

const lineCache = new WeakMap<readonly RoomObject[], FactoryLines & { readonly dock: readonly Tile[]; readonly intakeKeys: ReadonlySet<string> }>();
const key = (t: Tile) => `${t.col},${t.row}`;

function indexOf(room: Pick<RoomModel, 'objects'>) {
  let index = lineCache.get(room.objects);
  if (!index) {
    const lines = [...room.objects].filter((o) => o.kind === 'Line').sort((a, b) => a.id - b.id);
    const of = (stage: string) => lines.find((o) => o.props['stage'] === stage);
    const receiving = of('receiving');
    const intake = of('intake');
    index = {
      receiving, outlet: of('outlet'), intake,
      dock: receiving && receiving.width > 0 && receiving.height > 0 ? conveyorTiles(receiving) : [],
      intakeKeys: new Set(intake && intake.width > 0 && intake.height > 0 ? conveyorTiles(intake).map(key) : []),
    };
    lineCache.set(room.objects, index);
  }
  return index;
}

export const linesOf = (room: Pick<RoomModel, 'objects'>): FactoryLines => indexOf(room);

/** Whether the room is a factory: it has the dock the first line works from. */
export const isFactory = (room: Pick<RoomModel, 'objects'>): boolean => indexOf(room).receiving !== undefined;

/** The dock's tiles in row then column order: the first `waiting` of them hold a crate. */
export const dockTiles = (room: Pick<RoomModel, 'objects'>): readonly Tile[] => indexOf(room).dock;

/** The tiles that hold an alcohol crate when `waiting` cups are in receiving; a full dock shows no more. */
export const crateTiles = (room: Pick<RoomModel, 'objects'>, waiting: number): readonly Tile[] => indexOf(room).dock.slice(0, Math.max(0, waiting));

/** Whether a tile is one of the second line's, by the same centre rule as a conveyor. */
export const onIntake = (room: Pick<RoomModel, 'objects'>, t: Tile): boolean => indexOf(room).intakeKeys.has(key(t));

/** The tile the first line puts crates out on, or undefined in a room without an outlet. */
export function outletTile(room: Pick<RoomModel, 'objects'>): Tile | undefined {
  const o = indexOf(room).outlet;
  return o ? tileOf(o) : undefined;
}

/** The centre of a box's tile now, for its fog. */
export function boxCentre(b: BoxState): { x: number; y: number } {
  return { x: (b.col + 0.5) * TILE, y: (b.row + 0.5) * TILE };
}

/** Marks the dock solid in a parsed grid; the room parser calls this so every rule sees one grid. */
export function solidDock(objects: readonly RoomObject[], cols: number, rows: number, solid: boolean[]): void {
  for (const t of indexOf({ objects }).dock) {
    if (t.col >= 0 && t.row >= 0 && t.col < cols && t.row < rows) solid[t.row * cols + t.col] = true;
  }
}

/** Whether a solid tile is a dock tile carrying a crate, so a staple there bounces off alcohol. */
export function crateOnTile(room: RoomModel, waiting: number, col: number, row: number): boolean {
  if (!isSolid(room.grid, col, row)) return false;
  return crateTiles(room, waiting).some((t) => t.col === col && t.row === row);
}
