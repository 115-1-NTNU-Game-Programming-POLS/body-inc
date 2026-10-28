import { STAMP } from '../combat/frames.ts';
import type { TickInput } from '../combat/operator.ts';
import {
  arrivalEffects, chosenLine, leaveNode, LOCK_TICKS, moveCursor, nodeLine, openDialogue, pickReply, type DialogueState,
} from '../dialogue/runner.ts';
import type { Effect } from '../dialogue/lines.ts';
import type { GameState } from '../game.ts';
import { holds } from '../tags/store.ts';
import type { ChapterContent, ChapterEvent, ChapterState, Run } from './chapter.ts';
import { applyEffects, type EffectSource } from './effects.ts';

/**
 * Conversations inside a chapter (build plan P5). While one is open the room is frozen and the
 * only input that counts is the conversation's own: confirm, or move and pick among replies.
 * What a line changes (tags, the clock, handbook pages) is applied here, because the chapter
 * owns both and every change must name the line that caused it (design doc 13.5).
 */

export interface Applied {
  readonly run: Run;
  readonly game: GameState;
  readonly events: readonly ChapterEvent[];
}

/** `applyEffects` on a run and its room: tags live on the run, the clock in the room. */
export function applyToRun(ctx: ChapterContent, run: Run, game: GameState, effects: readonly Effect[], source: EffectSource): Applied {
  const a = applyEffects(ctx.dict, run.tags, game.clock, effects, source, ctx.params);
  return withTools({ run: { ...run, tags: a.tags }, game: { ...game, clock: a.clock }, events: a.events });
}

/**
 * Hands over the tools the events grant. The stamp arrives charged, so the very next thing the
 * operator can do is try it, which is how the prologue teaches it (design doc 7.3).
 */
export function withTools(a: Applied): Applied {
  let { run, game } = a;
  for (const e of a.events) {
    if (e.type !== 'toolGranted' || run.tools.includes(e.tool)) continue;
    run = { ...run, tools: [...run.tools, e.tool] };
    if (e.tool === 'stamp') {
      const { stampLocked: _, ...open } = game;
      game = { ...open, operator: { ...game.operator, gauge: STAMP.gaugeMax } };
    } else if (e.tool === 'folder') {
      // It stays in the pocket until the swap key takes it out (design doc 6.1).
      const { folderLocked: _, ...open } = game;
      game = open;
    }
  }
  return { run, game, events: a.events };
}

/** True when a press this tick confirms: interact, attack or dodge (docs/authoring/rooms-and-dialogue.md). */
export const confirmPressed = (input: TickInput): boolean =>
  input.interactPressed === true || input.attackPressed === true || input.dodgePressed === true;

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
  const a = applyToRun(ctx, run, game, arrivalEffects(ctx.dialogues, s), { kind: 'event', key: `dialogue.${id}.${nodeLine(ctx.dialogues, s).order}` });
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
    return { state: { ...state, dialogue: { ...moveCursor(s, input.menuStep), age: LOCK_TICKS } }, events: [] };
  }
  const confirmed = picked !== undefined || confirmPressed(input);
  if (!confirmed) return { state: { ...state, dialogue: { ...s, age: LOCK_TICKS } }, events: [] };

  const at = picked ?? s;
  let { run, game } = state;
  const events: ChapterEvent[] = [];
  if (choosing) {
    const reply = chosenLine(ctx.dialogues, at);
    const a = applyToRun(ctx, run, game, reply.effects, { kind: 'choice', key: `dialogue.${at.id}.${reply.order}` });
    ({ run, game } = a);
    events.push(...a.events);
  }
  const next = leaveNode(ctx.dialogues, at, (c) => holds(run.tags, ctx.dict, c));
  if (!next) {
    events.push({ type: 'dialogueClosed', dialogueId: at.id });
    return { state: { ...state, run, game, dialogue: null }, events };
  }
  const b = applyToRun(ctx, run, game, arrivalEffects(ctx.dialogues, next), { kind: 'event', key: `dialogue.${next.id}.${nodeLine(ctx.dialogues, next).order}` });
  events.push(...b.events);
  return { state: { ...state, run: b.run, game: b.game, dialogue: next }, events };
}
