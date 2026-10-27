import type { ReportFile } from '../content/generated.ts';
import { COMPANY } from './types.ts';

type Doc = ReportFile['doc'];

/** Placeholders a sentence of the bank may use besides its declared vars (ux-spec 4.5). */
export const SINGLE_PLACEHOLDERS: readonly string[] = ['D', 'h', 'dept'];
export const MERGED_PLACEHOLDERS: readonly string[] = ['Dr', 'N', 'dept'];
export const FALLBACK_PLACEHOLDERS: readonly string[] = ['D', 'dept', 'label'];
const RESERVED: ReadonlySet<string> = new Set([...SINGLE_PLACEHOLDERS, ...MERGED_PLACEHOLDERS, ...FALLBACK_PLACEHOLDERS]);

/** The placeholders each text of the document frame may use. */
export const DOC_PLACEHOLDERS: Readonly<Record<keyof Doc, readonly string[]>> = {
  letterhead: [], recipient: [], explain: [], incidentHead: [], copyTo: [], copyCc: [], liverNote: [],
  unlockNew: [], unlockKnown: [], examMid: [], examFin: [], noticeWarning: [], bankruptAdviceHead: [],
  incidentItem: ['n', 'text'],
  chair: ['opinion'],
  causeSingle: ['list'], causeMulti: ['list'], causeLiverFasting: ['list'],
  noticeDate: ['day', 'time'], bankruptDate: ['day', 'time'],
  noticeNumber: ['number'], bankruptNumber: ['number'],
  noticeSubject: ['cause', 'stay'],
  noticePenalty: ['cap', 'debt', 'missed'],
  noticeMissed: ['exam'],
  noticeAdvice: ['page', 'unlock', 'education'],
  bankruptPrevious: ['day', 'cause', 'number'],
  bankruptSubject: ['cause'],
  bankruptResult: ['cause', 'situation'],
  bankruptAdvice1: ['page', 'unlock', 'education'],
  bankruptAdvice2: ['action'],
  bankruptAdvice3: ['sign'],
};

const PLACEHOLDER = /\{([^{}]*)\}/g;

export const placeholdersOf = (template: string): string[] => [...template.matchAll(PLACEHOLDER)].map((m) => m[1]!);

/** Replaces every {name}; a placeholder with no value is a bug in the caller or the content, never a blank. */
export function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(PLACEHOLDER, (_, name: string) => {
    const v = values[name];
    if (v === undefined) throw new RangeError(`placeholder {${name}} has no value in "${template}"`);
    return v;
  });
}

const TERMINAL = /[。！？!?]$/;

/**
 * What a schema cannot say about content/report.json, for the people who write it: every string
 * key exists, every placeholder is one the sentence's form can fill, the names agree. `text`
 * returns a string's text or undefined; `pages` are the handbook page ids. Chinese, because
 * content authors read it.
 */
export function reportProblems(cfg: ReportFile, text: (key: string) => string | undefined, pages: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const need = (where: string, key: string): string | undefined => {
    const t = text(key);
    if (t === undefined) out.push(`${where}用到的文字「${key}」不在 strings`);
    return t;
  };
  const checkText = (where: string, key: string, allowed: readonly string[], terminal = false): void => {
    const t = need(where, key);
    if (t === undefined) return;
    for (const p of new Set(placeholdersOf(t))) if (!allowed.includes(p)) out.push(`${where}的文字「${key}」用了不能用的佔位符 {${p}}（這裡可用：${allowed.map((a) => `{${a}}`).join('、') || '無'}）`);
    if (terminal && TERMINAL.test(t)) out.push(`${where}的文字「${key}」不要自己加句號，報告會補`);
  };

  if (!cfg.scopes[COMPANY]) out.push(`scopes 缺少「${COMPANY}」，沒有部門可指的句子會找不到稱呼`);
  for (const [id, s] of Object.entries(cfg.scopes)) {
    need(`scopes.${id}.dept `, s.dept);
    if (s.symptom !== undefined) need(`scopes.${id}.symptom `, s.symptom);
    if (!cfg.themes[s.theme]) out.push(`scopes.${id} 的 theme「${s.theme}」不在 themes`);
  }
  for (const [name, th] of Object.entries(cfg.themes)) {
    if (!pages.has(th.page)) out.push(`themes.${name} 的手冊頁「${th.page}」不在 handbook.json`);
    for (const k of [...th.education, th.situation, th.action, th.sign]) need(`themes.${name} `, k);
  }
  if (!cfg.themes[cfg.defaultTheme]) out.push(`defaultTheme「${cfg.defaultTheme}」不在 themes`);
  for (const t of cfg.themeOrder) if (!cfg.themes[t]) out.push(`themeOrder 的「${t}」不在 themes`);
  for (const t of Object.keys(cfg.themes)) if (!cfg.themeOrder.includes(t)) out.push(`themes.${t} 沒有排進 themeOrder，同分時無從取捨`);

  checkText('fallback ', cfg.fallback, FALLBACK_PLACEHOLDERS, true);
  for (const [id, key] of Object.entries(cfg.nodes)) if (!cfg.keys[key]) out.push(`nodes 的「${id}」指向不存在的句型鍵「${key}」`);

  for (const [name, entry] of Object.entries(cfg.keys)) {
    if (entry.theme !== undefined && !cfg.themes[entry.theme]) out.push(`keys.${name} 的 theme「${entry.theme}」不在 themes`);
    const vars = Object.keys(entry.vars ?? {});
    for (const v of vars) if (RESERVED.has(v)) out.push(`keys.${name} 的變數「${v}」與內建佔位符同名`);
    const forms = [['single', entry.single, [...SINGLE_PLACEHOLDERS, ...vars]], ['run', entry.run, [...MERGED_PLACEHOLDERS, ...vars]], ['spread', entry.spread, [...MERGED_PLACEHOLDERS, ...vars]]] as const;
    for (const [form, keys, allowed] of forms) {
      for (const k of keys ?? []) checkText(`keys.${name}.${form} `, k, allowed, true);
    }
  }

  for (const [group, keys] of Object.entries(cfg.opinions)) for (const k of keys) need(`opinions.${group} `, k);
  for (const [name, key] of Object.entries(cfg.doc) as [keyof Doc, string][]) checkText(`doc.${name} `, key, DOC_PLACEHOLDERS[name]);
  return out;
}
