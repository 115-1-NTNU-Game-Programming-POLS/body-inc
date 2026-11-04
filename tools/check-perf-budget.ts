/**
 * Cold start budget (art direction 13.7, docs/perf/cold-start.md section 6). Adds up what the
 * browser transfers before the title from a production build, and fails above the limit.
 *
 *   node tools/check-perf-budget.ts [distDir] [--limit <kB>]     exit 1 over the limit or on a missing file
 *
 * It follows the same lists as Boot: the files index.html names (bundle, font stylesheet, font
 * preloads), every face the font stylesheet declares, the manifest, the atlas index, the scene
 * atlases, the atlas of every manifest entry, every room map of every chapter and the tileset
 * images those maps use. Portraits are not on the list: they load behind the title. Text files
 * count as gzip, the rest as they are, plus a fixed allowance per request for headers, which is
 * what the Network panel's transferred size includes. `npm run build` runs it, so a pull request
 * that grows the cold path past the limit fails CI. Rerun tools/perf/cold-start.mjs to compare it
 * with a real browser; the two agree to a few kB.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { atlasUrls, SCENE_ATLASES, type AtlasIndex, type Manifest } from '../src/app/assets.ts';
import { roomsOf } from '../src/core/index.ts';
import type { ChapterFile } from '../src/core/content/generated.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** kB (1000 bytes) the title may wait for, and why this number: docs/perf/cold-start.md section 6. */
export const COLD_LIMIT_KB = 1750;
/** Response headers of one request, taken from the Network panel's transferred size minus the body. */
export const REQUEST_OVERHEAD = 350;

const TEXT = /\.(html|js|css|json|tmj)$/;

export interface ColdFile {
  /** Path under the dist directory, with forward slashes. */
  readonly path: string;
  readonly bytes: number;
}

export interface ColdPath {
  readonly files: readonly ColdFile[];
  readonly totalBytes: number;
  readonly problems: readonly string[];
}

const category = (path: string): string =>
  /\.js$/.test(path) ? 'JavaScript'
    : /\.woff2$/.test(path) ? 'font woff2'
      : /fonts\/.*\.css$/.test(path) ? 'font CSS'
        : /atlases\/.*\.png$/.test(path) ? 'atlas PNG'
          : /atlases\/.*\.json$/.test(path) ? 'atlas JSON'
            : /maps\//.test(path) ? 'maps'
              : /tilesets\//.test(path) ? 'tilesets'
                : 'HTML and manifests';

/** Files `html` names through src and href attributes of scripts and links, relative to the page. */
export function htmlRefs(html: string): string[] {
  const refs = [...html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]!);
  return refs.filter((r) => !/^(?:[a-z]+:)?\/\//i.test(r)).map((r) => posix.normalize(r.replace(/^\.\//, '')));
}

/** Font files a stylesheet declares with url(...), relative to the stylesheet. */
export function cssFontFiles(css: string, cssPath: string): string[] {
  return [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => posix.join(posix.dirname(cssPath), m[1]!.replace(/^["']|["']$/g, '')));
}

export function coldPath(dist: string, contentDir = join(ROOT, 'content')): ColdPath {
  const problems: string[] = [];
  const wanted = new Set<string>();
  const read = (path: string): Buffer | undefined => {
    const file = join(dist, path);
    if (!existsSync(file)) {
      problems.push(`${path}: the cold path needs this file and the build does not have it`);
      return undefined;
    }
    return readFileSync(file);
  };
  const json = <T>(path: string): T | undefined => {
    const buffer = read(path);
    return buffer === undefined ? undefined : (JSON.parse(buffer.toString('utf8')) as T);
  };

  wanted.add('index.html');
  const html = read('index.html')?.toString('utf8') ?? '';
  for (const ref of htmlRefs(html)) wanted.add(ref);
  for (const ref of [...wanted].filter((r) => r.endsWith('.css'))) {
    for (const font of cssFontFiles(read(ref)?.toString('utf8') ?? '', ref)) wanted.add(font);
  }

  for (const path of ['assets/manifest.json', 'assets/atlases/index.json', 'assets/tilesets/tilesets.json']) wanted.add(path);
  const manifest = json<Manifest>('assets/manifest.json');
  const index = json<AtlasIndex>('assets/atlases/index.json');
  const sheets = json<Record<string, { image: string }>>('assets/tilesets/tilesets.json');
  for (const key of SCENE_ATLASES) for (const ext of ['png', 'json']) wanted.add(`assets/atlases/${key}.${ext}`);
  for (const e of manifest?.entries ?? []) {
    if (index === undefined) break;
    const url = atlasUrls(index, e.key);
    wanted.add(url.png);
    wanted.add(url.json);
  }

  const rooms = new Set<string>();
  for (const name of readdirSync(join(contentDir, 'chapters')).filter((n) => n.endsWith('.json'))) {
    const chapter = JSON.parse(readFileSync(join(contentDir, 'chapters', name), 'utf8')) as ChapterFile;
    for (const room of roomsOf(chapter)) rooms.add(room);
  }
  const used = new Set<string>();
  for (const room of rooms) {
    const path = `assets/maps/${room}.tmj`;
    wanted.add(path);
    const map = json<{ tilesets: { name: string; image?: string }[] }>(path);
    for (const t of map?.tilesets ?? []) if (t.image !== undefined) used.add(t.name);
  }
  for (const name of used) {
    const meta = sheets?.[name];
    if (meta) wanted.add(meta.image);
    else problems.push(`a map uses tileset ${name}, which tilesets.json does not list`);
  }

  const files: ColdFile[] = [];
  for (const path of [...wanted].sort()) {
    const buffer = read(path);
    if (buffer === undefined) continue;
    files.push({ path, bytes: (TEXT.test(path) ? gzipSync(buffer, { level: 9 }).length : buffer.length) + REQUEST_OVERHEAD });
  }
  return { files, totalBytes: files.reduce((a, f) => a + f.bytes, 0), problems };
}

/** Problems with a build: files it lacks, or a cold path over `limitKb`. */
export function checkPerfBudget(dist: string, limitKb = COLD_LIMIT_KB, contentDir?: string): { problems: string[]; path: ColdPath } {
  const path = coldPath(dist, contentDir);
  const problems = [...path.problems];
  if (path.totalBytes > limitKb * 1000) {
    problems.push(`the cold path is ${(path.totalBytes / 1000).toFixed(1)} kB, over the ${limitKb} kB limit (art direction 13.7); see docs/perf/cold-start.md section 6 for what to cut`);
  }
  return { problems, path };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const limitAt = args.indexOf('--limit');
  const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : COLD_LIMIT_KB;
  const dist = args.find((a, i) => !a.startsWith('--') && i !== limitAt + 1) ?? join(ROOT, 'dist');
  const { problems, path } = checkPerfBudget(dist, limit);
  const sums = new Map<string, { n: number; bytes: number }>();
  for (const f of path.files) {
    const s = sums.get(category(f.path)) ?? { n: 0, bytes: 0 };
    sums.set(category(f.path), { n: s.n + 1, bytes: s.bytes + f.bytes });
  }
  for (const [c, s] of [...sums].sort((a, b) => b[1].bytes - a[1].bytes)) console.log(`  ${c.padEnd(20)} ${String(s.n).padStart(3)} files ${(s.bytes / 1000).toFixed(1).padStart(8)} kB`);
  console.log(`cold start budget: ${(path.totalBytes / 1000).toFixed(1)} kB of ${limit} kB, ${problems.length} problem(s)`);
  for (const p of problems) console.error(p);
  process.exit(problems.length > 0 ? 1 : 0);
}
