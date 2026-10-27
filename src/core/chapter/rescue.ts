import type { TickInput } from '../combat/operator.ts';
import type { RescueFile } from '../content/generated.ts';
import { parseEffects, type Effect } from '../dialogue/lines.ts';
import { LOCK_TICKS } from '../dialogue/runner.ts';
import { EVENT_SOURCES } from '../outer/deck.ts';
import { record } from '../tags/causal.ts';
import { compileCondition, type TagDictionary } from '../tags/dictionary.ts';
import type { Condition } from '../tags/condition.ts';
import { holds } from '../tags/store.ts';
import { ChapterError, type ChapterContent, type ChapterEvent, type ChapterState } from './chapter.ts';
import { applyEffects } from './effects.ts';
import { confirmPressed, withTools, type TalkResult } from './talk.ts';

/**
 * A rescue that cannot fail (design doc 7.7: the classmate who will not wake up). The room is
 * frozen while the panel is open, as for a conversation, so nothing can hurt anyone meanwhile.
 * The panel lists every action. Picking the next correct step does it; a later step is answered
 * with "one thing at a time"; a myth is answered by a friend saying why not. None of them ends
 * the panel or harms anyone: there is no failure state, only steps not done yet. When a helper's
 * condition holds (the roommate), the helper takes their step as soon as it is the next one.
 * Once the last step is done, a confirm closes the panel and applies the rescue's effects.
 */

export interface RescuePlan {
  readonly id: string;
  readonly steps: readonly string[];
  readonly myths: readonly string[];
  /** Every action, in the order the panel lists them. */
  readonly order: readonly string[];
  readonly helper?: { readonly when: Condition; readonly step: string };
  readonly effects: readonly Effect[];
}

export type RescueTable = ReadonlyMap<string, RescuePlan>;

export type RescueProblemCode = 'duplicate' | 'order' | 'repeat' | 'helper-step' | 'helper-when' | 'effects';

export interface RescueProblem {
  readonly id: string;
  readonly code: RescueProblemCode;
  readonly detail?: string;
}

/** Reads the rescue file, reporting problems instead of throwing so the content check can word them. */
export function readRescues(file: RescueFile, dict: TagDictionary): { table: RescueTable; problems: RescueProblem[] } {
  const table = new Map<string, RescuePlan>();
  const problems: RescueProblem[] = [];
  for (const r of file.rescues) {
    const bad = (code: RescueProblemCode, detail?: string) => problems.push({ id: r.id, code, ...(detail !== undefined ? { detail } : {}) });
    if (table.has(r.id)) bad('duplicate');
    const all = [...r.steps, ...r.myths];
    if (new Set(all).size !== all.length) bad('repeat');
    if (r.order.length !== all.length || !all.every((a) => r.order.includes(a))) bad('order');
    let helper: RescuePlan['helper'];
    if (r.helper) {
      if (!r.steps.includes(r.helper.step)) bad('helper-step', r.helper.step);
      try {
        helper = { when: compileCondition(dict, r.helper.when), step: r.helper.step };
      } catch {
        bad('helper-when', r.helper.when);
      }
    }
    // A rescue is a story event, so it may set the tags an event may set.
    const parsed = parseEffects(r.effects, dict, EVENT_SOURCES);
    for (const p of parsed.problems) bad('effects', `${p.code} ${p.part}`);
    table.set(r.id, { id: r.id, steps: r.steps, myths: r.myths, order: r.order, ...(helper ? { helper } : {}), effects: parsed.effects });
  }
  return { table, problems };
}

/**
 * The string keys a rescue's panel shows: its title, the situation, a label and an answer per action, the
 * "one thing at a time" line (its `{step}` is the label of the step that is next), the helper's
 * line and the closing line.
 */
export function rescueStringKeys(r: Pick<RescueFile['rescues'][number], 'id' | 'order' | 'helper'>): string[] {
  const at = `rescue.${r.id}`;
  return [
    `${at}.title`, `${at}.prompt`, ...r.order.flatMap((a) => [`${at}.action.${a}`, `${at}.reply.${a}`]), `${at}.early`,
    ...(r.helper ? [`${at}.helper`] : []), `${at}.done`,
  ];
}

/** Lines every rescue panel shares, whatever the rescue. */
export const RESCUE_PANEL_KEYS: readonly string[] = ['rescue.hint', 'rescue.progress', 'rescue.continue'];

export function loadRescues(file: RescueFile, dict: TagDictionary): RescueTable {
  const { table, problems } = readRescues(file, dict);
  if (problems.length > 0) throw new ChapterError(`content/rescue.json: ${problems.map((p) => `${p.id} ${p.code}${p.detail ? ` (${p.detail})` : ''}`).join(', ')}`);
  return table;
}

/**
 * What the panel answered last: the action picked and how. `helped` means the helper then took
 * the next step on their own.
 */
export type RescueReply =
  | { readonly kind: 'step'; readonly action: string; readonly helped?: string }
  | { readonly kind: 'early'; readonly action: string; readonly next: string }
  | { readonly kind: 'myth'; readonly action: string };

export interface RescueState {
  readonly id: string;
  /** Correct steps done so far, from 0 to steps.length. */
  readonly done: number;
  /** Highlighted entry among the actions still offered, from 0. */
  readonly cursor: number;
  readonly age: number;
  readonly reply: RescueReply | null;
}

export function rescueOf(ctx: ChapterContent, id: string): RescuePlan {
  const r = ctx.rescues?.get(id);
  if (!r) throw new ChapterError(`${ctx.chapter.id}: rescue "${id}" is not in content/rescue.json (the map check and Boot should have caught this)`);
  return r;
}

/** The actions still on the panel: every one but the steps already done. */
export const offered = (r: RescuePlan, done: number): readonly string[] => r.order.filter((a) => !r.steps.slice(0, done).includes(a));

export const rescueComplete = (r: RescuePlan, s: RescueState): boolean => s.done >= r.steps.length;

export const openRescue = (ctx: ChapterContent, id: string): RescueState => {
  rescueOf(ctx, id);
  return { id, done: 0, cursor: 0, age: 0, reply: null };
};

export function stepRescue(ctx: ChapterContent, state: ChapterState, input: TickInput): TalkResult {
  const s = state.rescue!;
  if (s.age < LOCK_TICKS) return { state: { ...state, rescue: { ...s, age: s.age + 1 } }, events: [] };
  const r = rescueOf(ctx, s.id);
  const idle = { state: { ...state, rescue: { ...s, age: LOCK_TICKS } }, events: [] as ChapterEvent[] };

  // A pick also closes it, so a click on the finished panel works as the mouse player expects.
  if (rescueComplete(r, s)) return confirmPressed(input) || input.pick !== undefined ? finish(ctx, state, r) : idle;

  const list = offered(r, s.done);
  const n = list.length;
  const picked = input.pick !== undefined && input.pick >= 1 && input.pick <= n ? input.pick - 1 : undefined;
  if (picked === undefined && input.menuStep) {
    return { state: { ...state, rescue: { ...s, cursor: (s.cursor + input.menuStep + n) % n, age: LOCK_TICKS } }, events: [] };
  }
  if (picked === undefined && !confirmPressed(input)) return idle;

  const action = list[picked ?? s.cursor]!;
  let done = s.done;
  let reply: RescueReply;
  const next = r.steps[done]!;
  if (action === next) {
    done++;
    const helper = r.helper && done < r.steps.length && r.steps[done] === r.helper.step && holds(state.run.tags, ctx.dict, r.helper.when)
      ? r.helper.step : undefined;
    if (helper !== undefined) done++;
    reply = { kind: 'step', action, ...(helper !== undefined ? { helped: helper } : {}) };
  } else if (r.steps.includes(action)) reply = { kind: 'early', action, next };
  else reply = { kind: 'myth', action };

  // Each action is logged the first time it is picked, so the report can tell what was tried
  // without the log growing with every press.
  const key = `rescue.${r.id}.${action}`;
  let run = state.run;
  if (!run.tags.log.nodes.some((x) => x.key === key)) {
    const [log] = record(run.tags.log, { kind: 'choice', key, at: state.game.clock.minute });
    run = { ...run, tags: { ...run.tags, log } };
  }
  const left = offered(r, done).length;
  const rescue: RescueState = { ...s, done, reply, age: LOCK_TICKS, cursor: left === 0 ? 0 : Math.min(s.cursor, left - 1) };
  return { state: { ...state, run, rescue }, events: [{ type: 'rescueStep', rescue: r.id, action, outcome: reply.kind, done }] };
}

function finish(ctx: ChapterContent, state: ChapterState, r: RescuePlan): TalkResult {
  const out = applyEffects(ctx.dict, state.run.tags, state.game.clock, r.effects, { kind: 'event', key: `rescue.${r.id}` }, ctx.params);
  const a = withTools({ run: { ...state.run, tags: out.tags }, game: { ...state.game, clock: out.clock }, events: out.events });
  const { rescue: _, ...rest } = state;
  return { state: { ...rest, run: a.run, game: a.game }, events: [...a.events, { type: 'rescueDone', rescue: r.id }] };
}
