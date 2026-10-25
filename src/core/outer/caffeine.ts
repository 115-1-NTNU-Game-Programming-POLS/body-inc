import { TILE } from '../time.ts';
import type { TagDictionary } from '../tags/dictionary.ts';
import { amount, decayAmount, type TagState } from '../tags/store.ts';

/**
 * The operator's caffeine residual (the `caffeine` tag) on the chapter clock (design doc 7.4).
 * A cup adds 100 and the residual halves every `halfLife` game hours (content/params.json). The
 * boss's own residual runs on the boss clock in combat/bosses and is a different number.
 */

export interface MetabolismParams {
  /** Game hours for the residual to halve. */
  readonly halfLife: number;
}

/**
 * The cloak (design doc 7.4): at 50 or more adenosine cannot see the operator, from 25 to 50 it
 * notices only within 2 tiles, below 25 the cloak is gone.
 */
export const CLOAK = {
  blindAt: 50,
  nearAt: 25,
  nearPx: 2 * TILE,
} as const;

/** The residual now; 0 under a dictionary without the tag (test dictionaries). */
export const caffeineOf = (tags: TagState, dict: TagDictionary): number => (dict.tags.has('caffeine') ? amount(tags, dict, 'caffeine') : 0);

/** How far clinging enemies can see the operator at this residual, or undefined when uncloaked. */
export function senseCap(caffeine: number): number | undefined {
  if (caffeine >= CLOAK.blindAt) return 0;
  if (caffeine >= CLOAK.nearAt) return CLOAK.nearPx;
  return undefined;
}

/** The residual after `minutes` of the chapter clock. */
export function metabolise(tags: TagState, dict: TagDictionary, minutes: number, k: MetabolismParams): TagState {
  if (minutes <= 0 || caffeineOf(tags, dict) === 0) return tags;
  return decayAmount(tags, dict, 'caffeine', 0.5 ** (minutes / (k.halfLife * 60)));
}
