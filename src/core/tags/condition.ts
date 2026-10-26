/**
 * The `when` condition language of design doc 13.3: tag names, comparisons, `!` negation and
 * `,` meaning and. Nothing else (no or, no parentheses), so non-programmers can read every
 * condition in a Tiled property. The map check and the game share this parser.
 *
 * `!` applies only to a bare name: `!breakfast` is valid, `!sleep_debt>=2` is not (write
 * `sleep_debt<2`). Bare names must be boolean tags or modifier aliases; numeric tags need a
 * comparison, so `caffeine` alone is rejected instead of silently meaning `caffeine>0`.
 */

export type CompareOp = '>=' | '<=' | '>' | '<' | '==' | '!=';

export type Term =
  | { readonly kind: 'flag'; readonly name: string; readonly negated: boolean }
  | { readonly kind: 'compare'; readonly name: string; readonly op: CompareOp; readonly value: number };

export interface Condition {
  readonly text: string;
  readonly terms: readonly Term[];
}

/** Codes, not display text: tools turn them into Chinese messages (core holds no UI strings). */
export type ConditionProblemCode =
  | 'empty'
  | 'empty-term'
  | 'syntax'
  | 'negated-compare'
  | 'unknown-tag'
  | 'not-boolean'
  | 'not-number';

export interface ConditionProblem {
  readonly code: ConditionProblemCode;
  readonly text: string;
  readonly term: string;
  readonly name?: string;
}

export class ConditionError extends Error {
  readonly problem: ConditionProblem;
  constructor(problem: ConditionProblem) {
    super(`condition "${problem.text}": ${problem.code} in "${problem.term}"`);
    this.problem = problem;
  }
}

export const NAME = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/;
const TERM = /^(!?)\s*([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)\s*(?:(>=|<=|==|!=|>|<)\s*(-?\d+(?:\.\d+)?))?$/;

export function parseCondition(text: string): Condition {
  if (text.trim() === '') throw new ConditionError({ code: 'empty', text, term: '' });
  const terms = text.split(',').map((raw): Term => {
    const term = raw.trim();
    if (term === '') throw new ConditionError({ code: 'empty-term', text, term });
    const m = TERM.exec(term);
    if (!m) throw new ConditionError({ code: 'syntax', text, term });
    const [, bang, name, op, num] = m as unknown as [string, string, string, CompareOp | undefined, string | undefined];
    if (op === undefined) return { kind: 'flag', name, negated: bang === '!' };
    if (bang === '!') throw new ConditionError({ code: 'negated-compare', text, term, name });
    return { kind: 'compare', name, op, value: Number(num) };
  });
  return { text, terms };
}

/** What a name means to the condition language; supplied by the tag dictionary. */
export type NameKind = 'boolean' | 'number' | 'alias' | undefined;

export function checkCondition(cond: Condition, kindOf: (name: string) => NameKind): ConditionProblem[] {
  const out: ConditionProblem[] = [];
  for (const t of cond.terms) {
    const kind = kindOf(t.name);
    const term = termText(t);
    if (kind === undefined) out.push({ code: 'unknown-tag', text: cond.text, term, name: t.name });
    else if (t.kind === 'flag' && kind === 'number') out.push({ code: 'not-boolean', text: cond.text, term, name: t.name });
    else if (t.kind === 'compare' && kind !== 'number') out.push({ code: 'not-number', text: cond.text, term, name: t.name });
  }
  return out;
}

export function termText(t: Term): string {
  return t.kind === 'flag' ? `${t.negated ? '!' : ''}${t.name}` : `${t.name}${t.op}${t.value}`;
}

/**
 * False only when the terms provably cannot all hold at once, judging each name on its own: a flag
 * both on and off, or comparisons on one number that leave no value. Number tags never go below 0.
 * Anything it cannot rule out (an alias against the tags behind it, say) counts as possible, so a
 * check built on it never lets a real clash through.
 */
export function canAllHold(terms: readonly Term[]): boolean {
  const names = new Set(terms.map((t) => t.name));
  for (const name of names) {
    const mine = terms.filter((t) => t.name === name);
    const flags = mine.filter((t) => t.kind === 'flag');
    if (flags.some((t) => t.negated) && flags.some((t) => !t.negated)) return false;
    let lo = { v: 0, strict: false };
    let hi = { v: Infinity, strict: false };
    const eq: number[] = [];
    const ne: number[] = [];
    for (const t of mine) {
      if (t.kind !== 'compare') continue;
      const strict = t.op === '>' || t.op === '<';
      if ((t.op === '>=' || t.op === '>') && (t.value > lo.v || (t.value === lo.v && strict))) lo = { v: t.value, strict };
      if ((t.op === '<=' || t.op === '<') && (t.value < hi.v || (t.value === hi.v && strict))) hi = { v: t.value, strict };
      if (t.op === '==') eq.push(t.value);
      if (t.op === '!=') ne.push(t.value);
    }
    const inside = (v: number) => (lo.strict ? v > lo.v : v >= lo.v) && (hi.strict ? v < hi.v : v <= hi.v) && !ne.includes(v);
    if (eq.length > 0) {
      if (eq.some((v) => v !== eq[0]) || !inside(eq[0]!)) return false;
    } else if (lo.v > hi.v || (lo.v === hi.v && !inside(lo.v))) return false;
  }
  return true;
}

/**
 * Evaluates against a value lookup. A flag that is an alias is resolved through `alias`;
 * absent tags read as false or 0, so a fresh chapter has every tag off.
 */
export function evaluateCondition(
  cond: Condition,
  valueOf: (name: string) => number | boolean | undefined,
  alias: (name: string) => Condition | undefined = () => undefined,
): boolean {
  return cond.terms.every((t) => {
    if (t.kind === 'flag') {
      const a = alias(t.name);
      const on = a ? evaluateCondition(a, valueOf, alias) : valueOf(t.name) === true;
      return on !== t.negated;
    }
    const v = valueOf(t.name);
    const n = typeof v === 'number' ? v : 0;
    switch (t.op) {
      case '>=': return n >= t.value;
      case '<=': return n <= t.value;
      case '>': return n > t.value;
      case '<': return n < t.value;
      case '==': return n === t.value;
      case '!=': return n !== t.value;
    }
  });
}
