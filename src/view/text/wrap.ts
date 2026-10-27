/**
 * Character-based line breaking for Chinese (art direction 8.2). Phaser's wordWrap breaks only
 * at spaces, so a Chinese line with none overflows its box. This module is pure: the caller
 * passes a width function (canvas measureText in the game, a fixed model in tests).
 *
 * Rules, applied by gluing characters into units that are never split:
 * 1. closing punctuation never starts a line (it is glued to the character before it);
 * 2. opening punctuation never ends a line (it is glued to the character after it);
 * 3. a no-break space (U+00A0, as in "300 mg") joins its neighbours, so a number stays
 *    with its unit;
 * 4. a handbook page name in 〈〉 is one unit.
 * Latin words and digit runs are also units, breaking only at spaces. A unit wider than a
 * whole line is split by character, the one case where a rule has to give.
 */
export const CLOSING = new Set([...'，。、；：？！」』）】〉》…‥—～,.;:?!)]}%']);
export const OPENING = new Set([...'「『（【〈《([{']);
const NBSP = ' ';
const LATIN = /[A-Za-z0-9_'’\-+#@&/]/;

export type Measure = (text: string) => number;

/** Splits text into units; '\n' and ' ' stay as their own units so the line filler can act on them. */
export function units(text: string): string[] {
  const chars = [...text];
  const raw: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    if (c === '〈') {
      const end = chars.indexOf('〉', i);
      const nl = chars.indexOf('\n', i);
      if (end > i && (nl < 0 || nl > end)) {
        raw.push(chars.slice(i, end + 1).join(''));
        i = end;
        continue;
      }
    }
    if (LATIN.test(c)) {
      let j = i;
      // A '.' between word characters ("1.5", "v2.0") stays inside the word.
      const inWord = (k: number) => LATIN.test(chars[k] ?? '') || (chars[k] === '.' && LATIN.test(chars[k + 1] ?? ''));
      while (j + 1 < chars.length && inWord(j + 1)) j++;
      raw.push(chars.slice(i, j + 1).join(''));
      i = j;
      continue;
    }
    raw.push(c);
  }

  // Glue pass: no-break spaces join both sides, closing marks join the left, opening marks the right.
  const out: string[] = [];
  let carry = '';
  let joinNext = false;
  const appendable = () => out.length > 0 && out[out.length - 1] !== '\n' && out[out.length - 1] !== ' ';
  const append = (s: string) => { out[out.length - 1] += s; };
  for (const u of raw) {
    if (u === NBSP) {
      if (appendable()) {
        append(NBSP);
        joinNext = true;
      } else out.push(NBSP);
      continue;
    }
    if (u === '\n' || u === ' ') {
      if (carry) out.push(carry);
      carry = '';
      joinNext = false;
      out.push(u);
      continue;
    }
    if (OPENING.has(u)) {
      carry += u;
      continue;
    }
    const piece = carry + u;
    carry = '';
    if (joinNext && appendable()) append(piece);
    else if (CLOSING.has(u) && piece === u && appendable()) append(u);
    else out.push(piece);
    joinNext = false;
  }
  if (carry) out.push(carry);
  return out;
}

/** Breaks a unit that is wider than a line into the longest prefixes that fit. */
function splitWide(unit: string, maxWidth: number, measure: Measure): string[] {
  const parts: string[] = [];
  let cur = '';
  for (const c of unit) {
    if (cur && measure(cur + c) > maxWidth) {
      parts.push(cur);
      cur = c;
    } else cur += c;
  }
  if (cur) parts.push(cur);
  return parts;
}

/**
 * Lines of `text` no wider than `maxWidth`. Explicit '\n' always breaks; spaces at a break
 * are dropped. No-break spaces are kept as U+00A0, which canvas draws as a space.
 */
export function wrapCJK(text: string, maxWidth: number, measure: Measure): string[] {
  const lines: string[] = [];
  let line = '';
  const flush = () => {
    lines.push(line.replace(/ +$/, ''));
    line = '';
  };
  for (const u of units(text)) {
    if (u === '\n') {
      flush();
      continue;
    }
    if (u === ' ' && line === '') continue;
    if (measure(line + u) <= maxWidth) {
      line += u;
      continue;
    }
    if (u === ' ') {
      flush();
      continue;
    }
    if (line !== '') flush();
    if (measure(u) <= maxWidth) {
      line = u;
      continue;
    }
    const parts = splitWide(u, maxWidth, measure);
    for (const p of parts.slice(0, -1)) lines.push(p);
    line = parts[parts.length - 1] ?? '';
  }
  if (line !== '' || lines.length === 0) flush();
  return lines;
}
