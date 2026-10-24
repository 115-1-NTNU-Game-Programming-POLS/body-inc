/**
 * Content check (build plan S4, architecture section 7). Every JSON file under content/ must
 * match a schema in content/schema; a file no schema claims is itself a problem, so nothing
 * goes unchecked by accident. Files that pass their schema then go through the same loaders
 * the game uses, which check references between files. Schema messages are Chinese because
 * content authors read them on the pull request; loader messages are the loaders' own.
 *
 *   node tools/check-content.ts [contentDir]     exit 1 on any problem
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feedbackProblems, noteFields } from '../src/app/feedback.ts';
import type { ContentTypes, SchemaName, SchemaProblem } from '../src/core/index.ts';
import { DictionaryError, EnemyTableError, loadDictionary, loadEnemyTable, schemaProblems, type EnemyTable } from '../src/core/index.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Which schema checks which file, by path relative to the content folder. */
const RULES: ReadonlyArray<readonly [RegExp, SchemaName]> = [
  [/^tags\.json$/, 'tags'],
  [/^enemies\.json$/, 'enemies'],
  [/^feedback\.json$/, 'feedback'],
  [/^params\.json$/, 'params'],
  [/^strings\/[a-z]{2}(-[A-Z]{2})?\.json$/, 'strings'],
  [/^cards\/schedule\.json$/, 'scheduleCards'],
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
    if (e instanceof DictionaryError || e instanceof EnemyTableError) return e.problems.map((p) => `${file}：${p}`);
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
  if (params) {
    const keys = Object.keys(params.value.defaults);
    for (const k of keys) if (!(k in params.value.notes)) out.push(`${params.file} notes：參數「${k}」沒有來源說明（DOC、ASSUME 等）`);
    for (const k of Object.keys(params.value.notes)) if (!keys.includes(k)) out.push(`${params.file} notes：「${k}」不是 defaults 中的參數`);
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
