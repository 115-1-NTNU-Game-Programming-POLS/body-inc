/**
 * Dialogue check (build plan P5). Reads content/dialogue/*.csv through the reader the game
 * uses, so a file this check accepts is a file the game can play, then checks what only the
 * authored content can show: that every speaker is registered, every portrait exists, every
 * text fits its box, and every unlocked handbook page exists. Messages are Chinese because
 * content authors read them on the pull request.
 *
 *   node tools/check-dialogue.ts [contentDir] [--release]     exit 1 on any problem
 *
 * --release also fails any line whose fact column is still pending:<n>, the release gate of
 * build plan P5. Fact markers in content/strings are the string table's own business.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ContentTypes, DialogueFile, DialogueProblem, Line } from '../src/core/index.ts';
import { DIALOGUE_COLUMNS, DictionaryError, OPERATOR_SPEAKER, loadDictionary, readDialogues, schemaProblems } from '../src/core/index.ts';
import { modelMeasure } from '../src/view/text/measure.ts';
import { DIALOGUE, MEMO, REPLY, TEXT_SCALES } from '../src/view/text/styles.ts';
import { wrapCJK } from '../src/view/text/wrap.ts';
import { conditionMessage } from './check-maps.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export interface DialogueCheckOptions {
  readonly contentDir?: string;
  readonly portraitDir?: string;
  readonly release?: boolean;
}

type Speakers = ContentTypes['speakers']['speakers'];

const EFFECT_FORMS = '可寫 tag:標籤、tag:標籤=數字、tag:標籤+數字、clock:分鐘 或 unlock:手冊頁代號，多個效果用分號隔開';

function effectMessage(p: DialogueProblem): string {
  const part = p.detail ?? '';
  const tag = /^tag:([a-z0-9_.]+)/.exec(part)?.[1] ?? part;
  switch (p.effect) {
    case 'syntax': return `effect「${part}」看不懂；${EFFECT_FORMS}`;
    case 'unknown-tag': return `effect 的標籤「${tag}」不在狀態標籤字典（content/tags.json）中`;
    case 'alias': return `effect 的「${tag}」是修飾器，由標籤條件算出來，不能直接設定；請改設它所依據的標籤`;
    case 'tag-source': return `effect 的標籤「${tag}」不是故事事件或章節設定的標籤，對話不能改它；字典裡它的 sources 要包含 event 或 chapter`;
    case 'tag-form': return `effect「${part}」寫法和標籤型別不符：布林標籤寫 tag:${tag}，數值標籤寫 tag:${tag}=數字 或 tag:${tag}+數字`;
    case 'minutes': return `effect「${part}」的 clock: 後面必須是分鐘數，1 到 4 位數的整數，例如 clock:10`;
    default: return `effect「${part}」有誤`;
  }
}

/** One reader problem in words, with the file, row and conversation that locate it. */
export function dialogueMessage(p: DialogueProblem): string {
  if (p.code === 'header') return `${p.file}：表頭必須依序是 ${DIALOGUE_COLUMNS.join(',')}，目前是 ${p.detail || '（空的）'}`;
  const who = [p.dialogueId, p.order !== undefined ? `order ${p.order}` : undefined].filter(Boolean).join('，');
  const at = `${p.file} 第 ${p.row} 列${who ? `（${who}）` : ''}`;
  switch (p.code) {
    case 'columns': return `${at}：有 ${p.detail} 欄，應為 ${DIALOGUE_COLUMNS.length} 欄；台詞裡有逗號時整格要用雙引號包起來`;
    case 'id-empty': return `${at}：dialogueId 是空的`;
    case 'order': return `${at}：order 必須是從 1 開始的整數，目前是「${p.detail}」`;
    case 'order-duplicate': return `${at}：同一段對話裡 order 不能重複`;
    case 'speaker-empty': return `${at}：speaker 是空的`;
    case 'expression-empty': return `${at}：expression 是空的；只有玩家回覆（${OPERATOR_SPEAKER}）可以不填`;
    case 'text-empty': return `${at}：text 是空的`;
    case 'condition': return `${at}：condition「${p.detail}」有誤：${p.condition ? conditionMessage(p.condition) : ''}`;
    case 'effect': return `${at}：${effectMessage(p)}`;
    case 'next': return `${at}：next「${p.detail}」必須是某一列的 order，或 end`;
    case 'next-missing': return `${at}：next 指向 order ${p.detail}，這段對話沒有那一列`;
    case 'next-backward': return `${at}：next 指向 order ${p.detail}，只能指向比自己大的 order，否則對話可能繞圈`;
    case 'next-into-options': return `${at}：next 指向 order ${p.detail}，那是一組玩家回覆的中間；請指向這組回覆的第一列，或別處`;
    case 'fact': return `${at}：fact「${p.detail}」必須是空白、數字（事實查核表編號）、pending:數字 或 general`;
    case 'options-count': return `${at}：連續的玩家回覆（speaker 是 ${OPERATOR_SPEAKER}）必須是 2 到 3 列，這一組有 ${p.detail} 列`;
    case 'unreachable': return `${at}：這一列不論標籤是什麼都走不到；請檢查前面的 next 與 condition`;
    case 'duplicate-dialogue': return `${at}：dialogueId 已經在 ${p.detail} 用過，同一個 id 只能有一段對話`;
  }
}

/** Lines `text` takes at a text size, with the width model that needs no canvas. */
const linesAt = (text: string, preset: { fontSize: number; maxWidth(scale: number): number }, scale: number): number =>
  wrapCJK(text, preset.maxWidth(scale), modelMeasure(preset.fontSize * scale)).length;

function textProblem(l: Line, speaker: Speakers[string] | undefined): string | undefined {
  const reply = l.speaker === OPERATOR_SPEAKER;
  const preset = reply ? REPLY : speaker?.style === 'memo' ? MEMO : DIALOGUE;
  const what = reply ? '玩家回覆的便利貼' : speaker?.style === 'memo' ? '肝的便利貼' : '對話框';
  for (const scale of TEXT_SCALES) {
    const n = linesAt(l.text, preset, scale);
    if (n > preset.maxLines) {
      return `${what}放不下：字級 ${scale * 100}% 時要 ${n} 行，上限 ${preset.maxLines} 行，每行約 ${preset.maxEm} 個全形字；請縮短，或拆成兩列`;
    }
  }
  return undefined;
}

/** The parsed file, or undefined when it is not valid JSON; check-content reports the details. */
function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')) as unknown;
  } catch (e) {
    if (e instanceof SyntaxError) return undefined;
    throw e;
  }
}

export function checkDialogue(opts: DialogueCheckOptions = {}): string[] {
  const contentDir = resolve(opts.contentDir ?? join(ROOT, 'content'));
  const portraitDir = resolve(opts.portraitDir ?? join(ROOT, 'public', 'assets', 'portraits'));
  const here = (p: string) => relative(process.cwd(), p).replaceAll('\\', '/');
  const out: string[] = [];

  let dict: ReturnType<typeof loadDictionary>;
  try {
    dict = loadDictionary(JSON.parse(readFileSync(join(contentDir, 'tags.json'), 'utf8')));
  } catch (e) {
    if (e instanceof DictionaryError || e instanceof SyntaxError || (e as NodeJS.ErrnoException).code === 'ENOENT') {
      return [`${here(join(contentDir, 'tags.json'))}：讀不到可用的標籤字典，請先修正 node tools/check-content.ts 回報的問題`];
    }
    throw e;
  }

  const dialogueDir = join(contentDir, 'dialogue');
  const names = existsSync(dialogueDir) ? readdirSync(dialogueDir).filter((n) => n.endsWith('.csv')).sort() : [];
  const files: DialogueFile[] = names.map((n) => ({ file: here(join(dialogueDir, n)), text: readFileSync(join(dialogueDir, n), 'utf8') }));
  const { table, problems } = readDialogues(files, dict);
  out.push(...problems.map(dialogueMessage));

  const speakersFile = join(contentDir, 'speakers.json');
  let speakers: Speakers = {};
  if (!existsSync(speakersFile)) {
    out.push(`${here(speakersFile)}：找不到說話者登錄檔；對話裡的 speaker 都要登記在這裡`);
  } else {
    const value = readJson(speakersFile);
    if (value === undefined || schemaProblems('speakers', value).length > 0) out.push(`${here(speakersFile)}：格式不符，請先修正 node tools/check-content.ts 回報的問題`);
    else speakers = (value as ContentTypes['speakers']).speakers;
  }

  const handbookFile = join(contentDir, 'handbook.json');
  let handbook: { id: string }[] = [];
  if (existsSync(handbookFile)) {
    const value = readJson(handbookFile) as { pages?: { id: string }[] } | undefined;
    if (value === undefined) out.push(`${here(handbookFile)}：不是有效的 JSON，請先修正 node tools/check-content.ts 回報的問題`);
    else handbook = value.pages ?? [];
  }
  const pages = new Set(handbook.map((p) => p.id));

  // One message per unknown speaker per file: the rest of its lines are the same fix.
  const unknown = new Set<string>();
  for (const d of table.values()) {
    for (const l of d.lines) {
      const say = (m: string) => out.push(`${d.file} 第 ${l.row} 列（${d.id}，order ${l.order}）：${m}`);
      const speaker = l.speaker === OPERATOR_SPEAKER ? undefined : speakers[l.speaker];
      if (l.speaker !== OPERATOR_SPEAKER && !speaker) {
        if (!unknown.has(`${d.file}|${l.speaker}`)) say(`speaker「${l.speaker}」沒有登記在 content/speakers.json`);
        unknown.add(`${d.file}|${l.speaker}`);
        continue;
      }
      if (speaker?.portrait) {
        const png = join(portraitDir, `portrait-${l.speaker}-${l.expression}.png`);
        if (!existsSync(png)) say(`expression「${l.expression}」沒有立繪；缺少 ${here(png)}`);
      }
      const fit = textProblem(l, speaker);
      if (fit) say(fit);
      for (const fx of l.effects) if (fx.kind === 'unlock' && !pages.has(fx.id)) say(`effect 的 unlock:${fx.id} 不存在於手冊頁（content/handbook.json）`);
      if (opts.release && l.fact.startsWith('pending:')) say(`fact 還是 ${l.fact}，事實查核沒完成就不能發行；查核後請改成編號或 general`);
    }
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const release = args.includes('--release');
  const dir = args.find((a) => !a.startsWith('--')) ?? join(ROOT, 'content');
  const problems = checkDialogue({ contentDir: dir, release });
  for (const p of problems) console.log(p);
  console.log(`dialogue check${release ? ' (release)' : ''}: ${problems.length} problem(s) in ${relative(process.cwd(), resolve(dir, 'dialogue')) || '.'}`);
  process.exit(problems.length ? 1 : 0);
}
