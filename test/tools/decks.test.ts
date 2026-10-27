import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { checkContent } from '../../tools/check-content.ts';
import { checkDecks } from '../../tools/check-decks.ts';
import { CARD, TEXT_SCALES } from '../../src/view/text/styles.ts';

const root = mkdtempSync(join(tmpdir(), 'deck-check-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;

/** A copy of content/ with one JSON file changed by `fn`. */
function contentWith(file: string, fn: (j: Record<string, any>) => void): string {
  const dir = join(root, `c${n++}`);
  cpSync('content', dir, { recursive: true });
  const p = join(dir, file);
  const j = JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, '')) as Record<string, any>;
  fn(j);
  writeFileSync(p, JSON.stringify(j, null, 2));
  return dir;
}

const problems = (dir: string) => checkDecks({ contentDir: dir }).problems;

describe('deck check (build plan P1)', () => {
  it('passes on the shipped deck and logs every combination and the spread', () => {
    const r = checkDecks();
    expect(r.problems).toEqual([]);
    // Six greybox combinations, four liver ones, and the prologue's one: no opening cards.
    expect(r.report.filter((l) => l.startsWith('  ') && l.includes('敵人'))).toHaveLength(11);
    expect(r.report).toContainEqual(expect.stringMatching(/^ {2}（沒有章首卡）：敵人 3/));
    expect(r.report).toContainEqual(expect.stringMatching(/^ {4}morning_coffee：drink \d+\.\d\d，skip \d+\.\d\d$/));
    expect(r.report).toContainEqual(expect.stringMatching(/咖啡因斗篷下平均看得見 47%/));
    expect(r.report.at(-1)).toMatch(/最差組合比最好組合難 \d+%.*目標約 30%/);
  });

  it('a rescue needs its own title and the panel lines every rescue shares', () => {
    const own = contentWith('strings/zh-TW.json', (j) => { delete j['strings']['rescue.akai.title']; });
    expect(checkContent(own)).toEqual([expect.stringContaining('zh-TW.json 缺少文字「rescue.akai.title」')]);
    const shared = contentWith('strings/zh-TW.json', (j) => { delete j['strings']['rescue.hint']; });
    expect(checkContent(shared)).toEqual([expect.stringContaining('zh-TW.json 缺少共用文字「rescue.hint」')]);
  });

  it('a card string that is missing is named with its key', () => {
    const dir = contentWith('strings/zh-TW.json', (j) => { delete j['strings']['deck.greybox.bedtime.at_01.note']; });
    expect(problems(dir)).toEqual([expect.stringContaining('沒有「deck.greybox.bedtime.at_01.note」（選項說明）')]);
  });

  it('a card title too long for its lines at the larger text size is refused', () => {
    const dir = contentWith('strings/zh-TW.json', (j) => { j['strings']['deck.greybox.bedtime.title'].text = '昨'.repeat(70); });
    expect(problems(dir)).toEqual([expect.stringMatching(/「deck\.greybox\.bedtime\.title」：卡片的題目放不下，字級 \d+% 時要 \d 行，上限 2 行/)]);
  });

  it('a card title is measured with the widest host name, so one that fits only 小晨 is refused', () => {
    // Full-width characters a card title holds at the tighter text size.
    const room = Math.min(...TEXT_SCALES.map((s) => Math.floor(CARD.title.maxWidth(s) / (CARD.title.fontSize * s)) * CARD.title.maxLines));
    const named = contentWith('strings/zh-TW.json', (j) => { j['strings']['deck.greybox.bedtime.title'].text = '小晨' + '昨'.repeat(room - 2); });
    expect(problems(named)).toEqual([]);
    const host = contentWith('strings/zh-TW.json', (j) => { j['strings']['deck.greybox.bedtime.title'].text = '{host}' + '昨'.repeat(room - 2); });
    expect(problems(host)).toEqual([expect.stringMatching(/「deck\.greybox\.bedtime\.title」：卡片的題目放不下/)]);
  });

  it('an effect the reader does not understand is explained', () => {
    const dir = contentWith('decks/greybox.json', (j) => { j['opening'][0].options[1].effect = 'sleep_debt=2'; });
    expect(problems(dir)).toEqual([expect.stringContaining('章首卡「bedtime」的選項「at_01」：effect「sleep_debt=2」看不懂')]);
  });

  it('an event card setting a card-only tag is refused with the rule', () => {
    const dir = contentWith('decks/greybox.json', (j) => { j['events'][0].options[0].effect = 'tag:caffeine=50'; });
    expect(problems(dir)).toEqual([expect.stringContaining('事件卡只能設定 sources 含 event 的標籤')]);
  });

  it('a card that unlocks a handbook page must name a page that exists', () => {
    const known = contentWith('decks/greybox.json', (j) => { j['events'][0].options[0].effect = 'unlock:caffeine'; });
    expect(problems(known)).toEqual([]);
    const unknown = contentWith('decks/greybox.json', (j) => { j['opening'][0].options[1].effect = 'unlock:nope'; });
    expect(problems(unknown)).toEqual([expect.stringContaining('選項「at_01」：effect 的 unlock:nope 不存在於手冊頁')]);
  });

  it('check-content: the deck must be named after its chapter, and the chapter file must exist', () => {
    const wrong = contentWith('decks/greybox.json', (j) => { j['chapter'] = 'brain'; });
    expect(checkContent(wrong)).toEqual([expect.stringContaining('chapter「brain」必須與檔名「greybox」相同')]);
    const lonely = contentWith('decks/greybox.json', () => {});
    rmSync(join(lonely, 'chapters', 'greybox.json'));
    expect(checkContent(lonely)).toEqual(expect.arrayContaining([expect.stringContaining('沒有對應的 content/chapters/greybox.json')]));
  });

  it('reads JSON files saved with a byte order mark', () => {
    const dir = contentWith('decks/greybox.json', () => {});
    for (const f of ['tags.json', 'strings/zh-TW.json', 'decks/greybox.json', 'params.json']) {
      writeFileSync(join(dir, f), String.fromCharCode(0xfeff) + readFileSync(join(dir, f), 'utf8').replace(/^﻿/, ''));
    }
    expect(problems(dir)).toEqual([]);
  });

  it('the command exits 1 on a problem and 0 on the shipped content', () => {
    const run = (args: string[]) => spawnSync(process.execPath, ['tools/check-decks.ts', ...args], { encoding: 'utf8' });
    const bad = contentWith('decks/greybox.json', (j) => { j['events'][0].options[1].id = 'rewrite'; });
    const r = run([bad]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('同一張卡的選項 id 重複');
    expect(run([]).status).toBe(0);
  });
});
