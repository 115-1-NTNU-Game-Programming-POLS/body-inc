/**
 * Shared pieces for the scripted greybox rooms: the standard 20 x 12 shell of design doc 13.3
 * (north wall rows 0-2, south wall row 11, side walls one column), the embedded struct tileset
 * (Phaser cannot read external tilesets, art direction 13.6) and a checked write.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRoom, playerStart, type TiledMap } from '../../src/core/rooms/tiled.ts';
import { loadDictionary } from '../../src/core/tags/dictionary.ts';
import { nextFloat, seedRng } from '../../src/core/rng.ts';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TS_DIR = join(ROOT, 'public', 'assets', 'tilesets');
export const W = 20;
export const H = 12;

export interface Shell {
  readonly sheet: string;
  readonly floor: number[];
  readonly walls: number[];
  readonly gid: (name: string) => number;
  readonly set: (layer: number[], x: number, y: number, name: string) => void;
  /** The struct tileset entry to embed, always at firstgid 1. */
  readonly tileset: object;
  readonly tilecount: number;
}

/** Floor with seeded wear, the north-wall shadow, and the closed outer walls. */
export function shell(world: string, seed = 7, cols = W): Shell {
  const sheet = `tiles-${world}-struct`;
  const slots: Record<string, number> = JSON.parse(readFileSync(join(TS_DIR, 'struct-slots.json'), 'utf8'));
  const tsj = JSON.parse(readFileSync(join(TS_DIR, `${sheet}.tsj`), 'utf8'));
  const gid = (name: string): number => {
    const i = slots[name];
    if (i === undefined) throw new Error(`unknown struct slot ${name}`);
    return i + 1;
  };
  const floor: number[] = new Array(cols * H).fill(gid('floor-0'));
  const walls: number[] = new Array(cols * H).fill(0);
  const set = (layer: number[], x: number, y: number, name: string) => { layer[y * cols + x] = gid(name); };

  let rng = seedRng(seed);
  for (let y = 4; y < 11; y++) {
    for (let x = 1; x < cols - 1; x++) {
      let r: number;
      [r, rng] = nextFloat(rng);
      if (r < 0.15) set(floor, x, y, 'floor-1');
      else if (r < 0.22) set(floor, x, y, 'floor-2');
    }
  }
  for (let x = 1; x < cols - 1; x++) set(floor, x, 3, 'floor-shadow-n');
  set(floor, 1, 3, 'floor-shadow-nw');

  for (let x = 0; x < cols; x++) {
    set(walls, x, 0, 'walltop-edge-s');
    set(walls, x, 1, 'face-upper-m');
    set(walls, x, 2, 'face-lower-m');
    set(walls, x, 11, 'walltop-edge-n');
  }
  for (let y = 1; y < 11; y++) {
    set(walls, 0, y, 'walltop-edge-e');
    set(walls, cols - 1, y, 'walltop-edge-w');
  }
  set(walls, 0, 0, 'walltop-inner-se');
  set(walls, cols - 1, 0, 'walltop-inner-sw');
  set(walls, 0, 11, 'walltop-inner-ne');
  set(walls, cols - 1, 11, 'walltop-inner-nw');
  set(walls, 1, 1, 'face-upper-l');
  set(walls, 1, 2, 'face-lower-l');
  set(walls, cols - 2, 1, 'face-upper-r');
  set(walls, cols - 2, 2, 'face-lower-r');

  const tileset = {
    firstgid: 1, name: sheet, image: `../../tilesets/${sheet}-ex.png`,
    imagewidth: tsj.imagewidth, imageheight: tsj.imageheight, tilewidth: 32, tileheight: 32,
    margin: tsj.margin, spacing: tsj.spacing, columns: tsj.columns, tilecount: tsj.tilecount,
  };
  return { sheet, floor, walls, gid, set, tileset, tilecount: tsj.tilecount };
}

/** A decoration prop: one of public/assets/props by file name without .png, its bottom-left corner in pixels. */
export interface Prop {
  readonly name: string;
  readonly x: number;
  readonly bottom: number;
}

/**
 * The "props" layer of art direction 7.3 and the image-collection tileset it draws from, placed
 * after the struct sheet. Props are decoration only: they neither collide nor take part in play,
 * so a room places them along walls and in corners, clear of the paths and the objects.
 * Object ids start at `firstId`; keep them clear of the room's own objects.
 */
export function propsLayer(s: Shell, layerId: number, firstId: number, props: readonly Prop[]): { layer: object; tileset: object } {
  const kit = propKit(s, props.map((p) => p.name));
  return { layer: objectGroup(layerId, 'props', props.map((p, i) => kit.place(firstId + i, p))), tileset: kit.tileset };
}

/** The props tileset for `names`, and tile objects drawing from it; for rooms that also put props in variant groups. */
export function propKit(s: Shell, names: readonly string[]): { tileset: object; place: (id: number, p: Prop) => object } {
  const unique = [...new Set(names)];
  const size = new Map(unique.map((n) => {
    const png = readFileSync(join(ROOT, 'public', 'assets', 'props', `${n}.png`));
    return [n, { w: png.readUInt32BE(16), h: png.readUInt32BE(20) }] as const;
  }));
  const firstgid = s.tilecount + 1;
  const sizes = [...size.values()];
  const tileset = {
    firstgid, name: 'props', tilewidth: Math.max(...sizes.map((v) => v.w)), tileheight: Math.max(...sizes.map((v) => v.h)),
    tilecount: unique.length, columns: 0, margin: 0, spacing: 0, grid: { orientation: 'orthogonal', width: 1, height: 1 },
    tiles: unique.map((n, id) => ({ id, image: `../../props/${n}.png`, imagewidth: size.get(n)!.w, imageheight: size.get(n)!.h })),
  };
  const place = (id: number, p: Prop) => {
    const s = size.get(p.name);
    if (!s) throw new Error(`prop ${p.name} is not in this room's props tileset`);
    return { id, name: p.name.replace(/^prop-/, ''), type: '', gid: firstgid + unique.indexOf(p.name), x: p.x, y: p.bottom, width: s.w, height: s.h, rotation: 0, visible: true };
  };
  return { tileset, place };
}

export const objectGroup = (id: number, name: string, objects: readonly object[]) =>
  ({ id, name, type: 'objectgroup', x: 0, y: 0, opacity: 1, visible: true, draworder: 'topdown', objects });

export const tileLayer = (id: number, name: string, data: number[], cols = W) => ({
  id, name, type: 'tilelayer', x: 0, y: 0, width: cols, height: H, opacity: 1, visible: true, data,
});

/** Parses the map with the game's own parser before writing, so a broken room is never written. */
export function writeRoom(rel: string, map: object): void {
  const dict = loadDictionary(JSON.parse(readFileSync(join(ROOT, 'content', 'tags.json'), 'utf8')));
  const room = parseRoom(rel, map as unknown as TiledMap, dict);
  playerStart(room);
  const out = join(ROOT, 'public', 'assets', 'maps', rel);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(map, null, 1) + '\n');
  console.log(`-> ${out}`);
}
