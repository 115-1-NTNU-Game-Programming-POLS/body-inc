import type { RuleClock } from '../clock.ts';
import { metabolise } from '../outer/caffeine.ts';
import { openingCombos, playOpening, playOption, type Deck } from '../outer/deck.ts';
import { enterRoom } from '../rooms/entry.ts';
import { holds, type TagState } from '../tags/store.ts';
import { roomsOf, startChapter, type ChapterContent } from './chapter.ts';

/**
 * Build plan P1: every combination of opening cards must give a chapter that can be finished,
 * and the spread of difficulty between combinations is logged (design doc 4.2 aims at the worst
 * combination being about 30% harder). This runs the real chapter start, so it fails on exactly
 * what the game would fail on.
 *
 * "Can be finished" is checked as far as the rules can see without playing: every room of the
 * chapter can be entered with the combination's tags, and a sleep bed accepts the operator
 * within a day of waiting, as the caffeine residual decays. Event cards are tried on top of every
 * combination, since an option could lock the bed for good.
 */

/** How long the check waits for a bed to accept; a combination that needs longer is not playable. */
export const BED_SEARCH_MINUTES = 24 * 60;

export type PlayProblem =
  | { readonly code: 'room'; readonly room: string; readonly message: string }
  | { readonly code: 'no-bed' }
  | { readonly code: 'bed-never'; readonly event?: { readonly card: string; readonly option: string } };

export interface ComboReport {
  readonly picks: readonly { readonly card: string; readonly option: string }[];
  /** Enemies present at entry, summed over the chapter's rooms. */
  readonly enemies: number;
  /** The chairman's spirit at entry (design doc 5.4). */
  readonly p: number;
  /**
   * Enemies divided by P: more enemies, and a slower stamp gauge to deal with them. A rough
   * stand-in for difficulty until playtests give a better one.
   */
  readonly pressure: number;
  /** Minutes after the chapter opens until a sleep bed first accepts, or undefined. */
  readonly bedAfter: number | undefined;
  readonly problems: readonly PlayProblem[];
}

/** Minutes until a sleep bed of the chapter accepts these tags, waiting from now. */
export function bedAfter(ctx: ChapterContent, tags: TagState): number | undefined | 'none' {
  const beds = roomsOf(ctx.chapter).flatMap((path) => {
    const model = ctx.rooms.get(path);
    return model ? enterRoom(model, tags, ctx.dict).objects.filter((o) => o.kind === 'Bed' && o.props['bedType'] === 'sleep') : [];
  });
  if (beds.length === 0) return 'none';
  for (let t = 0; t <= BED_SEARCH_MINUTES; t++) {
    const now = metabolise(tags, ctx.dict, t, ctx.params);
    if (beds.some((b) => !b.conditions['requires'] || holds(now, ctx.dict, b.conditions['requires']))) return t;
  }
  return undefined;
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function comboReports(ctx: ChapterContent, deck: Deck, clock: RuleClock): ComboReport[] {
  return openingCombos(deck).map((combo) => {
    const picks = combo.map((i, n) => ({ card: deck.opening[n]!.id, option: deck.opening[n]!.options[i]!.id }));
    const opening = playOpening(deck, ctx.dict, combo, clock);
    const problems: PlayProblem[] = [];
    let enemies = 0;
    let p = 1;
    for (const room of roomsOf(ctx.chapter)) {
      try {
        const s = startChapter(ctx, { room, tags: opening.tags, clock: opening.clock });
        enemies += s.game.enemies.length;
        p = s.game.p;
      } catch (e) {
        problems.push({ code: 'room', room, message: errorText(e) });
      }
    }
    const bed = bedAfter(ctx, opening.tags);
    if (bed === 'none') problems.push({ code: 'no-bed' });
    else if (bed === undefined) problems.push({ code: 'bed-never' });
    if (bed !== 'none') {
      for (const card of deck.events.values()) {
        for (const option of card.options) {
          const after = playOption(ctx.dict, opening.tags, opening.clock, option.effects, { kind: 'event', key: `event.${card.id}.${option.id}` });
          if (bedAfter(ctx, after.tags) === undefined) problems.push({ code: 'bed-never', event: { card: card.id, option: option.id } });
        }
      }
    }
    return { picks, enemies, p, pressure: enemies / p, bedAfter: bed === 'none' ? undefined : bed, problems };
  });
}

/** How much harder the hardest combination is than the easiest, by pressure: 0.3 is 30%. */
export function worstSpread(reports: readonly ComboReport[]): number {
  const ok = reports.filter((r) => r.problems.length === 0 && r.pressure > 0);
  if (ok.length === 0) return 0;
  const min = Math.min(...ok.map((r) => r.pressure));
  return Math.max(...ok.map((r) => r.pressure)) / min - 1;
}
