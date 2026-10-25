import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DIALOGUE_COLUMNS } from '../../src/core/dialogue/lines.ts';
import { checkDialogue } from '../../tools/check-dialogue.ts';

const H = DIALOGUE_COLUMNS.join(',');
/** A CSV row; no cell here holds a comma. */
const row = (id: string, order: number | string, speaker: string, expression: string, text: string, condition = '', effect = '', next = '', fact = '') =>
  [id, order, speaker, expression, text, condition, effect, next, fact].join(',');
const csv = (...rows: string[]) => `${H}\n${rows.join('\n')}\n`;

const root = mkdtempSync(join(tmpdir(), 'dialogue-check-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;

interface Setup {
  readonly handbook?: readonly string[];
  readonly speakers?: unknown;
  readonly portraits?: readonly string[];
  readonly release?: boolean;
}

/** Builds a content folder from the real dictionary and speaker registry, then checks it. */
function build(files: Record<string, string>, setup: Setup = {}) {
  const dir = join(root, `c${n++}`);
  const contentDir = join(dir, 'content');
  const portraitDir = join(dir, 'portraits');
  mkdirSync(join(contentDir, 'dialogue'), { recursive: true });
  mkdirSync(portraitDir);
  cpSync('content/tags.json', join(contentDir, 'tags.json'));
  if (setup.speakers === undefined) cpSync('content/speakers.json', join(contentDir, 'speakers.json'));
  else writeFileSync(join(contentDir, 'speakers.json'), JSON.stringify(setup.speakers));
  if (setup.handbook) writeFileSync(join(contentDir, 'handbook.json'), JSON.stringify({ pages: setup.handbook.map((id) => ({ id })) }));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(contentDir, 'dialogue', name), text);
  for (const p of setup.portraits ?? ['portrait-brain-normal.png', 'portrait-liver-memo.png']) writeFileSync(join(portraitDir, p), '');
  return { dir, contentDir, portraitDir, check: () => checkDialogue({ contentDir, portraitDir, ...(setup.release ? { release: true } : {}) }) };
}

const run = (text: string, setup?: Setup) => build({ 'a.csv': text }, setup).check();
const said = (found: string[], part: string) => expect(found, part).toEqual([expect.stringContaining(part)]);

describe('dialogue check: reader problems in words', () => {
  it('accepts a conversation with replies, effects and an unlock', () => {
    const text = csv(
      row('x', 1, 'brain', 'normal', '今天要開會。', '', 'clock:5'),
      row('x', 2, 'operator', '', '好', '', 'tag:deadline'),
      row('x', 3, 'operator', '', '不要', '', 'tag:stress+1;unlock:caffeine'),
      row('x', 4, 'brain', 'normal', '那就散會。'),
    );
    expect(run(text, { handbook: ['caffeine'] })).toEqual([]);
  });

  it.each<[string, string, string]>([
    ['a wrong header', 'dialogueId,order\nx,1\n', '表頭必須依序是'],
    ['a stray comma', csv(row('x', 1, 'brain', 'normal', '好,的')), '有 10 欄，應為 9 欄'],
    ['an empty id', csv(row('', 1, 'brain', 'normal', '好')), 'dialogueId 是空的'],
    ['a zero order', csv(row('x', 0, 'brain', 'normal', '好')), 'order 必須是從 1 開始的整數，目前是「0」'],
    ['a repeated order', csv(row('x', 1, 'brain', 'normal', '好'), row('x', 1, 'brain', 'normal', '壞')), '同一段對話裡 order 不能重複'],
    ['an empty speaker', csv(row('x', 1, '', 'normal', '好')), 'speaker 是空的'],
    ['an empty expression', csv(row('x', 1, 'brain', '', '好')), 'expression 是空的'],
    ['an empty text', csv(row('x', 1, 'brain', 'normal', '')), 'text 是空的'],
    ['a condition naming no tag', csv(row('x', 1, 'brain', 'normal', '好', 'nope>1')), 'condition「nope>1」有誤'],
    ['an effect it cannot read', csv(row('x', 1, 'brain', 'normal', '好', '', 'dance')), 'effect「dance」看不懂'],
    ['an effect on an unknown tag', csv(row('x', 1, 'brain', 'normal', '好', '', 'tag:nope')), '標籤「nope」不在狀態標籤字典'],
    ['an effect on a tag only cards set', csv(row('x', 1, 'brain', 'normal', '好', '', 'tag:caffeine=5')), '標籤「caffeine」不是故事事件或章節設定的標籤'],
    ['an effect in the wrong form', csv(row('x', 1, 'brain', 'normal', '好', '', 'tag:deadline=1')), '寫法和標籤型別不符'],
    ['a clock effect without minutes', csv(row('x', 1, 'brain', 'normal', '好', '', 'clock:abc')), 'clock: 後面必須是分鐘數'],
    ['a next that is no order', csv(row('x', 1, 'brain', 'normal', '好', '', '', 'soon')), 'next「soon」必須是'],
    ['a next to nowhere', csv(row('x', 1, 'brain', 'normal', '好', '', '', '9')), 'next 指向 order 9，這段對話沒有那一列'],
    ['a next that goes back', csv(row('x', 1, 'brain', 'normal', '好'), row('x', 2, 'brain', 'normal', '壞', '', '', '1')), '只能指向比自己大的 order'],
    ['a fact marker it does not know', csv(row('x', 1, 'brain', 'normal', '好', '', '', '', 'maybe')), 'fact「maybe」必須是'],
  ])('%s', (_name, text, part) => {
    expect(run(text)).toEqual(expect.arrayContaining([expect.stringContaining(part)]));
  });

  it('a next into the middle of a run of replies', () => {
    const text = csv(
      row('x', 1, 'brain', 'normal', '選吧', '', '', '4'),
      row('x', 2, 'brain', 'normal', '略過'),
      row('x', 3, 'operator', '', '好'),
      row('x', 4, 'operator', '', '不'),
    );
    expect(run(text)).toEqual(expect.arrayContaining([expect.stringContaining('那是一組玩家回覆的中間')]));
  });

  it('a lone reply and a line nothing leads to', () => {
    said(run(csv(row('x', 1, 'brain', 'normal', '選吧'), row('x', 2, 'operator', '', '好'))), '必須是 2 到 3 列，這一組有 1 列');
    said(run(csv(row('x', 1, 'brain', 'normal', '好', '', '', 'end'), row('x', 2, 'brain', 'normal', '多餘'))), '這一列不論標籤是什麼都走不到');
  });

  it('a conversation id used by two files', () => {
    const found = build({ 'a.csv': csv(row('x', 1, 'brain', 'normal', '好')), 'b.csv': csv(row('x', 1, 'brain', 'normal', '壞')) }).check();
    said(found, '已經在');
    expect(found[0]).toContain('b.csv');
  });

  it('names the file, the row, the conversation and the order', () => {
    const found = run(csv(row('x', 1, 'brain', 'normal', '好'), row('x', 2, 'brain', 'normal', '壞', '', 'dance')));
    expect(found).toEqual([expect.stringMatching(/a\.csv 第 3 列（x，order 2）：/)]);
  });
});

describe('dialogue check: speakers and portraits', () => {
  it('a speaker that is not registered is said once per file, however many lines it has', () => {
    const found = run(csv(row('x', 1, 'ghost', 'normal', '一'), row('x', 2, 'ghost', 'normal', '二'), row('y', 1, 'ghost', 'normal', '三')));
    said(found, 'speaker「ghost」沒有登記在 content/speakers.json');
  });

  it('the same unknown speaker in a second file is said again there', () => {
    const found = build({ 'a.csv': csv(row('x', 1, 'ghost', 'normal', '一')), 'b.csv': csv(row('y', 1, 'ghost', 'normal', '二')) }).check();
    expect(found).toHaveLength(2);
  });

  it('the operator needs no registration and no expression', () => {
    expect(run(csv(row('x', 1, 'brain', 'normal', '選吧'), row('x', 2, 'operator', '', '好'), row('x', 3, 'operator', '', '不')))).toEqual([]);
  });

  it('an entry named operator in the registry does not turn replies into spoken lines', () => {
    const speakers = { version: 1, speakers: { operator: { style: 'box', portrait: true }, brain: { style: 'box', portrait: true } } };
    const text = csv(row('x', 1, 'brain', 'normal', '選吧'), row('x', 2, 'operator', '', '好'), row('x', 3, 'operator', '', '不'));
    expect(run(text, { speakers })).toEqual([]);
  });

  it('a registered speaker with a portrait needs that expression on disk', () => {
    const found = run(csv(row('x', 1, 'brain', 'surprised', '什麼')));
    said(found, 'expression「surprised」沒有立繪');
    expect(found[0]).toContain('portrait-brain-surprised.png');
    expect(run(csv(row('x', 1, 'brain', 'surprised', '什麼')), { portraits: ['portrait-brain-surprised.png'] })).toEqual([]);
  });

  it('a speaker registered without portraits is not asked for one', () => {
    const speakers = { version: 1, speakers: { clerk: { style: 'box', portrait: false } } };
    expect(run(csv(row('x', 1, 'clerk', 'smile', '您好')), { speakers, portraits: [] })).toEqual([]);
  });

  it('a missing or malformed registry is said, not skipped', () => {
    said(run(csv(row('x', 1, 'brain', 'normal', '好')), { speakers: { version: 2 } }).slice(0, 1), '格式不符');
    const s = build({ 'a.csv': csv(row('x', 1, 'brain', 'normal', '好')) });
    rmSync(join(s.contentDir, 'speakers.json'));
    expect(s.check()[0]).toContain('找不到說話者登錄檔');
  });
});

describe('dialogue check: text must fit', () => {
  const box = (len: number) => run(csv(row('x', 1, 'brain', 'normal', '一'.repeat(len))));
  const reply = (len: number) => run(csv(row('x', 1, 'brain', 'normal', '選吧'), row('x', 2, 'operator', '', '一'.repeat(len)), row('x', 3, 'operator', '', '好')));
  const memo = (len: number) => run(csv(row('x', 1, 'liver', 'memo', '一'.repeat(len))));

  it('the dialogue box holds 3 lines of 30 characters', () => {
    expect(box(90)).toEqual([]);
    said(box(91), '對話框放不下：字級 100% 時要 4 行，上限 3 行');
  });

  it('a reply holds 2 lines, fewer characters at the larger text size', () => {
    expect(reply(28)).toEqual([]);
    said(reply(29), '玩家回覆的便利貼放不下：字級 125% 時要 3 行，上限 2 行');
    said(reply(35), '字級 100% 時要 3 行');
  });

  it("the liver's note holds 3 short lines, fewer characters at the larger text size", () => {
    expect(memo(30)).toEqual([]);
    said(memo(31), '肝的便利貼放不下：字級 125% 時要 4 行，上限 3 行');
  });

  it('breaks lines by the same rules as the game: a closing mark does not start a line', () => {
    // 29 characters then a full stop: the stop cannot start line 2, so the last character goes down with it.
    expect(run(csv(row('x', 1, 'brain', 'normal', '一'.repeat(29) + '。' + '一'.repeat(60))))).toEqual([]);
    said(run(csv(row('x', 1, 'brain', 'normal', '一'.repeat(29) + '。' + '一'.repeat(62)))), '要 4 行');
  });
});

describe('dialogue check: handbook and release', () => {
  it('an unlock names a handbook page that exists', () => {
    const text = csv(row('x', 1, 'brain', 'normal', '看這頁', '', 'unlock:caffeine'));
    said(run(text), 'unlock:caffeine 不存在於手冊頁');
    expect(run(text, { handbook: ['caffeine'] })).toEqual([]);
  });

  it('a pending fact passes the everyday check and fails the release check', () => {
    const text = csv(row('x', 1, 'brain', 'normal', '咖啡因半衰期約五小時。', '', '', '', 'pending:7'));
    expect(run(text)).toEqual([]);
    said(run(text, { release: true }), 'fact 還是 pending:7');
  });

  it('checked, general and empty facts pass the release check', () => {
    const text = csv(row('x', 1, 'brain', 'normal', '一', '', '', '', '22'), row('x', 2, 'brain', 'normal', '二', '', '', '', 'general'), row('x', 3, 'brain', 'normal', '三'));
    expect(run(text, { release: true })).toEqual([]);
  });
});

describe('dialogue check: the command', () => {
  const cli = (...args: string[]) => spawnSync(process.execPath, ['tools/check-dialogue.ts', ...args], { encoding: 'utf8' });

  it('passes on the shipped content, in both modes', () => {
    for (const args of [[], ['--release']]) {
      const r = cli(...args);
      expect(r.stdout, args.join(' ')).toContain('0 problem(s)');
      expect(r.status, args.join(' ')).toBe(0);
    }
  });

  it('fails with the problem on stdout, and --release is what makes a pending fact fail', () => {
    const s = build({ 'a.csv': csv(row('x', 1, 'brain', 'normal', '好', '', '', '', 'pending:3')) });
    expect(cli(s.contentDir).status).toBe(0);
    const r = cli(s.contentDir, '--release');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('fact 還是 pending:3');
    expect(r.stdout).toContain('dialogue check (release): 1 problem(s)');
  });
});
