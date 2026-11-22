import { drawDistinct, drawInt, seedStreams, type RngStreams } from '../rng.ts';
import type { TagDictionary } from '../tags/dictionary.ts';
import type { Scenario, SemesterContext, SemesterEvent, SemesterParams } from './types.ts';

/**
 * The prototype's events. The first three carry the effects design doc 8.4 and 8.6 load a floor
 * with; the blood test is the active check of design doc 8.6. The wording, probabilities and the
 * rest of the event library (design doc 8.12) are not modelled. Hours are on the extended clock.
 */
export const EVENTS: readonly SemesterEvent[] = [
  {
    id: 'bbq', hour: 20,
    options: { decline: {}, sober: {}, drink: { alcohol: 3 }, drink_fasting: { alcohol: 3, fasting: true }, binge: { alcohol: 6, fasting: true } },
  },
  {
    id: 'deadline', hour: 14,
    // The program deadline of design doc 8.12 raises stress by 20 whichever way it is met.
    options: { squeeze: { deadline: true, workHours: 2, stress: 20 }, overtime: { deadline: true, bedDelay: 2, stress: 20 } },
  },
  {
    id: 'late_snack', hour: 23,
    options: { no: {}, takeout: { lateSnack: true }, go: { lateSnack: true, bedDelay: 1 } },
  },
  {
    // An afternoon at the health office after lunch; the two hours are a placeholder until playtest.
    id: 'blood_test', hour: 13,
    options: { decline: {}, go: { workHours: 2, bloodTest: true } },
  },
];

/**
 * Days the health office can draw blood: school days off the exams and past the first two, so a
 * barbecue may already be on the books. Design doc 8.6 has it once a semester.
 */
export const BLOOD_TEST_DAYS: readonly number[] = [3, 4, 8, 9];

/** `n` distinct values from `pool`, drawn from the events stream. */
const pick = (streams: RngStreams, pool: readonly number[], n: number): [number[], RngStreams] => drawDistinct(streams, 'events', pool, n);

/**
 * One or two barbecues on days 2 to 4 and two each of deadlines and late snacks (counts follow
 * the old sim's event schedule, design doc 8.12), then one blood test, all from the seed so a
 * semester replays. The blood test is drawn last, so the days of the others are what they were.
 */
export function scenarioFor(seed: number): Scenario {
  const days: Record<number, string[]> = {};
  const add = (day: number, id: string) => (days[day] ??= []).push(id);
  let s = seedStreams(seed);
  let n: number;
  [n, s] = drawInt(s, 'events', 2);
  let chosen: number[];
  [chosen, s] = pick(s, [2, 3, 4], n + 1);
  chosen.forEach((d) => add(d, 'bbq'));
  [chosen, s] = pick(s, [3, 4, 8, 9], 2);
  chosen.forEach((d) => add(d, 'deadline'));
  [chosen, s] = pick(s, [2, 3, 4, 6, 7, 8, 9], 2);
  chosen.forEach((d) => add(d, 'late_snack'));
  [chosen, s] = pick(s, BLOOD_TEST_DAYS, 1);
  chosen.forEach((d) => add(d, 'blood_test'));
  return days;
}

/** The scenario with the barbecue taken off every day and put on exactly `days`; every other event stays where it was. */
export function withBarbecueOn(scenario: Scenario, days: readonly number[]): Scenario {
  const out: Record<number, readonly string[]> = {};
  for (const [day, ids] of Object.entries(scenario)) out[Number(day)] = ids.filter((id) => id !== 'bbq');
  for (const day of days) out[day] = [...(out[day] ?? []), 'bbq'];
  return out;
}

/** The scenario with the blood test taken off every day and put on `day` (健檢提前, design doc 8.14); every other event stays. */
export function withBloodTestOn(scenario: Scenario, day: number): Scenario {
  const out: Record<number, readonly string[]> = {};
  for (const [d, ids] of Object.entries(scenario)) out[Number(d)] = ids.filter((id) => id !== 'blood_test');
  out[day] = [...(out[day] ?? []), 'blood_test'];
  return out;
}

/**
 * The prototype's context for a seed: its three events and the schedule that seed draws. The game
 * and `sim/` both build theirs here, so a field added to SemesterContext has one place to be set.
 */
export function prototypeContext(dict: TagDictionary, params: SemesterParams, skill: number, seed: number): SemesterContext {
  return { dict, params, events: new Map(EVENTS.map((e) => [e.id, e])), scenario: scenarioFor(seed), skill };
}
