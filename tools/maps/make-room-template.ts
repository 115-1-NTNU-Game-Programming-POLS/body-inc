/**
 * Writes the room templates authors copy (public/assets/maps/_template/room-<world>.tmj): the
 * standard 20 x 12 shell of design doc 13.3 with the right struct tileset, one open south door
 * named door-s, and a PlayerStart. Organ, role and estSeconds are left out on purpose, so a copy
 * that was never filled in fails the map check instead of passing as a room. The folder starts
 * with an underscore, which the map check skips, and sits at the same depth as a chapter folder,
 * so the tileset path inside stays valid when a copy is dropped into one.
 *
 *   node tools/maps/make-room-template.ts            write the files
 *   node tools/maps/make-room-template.ts --check    exit 1 if they differ from what this writes
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRoom, type TiledMap } from '../../src/core/rooms/tiled.ts';
import { loadDictionary } from '../../src/core/tags/dictionary.ts';
import { ROOT, shell, tileLayer, W } from './room-kit.ts';

/** Tilesets that exist today for the chapters in scope; add a world here once its struct sheet is packed. */
export const TEMPLATE_WORLDS = ['lobby', 'warehouse', 'brain', 'liver'] as const;
const OUT = join(ROOT, 'public', 'assets', 'maps', '_template');

export function buildTemplate(world: string): object {
  const { floor, walls, set, tileset } = shell(world, 5);
  // The south socket (columns 9-10 of the bottom wall) is open with its corner tiles.
  walls[11 * W + 9] = 0; walls[11 * W + 10] = 0;
  set(walls, 8, 11, 'walltop-outer-ne'); set(walls, 11, 11, 'walltop-outer-nw');
  return {
    type: 'map', version: '1.10', tiledversion: '1.11.0', orientation: 'orthogonal', renderorder: 'right-down',
    infinite: false, width: W, height: 12, tilewidth: 32, tileheight: 32, nextlayerid: 4, nextobjectid: 3, class: 'Room',
    layers: [
      tileLayer(1, 'floor', floor),
      tileLayer(2, 'walls', walls),
      {
        id: 3, name: 'objects', type: 'objectgroup', x: 0, y: 0, opacity: 1, visible: true, draworder: 'topdown',
        objects: [
          { id: 1, name: 'start', type: 'PlayerStart', x: 320, y: 256, width: 0, height: 0, rotation: 0, visible: true, point: true },
          {
            id: 2, name: 'door-s', type: 'Door', x: 9 * 32, y: 11 * 32, width: 64, height: 32, rotation: 0, visible: true,
            properties: [{ name: 'socket', type: 'string', propertytype: 'Socket', value: 'S' }],
          },
        ],
      },
    ],
    tilesets: [tileset],
  };
}

const text = (world: string) => JSON.stringify(buildTemplate(world), null, 1) + '\n';
const file = (world: string) => join(OUT, `room-${world}.tmj`);

if (process.argv[1] && process.argv[1].endsWith('make-room-template.ts')) {
  const dict = loadDictionary(JSON.parse(readFileSync(join(ROOT, 'content', 'tags.json'), 'utf8')));
  const stale: string[] = [];
  for (const world of TEMPLATE_WORLDS) {
    // The template must be exactly one fill-in away from a valid room: three required fields, nothing else.
    const codes = readRoom(world, JSON.parse(text(world)) as TiledMap, dict).problems.map((p) => `${p.code}:${p.prop}`).sort();
    const want = ['required:estSeconds', 'required:organ', 'required:role'];
    if (codes.join() !== want.join()) throw new Error(`template ${world} has problems beyond the three fields to fill in: ${codes.join(', ')}`);
    if (process.argv.includes('--check')) {
      if (!existsSync(file(world)) || readFileSync(file(world), 'utf8').replace(/\r\n/g, '\n') !== text(world)) stale.push(file(world));
    } else {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(file(world), text(world));
      console.log(`-> ${file(world)}`);
    }
  }
  if (process.argv.includes('--check')) {
    for (const s of stale) console.log(`room template: ${s} is out of date; run node tools/maps/make-room-template.ts`);
    if (stale.length === 0) console.log('room templates: up to date');
    process.exit(stale.length ? 1 : 0);
  }
}
