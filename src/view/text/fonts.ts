import Phaser from 'phaser';
import { DEFAULT_HOST, fillHost } from '../../core/index.ts';
import { cssFont, FACES, FONT, type FontRole } from './styles.ts';
import { wrapCJK, type Measure } from './wrap.ts';

/**
 * Font-load gate and the only way to create game text (art direction 8.2, build plan S10).
 *
 * Canvas text is drawn once with whatever font is available at that moment and never redrawn
 * when a web font arrives, so text created before its font loads stays in the fallback font.
 * Chinese web fonts are also split into unicode-range slices, and document.fonts.load(font)
 * without a text argument fetches only the slice that holds a space. The gate therefore loads
 * every face for the full set of characters the game can show (the corpus), and addText
 * refuses text with a character outside that set.
 *
 * The fonts are self-hosted subsets (public/assets/fonts/fonts.css), and each @font-face declares
 * exactly the characters its file holds. Without that unicode-range a face would default to
 * U+0-10FFFF and uncovered() would count every character, even an emoji, as drawable.
 */
let loaded: ReadonlySet<string> | undefined;
/** What `{host}` reads as in every text; set at Boot from the save and when the player renames the host. */
let host = DEFAULT_HOST;

export interface FontGateResult {
  readonly problems: readonly string[];
}

const familyOf = (f: FontFace): string => f.family.replace(/^["']|["']$/g, '');
const familyDeclared = (family: string): boolean => [...document.fonts].some((f) => familyOf(f) === family);

/** Code point ranges of a face's unicode-range descriptor, e.g. "U+4E00-4E3F, U+30??". */
function rangesOf(face: FontFace): [number, number][] {
  return face.unicodeRange.split(',').map((part) => {
    const r = part.trim().replace(/^U\+/i, '');
    const [a, b] = r.includes('-') ? r.split('-') : [r, r];
    return [parseInt(a!.replace(/\?/g, '0'), 16), parseInt(b!.replace(/\?/g, 'F'), 16)];
  });
}

/**
 * Characters of `text` that would not draw in the face: no slice covers them, or a covering
 * slice is not loaded. This replaces document.fonts.check(), which in Chrome reports true for
 * a character whose slice was never loaded.
 */
export function uncovered(family: string, weight: number, text: string): string[] {
  const faces = [...document.fonts].filter((f) => familyOf(f) === family && Number(f.weight) === weight);
  const ranges = faces.map((f) => ({ f, r: rangesOf(f) }));
  return [...new Set(text)].filter((c) => {
    if (c === '\n') return false;
    const cp = c.codePointAt(0)!;
    const covering = ranges.filter(({ r }) => r.some(([a, b]) => cp >= a && cp <= b));
    return covering.length === 0 || covering.some(({ f }) => f.status !== 'loaded');
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolves once every face holds every corpus character, or with problems on failure or
 * timeout. The families must be declared first, which catches a font stylesheet that failed
 * to load.
 */
export async function loadFonts(corpus: string, timeoutMs = 20000): Promise<FontGateResult> {
  // Dev-only `?fontDelay=<ms>` simulates a slow cold load; with a warm cache the fonts usually
  // win the race against the other assets, which would hide a missing gate.
  const delay = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('fontDelay') ?? 0) : 0;
  if (delay > 0) await sleep(delay);
  const deadline = Date.now() + timeoutMs;
  const problems: string[] = [];
  for (const family of Object.values(FONT)) {
    while (!familyDeclared(family) && Date.now() < deadline) await sleep(50);
    if (!familyDeclared(family)) problems.push(`no @font-face for "${family}"; did the font stylesheet in index.html load?`);
  }
  if (problems.length > 0) return { problems };

  const loads = FACES.map(async ({ role, weight }) => {
    const font = cssFont(role, weight, 22);
    const faces = await document.fonts.load(font, corpus);
    if (faces.length === 0) problems.push(`${font}: no face matched`);
  });
  const timedOut = await Promise.race([Promise.all(loads).then(() => false), sleep(Math.max(0, deadline - Date.now())).then(() => true)]);
  if (timedOut) return { problems: [`fonts did not finish loading within ${timeoutMs / 1000} s`] };
  for (const { role, weight } of FACES) {
    const missing = uncovered(FONT[role], weight, corpus);
    if (missing.length > 0) problems.push(`${FONT[role]} ${weight}: not loaded for ${missing.join('')}`);
  }
  if (problems.length === 0) loaded = new Set(corpus);
  return { problems };
}

export const fontsReady = (): boolean => loaded !== undefined;

let extraSheet: Promise<void> | undefined;

/**
 * Declares the slices of common characters outside the corpus (fonts-extra.css, built by
 * tools/fonts/build_fonts.py). Declaring is cheap; the browser fetches a slice only when
 * document.fonts.load asks for one of its characters. Kept out of index.html so the cold start
 * does not parse it. A failed load is retried on the next call.
 */
function declareExtraFaces(): Promise<void> {
  extraSheet ??= new Promise((done) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${import.meta.env.BASE_URL}assets/fonts/fonts-extra.css`;
    link.onload = () => done();
    link.onerror = () => {
      link.remove();
      extraSheet = undefined;
      done();
    };
    document.head.append(link);
  });
  return extraSheet;
}

/**
 * Loads every face for text outside the corpus, such as a host name the player typed, and lets
 * addText draw it. Resolves with the characters no face can draw (no slice covers them, or the
 * load timed out); then nothing is admitted.
 */
export async function admitText(text: string, timeoutMs = 8000): Promise<string[]> {
  if (!loaded) return [...new Set(text)];
  const known = loaded;
  const fresh = [...new Set(text)].filter((c) => c !== '\n' && !known.has(c));
  if (fresh.length === 0) return [];
  const chars = fresh.join('');
  const loads = declareExtraFaces().then(() => Promise.all(FACES.map(({ role, weight }) => document.fonts.load(cssFont(role, weight, 22), chars))));
  const timedOut = await Promise.race([loads.then(() => false, () => false), sleep(timeoutMs).then(() => true)]);
  const missing = timedOut ? fresh : [...new Set(FACES.flatMap(({ role, weight }) => uncovered(FONT[role], weight, chars)))];
  if (missing.length === 0) loaded = new Set([...known, ...fresh]);
  return missing;
}

/** Sets what `{host}` reads as from now on. The name must have passed readHostName and admitText. */
export function setHostName(name: string): void {
  host = name;
}

/**
 * Rejects text the gate has not covered. Development builds throw so the mistake is found at
 * once; a release build logs it and draws the text anyway, since a fallback glyph beats a crash.
 */
function assertCovered(text: string): void {
  const missing = loaded ? [...new Set([...text])].filter((c) => c !== '\n' && !loaded!.has(c)) : [];
  const problem = !loaded
    ? `text "${text.slice(0, 20)}" created before the font gate finished`
    : missing.length > 0 ? `text uses characters outside the font corpus: ${missing.join('')}; put the text in content/strings` : '';
  if (!problem) return;
  if (import.meta.env.DEV) throw new Error(problem);
  console.error(problem);
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** Width function for wrapCJK that measures exactly as Phaser's Text will draw. */
export function measurer(role: FontRole, weight: number, sizePx: number): Measure {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  const ctx = measureCtx!;
  const font = cssFont(role, weight, sizePx);
  return (s) => {
    ctx.font = font;
    return ctx.measureText(s).width;
  };
}

export interface TextSpec {
  readonly role: FontRole;
  readonly weight: 400 | 700;
  readonly size: number;
  readonly color: string;
  /** Wrap with wrapCJK at this width in pixels; omit for single-line text. */
  readonly maxWidth?: number;
  readonly lineHeight?: number;
  readonly backgroundColor?: string;
  readonly padding?: { readonly x: number; readonly y: number };
}

/** The host's name goes in before wrapping, so lines break where the real name ends. */
function layout(template: string, spec: TextSpec): string {
  const text = fillHost(template, host);
  assertCovered(text);
  return spec.maxWidth === undefined ? text : wrapCJK(text, spec.maxWidth, measurer(spec.role, spec.weight, spec.size)).join('\n');
}

export function addText(scene: Phaser.Scene, x: number, y: number, text: string, spec: TextSpec): Phaser.GameObjects.Text {
  const style: Phaser.Types.GameObjects.Text.TextStyle = {
    fontFamily: `"${FONT[spec.role]}", ${spec.role === 'hand' ? 'serif' : 'sans-serif'}`,
    fontSize: `${spec.size}px`,
    fontStyle: spec.weight === 700 ? 'bold' : 'normal',
    color: spec.color,
    // Phaser's lineSpacing is added to the font's own line height, roughly 1.4 em for these fonts.
    lineSpacing: spec.lineHeight ? Math.max(0, Math.round(spec.size * (spec.lineHeight - 1.4))) : 0,
    ...(spec.backgroundColor ? { backgroundColor: spec.backgroundColor } : {}),
    ...(spec.padding ? { padding: { x: spec.padding.x, y: spec.padding.y } } : {}),
  };
  const t = scene.add.text(x, y, layout(text, spec), style);
  t.setData('spec', spec);
  return t;
}

/** Replaces the text of an object made by addText, under the same checks and wrapping. */
export function updateText(t: Phaser.GameObjects.Text, text: string): void {
  t.setText(layout(text, t.getData('spec') as TextSpec));
}

/**
 * Diagnostics shown when booting fails, possibly because the fonts failed: drawn in the
 * system font on purpose and exempt from the gate.
 */
export function addSystemText(scene: Phaser.Scene, x: number, y: number, text: string, color: string): Phaser.GameObjects.Text {
  return scene.add.text(x, y, text, { fontFamily: 'sans-serif', fontSize: '16px', color });
}
