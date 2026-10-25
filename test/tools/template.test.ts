import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { TAGS } from '../../src/app/content.ts';
import { readRoom, type TiledMap } from '../../src/core/rooms/tiled.ts';
import { checkChapters, checkMaps, loadMapContent } from '../../tools/check-maps.ts';
import { TEMPLATE_WORLDS } from '../../tools/maps/make-room-template.ts';

const DIR = 'public/assets/maps/_template';

/** The file as plain JSON, so a test can edit it the way an author's editor would. */
interface Raw {
  properties?: object[];
  layers: { name: string; objects?: { name: string; x: number; y: number; width: number; height: number; properties: { value: string }[] }[]; data?: number[] }[];
  tilesets: { image: string }[];
}
const read = (world: string): Raw => JSON.parse(readFileSync(join(DIR, `room-${world}.tmj`), 'utf8')) as Raw;
const asMap = (r: Raw) => r as unknown as TiledMap;
const FILLED = [{ name: 'organ', value: 'lobby' }, { name: 'role', value: 'rest' }, { name: 'estSeconds', value: 20 }];

describe('room templates (build plan P0)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'templates-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it.each(TEMPLATE_WORLDS)('%s is one fill-in away from a room: organ, role and estSeconds, nothing else', (world) => {
    const unfilled = readRoom(world, asMap(read(world)), TAGS).problems;
    expect(unfilled.map((p) => `${p.code}:${p.prop}`).sort()).toEqual(['required:estSeconds', 'required:organ', 'required:role']);
    expect(readRoom(world, asMap({ ...read(world), properties: FILLED }), TAGS).problems).toEqual([]);
  });

  it.each(TEMPLATE_WORLDS)('%s has its tileset where a chapter folder would look for it', (world) => {
    const image = read(world).tilesets[0]!.image;
    expect(existsSync(join(DIR, image))).toBe(true);
    // A copy lives in public/assets/maps/<chapter>/, the same depth as _template, so the path is unchanged.
    expect(existsSync(join(dirname(DIR), 'greybox', image))).toBe(true);
  });

  it('the files are what the generator writes', () => {
    const r = spawnSync(process.execPath, ['tools/maps/make-room-template.ts', '--check'], { encoding: 'utf8' });
    expect(r.stdout).toContain('up to date');
    expect(r.status).toBe(0);
  });

  it('a copy that is filled in and linked to another room passes both checks', () => {
    const dir = join(tmp, 'maps');
    mkdirSync(join(dir, 'lab'), { recursive: true });
    const a: Raw = { ...read('lobby'), properties: FILLED };
    // A second room whose north door meets the template's south door.
    const b = JSON.parse(JSON.stringify(a)) as Raw;
    const door = b.layers.find((l) => l.name === 'objects')!.objects!.find((o) => o.name === 'door-s')!;
    Object.assign(door, { name: 'door-n', x: 9 * 32, y: 0, width: 64, height: 96 });
    door.properties[0]!.value = 'N';
    const walls = b.layers.find((l) => l.name === 'walls')!.data!;
    for (const x of [9, 10]) for (const y of [0, 1, 2]) walls[y * 20 + x] = 0;
    writeFileSync(join(dir, 'lab', 'a.tmj'), JSON.stringify(a));
    writeFileSync(join(dir, 'lab', 'b.tmj'), JSON.stringify(b));
    const links = [{ a: 'lab/a#door-s', b: 'lab/b#door-n' }];
    const content = { ...loadMapContent(), chapters: new Map([['lab', { version: 1 as const, id: 'lab', start: 'lab/a', links }]]) };
    expect(checkMaps(dir, content)).toEqual([]);
    expect(checkChapters(dir, content)).toEqual([]);
    // Without the link the template's open door is a problem the author is told about.
    const unlinked = { ...content, chapters: new Map([['lab', { version: 1 as const, id: 'lab', start: 'lab/a', links: [] }]]) };
    expect(checkChapters(dir, unlinked).some((l) => l.includes('沒有接到任何房間'))).toBe(true);
  });
});
