import type { TagDictionary } from './tags/dictionary.ts';
import { amount, type TagState } from './tags/store.ts';

/** The two coefficients of content/params.json that turn sleep debt into S. */
export interface SleepCoefficients {
  readonly sCoef: number;
  readonly sFloor: number;
}

/** S = max(sFloor, 1 - sCoef x sleep debt) (design doc glossary). */
export function sleepFactor(sleepDebt: number, k: SleepCoefficients): number {
  return Math.max(k.sFloor, 1 - k.sCoef * Math.max(0, sleepDebt));
}

/** P = 0.5 + 0.5 x S: the chairman's spirit, which scales stamp charging (design doc 5.4). */
export function chairmanSpirit(s: number): number {
  return 0.5 + 0.5 * s;
}

/** P for a room entry; it stays fixed until the next entry, like the variant layers. */
export function spiritAtEntry(tags: TagState, dict: TagDictionary, k: SleepCoefficients): number {
  return chairmanSpirit(sleepFactor(amount(tags, dict, 'sleep_debt'), k));
}
