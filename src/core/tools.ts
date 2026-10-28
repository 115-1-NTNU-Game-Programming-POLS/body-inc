/**
 * Tools the operator can be handed during the story (design doc 6.1, 6.3). The stapler is never
 * withheld, so it is not listed. The stamp is lent by the chairman at the end of the prologue
 * (design doc 5.4) and the folder comes from the general affairs office in chapter 1 (design doc
 * 7.4); a chapter that names no tools holds every one.
 */
export const TOOLS = ['stamp', 'folder'] as const;
export type Tool = (typeof TOOLS)[number];

export const isTool = (s: string): s is Tool => (TOOLS as readonly string[]).includes(s);
