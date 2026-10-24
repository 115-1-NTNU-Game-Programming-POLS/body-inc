import { checkCondition, ConditionError, NAME, parseCondition, type Condition, type NameKind } from './condition.ts';

/**
 * The state tag dictionary (design doc 13.4): the shared interface between story mode,
 * semester mode and combat. Modifiers are named condition aliases in the same dictionary
 * (design doc 8.7). The data lives in content/tags.json and is passed in already parsed.
 *
 * Duration rules: `persistent` until a rule clears it; `hours` for a fixed span of rule time;
 * `untilWake` until the next wake-up; `nextDay` through the logical day after the one it was set.
 * Wake-ups count instead of clock hours because wake times differ between days.
 */
export type TagType = 'number' | 'boolean';
export type SourceKind = 'card' | 'event' | 'chapter' | 'rule';

export type TagDuration =
  | { readonly kind: 'persistent' }
  | { readonly kind: 'hours'; readonly hours: number }
  | { readonly kind: 'untilWake' }
  | { readonly kind: 'nextDay' };

export interface TagDef {
  readonly name: string;
  readonly type: TagType;
  readonly sources: readonly SourceKind[];
  readonly duration: TagDuration;
  /** Fact-check table entries ("17", "pending:1"); reviewed by the fact-check owner, not by code. */
  readonly facts: readonly string[];
}

export interface AliasDef {
  readonly name: string;
  readonly condition: Condition;
  readonly facts: readonly string[];
}

export interface TagDictionary {
  readonly tags: ReadonlyMap<string, TagDef>;
  readonly aliases: ReadonlyMap<string, AliasDef>;
}

export class DictionaryError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`tag dictionary is invalid:\n  ${problems.join('\n  ')}`);
    this.problems = problems;
  }
}

const TYPES: readonly string[] = ['number', 'boolean'];
const SOURCES: readonly string[] = ['card', 'event', 'chapter', 'rule'];
const DURATIONS: readonly string[] = ['persistent', 'hours', 'untilWake', 'nextDay'];

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');

function readTag(raw: unknown, i: number, problems: string[]): TagDef | undefined {
  const at = `tags[${i}]`;
  if (!isObj(raw)) return void problems.push(`${at}: not an object`);
  const { name, type, sources, duration, hours, facts, unit, ...rest } = raw;
  const where = typeof name === 'string' ? `tag "${name}"` : at;
  const before = problems.length;
  for (const k of Object.keys(rest)) problems.push(`${where}: unknown field "${k}"`);
  if (typeof name !== 'string' || !NAME.test(name) || name.includes('.')) problems.push(`${where}: name must be lower_snake_case`);
  if (typeof type !== 'string' || !TYPES.includes(type)) problems.push(`${where}: type must be number or boolean`);
  if (unit !== undefined && (typeof unit !== 'string' || type !== 'number')) problems.push(`${where}: unit is only for number tags`);
  if (!strings(sources) || sources.length === 0 || !sources.every((s) => SOURCES.includes(s))) {
    problems.push(`${where}: sources must be a non-empty list of ${SOURCES.join(', ')}`);
  }
  if (typeof duration !== 'string' || !DURATIONS.includes(duration)) problems.push(`${where}: duration must be one of ${DURATIONS.join(', ')}`);
  if ((duration === 'hours') !== (hours !== undefined)) problems.push(`${where}: hours is required with duration "hours" and only then`);
  if (hours !== undefined && (typeof hours !== 'number' || !(hours > 0))) problems.push(`${where}: hours must be positive`);
  if (!strings(facts)) problems.push(`${where}: facts must be a list of strings`);
  if (problems.length > before) return undefined;
  return {
    name: name as string,
    type: type as TagType,
    sources: sources as SourceKind[],
    duration: duration === 'hours' ? { kind: 'hours', hours: hours as number } : { kind: duration as 'persistent' | 'untilWake' | 'nextDay' },
    facts: facts as string[],
  };
}

export function loadDictionary(raw: unknown): TagDictionary {
  const problems: string[] = [];
  if (!isObj(raw) || raw['version'] !== 1 || !Array.isArray(raw['tags']) || !Array.isArray(raw['modifiers'])) {
    throw new DictionaryError(['expected { "version": 1, "tags": [...], "modifiers": [...] }']);
  }
  const tags = new Map<string, TagDef>();
  // Names of tags that failed to load, so modifiers using them do not add a second, misleading problem.
  const rejected = new Set<string>();
  raw['tags'].forEach((r, i) => {
    const t = readTag(r, i, problems);
    if (!t) {
      if (isObj(r) && typeof r['name'] === 'string') rejected.add(r['name']);
      return;
    }
    if (tags.has(t.name)) problems.push(`tag "${t.name}": defined twice`);
    tags.set(t.name, t);
  });

  // Aliases are checked against tags only, so an alias can never refer to another alias (no cycles).
  const tagKind = (n: string): NameKind => tags.get(n)?.type;
  const aliases = new Map<string, AliasDef>();
  raw['modifiers'].forEach((r, i) => {
    if (!isObj(r)) return void problems.push(`modifiers[${i}]: not an object`);
    const { name, when, facts, ...rest } = r;
    const where = typeof name === 'string' ? `modifier "${name}"` : `modifiers[${i}]`;
    for (const k of Object.keys(rest)) problems.push(`${where}: unknown field "${k}"`);
    if (typeof name !== 'string' || !name.startsWith('mod.') || !NAME.test(name)) {
      return void problems.push(`${where}: name must look like mod.lower_snake_case`);
    }
    if (!strings(facts)) problems.push(`${where}: facts must be a list of strings`);
    if (typeof when !== 'string') return void problems.push(`${where}: when must be a condition string`);
    try {
      const condition = parseCondition(when);
      const bad = checkCondition(condition, tagKind);
      for (const p of bad) {
        if (!(p.code === 'unknown-tag' && p.name !== undefined && rejected.has(p.name))) problems.push(`${where}: ${p.code} "${p.term}"`);
      }
      if (aliases.has(name)) problems.push(`${where}: defined twice`);
      if (bad.length === 0) aliases.set(name, { name, condition, facts: strings(facts) ? facts : [] });
    } catch (e) {
      if (!(e instanceof ConditionError)) throw e;
      problems.push(`${where}: ${e.problem.code} "${e.problem.term}"`);
    }
  });

  if (problems.length > 0) throw new DictionaryError(problems);
  return { tags, aliases };
}

export function nameKind(dict: TagDictionary, name: string): NameKind {
  if (dict.aliases.has(name)) return 'alias';
  return dict.tags.get(name)?.type;
}

/** Parses and type-checks a condition against the dictionary; throws the first problem. */
export function compileCondition(dict: TagDictionary, text: string): Condition {
  const cond = parseCondition(text);
  const [first] = checkCondition(cond, (n) => nameKind(dict, n));
  if (first) throw new ConditionError(first);
  return cond;
}
