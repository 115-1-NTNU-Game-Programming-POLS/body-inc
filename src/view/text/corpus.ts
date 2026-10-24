import type { StringTable } from '../../app/feedback.ts';
import { CLOSING, OPENING } from './wrap.ts';

/**
 * Every character the game can draw: printable ASCII (numbers, key names), the no-break
 * space, the punctuation the line breaker knows, and the text of every string in the string
 * table. Game text must come from the string table, which is what makes this set complete.
 */
export function glyphCorpus(strings: StringTable): string {
  const set = new Set<string>();
  for (let c = 0x20; c < 0x7f; c++) set.add(String.fromCharCode(c));
  set.add(' ');
  for (const c of [...CLOSING, ...OPENING, '　', '／', '×', '−']) set.add(c);
  for (const { text } of Object.values(strings.strings)) for (const c of text) set.add(c);
  return [...set].sort().join('');
}
