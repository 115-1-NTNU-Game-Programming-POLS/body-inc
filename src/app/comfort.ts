import type { Settings } from '../core/index.ts';

/** The assists the view carries out itself (design doc 5.7, art direction 9.2 and 10). */
export interface Comfort {
  readonly noShake: boolean;
  readonly lessFlash: boolean;
}

export const FULL_EFFECTS: Comfort = { noShake: false, lessFlash: false };

export const comfortOf = (settings: Settings | undefined): Comfort =>
  settings ? { noShake: settings.noShake, lessFlash: settings.lessFlash } : FULL_EFFECTS;

/** How a sprite that is flashing is drawn on one tick. */
export interface FlashLook {
  /** Painted solid white. */
  readonly white: boolean;
  /** Ringed by a steady 1 px ink-blue outline. */
  readonly outline: boolean;
  /** World pixels the sprite is moved sideways. */
  readonly shiftX: -1 | 0 | 1;
}

/** What a hit flash becomes under "reduce flashes": enemies shake sideways, the operator gets the outline. */
export type HitAs = 'jitter' | 'outline';

/**
 * Where a tier-1 warning is on this tick: not telegraphing, telegraphing, or telegraphing inside one
 * of the two white-flash windows. The outline of the reduced form lasts for all of the telegraph.
 */
export type Warning = 'none' | 'telegraph' | 'flash';

const STEADY: FlashLook = { white: false, outline: false, shiftX: 0 };

/**
 * The white flash of a hit or of a tier-1 warning, or what stands in for it (art direction 9.2):
 * a hit shifts an enemy 1 px left and right on alternate ticks, a warning becomes a steady
 * outline for the whole telegraph. Nothing flashes in the reduced form.
 */
export function flashLook(flash: { readonly hit: boolean; readonly warning: Warning }, hitAs: HitAs, lessFlash: boolean, tick: number): FlashLook {
  if (!flash.hit && flash.warning === 'none') return STEADY;
  if (!lessFlash) return flash.hit || flash.warning === 'flash' ? { white: true, outline: false, shiftX: 0 } : STEADY;
  return {
    white: false,
    outline: flash.warning !== 'none' || (flash.hit && hitAs === 'outline'),
    shiftX: flash.hit && hitAs === 'jitter' ? (tick % 2 === 0 ? -1 : 1) : 0,
  };
}

/** Ticks of each half of the invulnerability blink: alpha 0.5 and 1.0 alternate every 0.1 s. */
export const BLINK_TICKS = 6;
/** The fixed alpha that replaces the blink under "reduce flashes". */
export const STEADY_INVULN_ALPHA = 0.6;

/**
 * `outlined` is true while the hit outline is drawn: it is a silhouette behind the sprite, so a
 * translucent sprite would show it through as a dark patch, and the sprite is opaque for those ticks.
 */
export function invulnAlpha(invulnerable: boolean, lessFlash: boolean, tick: number, outlined = false): number {
  if (!invulnerable) return 1;
  if (lessFlash) return outlined ? 1 : STEADY_INVULN_ALPHA;
  return Math.floor(tick / BLINK_TICKS) % 2 === 0 ? 0.5 : 1;
}
