/**
 * Content check (build plan S4, architecture section 7). Every JSON file under content/ must
 * match a schema in content/schema; a file no schema claims is itself a problem, so nothing
 * goes unchecked by accident. Files that pass their schema then go through the same loaders
 * the game uses, which check references between files. Schema messages are Chinese because
 * content authors read them on the pull request; loader messages are the loaders' own.
 *
 *   node tools/check-content.ts [contentDir]     exit 1 on any problem
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feedbackProblems, noteFields } from '../src/app/feedback.ts';
import type { ContentTypes, SchemaName, SchemaProblem } from '../src/core/index.ts';
import {
  BossTableError, DictionaryError, EnemyTableError, OPERATOR_SPEAKER, loadBossTable, loadDictionary, loadEnemyTable, schemaProblems, type EnemyTable,
} from '../src/core/index.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Which schema checks which file, by path relative to the content folder. */
const RULES: ReadonlyArray<readonly [RegExp, SchemaName]> = [
  [/^tags\.json$/, 'tags'],
  [/^enemies\.json$/, 'enemies'],
  [/^feedback\.json$/, 'feedback'],
  [/^params\.json$/, 'params'],
  [/^strings\/[a-z]{2}(-[A-Z]{2})?\.json$/, 'strings'],
  [/^cards\/schedule\.json$/, 'scheduleCards'],
  [/^bosses\/[a-z0-9_]+\.json$/, 'boss'],
  [/^chapters\/[a-z][a-z0-9-]*\.json$/, 'chapter'],
  [/^speakers\.json$/, 'speakers'],
  [/^decks\/[a-z][a-z0-9-]*\.json$/, 'deck'],
];

const TYPE_NAME: Record<string, string> = {
  object: '物件', array: '清單', string: '文字', number: '數字', integer: '整數', boolean: 'true 或 false', null: 'null',
};
const typeNames = (t: string) => t.split(' | ').map((x) => TYPE_NAME[x] ?? x).join('或');

export function schemaMessage(p: SchemaProblem): string {
  switch (p.code) {
    case 'required': return `缺少必填欄位「${p.expected}」`;
    case 'unknown-field': return `不認得的欄位「${p.got}」${p.expected ? `（這裡可用的欄位：${p.expected}）` : ''}`;
    case 'type': return `應為${typeNames(p.expected)}，目前是 ${p.got}`;
    case 'const': return `必須是 ${p.expected}，目前是 ${p.got}`;
    case 'enum': return `必須是 ${p.expected} 其中之一，目前是 ${p.got}`;
    case 'any-of': return `格式不符，可接受的寫法：${p.expected}；目前是 ${p.got}`;
    case 'min-items': return `至少要有 ${p.expected} 項，目前 ${p.got} 項`;
    case 'max-items': return `最多 ${p.expected} 項，目前 ${p.got} 項`;
    case 'unique-items': return '清單中有重複的項目';
    case 'minimum': return `不可小於 ${p.expected}，目前是 ${p.got}`;
    case 'maximum': return `不可大於 ${p.expected}，目前是 ${p.got}`;
    case 'exclusive-minimum': return `必須大於 ${p.expected}，目前是 ${p.got}`;
    case 'min-length': return p.expected === '1' ? '不可為空字串' : `長度至少 ${p.expected} 個字`;
    case 'pattern': return `格式不符（規則 ${p.expected}），目前是 ${p.got}`;
  }
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'schema' ? [] : walk(p);
    return p.endsWith('.json') ? [p] : [];
  });
}

/** Loader errors become problems; any other exception is a bug and propagates. */
function loaderProblems(file: string, load: () => void): string[] {
  try {
    load();
    return [];
  } catch (e) {
    if (e instanceof DictionaryError || e instanceof EnemyTableError || e instanceof BossTableError) return e.problems.map((p) => `${file}：${p}`);
    throw e;
  }
}

export function checkContent(contentDir: string): string[] {
  const root = resolve(contentDir);
  const out: string[] = [];
  const valid = new Map<string, { file: string; schema: SchemaName; value: unknown }>();

  for (const path of walk(root).sort()) {
    const rel = relative(root, path).replaceAll('\\', '/');
    const file = relative(process.cwd(), path).replaceAll('\\', '/');
    const schema = RULES.find(([re]) => re.test(rel))?.[1];
    if (!schema) {
      out.push(`${file}：沒有對應的 schema，請在 tools/check-content.ts 的 RULES 登記，或移出 content/`);
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
    } catch (e) {
      out.push(`${file}：不是有效的 JSON（${(e as Error).message}）`);
      continue;
    }
    const problems = schemaProblems(schema, value);
    for (const p of problems) out.push(`${file} ${p.path || '（整個檔案）'}：${schemaMessage(p)}`);
    if (problems.length === 0) valid.set(rel, { file, schema, value });
  }

  const get = <N extends SchemaName>(rel: string) => valid.get(rel) as { file: string; value: ContentTypes[N] } | undefined;

  const tags = get<'tags'>('tags.json');
  if (tags) out.push(...loaderProblems(tags.file, () => loadDictionary(tags.value)));

  let enemyTable: EnemyTable | undefined;
  const enemies = get<'enemies'>('enemies.json');
  if (enemies) out.push(...loaderProblems(enemies.file, () => { enemyTable = loadEnemyTable(enemies.value); }));

  const feedback = get<'feedback'>('feedback.json');
  const strings = [...valid.entries()].filter(([, v]) => v.schema === 'strings');
  if (feedback && enemyTable) {
    for (const [, s] of strings) {
      for (const p of feedbackProblems(feedback.value, s.value as ContentTypes['strings'], noteFields(enemyTable))) out.push(`${feedback.file}（對照 ${s.file}）：${p}`);
    }
  }

  const params = get<'params'>('params.json');
  // Boss files are checked against the enemy table; every boss enemy needs a file, so this runs
  // even when content/bosses is empty.
  const bossFiles = [...valid.entries()].filter(([, v]) => v.schema === 'boss');
  const invalidBoss = walk(root).some((p) => /[\\/]bosses[\\/]/.test(p) && !valid.has(relative(root, p).replaceAll('\\', '/')));
  if (enemyTable && params && !invalidBoss) {
    const where = bossFiles.length === 1 ? bossFiles[0]![1].file : 'content/bosses';
    out.push(...loaderProblems(where, () => loadBossTable(bossFiles.map(([, v]) => v.value), enemyTable!, params.value.defaults)));
  }

  if (params) {
    const keys = Object.keys(params.value.defaults);
    for (const k of keys) if (!(k in params.value.notes)) out.push(`${params.file} notes：參數「${k}」沒有來源說明（DOC、ASSUME 等）`);
    for (const k of Object.keys(params.value.notes)) if (!keys.includes(k)) out.push(`${params.file} notes：「${k}」不是 defaults 中的參數`);
  }

  // A chapter's id names its map folder and its file; three spellings of one name must not drift apart.
  for (const [rel, v] of valid) {
    if (v.schema !== 'chapter') continue;
    const stem = rel.replace(/^chapters\//, '').replace(/\.json$/, '');
    const { id } = v.value as ContentTypes['chapter'];
    if (id !== stem) out.push(`${v.file}：id「${id}」必須與檔名「${stem}」相同`);
  }

  // A deck belongs to one chapter: same id in the file name, and a chapter file that exists.
  for (const [rel, v] of valid) {
    if (v.schema !== 'deck') continue;
    const stem = rel.replace(/^decks\//, '').replace(/\.json$/, '');
    const { chapter } = v.value as ContentTypes['deck'];
    if (chapter !== stem) out.push(`${v.file}：chapter「${chapter}」必須與檔名「${stem}」相同`);
    else if (!existsSync(join(contentDir, 'chapters', `${chapter}.json`))) out.push(`${v.file}：章節「${chapter}」沒有對應的 content/chapters/${chapter}.json`);
  }

  // A speaker is shown under a name tag whose text is a string; the CSV check cannot supply a missing one.
  const speakers = get<'speakers'>('speakers.json');
  if (speakers) {
    for (const id of Object.keys(speakers.value.speakers)) {
      if (!/^[a-z][a-z0-9-]*$/.test(id)) out.push(`${speakers.file}：說話者代號「${id}」只能用小寫英文、數字與連字號，且以英文字母開頭`);
      if (id === OPERATOR_SPEAKER) out.push(`${speakers.file}：「${id}」是玩家回覆專用的代號，不能登記成說話者`);
      for (const [, s] of strings) {
        const stringsFile = s.value as ContentTypes['strings'];
        if (!stringsFile.strings[`speaker.${id}`]) out.push(`${speakers.file}：說話者「${id}」在 ${s.file} 沒有名牌文字，請新增「speaker.${id}」`);
      }
    }
  }

  const cards = get<'scheduleCards'>('cards/schedule.json');
  if (cards) {
    const seen = new Set<string>();
    for (const c of cards.value.cards) {
      if (seen.has(c.id)) out.push(`${cards.file}：日程卡 id「${c.id}」重複`);
      seen.add(c.id);
    }
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? join(ROOT, 'content');
  const problems = checkContent(dir);
  for (const p of problems) console.log(p);
  console.log(`content check: ${problems.length} problem(s) in ${relative(process.cwd(), resolve(dir)) || '.'}`);
  process.exit(problems.length ? 1 : 0);
}
