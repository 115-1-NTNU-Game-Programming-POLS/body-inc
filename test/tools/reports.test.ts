import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readContent, runSemester, semesterReports } from '../../src/core/index.ts';
import { ARCHETYPES } from '../../sim/semester/archetypes.ts';
import { bingeWeek, contextFor } from '../../sim/semester/scenario.ts';
import { checkContent } from '../../tools/check-content.ts';
import { checkReports, documentProblems } from '../../tools/check-reports.ts';

const root = mkdtempSync(join(tmpdir(), 'report-check-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;

/** A copy of content/ with some JSON files changed by `fn`s. */
function contentWith(...edits: [file: string, fn: (j: Record<string, any>) => void][]): string {
  const dir = join(root, `c${n++}`);
  cpSync('content', dir, { recursive: true });
  for (const [file, fn] of edits) {
    const p = join(dir, file);
    const j = JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, '')) as Record<string, any>;
    fn(j);
    writeFileSync(p, JSON.stringify(j, null, 2));
  }
  return dir;
}

const problems = (dir: string) => checkReports({ contentDir: dir, seeds: 2 }).problems;

describe('report check (build plan P6)', () => {
  it('passes on the shipped content with the default batch and reports that nothing fell back to the generic sentence', () => {
    const r = checkReports();
    expect(r.problems).toEqual([]);
    expect(r.report).toContainEqual(expect.stringMatching(/^\d+ 個學期，停業整頓通知 \d+ 份、倒閉調查報告 \d+ 份/));
    expect(r.report).toContainEqual(expect.stringMatching(/^通用句比例：0 \/ \d+（目標 0）$/));
    expect(r.report).toContainEqual('句型鍵 15 / 15 在批次中出現過');
  });

  it('a sentence key with no template is named, with a run that produced it', () => {
    const dir = contentWith(['report.json', (j) => { delete j['keys']['effect:alcohol_sleep']; }]);
    expect(problems(dir)).toEqual([expect.stringMatching(/^句型鍵「effect:alcohol_sleep」沒有模板，句子會用通用句（例：.+／.+／技能 .+／種子 \d+）/)]);
  });

  it('a stepping-stone entry that is listed as ignored is no longer a missing template', () => {
    const dir = contentWith(['report.json', (j) => {
      delete j['keys']['effect:alcohol_sleep'];
      j['ignore'].push('effect:alcohol_sleep');
    }]);
    expect(problems(dir)).toEqual([]);
  });

  it('a key that no simulated semester reaches is refused, since its template was never checked', () => {
    const dir = contentWith(['report.json', (j) => {
      j['keys']['choice:never'] = { score: 'choice', single: ['report.strike.single.1'] };
    }]);
    expect(problems(dir)).toEqual([expect.stringContaining('句型鍵「choice:never」在整批模擬裡一次也沒出現')]);
  });

  it('a string that is missing is named with its key, and ends the check there', () => {
    const dir = contentWith(['strings/zh-TW.json', (j) => {
      delete j['strings']['report.strike.single.1'];
      delete j['strings']['report.strike.single.2'];
    }]);
    const found = problems(dir);
    expect(found).toHaveLength(2);
    expect(found[0]).toContain('keys.strike.single 用到的文字「report.strike.single.1」不在 strings');
    expect(found[1]).toContain('keys.strike.single 用到的文字「report.strike.single.2」不在 strings');
  });

  it('a placeholder the sentence cannot fill is named', () => {
    const dir = contentWith(['strings/zh-TW.json', (j) => { j['strings']['report.choice.late_snack.run.1'].text = '{Dr}，{h}'; }]);
    expect(problems(dir)).toEqual([expect.stringContaining('用了不能用的佔位符 {h}')]);
  });

  it('a sentence that asks for data the producer never gives is reported with where it happened', () => {
    const dir = contentWith(
      ['strings/zh-TW.json', (j) => { j['strings']['report.ops.poor_patrol.single.1'].text = '{D}，{dept}，{foo}'; }],
      ['report.json', (j) => { j['keys']['ops:poor_patrol'].vars = { foo: { agg: 'sum' } }; }],
    );
    expect(problems(dir).some((p) => /報告寫不出來：.*carries no "foo"/.test(p))).toBe(true);
  });

  it('a file that breaks its schema is reported at the field', () => {
    const dir = contentWith(['report.json', (j) => { delete j['cupGrams']; }]);
    expect(problems(dir)).toEqual([expect.stringContaining('report.json')]);
    expect(problems(dir)[0]).toContain('cupGrams');
  });

  it('check-content knows the file and reports the same schema break', () => {
    expect(checkContent('content')).toEqual([]);
    const dir = contentWith(['report.json', (j) => { j['keys']['strike'].score = 'huge'; }]);
    expect(checkContent(dir)).toEqual([expect.stringContaining('report.json')]);
  });

  it('the command prints its footer and exits 0, or 1 with the problems', () => {
    const ok = spawnSync(process.execPath, ['tools/check-reports.ts', 'content', '1'], { encoding: 'utf8' });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/report check: 0 problem\(s\) in content\r?\n$/);
    const dir = contentWith(['report.json', (j) => { delete j['keys']['effect:alcohol_sleep']; }]);
    const bad = spawnSync(process.execPath, ['tools/check-reports.ts', dir, '1'], { encoding: 'utf8' });
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/句型鍵「effect:alcohol_sleep」沒有模板/);
    expect(bad.stdout).toMatch(/report check: 1 problem\(s\)/);
  });
});

describe('what must hold of any one report', () => {
  const readJson = (f: string): unknown => JSON.parse(readFileSync(`content/${f}`, 'utf8').replace(/^\uFEFF/, ''));
  const cfg = readContent('report', readJson('report.json'));
  const strings = readContent('strings', readJson('strings/zh-TW.json')).strings;
  const pages = new Set(readContent('handbook', readJson('handbook.json')).pages.map((p) => p.id));
  const ctx = contextFor(0.5, 1, { scenario: bingeWeek(1) });
  const end = runSemester(ctx, ARCHETYPES.drinkerBlind, 1);
  const [notice] = semesterReports(end, ctx, { cfg, text: (k) => strings[k]!.text, seed: 1 });
  const crisisAt = end.history.find((r) => r.crisis)!.crisis!.at;
  const line = notice!.incident[0]!;
  const found = (patch: Partial<NonNullable<typeof notice>>, index = 0, at = crisisAt): string[] => documentProblems({ ...notice!, ...patch }, index, at, pages);

  it('passes a report as the game writes it', () => {
    expect(found({})).toEqual([]);
  });

  it('wants the first report to be a notice and a later one a bankruptcy report', () => {
    expect(found({}, 1)).toEqual([expect.stringContaining('應是倒閉調查報告，寫出的是 notice')]);
    expect(found({ kind: 'bankruptcy' })).toEqual([expect.stringContaining('應是停業整頓通知，寫出的是 bankruptcy')]);
  });

  it('wants one to five sentences of incident', () => {
    expect(found({ incident: [] })).toEqual(['事故經過一句也沒有']);
    expect(found({ incident: Array(5).fill(line) })).toEqual([]);
    expect(found({ incident: Array(6).fill(line) })).toEqual(['事故經過有 6 句，上限是 5']);
  });

  it('wants a handbook page that exists', () => {
    expect(found({ unlock: 'nope' })).toEqual(['解鎖的手冊頁「nope」不在 handbook.json']);
  });

  it('wants every placeholder filled', () => {
    expect(found({ lines: [...notice!.lines, '{x}'] })).toEqual(['還有沒填的佔位符']);
    expect(found({ lines: [...notice!.lines, 'x}'] })).toEqual(['還有沒填的佔位符']);
    expect(found({ lines: [...notice!.lines, '{x'] })).toEqual(['還有沒填的佔位符']);
  });

  it('wants a number of four digits', () => {
    expect(found({ number: '12' })).toEqual([expect.stringContaining('字號「12」不是')]);
    expect(found({ number: '12345' })).toEqual([expect.stringContaining('字號「12345」不是')]);
    expect(found({ number: 'ab12' })).toEqual([expect.stringContaining('字號「ab12」不是')]);
  });

  it('refuses a sentence from after the crisis, and accepts one from the very minute of it', () => {
    expect(found({ incident: [{ ...line, at: crisisAt }] })).toEqual([]);
    expect(found({ incident: [{ ...line, at: crisisAt + 1 }] })).toEqual([expect.stringContaining('引用了急診之後才發生的事')]);
  });
});