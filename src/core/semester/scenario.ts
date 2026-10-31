import { drawInt, seedStreams, type RngStreams } from '../rng.ts';
import type { TagDictionary } from '../tags/dictionary.ts';
import type { Scenario, SemesterContext, SemesterEvent, SemesterParams } from './types.ts';

/**
 * The prototype's three events. Their effects are the ones design doc 8.4 and 8.6 load a floor
 * with; the wording, probabilities and the rest of the event library (design doc 8.12) are not
 * modelled. Hours are on the extended clock.
 */
export const EVENTS: readonly SemesterEvent[] = [
  {
    id: 'bbq', hour: 20,
    options: { decline: {}, sober: {}, drink: { alcohol: 3 }, drink_fasting: { alcohol: 3, fasting: true }, binge: { alcohol: 6, fasting: true } },
  },
  {
    id: 'deadline', hour: 14,
    options: { squeeze: { deadline: true, workHours: 2 }, overtime: { deadline: true, bedDelay: 2 } },
  },
  {
    id: 'late_snack', hour: 23,
    options: { no: {}, takeout: { lateSnack: true }, go: { lateSnack: true, bedDelay: 1 } },
  },
];

/** `n` distinct values from `pool`, drawn from the events stream. */
function pick(streams: RngStreams, pool: readonly number[], n: number): [number[], RngStreams] {
  const left = [...pool];
  const out: number[] = [];
  let s = streams;
  for (let i = 0; i < n && left.length > 0; i++) {
    let j: number;
    [j, s] = drawInt(s, 'events', left.length);
    out.push(left.splice(j, 1)[0]!);
  }
  return [out, s];
}

/**
 * One or two barbecues on days 2 to 4 and two each of deadlines and late snacks (counts follow
 * the old sim's event schedule, design doc 8.12), all from the seed so a semester replays.
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
  return days;
}

/**
 * The prototype's context for a seed: its three events and the schedule that seed draws. The game
 * and `sim/` both build theirs here, so a field added to SemesterContext has one place to be set.
 */
export function prototypeContext(dict: TagDictionary, params: SemesterParams, skill: number, seed: number): SemesterContext {
  return { dict, params, events: new Map(EVENTS.map((e) => [e.id, e])), scenario: scenarioFor(seed), skill };
}
