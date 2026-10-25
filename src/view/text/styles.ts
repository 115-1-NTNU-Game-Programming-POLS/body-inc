/**
 * Font roles and text presets from art direction 8.2. Pure data, so Node tests can use the
 * same widths the game wraps at.
 */
export const FONT = {
  /** Handwritten or stamped: sticky notes, red-pen remarks, the liver's lines, stamps. */
  hand: 'LXGW WenKai TC',
  /** Printed by the system: dialogue, key hints, numbers, tables, handbook text. */
  print: 'Noto Sans TC',
} as const;

export type FontRole = keyof typeof FONT;

/** The four faces Boot waits for; only Regular and Bold of each family are loaded. */
export const FACES: readonly { readonly role: FontRole; readonly weight: 400 | 700 }[] = [
  { role: 'print', weight: 400 }, { role: 'print', weight: 700 },
  { role: 'hand', weight: 400 }, { role: 'hand', weight: 700 },
];

/** CSS font shorthand, with a generic fallback so a missing face is at least legible. */
export const cssFont = (role: FontRole, weight: number, sizePx: number): string =>
  `${weight} ${sizePx}px "${FONT[role]}", ${role === 'hand' ? 'serif' : 'sans-serif'}`;

/** Dialogue body: Noto Sans TC 22 px, at most 30 full-width characters and 3 lines per box. */
export const DIALOGUE = {
  role: 'print' as FontRole,
  weight: 400,
  fontSize: 22,
  lineHeight: 1.6,
  maxEm: 30,
  maxLines: 3,
  /**
   * Dialogue box 1184 px wide (art direction 12.5). The art direction gives no inner padding;
   * 32 px a side is an assumption until the dialogue box is built.
   */
  boxInnerWidth: 1184 - 64,
  /** Line width cap at a text-size setting (1 or 1.25): 30 em, never wider than the box. */
  maxWidth(scale: number): number {
    return Math.min(this.maxEm * this.fontSize * scale, this.boxInnerWidth);
  },
};

/** The two text-size settings (design doc 12); every text area must hold its text at both. */
export const TEXT_SCALES: readonly number[] = [1, 1.25];

/**
 * The player's reply notes. The art direction gives 2 to 3 sticky notes sliding in from the
 * right and the hand-written body size (22 px, line height 1.5) but no note size; 420 px wide
 * with 16 px padding is an assumption until the dialogue scene is reviewed.
 */
export const REPLY = {
  role: 'hand' as FontRole,
  weight: 400,
  fontSize: 22,
  lineHeight: 1.5,
  maxEm: 17,
  maxLines: 2,
  noteWidth: 420,
  padding: 16,
  gap: 10,
  maxWidth(scale: number): number {
    return Math.min(this.maxEm * this.fontSize * scale, this.noteWidth - 2 * this.padding);
  },
};

/**
 * The liver's sticky note: 320 x 160 at center right, no dialogue box (art direction 6.2). The
 * replies stack upward from `replyBottom`; three two-line replies at 125% reach about y 355, so the
 * note ends above that (a test pins it).
 */
export const MEMO = {
  role: 'hand' as FontRole,
  weight: 400,
  fontSize: 22,
  lineHeight: 1.5,
  maxEm: 13,
  maxLines: 3,
  noteWidth: 320,
  noteHeight: 160,
  at: { x: 700, y: 160 },
  replyBottom: 720,
  padding: 16,
  maxWidth(scale: number): number {
    return Math.min(this.maxEm * this.fontSize * scale, this.noteWidth - 2 * this.padding);
  },
};
