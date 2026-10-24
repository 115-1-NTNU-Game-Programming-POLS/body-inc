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

/**
 * Independent streams per concern, so adding one enemy decision does not shift which events
 * the day draws, and a demo save's events stay fixed while combat code changes.
 */
export const RNG_STREAMS = ['map', 'events', 'enemies'] as const;
export type RngStream = (typeof RNG_STREAMS)[number];
export type RngStreams = Readonly<Record<RngStream, RngState>>;

/** murmur3 finalizer: spreads nearby seeds so streams of seed 1 and seed 2 are unrelated. */
function mix32(x: number): number {
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

function nameHash(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export function seedStreams(seed: number): RngStreams {
  const out = {} as Record<RngStream, RngState>;
  for (const name of RNG_STREAMS) out[name] = mix32((seed >>> 0) ^ nameHash(name));
  return out;
}

/** Draws from one stream and returns the streams with only that one advanced. */
export function drawFloat(streams: RngStreams, name: RngStream): [number, RngStreams] {
  const [f, s] = nextFloat(streams[name]);
  return [f, { ...streams, [name]: s }];
}

export function drawInt(streams: RngStreams, name: RngStream, maxExclusive: number): [number, RngStreams] {
  const [f, s] = drawFloat(streams, name);
  return [Math.floor(f * maxExclusive), s];
}
