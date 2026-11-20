import { BIND, HIGHLIGHTER } from './frames.ts';

/**
 * What the welfare cards a run holds change in a fight (design doc 8.8). The fight reads this and
 * nothing else of the cards, so `core/combat` needs no knowledge of which card gave what.
 */
export interface Perks {
  /** Staple hits in a row that bind an enemy. */
  readonly bindHits: number;
  /** Damage to every other enemy near a bound one that takes a hit; 0 for none. */
  readonly bindSplash: number;
  /** Binding counts a reflected shot gives the enemy it lands on; 0 for none. */
  readonly parryBind: number;
  /** A parry speeds the operator up for a while. */
  readonly parryBoost: boolean;
  /** Ticks a mark of the highlighter's circle lasts on an enemy. */
  readonly markTicks: number;
  /** Ticks a bound enemy stays pinned. */
  readonly pinTicks: number;
}

export const BASE_PERKS: Perks = { bindHits: BIND.hits, bindSplash: 0, parryBind: 0, parryBoost: false, markTicks: HIGHLIGHTER.markTicks, pinTicks: BIND.pinTicks };
