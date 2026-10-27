import type { StringTable } from '../../app/feedback.ts';
import { DEFAULT_HOST } from '../../core/index.ts';
import { CLOSING, OPENING } from './wrap.ts';

/**
 * Every character the game can draw: printable ASCII (numbers, key names), the no-break
 * space, the punctuation the line breaker knows, and the text of every string in the string
 * table. Game text must come from the string table, which is what makes this set complete,
 * except dialogue, which lives in CSV files and is passed in as `extra`.
 */
export function glyphCorpus(strings: StringTable, extra: readonly string[] = []): string {
  const set = new Set<string>();
  for (let c = 0x20; c < 0x7f; c++) set.add(String.fromCharCode(c));
  set.add(' ');
  for (const c of [...CLOSING, ...OPENING, '　', '／', '×', '−']) set.add(c);
  for (const { text } of Object.values(strings.strings)) for (const c of text) set.add(c);
  for (const text of extra) for (const c of text) set.add(c);
  return [...set].sort().join('');
}

/**
 * What Boot loads before the title, and so what the self-hosted base subset must hold
 * (tools/fonts/build_fonts.py). The default host name is in no content text, but `{host}` reads as
 * it on a fresh save.
 */
export const bootCorpus = (strings: StringTable, dialogue: readonly string[]): string =>
  glyphCorpus(strings, [...dialogue, DEFAULT_HOST]);
