import type { Measure } from './wrap.ts';

const NBSP = ' ';

/**
 * Width model for code that runs without a canvas (content checks, Node tests): CJK and
 * full-width marks are 1 em, anything else 0.55 em, spaces 0.3 em. Close for Chinese text and
 * a little generous for Latin letters, so a line that fits here also fits in the game.
 */
export const modelMeasure = (size: number): Measure => (s) =>
  [...s].reduce((w, c) => w + size * (c === ' ' || c === NBSP ? 0.3 : c.codePointAt(0)! >= 0x2000 ? 1 : 0.55), 0);
