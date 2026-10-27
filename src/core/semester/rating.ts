import type { CombatPerformance } from '../exam/scoring.ts';
import { GRADES, type Grade } from './load.ts';

/**
 * The abstract combat skill k (design doc 9.5), 0 to 1: what a patrol rating and an exam fight
 * come out as when no room has been played. The doc gives k no distribution, so the roll blurs
 * it by up to half of skillNoise either way.
 */
export interface SkillParams {
  readonly skillNoise: number;
  readonly ratingCuts: readonly number[];
}

/** Blurred skill for one roll, with the roll a float in [0, 1). */
export const blurred = (skill: number, roll: number, k: SkillParams): number =>
  Math.min(1, Math.max(0, skill + (roll - 0.5) * k.skillNoise));

export function gradeFor(skill: number, roll: number, k: SkillParams): Grade {
  const u = blurred(skill, roll, k);
  const cuts = k.ratingCuts;
  const i = cuts.findIndex((cut) => u < cut);
  return GRADES[i === -1 ? cuts.length : i]!;
}

/** The three parts of 8.9's combat performance, all taken from one roll of the blurred skill. */
export function examPerformance(skill: number, roll: number, k: SkillParams): CombatPerformance {
  const u = blurred(skill, roll, k);
  return { answerRate: u, hitScore: u, bonusRate: u };
}
