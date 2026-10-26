/**
 * Tools the operator can be handed during the story (design doc 6.1, 6.3). Only the stamp is
 * withheld so far: the chairman lends it at the end of the prologue (design doc 5.4), and every
 * later chapter starts with it. The stapler is never withheld, so it is not listed.
 */
export const TOOLS = ['stamp'] as const;
export type Tool = (typeof TOOLS)[number];

export const isTool = (s: string): s is Tool => (TOOLS as readonly string[]).includes(s);
