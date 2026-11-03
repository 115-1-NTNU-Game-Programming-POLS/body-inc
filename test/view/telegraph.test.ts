import { describe, expect, it } from 'vitest';
import { flashLook } from '../../src/app/comfort.ts';
import { TELEGRAPH } from '../../src/core/index.ts';
import { tier1Flash, warningAt } from '../../src/view/fx/telegraph.ts';

/** One tier-1 telegraph as the views draw it: `warningAt` for each of its ticks. */
const telegraph = Array.from({ length: TELEGRAPH.tier1Ticks }, (_, tick) => warningAt(true, tick));

describe('where a tier-1 warning is on its telegraph (art direction 9.2)', () => {
  it('flashes in the first 0.08 s and again from 0.25 s to 0.33 s, and is a warning all 0.5 s', () => {
    expect(TELEGRAPH.tier1Ticks).toBe(30);
    expect(telegraph.map((w) => (w === 'flash' ? '#' : w === 'telegraph' ? '.' : '?')).join('')).toBe('#####..........#####..........');
    expect(telegraph.every((w) => w !== 'none')).toBe(true);
    expect(telegraph.map((_, t) => tier1Flash(t))).toEqual(telegraph.map((w) => w === 'flash'));
  });

  it('is none when there is no telegraph, whatever the tick', () => {
    for (const tick of [0, 3, 15, 29]) expect(warningAt(false, tick)).toBe('none');
  });

  it('with fewer flashes the outline is on for every tick of the telegraph, where the white flash is on for 10 of 30', () => {
    const looks = (lessFlash: boolean) => telegraph.map((warning, tick) => flashLook({ hit: false, warning }, 'jitter', lessFlash, tick));
    expect(looks(true).every((l) => l.outline && !l.white)).toBe(true);
    expect(looks(false).filter((l) => l.white)).toHaveLength(10);
    expect(looks(false).some((l) => l.outline)).toBe(false);
  });
});
