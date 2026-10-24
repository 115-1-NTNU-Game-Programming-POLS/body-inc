import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DIALOGUE } from '../../src/view/text/styles.ts';
import { CLOSING, OPENING, units, wrapCJK, type Measure } from '../../src/view/text/wrap.ts';

const SAMPLES = (JSON.parse(readFileSync('test/fixtures/text/dialogue-samples.json', 'utf8')) as { samples: { text: string }[] }).samples;
const NBSP = ' ';

/** Width model for Node: CJK and full-width marks are 1 em, Latin 0.55 em, spaces 0.3 em. */
const model = (size: number): Measure => (s) =>
  [...s].reduce((w, c) => w + size * (c === ' ' || c === NBSP ? 0.3 : c.codePointAt(0)! >= 0x2000 ? 1 : 0.55), 0);

const chars = (lines: string[]) => lines.join('').replace(/ /g, '');

describe('wrapCJK rules (art direction 8.2)', () => {
  const em = model(10);
  const W = 50; // five full-width characters per line

  it('breaks Chinese by character', () => {
    expect(wrapCJK('一二三四五六七', W, em)).toEqual(['一二三四五', '六七']);
  });

  it('never starts a line with closing punctuation; the last character moves down with it', () => {
    expect(wrapCJK('一二三四五。六', W, em)).toEqual(['一二三四', '五。六']);
    expect(wrapCJK('一二三四五！」', W, em)).toEqual(['一二三四', '五！」']);
    expect(wrapCJK('一二三四五……', W, em)).toEqual(['一二三四', '五……']);
  });

  it('never ends a line with opening punctuation', () => {
    expect(wrapCJK('一二三四「五六」', W, em)).toEqual(['一二三四', '「五六」']);
  });

  it('keeps a number with its unit across a no-break space', () => {
    // "一二三300 " just fits, so without the join the break would fall between 300 and 毫克.
    expect(em(`一二三300${NBSP}`)).toBeLessThanOrEqual(W);
    expect(wrapCJK(`一二三300${NBSP}毫克`, W, em)).toEqual(['一二三', `300${NBSP}毫克`]);
  });

  it('keeps a handbook page name in one line', () => {
    expect(wrapCJK('看手冊〈咖啡因〉', W, em)).toEqual(['看手冊', '〈咖啡因〉']);
  });

  it('breaks Latin text at spaces only, and drops the space at the break', () => {
    expect(wrapCJK('ab cd ef gh', 30, em)).toEqual(['ab cd', 'ef gh']);
    expect(units('v1.5 版')).toEqual(['v1.5', ' ', '版']);
  });

  it('splits a unit wider than a whole line rather than overflow', () => {
    const lines = wrapCJK('abcdefghijklmnop', W, em);
    expect(lines.every((l) => em(l) <= W)).toBe(true);
    expect(lines.join('')).toBe('abcdefghijklmnop');
  });

  it('honours explicit newlines', () => {
    expect(wrapCJK('一\n二', W, em)).toEqual(['一', '二']);
  });
});

describe('dialogue samples at the dialogue box width (build plan S10)', () => {
  for (const scale of [1, 1.25]) {
    const size = DIALOGUE.fontSize * scale;
    const max = DIALOGUE.maxWidth(scale);
    const em = model(size);

    it(`at ${scale * 100}% every sample fits, keeps its text and obeys the rules`, () => {
      expect(max).toBeLessThanOrEqual(DIALOGUE.boxInnerWidth);
      for (const { text } of SAMPLES) {
        const lines = wrapCJK(text, max, em);
        expect(lines.length, text).toBeLessThanOrEqual(DIALOGUE.maxLines);
        for (const l of lines) {
          expect(em(l), l).toBeLessThanOrEqual(max);
          expect(CLOSING.has([...l][0]!), l).toBe(false);
          expect(OPENING.has([...l].at(-1)!), l).toBe(false);
        }
        expect(chars(lines)).toBe(text.replace(/ /g, ''));
        for (const l of lines) expect(l.startsWith(NBSP) || l.endsWith(NBSP), l).toBe(false);
      }
    });
  }

  it('caps dialogue lines at 30 full-width characters (art direction 8.2)', () => {
    expect(DIALOGUE.maxWidth(1)).toBe(30 * 22);
    expect(DIALOGUE.maxWidth(1.25)).toBe(30 * 27.5);
  });

  it('the samples exercise every rule', () => {
    const all = SAMPLES.map((s) => s.text).join('');
    expect(all).toContain(NBSP);
    expect(all).toContain('〈');
    expect(all).toContain('……');
    expect(/[A-Za-z]{4,}/.test(all)).toBe(true);
    // At 30 characters per line some samples must actually wrap, or the test proves nothing.
    expect(SAMPLES.some((s) => wrapCJK(s.text, DIALOGUE.maxWidth(1), model(DIALOGUE.fontSize)).length > 1)).toBe(true);
  });
});
