/** Rule time runs in fixed ticks; one tick is one frame of the design doc's frame data (5.3). */
export const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;

/** World units are pixels at scale 1; one tile is 32 px (design doc 5.3, 13.3). */
export const TILE = 32;

export const tilesPerSecond = (t: number): number => (t * TILE) / TICK_HZ;
