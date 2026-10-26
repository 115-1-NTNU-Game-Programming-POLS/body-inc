import { checkCondition, ConditionError, parseCondition, type Condition, type ConditionProblem } from '../tags/condition.ts';
import { nameKind, type TagDictionary } from '../tags/dictionary.ts';
import { wholeMinutes } from '../clock.ts';
import { isTool, type Tool } from '../tools.ts';
import { parseCsvRecords } from './csv.ts';

/**
 * Dialogue tables (design doc 13.2, build plan P5). A CSV row is one line; rows sharing a
 * dialogueId are one conversation, played in `order`. The game and the content check read the
 * files through this module, so a file the check accepts is a file the game can play.
 *
 * Flow: a spoken line is followed by its `next` (an order, or `end`), or by the row after it.
 * Rows spoken by `operator` are the player's replies: a run of them is one choice of 2 to 3
 * options, and an option is followed by its own `next`, or by the first row after the run.
 * `next` may only point forward, so every conversation ends.
 */

export const DIALOGUE_COLUMNS = ['dialogueId', 'order', 'speaker', 'expression', 'text', 'condition', 'effect', 'next', 'fact'] as const;

/** The semi-silent protagonist (design doc 11): never speaks on its own, only picks among replies. */
export const OPERATOR_SPEAKER = 'operator';
export const OPTION_COUNT = { min: 2, max: 3 } as const;

/** What a line does when it is shown, or when it is chosen if it is a reply. */
export type Effect =
  /** `tag:breakfast` turns a boolean tag on. */
  | { readonly kind: 'flag'; readonly name: string }
  /** `tag:caffeine=100` sets a number tag, `tag:sleep_debt+1` adds to it. */
  | { readonly kind: 'amount'; readonly name: string; readonly mode: 'set' | 'add'; readonly value: number }
  /** `clock:10` moves the chapter clock on (design doc 7: talking takes time). */
  | { readonly kind: 'clock'; readonly minutes: number }
  /** `unlock:caffeine` opens a handbook page. */
  | { readonly kind: 'unlock'; readonly id: string }
  /** `grant:stamp` hands the operator a tool for the rest of the run. */
  | { readonly kind: 'grant'; readonly tool: Tool };

export interface Line {
  readonly dialogueId: string;
  readonly order: number;
  readonly speaker: string;
  readonly expression: string;
  readonly text: string;
  readonly when: Condition | undefined;
  readonly effects: readonly Effect[];
  readonly next: number | 'end' | undefined;
  /** Fact-check table entry: empty, a number, `pending:<n>` or `general`. */
  readonly fact: string;
  /** Row of the CSV as a spreadsheet shows it (the header is row 1), for messages. */
  readonly row: number;
}

export interface Dialogue {
  readonly id: string;
  /** The file the conversation was read from, for messages. */
  readonly file: string;
  /** Sorted by order. */
  readonly lines: readonly Line[];
}

export type DialogueTable = ReadonlyMap<string, Dialogue>;

export const isOption = (l: Line): boolean => l.speaker === OPERATOR_SPEAKER;

/** Codes, not display text: tools turn them into Chinese messages (core holds no UI strings). */
export type DialogueProblemCode =
  | 'header'
  | 'columns'
  | 'id-empty'
  | 'order'
  | 'order-duplicate'
  | 'speaker-empty'
  | 'expression-empty'
  | 'text-empty'
  | 'condition'
  | 'effect'
  | 'next'
  | 'next-missing'
  | 'next-backward'
  | 'next-into-options'
  | 'fact'
  | 'options-count'
  | 'unreachable'
  | 'duplicate-dialogue';

/** `tool`: a grant naming no tool, or in a card, which plays outside the run that would keep it. */
export type EffectProblemCode = 'syntax' | 'unknown-tag' | 'alias' | 'tag-source' | 'tag-form' | 'minutes' | 'tool';

export interface DialogueProblem {
  readonly code: DialogueProblemCode;
  readonly file: string;
  readonly row?: number;
  readonly dialogueId?: string;
  readonly order?: number;
  /** The cell or part of a cell that is wrong, or a count for `options-count`. */
  readonly detail?: string;
  readonly condition?: ConditionProblem;
  readonly effect?: EffectProblemCode;
}

export class DialogueTableError extends Error {
  readonly problems: readonly DialogueProblem[];
  constructor(problems: readonly DialogueProblem[]) {
    super(`dialogue files are invalid:\n  ${problems.map((p) => `${p.file}${p.row ? ` row ${p.row}` : ''}: ${p.code}${p.detail ? ` "${p.detail}"` : ''}`).join('\n  ')}`);
    this.problems = problems;
  }
}

const FACT = /^(|\d+|pending:\d+|general)$/;
// A name may carry the `mod.` prefix of modifiers, so that setting one gets its own message.
const FLAG_OR_AMOUNT = /^tag:((?:mod\.)?[a-z][a-z0-9_]*)(?:([=+])(\d+(?:\.\d+)?))?$/;
const UNLOCK = /^unlock:([a-z][a-z0-9_]*)$/;
const CLOCK = /^clock:(.*)$/;
const GRANT = /^grant:(.*)$/;

/** The tag sources that let a conversation set a tag: story events, not cards or derived rules. */
export const DIALOGUE_SOURCES: readonly string[] = ['event', 'chapter'];

export interface EffectProblem {
  readonly code: EffectProblemCode;
  readonly part: string;
}

/**
 * Effects of one cell, `;` separated, e.g. `tag:breakfast;clock:10`. `sources` are the dictionary
 * sources that let the caller set a tag: a conversation sets story-event tags, a card sets card tags.
 */
export function parseEffects(text: string, dict: TagDictionary, sources: readonly string[] = DIALOGUE_SOURCES): { effects: Effect[]; problems: EffectProblem[] } {
  const effects: Effect[] = [];
  const problems: EffectProblem[] = [];
  if (text.trim() === '') return { effects, problems };
  for (const raw of text.split(';')) {
    const part = raw.trim();
    const bad = (code: EffectProblemCode) => problems.push({ code, part });
    const clock = CLOCK.exec(part);
    if (clock) {
      const minutes = wholeMinutes(clock[1]!);
      if (minutes === undefined) bad('minutes');
      else effects.push({ kind: 'clock', minutes });
      continue;
    }
    const unlock = UNLOCK.exec(part);
    if (unlock) {
      effects.push({ kind: 'unlock', id: unlock[1]! });
      continue;
    }
    const grant = GRANT.exec(part);
    if (grant) {
      const tool = grant[1]!;
      // Only a conversation is played inside a run; an opening or closing card has no run to keep the tool.
      if (isTool(tool) && sources.includes('event') && !sources.includes('card')) effects.push({ kind: 'grant', tool });
      else bad('tool');
      continue;
    }
    const tag = FLAG_OR_AMOUNT.exec(part);
    if (!tag) {
      bad('syntax');
      continue;
    }
    const [, name = '', op, num] = tag;
    // Modifiers are conditions over tags, not tags, so they cannot be set.
    const def = dict.tags.get(name);
    if (!def) bad(dict.aliases.has(name) ? 'alias' : 'unknown-tag');
    else if (!def.sources.some((s) => sources.includes(s))) bad('tag-source');
    else if (def.type === 'boolean' && op === undefined) effects.push({ kind: 'flag', name });
    else if (def.type === 'number' && op !== undefined) effects.push({ kind: 'amount', name, mode: op === '=' ? 'set' : 'add', value: Number(num) });
    else bad('tag-form');
  }
  return { effects, problems };
}

/** Index of the line with this order, or -1. */
export const indexOfOrder = (d: Dialogue, order: number): number => d.lines.findIndex((l) => l.order === order);

/** The run of reply rows around line `i`, or undefined when `i` is a spoken line. */
export function optionGroup(d: Dialogue, i: number): { start: number; end: number } | undefined {
  if (!isOption(d.lines[i]!)) return undefined;
  let start = i;
  while (start > 0 && isOption(d.lines[start - 1]!)) start--;
  let end = i + 1;
  while (end < d.lines.length && isOption(d.lines[end]!)) end++;
  return { start, end };
}

/** Where the flow goes after leaving line `i`: an index, or `d.lines.length` for the end. */
export function exitOf(d: Dialogue, i: number): number {
  const l = d.lines[i]!;
  if (l.next === 'end') return d.lines.length;
  if (l.next !== undefined) return indexOfOrder(d, l.next);
  return optionGroup(d, i)?.end ?? i + 1;
}

interface Cells {
  readonly file: string;
  readonly row: number;
  readonly dialogueId: string;
}

function rowProblems(c: Cells, cells: readonly string[], dict: TagDictionary, out: DialogueProblem[]): Line | undefined {
  const [, orderText = '', speaker = '', expression = '', text = '', condition = '', effect = '', next = '', fact = ''] = cells.map((s) => s.trim());
  const here = { file: c.file, row: c.row, dialogueId: c.dialogueId };
  const before = out.length;
  const order = /^[1-9][0-9]*$/.test(orderText) ? Number(orderText) : undefined;
  if (order === undefined) out.push({ ...here, code: 'order', detail: orderText });
  const at = order === undefined ? here : { ...here, order };
  if (speaker === '') out.push({ ...at, code: 'speaker-empty' });
  if (expression === '' && speaker !== OPERATOR_SPEAKER) out.push({ ...at, code: 'expression-empty' });
  if (text === '') out.push({ ...at, code: 'text-empty' });
  let when: Condition | undefined;
  if (condition !== '') {
    try {
      const parsed = parseCondition(condition);
      const found = checkCondition(parsed, (n) => nameKind(dict, n));
      if (found.length > 0) out.push({ ...at, code: 'condition', detail: condition, condition: found[0]! });
      else when = parsed;
    } catch (e) {
      if (!(e instanceof ConditionError)) throw e;
      out.push({ ...at, code: 'condition', detail: condition, condition: e.problem });
    }
  }
  const fx = parseEffects(effect, dict);
  for (const p of fx.problems) out.push({ ...at, code: 'effect', detail: p.part, effect: p.code });
  let target: number | 'end' | undefined;
  if (next === 'end') target = 'end';
  else if (next !== '') {
    if (/^[1-9][0-9]*$/.test(next)) target = Number(next);
    else out.push({ ...at, code: 'next', detail: next });
  }
  if (!FACT.test(fact)) out.push({ ...at, code: 'fact', detail: fact });
  if (out.length > before || order === undefined) return undefined;
  return { dialogueId: c.dialogueId, order, speaker, expression, text, when, effects: fx.effects, next: target, fact, row: c.row };
}

/** Structure of one conversation whose rows each read cleanly: replies, `next` targets, reachability. */
function flowProblems(file: string, d: Dialogue, out: DialogueProblem[]): void {
  const at = (l: Line) => ({ file, row: l.row, dialogueId: d.id, order: l.order });
  for (let i = 0; i < d.lines.length; i++) {
    const g = optionGroup(d, i);
    if (g && g.start === i) {
      const n = g.end - g.start;
      if (n < OPTION_COUNT.min || n > OPTION_COUNT.max) out.push({ ...at(d.lines[i]!), code: 'options-count', detail: String(n) });
    }
    const l = d.lines[i]!;
    if (typeof l.next !== 'number') continue;
    const target = indexOfOrder(d, l.next);
    if (target < 0) out.push({ ...at(l), code: 'next-missing', detail: String(l.next) });
    else if (l.next <= l.order) out.push({ ...at(l), code: 'next-backward', detail: String(l.next) });
    else if (optionGroup(d, target)?.start !== target && isOption(d.lines[target]!)) out.push({ ...at(l), code: 'next-into-options', detail: String(l.next) });
  }
  if (out.some((p) => p.dialogueId === d.id && p.file === file)) return;

  // A line is reachable if some tag state shows it. A spoken line with a condition may be skipped
  // and hands over to the row after it; a run of replies is skipped only when each has a condition.
  const seen = new Set<number>();
  const todo = [0];
  while (todo.length > 0) {
    const i = todo.pop()!;
    if (i >= d.lines.length || seen.has(i)) continue;
    const g = optionGroup(d, i);
    if (g) {
      for (let k = g.start; k < g.end; k++) {
        seen.add(k);
        todo.push(exitOf(d, k));
      }
      if (d.lines.slice(g.start, g.end).every((l) => l.when !== undefined)) todo.push(g.end);
    } else {
      seen.add(i);
      todo.push(exitOf(d, i));
      if (d.lines[i]!.when !== undefined) todo.push(i + 1);
    }
  }
  for (let i = 0; i < d.lines.length; i++) {
    if (!seen.has(i)) out.push({ ...at(d.lines[i]!), code: 'unreachable' });
  }
}

export interface DialogueFile {
  /** Label for messages, e.g. content/dialogue/prologue.csv. */
  readonly file: string;
  readonly text: string;
}

/**
 * Reads CSV files into a table. A conversation with a problem in any of its rows is left out of
 * the table, so the caller never plays half of one; the problems say what to fix.
 */
export function readDialogues(files: readonly DialogueFile[], dict: TagDictionary): { table: DialogueTable; problems: DialogueProblem[] } {
  const problems: DialogueProblem[] = [];
  const table = new Map<string, Dialogue>();
  const owner = new Map<string, string>();
  for (const { file, text } of files) {
    const [head, ...records] = parseCsvRecords(text.replace(/^\uFEFF/, ''));
    const header = head?.cells ?? [];
    if (header.map((h) => h.trim()).join(',') !== DIALOGUE_COLUMNS.join(',')) {
      problems.push({ code: 'header', file, detail: header.join(',') });
      continue;
    }
    const lines = new Map<string, Line[]>();
    const broken = new Set<string>();
    for (const { cells, row } of records) {
      const id = (cells[0] ?? '').trim();
      // A conversation with a row that cannot be read is left out whole, so nothing is judged on half of it.
      if (cells.length !== header.length) {
        if (id !== '') broken.add(id);
        problems.push({ code: 'columns', file, row, detail: String(cells.length) });
        continue;
      }
      if (id === '') {
        problems.push({ code: 'id-empty', file, row });
        continue;
      }
      const line = rowProblems({ file, row, dialogueId: id }, cells, dict, problems);
      if (!line) broken.add(id);
      else lines.set(id, [...(lines.get(id) ?? []), line]);
    }
    for (const [id, found] of lines) {
      if (broken.has(id)) continue;
      const sorted = [...found].sort((a, b) => a.order - b.order);
      const dup = sorted.find((l, k) => k > 0 && sorted[k - 1]!.order === l.order);
      if (dup) {
        broken.add(id);
        problems.push({ code: 'order-duplicate', file, row: dup.row, dialogueId: id, order: dup.order });
        continue;
      }
      const other = owner.get(id);
      if (other !== undefined) {
        problems.push({ code: 'duplicate-dialogue', file, row: sorted[0]!.row, dialogueId: id, detail: other });
        continue;
      }
      const d: Dialogue = { id, file, lines: sorted };
      const before = problems.length;
      flowProblems(file, d, problems);
      owner.set(id, file);
      if (problems.length === before) table.set(id, d);
    }
    // A conversation that had a bad row still claims its id, so a second file cannot slip in under it.
    for (const id of broken) if (!owner.has(id)) owner.set(id, file);
  }
  return { table, problems };
}

/** The table the game plays: any problem stops startup, with the whole list. */
export function loadDialogueTable(files: readonly DialogueFile[], dict: TagDictionary): DialogueTable {
  const { table, problems } = readDialogues(files, dict);
  if (problems.length > 0) throw new DialogueTableError(problems);
  return table;
}
