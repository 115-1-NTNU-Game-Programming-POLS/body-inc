import { GRADES, type Grade } from './load.ts';

/** How a played patrol ended: the rating it earned, or a failure (forced clock-out or given up), which cuts no load and gives no card (design doc 8.4). */
export type PatrolResult = { readonly grade: Grade } | { readonly failed: true };

export const isFailed = (r: PatrolResult): r is { readonly failed: true } => 'failed' in r;

/** The most hits a patrol can take and still earn the rating for few hits. ASSUME: set by the first playtest, see "巡視的評等" in docs/design-doc.md. */
export const HITS_FOR_A = 2;

export interface PatrolTally {
  readonly hits: number;
  readonly forced: boolean;
}

export const NO_TALLY: PatrolTally = { hits: 0, forced: false };

/** The domain events of a patrol's ticks folded into what the rating reads; only these two types matter. */
export function tallyPatrol(tally: PatrolTally, events: readonly { readonly type: string }[]): PatrolTally {
  let { hits, forced } = tally;
  for (const e of events) {
    if (e.type === 'heartLost') hits += 1;
    else if (e.type === 'forcedLeave') forced = true;
  }
  return hits === tally.hits && forced === tally.forced ? tally : { hits, forced };
}

export interface PatrolGoals {
  /** The core room's goal, which design doc 8.5 makes necessary for anything above C. */
  readonly core: boolean;
  /** The side goal of the floor. */
  readonly side: boolean;
}

/**
 * Design doc 8.5: the core goal is necessary (without it the rating is C at most), and the hits taken and the side goal
 * each lift it one step from B, so S needs all three.
 */
export function ratePatrol(tally: PatrolTally, goals: PatrolGoals): PatrolResult {
  if (tally.forced) return { failed: true };
  if (!goals.core) return { grade: 'C' };
  const step = (tally.hits <= HITS_FOR_A ? 1 : 0) + (goals.side ? 1 : 0);
  return { grade: GRADES[1 + step]! };
}
