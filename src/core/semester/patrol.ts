import { MIST } from '../liver/factory.ts';
import { GRADES, type Grade } from './load.ts';

/**
 * How a played patrol ended: the rating it earned and the perfect dodges it made (`records`, left out when none, which 會議紀錄 turns into
 * progress), or a failure (forced clock-out or given up), which cuts no load and gives no card (design doc 8.4).
 */
export type PatrolResult = { readonly grade: Grade; readonly records?: number } | { readonly failed: true };

export const isFailed = (r: PatrolResult): r is { readonly failed: true } => 'failed' in r;

/** The most hits a patrol can take and still earn the rating for few hits. ASSUME: set by the first playtest, see the "第一版的做法" paragraph of 8.5 in docs/design-doc.md. */
export const HITS_FOR_A = 2;

export interface PatrolTally {
  readonly hits: number;
  readonly forced: boolean;
  readonly records: number;
}

export const NO_TALLY: PatrolTally = { hits: 0, forced: false, records: 0 };

/** The fog of an acetaldehyde crate costs a heart for staying near it, which the liver's core goal (pushing the crates on) cannot avoid: it is not a hit. */
const NOT_A_HIT = MIST.cause;

/** The domain events of a patrol's ticks folded into what the rating reads: a heart lost or an adenosine latching on is a hit, a forced clock-out ends it. */
export function tallyPatrol(tally: PatrolTally, events: readonly { readonly type: string; readonly cause?: string }[]): PatrolTally {
  let { hits, forced, records } = tally;
  for (const e of events) {
    if (e.type === 'clung' || (e.type === 'heartLost' && e.cause !== NOT_A_HIT)) hits += 1;
    else if (e.type === 'forcedLeave') forced = true;
    else if (e.type === 'perfectDodge') records += 1;
  }
  return hits === tally.hits && forced === tally.forced && records === tally.records ? tally : { hits, forced, records };
}

export interface PatrolGoals {
  /** The core room's goal, which design doc 8.5 makes necessary for anything above C. */
  readonly core: boolean;
  readonly side: boolean;
}

/**
 * Design doc 8.5: the core goal is necessary (without it the rating is C at most), and the hits taken and the side goal
 * each lift it one step from B, so S needs all three.
 */
export function ratePatrol(tally: PatrolTally, goals: PatrolGoals): PatrolResult {
  if (tally.forced) return { failed: true };
  const records = tally.records > 0 ? { records: tally.records } : {};
  if (!goals.core) return { grade: 'C', ...records };
  const step = (tally.hits <= HITS_FOR_A ? 1 : 0) + (goals.side ? 1 : 0);
  return { grade: GRADES[1 + step]!, ...records };
}
