import type { SolidGrid } from '../collision/grid.ts';
import { ConditionError, type Condition, type ConditionProblem } from '../tags/condition.ts';
import { compileCondition, type TagDictionary } from '../tags/dictionary.ts';
import { TILE } from '../time.ts';
import { OBJECT_CLASSES, ROOM_CLASS, VARIANT_PREFIX, type ClassSpec, type RefKind, type Scalar } from './classes.ts';

/**
 * Tiled JSON (.tmj) to room model. Core only needs structure, not art: which cells are solid,
 * where things are placed, which variants exist. Rendering reads the same file in the view.
 *
 * Authoring convention: every non-empty cell of the top-level tile layer "walls" is solid;
 * objects live in the object layer "objects" or inside a top-level "variant:<id>" group or
 * layer, whose `when` property switches it on. Object kind is its Tiled class. Object layers
 * named "props" (art direction 7.3) hold decoration only and are left to the view.
 */
export interface TiledMap {
  readonly width: number;
  readonly height: number;
  readonly tilewidth: number;
  readonly tileheight: number;
  readonly layers: readonly TiledLayer[];
  readonly properties?: readonly TiledProperty[];
}

interface LayerBase {
  readonly name: string;
  readonly properties?: readonly TiledProperty[];
}

export type TiledLayer =
  | (LayerBase & { readonly type: 'tilelayer'; readonly data: readonly number[] })
  | (LayerBase & { readonly type: 'objectgroup'; readonly objects: readonly TiledObject[] })
  | (LayerBase & { readonly type: 'group'; readonly layers: readonly TiledLayer[] })
  | (LayerBase & { readonly type: 'imagelayer' });

export interface TiledObject {
  readonly id: number;
  readonly type?: string;
  readonly class?: string;
  readonly name?: string;
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly height?: number;
  /** Tile objects are anchored bottom-left instead of top-left. */
  readonly gid?: number;
  readonly properties?: readonly TiledProperty[];
}

export interface TiledProperty {
  readonly name: string;
  readonly type?: string;
  readonly value: Scalar;
}

export interface RoomObject {
  readonly id: number;
  readonly kind: string;
  /** The object's Tiled name; a Door is addressed by it in the chapter file. */
  readonly name: string;
  /** Top-left corner for areas; the point itself for point objects (PlayerStart, Spawn). */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Class members with defaults applied. */
  readonly props: Readonly<Record<string, Scalar>>;
  readonly conditions: Readonly<Record<string, Condition>>;
  /** Id of the variant this object belongs to; absent for the base room. */
  readonly variant?: string;
}

export interface RoomVariant {
  readonly id: string;
  readonly when: Condition;
}

export interface RoomModel {
  readonly id: string;
  readonly grid: SolidGrid;
  readonly objects: readonly RoomObject[];
  /** Room class members with defaults applied. */
  readonly props: Readonly<Record<string, Scalar>>;
  readonly variants: readonly RoomVariant[];
}

/** Codes plus arguments, not text: the map check words them in Chinese. */
export type RoomProblemCode =
  | 'tile-size' | 'room-size' | 'missing-walls' | 'walls-size'
  | 'unknown-class' | 'unknown-property' | 'property-type' | 'enum-value' | 'out-of-range' | 'required'
  | 'condition' | 'door-shape' | 'door-position' | 'switch-target' | 'multiple-start' | 'missing-start'
  | 'variant-when' | 'variant-duplicate';

export interface RoomProblem {
  readonly code: RoomProblemCode;
  /** Tiled object id, when the problem belongs to one object. */
  readonly object?: number;
  readonly layer?: string;
  readonly prop?: string;
  readonly args?: Readonly<Record<string, string | number>>;
  readonly condition?: ConditionProblem;
}

export class RoomFormatError extends Error {
  readonly problems: readonly RoomProblem[];
  constructor(id: string, problems: readonly RoomProblem[]) {
    super(`${id}: ${problems.map((p) => `${p.code}${p.object !== undefined ? ` #${p.object}` : ''}${p.prop ? ` ${p.prop}` : ''}`).join(', ')}`);
    this.problems = problems;
  }
}

/** Standard room is 20 x 12; 2 x 1 and 2 x 2 are allowed (design doc 13.3). */
export const CELL_COLS = 20;
export const CELL_ROWS = 12;
/** Decoration object layer; tile objects only, no gameplay class. */
export const PROPS_LAYER = 'props';
const ALLOWED_CELLS: ReadonlyArray<readonly [number, number]> = [[1, 1], [2, 1], [2, 2]];

/**
 * Door sockets are two tiles wide at fixed places in every cell, so semester mode can join any
 * two rooms. North and south at columns 9-10; east and west at rows 6-7 (design doc 13.3 marks
 * the rows as pending confirmation; change them here only).
 */
export const SOCKET_COLS: readonly [number, number] = [9, 10];
export const SOCKET_ROWS: readonly [number, number] = [6, 7];
/** North wall is rows 0-2 (wall top and two rows of face); the other walls are one tile. */
const NORTH_WALL_ROWS = 3;

/** Ids the map refers to that content must define; collected for the map check. */
export interface RoomRef {
  readonly kind: RefKind;
  readonly id: string;
  readonly object: number;
  readonly prop: string;
}

export interface ReadResult {
  readonly room: RoomModel;
  readonly problems: readonly RoomProblem[];
  readonly refs: readonly RoomRef[];
}

function readProps(
  spec: ClassSpec,
  list: readonly TiledProperty[] | undefined,
  dict: TagDictionary,
  where: { object?: number; layer?: string },
  problems: RoomProblem[],
  refs: RoomRef[],
): { props: Record<string, Scalar>; conditions: Record<string, Condition> } {
  const props: Record<string, Scalar> = {};
  const conditions: Record<string, Condition> = {};
  const given = new Map((list ?? []).map((p) => [p.name, p.value]));
  const at = (prop: string) => ({ ...where, prop });
  for (const name of given.keys()) {
    if (!(name in spec)) problems.push({ code: 'unknown-property', ...at(name) });
  }
  for (const [name, s] of Object.entries(spec)) {
    const v = given.get(name);
    const has = v !== undefined;
    switch (s.type) {
      case 'string':
      case 'enum':
      case 'ref':
      case 'condition': {
        if (has && typeof v !== 'string') { problems.push({ code: 'property-type', ...at(name), args: { want: 'string' } }); continue; }
        const str = (v as string | undefined) ?? ('default' in s ? s.default : '');
        props[name] = str;
        if (s.type === 'enum' && s.required && str === '') problems.push({ code: 'required', ...at(name) });
        else if (s.type === 'enum' && !s.values.includes(str)) {
          problems.push({ code: 'enum-value', ...at(name), args: { value: str, allowed: s.values.join(', ') } });
        }
        if ((s.type === 'ref' || s.type === 'string' || s.type === 'condition') && s.required && str.trim() === '') {
          problems.push({ code: 'required', ...at(name) });
        }
        if (s.type === 'ref' && str.trim() !== '' && where.object !== undefined) refs.push({ kind: s.ref, id: str, object: where.object, prop: name });
        if (s.type === 'condition' && str.trim() !== '') {
          try {
            conditions[name] = compileCondition(dict, str);
          } catch (e) {
            if (!(e instanceof ConditionError)) throw e;
            problems.push({ code: 'condition', ...at(name), condition: e.problem });
          }
        }
        break;
      }
      case 'int':
      case 'float': {
        const ok = typeof v === 'number' && (s.type === 'float' || Number.isInteger(v));
        if (has && !ok) { problems.push({ code: 'property-type', ...at(name), args: { want: s.type } }); continue; }
        const n = (v as number | undefined) ?? s.default;
        props[name] = n;
        const max = s.type === 'int' ? s.max : undefined;
        if ((s.min !== undefined && n < s.min) || (max !== undefined && n > max)) {
          problems.push({ code: 'out-of-range', ...at(name), args: { value: n, min: s.min ?? '', max: max ?? '' } });
        }
        break;
      }
      case 'bool':
        if (has && typeof v !== 'boolean') { problems.push({ code: 'property-type', ...at(name), args: { want: 'bool' } }); continue; }
        props[name] = (v as boolean | undefined) ?? s.default;
        break;
      case 'object':
        if (has && typeof v !== 'number') { problems.push({ code: 'property-type', ...at(name), args: { want: 'object' } }); continue; }
        props[name] = (v as number | undefined) ?? 0;
        if (s.required && !v) problems.push({ code: 'required', ...at(name) });
        break;
    }
  }
  return { props, conditions };
}

/** Checks a door rectangle sits on the socket its `socket` property names. */
function doorProblem(o: RoomObject, cols: number, rows: number): RoomProblem | undefined {
  if (o.width <= 0 || o.height <= 0) return { code: 'door-shape', object: o.id };
  const c0 = Math.floor(o.x / TILE);
  const c1 = Math.ceil((o.x + o.width) / TILE) - 1;
  const r0 = Math.floor(o.y / TILE);
  const r1 = Math.ceil((o.y + o.height) / TILE) - 1;
  const socket = String(o.props['socket']);
  const along = (lo: number, hi: number, span: readonly [number, number], cell: number, count: number) => {
    for (let i = 0; i < count; i++) if (lo === span[0] + i * cell && hi === span[1] + i * cell) return true;
    return false;
  };
  const actual = { cols: `${c0}-${c1}`, rows: `${r0}-${r1}` };
  let ok: boolean;
  switch (socket) {
    case 'N': ok = r0 >= 0 && r1 < NORTH_WALL_ROWS && along(c0, c1, SOCKET_COLS, CELL_COLS, cols / CELL_COLS); break;
    case 'S': ok = r0 === rows - 1 && r1 === rows - 1 && along(c0, c1, SOCKET_COLS, CELL_COLS, cols / CELL_COLS); break;
    case 'W': ok = c0 === 0 && c1 === 0 && along(r0, r1, SOCKET_ROWS, CELL_ROWS, rows / CELL_ROWS); break;
    case 'E': ok = c0 === cols - 1 && c1 === cols - 1 && along(r0, r1, SOCKET_ROWS, CELL_ROWS, rows / CELL_ROWS); break;
    default: return undefined; // reported as an enum problem already
  }
  return ok ? undefined : { code: 'door-position', object: o.id, args: { socket, ...actual } };
}

export function readRoom(id: string, map: TiledMap, dict: TagDictionary): ReadResult {
  const problems: RoomProblem[] = [];
  const refs: RoomRef[] = [];
  if (map.tilewidth !== TILE || map.tileheight !== TILE) {
    problems.push({ code: 'tile-size', args: { w: map.tilewidth, h: map.tileheight } });
  }
  const cellsOk = ALLOWED_CELLS.some(([cx, cy]) => map.width === cx * CELL_COLS && map.height === cy * CELL_ROWS);
  if (!cellsOk) problems.push({ code: 'room-size', args: { cols: map.width, rows: map.height } });

  const walls = map.layers.find((l) => l.name === 'walls');
  let solid: boolean[] = new Array(map.width * map.height).fill(true);
  if (!walls || walls.type !== 'tilelayer') problems.push({ code: 'missing-walls' });
  else if (walls.data.length !== map.width * map.height) {
    problems.push({ code: 'walls-size', args: { got: walls.data.length, want: map.width * map.height } });
  } else solid = walls.data.map((gid) => gid !== 0);

  const room = readProps(ROOM_CLASS, map.properties, dict, {}, problems, refs);
  if (room.props['estSeconds'] === 0) problems.push({ code: 'required', prop: 'estSeconds' });

  const objects: RoomObject[] = [];
  const readObjects = (layer: TiledLayer, variant: string | undefined) => {
    if (layer.type === 'group') for (const l of layer.layers) readObjects(l, variant);
    if (layer.type !== 'objectgroup' || layer.name === PROPS_LAYER) return;
    for (const o of layer.objects) {
      const kind = o.class ?? o.type ?? '';
      const spec = OBJECT_CLASSES[kind];
      if (!spec) { problems.push({ code: 'unknown-class', object: o.id, args: { cls: kind } }); continue; }
      const { props, conditions } = readProps(spec, o.properties, dict, { object: o.id }, problems, refs);
      const width = o.width ?? 0;
      const height = o.height ?? 0;
      objects.push({
        id: o.id, kind, name: o.name ?? '', x: o.x, y: o.gid !== undefined ? o.y - height : o.y, width, height, props, conditions,
        ...(variant !== undefined ? { variant } : {}),
      });
    }
  };

  const variants: RoomVariant[] = [];
  for (const layer of map.layers) {
    if (layer.name === 'objects') readObjects(layer, undefined);
    if (!layer.name.startsWith(VARIANT_PREFIX)) continue;
    const vid = layer.name.slice(VARIANT_PREFIX.length);
    const when = layer.properties?.find((p) => p.name === 'when')?.value;
    if (variants.some((v) => v.id === vid)) problems.push({ code: 'variant-duplicate', layer: layer.name });
    if (typeof when !== 'string' || when.trim() === '') {
      problems.push({ code: 'variant-when', layer: layer.name });
    } else {
      try {
        variants.push({ id: vid, when: compileCondition(dict, when) });
      } catch (e) {
        if (!(e instanceof ConditionError)) throw e;
        problems.push({ code: 'condition', layer: layer.name, prop: 'when', condition: e.problem });
      }
    }
    readObjects(layer, vid);
  }

  if (objects.filter((o) => o.kind === 'PlayerStart').length > 1) problems.push({ code: 'multiple-start' });
  const ids = new Set(objects.map((o) => o.id));
  for (const o of objects) {
    if (o.kind === 'Door' && cellsOk) {
      const p = doorProblem(o, map.width, map.height);
      if (p) problems.push(p);
    }
    const target = o.props['target'];
    if (o.kind === 'Switch' && typeof target === 'number' && target !== 0 && !ids.has(target)) {
      problems.push({ code: 'switch-target', object: o.id, args: { target } });
    }
  }

  return {
    room: { id, grid: { cols: map.width, rows: map.height, solid }, objects, props: room.props, variants },
    problems,
    refs,
  };
}

/** For the game: a room with any problem is a bug that the map check should have caught. */
export function parseRoom(id: string, map: TiledMap, dict: TagDictionary): RoomModel {
  const { room, problems } = readRoom(id, map, dict);
  if (problems.length > 0) throw new RoomFormatError(id, problems);
  return room;
}

export function playerStart(room: RoomModel): { x: number; y: number } {
  const start = room.objects.find((o) => o.kind === 'PlayerStart' && o.variant === undefined);
  if (!start) throw new RoomFormatError(room.id, [{ code: 'missing-start' }]);
  return { x: start.x, y: start.y };
}
