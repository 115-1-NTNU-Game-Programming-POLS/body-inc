/**
 * Seeded RNG (mulberry32). Its whole state is one uint32 kept inside game state, so saving,
 * replaying and simulating reproduce the same draws. Cosmetic randomness in the view must not
 * use this (docs/architecture.md section 5, Randomness).
 */
export type RngState = number;

export function seedRng(seed: number): RngState {
  return seed >>> 0;
}

/** Returns a float in [0, 1) and the next state. */
export function nextFloat(state: RngState): [number, RngState] {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

export function nextInt(state: RngState, maxExclusive: number): [number, RngState] {
  const [f, s] = nextFloat(state);
  return [Math.floor(f * maxExclusive), s];
}
