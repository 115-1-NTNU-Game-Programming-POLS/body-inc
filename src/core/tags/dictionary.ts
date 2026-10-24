import type { Tag, TagsFile } from '../content/generated.ts';
import { schemaProblems } from '../content/read.ts';
import { schemaProblemText } from '../content/schema.ts';
import { checkCondition, ConditionError, parseCondition, type Condition, type NameKind } from './condition.ts';

/**
 * The state tag dictionary (design doc 13.4): the shared interface between story mode,
 * semester mode and combat. Modifiers are named condition aliases in the same dictionary
 * (design doc 8.7). The data lives in content/tags.json and is passed in already parsed.
 *
 * Duration rules: `persistent` until a rule clears it; `hours` for a fixed span of rule time;
 * `untilWake` until the next wake-up; `nextDay` through the logical day after the one it was set.
 * Wake-ups count instead of clock hours because wake times differ between days.
 */
export type TagType = Tag['type'];
export type SourceKind = Tag['sources'][number];

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

function readTag(t: Tag, problems: string[]): TagDef | undefined {
  const where = `tag "${t.name}"`;
  const before = problems.length;
  if (t.unit !== undefined && t.type !== 'number') problems.push(`${where}: unit is only for number tags`);
  if ((t.duration === 'hours') !== (t.hours !== undefined)) problems.push(`${where}: hours is required with duration "hours" and only then`);
  if (problems.length > before) return undefined;
  return {
    name: t.name,
    type: t.type,
    sources: t.sources,
    duration: t.duration === 'hours' ? { kind: 'hours', hours: t.hours! } : { kind: t.duration },
    facts: t.facts,
  };
}

/** Field shapes come from content/schema/tags.schema.json; this checks what a schema cannot. */
export function loadDictionary(raw: unknown): TagDictionary {
  const shape = schemaProblems('tags', raw);
  if (shape.length > 0) throw new DictionaryError(shape.map(schemaProblemText));
  const file = raw as TagsFile;

  const problems: string[] = [];
  const tags = new Map<string, TagDef>();
  // Names of tags that failed to load, so modifiers using them do not add a second, misleading problem.
  const rejected = new Set<string>();
  for (const r of file.tags) {
    const t = readTag(r, problems);
    if (!t) {
      rejected.add(r.name);
      continue;
    }
    if (tags.has(t.name)) problems.push(`tag "${t.name}": defined twice`);
    tags.set(t.name, t);
  }

  // Aliases are checked against tags only, so an alias can never refer to another alias (no cycles).
  const tagKind = (n: string): NameKind => tags.get(n)?.type;
  const aliases = new Map<string, AliasDef>();
  for (const { name, when, facts } of file.modifiers) {
    const where = `modifier "${name}"`;
    try {
      const condition = parseCondition(when);
      const bad = checkCondition(condition, tagKind);
      for (const p of bad) {
        if (!(p.code === 'unknown-tag' && p.name !== undefined && rejected.has(p.name))) problems.push(`${where}: ${p.code} "${p.term}"`);
      }
      if (aliases.has(name)) problems.push(`${where}: defined twice`);
      if (bad.length === 0) aliases.set(name, { name, condition, facts });
    } catch (e) {
      if (!(e instanceof ConditionError)) throw e;
      problems.push(`${where}: ${e.problem.code} "${e.problem.term}"`);
    }
  }

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
