import { nextInt } from '../rng.ts';
import type { FloorThresholds } from './floors.ts';

const ELEVATOR_STOP_ONE_IN = 3;

/**
 * The liver never lights (design doc 8.6), so it gives itself away through four other channels.
 * Two live here: the work orders that every liver-loading event pins on the board (input is
 * always visible), and the cross-floor clues, which are what other departments notice of the
 * liver's backlog. Three things read the exact load (design doc 8.6): the start-of-term checkup
 * on day 1, the blood test event `blood_test` (scenario.ts), and the highlighter lit on the liver in
 * its patrol; `DayView.liverReading` carries the latest.
 */
export interface LiverClues {
  /** Days on which a liver-loading event sent a work order. */
  readonly orders: readonly number[];
  /** The stomach's conveyor to the liver is jammed and the chairman asks why the liver does not answer. */
  readonly stomachJam: boolean;
  /** The elevator sometimes stops at the liver and the typing of overtime can be heard. */
  readonly elevatorStops: boolean;
}

export function liverClues(load: number, orders: readonly number[], k: FloorThresholds, day: number, salt: number): LiverClues {
  // One roll per day, independent of event choices, patrols and the order in which the day is replayed.
  const elevatorStops = load >= k.floorOrangeAt && nextInt(salt ^ Math.imul(day, 0x9e3779b1), ELEVATOR_STOP_ONE_IN)[0] === 0;
  return { orders, stomachJam: stomachConveyorJammed(load, k), elevatorStops };
}

export const stomachConveyorJammed = (load: number, k: FloorThresholds): boolean => load >= k.floorYellowAt;

export interface LiverStrikeInput {
  readonly load: number;
  /** An alcohol tag is on at bedtime. */
  readonly alcohol: boolean;
  /** The double-medication tag is on at bedtime. */
  readonly dupMedication: boolean;
  /** Days of earlier work orders. */
  readonly orders: readonly number[];
  readonly day: number;
}

/**
 * The three conditions of design doc 8.6, all at once: load at the red line, alcohol or double
 * medication still in the body at bedtime, and a work order from an earlier day, which
 * guarantees the player at least one day on which the liver could have been patrolled.
 */
export function liverStrikes(i: LiverStrikeInput, k: FloorThresholds): boolean {
  return i.load >= k.floorRedAt && (i.alcohol || i.dupMedication) && i.orders.some((d) => d < i.day);
}
