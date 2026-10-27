import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DIALOGUE_TEXT, STRINGS } from '../../src/app/content.ts';
import { bootCorpus } from '../../src/view/text/corpus.ts';
import { checkFonts, FONTS_CSS, fontCorpus, parseFaces } from '../../tools/check-fonts.ts';

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});

const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'body-inc-fonts-'));
  temps.push(dir);
  return dir;
};

describe('font subset check (issue #15)', () => {
  it('builds the same corpus from the files as Boot builds from the bundle, so the subset cannot drift from the gate', () => {
    expect(fontCorpus('content')).toBe(bootCorpus(STRINGS, DIALOGUE_TEXT));
  });

  it('passes on the real content and fonts', () => {
    expect(checkFonts('content')).toEqual([]);
  });

  it('fails when a string uses a character the base subsets lack', () => {
    const dir = temp();
    cpSync('content', dir, { recursive: true });
    const file = join(dir, 'strings', 'zh-TW.json');
    const j = JSON.parse(readFileSync(file, 'utf8'));
    j.strings['title.ended'].text = '龘';
    writeFileSync(file, JSON.stringify(j));
    const problems = checkFonts(dir);
    expect(problems).toHaveLength(4);
    for (const p of problems) expect(p).toMatch(/字型子集缺少內容用到的 1 個字：龘/);
  });

  it('fails when a face has no unicode-range, which would make the gate trust every character', () => {
    const css = join(temp(), 'fonts.css');
    writeFileSync(css, readFileSync(FONTS_CSS, 'utf8').replace(/;unicode-range:[^}]*/, ''));
    expect(checkFonts('content', css)).toEqual([expect.stringMatching(/Noto Sans TC 400 的 @font-face 沒有 unicode-range/)]);
  });

  it('reads unicode-range lists and spans', () => {
    const [face] = parseFaces('@font-face{font-family:"X";font-weight:700;src:url(a.woff2) format("woff2");unicode-range:U+41-43,U+9F98}');
    expect(face).toEqual({ family: 'X', weight: 700, src: 'a.woff2', codePoints: new Set([0x41, 0x42, 0x43, 0x9f98]) });
  });
});
