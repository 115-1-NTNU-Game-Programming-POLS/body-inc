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
import { loadEnemyTable, type EnemyTable } from '../src/core/combat/enemies.ts';
import { SOCKET_COLS, SOCKET_ROWS, readRoom, type RoomModel, type RoomProblem, type TiledMap } from '../src/core/rooms/tiled.ts';
import type { ConditionProblem } from '../src/core/tags/condition.ts';
import { loadDictionary, type TagDictionary } from '../src/core/tags/dictionary.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export interface MapContent {
  readonly dict: TagDictionary;
  readonly enemies: EnemyTable;
  readonly dialogueIds: ReadonlySet<string>;
  readonly handbookIds: ReadonlySet<string>;
}

/** Minimal RFC 4180 reader: quoted fields may hold commas, newlines and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

export function loadMapContent(contentDir = join(ROOT, 'content')): MapContent {
  const json = (name: string) => JSON.parse(readFileSync(join(contentDir, name), 'utf8')) as unknown;
  const dialogueIds = new Set<string>();
  const dialogueDir = join(contentDir, 'dialogue');
  if (existsSync(dialogueDir)) {
    for (const f of readdirSync(dialogueDir).filter((n) => n.endsWith('.csv'))) {
      const [header, ...rows] = parseCsv(readFileSync(join(dialogueDir, f), 'utf8').replace(/^﻿/, ''));
      const col = header?.indexOf('dialogueId') ?? -1;
      if (col < 0) throw new Error(`${f}: no dialogueId column`);
      for (const r of rows) if (r[col]) dialogueIds.add(r[col]!.trim());
    }
  }
  const handbookFile = join(contentDir, 'handbook.json');
  const handbook = existsSync(handbookFile) ? (json('handbook.json') as { pages?: { id: string }[] }).pages ?? [] : [];
  return {
    dict: loadDictionary(json('tags.json')),
    enemies: loadEnemyTable(json('enemies.json')),
    dialogueIds,
    handbookIds: new Set(handbook.map((p) => p.id)),
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

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.tmj') ? [p] : [];
  });
}

const list = (s: unknown) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

export function checkMaps(mapsDir: string, content: MapContent = loadMapContent()): string[] {
  const out: string[] = [];
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
      if (o.kind === 'Pickup' && o.props['itemType'] === 'handbook' && !content.handbookIds.has(id)) {
        out.push(`${file} ${where(room, { object: o.id })}：itemId「${id}」不存在於手冊頁（content/handbook.json）`);
      }
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? join(ROOT, 'public', 'assets', 'maps');
  const problems = checkMaps(dir);
  for (const p of problems) console.log(p);
  console.log(`map check: ${problems.length} problem(s) in ${relative(process.cwd(), resolve(dir)) || '.'}`);
  process.exit(problems.length ? 1 : 0);
}
