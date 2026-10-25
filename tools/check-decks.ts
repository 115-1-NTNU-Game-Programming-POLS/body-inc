/**
 * Deck check (build plan P1): content/decks/<chapter>.json read with the game's own reader, the
 * card text in content/strings, and the P1 completion rule that every combination of opening
 * cards gives a chapter that can be finished. It also prints the difficulty of each combination,
 * so the spread between the easiest and the hardest is on record in every CI run (design doc 4.2
 * aims at about 30%).
 *
 *   node tools/check-decks.ts [contentDir] [mapsDir]     exit 1 on any problem
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cardText, comboReports, loadBossTable, loadDialogueTable, loadEnemyTable, parseRoom, readContent, readDeck, roomsOf,
  CHAPTER_OPENS, optionPressure, worstSpread, type ChapterContent, type ComboReport, type Deck, type DeckProblem, type PlayProblem, type StringsFile,
  type TagDictionary, type TiledMap,
} from '../src/core/index.ts';
import { loadDictionary } from '../src/core/tags/dictionary.ts';
import { modelMeasure } from '../src/view/text/measure.ts';
import { CARD, TEXT_SCALES } from '../src/view/text/styles.ts';
import { wrapCJK } from '../src/view/text/wrap.ts';
import { schemaMessage } from './check-content.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Editors on Windows may save a BOM, which JSON.parse rejects. */
const readJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));

export interface DeckCheckOptions {
  readonly contentDir?: string;
  readonly mapsDir?: string;
}

export interface DeckCheck {
  readonly problems: string[];
  /** The difficulty table, one block per deck; informational, never a failure by itself. */
  readonly report: string[];
}

const EFFECT_FORMS = '可寫 tag:標籤、tag:標籤=數字、tag:標籤+數字、clock:分鐘 或 unlock:手冊頁代號，多個效果用分號隔開';

function deckMessage(file: string, p: DeckProblem): string {
  if (p.code === 'schema') return `${file} ${p.schema!.path || '（整個檔案）'}：${schemaMessage(p.schema!)}`;
  const at = `${file} ${p.section === 'opening' ? '章首卡' : '事件卡'}「${p.card}」${p.option ? `的選項「${p.option}」` : ''}`;
  const part = p.part ?? '';
  const tag = /^tag:([a-z0-9_.]+)/.exec(part)?.[1] ?? part;
  const who = p.section === 'opening' ? '章首卡只能設定 sources 含 card 的標籤' : '事件卡只能設定 sources 含 event 的標籤';
  switch (p.code) {
    case 'card-duplicate': return `${at}：卡片 id 重複；章首卡與事件卡共用一套 id，因為卡面文字以 id 為鍵`;
    case 'option-duplicate': return `${at}：同一張卡的選項 id 重複`;
    case 'effect':
      switch (p.effect) {
        case 'syntax': return `${at}：effect「${part}」看不懂；${EFFECT_FORMS}`;
        case 'unknown-tag': return `${at}：effect 的標籤「${tag}」不在狀態標籤字典（content/tags.json）中`;
        case 'alias': return `${at}：effect 的「${tag}」是修飾器，由標籤條件算出來，不能直接設定`;
        case 'tag-source': return `${at}：effect 的標籤「${tag}」不能由這種卡設定；${who}`;
        case 'tag-form': return `${at}：effect「${part}」寫法和標籤型別不符：布林標籤寫 tag:${tag}，數值標籤寫 tag:${tag}=數字 或 tag:${tag}+數字`;
        case 'minutes': return `${at}：effect「${part}」的 clock: 後面必須是分鐘數，1 到 4 位數的整數`;
        default: return `${at}：effect「${part}」有誤`;
      }
  }
}

const comboName = (r: ComboReport) => r.picks.map((x) => `${x.card}=${x.option}`).join('，') || '（沒有章首卡）';

function playMessage(file: string, r: ComboReport, p: PlayProblem): string {
  const at = `${file} 組合「${comboName(r)}」`;
  switch (p.code) {
    case 'room': return `${at}：房間 ${p.room} 無法以這組標籤進入（${p.message}）`;
    case 'no-bed': return `${at}：這一章沒有任何 bedType 為 sleep 的床，章節無法結束`;
    case 'bed-never': return p.event
      ? `${at}：再選事件卡「${p.event.card}」的「${p.event.option}」後，等 24 小時也沒有一張睡覺床的 requires 成立，章節無法結束`
      : `${at}：等 24 小時也沒有一張睡覺床的 requires 成立，章節無法結束`;
  }
}

/** Lines the text takes at a text size, with the width model that needs no canvas. */
const linesAt = (text: string, preset: { fontSize: number; maxWidth(scale: number): number }, scale: number): number =>
  wrapCJK(text, preset.maxWidth(scale), modelMeasure(preset.fontSize * scale)).length;

function textProblems(file: string, deck: Deck, strings: StringsFile, stringsFile: string): string[] {
  const out: string[] = [];
  const cards = [...deck.opening, ...deck.events.values()];
  const need = (key: string, preset: (typeof CARD)['title'], what: string) => {
    const s = strings.strings[key];
    if (!s) { out.push(`${file}：${stringsFile} 沒有「${key}」（${what}）`); return; }
    for (const scale of TEXT_SCALES) {
      const n = linesAt(s.text, preset, scale);
      if (n > preset.maxLines) { out.push(`${stringsFile}「${key}」：${what}放不下，字級 ${scale * 100}% 時要 ${n} 行，上限 ${preset.maxLines} 行；請縮短`); return; }
    }
  };
  for (const c of cards) {
    const t = cardText(deck.chapter, c.id);
    need(t.title, CARD.title, '卡片的題目');
    for (const o of c.options) {
      need(t.option(o.id), CARD.label, '選項名稱');
      need(t.note(o.id), CARD.note, '選項說明');
    }
  }
  return out;
}

/** Everything a chapter needs to start in Node, read the way the game reads it. */
function chapterContent(contentDir: string, mapsDir: string, dict: TagDictionary, chapterId: string, deck: Deck): ChapterContent | string {
  const chapterFile = join(contentDir, 'chapters', `${chapterId}.json`);
  if (!existsSync(chapterFile)) return `content/chapters/${chapterId}.json 不存在`;
  try {
    const chapter = readContent('chapter', readJson(chapterFile));
    const params = readContent('params', readJson(join(contentDir, 'params.json'))).defaults;
    const enemies = loadEnemyTable(readJson(join(contentDir, 'enemies.json')));
    const bossDir = join(contentDir, 'bosses');
    const bossFiles = existsSync(bossDir) ? readdirSync(bossDir).filter((n) => n.endsWith('.json')).map((n) => readJson(join(bossDir, n))) : [];
    const dialogueDir = join(contentDir, 'dialogue');
    const dialogueFiles = existsSync(dialogueDir)
      ? readdirSync(dialogueDir).filter((n) => n.endsWith('.csv')).sort().map((n) => ({ file: n, text: readFileSync(join(dialogueDir, n), 'utf8') }))
      : [];
    const rooms = new Map(roomsOf(chapter).map((path) => [path, parseRoom(path, readJson(join(mapsDir, `${path}.tmj`)) as TiledMap, dict)] as const));
    return {
      chapter, rooms, dict, enemies, params, deck,
      bosses: loadBossTable(bossFiles, enemies, params),
      dialogues: loadDialogueTable(dialogueFiles, dict),
    };
  } catch (e) {
    return `章節內容讀不進來，請先修正其他檢查回報的問題（${e instanceof Error ? e.message.split('\n')[0] : String(e)}）`;
  }
}

export function checkDecks(opts: DeckCheckOptions = {}): DeckCheck {
  const contentDir = resolve(opts.contentDir ?? join(ROOT, 'content'));
  const mapsDir = resolve(opts.mapsDir ?? join(ROOT, 'public', 'assets', 'maps'));
  const here = (p: string) => relative(process.cwd(), p).replaceAll('\\', '/');
  const problems: string[] = [];
  const report: string[] = [];
  const deckDir = join(contentDir, 'decks');
  if (!existsSync(deckDir)) return { problems, report };

  let dict: TagDictionary;
  let strings: StringsFile;
  const stringsPath = join(contentDir, 'strings', 'zh-TW.json');
  try {
    dict = loadDictionary(readJson(join(contentDir, 'tags.json')));
    strings = readContent('strings', readJson(stringsPath));
  } catch {
    return { problems: [`${here(deckDir)}：讀不到可用的標籤字典或字串表，請先修正 node tools/check-content.ts 回報的問題`], report };
  }

  for (const name of readdirSync(deckDir).filter((n) => n.endsWith('.json')).sort()) {
    const file = here(join(deckDir, name));
    let raw: unknown;
    try {
      raw = readJson(join(deckDir, name));
    } catch (e) {
      problems.push(`${file}：不是有效的 JSON（${(e as Error).message}）`);
      continue;
    }
    const read = readDeck(raw, dict);
    problems.push(...read.problems.map((p) => deckMessage(file, p)));
    if (!read.deck) continue;
    const deck = read.deck;
    problems.push(...textProblems(file, deck, strings, here(stringsPath)));

    const ctx = chapterContent(contentDir, mapsDir, dict, deck.chapter, deck);
    if (typeof ctx === 'string') { problems.push(`${file}：${ctx}`); continue; }
    const reports = comboReports(ctx, deck, CHAPTER_OPENS);
    for (const r of reports) for (const p of r.problems) problems.push(playMessage(file, r, p));

    report.push(`${file}：${reports.length} 種章首卡組合`);
    for (const r of reports) {
      const bed = r.bedAfter === undefined ? '無法上床' : `${Math.floor(r.bedAfter / 60)} 小時 ${r.bedAfter % 60} 分後可上床`;
      const sight = r.clinging > 0 && r.sight < 1 ? `，咖啡因斗篷下平均看得見 ${(r.sight * 100).toFixed(0)}%` : '';
      report.push(`  ${comboName(r)}：敵人 ${r.enemies}（會黏人的 ${r.clinging}${sight}），P ${r.p.toFixed(3)}，壓力 ${r.pressure.toFixed(2)}，${bed}`);
    }
    report.push('  各選項的影響（含該選項的組合平均壓力）：');
    for (const card of deck.opening) {
      const row = optionPressure(deck, reports).filter((o) => o.card === card.id).map((o) => `${o.option} ${Number.isNaN(o.pressure) ? '無可玩組合' : o.pressure.toFixed(2)}`);
      report.push(`    ${card.id}：${row.join('，')}`);
    }
    const ok = reports.filter((r) => r.problems.length === 0).sort((a, b) => a.pressure - b.pressure);
    const [best, worst] = [ok[0], ok.at(-1)];
    const ends = best && worst ? `（最難 ${comboName(worst)}，最易 ${comboName(best)}）` : '';
    report.push(`  最差組合比最好組合難 ${(worstSpread(reports) * 100).toFixed(0)}%${ends}；設計文件 4.2 的目標約 30%`);
  }
  return { problems, report };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [contentDir, mapsDir] = process.argv.slice(2);
  const { problems, report } = checkDecks({ ...(contentDir ? { contentDir } : {}), ...(mapsDir ? { mapsDir } : {}) });
  for (const line of report) console.log(line);
  for (const p of problems) console.log(p);
  console.log(`deck check: ${problems.length} problem(s) in ${relative(process.cwd(), resolve(contentDir ?? join(ROOT, 'content'), 'decks')) || '.'}`);
  process.exit(problems.length ? 1 : 0);
}
