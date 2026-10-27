import { mapFloors, type FloorId, type FloorThresholds, type Loads } from './floors.ts';

/** Patrol rating (design doc 8.5). The rating, not the player's score, decides how far a load falls. */
export const GRADES = ['C', 'B', 'A', 'S'] as const;
export type Grade = (typeof GRADES)[number];

export interface FloorContrib {
  readonly debtBrain: number;
  readonly deadlineBrain: number;
  readonly toleranceBrain: number;
  readonly lateSnackStomach: number;
  readonly alcoholLiver: number;
  readonly fastingAlcoholMult: number;
}

export interface LoadParams extends FloorThresholds {
  readonly floorOmenCap: number;
  readonly floorSleepRepair: number;
  readonly floorNeglect: number;
  readonly floorPatrolBase: number;
  readonly floorPatrolPerGrade: number;
  readonly floorStallBest: number;
  readonly floorContrib: FloorContrib;
}

export const patrolReduction = (grade: Grade, k: LoadParams): number =>
  k.floorPatrolBase + k.floorPatrolPerGrade * GRADES.indexOf(grade);

/** What a day did that moves a floor, read at the night settlement. */
export interface DayFacts {
  /** Sleep debt left after tonight's sleep. */
  readonly debtAfter: number;
  readonly deadline: boolean;
  /** Caffeine tolerance holds. */
  readonly tolerant: boolean;
  readonly lateSnack: boolean;
  readonly alcoholCups: number;
  /** Drinking on an empty stomach. */
  readonly fasting: boolean;
}

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;

/**
 * The tag contribution column of design doc 8.4, for the behaviours the prototype produces.
 * Immune and gut have no producer yet, so they always return 0.
 */
export function contributions(f: DayFacts, k: LoadParams): Loads {
  const c = k.floorContrib;
  return mapFloors((floor): number => {
    switch (floor) {
      case 'brain': return c.debtBrain * f.debtAfter + (f.deadline ? c.deadlineBrain : 0) + (f.tolerant ? c.toleranceBrain : 0);
      case 'stomach': return f.lateSnack ? c.lateSnackStomach : 0;
      case 'liver': return c.alcoholLiver * f.alcoholCups * (f.fasting ? c.fastingAlcoholMult : 1);
      case 'immune':
      case 'gut':
        return 0;
    }
  });
}

export interface FloorNight {
  /** Effective sleep hours of the night. */
  readonly sleep: number;
  /** Grade of today's patrol of this floor, when it was patrolled. */
  readonly grade?: Grade;
  /** Someone looked after the floor today, so the neglect bonus is waived: a patrol, or a hospital day. */
  readonly attended: boolean;
}

/**
 * Tomorrow's load (design doc 8.4):
 *   load + contribution + neglect bonus - sleep repair - patrol reduction
 * with two guards: a floor that was under orange cannot reach a strike in one night, so every
 * strike is preceded by at least one orange night, and a patrol of a striking floor can only
 * bring it down to floorStallBest. The result stays within 0 to 100.
 */
export function nextLoad(prev: number, add: number, night: FloorNight, k: LoadParams): number {
  let load = prev + add;
  if (prev >= k.floorYellowAt && !night.attended) load += k.floorNeglect;
  load -= k.floorSleepRepair * night.sleep;
  if (night.grade !== undefined) load -= patrolReduction(night.grade, k);
  if (prev < k.floorOrangeAt) load = Math.min(load, k.floorOmenCap);
  if (night.grade !== undefined && prev >= k.floorRedAt) load = Math.max(load, k.floorStallBest);
  return round6(Math.min(100, Math.max(0, load)));
}

/** Floors that strike other than the liver, which has its own rule (liver.ts). */
export const strikes = (floor: FloorId, load: number, k: FloorThresholds): boolean => floor !== 'liver' && load >= k.floorRedAt;
