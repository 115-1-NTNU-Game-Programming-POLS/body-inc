import { MINUTES_PER_DAY, type RuleClock } from '../clock.ts';
import { CLING } from '../combat/frames.ts';
import { caffeineOf, metabolise, senseCap } from '../outer/caffeine.ts';
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

/** The chapter clock runs from the opening to 23:00 (design doc 7.4); the cloak is weighed over that day. */
export const DAY_ENDS_HOUR = 23;

export interface ComboReport {
  readonly picks: readonly { readonly card: string; readonly option: string }[];
  /** Enemies present at entry, summed over the chapter's rooms. */
  readonly enemies: number;
  /** Of those, the ones that cling (adenosine), which the caffeine cloak hides the operator from. */
  readonly clinging: number;
  /**
   * How much of the day clinging enemies can see the operator, from 0 to 1: their sensing range
   * under the cloak as a share of the normal range, averaged over every minute from the opening
   * to DAY_ENDS_HOUR as the residual decays. 1 without caffeine.
   */
  readonly sight: number;
  /** The chairman's spirit at entry (design doc 5.4). */
  readonly p: number;
  /**
   * Enemies, each clinging one counted by `sight`, divided by P: more enemies, and a slower stamp
   * gauge to deal with them. A rough stand-in for difficulty until playtests give a better one;
   * it does not count the hearts P should scale (design doc 9.2), which the rules do not do yet.
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

/** See ComboReport.sight. */
export function sightOver(ctx: ChapterContent, tags: TagState, clock: RuleClock): number {
  const span = (clock.day - 1) * MINUTES_PER_DAY + DAY_ENDS_HOUR * 60 - clock.minute;
  const at = (t: number) => {
    const cap = senseCap(caffeineOf(metabolise(tags, ctx.dict, t, ctx.params), ctx.dict));
    return cap === undefined ? 1 : Math.min(1, cap / CLING.senseRangePx);
  };
  // An opening that ends after 23:00 still meets the enemies once: weigh the moment it starts.
  if (span <= 0) return at(0);
  let sum = 0;
  for (let t = 0; t < span; t++) sum += at(t);
  return sum / span;
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function comboReports(ctx: ChapterContent, deck: Deck, clock: RuleClock): ComboReport[] {
  return openingCombos(deck).map((combo) => {
    const picks = combo.map((i, n) => ({ card: deck.opening[n]!.id, option: deck.opening[n]!.options[i]!.id }));
    const opening = playOpening(deck, ctx.dict, combo, clock, ctx.params);
    const problems: PlayProblem[] = [];
    let enemies = 0;
    let clinging = 0;
    let p = 1;
    for (const room of roomsOf(ctx.chapter)) {
      try {
        const s = startChapter(ctx, { room, tags: opening.tags, clock: opening.clock });
        enemies += s.game.enemies.length;
        clinging += s.game.enemies.filter((e) => e.clings).length;
        p = s.game.p;
      } catch (e) {
        problems.push({ code: 'room', room, message: errorText(e) });
      }
    }
    const bed = bedAfter(ctx, opening.tags);
    if (bed === 'none') problems.push({ code: 'no-bed' });
    else if (bed === undefined) problems.push({ code: 'bed-never' });
    // Only on a combination whose bed opens: on top of one that never opens, every option would repeat that one problem.
    if (bed !== 'none' && bed !== undefined) {
      for (const card of deck.events.values()) {
        for (const option of card.options) {
          const after = playOption(ctx.dict, opening.tags, opening.clock, option.effects, { kind: 'event', key: `event.${card.id}.${option.id}` }, ctx.params);
          if (bedAfter(ctx, after.tags) === undefined) problems.push({ code: 'bed-never', event: { card: card.id, option: option.id } });
        }
      }
    }
    const sight = sightOver(ctx, opening.tags, opening.clock);
    const pressure = (enemies - clinging + clinging * sight) / p;
    return { picks, enemies, clinging, sight, p, pressure, bedAfter: bed === 'none' ? undefined : bed, problems };
  });
}

/**
 * What each opening option does to difficulty: the mean pressure of the playable combinations
 * that include it, so the card that drives the spread stands out.
 */
export function optionPressure(deck: Deck, reports: readonly ComboReport[]): { card: string; option: string; pressure: number }[] {
  const ok = reports.filter((r) => r.problems.length === 0);
  return deck.opening.flatMap((card, n) => card.options.map((o) => {
    const with_ = ok.filter((r) => r.picks[n]?.option === o.id);
    return { card: card.id, option: o.id, pressure: with_.length ? with_.reduce((s, r) => s + r.pressure, 0) / with_.length : Number.NaN };
  }));
}

/** The easiest and hardest playable combinations by pressure; one with no pressure has no ratio. */
export function spreadEnds(reports: readonly ComboReport[]): { easiest: ComboReport; hardest: ComboReport } | undefined {
  const ok = reports.filter((r) => r.problems.length === 0 && r.pressure > 0).sort((a, b) => a.pressure - b.pressure);
  return ok.length ? { easiest: ok[0]!, hardest: ok.at(-1)! } : undefined;
}

/** How much harder the hardest combination is than the easiest, by pressure: 0.3 is 30%. */
export function worstSpread(reports: readonly ComboReport[]): number {
  const ends = spreadEnds(reports);
  return ends ? ends.hardest.pressure / ends.easiest.pressure - 1 : 0;
}
