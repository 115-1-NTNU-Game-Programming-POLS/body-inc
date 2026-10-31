import { describe, expect, it } from 'vitest';
import { optionMark, presenterSettings } from '../../src/app/presenter.ts';
import { decode, encode, SETTINGS } from '../../src/core/index.ts';

describe('the presentation mode (ux-spec 6.1)', () => {
  it('letters the options while presenting and numbers them otherwise', () => {
    expect([0, 1, 2].map((i) => optionMark(i, true))).toEqual(['A', 'B', 'C']);
    expect([0, 1, 2].map((i) => optionMark(i, false))).toEqual(['1', '2', '3']);
  });

  it('enlarges the text and leaves the rest of the settings, in a form the settings slot accepts', () => {
    const slow = { textScale: 1, gameSpeed: 0.8 } as const;
    const shown = presenterSettings(slow);
    expect(shown).toEqual({ textScale: 1.25, gameSpeed: 0.8 });
    expect(decode(SETTINGS, encode(SETTINGS, shown)).kind).toBe('ok');
  });
});
