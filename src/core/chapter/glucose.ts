import { TICK_HZ } from '../time.ts';
import { record } from '../tags/causal.ts';
import type { TagDictionary } from '../tags/dictionary.ts';
import { amount, lowerAmount, setAmount, type TagState } from '../tags/store.ts';

/**
 * The prologue's blood glucose meter (design doc 7.3), kept in the `glucose` tag so conditions
 * and effects can read and set it like any other state. Walking drains it; below the normal band
 * the liver tops it up from the warehouse, on the same tick, so it never rests below 40. That floor is the fact the
 * chapter teaches: a healthy body that skips breakfast does not go hypoglycaemic (facts 21, 27).
 */
export const GLUCOSE = {
  /** ASSUME: the doc fixes the band and the drain but not where the morning starts. */
  start: 55,
  /** DOC 7.3: one point every 3 seconds while the operator walks. */
  drainTicks: 3 * TICK_HZ,
  /** DOC 7.3: below 40 the liver ships glucose up to 45. */
  refillBelow: 40,
  refillTo: 45,
  /** DOC 7.3: the normal band the meter shades, 40 to 70 on a 0 to 100 scale. */
  band: { low: 40, high: 70 },
  max: 100,
} as const;

const REFILL_KEY = 'liver.refill';

export type GlucoseEvent = { readonly type: 'glucoseRefilled'; readonly from: number; readonly to: number };

export interface GlucoseStep {
  readonly tags: TagState;
  /** Walking ticks since the meter last dropped. */
  readonly walked: number;
  readonly events: readonly GlucoseEvent[];
}

/**
 * One rule tick of the meter. Standing still costs nothing. Refills are logged as the liver's
 * doing (a `rule` source), which is what the close-out report will thank it for.
 */
export function stepGlucose(dict: TagDictionary, tags: TagState, walked: number, walking: boolean, minute: number): GlucoseStep {
  if (!walking) return { tags, walked, events: [] };
  if (walked + 1 < GLUCOSE.drainTicks) return { tags, walked: walked + 1, events: [] };
  const lowered = lowerAmount(tags, dict, 'glucose', 1);
  const from = amount(lowered, dict, 'glucose');
  if (from >= GLUCOSE.refillBelow) return { tags: lowered, walked: 0, events: [] };
  // One node stands for every refill: a new one each time would grow the log, and every save with
  // it, for as long as the operator walks.
  const seen = lowered.log.nodes.findIndex((n) => n.kind === 'rule' && n.key === REFILL_KEY);
  const [log, cause] = seen >= 0 ? [lowered.log, seen] : record(lowered.log, { kind: 'rule', key: REFILL_KEY, at: minute });
  const refilled = setAmount({ ...lowered, log }, dict, 'glucose', GLUCOSE.refillTo, cause, minute);
  return { tags: refilled, walked: 0, events: [{ type: 'glucoseRefilled', from, to: GLUCOSE.refillTo }] };
}

/** The meter's value for the HUD, or undefined in a chapter without one (the tag is never set there). */
export function glucoseOf(tags: TagState): number | undefined {
  const v = tags.values['glucose']?.value;
  return typeof v === 'number' ? v : undefined;
}

/** The meter as a chapter with it opens: the morning value, logged as the chapter's premise. */
export function openGlucose(dict: TagDictionary, tags: TagState, minute: number): TagState {
  const [log, cause] = record(tags.log, { kind: 'rule', key: 'glucose.morning', at: minute });
  return setAmount({ ...tags, log }, dict, 'glucose', GLUCOSE.start, cause, minute);
}
