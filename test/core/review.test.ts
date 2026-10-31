import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHAPTERS, TAGS } from '../../src/app/content.ts';
import {
  MERITS, meritsOf, parseRoom, pinWall, readContent, reviewWall, roomsOf, runSemester, summarize, WALL_DAYS,
  type DayRecord, type ReportFile, type SemesterContext, type SemesterState, type StringsFile, type TiledMap,
} from '../../src/core/index.ts';
import { ARCHETYPES } from '../../sim/semester/archetypes.ts';
import { bingeTwice, bingeWeek, contextFor, crunchWeek } from '../../sim/semester/scenario.ts';

const readJson = (f: string): unknown => JSON.parse(readFileSync(`content/${f}`, 'utf8').replace(/^﻿/, ''));
const CFG: ReportFile = readContent('report', readJson('report.json'));
const STRINGS: StringsFile = readContent('strings', readJson('strings/zh-TW.json'));
const PAGES = new Set((readJson('handbook.json') as { pages: { id: string }[] }).pages.map((p) => p.id));
const text = (k: string): string => {
  const s = STRINGS.strings[k];
  if (!s) throw new Error(`no string ${k}`);
  return s.text;
};

const MAP = JSON.parse(readFileSync('public/assets/maps/wall/hall.tmj', 'utf8')) as TiledMap;
const CHAPTER = CHAPTERS.get('wall')!;
const roomObjects = parseRoom('wall/hall', MAP, TAGS).objects;

interface Played { name: string; ctx: SemesterContext; end: SemesterState }
const played: Played[] = [];
for (const [name, scenario] of [['plain', undefined], ['binge week', bingeWeek(1)], ['twice', bingeTwice(1)], ['crunch', crunchWeek(1)]] as const) {
  const ctx = contextFor(0.5, 1, scenario ? { scenario } : {});
  for (const [who, strategy] of Object.entries(ARCHETYPES)) {
    for (const seed of [1, 2, 3, 4]) played.push({ name: `${name}/${who}/${seed}`, ctx, end: runSemester(ctx, strategy, seed) });
  }
}
const passed = played.filter((p) => { const s = summarize(p.end, p.ctx); return s.passMid && s.passFin; });
const failed = played.filter((p) => { const s = summarize(p.end, p.ctx); return !(s.passMid && s.passFin); });
const base = passed[0]!;

/** A passed semester whose days are replaced, to put one behaviour under test. */
const withHistory = (change: (rec: DayRecord) => Partial<DayRecord>, extra: Partial<SemesterState> = {}): SemesterState => ({
  ...base.end, ...extra, history: base.end.history.map((r) => ({ ...r, ...change(r) })),
});
const idsOf = (s: SemesterState, ctx = base.ctx) => meritsOf(s, ctx, CFG, text).map((m) => m.id);
const QUIET: Partial<DayRecord> = { bedEnd: 26, patrols: [], events: [] };

describe('the year-end review of a passed semester (design doc 8.11)', () => {
  it('has both kinds of semester to look at', () => {
    expect(passed.length).toBeGreaterThan(10);
    expect(failed.length).toBeGreaterThan(3);
  });

  it('exists for every passed semester, with two or three merits on the days they happened, joined by blue lines in time order', () => {
    for (const { name, ctx, end } of passed) {
      const wall = reviewWall(end, ctx, CFG, text)!;
      expect(wall, name).toBeDefined();
      expect(wall.kind).toBe('review');
      expect(wall.nodes.length, name).toBeGreaterThanOrEqual(2);
      expect(wall.nodes.length, name).toBeLessThanOrEqual(3);
      expect(wall.nodes.every((n) => n.kind === 'merit' && n.lane === 'upper' && n.day >= 1 && n.day <= WALL_DAYS), name).toBe(true);
      expect(wall.nodes.map((n) => n.day), name).toEqual([...wall.nodes.map((n) => n.day)].sort((a, b) => a - b));
      expect(wall.links, name).toEqual(wall.nodes.slice(1).map((n, i) => [wall.nodes[i]!.id, n.id]));
      expect(PAGES.has(wall.unlock), name).toBe(true);
      // The wall room must have a slot for every node.
      expect(pinWall(wall, roomObjects), name).toHaveLength(wall.nodes.length);
    }
    expect(CHAPTER.start).toBe('wall/hall');
  });

  it('has none for a semester that is not over, failed an exam, or went bankrupt', () => {
    for (const { name, ctx, end } of failed) expect(reviewWall(end, ctx, CFG, text), name).toBeUndefined();
    expect(reviewWall({ ...base.end, ended: false }, base.ctx, CFG, text)).toBeUndefined();
    expect(reviewWall({ ...base.end, bankrupt: true }, base.ctx, CFG, text)).toBeUndefined();
  });

  it('always has the exams of a passed semester to fall back on, after the behaviours', () => {
    const quiet = withHistory(() => QUIET, { hospitals: 1, liverOrders: [] });
    expect(idsOf(quiet)).toEqual(['passed_fin', 'passed_mid']);
    expect(MERITS.indexOf('passed_fin')).toBeGreaterThan(MERITS.indexOf('no_hospital'));
  });

  it('praises three early nights in a row, the longest run first and the earliest of equals, never across a late night', () => {
    const early = (days: number[]) => withHistory((r) => (days.includes(r.day) ? { ...QUIET, bedEnd: 23.5 } : QUIET), { hospitals: 1, liverOrders: [] });
    const bed = (days: number[]) => meritsOf(early(days), base.ctx, CFG, text).find((m) => m.id === 'early_bed');
    expect(bed([3, 4, 5])?.vars).toMatchObject({ from: '3', to: '5', n: '3' });
    expect(bed([3, 4])).toBeUndefined();
    expect(bed([3, 4, 6, 7])).toBeUndefined();
    expect(bed([1, 2, 3, 6, 7, 8])?.vars).toMatchObject({ from: '1', n: '3' });
    expect(bed([1, 2, 3, 6, 7, 8, 9])?.vars).toMatchObject({ from: '6', to: '9', n: '4' });
    // Midnight itself is early, five past it is not.
    expect(meritsOf(withHistory((r) => ({ ...QUIET, bedEnd: r.day <= 3 ? 24 : 24.5 }), { hospitals: 1, liverOrders: [] }), base.ctx, CFG, text).some((m) => m.id === 'early_bed')).toBe(true);
    expect(meritsOf(withHistory(() => ({ ...QUIET, bedEnd: 24.5 }), { hospitals: 1, liverOrders: [] }), base.ctx, CFG, text).some((m) => m.id === 'early_bed')).toBe(false);
  });

  it('praises looking at a dark liver while work orders are waiting, and not before the first one', () => {
    const visit = (day: number, light: 'off' | 'yellow') => withHistory(
      (r) => (r.day === day ? { ...QUIET, lights: { ...r.lights, liver: light }, patrols: [{ floor: 'liver', grade: 'B', overtime: false }] } : QUIET),
      { hospitals: 1, liverOrders: [2] },
    );
    expect(meritsOf(visit(5, 'off'), base.ctx, CFG, text).find((m) => m.id === 'liver_check')?.day).toBe(5);
    expect(idsOf(visit(5, 'yellow'))).not.toContain('liver_check');
    expect(idsOf(visit(2, 'off'))).not.toContain('liver_check');
    expect(idsOf({ ...visit(5, 'off'), liverOrders: [] })).not.toContain('liver_check');
  });

  it('praises a barbecue without drinks, but not one with', () => {
    const bbq = (option: string) => withHistory((r) => (r.day === 3 ? { ...QUIET, events: [{ id: 'bbq', option }] } : QUIET), { hospitals: 1, liverOrders: [] });
    for (const option of ['decline', 'sober']) expect(meritsOf(bbq(option), base.ctx, CFG, text).find((m) => m.id === 'declined')?.day).toBe(3);
    for (const option of ['drink', 'drink_fasting', 'binge']) expect(idsOf(bbq(option))).not.toContain('declined');
  });

  it('praises a good patrol of a lit floor, not an overtime one, a plain grade, or a floor that was dark', () => {
    const patrol = (p: { grade: 'B' | 'A' | 'S'; overtime: boolean }, lit: boolean) => withHistory(
      (r) => (r.day === 4 ? { ...QUIET, lit: lit ? ['brain'] : [], patrols: [{ floor: 'brain', ...p }] } : QUIET), { hospitals: 1, liverOrders: [] },
    );
    const found = meritsOf(patrol({ grade: 'A', overtime: false }, true), base.ctx, CFG, text).find((m) => m.id === 'patrol');
    expect(found?.day).toBe(4);
    expect(found?.vars['grade']).toBe('A');
    expect(found?.vars['dept']).toBe(text(CFG.scopes['brain']!.dept));
    expect(idsOf(patrol({ grade: 'S', overtime: false }, true))).toContain('patrol');
    expect(idsOf(patrol({ grade: 'B', overtime: false }, true))).not.toContain('patrol');
    expect(idsOf(patrol({ grade: 'A', overtime: true }, true))).not.toContain('patrol');
    expect(idsOf(patrol({ grade: 'A', overtime: false }, false))).not.toContain('patrol');
  });

  it('takes the first three merits by their order of teaching value, shows them by day, and hands over the first one\'s page', () => {
    const rich = withHistory((r) => ({
      ...QUIET,
      ...(r.day === 9 ? { lights: { ...r.lights, liver: 'off' as const }, patrols: [{ floor: 'liver' as const, grade: 'S' as const, overtime: false }], lit: ['liver' as const] } : {}),
      ...(r.day === 3 ? { events: [{ id: 'bbq', option: 'sober' }] } : {}),
      ...([5, 6, 7].includes(r.day) ? { bedEnd: 23 } : {}),
    }), { hospitals: 0, liverOrders: [2] });
    expect(idsOf(rich).slice(0, 4)).toEqual(['liver_check', 'declined', 'early_bed', 'patrol']);
    const wall = reviewWall(rich, base.ctx, CFG, text)!;
    expect(wall.nodes.map((n) => n.day)).toEqual([3, 5, 9]);
    expect(wall.nodes[0]!.text).toContain('第 3 天');
    expect(wall.nodes[2]!.text).toContain('第 9 天');
    expect(wall.unlock).toBe(CFG.reviewPages['liver_check']);
    // Without the liver check, the barbecue leads.
    expect(reviewWall({ ...rich, liverOrders: [] }, base.ctx, CFG, text)!.unlock).toBe(CFG.reviewPages['declined']);
  });

  it('gives the default family\'s page when none of its merits has one', () => {
    const wall = reviewWall(withHistory(() => QUIET, { hospitals: 0, liverOrders: [] }), base.ctx, CFG, text)!;
    expect(wall.nodes).toHaveLength(3);
    expect(wall.unlock).toBe(CFG.themes[CFG.defaultTheme]!.page);
  });

  it('keeps two merits of one day on two slots of the same track', () => {
    const wall = reviewWall(withHistory(() => QUIET, { hospitals: 0, liverOrders: [] }), { ...base.ctx, params: { ...base.ctx.params, midDay: 10, finDay: 10, days: 10 } }, CFG, text)!;
    expect(wall.nodes.map((n) => [n.day, n.slot])).toEqual([[10, 1], [10, 2], [10, 3]]);
  });
});
