import { TICK_HZ } from '../time.ts';
import { record } from '../tags/causal.ts';
import type { TagDictionary } from '../tags/dictionary.ts';
import { amount, lowerAmount, setAmount, setFlag, type TagState } from '../tags/store.ts';

/**
 * The prologue's blood glucose meter (design doc 7.3), kept in the `glucose` tag so conditions
 * and effects can read and set it like any other state. Walking drains it; below the normal band
 * the liver tops it up from the warehouse, on the same tick, so it never rests below 40. That floor is the fact the
 * chapter teaches: a healthy body that skips breakfast does not go hypoglycaemic (facts 21, 27).
 * The liver chapter pays it off (design doc 7.7): while the first line runs on an empty stomach
 * the warehouse is shut, and the meter falls through the line the prologue never crosses (fact 31).
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
  /** DOC 7.7: below 35, with the warehouse shut, the operator is dizzy and in a cold sweat. */
  dizzyBelow: 35,
  /** ASSUME: where the meter stops with the warehouse shut; the doc names only the 35 line. */
  shutFloor: 30,
  /** DOC 7.7: dizziness slows the operator by 15%, a visible source under the cap of design doc 5.1. */
  dizzySlow: 0.15,
} as const;

const REFILL_KEY = 'liver.refill';
const SHUT_KEY = 'liver.warehouse_shut';

export type GlucoseEvent =
  | { readonly type: 'glucoseRefilled'; readonly from: number; readonly to: number }
  /** The meter crossed the dizzy line, either way. */
  | { readonly type: 'dizzyChanged'; readonly dizzy: boolean };

export interface GlucoseStep {
  readonly tags: TagState;
  /** Walking ticks since the meter last dropped. */
  readonly walked: number;
  readonly events: readonly GlucoseEvent[];
}

/**
 * One rule tick of the meter. Standing still costs nothing. Refills are logged as the liver's
 * doing (a `rule` source), which is what the close-out report will thank it for. With the
 * warehouse shut (`mod.warehouse_locked`, read by the chapter) nothing is shipped: the meter drains
 * to GLUCOSE.shutFloor. Once it opens again, a dizzy meter is refilled at once, walking or not.
 */
export function stepGlucose(
  dict: TagDictionary, tags: TagState, walked: number, walking: boolean, minute: number, warehouseOpen = true,
): GlucoseStep {
  const was = isDizzy(tags);
  if (warehouseOpen && was) return refill(dict, tags, walked, minute, amount(tags, dict, 'glucose'), true);
  if (!walking) return { tags, walked, events: [] };
  if (walked + 1 < GLUCOSE.drainTicks) return { tags, walked: walked + 1, events: [] };
  if (!warehouseOpen) return shut(dict, tags, minute, was);
  const lowered = lowerAmount(tags, dict, 'glucose', 1);
  const from = amount(lowered, dict, 'glucose');
  if (from >= GLUCOSE.refillBelow) return { tags: lowered, walked: 0, events: [] };
  return refill(dict, lowered, 0, minute, from, false);
}

/** Dizzy below the line, which only a shut warehouse lets the meter reach. */
export const isDizzy = (tags: TagState): boolean => (glucoseOf(tags) ?? GLUCOSE.max) < GLUCOSE.dizzyBelow;

/** A drop with the warehouse shut: no refill, down to its floor, and the `dizzy` flag the first time the line is crossed. */
function shut(dict: TagDictionary, tags: TagState, minute: number, was: boolean): GlucoseStep {
  if (amount(tags, dict, 'glucose') <= GLUCOSE.shutFloor) return { tags, walked: 0, events: [] };
  let out = lowerAmount(tags, dict, 'glucose', 1);
  if (was || !isDizzy(out)) return { tags: out, walked: 0, events: [] };
  if (dict.tags.has('dizzy')) {
    const [log, cause] = record(out.log, { kind: 'rule', key: SHUT_KEY, at: minute });
    out = setFlag({ ...out, log }, dict, 'dizzy', true, cause, minute);
  }
  return { tags: out, walked: 0, events: [{ type: 'dizzyChanged', dizzy: true }] };
}

function refill(dict: TagDictionary, lowered: TagState, walked: number, minute: number, from: number, wasDizzy: boolean): GlucoseStep {
  // One node stands for every refill: a new one each time would grow the log, and every save with
  // it, for as long as the operator walks.
  const seen = lowered.log.nodes.findIndex((n) => n.kind === 'rule' && n.key === REFILL_KEY);
  const [log, cause] = seen >= 0 ? [lowered.log, seen] : record(lowered.log, { kind: 'rule', key: REFILL_KEY, at: minute });
  const refilled = setAmount({ ...lowered, log }, dict, 'glucose', GLUCOSE.refillTo, cause, minute);
  const events: GlucoseEvent[] = [{ type: 'glucoseRefilled', from, to: GLUCOSE.refillTo }];
  if (wasDizzy) events.push({ type: 'dizzyChanged', dizzy: false });
  return { tags: refilled, walked, events };
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
