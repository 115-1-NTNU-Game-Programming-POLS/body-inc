/**
 * The host's name (design doc 3): the student whose body the company runs, 小晨 unless the player
 * names them otherwise. Content writes `{host}` where the name goes; the view fills it in when
 * the text is drawn, and the content checks fill in the widest allowed name before measuring.
 * Pure rules only: the Chinese messages for a refused name live in content/strings.
 */
export const DEFAULT_HOST = '小晨';
/** At most this many characters, a CJK character counting as one. */
export const HOST_MAX = 6;
export const HOST_TOKEN = '{host}';
/**
 * The widest name the rules allow. The checks' width model gives every character from U+2000 up
 * the same full width, so any full-width character does.
 */
export const HOST_WORST = '囍'.repeat(HOST_MAX);

export type NameProblem = 'empty' | 'too-long' | 'bad-char';
export type NameRead = { readonly ok: true; readonly name: string } | { readonly ok: false; readonly problem: NameProblem };

const segmenter = new Intl.Segmenter('zh-Hant', { granularity: 'grapheme' });

/** Characters as a reader counts them: a surrogate pair or a letter with its accent is one, as `string.length` would not say. */
export const graphemes = (s: string): number => [...segmenter.segment(s)].length;

// Control and format characters (\p{C}) would draw as nothing or break lines; braces would read as
// a placeholder and angle brackets as markup.
const BAD_CHAR = /[\p{C}{}<>]/u;

/** A typed name made ready to keep: NFC, trimmed, 1 to HOST_MAX characters, no forbidden character. */
export function readHostName(raw: string): NameRead {
  const name = raw.normalize('NFC').trim();
  if (name === '') return { ok: false, problem: 'empty' };
  if (BAD_CHAR.test(name)) return { ok: false, problem: 'bad-char' };
  if (graphemes(name) > HOST_MAX) return { ok: false, problem: 'too-long' };
  return { ok: true, name };
}

/** The text with every `{host}` replaced by the name. */
export const fillHost = (text: string, name: string): string => text.replaceAll(HOST_TOKEN, name);
