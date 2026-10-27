import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  clockHour, composeReport, dayRange, fillTemplate, fnv1a, hhmm, mergeFacts, minuteOf, narrativeDay, nodeFacts, operationFacts, ordinal, periodOf, pickOne,
  placeFacts, readContent, renderGroup, reportProblems, runSemester, selectGroups, semesterInputs, semesterReports, wordAll, zhCount,
  type DayRecord, type FloorId, type ReportFact, type ReportFile, type ReportInput, type SemesterState, type SentenceGroup, type StringsFile,
} from '../../src/core/index.ts';
import { ARCHETYPES } from '../../sim/semester/archetypes.ts';
import { bingeTwice, bingeWeek, contextFor, crunchWeek } from '../../sim/semester/scenario.ts';

const readJson = (f: string): unknown => JSON.parse(readFileSync(`content/${f}`, 'utf8').replace(/^﻿/, ''));
const CFG: ReportFile = readContent('report', readJson('report.json'));
const STRINGS: StringsFile = readContent('strings', readJson('strings/zh-TW.json'));
const PAGES = new Set(readContent('handbook', readJson('handbook.json')).pages.map((p) => p.id));
const text = (k: string): string => {
  const s = STRINGS.strings[k];
  if (!s) throw new Error(`no string ${k}`);
  return s.text;
};
const ENV = { cfg: CFG, text, seed: 1 };

const DAY = 1440;
const WAKES = Array.from({ length: 10 }, () => 7);
/** Rule minute of an hour on a calendar day. */
const at = (day: number, hour: number): number => (day - 1) * DAY + Math.round(hour * 60);

describe('numerals and the narrative calendar (ux-spec 4.6)', () => {
  it('writes counts in Chinese numerals with 2 as 兩', () => {
    const table: [number, string][] = [
      [0, '零'], [1, '一'], [2, '兩'], [3, '三'], [9, '九'], [10, '十'], [11, '十一'], [12, '十二'], [20, '二十'], [21, '二十一'], [22, '二十二'], [99, '九十九'], [100, '100'],
    ];
    for (const [n, s] of table) expect(zhCount(n)).toBe(s);
    expect(() => zhCount(-1)).toThrow();
    expect(() => zhCount(1.5)).toThrow();
  });

  it('numbers the sentences 一 to 十 and keeps 二 as 二', () => {
    expect([1, 2, 5, 10].map(ordinal)).toEqual(['一', '二', '五', '十']);
    expect(() => ordinal(0)).toThrow();
    expect(() => ordinal(11)).toThrow();
  });

  it('puts a night before the next wake-up on the day that went to bed', () => {
    expect(narrativeDay(at(3, 7), WAKES)).toBe(3);
    expect(narrativeDay(at(3, 7) - 1, WAKES)).toBe(2);
    expect(narrativeDay(at(3, 25), WAKES)).toBe(3);
    expect(narrativeDay(at(3, 12), WAKES)).toBe(3);
    expect(narrativeDay(0, WAKES)).toBe(1);
  });

  it('follows the wake hour of each day, not a fixed one', () => {
    const late = [7, 7, 11, 7];
    expect(narrativeDay(at(3, 10), late)).toBe(2);
    expect(narrativeDay(at(3, 11), late)).toBe(3);
  });

  it('names the part of the day at the edges the spec gives', () => {
    const h = (hh: number, mm = 0): string => periodOf(hh * 60 + mm);
    expect([h(5), h(10, 59), h(11), h(13, 59), h(14), h(17, 59), h(18), h(22, 59), h(23), h(25)]).toEqual(
      ['morning', 'morning', 'noon', 'noon', 'afternoon', 'afternoon', 'evening', 'evening', 'night', 'night'],
    );
  });

  it('writes dates and clock hours the way the reports print them', () => {
    expect([dayRange(6, 6), dayRange(6, 8)]).toEqual(['第 6 天', '第 6 至 8 天']);
    expect([clockHour(at(1, 25) % DAY + DAY), clockHour(22 * 60 + 30)]).toEqual([1, 22]);
    expect([hhmm(22 * 60 + 30), hhmm(25 * 60), hhmm(7 * 60)]).toEqual(['22:30', '01:00', '07:00']);
  });
});

describe('merging facts (ux-spec 4.6)', () => {
  const fact = (key: string, day: number, hour = 12, extra: Partial<ReportFact> = {}): ReportFact => ({ key, at: at(day, hour), ...extra });
  const rules = { run: () => true, spread: () => true };
  const merged = (facts: ReportFact[], r = rules): SentenceGroup[] => mergeFacts(placeFacts(facts, WAKES), r);

  it('counts several on one day as one sentence for that day', () => {
    const [g, ...rest] = merged([fact('a', 3, 9), fact('a', 3, 21)]);
    expect(rest).toEqual([]);
    expect([g!.form, g!.members.length, g!.days]).toEqual(['single', 2, [3]]);
    expect(g!.at).toBe(at(3, 9));
  });

  it('joins consecutive days into a run and days apart into a spread, over the first and last day', () => {
    const [run] = merged([fact('a', 4), fact('a', 5), fact('a', 6)]);
    expect([run!.form, run!.firstDay, run!.lastDay, run!.days]).toEqual(['run', 4, 6, [4, 5, 6]]);
    const [spread] = merged([fact('a', 4), fact('a', 5), fact('a', 7)]);
    expect([spread!.form, spread!.firstDay, spread!.lastDay]).toEqual(['spread', 4, 7]);
  });

  it('keeps different keys and different scopes apart', () => {
    const groups = merged([fact('a', 4), fact('b', 4), fact('a', 5, 12, { scope: 'brain' }), fact('a', 5, 12, { scope: 'gut' })]);
    expect(groups.map((g) => `${g.key}/${g.scope ?? ''}/${g.form}`)).toEqual(['a//single', 'b//single', 'a/brain/single', 'a/gut/single']);
  });

  it('tells a key day by day when it has no wording for the merged form', () => {
    const groups = merged([fact('a', 4), fact('a', 5)], { run: () => false, spread: () => true });
    expect(groups.map((g) => [g.form, g.firstDay])).toEqual([['single', 4], ['single', 5]]);
    const apart = merged([fact('a', 4), fact('a', 7)], { run: () => true, spread: () => false });
    expect(apart.map((g) => g.form)).toEqual(['single', 'single']);
  });

  it('gives each day of a key told day by day only its own facts', () => {
    const groups = merged([fact('a', 4, 9), fact('a', 4, 21), fact('a', 5)], { run: () => false, spread: () => false });
    expect(groups.map((g) => [g.firstDay, g.members.length])).toEqual([[4, 2], [5, 1]]);
  });

  it('orders groups that begin together by key, then by scope', () => {
    const groups = merged([fact('b', 4), fact('a', 4, 12, { scope: 'gut' }), fact('a', 4, 12, { scope: 'brain' })]);
    expect(groups.map((g) => `${g.key}/${g.scope ?? ''}`)).toEqual(['a/brain', 'a/gut', 'b/']);
  });

  it('reads facts handed over out of order: a group begins at its earliest fact and runs over the days in order', () => {
    const [g] = merged([fact('a', 6, 9), fact('a', 4, 21), fact('a', 5, 9)]);
    expect([g!.form, g!.firstDay, g!.lastDay, g!.days]).toEqual(['run', 4, 6, [4, 5, 6]]);
    expect(g!.at).toBe(at(4, 21));
    expect(g!.members.map((m) => m.day)).toEqual([4, 5, 6]);
  });

  it('sorts a group by its earliest member and flags a group with a parent', () => {
    const groups = merged([fact('late', 5, 8), fact('early', 4, 20), fact('early', 6, 8, { parent: true })]);
    expect(groups.map((g) => g.key)).toEqual(['early', 'late']);
    expect(groups[0]!.parent).toBe(true);
    expect(groups[1]!.parent).toBe(false);
  });

  it('places a fact after midnight on the day that went to bed', () => {
    const [g] = merged([fact('a', 3, 25.5)]);
    expect([g!.firstDay, g!.members[0]!.minute]).toEqual([3, 25 * 60 + 30]);
  });
});

describe('choosing the five (ux-spec 4.6)', () => {
  const group = (key: string, day: number, extra: { parent?: boolean; n?: number } = {}): SentenceGroup => {
    const members = Array.from({ length: extra.n ?? 1 }, () => ({ fact: { key, at: at(day, 12) }, day, minute: 12 * 60 }));
    return { key, form: 'single', members, days: [day], firstDay: day, lastDay: day, at: at(day, 12), parent: extra.parent ?? false };
  };
  const score: Record<string, number> = { choice: 5, warning: 4, tag: 3, external: 2, effect: 1 };
  const by = (g: SentenceGroup): number => score[g.key.split('.')[0]!]!;

  it('keeps the highest scores and puts them back in time order', () => {
    const groups = [
      group('effect.a', 1), group('tag.a', 2), group('choice.a', 3), group('external.a', 4), group('warning.a', 5), group('choice.b', 6), group('effect.b', 7),
    ];
    expect(selectGroups(groups, by).map((g) => g.key)).toEqual(['tag.a', 'choice.a', 'external.a', 'warning.a', 'choice.b']);
  });

  it('always keeps a parent of the crisis, whatever it scores', () => {
    const groups = [
      group('choice.a', 1), group('choice.b', 2), group('choice.c', 3), group('choice.d', 4), group('choice.e', 5), group('effect.parent', 6, { parent: true }),
    ];
    const kept = selectGroups(groups, by).map((g) => g.key);
    expect(kept).toContain('effect.parent');
    expect(kept).toHaveLength(5);
    expect(kept).not.toContain('choice.e');
  });

  it('prefers more facts, then the earlier one, among equal scores', () => {
    const groups = [group('choice.a', 3), group('choice.b', 2, { n: 2 }), group('choice.c', 1)];
    expect(selectGroups(groups, by, 2).map((g) => g.key)).toEqual(['choice.c', 'choice.b']);
  });

  it('keeps only the best parents when they alone are more than fit', () => {
    const parents = ['effect.a', 'choice.b', 'warning.c'].map((k, i) => group(k, i + 1, { parent: true }));
    expect(selectGroups(parents, by, 2).map((g) => g.key)).toEqual(['choice.b', 'warning.c']);
  });

  it('settles equal scores, counts and times by key, then by scope', () => {
    expect(selectGroups([group('choice.b', 3), group('choice.a', 3)], by, 1).map((g) => g.key)).toEqual(['choice.a']);
    const scoped = (scope: string): SentenceGroup => ({ ...group('choice.a', 3), scope });
    expect(selectGroups([scoped('gut'), scoped('brain')], by, 1).map((g) => g.scope)).toEqual(['brain']);
  });

  it('puts groups that begin together in rank order after choosing, a parent not first for being one', () => {
    const kept = selectGroups([group('effect.parent', 3, { parent: true }), group('choice.a', 3)], by);
    expect(kept.map((g) => g.key)).toEqual(['choice.a', 'effect.parent']);
  });
});

describe('wording a sentence (ux-spec 4.5)', () => {
  const T: Record<string, string> = {
    generic: '{D}|{dept}|{label}',
    s1: '{D}:{h}:{cups}:{dept}', s2: '{D}:{h}:{cups}:{dept}:B',
    r1: '{Dr}:{N}:{cups}:{low}', p1: '{Dr}:{N}:{cups}',
    q1: '{D}:{dept}',
    bad: '{D}:{zzz}',
    nodata: '{D}:{missing}',
    qs: '{D}:{sym}',
  };
  const mini: ReportFile = {
    ...CFG,
    fallback: 'generic',
    keys: {
      k: {
        score: 'choice', single: ['s1', 's2'], run: ['r1'], spread: ['p1'],
        vars: { cups: { agg: 'sum', numeral: 'zh' }, low: { agg: 'min' } },
      },
      per: { score: 'choice', period: true, single: ['q1'] },
      bad: { score: 'choice', single: ['bad'] },
      nodata: { score: 'choice', single: ['nodata'], vars: { missing: { agg: 'sum' } } },
      str: { score: 'choice', single: ['qs'], vars: { sym: { agg: 'max' } } },
    },
  };
  const env = (seed = 1) => ({ cfg: mini, text: (k: string): string => T[k] ?? text(k), seed });
  const groups = (facts: ReportFact[]): SentenceGroup[] => mergeFacts(placeFacts(facts, WAKES), { run: () => true, spread: () => true });
  const one = (f: ReportFact, prev?: SentenceGroup, seed = 1) => renderGroup(groups([f])[0]!, prev, env(seed));

  it('gives the first sentence its date in full, with the part of the day for a key that asks', () => {
    expect(one({ key: 'k', at: at(3, 22.5), vars: { cups: 1, low: 5 } }).text).toMatch(/^第 3 天:22:一:本公司/);
    expect(one({ key: 'per', at: at(3, 22.5) }).text).toBe('第 3 天晚間:本公司');
    expect(one({ key: 'per', at: at(3, 12) }).text).toBe('第 3 天中午:本公司');
  });

  it('writes the same day as 同日, or 當晚 once evening has come, then 隔天, then the date again', () => {
    const before = (day: number): SentenceGroup => groups([{ key: 'k', at: at(day, 9), vars: { cups: 1, low: 1 } }])[0]!;
    const say = (key: string, day: number, hour: number, prevDay: number): string => one({ key, at: at(day, hour) }, before(prevDay)).text;
    expect(say('per', 3, 12, 3)).toBe('同日中午:本公司');
    expect(say('per', 4, 12, 3)).toBe('隔天中午:本公司');
    expect(say('per', 5, 12, 3)).toBe('第 5 天中午:本公司');
    const k = (day: number, hour: number, prevDay: number): string => one({ key: 'k', at: at(day, hour), vars: { cups: 1, low: 1 } }, before(prevDay)).text;
    expect(k(3, 22, 3)).toMatch(/^當晚:/);
    expect(k(3, 25, 3)).toMatch(/^當晚:/);
    expect(k(3, 12, 3)).toMatch(/^同日:/);
    expect(k(4, 12, 3)).toMatch(/^隔天:/);
    expect(k(6, 12, 3)).toMatch(/^第 6 天:/);
  });

  it('names each part of the day, by the first fact of the group', () => {
    const part = (hour: number): string => one({ key: 'per', at: at(3, hour) }).text;
    expect([part(8), part(12), part(15), part(20), part(23.5), part(25)]).toEqual(
      ['第 3 天上午:本公司', '第 3 天中午:本公司', '第 3 天下午:本公司', '第 3 天晚間:本公司', '第 3 天深夜:本公司', '第 3 天深夜:本公司'],
    );
    const day = groups([{ key: 'per', at: at(3, 9) }, { key: 'per', at: at(3, 21) }])[0]!;
    expect(renderGroup(day, undefined, env()).text).toBe('第 3 天上午:本公司');
  });

  it('measures the same day and the next from the last day of the group before it', () => {
    const run = groups([3, 4, 5].map((d) => ({ key: 'k', at: at(d, 9), vars: { cups: 1, low: 1 } })))[0]!;
    expect(one({ key: 'per', at: at(5, 12) }, run).text).toBe('同日中午:本公司');
    expect(one({ key: 'per', at: at(6, 12) }, run).text).toBe('隔天中午:本公司');
    expect(one({ key: 'per', at: at(7, 12) }, run).text).toBe('第 7 天中午:本公司');
  });

  it('writes the hour a night event happened as the clock hour', () => {
    expect(one({ key: 'k', at: at(3, 25.5), vars: { cups: 1, low: 1 } }).text).toBe('第 3 天:1:一:本公司');
  });

  it('adds up a day, and writes a run and a spread over the first and last day', () => {
    const day = groups([{ key: 'k', at: at(3, 9), vars: { cups: 1, low: 8 } }, { key: 'k', at: at(3, 21), vars: { cups: 1, low: 6 } }])[0]!;
    expect(renderGroup(day, undefined, env()).text).toMatch(/^第 3 天:\d+:兩:/);
    const run = groups([3, 4, 5].map((d) => ({ key: 'k', at: at(d, 9), vars: { cups: 2, low: 10 - d } })))[0]!;
    expect(renderGroup(run, undefined, env()).text).toBe('第 3 至 5 天:三:六:5');
    const spread = groups([3, 5].map((d) => ({ key: 'k', at: at(d, 9), vars: { cups: 1, low: 1 } })))[0]!;
    expect(renderGroup(spread, undefined, env()).text).toBe('第 3 至 5 天:兩:兩');
  });

  it('counts the days of a run and the facts of a total, which are not the same number', () => {
    const facts = [3, 4, 4, 5].map((d, i) => ({ key: 'k', at: at(d, 9 + i), vars: { cups: 1, low: 5 } }));
    expect(renderGroup(groups(facts)[0]!, undefined, env()).text).toBe('第 3 至 5 天:三:四:5');
  });

  it('prints a number with at most two decimals', () => {
    const lowest = (lows: number[]): string => renderGroup(groups(lows.map((low, i) => ({ key: 'k', at: at(3 + i, 9), vars: { cups: 1, low } })))[0]!, undefined, env()).text;
    expect(lowest([1.234, 5])).toBe('第 3 至 4 天:兩:兩:1.23');
    expect(lowest([7.5, 9])).toBe('第 3 至 4 天:兩:兩:7.5');
  });

  it('takes a text var from the last fact of the group', () => {
    const two = groups([{ key: 'str', at: at(3, 9), vars: { sym: 'first' } }, { key: 'str', at: at(3, 21), vars: { sym: 'last' } }])[0]!;
    expect(renderGroup(two, undefined, env()).text).toBe('第 3 天:last');
  });

  it('refuses a form the key has no wording for', () => {
    const run = groups([3, 4].map((d) => ({ key: 'per', at: at(d, 9) })))[0]!;
    expect(run.form).toBe('run');
    expect(() => renderGroup(run, undefined, env())).toThrow(/has no run wording/);
  });

  it('picks among the variants by the seed, the same way every time, and uses each of them', () => {
    const f: ReportFact = { key: 'k', at: at(3, 9), vars: { cups: 1, low: 1 } };
    const texts = Array.from({ length: 40 }, (_, seed) => one(f, undefined, seed).text);
    expect(new Set(texts)).toEqual(new Set(['第 3 天:9:一:本公司', '第 3 天:9:一:本公司:B']));
    expect(one(f, undefined, 7).text).toBe(one(f, undefined, 7).text);
  });

  it('words a fact with no template by the fallback and says so', () => {
    const r = one({ key: 'tag:cold', at: at(4, 9), vars: { label: 'cold' } });
    expect(r).toEqual({ text: '第 4 天||cold'.replace('||', '|本公司|'), generic: true });
    expect(one({ key: 'k', at: at(4, 9), vars: { cups: 1, low: 1 } }).generic).toBe(false);
  });

  it('labels a fallback sentence by the key when the fact brings no label, and leaves an unknown department blank', () => {
    expect(one({ key: 'tag:cold', at: at(4, 9) }).text).toBe('第 4 天|本公司|tag:cold');
    expect(one({ key: 'tag:cold', scope: 'nowhere', at: at(4, 9) }).text).toBe('第 4 天||tag:cold');
  });

  it('names the department of a scoped fact', () => {
    expect(one({ key: 'per', scope: 'liver', at: at(3, 12) }).text).toBe('第 3 天中午:肝臟部門');
  });

  it('refuses a placeholder with no value and a sentence whose data is missing', () => {
    expect(() => one({ key: 'bad', at: at(3, 12) })).toThrow(/\{zzz\}/);
    expect(() => one({ key: 'nodata', at: at(3, 12) })).toThrow(/carries no "missing"/);
  });

  it('hashes without a clock and fills only what is asked', () => {
    expect(fnv1a('a')).toBe(0xe40c292c);
    expect(pickOne(['x'], 5, 'any')).toBe('x');
    expect(() => pickOne([], 5, 'any')).toThrow();
    expect(fillTemplate('{a}-{b}', { a: '1', b: '2' })).toBe('1-2');
    expect(() => fillTemplate('{a}', {})).toThrow();
  });
});

describe('the report of a closure and of a bankruptcy', () => {
  const base: ReportInput = {
    kind: 'notice', seed: 1, wakes: WAKES, at: at(4, 22.5), struck: ['liver'], fasting: true, known: new Set(),
    hospital: { day: 5, issueDay: 6, wake: 7, cap: 40, debtPercent: 50, missedExam: 'mid' },
    facts: [
      { key: 'choice:drink_fasting', at: at(4, 20), vars: { cups: 6, g: 60 } },
      { key: 'strike', scope: 'liver', at: at(4, 22.5), parent: true },
    ],
  };
  const lines = (input: Partial<ReportInput> = {}): readonly string[] => composeReport({ ...base, ...input }, ENV).lines;

  it('sets the incident into the frame of a closure notice', () => {
    expect(lines()).toEqual([
      '人體股份有限公司　函',
      '發文日期：第 6 天 07:00',
      '發文字號：人體急字第 0422 號',
      '受文者：營運長',
      '',
      '主旨：本公司因肝臟部門罷工，且宿主空腹，於第 5 天停業整頓一日，即日起復工，請查照。',
      '',
      '說明：',
      '一、事故經過：',
      '（一）第 4 天晚間，宿主空腹赴宴，乾杯六杯（約 60 公克酒精）。',
      '（二）當晚，肝臟部門宣布罷工。',
      '二、整頓處分：住院一日；各樓層負載最高壓回 40；睡眠債降為原本的 50%；期中考缺考。',
      '三、整頓建議：請詳閱員工手冊〈酒精代謝〉（本次解鎖）。肝臟一小時大約只能處理半杯到一杯的酒（體重越輕越慢），喝再多也不會加班加速。',
      '（註：肝臟罷工是遊戲的簡化設定。真正與肝損傷有關的只有重複用藥：用藥請看成分，有疑問請問藥師。）',
      '',
      '下次再發生，本函將升級為倒閉調查報告。',
      '',
      '調查委員會　主任委員　肝（未出席，書面意見：「本人已於日前離職，請洽交接人（從缺）。」）',
      '正本：營運長',
      '副本：大腦董事長、全體部門、夜班清潔隊',
    ]);
  });

  it('sets it into the frame of a bankruptcy report, with the case it follows', () => {
    const l = lines({
      kind: 'bankruptcy', at: at(7, 22.5), hospital: undefined as never, previous: { at: at(4, 22.5), struck: ['liver'], fasting: true },
      facts: [{ key: 'strike', scope: 'liver', at: at(7, 22.5), parent: true }],
    });
    expect(l.slice(0, 6)).toEqual([
      '人體股份有限公司　函', '發文日期：第 7 天 22:30', '發文字號：人體倒字第 0722 號', '受文者：營運長',
      '前案：第 4 天肝臟部門罷工，且宿主空腹，停業整頓一日（人體急字第 0422 號）', '',
    ]);
    expect(l).toContain('主旨：本公司因肝臟部門罷工，且宿主空腹，宿主送醫，即日起宣告倒閉，請查照。');
    expect(l).toContain('二、結果：肝臟部門罷工，且宿主空腹。宿主出現頭暈、冒冷汗，由室友陪同送醫，經評估與飲酒過量有關，所幸無大礙，但本公司已無力營運。');
    expect(l).toContain('調查委員會建議：');
    expect(l.filter((x) => /^[一二三]、/.test(x)).slice(-3).map((x) => x.slice(0, 2))).toEqual(['一、', '二、', '三、']);
    expect(l.at(-3)).toMatch(/^調查委員會　主任委員　肝/);
  });

  it('writes no earlier case when a bankruptcy has none to name', () => {
    const l = lines({ kind: 'bankruptcy', hospital: undefined as never });
    expect(l.some((x) => x.startsWith('前案'))).toBe(false);
  });

  it('cites nothing from after the crisis', () => {
    const future: ReportFact = { key: 'choice:drink', at: at(4, 22.5) + 1, vars: { cups: 9, g: 90 } };
    const doc = composeReport({ ...base, facts: [...base.facts, future] }, ENV);
    expect(doc.incident.map((l) => l.key)).toEqual(['choice:drink_fasting', 'strike']);
    expect(wordAll({ ...base, facts: [...base.facts, future] }, ENV).map((l) => l.key)).toEqual(['choice:drink_fasting', 'strike']);
    const same = composeReport({ ...base, facts: [...base.facts, { ...future, at: at(4, 22.5) }] }, ENV);
    expect(same.incident.map((l) => l.key)).toContain('choice:drink');
  });

  it('words a missed final exam, and none when the hospital day is no exam day', () => {
    const penalty = (h: NonNullable<ReportInput['hospital']>): string => lines({ hospital: h }).find((x) => x.startsWith('二、'))!;
    expect(penalty({ ...base.hospital!, missedExam: 'fin' })).toBe('二、整頓處分：住院一日；各樓層負載最高壓回 40；睡眠債降為原本的 50%；期末考缺考。');
    const { missedExam: _, ...plain } = base.hospital!;
    expect(penalty(plain)).toBe('二、整頓處分：住院一日；各樓層負載最高壓回 40；睡眠債降為原本的 50%。');
  });

  it('refuses a closure notice with no hospital stay', () => {
    expect(() => composeReport({ ...base, hospital: undefined as never }, ENV)).toThrow(/hospital stay/);
  });

  it('names several departments, in the order they struck', () => {
    const cause = (struck: string[], fasting = false): string => lines({ struck, fasting }).find((x) => x.startsWith('主旨'))!;
    expect(cause(['brain', 'stomach'])).toContain('因大腦董事長室與物流部同時罷工，');
    expect(cause(['brain', 'stomach', 'liver'])).toContain('因大腦董事長室、物流部與肝臟部門同時罷工，');
    expect(cause(['brain'])).toContain('因大腦董事長室罷工，');
    expect(cause(['liver'], true)).toContain('因肝臟部門罷工，且宿主空腹，');
    expect(cause(['liver', 'brain'], true)).toContain('因肝臟部門與大腦董事長室同時罷工，');
  });

  it('mentions an empty stomach only for the liver alone', () => {
    const cause = (struck: string[], fasting: boolean): string => lines({ struck, fasting }).find((x) => x.startsWith('主旨'))!;
    expect(cause(['liver'], false)).toContain('因肝臟部門罷工，於');
    expect(cause(['brain'], true)).toContain('因大腦董事長室罷工，於');
    expect(`${cause(['liver'], false)}${cause(['brain'], true)}`).not.toContain('空腹');
  });

  it('adds the note on the liver only to a report of its strike', () => {
    const note = text(CFG.doc.liverNote);
    expect(lines()).toContain(note);
    expect(lines({ struck: ['brain'], fasting: false })).not.toContain(note);
  });

  it('scores a fact with no bank key as the least, so it never crowds out a worded one', () => {
    const keys = ['choice:late_snack', 'choice:drink', 'choice:drink_fasting', 'activity:stayed_up', 'activity:study_late'];
    const facts: ReportFact[] = [
      { key: 'tag:unknown', at: at(1, 9), vars: { label: 'x' } },
      ...keys.map((key, i) => ({ key, at: at(2 + i, 12), vars: { cups: 1, g: 10 } })),
      { key: 'strike', scope: 'liver', at: at(8, 22.5), parent: true },
    ];
    const doc = composeReport({ ...base, at: at(8, 22.5), facts }, ENV);
    expect(doc.incident.map((l) => l.key)).toEqual(['choice:late_snack', 'choice:drink', 'choice:drink_fasting', 'activity:stayed_up', 'strike']);
    expect(doc.generic).toBe(0);
  });

  it('words facts of days apart under a key as a spread, and keeps the last day of a line', () => {
    const doc = composeReport({
      ...base,
      facts: [{ key: 'choice:late_snack', at: at(1, 23) }, { key: 'choice:late_snack', at: at(3, 23) }, ...base.facts],
    }, ENV);
    const line = doc.incident.find((l) => l.key === 'choice:late_snack')!;
    expect([line.form, line.firstDay, line.lastDay]).toEqual(['spread', 1, 3]);
    expect(line.at).toBe(at(1, 23));
    expect(line.text).toContain('第 1 至 3 天間共兩晚');
  });

  it('words a line from the facts up to the crisis the same way whether or not it is among the five', () => {
    expect(wordAll(base, ENV)).toEqual(composeReport(base, ENV).incident);
    expect(wordAll(base, ENV)[1]!.text).toMatch(/^當晚/);
  });

  it('reads a family from the department of a fact only when its key names none', () => {
    const theme = (struck: string[], facts: ReportFact[]): string => composeReport({ ...base, struck, fasting: false, facts }, ENV).theme;
    const strike = (scope: string): ReportFact[] => [{ key: 'strike', scope, at: at(4, 22.5), parent: true }];
    expect([theme(['stomach'], strike('stomach')), theme(['liver'], strike('liver')), theme(['brain'], strike('brain'))]).toEqual(['snack', 'alcohol', 'sleep']);
    expect(theme(['brain'], [{ key: 'ops:patrol_orders', scope: 'brain', at: at(4, 20), vars: { orders: 2 } }])).toBe('alcohol');
  });

  it('weighs the families by what their sentences score, not by how many there are or which came last', () => {
    const theme = (facts: ReportFact[]): string => composeReport({ ...base, struck: ['brain', 'stomach'], fasting: false, facts }, ENV).theme;
    const sleepTwice: ReportFact[] = [{ key: 'activity:stayed_up', at: at(2, 25) }, { key: 'activity:study_late', at: at(3, 25) }];
    expect(theme([...sleepTwice, { key: 'choice:late_snack', at: at(3, 23) }, { key: 'strike', scope: 'stomach', at: at(4, 22), parent: true }])).toBe('sleep');
    expect(theme([...sleepTwice, { key: 'event:deadline', at: at(4, 14) }, { key: 'choice:late_snack', at: at(3, 23) }])).toBe('sleep');
  });

  it('names in a bankruptcy the case it follows by that case\'s own departments', () => {
    const l = lines({
      kind: 'bankruptcy', hospital: undefined as never, struck: ['liver'], fasting: true,
      previous: { at: at(4, 22.5), struck: ['brain', 'stomach'], fasting: false },
    });
    const prior = l.find((x) => x.startsWith('前案'))!;
    expect(prior).toContain('大腦董事長室與物流部同時罷工');
    expect(prior).not.toContain('肝臟');
    expect(prior).not.toContain('空腹');
  });

  it('sets the advice of a bankruptcy from the family it chose', () => {
    const family = CFG.themes['alcohol']!;
    const advice = lines({ kind: 'bankruptcy', hospital: undefined as never }).filter((x) => /^[一二三]、/.test(x)).slice(-3);
    expect(advice[0]).toContain(`〈${text('handbook.alcohol_metabolism.title')}〉`);
    expect(advice[0]).toContain(family.education.map(text).join(''));
    expect(advice[1]).toContain(text(family.action));
    expect(advice[2]).toContain(text(family.sign));
  });

  it('hands back the departments that struck', () => {
    expect(composeReport(base, ENV).struck).toEqual(['liver']);
  });

  it('chooses the page and advice of the family whose sentences score the most', () => {
    const doc = (facts: ReportFact[], struck = ['brain', 'stomach']) => composeReport({ ...base, facts, struck, fasting: false }, ENV);
    const sleep = doc([{ key: 'activity:stayed_up', at: at(3, 25) }, { key: 'event:deadline', at: at(3, 14) }, { key: 'choice:late_snack', at: at(3, 23) }]);
    expect([sleep.theme, sleep.unlock]).toEqual(['sleep', 'sleep_debt']);
    const snack = doc([{ key: 'choice:late_snack', at: at(3, 23) }, { key: 'choice:late_snack', at: at(4, 23) }, { key: 'activity:stayed_up', at: at(4, 25) }]);
    expect([snack.theme, snack.unlock]).toEqual(['snack', 'eating_before_sleep']);
    const caffeine = doc([{ key: 'choice:coffee', at: at(3, 8), vars: { cups: 1 } }, { key: 'choice:coffee', at: at(4, 8), vars: { cups: 1 } }]);
    expect([caffeine.theme, caffeine.unlock]).toEqual(['caffeine', 'caffeine']);
    const none = doc([{ key: 'tag:unknown', at: at(3, 8), vars: { label: 'x' } }], []);
    expect(none.theme).toBe(CFG.defaultTheme);
  });

  it('lets the order in the bank settle a tie', () => {
    const tie: ReportFact[] = [{ key: 'choice:late_snack', at: at(3, 23) }, { key: 'activity:stayed_up', at: at(3, 25) }];
    expect(composeReport({ ...base, facts: tie, struck: ['brain', 'stomach'], fasting: false }, ENV).theme).toBe('snack');
    const reordered = { ...CFG, themeOrder: ['sleep', 'alcohol', 'caffeine', 'snack'] };
    expect(composeReport({ ...base, facts: tie, struck: ['brain', 'stomach'], fasting: false }, { ...ENV, cfg: reordered }).theme).toBe('sleep');
  });

  it('gives the liver an opinion that fits: after its strike, after a hangover, or any other', () => {
    const opinion = (doc: { lines: readonly string[] }): string => /「(.*)」）$/.exec(doc.lines.find((x) => x.startsWith('調查委員會　'))!)![1]!;
    const asKept = (key: string): string => text(key);
    const defaults = CFG.opinions.default.map(asKept);
    const struck = composeReport(base, ENV);
    expect(opinion(struck)).toBe('本人已於日前離職，請洽交接人（從缺）。');
    const hangover = composeReport({ ...base, struck: ['brain', 'stomach'], fasting: false, facts: [{ key: 'choice:drink', at: at(4, 20), vars: { cups: 3, g: 30 } }] }, ENV);
    expect(opinion(hangover)).toBe('……我需要休假。');
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) {
      const doc = composeReport({ ...base, seed, struck: ['brain'], fasting: false, facts: [{ key: 'activity:stayed_up', at: at(3, 25) }] }, { ...ENV, seed });
      seen.add(opinion(doc));
    }
    expect([...seen].sort()).toEqual([...defaults].sort());
  });

  it('says 已收錄 for a page the player already holds', () => {
    expect(lines({ known: new Set(['alcohol_metabolism']) }).find((x) => x.startsWith('三、'))).toContain('〈酒精代謝〉（已收錄）');
    expect(lines().find((x) => x.startsWith('三、'))).toContain('〈酒精代謝〉（本次解鎖）');
  });

  it('prints a night after midnight as the hour of the day that went to bed', () => {
    const doc = composeReport({ ...base, at: at(4, 25), facts: [{ key: 'strike', scope: 'liver', at: at(4, 25), parent: true }] }, ENV);
    expect(doc.number).toBe('0401');
    expect(doc.lines).toContain('發文字號：人體急字第 0401 號');
  });

  it('is the same report every time, and tells a different run apart by its seed', () => {
    const a = composeReport(base, ENV);
    expect(composeReport(base, ENV)).toEqual(a);
    const joined = Array.from({ length: 30 }, (_, seed) => composeReport({ ...base, seed }, { ...ENV, seed }).lines.join('\n'));
    expect(new Set(joined).size).toBeGreaterThan(1);
  });

  it('reports how many sentences came from the fallback', () => {
    const doc = composeReport({ ...base, facts: [...base.facts, { key: 'tag:odd', at: at(4, 9), vars: { label: 'odd' }, parent: true }] }, ENV);
    expect(doc.generic).toBe(1);
    expect(doc.incident.find((l) => l.generic)!.text).toBe('第 4 天，本公司受到「odd」影響');
  });
});

describe('the report bank is checked for its authors', () => {
  const problems = (cfg: ReportFile, strings: Record<string, string> = {}): string[] =>
    reportProblems(cfg, (k) => strings[k] ?? STRINGS.strings[k]?.text, PAGES);
  const keys = (patch: Record<string, unknown>): ReportFile => ({ ...CFG, keys: { ...CFG.keys, ...patch } } as ReportFile);

  it('passes the shipped bank', () => {
    expect(problems(CFG)).toEqual([]);
  });

  it('reports a string that is missing, naming where it is used', () => {
    const cfg = keys({ 'choice:coffee': { ...CFG.keys['choice:coffee']!, single: ['report.nope'] } });
    expect(problems(cfg)).toEqual([expect.stringContaining('keys.choice:coffee.single 用到的文字「report.nope」不在 strings')]);
  });

  it('reports a placeholder that the form cannot fill, and one that no var declares', () => {
    const wrong = problems(CFG, { 'report.choice.coffee.run.1': '{Dr}，{D}' });
    expect(wrong).toEqual([expect.stringContaining('{D}')]);
    const single = problems(CFG, { 'report.choice.coffee.single.1': '{D}，{N}' });
    expect(single).toEqual([expect.stringContaining('{N}')]);
    const undeclared = problems(CFG, { 'report.tag.sleep_debt.single.1': '{D}，{cups}' });
    expect(undeclared).toEqual([expect.stringContaining('{cups}')]);
  });

  it('reports a sentence that ends in a full stop, which the report adds itself', () => {
    expect(problems(CFG, { 'report.strike.single.1': '{D}，{dept}宣布罷工。' })).toEqual([expect.stringContaining('不要自己加句號')]);
  });

  it('reports a closing exclamation or question mark as well, in a sentence and in the fallback', () => {
    expect(problems(CFG, { 'report.strike.single.1': '{D}，{dept}罷工！' })).toEqual([expect.stringContaining('不要自己加句號')]);
    expect(problems(CFG, { 'report.generic': '{D}，{label}。' })).toEqual([expect.stringContaining('不要自己加句號')]);
  });

  it('reports a string that a department, a theme or the opinions name and the table lacks', () => {
    const scoped = { ...CFG, scopes: { ...CFG.scopes, brain: { ...CFG.scopes['brain']!, symptom: 'report.nope' } } };
    expect(problems(scoped)).toEqual([expect.stringContaining('scopes.brain.symptom 用到的文字「report.nope」不在 strings')]);
    const sleep = (patch: Partial<ReportFile['themes'][string]>): string[] => problems({ ...CFG, themes: { ...CFG.themes, sleep: { ...CFG.themes['sleep']!, ...patch } } });
    expect(sleep({ sign: 'report.nope' })).toEqual([expect.stringContaining('themes.sleep 用到的文字「report.nope」')]);
    expect(sleep({ education: ['report.nope'] })).toEqual([expect.stringContaining('themes.sleep 用到的文字「report.nope」')]);
    const opinions = { ...CFG, opinions: { ...CFG.opinions, default: ['report.nope', ...CFG.opinions.default] } };
    expect(problems(opinions)).toEqual([expect.stringContaining('opinions.default 用到的文字「report.nope」')]);
  });

  it('reports a var that shadows a built-in placeholder', () => {
    const cfg = keys({ 'choice:coffee': { ...CFG.keys['choice:coffee']!, vars: { D: { agg: 'sum' } } } });
    expect(problems(cfg).join('\n')).toMatch(/變數「D」與內建佔位符同名/);
  });

  it('reports names that point nowhere: themes, pages, scopes, bank keys', () => {
    expect(problems({ ...CFG, defaultTheme: 'nope' })).toEqual([expect.stringContaining('defaultTheme「nope」')]);
    expect(problems({ ...CFG, themeOrder: ['alcohol', 'caffeine', 'snack'] })).toEqual([expect.stringContaining('themes.sleep 沒有排進 themeOrder')]);
    expect(problems({ ...CFG, themes: { ...CFG.themes, sleep: { ...CFG.themes['sleep']!, page: 'nope' } } })).toEqual([expect.stringContaining('手冊頁「nope」')]);
    expect(problems({ ...CFG, scopes: { ...CFG.scopes, gut: { ...CFG.scopes['gut']!, theme: 'nope' } } })).toEqual([expect.stringContaining('scopes.gut 的 theme「nope」')]);
    expect(problems({ ...CFG, nodes: { ...CFG.nodes, 'card:coffee': 'nope' } })).toEqual([expect.stringContaining('指向不存在的句型鍵「nope」')]);
    const { company: _, ...rest } = CFG.scopes;
    expect(problems({ ...CFG, scopes: rest })).toEqual([expect.stringContaining('scopes 缺少「company」')]);
  });

  it('reports a document text that uses a placeholder it does not get', () => {
    expect(problems(CFG, { 'report.doc.chair': '{opinion}{day}' })).toEqual([expect.stringContaining('{day}')]);
  });
});

describe('from the causal log to facts', () => {
  const ctx = contextFor(0.5, 1, { scenario: Object.fromEntries([2, 3, 4].map((d) => [d, ['bbq']])) });
  const end = runSemester(ctx, ARCHETYPES.drinkerBlind, 1);
  const [input] = semesterInputs(end, ctx, { cfg: CFG, text, seed: 1 });

  it('writes one report per visit to the emergency room, the first a notice and the second a bankruptcy', () => {
    expect(semesterReports(end, ctx, { cfg: CFG, text, seed: 1 }).map((d) => d.kind)).toEqual(['notice']);
    const twice = contextFor(0.5, 1, { scenario: bingeTwice(1) });
    const second = runSemester(twice, ARCHETYPES.drinkerBlind, 1);
    expect(semesterReports(second, twice, { cfg: CFG, text, seed: 1 }).map((d) => d.kind)).toEqual(['notice', 'bankruptcy']);
    expect(semesterInputs(second, twice, { cfg: CFG, text, seed: 1 })[1]!.previous).toEqual({ at: input!.at, struck: ['liver'], fasting: true });
  });

  it('reads the hospital stay from the rules of the semester', () => {
    expect(input!.hospital).toEqual({ day: 5, issueDay: 6, wake: ctx.params.wake, cap: ctx.params.hospitalFloorLoad, debtPercent: 50, missedExam: 'mid' });
  });

  it('turns each traced entry into a fact under its bank key, leaving out what is only a stepping stone', () => {
    const nodes = end.tags.log.nodes;
    const crisis = nodes[end.history[3]!.crisis!.node]!;
    const facts = nodeFacts(nodes.filter((n) => n.at <= crisis.at), CFG, new Set(crisis.causes.map((c) => c.node)));
    expect(new Set(facts.map((f) => f.key))).toEqual(new Set(['choice:coffee', 'choice:drink_fasting', 'tag:sleep_debt', 'activity:stayed_up', 'strike', 'effect:caffeine_insomnia', 'effect:alcohol_sleep'].filter((k) => facts.some((f) => f.key === k))));
    expect(facts.some((f) => f.key.startsWith('rule:') || f.key === 'tag:alcohol')).toBe(false);
    const strike = facts.find((f) => f.key === 'strike')!;
    expect([strike.scope, strike.parent]).toEqual(['liver', true]);
    const drink = facts.find((f) => f.key === 'choice:drink_fasting')!;
    expect(drink.vars).toEqual({ cups: 6, g: 60 });
  });

  it('keeps an entry that has no bank key as a fact worded by the fallback, labelled', () => {
    const odd = [{ id: 0, kind: 'tag' as const, key: 'cold', at: 100, causes: [] }];
    expect(nodeFacts(odd, CFG, new Set())).toEqual([{ key: 'tag:cold', at: 100, vars: { label: 'cold' } }]);
  });

  it('rounds the caffeine left at bedtime for the sentence', () => {
    const node = [{ id: 0, kind: 'effect' as const, key: 'caffeine_insomnia', at: 100, causes: [], data: { residual: 84.6 } }];
    expect(nodeFacts(node, CFG, new Set())[0]!.vars).toEqual({ residual: 84.6, r: 80, rmin: 80 });
    const high = [{ id: 0, kind: 'effect' as const, key: 'caffeine_insomnia', at: 100, causes: [], data: { residual: 86 } }];
    expect(nodeFacts(high, CFG, new Set())[0]!.vars).toMatchObject({ r: 90, rmin: 80 });
  });

  it('adds what the operator did not do: unvisited lit floors, patrols while orders piled up, a clue unanswered', () => {
    const facts = operationFacts(end.history, end, ctx, new Set(['liver']), text, CFG, 0, 4);
    const orders = facts.filter((f) => f.key === 'ops:patrol_orders');
    expect(orders.map((f) => f.vars!['orders'])).toEqual([1, 2, 3]);
    expect(orders.every((f) => f.scope !== 'liver')).toBe(true);
    expect(facts.filter((f) => f.key === 'ops:liver_clue').map((f) => f.at)).toEqual([at(3, 7), at(4, 7)]);
    expect(facts.some((f) => f.key === 'warning')).toBe(false);
  });

  it('does not count days outside the window, nor an order no patrol could have answered', () => {
    expect(operationFacts(end.history, end, ctx, new Set(['liver']), text, CFG, 2, 4).filter((f) => f.key === 'ops:patrol_orders').map((f) => f.vars!['orders'])).toEqual([2, 3]);
    expect(operationFacts(end.history, end, ctx, new Set(['liver']), text, CFG, 0, 2)).toEqual([expect.objectContaining({ key: 'ops:patrol_orders' })]);
  });

  it('puts the symptom a department reported in the sentence about an unanswered light', () => {
    const crammer = contextFor(0.5, 1, { scenario: { 2: ['late_snack'], 3: ['late_snack'] } });
    const s = runSemester(crammer, ARCHETYPES.crammer, 1);
    const facts = operationFacts(s.history, s, crammer, new Set(['brain', 'stomach']), text, CFG, 0, 10).filter((f) => f.key === 'warning');
    expect(facts.length).toBeGreaterThan(0);
    for (const f of facts) expect(f.vars!['symptom']).toBe(text(CFG.scopes[f.scope!]!.symptom!));
  });

  it('pins the report of a binge week and of a second visit, word for word', () => {
    const [notice] = semesterReports(end, ctx, { cfg: CFG, text, seed: 1 });
    expect(notice!.incident.map((l) => l.text)).toEqual([
      '第 2 至 4 天，宿主連續三天空腹赴宴，合計十八杯（約 180 公克酒精）',
      '第 2 至 4 天，營運長連續三天選擇巡視大腦董事長室，肝臟部門的工單累積至 3 張',
      '第 3 至 4 天，物流部連續兩天回報輸送帶卡住，董事長追問肝臟部門為何沒有回應，均未獲處理',
      '當晚，肝臟部門宣布罷工',
    ]);
    expect(notice!.number).toBe('0422');
    const twice = contextFor(0.5, 1, { scenario: bingeTwice(1) });
    const second = semesterReports(runSemester(twice, ARCHETYPES.drinkerBlind, 1), twice, { cfg: CFG, text, seed: 1 });
    expect(second[1]!.incident.map((l) => l.text)).toEqual([
      '第 6 至 7 天，宿主連續兩天空腹赴宴，合計十二杯（約 120 公克酒精）',
      '第 6 至 7 天，營運長連續兩天選擇巡視大腦董事長室，肝臟部門的工單累積至 5 張',
      '同日上午，物流部回報輸送帶卡住，董事長追問肝臟部門為何沒有回應，未獲處理',
      '當晚，肝臟部門全面停擺',
    ]);
    expect(second[1]!.lines).toContain('前案：第 4 天肝臟部門罷工，且宿主空腹，停業整頓一日（人體急字第 0422 號）');
  });

  it('never cites the first visit in the second report unless the second still follows from it', () => {
    const twice = contextFor(0.5, 1, { scenario: bingeTwice(1) });
    const s = runSemester(twice, ARCHETYPES.drinkerBlind, 1);
    const [first, secondDoc] = semesterReports(s, twice, { cfg: CFG, text, seed: 1 });
    const firstAt = s.history.find((r) => r.crisis)!.crisis!.at;
    expect(secondDoc!.incident.every((l) => l.at > firstAt)).toBe(true);
    expect(first!.incident.every((l) => l.at <= firstAt)).toBe(true);
  });

  it('writes a report whose incident fits the limit for the shipped scenarios', () => {
    for (const scenario of [bingeWeek(1), bingeTwice(1)]) {
      const c = contextFor(0.5, 1, { scenario });
      for (const doc of semesterReports(runSemester(c, ARCHETYPES.drinkerBlind, 1), c, { cfg: CFG, text, seed: 1 })) {
        expect(doc.incident.length).toBeGreaterThan(0);
        expect(doc.incident.length).toBeLessThanOrEqual(5);
      }
    }
  });
});

describe('wording the entries of the log', () => {
  const wild: ReportFile = { ...CFG, nodes: { 'tag:*': 'a', 'tag:cold*': 'b', 'tag:warm': 'c' }, ignore: ['tag:ice*', 'tag:exact'] };
  const keyOf = (key: string): string[] => nodeFacts([{ id: 0, kind: 'tag' as const, key, at: 100, causes: [] }], wild, new Set()).map((f) => f.key);

  it('maps an entry by its exact name, else by the longest prefix pattern that fits', () => {
    expect(keyOf('warm')).toEqual(['c']);
    expect(keyOf('warmer')).toEqual(['a']);
    expect(keyOf('colder')).toEqual(['b']);
    expect(keyOf('other')).toEqual(['a']);
  });

  it('leaves out an entry the ignore list names, exactly or by prefix', () => {
    expect(keyOf('exact')).toEqual([]);
    expect(keyOf('exactly')).toEqual(['a']);
    expect(keyOf('iceberg')).toEqual([]);
    expect(keyOf('ic')).toEqual(['a']);
  });

  it('never makes a sentence of the crisis entry itself', () => {
    expect(nodeFacts([{ id: 0, kind: 'crisis' as const, key: 'er', at: 100, causes: [] }], CFG, new Set())).toEqual([]);
  });

  it('keeps number and text data as vars and drops flags, adding grams and rounded residue only where the sentence asks', () => {
    const drink = nodeFacts([{ id: 0, kind: 'event' as const, key: 'event.bbq.drink', at: 100, causes: [], data: { cups: 2, fasting: true, note: 'x' } }], CFG, new Set());
    expect(drink).toEqual([{ key: 'choice:drink', at: 100, vars: { cups: 2, g: 20, note: 'x' } }]);
    const coffee = nodeFacts([{ id: 0, kind: 'card' as const, key: 'coffee', at: 100, causes: [], data: { cups: 1 } }], CFG, new Set());
    expect(coffee).toEqual([{ key: 'choice:coffee', at: 100, vars: { cups: 1 } }]);
    const odd = nodeFacts([{ id: 0, kind: 'effect' as const, key: 'odd', at: 100, causes: [], data: { residual: 84 } }], CFG, new Set());
    expect(odd).toEqual([{ key: 'effect:odd', at: 100, vars: { residual: 84, label: 'odd' } }]);
  });

  it('flags as a parent only the entries the crisis names', () => {
    const nodes = [
      { id: 3, kind: 'tag' as const, key: 'cold', at: 100, causes: [] },
      { id: 4, kind: 'tag' as const, key: 'warm', at: 100, causes: [] },
    ];
    expect(nodeFacts(nodes, CFG, new Set([4])).map((f) => f.parent)).toEqual([undefined, true]);
  });
});

describe('what the operator did and left undone', () => {
  const ctx = contextFor(0.5, 1, { scenario: bingeWeek(1) });
  const run = runSemester(ctx, ARCHETYPES.drinkerBlind, 1);
  const bed = ctx.params.bedMin;
  type Patrol = DayRecord['patrols'][number];
  const patrol = (floor: FloorId, grade: Patrol['grade'], overtime = false): Patrol => ({ floor, grade, overtime });
  const lightsOf = (lit: readonly FloorId[], light: 'yellow' | 'orange' | 'red' = 'orange'): DayRecord['lights'] =>
    Object.fromEntries((['brain', 'immune', 'stomach', 'liver', 'gut'] as const).map((f) => [f, lit.includes(f) ? light : 'off'])) as DayRecord['lights'];
  const rec = (day: number, over: Partial<DayRecord> = {}): DayRecord =>
    ({
      ...run.history[0]!, day, kind: 'normal', lit: [], lights: lightsOf(over.lit ?? []), patrols: [],
      loadsBefore: { ...run.history[0]!.loadsBefore, liver: 0 }, ...over,
    });
  const facts = (history: DayRecord[], struck: FloorId[], liverOrders: number[] = [], after = 0, upTo = 10): ReportFact[] =>
    operationFacts(history, { ...run, liverOrders } as SemesterState, ctx, new Set(struck), text, CFG, after, upTo);

  it('writes a warning for a floor that struck, was lit and went unvisited, and for no other', () => {
    const day = rec(3, { lit: ['brain', 'stomach', 'gut'], patrols: [patrol('gut', 'S')] });
    expect(facts([day], ['brain', 'gut'])).toEqual([
      { key: 'warning', scope: 'brain', at: minuteOf(3, day.wake), vars: { symptom: text(CFG.scopes['brain']!.symptom!) } },
    ]);
  });

  it('says a department reported its symptom only from the orange light on, not at yellow', () => {
    const warned = (light: 'yellow' | 'orange' | 'red'): number => facts([rec(3, { lit: ['brain'], lights: lightsOf(['brain'], light) })], ['brain']).length;
    expect([warned('yellow'), warned('orange'), warned('red')]).toEqual([0, 1, 1]);
  });

  it('writes no warning for the days a cram week stomach was only yellow', () => {
    const crunch = contextFor(0.2, 1, { scenario: crunchWeek(1) });
    const crammed = runSemester(crunch, ARCHETYPES.crammer, 1);
    const stomach = operationFacts(crammed.history, crammed, crunch, new Set(['brain', 'stomach']), text, CFG, 0, 10).filter((f) => f.key === 'warning' && f.scope === 'stomach');
    expect(stomach.length).toBeGreaterThan(0);
    for (const f of stomach) expect(['orange', 'red']).toContain(crammed.history[Math.floor(f.at / DAY)]!.lights.stomach);
  });

  it('writes a poor patrol only for a floor that struck and a patrol rated C', () => {
    const day = rec(2, { patrols: [patrol('brain', 'C'), patrol('stomach', 'C'), patrol('gut', 'B'), patrol('immune', 'S')] });
    expect(facts([day], ['brain', 'gut', 'immune'])).toEqual([{ key: 'ops:poor_patrol', scope: 'brain', at: minuteOf(2, bed) }]);
  });

  it('writes the orders piled at the liver and the patrol spent elsewhere, only for a liver strike that went unvisited', () => {
    const history = [
      rec(2, { patrols: [patrol('gut', 'S', true), patrol('brain', 'S')] }),
      rec(3),
      rec(4, { patrols: [patrol('liver', 'S')] }),
    ];
    const orders = (struck: FloorId[], liverOrders: number[]): ReportFact[] => facts(history, struck, liverOrders).filter((f) => f.key === 'ops:patrol_orders');
    expect(orders(['liver'], [1, 2, 3, 9])).toEqual([{ key: 'ops:patrol_orders', scope: 'brain', at: minuteOf(2, bed), vars: { orders: 2 } }]);
    expect(orders(['brain'], [1, 2, 3])).toEqual([]);
    expect(orders(['liver'], [5])).toEqual([]);
  });

  it('reads the days after the previous case up to the crisis, and only ordinary days', () => {
    const history = [1, 2, 3, 4].map((d) => rec(d, { lit: ['brain'] }));
    const when = (after: number, upTo: number): number[] => facts(history, ['brain'], [], after, upTo).map((f) => f.at);
    expect(when(1, 3)).toEqual([2, 3].map((d) => minuteOf(d, history[d - 1]!.wake)));
    expect(facts([rec(5, { kind: 'hospital', lit: ['brain'] }), rec(6, { kind: 'exam', lit: ['brain'] })], ['brain'])).toEqual([]);
  });
});

describe('the input of each report', () => {
  const opts = { cfg: CFG, text, seed: 1 };
  const crunch = contextFor(0.5, 1, { scenario: crunchWeek(1) });
  const crammed = runSemester(crunch, ARCHETYPES.crammer, 1);

  it('puts a visit on the ninth day into a stay on the final exam, issued that same day', () => {
    const [input] = semesterInputs(crammed, crunch, opts);
    expect(input!.hospital).toEqual({ day: 10, issueDay: 10, wake: crunch.params.wake, cap: crunch.params.hospitalFloorLoad, debtPercent: 50, missedExam: 'fin' });
    expect([input!.kind, input!.struck, input!.fasting]).toEqual(['notice', ['brain', 'stomach'], false]);
  });

  it('pins the notice of a cram week, where the strikes must stay among many causes', () => {
    const [notice] = semesterReports(crammed, crunch, opts);
    expect(notice!.incident.map((l) => l.text)).toEqual([
      '第 1 至 9 天，董事長連續九天批准咖啡採購，共十八杯',
      '第 1 至 9 天，宿主連續九晚熬夜趕工',
      '第 2 至 9 天，宿主連續八晚睡前吃宵夜，物流部連續八晚夜間加班',
      '當晚，大腦董事長室全面停擺',
      '當晚，物流部宣布罷工',
    ]);
    expect(notice!.number).toBe('0904');
    expect(notice!.lines).toContain('主旨：本公司因大腦董事長室與物流部同時罷工，於第 10 天停業整頓一日，即日起復工，請查照。');
    expect(notice!.lines).toContain('二、整頓處分：住院一日；各樓層負載最高壓回 40；睡眠債降為原本的 50%；期末考缺考。');
    expect(notice!.theme).toBe('sleep');
  });

  it('writes the family of a binge week as alcohol, with the subject naming the empty stomach', () => {
    const ctx = contextFor(0.5, 1, { scenario: bingeWeek(1) });
    const [input] = semesterInputs(runSemester(ctx, ARCHETYPES.drinkerBlind, 1), ctx, opts);
    expect([input!.struck, input!.fasting]).toEqual([['liver'], true]);
    const [notice] = semesterReports(runSemester(ctx, ARCHETYPES.drinkerBlind, 1), ctx, opts);
    expect(notice!.lines.find((x) => x.startsWith('主旨'))).toContain('且宿主空腹');
    expect(notice!.theme).toBe('alcohol');
  });

  it('hands on the departments and the fasting of the previous visit, not those of this one', () => {
    const twice = contextFor(0.5, 1, { scenario: bingeTwice(1) });
    const s = runSemester(twice, ARCHETYPES.drinkerBlind, 1);
    const first = s.history.find((r) => r.crisis)!;
    const tampered: SemesterState = {
      ...s,
      history: s.history.map((r) => (r === first ? { ...r, strikes: ['brain', 'stomach'], crisis: { ...r.crisis!, fasting: false } } : r)),
    };
    const inputs = semesterInputs(tampered, twice, opts);
    expect(inputs[1]!.previous).toEqual({ at: first.crisis!.at, struck: ['brain', 'stomach'], fasting: false });
    expect([inputs[1]!.struck, inputs[1]!.fasting]).toEqual([['liver'], true]);
  });

  it('marks a page the player already holds as held', () => {
    const ctx = contextFor(0.5, 1, { scenario: bingeWeek(1) });
    const s = runSemester(ctx, ARCHETYPES.drinkerBlind, 1);
    const [fresh] = semesterReports(s, ctx, opts);
    const [known] = semesterReports(s, ctx, { ...opts, known: new Set(['alcohol_metabolism']) });
    expect(fresh!.lines.find((x) => x.startsWith('三、'))).toContain('〈酒精代謝〉（本次解鎖）');
    expect(known!.lines.find((x) => x.startsWith('三、'))).toContain('〈酒精代謝〉（已收錄）');
  });
});