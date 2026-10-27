import { readFileSync } from 'node:fs';
import { drawInt, loadDictionary, readContent, seedStreams, type RngStreams, type Scenario, type SemesterContext, type SemesterEvent } from '../../src/core/index.ts';

const read = (file: string): unknown => JSON.parse(readFileSync(new URL(`../../content/${file}`, import.meta.url), 'utf8'));

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
 * A barbecue on each of days 2, 3 and 4, which is what it takes to reach a liver strike: the
 * omen guarantee and the daily sleep repair leave no shorter way (design doc 8.6 keeps a couple of
 * drinking nights from breaking the liver). Late snacks and deadlines are as in `scenarioFor`.
 */
export function bingeWeek(seed: number): Scenario {
  const days: Record<number, string[]> = {};
  for (const [day, ids] of Object.entries(scenarioFor(seed))) days[Number(day)] = ids.filter((id) => id !== 'bbq');
  for (const day of [2, 3, 4]) (days[day] ??= []).push('bbq');
  return days;
}

/** The game's own content, read the way the app reads it, for a semester played by a given skill. */
export function contextFor(skill: number, seed: number, overrides: Partial<SemesterContext> = {}): SemesterContext {
  return {
    dict: loadDictionary(read('tags.json')),
    params: readContent('params', read('params.json')).defaults,
    events: new Map(EVENTS.map((e) => [e.id, e])),
    scenario: scenarioFor(seed),
    skill,
    ...overrides,
  };
}
