import type { RuleClock } from '../clock.ts';
import { applyEffects, type EffectEvent, type EffectSource } from '../chapter/effects.ts';
import { schemaProblems } from '../content/read.ts';
import type { DeckFile } from '../content/generated.ts';
import type { SchemaProblem } from '../content/schema.ts';
import { parseEffects, type Effect, type EffectProblemCode } from '../dialogue/lines.ts';
import { record } from '../tags/causal.ts';
import type { MetabolismParams } from './caffeine.ts';
import type { TagDictionary } from '../tags/dictionary.ts';
import { EMPTY_TAGS, type TagState } from '../tags/store.ts';

/**
 * A story chapter's outer-layer cards (design doc 4.2, build plan P1). The premise of a chapter
 * is fixed by the script; the opening cards only set how bad it is, through tags the rooms read
 * (variant layers, the chairman's spirit, the caffeine cloak). An event card is the same kind of
 * choice shown inside the chapter. Text lives in content/strings, so core sees ids only.
 */

export interface DeckOption {
  readonly id: string;
  readonly effects: readonly Effect[];
}

export interface DeckCard {
  readonly id: string;
  readonly options: readonly DeckOption[];
}

export interface Deck {
  readonly chapter: string;
  /** Played in this order before the first room. */
  readonly opening: readonly DeckCard[];
  /** By card id, as a Trigger's eventId names them. */
  readonly events: ReadonlyMap<string, DeckCard>;
}

/** Dictionary sources a card may set: an opening card is a card, an event card is a story event. */
export const OPENING_SOURCES: readonly string[] = ['card'];
export const EVENT_SOURCES: readonly string[] = ['event'];

export type DeckProblemCode = 'schema' | 'card-duplicate' | 'option-duplicate' | 'effect';

/** Codes, not display text: tools/check-decks.ts phrases them in Chinese. */
export interface DeckProblem {
  readonly code: DeckProblemCode;
  readonly section?: 'opening' | 'events';
  readonly card?: string;
  readonly option?: string;
  readonly schema?: SchemaProblem;
  /** The part of the effect cell that is wrong. */
  readonly part?: string;
  readonly effect?: EffectProblemCode;
}

export class DeckError extends Error {
  readonly problems: readonly DeckProblem[];
  constructor(problems: readonly DeckProblem[]) {
    super(`deck is invalid:\n  ${problems.map((p) => [p.code, p.section, p.card, p.option, p.part, p.effect, p.schema?.path].filter(Boolean).join(' ')).join('\n  ')}`);
    this.problems = problems;
  }
}

/** Reads a deck file; a deck with any problem is not returned, so no one plays half a deck. */
export function readDeck(raw: unknown, dict: TagDictionary): { deck: Deck | undefined; problems: DeckProblem[] } {
  const found = schemaProblems('deck', raw);
  if (found.length > 0) return { deck: undefined, problems: found.map((schema) => ({ code: 'schema', schema })) };
  const file = raw as DeckFile;
  const problems: DeckProblem[] = [];
  // Strings are keyed by card id alone, so an opening card and an event card cannot share one.
  const seen = new Set<string>();
  const read = (section: 'opening' | 'events', sources: readonly string[]) => file[section].map((c): DeckCard => {
    if (seen.has(c.id)) problems.push({ code: 'card-duplicate', section, card: c.id });
    seen.add(c.id);
    const ids = new Set<string>();
    const options = c.options.map((o): DeckOption => {
      if (ids.has(o.id)) problems.push({ code: 'option-duplicate', section, card: c.id, option: o.id });
      ids.add(o.id);
      const parsed = parseEffects(o.effect, dict, sources);
      for (const p of parsed.problems) problems.push({ code: 'effect', section, card: c.id, option: o.id, part: p.part, effect: p.code });
      return { id: o.id, effects: parsed.effects };
    });
    return { id: c.id, options };
  });
  const opening = read('opening', OPENING_SOURCES);
  const events = read('events', EVENT_SOURCES);
  if (problems.length > 0) return { deck: undefined, problems };
  return { deck: { chapter: file.chapter, opening, events: new Map(events.map((c) => [c.id, c])) }, problems };
}

export function loadDeck(raw: unknown, dict: TagDictionary): Deck {
  const { deck, problems } = readDeck(raw, dict);
  if (!deck) throw new DeckError(problems);
  return deck;
}

/** Every way to play the opening cards, as one option index per card, in a fixed order. */
export function openingCombos(deck: Deck): number[][] {
  let out: number[][] = [[]];
  for (const card of deck.opening) out = out.flatMap((prefix) => card.options.map((_, i) => [...prefix, i]));
  return out;
}

export class OuterError extends Error {}

/**
 * Plays one option: its effects with the option as their logged source. An option with no effect
 * is still logged, because the close-out report tells what was chosen, not only what it changed.
 */
export function playOption(dict: TagDictionary, tags: TagState, clock: RuleClock, effects: readonly Effect[], source: EffectSource, k: MetabolismParams) {
  if (effects.length > 0) return applyEffects(dict, tags, clock, effects, source, k);
  const [log] = record(tags.log, { kind: source.kind, key: source.key, at: clock.minute });
  return { tags: { ...tags, log }, clock, events: [] as EffectEvent[] };
}

export interface Opening {
  readonly tags: TagState;
  /** The clock the chapter opens at: the given one, moved on by any clock effects. */
  readonly clock: RuleClock;
  readonly events: readonly EffectEvent[];
}

/** Plays the opening cards with one option index per card, in order. */
export function playOpening(
  deck: Deck, dict: TagDictionary, picks: readonly number[], clock: RuleClock, k: MetabolismParams, tags: TagState = EMPTY_TAGS,
): Opening {
  if (picks.length !== deck.opening.length) throw new OuterError(`${deck.chapter}: ${deck.opening.length} opening cards need as many picks, got ${picks.length}`);
  let state: Opening = { tags, clock, events: [] };
  deck.opening.forEach((card, i) => {
    const option = card.options[picks[i]!];
    if (!option) throw new OuterError(`${deck.chapter}: card ${card.id} has no option ${picks[i]}`);
    const r = playOption(dict, state.tags, state.clock, option.effects, { kind: 'card', key: `card.${card.id}.${option.id}` }, k);
    state = { tags: r.tags, clock: r.clock, events: [...state.events, ...r.events] };
  });
  return state;
}

/** String keys of a card; the check requires each of them, the view draws them. */
export const cardText = (chapter: string, card: string) => ({
  title: `deck.${chapter}.${card}.title`,
  option: (option: string) => `deck.${chapter}.${card}.${option}`,
  note: (option: string) => `deck.${chapter}.${card}.${option}.note`,
});
