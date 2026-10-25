/**
 * Map check (design doc 13.3, build plan S6). Uses the same room and condition parser as the
 * game, so it cannot accept a map the game would reject or the reverse. Messages are Chinese
 * because they are read by the content authors on the pull request.
 *
 * A chapter is one folder under the maps directory; solutions and tutorial rooms are looked up
 * within the chapter, because a room may not need a key from another room but a chapter's
 * flow may place the bed two rooms away from the adenosine.
 *
 *   node tools/check-maps.ts [mapsDir]     exit 1 on any problem
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bodyOverlapsSolid } from '../src/core/collision/grid.ts';
import { OPERATOR_BODY } from '../src/core/combat/operator.ts';
import { loadEnemyTable, type EnemyTable } from '../src/core/combat/enemies.ts';
import { schemaProblems } from '../src/core/content/read.ts';
import { parseCsv } from '../src/core/dialogue/csv.ts';
import type { ChapterFile } from '../src/core/content/generated.ts';
import { wholeMinutes } from '../src/core/clock.ts';
import { arrivalPoint } from '../src/core/rooms/interact.ts';
import { listProps, type PropProblem, type TiledMapFile } from '../src/core/rooms/props.ts';
import { SOCKET_COLS, SOCKET_ROWS, readRoom, type RoomModel, type RoomObject, type RoomProblem, type TiledMap } from '../src/core/rooms/tiled.ts';
import type { ConditionProblem } from '../src/core/tags/condition.ts';
import { loadDictionary, type TagDictionary } from '../src/core/tags/dictionary.ts';
import { schemaMessage } from './check-content.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export interface MapContent {
  readonly dict: TagDictionary;
  readonly enemies: EnemyTable;
  readonly dialogueIds: ReadonlySet<string>;
  readonly handbookIds: ReadonlySet<string>;
  /** Chapter files by chapter id; a file that fails to parse or its schema is left out and reported in `problems`. */
  readonly chapters?: ReadonlyMap<string, ChapterFile>;
  /** Problems found while reading content (a chapter file that does not parse), reported first. */
  readonly problems?: readonly string[];
}

export function loadMapContent(contentDir = join(ROOT, 'content')): MapContent {
  const json = (name: string) => JSON.parse(readFileSync(join(contentDir, name), 'utf8')) as unknown;
  const problems: string[] = [];
  // Ids are read loosely: a map names a conversation that exists, and what is wrong inside it
  // is check-dialogue's to say, once, rather than again as a missing id here.
  const dialogueIds = new Set<string>();
  const dialogueDir = join(contentDir, 'dialogue');
  if (existsSync(dialogueDir)) {
    for (const f of readdirSync(dialogueDir).filter((n) => n.endsWith('.csv')).sort()) {
      const [, ...rows] = parseCsv(readFileSync(join(dialogueDir, f), 'utf8').replace(/^﻿/, ''));
      for (const r of rows) if ((r[0] ?? '').trim() !== '') dialogueIds.add(r[0]!.trim());
    }
  }
  const handbookFile = join(contentDir, 'handbook.json');
  const handbook = existsSync(handbookFile) ? (json('handbook.json') as { pages?: { id: string }[] }).pages ?? [] : [];
  const chapters = new Map<string, ChapterFile>();
  const chapterDir = join(contentDir, 'chapters');
  if (existsSync(chapterDir)) {
    for (const f of readdirSync(chapterDir).filter((n) => n.endsWith('.json')).sort()) {
      const file = `content/chapters/${f}`;
      let value: unknown;
      try {
        value = JSON.parse(readFileSync(join(chapterDir, f), 'utf8').replace(/^﻿/, ''));
      } catch (e) {
        problems.push(`${file}：不是有效的 JSON（${(e as Error).message}）`);
        continue;
      }
      const found = schemaProblems('chapter', value);
      if (found.length > 0) {
        // Said here as well, because without it the folder would be reported as having no chapter file at all.
        problems.push(`${file} ${found[0]!.path || '（整個檔案）'}：${schemaMessage(found[0]!)}（共 ${found.length} 項，完整清單請執行 node tools/check-content.ts）`);
        continue;
      }
      chapters.set((value as ChapterFile).id, value as ChapterFile);
    }
  }
  return {
    dict: loadDictionary(json('tags.json')),
    enemies: loadEnemyTable(json('enemies.json')),
    dialogueIds,
    handbookIds: new Set(handbook.map((p) => p.id)),
    chapters,
    problems,
  };
}

const SOCKET_NAME: Record<string, string> = { N: '北', E: '東', S: '南', W: '西' };
const span = (s: readonly [number, number]) => `${s[0]} 至 ${s[1]}`;
const SOCKET_PLACE: Record<string, string> = {
  N: `北牆（第 0 至 2 列）的第 ${span(SOCKET_COLS)} 欄`,
  S: `南牆（最後一列）的第 ${span(SOCKET_COLS)} 欄`,
  W: `西牆（第 0 欄）的第 ${span(SOCKET_ROWS)} 列`,
  E: `東牆（最後一欄）的第 ${span(SOCKET_ROWS)} 列`,
};

export function conditionMessage(p: ConditionProblem): string {
  switch (p.code) {
    case 'empty': return '條件式是空的';
    case 'empty-term': return '逗號前後少了條件';
    case 'syntax': return `看不懂「${p.term}」；只能寫標籤名、比較（>= <= > < == !=）、! 與逗號`;
    case 'negated-compare': return `「${p.term}」：! 只能放在布林標籤前，比較請改用相反的運算子`;
    case 'unknown-tag': return `「${p.name}」不在狀態標籤字典（content/tags.json）中`;
    case 'not-boolean': return `「${p.name}」是數值標籤，要寫成比較，例如 ${p.name}>0`;
    case 'not-number': return `「${p.name}」是布林標籤或修飾器，不能比較大小`;
  }
}

function problemMessage(p: RoomProblem): string {
  const a = p.args ?? {};
  switch (p.code) {
    case 'tile-size': return `圖塊必須是 32 × 32 像素，目前是 ${a['w']} × ${a['h']}`;
    case 'room-size': return `房間必須是 20 × 12、40 × 12 或 40 × 24 格，目前是 ${a['cols']} × ${a['rows']}`;
    case 'missing-walls': return '缺少名為「walls」的圖塊圖層';
    case 'walls-size': return `「walls」圖層有 ${a['got']} 格，應為 ${a['want']} 格`;
    case 'unknown-class': return a['cls'] ? `類別「${a['cls']}」不存在，請從範本拖曳物件` : '物件沒有設定類別，請從範本拖曳物件';
    case 'unknown-property': return `屬性「${p.prop}」不屬於這個類別`;
    case 'property-type': return `屬性「${p.prop}」的型別應為 ${a['want']}`;
    case 'enum-value': return `屬性「${p.prop}」的值「${a['value']}」不在選項內（${a['allowed']}）`;
    case 'out-of-range': return `屬性「${p.prop}」的值 ${a['value']} 超出範圍（${a['min']} 至 ${a['max'] === '' ? '不限' : a['max']}）`;
    case 'required': return `必填屬性「${p.prop}」沒有填寫`;
    case 'condition': return `屬性「${p.prop}」的條件式「${p.condition?.text}」有誤：${p.condition ? conditionMessage(p.condition) : ''}`;
    case 'door-shape': return '門必須畫成矩形，不能是點';
    case 'door-position': {
      const s = String(a['socket']);
      const range = (v: unknown) => String(v).replace('-', ' 至 ');
      return `${SOCKET_NAME[s]}門必須在${SOCKET_PLACE[s]}，目前在第 ${range(a['cols'])} 欄、第 ${range(a['rows'])} 列`;
    }
    case 'switch-target': return `開關的目標物件 #${a['target']} 不存在`;
    case 'multiple-start': return '地圖中有不只一個 PlayerStart';
    case 'missing-start': return '地圖中沒有 PlayerStart';
    case 'variant-when': return '變體圖層缺少 when 條件式';
    case 'variant-duplicate': return '變體圖層名稱重複';
  }
}

function propMessage(p: PropProblem): string {
  switch (p.code) {
    case 'prop-not-tile': return `圖層「${p.layer}」的物件 #${p.object} 不是圖塊物件；道具請從道具圖塊集拖曳`;
    case 'prop-unknown-gid': return `圖層「${p.layer}」的道具 #${p.object} 用了圖塊編號 ${p.gid}，不屬於任何道具圖塊集`;
    case 'variant-tile-layer': return `變體裡的圖塊圖層「${p.layer}」目前遊戲不會畫出來；請改用 props 物件圖層放道具`;
  }
}

interface LoadedRoom {
  readonly file: string;
  readonly chapter: string;
  readonly room: RoomModel;
}

function where(room: RoomModel, p: { object?: number; layer?: string; prop?: string }): string {
  if (p.object !== undefined) {
    const o = room.objects.find((x) => x.id === p.object);
    return `物件 #${p.object}${o ? `（${o.kind}）` : ''}`;
  }
  if (p.layer !== undefined) return `圖層「${p.layer}」`;
  return '地圖屬性';
}

/** Folders starting with an underscore hold templates for authors to copy, not rooms of the game. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name.startsWith('_') ? [] : walk(p);
    return p.endsWith('.tmj') ? [p] : [];
  });
}

const list = (s: unknown) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

export function checkMaps(mapsDir: string, content: MapContent = loadMapContent()): string[] {
  const out: string[] = [...(content.problems ?? [])];
  const rooms: LoadedRoom[] = [];
  for (const path of walk(resolve(mapsDir)).sort()) {
    const file = relative(process.cwd(), path).replaceAll('\\', '/');
    let map: TiledMap;
    try {
      map = JSON.parse(readFileSync(path, 'utf8')) as TiledMap;
    } catch (e) {
      out.push(`${file}：不是有效的 JSON（${(e as Error).message}）`);
      continue;
    }
    const { room, problems, refs } = readRoom(basename(path, '.tmj'), map, content.dict);
    for (const p of problems) out.push(`${file} ${where(room, p)}：${problemMessage(p)}`);
    for (const r of refs) {
      const known = r.kind === 'enemy' ? content.enemies.enemies.has(r.id)
        : r.kind === 'dialogue' ? content.dialogueIds.has(r.id) : content.handbookIds.has(r.id);
      const what = { enemy: '敵人種類（content/enemies.json）', dialogue: '對話（content/dialogue/*.csv）', handbook: '手冊頁（content/handbook.json）' }[r.kind];
      if (!known) out.push(`${file} ${where(room, r)}：${r.prop}「${r.id}」不存在於${what}`);
    }
    for (const o of room.objects) {
      const id = String(o.props['eventId'] ?? o.props['itemId'] ?? '');
      if (o.kind === 'Trigger' && o.props['event'] === 'dialogue' && !content.dialogueIds.has(id)) {
        out.push(`${file} ${where(room, { object: o.id })}：eventId「${id}」不存在於對話（content/dialogue/*.csv）`);
      }
      if (o.kind === 'Trigger' && o.props['event'] === 'clock_advance' && wholeMinutes(id) === undefined) {
        out.push(`${file} ${where(room, { object: o.id })}：clock_advance 的 eventId「${id}」必須是分鐘數，1 到 4 位數的整數，例如 20`);
      }
      if (o.kind === 'Pickup' && o.props['itemType'] === 'handbook' && !content.handbookIds.has(id)) {
        out.push(`${file} ${where(room, { object: o.id })}：itemId「${id}」不存在於手冊頁（content/handbook.json）`);
      }
    }
    const props = listProps({ ...map, tilesets: (map as Partial<TiledMapFile>).tilesets ?? [] });
    for (const p of props.problems) out.push(`${file}：${propMessage(p)}`);
    for (const p of props.props) {
      if (!existsSync(join(dirname(path), p.image))) out.push(`${file} 道具 #${p.object}：圖片 ${p.image} 不存在`);
    }
    for (const t of list(room.props['tutorialFor'])) {
      const e = content.enemies.enemies.get(t);
      if (!e || e.category === 'defeatable') out.push(`${file} 地圖屬性：tutorialFor 的「${t}」不是打不掉的敵人種類`);
    }
    rooms.push({ file, chapter: dirname(file), room });
  }

  // Chapter rules: each non-defeatable enemy needs its solution object and a tutorial room.
  for (const chapter of [...new Set(rooms.map((r) => r.chapter))]) {
    const inChapter = rooms.filter((r) => r.chapter === chapter);
    const kinds = new Set(inChapter.flatMap((r) => r.room.objects.map((o) => o.kind)));
    const firstSeen = new Map<string, LoadedRoom>();
    for (const r of inChapter) {
      for (const o of r.room.objects) {
        const e = o.kind === 'Spawn' ? content.enemies.enemies.get(String(o.props['enemyType'])) : undefined;
        if (e && e.category !== 'defeatable' && !firstSeen.has(e.id)) firstSeen.set(e.id, r);
      }
    }
    for (const [enemy, r] of firstSeen) {
      const e = content.enemies.enemies.get(enemy)!;
      const object = e.solution ? content.enemies.solutions.get(e.solution)?.object : undefined;
      if (object && !kinds.has(object)) {
        out.push(`${r.file}：「${enemy}」打不掉（${e.category}），解法是 ${e.solution}，但 ${chapter} 這一章沒有任何 ${object} 物件`);
      }
      const tutorial = inChapter.find((x) => list(x.room.props['tutorialFor']).includes(enemy)
        && x.room.objects.some((o) => o.kind === 'Spawn' && o.props['enemyType'] === enemy));
      if (!tutorial) out.push(`${r.file}：「${enemy}」在 ${chapter} 出現，但這一章沒有 tutorialFor 包含它、且真的生成它的教學房`);
    }
  }
  return out;
}

const OPPOSITE: Readonly<Record<string, string>> = { N: 'S', S: 'N', E: 'W', W: 'E' };

interface ChapterRoom {
  readonly path: string;
  readonly folder: string;
  readonly room: RoomModel;
}

/** Every room under the maps folder, keyed by `folder/map` as the chapter files name them. */
function loadRooms(mapsDir: string, dict: TagDictionary): ChapterRoom[] {
  const root = resolve(mapsDir);
  const out: ChapterRoom[] = [];
  for (const file of walk(root).sort()) {
    const path = relative(root, file).replaceAll('\\', '/').replace(/\.tmj$/, '');
    let map: TiledMap;
    try {
      map = JSON.parse(readFileSync(file, 'utf8')) as TiledMap;
    } catch {
      continue; // checkMaps already reports an unreadable file
    }
    out.push({ path, folder: path.split('/')[0]!, room: readRoom(path, map, dict).room });
  }
  return out;
}

const doorsOf = (r: RoomModel): RoomObject[] => r.objects.filter((o) => o.kind === 'Door');

/**
 * Chapter rules (build plan P0). A chapter file says which door opens onto which; this checks
 * that every end exists, the sockets face each other, nothing is joined twice, no unlocked door
 * is left leading nowhere, every room can be reached from the start, and a player coming
 * through a door never lands inside a wall. Rooms of a folder with no chapter file are an
 * error too, so a new chapter cannot be forgotten.
 */
export function checkChapters(mapsDir: string, content: MapContent = loadMapContent()): string[] {
  const out: string[] = [];
  const chapters = content.chapters ?? new Map<string, ChapterFile>();
  const rooms = loadRooms(mapsDir, content.dict);
  const byPath = new Map(rooms.map((r) => [r.path, r]));
  const folders = [...new Set(rooms.map((r) => r.folder))].sort();

  for (const folder of folders) {
    if (!chapters.has(folder)) out.push(`${folder}：地圖資料夾沒有對應的章節檔 content/chapters/${folder}.json`);
  }
  for (const [id, chapter] of [...chapters].sort(([a], [b]) => a.localeCompare(b))) {
    const file = `content/chapters/${id}.json`;
    const inChapter = rooms.filter((r) => r.folder === id);
    if (inChapter.length === 0) {
      out.push(`${file}：沒有對應的地圖資料夾 ${id}`);
      continue;
    }

    for (const r of inChapter) {
      const doors = doorsOf(r.room);
      for (const d of doors.filter((x) => x.name.trim() === '')) out.push(`${r.path} 物件 #${d.id}（Door）：沒有名字；章節檔靠 Tiled 的物件名稱找門，請在 Name 欄填上，例如 door-n`);
      const names = doors.map((d) => d.name).filter((n) => n !== '');
      for (const n of new Set(names.filter((x, i) => names.indexOf(x) !== i))) out.push(`${r.path}：有不只一扇門叫「${n}」，門的名字在同一間房裡不能重複`);
      if (!r.room.objects.some((o) => o.kind === 'PlayerStart' && o.variant === undefined)) {
        out.push(`${r.path}：缺少 PlayerStart；強制下班而還沒打過卡時，營運長會回到這裡`);
      }
      // A chapter file cannot name a door inside a variant, yet the game still lets the operator walk through it.
      for (const d of doors.filter((x) => x.variant !== undefined && x.props['lock'] === 'none')) {
        out.push(`${r.path} 物件 #${d.id}（Door）：變體圖層裡的門沒辦法在章節檔接到別的房間；請把 lock 設成上鎖，或把門移到變體圖層之外`);
      }
    }

    if (!byPath.has(chapter.start) || byPath.get(chapter.start)!.folder !== id) out.push(`${file}：start「${chapter.start}」不是這一章的房間`);
    if (chapter.id !== id) out.push(`${file}：id「${chapter.id}」必須與地圖資料夾 ${id} 相同`);

    const used = new Map<string, number>();
    const graph = new Map<string, Set<string>>(inChapter.map((r) => [r.path, new Set()]));
    chapter.links.forEach((link, i) => {
      const at = `${file} links[${i}]`;
      const ends = [link.a, link.b].map((end) => {
        const [roomPath = '', doorName = ''] = end.split('#');
        const r = byPath.get(roomPath);
        if (!r || r.folder !== id) { out.push(`${at}：${end} 的房間「${roomPath}」不在這一章的資料夾裡`); return undefined; }
        const door = doorsOf(r.room).find((d) => d.name === doorName && d.variant === undefined);
        if (!door) { out.push(`${at}：房間 ${roomPath} 沒有名叫「${doorName}」的門`); return undefined; }
        used.set(end, (used.get(end) ?? 0) + 1);
        return { r, door, end };
      });
      const [a, b] = ends;
      if (!a || !b) return;
      // A door that is not unlocked cannot be walked through yet, so it is no way across.
      if (a.door.props['lock'] === 'none') graph.get(a.r.path)!.add(b.r.path);
      if (b.door.props['lock'] === 'none') graph.get(b.r.path)!.add(a.r.path);
      if (OPPOSITE[String(a.door.props['socket'])] !== String(b.door.props['socket'])) {
        out.push(`${at}：${a.end}（${SOCKET_NAME[String(a.door.props['socket'])]}門）和 ${b.end}（${SOCKET_NAME[String(b.door.props['socket'])]}門）必須一個朝北一個朝南，或一個朝東一個朝西`);
      }
      for (const [from, to] of [[a, b], [b, a]] as const) {
        const p = arrivalPoint(to.door, OPERATOR_BODY);
        if (bodyOverlapsSolid(to.r.room.grid, OPERATOR_BODY, p.x, p.y)) out.push(`${at}：從 ${from.end} 走到 ${to.end} 會站在牆裡，請檢查那扇門的位置與牆`);
      }
    });
    for (const [end, n] of used) if (n > 1) out.push(`${file}：門 ${end} 被接了 ${n} 次，一扇門只能通往一個地方`);
    for (const r of inChapter) {
      for (const d of doorsOf(r.room).filter((x) => x.name !== '' && x.variant === undefined)) {
        if (!used.has(`${r.path}#${d.name}`) && d.props['lock'] === 'none') out.push(`${r.path} 物件 #${d.id}（Door）：門「${d.name}」沒有接到任何房間，也沒有上鎖；請在章節檔連起來，或把 lock 設成上鎖`);
      }
    }

    const seen = new Set<string>();
    const queue = byPath.has(chapter.start) ? [chapter.start] : [];
    while (queue.length > 0) {
      const cur = queue.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const next of graph.get(cur) ?? []) queue.push(next);
    }
    if (byPath.has(chapter.start)) for (const r of inChapter) if (!seen.has(r.path)) out.push(`${file}：房間 ${r.path} 從起點 ${chapter.start} 走不到，請在章節檔接上它；上鎖的門目前打不開，不算通路`);
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? join(ROOT, 'public', 'assets', 'maps');
  const content = loadMapContent();
  const problems = [...checkMaps(dir, content), ...checkChapters(dir, content)];
  for (const p of problems) console.log(p);
  console.log(`map check: ${problems.length} problem(s) in ${relative(process.cwd(), resolve(dir)) || '.'}`);
  process.exit(problems.length ? 1 : 0);
}
