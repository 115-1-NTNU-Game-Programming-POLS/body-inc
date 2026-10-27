import type { ReportFile } from '../content/generated.ts';
import { fillTemplate } from './bank.ts';
import { dayRange, clockHour, PERIOD_WORD, periodOf, zhCount } from './time.ts';
import { COMPANY, SCORES, type SentenceGroup, type StringLookup } from './types.ts';

export interface RenderEnv {
  readonly cfg: ReportFile;
  readonly text: StringLookup;
  /** Picks among the variants of a sentence, so two runs do not read alike (ux-spec 4.5). */
  readonly seed: number;
}

/** FNV-1a over UTF-16 units: a stable hash with no clock or Math.random in it. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const pickOne = <T>(options: readonly T[], seed: number, salt: string): T => {
  if (options.length === 0) throw new RangeError(`nothing to pick from for "${salt}"`);
  return options[fnv1a(`${seed}|${salt}`) % options.length]!;
};

export const groupScore = (cfg: ReportFile, g: SentenceGroup): number => SCORES[cfg.keys[g.key]?.score ?? 'effect'];

export interface Rendered {
  readonly text: string;
  readonly generic: boolean;
}

function deptOf(env: RenderEnv, scope: string | undefined): string | undefined {
  const s = env.cfg.scopes[scope ?? COMPANY];
  return s ? env.text(s.dept) : undefined;
}

/**
 * ux-spec 4.6, relative dates: the first sentence gives the date in full; after it, the same day
 * reads 同日 (or 當晚 once evening has come), the next day 隔天, anything further the date again.
 */
function dateWord(g: SentenceGroup, prev: SentenceGroup | undefined, period: boolean): string {
  const first = g.members[0]!;
  const word = PERIOD_WORD[periodOf(first.minute)];
  const day = g.firstDay;
  if (prev !== undefined && prev.lastDay === day) {
    const late = periodOf(first.minute) === 'evening' || periodOf(first.minute) === 'night';
    return period ? `同日${word}` : late ? '當晚' : '同日';
  }
  if (prev !== undefined && prev.lastDay + 1 === day) return period ? `隔天${word}` : '隔天';
  return `第 ${day} 天${period ? word : ''}`;
}

const fmt = (v: number): string => String(Math.round(v * 100) / 100);

function varsOf(g: SentenceGroup, vars: NonNullable<ReportFile['keys'][string]['vars']>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, spec] of Object.entries(vars)) {
    const values = g.members.map((m) => m.fact.vars?.[name]).filter((v): v is string | number => v !== undefined);
    if (values.length === 0) throw new RangeError(`fact "${g.key}" carries no "${name}" for its sentence`);
    const last = values[values.length - 1]!;
    const nums = values.filter((v): v is number => typeof v === 'number');
    if (nums.length !== values.length) {
      out[name] = String(last);
      continue;
    }
    const v = spec.agg === 'sum' ? nums.reduce((a, b) => a + b, 0) : spec.agg === 'min' ? Math.min(...nums) : Math.max(...nums);
    out[name] = spec.numeral === 'zh' ? zhCount(v) : fmt(v);
  }
  return out;
}

/** Words one merged group as a sentence, without its closing full stop. */
export function renderGroup(g: SentenceGroup, prev: SentenceGroup | undefined, env: RenderEnv): Rendered {
  const entry = env.cfg.keys[g.key];
  const first = g.members[0]!;
  const dept = deptOf(env, g.scope);
  if (entry === undefined) {
    const label = String(first.fact.vars?.['label'] ?? g.key);
    return { text: fillTemplate(env.text(env.cfg.fallback), { D: dateWord(g, prev, false), dept: dept ?? '', label }), generic: true };
  }
  const variants = g.form === 'single' ? entry.single : g.form === 'run' ? entry.run : entry.spread;
  if (variants === undefined) throw new RangeError(`"${g.key}" has no ${g.form} wording`);
  const values: Record<string, string> = {
    ...varsOf(g, entry.vars ?? {}),
    D: dateWord(g, prev, entry.period === true),
    Dr: dayRange(g.firstDay, g.lastDay),
    N: zhCount(g.days.length),
    h: String(clockHour(first.minute)),
    ...(dept !== undefined ? { dept } : {}),
  };
  const template = env.text(pickOne(variants, env.seed, `${g.key}|${g.scope ?? ''}|${g.form}|${g.firstDay}`));
  return { text: fillTemplate(template, values), generic: false };
}
