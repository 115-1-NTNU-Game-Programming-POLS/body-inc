import { VARIANT_PREFIX } from './classes.ts';
import { PROPS_LAYER, type TiledLayer, type TiledMap } from './tiled.ts';

/**
 * Decoration props (art direction 7.3): tile objects in a "props" object layer, at the top level
 * or inside a variant group. Each one points at an image-collection tileset entry such as
 * ../../props/prop-clock-vent.png, so Tiled shows the real picture; the game draws the frame of
 * the same name from a scene atlas. Read here so the map check and the view cannot disagree.
 */
export interface TiledTileset {
  readonly firstgid: number;
  readonly name: string;
  /** Set for a single-image tileset (struct sheets); absent for an image collection. */
  readonly image?: string;
  readonly margin?: number;
  readonly spacing?: number;
  readonly tiles?: readonly { readonly id: number; readonly image?: string }[];
}

export interface TiledMapFile extends TiledMap {
  readonly tilesets: readonly TiledTileset[];
}

export interface PropPlacement {
  readonly object: number;
  /** Image path as written in the map, relative to the map file. */
  readonly image: string;
  /** Atlas frame name: the image file name without its extension. */
  readonly frame: string;
  /** Top-left corner, like room objects. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly variant?: string;
}

export type PropProblem =
  | { readonly code: 'prop-not-tile'; readonly object: number; readonly layer: string }
  | { readonly code: 'prop-unknown-gid'; readonly object: number; readonly layer: string; readonly gid: number }
  /** The view does not draw tile layers inside variants yet; fail instead of silently not drawing. */
  | { readonly code: 'variant-tile-layer'; readonly layer: string };

/** Tiled stores flip flags in the top bits of a gid. */
const GID_MASK = 0x1fffffff;

export function listProps(map: TiledMapFile): { props: PropPlacement[]; problems: PropProblem[] } {
  const images = new Map<number, string>();
  for (const ts of map.tilesets) {
    for (const t of ts.tiles ?? []) if (t.image !== undefined) images.set(ts.firstgid + t.id, t.image);
  }
  const props: PropPlacement[] = [];
  const problems: PropProblem[] = [];
  const read = (layer: TiledLayer, path: string, variant: string | undefined) => {
    if (layer.type !== 'objectgroup' || layer.name !== PROPS_LAYER) return;
    for (const o of layer.objects) {
      if (o.gid === undefined) { problems.push({ code: 'prop-not-tile', object: o.id, layer: path }); continue; }
      const gid = o.gid & GID_MASK;
      const image = images.get(gid);
      if (image === undefined) { problems.push({ code: 'prop-unknown-gid', object: o.id, layer: path, gid }); continue; }
      const width = o.width ?? 0;
      const height = o.height ?? 0;
      const frame = (image.split('/').pop() ?? image).replace(/\.[^.]+$/, '');
      props.push({ object: o.id, image, frame, x: o.x, y: o.y - height, width, height, ...(variant !== undefined ? { variant } : {}) });
    }
  };
  for (const layer of map.layers) {
    if (!layer.name.startsWith(VARIANT_PREFIX)) { read(layer, layer.name, undefined); continue; }
    const id = layer.name.slice(VARIANT_PREFIX.length);
    const children = layer.type === 'group' ? layer.layers : [layer];
    for (const child of children) {
      const path = layer.type === 'group' ? `${layer.name}/${child.name}` : layer.name;
      if (child.type === 'tilelayer') problems.push({ code: 'variant-tile-layer', layer: path });
      read(child, path, id);
    }
  }
  return { props, problems };
}

/** The props a player sees: base props plus those of the variants active at entry. */
export function visibleProps(props: readonly PropPlacement[], active: readonly string[]): PropPlacement[] {
  const on = new Set(active);
  return props.filter((p) => p.variant === undefined || on.has(p.variant));
}