/**
 * Font subset check (issue #15). The game draws with self-hosted subsets of its fonts
 * (public/assets/fonts/, built by tools/fonts/build_fonts.py), and Boot waits only for the base
 * subsets. This check fails when the content uses a character a base subset does not declare, so a
 * new line of dialogue cannot quietly draw in a fallback font. Messages are Chinese because content
 * authors read them on the pull request.
 *
 *   node tools/check-fonts.ts [contentDir] [fontsCss]   exit 1 on any problem
 *   node tools/check-fonts.ts --corpus                  print the boot corpus, for build_fonts.py
 *
 * The declared ranges are what the font gate trusts. tools/fonts/check_fonts.py, in the art checks,
 * confirms that every declared character is really in its woff2 file.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StringTable } from '../src/app/feedback.ts';
import { loadDialogueTable, loadDictionary, readContent } from '../src/core/index.ts';
import { bootCorpus } from '../src/view/text/corpus.ts';
import { FACES, FONT } from '../src/view/text/styles.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FONTS_CSS = join(ROOT, 'public', 'assets', 'fonts', 'fonts.css');

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));

/** The corpus Boot hands the font gate, built from the files the way the game builds it from its bundle. */
export function fontCorpus(contentDir = join(ROOT, 'content')): string {
  const strings = readContent('strings', readJson(join(contentDir, 'strings', 'zh-TW.json'))) as StringTable;
  const dict = loadDictionary(readJson(join(contentDir, 'tags.json')));
  const dir = join(contentDir, 'dialogue');
  const files = existsSync(dir)
    ? readdirSync(dir).filter((n) => n.endsWith('.csv')).sort().map((n) => ({ file: `content/dialogue/${n}`, text: readFileSync(join(dir, n), 'utf8') }))
    : [];
  const dialogue = [...loadDialogueTable(files, dict).values()].flatMap((d) => d.lines.map((l) => l.text));
  return bootCorpus(strings, dialogue);
}

export interface DeclaredFace {
  readonly family: string;
  readonly weight: number;
  readonly src: string;
  readonly codePoints: ReadonlySet<number>;
}

/** The @font-face rules of a stylesheet, with each unicode-range expanded to code points. */
export function parseFaces(css: string): DeclaredFace[] {
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => {
    const prop = (name: string) => new RegExp(`${name}\\s*:\\s*([^;]+)`).exec(body!)?.[1]?.trim() ?? '';
    const codePoints = new Set<number>();
    for (const part of prop('unicode-range').split(',')) {
      const m = /^U\+([0-9A-F]+)(?:-([0-9A-F]+))?$/i.exec(part.trim());
      if (!m) continue;
      const a = parseInt(m[1]!, 16);
      const b = m[2] ? parseInt(m[2], 16) : a;
      for (let cp = a; cp <= b; cp++) codePoints.add(cp);
    }
    return {
      family: prop('font-family').replace(/^["']|["']$/g, ''),
      weight: Number(prop('font-weight')),
      src: /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(prop('src'))?.[1] ?? '',
      codePoints,
    };
  });
}

const show = (c: string): string => (c === ' ' ? 'U+00A0（不換行空格）' : c === ' ' ? 'U+0020（空格）' : c);

export function checkFonts(contentDir = join(ROOT, 'content'), cssFile = FONTS_CSS): string[] {
  const here = relative(process.cwd(), cssFile).replaceAll('\\', '/');
  if (!existsSync(cssFile)) return [`${here}：找不到字型樣式表，請執行 python tools/fonts/build_fonts.py`];
  const faces = parseFaces(readFileSync(cssFile, 'utf8'));
  const corpus = [...fontCorpus(contentDir)].filter((c) => c !== '\n');
  const out: string[] = [];
  for (const { role, weight } of FACES) {
    const family = FONT[role];
    const declared = faces.filter((f) => f.family === family && f.weight === weight);
    if (declared.length === 0) {
      out.push(`${here}：沒有 ${family} ${weight} 的 @font-face，請執行 python tools/fonts/build_fonts.py`);
      continue;
    }
    if (declared.some((f) => f.codePoints.size === 0)) {
      out.push(`${here}：${family} ${weight} 的 @font-face 沒有 unicode-range，字型閘門會把每個字都當成已載入`);
      continue;
    }
    const missing = corpus.filter((c) => !declared.some((f) => f.codePoints.has(c.codePointAt(0)!)));
    if (missing.length > 0) {
      out.push(
        `${here}：${family} ${weight} 的字型子集缺少內容用到的 ${missing.length} 個字：${missing.map(show).join('、')}。` +
          '請執行 python tools/fonts/build_fonts.py 重新產生字型；重新產生後還缺的字，表示字型本身沒有這個字，請改用別的字',
      );
    }
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === '--corpus') {
    process.stdout.write(fontCorpus());
    process.exit(0);
  }
  const [contentDir, cssFile] = args;
  const problems = checkFonts(contentDir ? resolve(contentDir) : undefined, cssFile ? resolve(cssFile) : undefined);
  for (const p of problems) console.log(p);
  console.log(`font check: ${problems.length} problem(s)`);
  process.exit(problems.length ? 1 : 0);
}
