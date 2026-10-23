import type { SolidGrid } from '../collision/grid.ts';
import { TILE } from '../time.ts';

/**
 * Minimal Tiled JSON (.tmj) shape that core reads. Core only needs structure, not art: which
 * cells are solid and where things are placed. Rendering reads the same file in the view.
 *
 * Authoring convention: every non-empty cell of the tile layer named "walls" is solid; objects
 * live in the object layer named "objects" and are identified by their Tiled class (type).
 */
export interface TiledMap {
  readonly width: number;
  readonly height: number;
  readonly tilewidth: number;
  readonly tileheight: number;
  readonly layers: readonly TiledLayer[];
  readonly properties?: readonly TiledProperty[];
}

export type TiledLayer =
  | { readonly type: 'tilelayer'; readonly name: string; readonly data: readonly number[] }
  | { readonly type: 'objectgroup'; readonly name: string; readonly objects: readonly TiledObject[] }
  | { readonly type: 'group' | 'imagelayer'; readonly name: string };

export interface TiledObject {
  readonly id: number;
  readonly type?: string;
  readonly class?: string;
  readonly name?: string;
  readonly x: number;
  readonly y: number;
  readonly properties?: readonly TiledProperty[];
}

export interface TiledProperty {
  readonly name: string;
  readonly type?: string;
  readonly value: string | number | boolean;
}

export interface RoomObject {
  readonly id: number;
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly props: Readonly<Record<string, string | number | boolean>>;
}

export interface RoomModel {
  readonly id: string;
  readonly grid: SolidGrid;
  readonly objects: readonly RoomObject[];
  readonly props: Readonly<Record<string, string | number | boolean>>;
}

export class RoomFormatError extends Error {}

const toProps = (list: readonly TiledProperty[] | undefined) =>
  Object.fromEntries((list ?? []).map((p) => [p.name, p.value]));

export function parseRoom(id: string, map: TiledMap): RoomModel {
  if (map.tilewidth !== TILE || map.tileheight !== TILE) {
    throw new RoomFormatError(`${id}: tiles must be ${TILE} px, got ${map.tilewidth}x${map.tileheight}`);
  }
  const walls = map.layers.find((l) => l.name === 'walls');
  if (!walls || walls.type !== 'tilelayer') throw new RoomFormatError(`${id}: missing tile layer "walls"`);
  if (walls.data.length !== map.width * map.height) {
    throw new RoomFormatError(`${id}: "walls" has ${walls.data.length} cells, expected ${map.width * map.height}`);
  }
  const objectLayer = map.layers.find((l) => l.name === 'objects');
  const objects = objectLayer && objectLayer.type === 'objectgroup'
    ? objectLayer.objects.map((o) => ({
        id: o.id,
        kind: o.class ?? o.type ?? '',
        x: o.x,
        y: o.y,
        props: toProps(o.properties),
      }))
    : [];
  return {
    id,
    grid: { cols: map.width, rows: map.height, solid: walls.data.map((gid) => gid !== 0) },
    objects,
    props: toProps(map.properties),
  };
}

export function playerStart(room: RoomModel): { x: number; y: number } {
  const start = room.objects.find((o) => o.kind === 'PlayerStart');
  if (!start) throw new RoomFormatError(`${room.id}: no PlayerStart object`);
  return { x: start.x, y: start.y };
}
