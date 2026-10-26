import type { TickInput } from '../combat/operator.ts';
import { LOCK_TICKS } from '../dialogue/runner.ts';
import { playOption, type DeckCard } from '../outer/deck.ts';
import { ChapterError, type ChapterContent, type ChapterEvent, type ChapterState } from './chapter.ts';
import { confirmPressed, withTools, type TalkResult } from './talk.ts';

/**
 * An event card inside a chapter (design doc 7.2: the outer layer's mid-chapter card). It works
 * like a choice in a conversation: the room is frozen, presses are ignored for the first
 * LOCK_TICKS, W and S move the highlight, 1 to 3 or a click pick directly, and a confirm key
 * takes the highlighted option. The chosen option is logged as a story event.
 */

export interface CardState {
  readonly id: string;
  /** Highlighted option, from 0. */
  readonly cursor: number;
  /** Ticks since the card appeared, held at LOCK_TICKS once presses count. */
  readonly age: number;
}

export function eventCard(ctx: ChapterContent, id: string): DeckCard {
  const card = ctx.deck?.events.get(id);
  if (!card) throw new ChapterError(`${ctx.chapter.id}: event card "${id}" is not in the chapter's deck (the map check and Boot should have caught this)`);
  return card;
}

export const openCard = (ctx: ChapterContent, id: string): CardState => {
  eventCard(ctx, id);
  return { id, cursor: 0, age: 0 };
};

export function stepCard(ctx: ChapterContent, state: ChapterState, input: TickInput): TalkResult {
  const s = state.card!;
  if (s.age < LOCK_TICKS) return { state: { ...state, card: { ...s, age: s.age + 1 } }, events: [] };
  const card = eventCard(ctx, s.id);
  const n = card.options.length;
  const picked = input.pick !== undefined && input.pick >= 1 && input.pick <= n ? input.pick - 1 : undefined;
  if (picked === undefined && input.menuStep) {
    return { state: { ...state, card: { ...s, cursor: (s.cursor + input.menuStep + n) % n, age: LOCK_TICKS } }, events: [] };
  }
  if (picked === undefined && !confirmPressed(input)) return { state: { ...state, card: { ...s, age: LOCK_TICKS } }, events: [] };

  const option = card.options[picked ?? s.cursor]!;
  const r = playOption(ctx.dict, state.run.tags, state.game.clock, option.effects, { kind: 'event', key: `event.${card.id}.${option.id}` }, ctx.params);
  const a = withTools({ run: { ...state.run, tags: r.tags }, game: { ...state.game, clock: r.clock }, events: r.events });
  const events: ChapterEvent[] = [{ type: 'cardChosen', card: card.id, option: option.id }, ...a.events];
  return { state: { ...state, run: a.run, game: a.game, card: null }, events };
}
