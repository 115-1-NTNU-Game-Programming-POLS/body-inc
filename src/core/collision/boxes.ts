import type { Body } from './grid.ts';

/**
 * Hit and hurt boxes live on the ground plane, like bodies: a staple's position is its shadow,
 * and the view lifts the sprite. Boxes are half-open, so touching edges do not overlap.
 */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export const boxAt = (b: Body, x: number, y: number): Box =>
  ({ left: x - b.halfW, top: y - b.height, right: x + b.halfW, bottom: y });

export const centeredBox = (x: number, y: number, halfW: number, halfH: number): Box =>
  ({ left: x - halfW, top: y - halfH, right: x + halfW, bottom: y + halfH });

export const overlaps = (a: Box, b: Box): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
