import { describe, expect, it } from 'vitest';
import { isPresenting, optionMark, PRESENTER_KEY, presenterSettings } from '../../src/app/presenter.ts';
import { decode, encode, SETTINGS } from '../../src/core/index.ts';

describe('the presentation mode (ux-spec 6.1)', () => {
  it('letters the options while presenting and numbers them otherwise', () => {
    expect([0, 1, 2].map((i) => optionMark(i, true))).toEqual(['A', 'B', 'C']);
    expect([0, 1, 2].map((i) => optionMark(i, false))).toEqual(['1', '2', '3']);
  });

  it('enlarges the text and leaves the rest of the settings, in a form the settings slot accepts', () => {
    const slow = { ...SETTINGS.defaults(), gameSpeed: 0.8 } as const;
    const shown = presenterSettings(slow);
    expect(shown).toEqual({ ...slow, textScale: 1.25 });
    expect(decode(SETTINGS, encode(SETTINGS, shown)).kind).toBe('ok');
  });

  it('is on exactly while the marker is in the registry, which the scenes that write a slot ask first', () => {
    const registry = new Map<string, unknown>();
    expect(isPresenting(registry)).toBe(false);
    registry.set(PRESENTER_KEY, { before: SETTINGS.defaults() });
    expect(isPresenting(registry)).toBe(true);
    registry.delete(PRESENTER_KEY);
    expect(isPresenting(registry)).toBe(false);
  });
});
