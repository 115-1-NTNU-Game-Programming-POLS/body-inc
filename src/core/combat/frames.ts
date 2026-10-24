import { TICK_HZ, TILE, tilesPerSecond } from '../time.ts';

/**
 * Combat frame data (design doc 5.3 and 6.1; art direction 5.3 for frame placement). One frame
 * is one tick. These are contracts, not feel tweaks in the view: changing one changes when the
 * next input lands. content/params.json will own them once S4 lands.
 *
 * Frame numbers count from 1: the tick an action starts on is its frame 1.
 */
export const BUFFER_TICKS = Math.round(0.35 * TICK_HZ);

export const STAPLER = {
  /** The staple exists on this frame of the press; design doc caps light-attack startup at 6. */
  startupFrame: 3,
  intervalTicks: 10,
  speed: tilesPerSecond(14),
  rangePx: 7 * TILE,
  damage: 1,
  /** Holding fire is a chosen slow, so it is not part of the 15% slow cap (design doc 6.1). */
  holdSpeedFactor: 0.7,
  /** Soft lock: half-angle and reach (design doc 5.2). */
  lockHalfAngleDeg: 25,
  lockRangePx: 7 * TILE,
} as const;

export const DODGE = {
  ticks: 13,
  distancePx: 2.5 * TILE,
  iframeFirst: 2,
  iframeLast: 11,
  recoveryTicks: 6,
  cooldownTicks: Math.round(0.3 * TICK_HZ),
  /** A hit during the first 6 invincible frames counts as a perfect dodge. */
  perfectLast: 7,
} as const;

export const HURT = {
  freezeTicks: 4,
  knockbackPx: TILE,
  knockbackTicks: 12,
  invulnTicks: Math.round(1.0 * TICK_HZ),
} as const;

/** Enemy hit-stop applies to the enemy that was hit; a player hit freezes the whole fight. */
export const ENEMY_HIT_FREEZE = 3;

/** Base hearts (design doc 5.3), counted in halves; a normal hit takes one half. */
export const BASE_HALVES = 12;

/** Reforming enemies come back after 6 s (design doc 5.5). */
export const REFORM_TICKS = 6 * TICK_HZ;

/** Rejection stamp (design doc 5.4). The startup is invincible; the gauge empties on the press. */
export const STAMP = {
  gaugeMax: 100,
  startupTicks: Math.round(0.35 * TICK_HZ),
  radiusPx: 3.5 * TILE,
  damage: 25,
  hitFreeze: 10,
} as const;

/**
 * Gauge charge per source before the P multiplier (design doc 5.4). Other stationery (+1.5) and
 * folder parries (+15) join when those tools exist. An immune bounce is not a hit and charges nothing.
 */
export const GAUGE = {
  staple: 0.8,
  perfectDodge: 10,
} as const;

/**
 * Clinging (design doc 5.5, chapter 1): 5% slow per stack, three stacks is the 15% cap and
 * triggers a forced nap that advances the rule clock one hour. Drift speed and sensing range
 * are not in the design doc and are placeholders for playtesting.
 */
export const CLING = {
  slowPerStack: 0.05,
  maxStacks: 3,
  napMinutes: 60,
  driftSpeed: tilesPerSecond(1),
  senseRangePx: 5 * TILE,
} as const;

/** Salesman archetype prototype (design doc 5.3 tier-1 telegraph is 0.5 s). */
export const SALESMAN = {
  speed: tilesPerSecond(1.5),
  reachPx: 40,
  windupTicks: Math.round(0.5 * TICK_HZ),
  strikeTicks: 6,
  recoverTicks: 40,
  damageHalves: 1,
} as const;
