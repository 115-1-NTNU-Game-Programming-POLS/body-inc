/**
 * Tools the operator can be handed during the story (design doc 6.1, 6.3). The stapler is never
 * withheld, so it is not listed. The stamp is lent by the chairman at the end of the prologue
 * (design doc 5.4), the folder comes from the general affairs office in chapter 1 (design doc
 * 7.4) and the highlighter from the one in chapter 3 (7.7).
 */
export const TOOLS = ['stamp', 'folder', 'highlighter'] as const;
export type Tool = (typeof TOOLS)[number];

/**
 * What a chapter that names no tools holds: every tool but the highlighter, which only a chapter
 * that lists it, or a grant, hands over, so the chapters before the liver's never show it.
 */
export const DEFAULT_TOOLS: readonly Tool[] = ['stamp', 'folder'];

export const isTool = (s: string): s is Tool => (TOOLS as readonly string[]).includes(s);
