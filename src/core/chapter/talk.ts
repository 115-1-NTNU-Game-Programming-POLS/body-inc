import { advance } from '../clock.ts';
import type { TickInput } from '../combat/operator.ts';
import {
  arrivalEffects, chosenLine, leaveNode, LOCK_TICKS, moveCursor, nodeLine, openDialogue, pickReply, type DialogueState,
} from '../dialogue/runner.ts';
import type { Effect } from '../dialogue/lines.ts';
import type { GameState } from '../game.ts';
import { record } from '../tags/causal.ts';
import { addAmount, holds, setAmount, setFlag } from '../tags/store.ts';
import type { ChapterContent, ChapterEvent, ChapterState, Run } from './chapter.ts';

/**
 * Conversations inside a chapter (build plan P5). While one is open the room is frozen and the
 * only input that counts is the conversation's own: confirm, or move and pick among replies.
 * What a line changes (tags, the clock, handbook pages) is applied here, because the chapter
 * owns both and every change must name the line that caused it (design doc 13.5).
 */

interface Applied {
  readonly run: Run;
  readonly game: GameState;
  readonly events: readonly ChapterEvent[];
}

/** Applies effects in order; each tag change is caused by one log entry naming the line. */
function applyEffects(ctx: ChapterContent, run: Run, game: GameState, effects: readonly Effect[], source: { kind: 'event' | 'choice'; key: string }): Applied {
  if (effects.length === 0) return { run, game, events: [] };
  let clock = game.clock;
  let [log, cause] = record(run.tags.log, { kind: source.kind, key: source.key, at: clock.minute });
  let tags = { ...run.tags, log };
  const events: ChapterEvent[] = [];
  for (const e of effects) {
    switch (e.kind) {
      case 'flag':
        tags = setFlag(tags, ctx.dict, e.name, true, cause, clock.minute);
        break;
      case 'amount':
        tags = e.mode === 'set'
          ? setAmount(tags, ctx.dict, e.name, e.value, cause, clock.minute)
          : addAmount(tags, ctx.dict, e.name, e.value, cause, clock.minute);
        break;
      case 'clock':
        clock = advance(clock, e.minutes);
        events.push({ type: 'clockAdvanced', minutes: e.minutes });
        break;
      case 'unlock': {
        [log] = record(tags.log, { kind: 'effect', key: `unlock.${e.id}`, at: clock.minute, causes: [cause] });
        tags = { ...tags, log };
        events.push({ type: 'handbookUnlocked', id: e.id });
        break;
      }
    }
  }
  return { run: { ...run, tags }, game: { ...game, clock }, events };
}

export interface Opened extends Applied {
  readonly dialogue: DialogueState;
}

/**
 * Starts a conversation, or returns undefined when every line of it is skipped by its condition.
 * The dialogue must exist; the map check guarantees it for ids written in Tiled.
 */
export function openTalk(ctx: ChapterContent, run: Run, game: GameState, id: string): Opened | undefined {
  const s = openDialogue(ctx.dialogues, id, (c) => holds(run.tags, ctx.dict, c));
  if (!s) return undefined;
  const a = applyEffects(ctx, run, game, arrivalEffects(ctx.dialogues, s), { kind: 'event', key: `dialogue.${id}.${nodeLine(ctx.dialogues, s).order}` });
  return { run: a.run, game: a.game, dialogue: s, events: [{ type: 'dialogueOpened', dialogueId: id }, ...a.events] };
}

export interface TalkResult {
  readonly state: ChapterState;
  readonly events: readonly ChapterEvent[];
}

/** One tick of an open conversation. */
export function stepTalk(ctx: ChapterContent, state: ChapterState, input: TickInput): TalkResult {
  const s = state.dialogue!;
  // Presses on the tick a line appears, or just after it, are ignored.
  if (s.age < LOCK_TICKS) return { state: { ...state, dialogue: { ...s, age: s.age + 1 } }, events: [] };

  const choosing = s.options.length > 0;
  const picked = choosing && input.pick ? pickReply(s, input.pick) : undefined;
  if (!picked && choosing && input.menuStep) {
    return { state: { ...state, dialogue: { ...moveCursor(s, input.menuStep), age: s.age + 1 } }, events: [] };
  }
  const confirmed = picked !== undefined || input.interactPressed === true || input.attackPressed === true || input.dodgePressed === true;
  if (!confirmed) return { state: { ...state, dialogue: { ...s, age: s.age + 1 } }, events: [] };

  const at = picked ?? s;
  let { run, game } = state;
  const events: ChapterEvent[] = [];
  if (choosing) {
    const reply = chosenLine(ctx.dialogues, at);
    const a = applyEffects(ctx, run, game, reply.effects, { kind: 'choice', key: `dialogue.${at.id}.${reply.order}` });
    ({ run, game } = a);
    events.push(...a.events);
  }
  const next = leaveNode(ctx.dialogues, at, (c) => holds(run.tags, ctx.dict, c));
  if (!next) {
    events.push({ type: 'dialogueClosed', dialogueId: at.id });
    return { state: { run, game, dialogue: null }, events };
  }
  const b = applyEffects(ctx, run, game, arrivalEffects(ctx.dialogues, next), { kind: 'event', key: `dialogue.${next.id}.${nodeLine(ctx.dialogues, next).order}` });
  events.push(...b.events);
  return { state: { run: b.run, game: b.game, dialogue: next }, events };
}
