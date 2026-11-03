import { describe, expect, it } from 'vitest';
import { BLINK_TICKS, comfortOf, flashLook, FULL_EFFECTS, invulnAlpha, STEADY_INVULN_ALPHA, type Warning } from '../../src/app/comfort.ts';
import { SETTINGS } from '../../src/core/index.ts';

const NOTHING = { hit: false, warning: 'none' as Warning };
const HIT = { hit: true, warning: 'none' as Warning };
const flash = (warning: Warning, hit = false) => ({ hit, warning });

describe('the comfort assists the view carries out', () => {
  it('reads only its two flags from the settings, and shows everything before they are loaded', () => {
    expect(comfortOf(undefined)).toEqual(FULL_EFFECTS);
    expect(comfortOf(SETTINGS.defaults())).toEqual(FULL_EFFECTS);
    const base = SETTINGS.defaults();
    expect(comfortOf({ ...base, noShake: true })).toEqual({ noShake: true, lessFlash: false });
    expect(comfortOf({ ...base, lessFlash: true })).toEqual({ noShake: false, lessFlash: true });
    for (const other of ['halfDamage', 'neverEmpty', 'autoPerfect', 'toggleAttack'] as const) expect(comfortOf({ ...base, [other]: true }), other).toEqual(FULL_EFFECTS);
  });
});

describe('what a flash looks like (art direction 9.2)', () => {
  it('is the white flash by default, for a hit and inside a warning flash window alike', () => {
    for (const f of [HIT, flash('flash'), flash('flash', true), flash('telegraph', true)]) {
      for (const hitAs of ['jitter', 'outline'] as const) expect(flashLook(f, hitAs, false, 7)).toEqual({ white: true, outline: false, shiftX: 0 });
    }
  });

  it('shows nothing white between the two flash windows of a warning, with the assist off', () => {
    expect(flashLook(flash('telegraph'), 'jitter', false, 7)).toEqual({ white: false, outline: false, shiftX: 0 });
  });

  it('is nothing when nothing flashes, with the assist on or off', () => {
    for (const less of [false, true]) expect(flashLook(NOTHING, 'jitter', less, 3)).toEqual({ white: false, outline: false, shiftX: 0 });
  });

  it('never paints white once reduced: a hit on an enemy shifts a pixel left and right on alternate ticks', () => {
    expect(flashLook(HIT, 'jitter', true, 10)).toEqual({ white: false, outline: false, shiftX: -1 });
    expect(flashLook(HIT, 'jitter', true, 11)).toEqual({ white: false, outline: false, shiftX: 1 });
    expect(flashLook(HIT, 'jitter', true, 12).shiftX).toBe(-1);
  });

  it('a hit on the operator is an outline that does not move her', () => {
    for (const tick of [0, 1, 2, 3]) expect(flashLook(HIT, 'outline', true, tick)).toEqual({ white: false, outline: true, shiftX: 0 });
  });

  it('a warning is an outline for the whole telegraph, in a flash window or between them', () => {
    for (const hitAs of ['jitter', 'outline'] as const) {
      for (const warning of ['telegraph', 'flash'] as const) {
        for (const tick of [0, 1, 2, 3, 4, 5, 6]) expect(flashLook(flash(warning), hitAs, true, tick), `${hitAs} ${warning} ${tick}`).toEqual({ white: false, outline: true, shiftX: 0 });
      }
    }
  });

  it('a hit and a warning at once give both the shift and the outline', () => {
    expect(flashLook(flash('telegraph', true), 'jitter', true, 4)).toEqual({ white: false, outline: true, shiftX: -1 });
  });
});

describe('the blink of the invulnerability window', () => {
  it('alternates 0.5 and 1.0 every 0.1 s, and is plain when the operator can be hit', () => {
    expect(BLINK_TICKS).toBe(6);
    const alphas = Array.from({ length: 4 * BLINK_TICKS }, (_, t) => invulnAlpha(true, false, t));
    expect(alphas.slice(0, BLINK_TICKS)).toEqual(Array(BLINK_TICKS).fill(0.5));
    expect(alphas.slice(BLINK_TICKS, 2 * BLINK_TICKS)).toEqual(Array(BLINK_TICKS).fill(1));
    expect(alphas.slice(2 * BLINK_TICKS, 3 * BLINK_TICKS)).toEqual(Array(BLINK_TICKS).fill(0.5));
    for (const less of [false, true]) for (const t of [0, 3, 6, 9]) expect(invulnAlpha(false, less, t)).toBe(1);
  });

  it('is one fixed transparency when flashes are reduced', () => {
    expect(STEADY_INVULN_ALPHA).toBe(0.6);
    for (let t = 0; t < 4 * BLINK_TICKS; t++) expect(invulnAlpha(true, true, t)).toBe(0.6);
  });

  it('is opaque while the hit outline is drawn, so the outline does not show through the body', () => {
    for (let t = 0; t < 2 * BLINK_TICKS; t++) expect(invulnAlpha(true, true, t, true)).toBe(1);
    // Without the assist the white flash and the blink go on as they were.
    expect(invulnAlpha(true, false, 0, true)).toBe(0.5);
  });
});
