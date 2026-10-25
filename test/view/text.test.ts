import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DIALOGUE_TEXT, STRINGS } from '../../src/app/content.ts';
import { glyphCorpus } from '../../src/view/text/corpus.ts';

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : n.endsWith('.ts') ? [join(dir, n)] : []));

describe('text goes through the font gate (build plan S10)', () => {
  it('the corpus covers every dialogue line too, which lives in CSV files, not in the string table', () => {
    const corpus = new Set(glyphCorpus(STRINGS, DIALOGUE_TEXT));
    expect(DIALOGUE_TEXT.length).toBeGreaterThan(0);
    for (const text of DIALOGUE_TEXT) expect([...text].filter((c) => !corpus.has(c)), text).toEqual([]);
    // Without the extra texts some dialogue glyph is missing, so the loop above can fail.
    const without = new Set(glyphCorpus(STRINGS));
    expect(DIALOGUE_TEXT.some((t) => [...t].some((c) => !without.has(c)))).toBe(true);
  });

  it('only view/text/fonts.ts creates or changes Phaser text objects', () => {
    const offenders = walk('src/view')
      .filter((f) => !f.replaceAll('\\', '/').endsWith('view/text/fonts.ts'))
      .filter((f) => /\.(add|make)\.text\(|\.setText\(/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('no Chinese text is written into view code; it belongs in content/strings', () => {
    const offenders = walk('src/view').flatMap((f) =>
      readFileSync(f, 'utf8').split('\n').flatMap((line, i) => {
        const code = line.replace(/\/\/.*$|\/\*.*?\*\/|^\s*\*.*$/g, '');
        return /[㐀-鿿]/.test(code) ? [`${f}:${i + 1}`] : [];
      }));
    expect(offenders).toEqual([]);
  });

  it('the corpus covers every string, so strings never render in a fallback font', () => {
    const corpus = new Set(glyphCorpus(STRINGS));
    for (const { text } of Object.values(STRINGS.strings)) expect([...text].filter((c) => !corpus.has(c)), text).toEqual([]);
    expect(corpus.has(' ')).toBe(true);
  });
});
