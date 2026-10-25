import type { Condition } from '../tags/condition.ts';
import { exitOf, isOption, optionGroup, type Dialogue, type DialogueTable, type Effect, type Line } from './lines.ts';

/**
 * Walking a conversation. Everything here is a pure function of the table, the state and which
 * conditions hold, so a conversation replays the same in Node and in the browser. Applying a
 * line's effects belongs to the chapter, which owns the tags and the clock.
 */

/**
 * Ticks after a line appears during which presses are ignored (0.2 s), so a key held down in
 * combat does not skip a line unread when a trigger opens a conversation. An assumption until
 * a playtest says otherwise.
 */
export const LOCK_TICKS = 12;

export interface DialogueState {
  readonly id: string;
  /** Index of the spoken line on screen; while replies are offered, of the first reply of the run. */
  readonly at: number;
  /** Indexes of the replies on offer, those whose condition holds; empty for a spoken line. */
  readonly options: readonly number[];
  /** Which of `options` is highlighted. */
  readonly cursor: number;
  /** Index of the latest spoken line, which stays on screen while replies are offered. */
  readonly said: number | undefined;
  /** Ticks since this node appeared. */
  readonly age: number;
}

export type Holds = (c: Condition) => boolean;

/** First node at or after line `from` that shows, or undefined at the end of the conversation. */
function settle(d: Dialogue, from: number, ok: Holds, said: number | undefined): DialogueState | undefined {
  let i = from;
  while (i < d.lines.length) {
    const l = d.lines[i]!;
    if (!isOption(l)) {
      if (!l.when || ok(l.when)) return { id: d.id, at: i, options: [], cursor: 0, said: i, age: 0 };
      i++;
      continue;
    }
    const g = optionGroup(d, i)!;
    const shown: number[] = [];
    for (let k = g.start; k < g.end; k++) {
      const w = d.lines[k]!.when;
      if (!w || ok(w)) shown.push(k);
    }
    if (shown.length > 0) return { id: d.id, at: g.start, options: shown, cursor: 0, said, age: 0 };
    i = g.end;
  }
  return undefined;
}

/** The first node of a conversation, or undefined when every line of it is skipped by its condition. */
export function openDialogue(table: DialogueTable, id: string, ok: Holds): DialogueState | undefined {
  const d = table.get(id);
  if (!d) throw new RangeError(`no dialogue "${id}"`);
  return settle(d, 0, ok, undefined);
}

const dialogueOf = (table: DialogueTable, s: DialogueState): Dialogue => {
  const d = table.get(s.id);
  if (!d) throw new RangeError(`no dialogue "${s.id}"`);
  return d;
};

/** The node after this one: past the spoken line, or past the reply under the cursor. Undefined ends it. */
export function leaveNode(table: DialogueTable, s: DialogueState, ok: Holds): DialogueState | undefined {
  const d = dialogueOf(table, s);
  const from = s.options.length > 0 ? s.options[s.cursor]! : s.at;
  return settle(d, exitOf(d, from), ok, s.said);
}

/** What a spoken line does as it appears; replies do nothing until one is chosen. */
export function arrivalEffects(table: DialogueTable, s: DialogueState): readonly Effect[] {
  return s.options.length > 0 ? [] : dialogueOf(table, s).lines[s.at]!.effects;
}

/** The reply under the cursor. */
export function chosenLine(table: DialogueTable, s: DialogueState): Line {
  return dialogueOf(table, s).lines[s.options[s.cursor]!]!;
}

/** The line whose effects a node's arrival belongs to, for naming the cause. */
export function nodeLine(table: DialogueTable, s: DialogueState): Line {
  return dialogueOf(table, s).lines[s.at]!;
}

export function moveCursor(s: DialogueState, step: number): DialogueState {
  const n = s.options.length;
  return n === 0 ? s : { ...s, cursor: (((s.cursor + step) % n) + n) % n };
}

/** Puts the cursor on the n-th reply (1-based); undefined when there is no such reply. */
export function pickReply(s: DialogueState, n: number): DialogueState | undefined {
  return Number.isInteger(n) && n >= 1 && n <= s.options.length ? { ...s, cursor: n - 1 } : undefined;
}

/** What the screen needs, from the state alone. */
export interface DialogueView {
  readonly id: string;
  /** The spoken line on screen; absent when a conversation opens straight on its replies. */
  readonly line: { readonly speaker: string; readonly expression: string; readonly text: string } | undefined;
  readonly options: readonly string[];
  readonly cursor: number;
  /** Where in the conversation this node is; it changes whenever a new line or choice appears. */
  readonly at: number;
  readonly age: number;
}

export function selectDialogue(table: DialogueTable, s: DialogueState | null | undefined): DialogueView | undefined {
  if (!s) return undefined;
  const d = dialogueOf(table, s);
  const said = s.said === undefined ? undefined : d.lines[s.said]!;
  return {
    id: s.id,
    line: said ? { speaker: said.speaker, expression: said.expression, text: said.text } : undefined,
    options: s.options.map((i) => d.lines[i]!.text),
    cursor: s.cursor,
    at: s.at,
    age: s.age,
  };
}
