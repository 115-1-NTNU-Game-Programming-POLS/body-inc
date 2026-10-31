import { readFileSync } from 'node:fs';
import { EVENTS, loadDictionary, prototypeContext, readContent, scenarioFor, withBarbecueOn, type Scenario, type SemesterContext } from '../../src/core/index.ts';

export { EVENTS, scenarioFor };

const read = (file: string): unknown => JSON.parse(readFileSync(new URL(`../../content/${file}`, import.meta.url), 'utf8'));

/**
 * A barbecue on each of days 2, 3 and 4, which is what it takes to reach a liver strike: the
 * omen guarantee and the daily sleep repair leave no shorter way (design doc 8.6 keeps a couple of
 * drinking nights from breaking the liver). Late snacks and deadlines are as in `scenarioFor`.
 */
export const bingeWeek = (seed: number): Scenario => withBarbecueOn(scenarioFor(seed), [2, 3, 4]);

/** Barbecues on days 2 to 4 and again on 6 and 7: enough for a second trip to the emergency room. */
export const bingeTwice = (seed: number): Scenario => withBarbecueOn(scenarioFor(seed), [2, 3, 4, 6, 7]);

/** A barbecue on every evening of days 2 to 9, for a player who drinks but eats first. */
export const drinkWeek = (seed: number): Scenario => withBarbecueOn(scenarioFor(seed), [2, 3, 4, 5, 6, 7, 8, 9]);

/** A late snack on every evening of days 2 to 9 and a deadline on four of them, with no barbecue. */
export function crunchWeek(_seed: number): Scenario {
  const days: Record<number, string[]> = {};
  for (let day = 2; day <= 9; day++) days[day] = [...([3, 4, 8, 9].includes(day) ? ['deadline'] : []), 'late_snack'];
  return days;
}

/** The game's own content, read the way the app reads it, for a semester played by a given skill. */
export function contextFor(skill: number, seed: number, overrides: Partial<SemesterContext> = {}): SemesterContext {
  return {
    ...prototypeContext(loadDictionary(read('tags.json')), readContent('params', read('params.json')).defaults, skill, seed),
    ...overrides,
  };
}
