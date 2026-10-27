/**
 * Report check (build plan P6): content/report.json and its strings read with the game's own
 * reader, and then the batch the rule of ux-spec 4.5 asks for: semesters played headless by every
 * archetype, and every closure notice and bankruptcy report they produce is written and checked.
 * The measure is the share of sentences worded by the fallback for want of a template, which must
 * be 0; the batch also checks the five-sentence limit, that nothing after the crisis is cited,
 * that no placeholder is left unfilled and that a report written twice reads the same.
 *
 *   node tools/check-reports.ts [contentDir] [seeds]     exit 1 on any problem
 */
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_INCIDENT, composeReport, readContent, reportProblems, runSemester, schemaProblems, semesterInputs, wordAll, type IncidentLine, type ReportDocument,
  type ReportFile, type StringsFile,
} from '../src/core/index.ts';
import { ARCHETYPES } from '../sim/semester/archetypes.ts';
import { bingeTwice, bingeWeek, contextFor, crunchWeek, drinkWeek, scenarioFor } from '../sim/semester/scenario.ts';
import { schemaMessage } from './check-content.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Editors on Windows may save a BOM, which JSON.parse rejects. */
const readJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, ''));

export interface ReportCheckOptions {
  readonly contentDir?: string;
  /** Seeds per scenario, archetype and skill. */
  readonly seeds?: number;
}

export interface ReportCheck {
  readonly problems: string[];
  /** What the batch produced; informational, never a failure by itself. */
  readonly report: string[];
}

const SCENARIOS = [
  ['平常學期', scenarioFor], ['聚餐週', bingeWeek], ['兩輪聚餐', bingeTwice], ['連夜聚餐', drinkWeek], ['趕工週', crunchWeek],
] as const;
const SKILLS = [0.2, 0.9] as const;

/** What must hold of any one report, whatever produced it; `index` is its place among the semester's reports. */
export function documentProblems(doc: ReportDocument, index: number, crisisAt: number, pages: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const expected = index === 0 ? 'notice' : 'bankruptcy';
  if (doc.kind !== expected) out.push(`應是${index === 0 ? '停業整頓通知' : '倒閉調查報告'}，寫出的是 ${doc.kind}`);
  if (doc.incident.length === 0) out.push('事故經過一句也沒有');
  if (doc.incident.length > MAX_INCIDENT) out.push(`事故經過有 ${doc.incident.length} 句，上限是 ${MAX_INCIDENT}`);
  if (!pages.has(doc.unlock)) out.push(`解鎖的手冊頁「${doc.unlock}」不在 handbook.json`);
  if (/[{}]/.test(doc.lines.join('\n'))) out.push('還有沒填的佔位符');
  if (!/^\d{4}$/.test(doc.number)) out.push(`字號「${doc.number}」不是日期 2 位加時刻 2 位`);
  for (const line of doc.incident) if (line.at > crisisAt) out.push(`引用了急診之後才發生的事（句型鍵「${line.key}」）`);
  return out;
}

export function checkReports(opts: ReportCheckOptions = {}): ReportCheck {
  const dir = resolve(opts.contentDir ?? join(ROOT, 'content'));
  const problems: string[] = [];
  const report: string[] = [];

  const raw = readJson(join(dir, 'report.json'));
  const schema = schemaProblems('report', raw);
  if (schema.length > 0) {
    return { problems: schema.map((p) => `report.json ${p.path || '（整個檔案）'}：${schemaMessage(p)}`), report };
  }
  const cfg = raw as ReportFile;
  const strings = readContent('strings', readJson(join(dir, 'strings', 'zh-TW.json'))) as StringsFile;
  const pages = new Set(readContent('handbook', readJson(join(dir, 'handbook.json'))).pages.map((p) => p.id));
  const text = (k: string): string => {
    const s = strings.strings[k];
    if (!s) throw new RangeError(`沒有「${k}」這條文字`);
    return s.text;
  };

  // Words that are missing or misplaced would make the batch fail on the first report, so they end it.
  problems.push(...reportProblems(cfg, (k) => strings.strings[k]?.text, pages));
  if (problems.length > 0) return { problems, report };

  const seen = new Set<string>();
  const once = (message: string): void => {
    if (!seen.has(message)) {
      seen.add(message);
      problems.push(message);
    }
  };
  const used = new Map<string, number>();
  const byKind = new Map<string, number>();
  const byTheme = new Map<string, number>();
  const generic = new Map<string, string>();
  let semesters = 0;
  let sentences = 0;
  let genericSentences = 0;

  const seeds = opts.seeds ?? 12;
  for (const [scenario, scenarioOf] of SCENARIOS) {
    for (const [archetype, strategy] of Object.entries(ARCHETYPES)) {
      for (const skill of SKILLS) {
        for (let seed = 1; seed <= seeds; seed++) {
          const where = `${scenario}／${archetype}／技能 ${skill}／種子 ${seed}`;
          const ctx = contextFor(skill, seed, { scenario: scenarioOf(seed) });
          const end = runSemester(ctx, strategy, seed);
          semesters++;
          let docs: ReportDocument[];
          let again: ReportDocument[];
          let candidates: IncidentLine[];
          try {
            const inputs = semesterInputs(end, ctx, { cfg, text, seed });
            const env = { cfg, text, seed };
            docs = inputs.map((input) => composeReport(input, env));
            again = inputs.map((input) => composeReport(input, env));
            candidates = inputs.flatMap((input) => wordAll(input, env));
          } catch (e) {
            once(`${where}：報告寫不出來：${(e as Error).message}`);
            continue;
          }
          const visits = end.history.filter((r) => r.crisis !== undefined);
          if (docs.length !== end.hospitals || docs.length !== visits.length) {
            once(`${where}：送醫 ${end.hospitals} 次，卻寫出 ${docs.length} 份報告`);
          }
          if (JSON.stringify(docs) !== JSON.stringify(again)) once(`${where}：同一局寫兩次，報告不一樣`);
          docs.forEach((doc, i) => {
            for (const m of documentProblems(doc, i, visits[i]?.crisis?.at ?? 0, pages)) once(`${where} 的第 ${i + 1} 份：${m}`);
            byKind.set(doc.kind, (byKind.get(doc.kind) ?? 0) + 1);
            byTheme.set(doc.theme, (byTheme.get(doc.theme) ?? 0) + 1);
            sentences += doc.incident.length;
            genericSentences += doc.generic;
          });
          // A report words only its best five, so a missing template shows up here first.
          for (const line of candidates) {
            used.set(line.key, (used.get(line.key) ?? 0) + 1);
            if (line.generic && !generic.has(line.key)) generic.set(line.key, where);
          }
        }
      }
    }
  }

  for (const [key, example] of generic) once(`句型鍵「${key}」沒有模板，句子會用通用句（例：${example}）；請在 content/report.json 的 keys 補上，或把它列進 ignore`);
  if (!byKind.has('notice')) once('批次裡沒有出現任何停業整頓通知，無從檢查');
  if (!byKind.has('bankruptcy')) once('批次裡沒有出現任何倒閉調查報告，無從檢查');

  const never = Object.keys(cfg.keys).filter((k) => !used.has(k));
  for (const k of never) once(`句型鍵「${k}」在整批模擬裡一次也沒出現，它的模板沒有被檢查到；請補一個會碰到它的情境，或刪掉這個鍵`);
  report.push(`${semesters} 個學期，${[...byKind].map(([k, n]) => `${k === 'notice' ? '停業整頓通知' : '倒閉調查報告'} ${n} 份`).join('、')}，共 ${sentences} 句事故經過`);
  report.push(`通用句比例：${genericSentences} / ${sentences}（目標 0）`);
  report.push(`成因分類：${[...byTheme].sort().map(([k, n]) => `${k} ${n}`).join('、')}`);
  report.push(`句型鍵 ${Object.keys(cfg.keys).length - never.length} / ${Object.keys(cfg.keys).length} 在批次中出現過`);
  return { problems, report };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [contentDir, seeds] = process.argv.slice(2);
  const { problems, report } = checkReports({ ...(contentDir ? { contentDir } : {}), ...(seeds ? { seeds: Number(seeds) } : {}) });
  for (const line of report) console.log(line);
  for (const p of problems) console.log(p);
  console.log(`report check: ${problems.length} problem(s) in ${relative(process.cwd(), resolve(contentDir ?? join(ROOT, 'content'))) || '.'}`);
  process.exit(problems.length ? 1 : 0);
}
