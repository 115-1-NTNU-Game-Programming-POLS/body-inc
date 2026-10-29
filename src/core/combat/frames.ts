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
 * Folder (design doc 6.1). A tap swings in a string of three for 2, 2 and 4; holding the key
 * raises a guard over the front 120 degrees. The first 9 guard frames are the parry (退件): a
 * shot goes back at its thrower for twice a staple's damage, a melee enemy is stunned for 1.2 s,
 * and the gauge gains 15. Later frames only block. Areas are never blocked, so every boss move
 * stays avoidable by dodging alone (design doc 5.3). The swing's frames, reach, the hold
 * threshold and the string's gap are not in the design doc and are placeholders for playtesting.
 */
export const FOLDER = {
  damage: [2, 2, 4],
  /** The swing's box exists on this frame; design doc 5.3 caps light-attack startup at 6. */
  hitFrame: 3,
  swingTicks: 10,
  /** Hit-stop on the enemy hit; the finisher of the string is 6 (design doc 5.3). */
  hitFreeze: [3, 3, 6],
  /** A swing that begins within this many ticks of the last one ending continues the string. */
  comboGapTicks: Math.round(0.3 * TICK_HZ),
  swingReachPx: 20,
  swingHalfW: 18,
  swingHalfH: 14,
  /** Holding the attack key this long, counted from the press, raises the guard instead of swinging again. */
  holdTicks: 6,
  guardHalfAngleDeg: 60,
  parryFrames: 9,
  parryStunTicks: Math.round(1.2 * TICK_HZ),
  reflectDamage: 2 * STAPLER.damage,
  /** Chosen slow, like holding fire: not part of the 15% cap (design doc 6.1). */
  guardSpeedFactor: 0.4,
  /** Attacks and the guard wait this long after a swap (design doc 6.1: 0.15 s); a dodge does not. */
  swapTicks: Math.round(0.15 * TICK_HZ),
} as const;

/**
 * Gauge charge per source before the P multiplier (design doc 5.4). Other stationery (+1.5) and
 * folder parries (+15) are joined by the highlighter and the tape when those exist. An immune
 * bounce is not a hit and charges nothing.
 */
export const GAUGE = {
  staple: 0.8,
  folder: 1.5,
  parry: 15,
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

/**
 * Telegraph length per warning tier (design doc 5.3): tier 1 for melee and single shots, tier 2
 * for areas and charges, tier 3 for boss signature moves, which may run 1.2 to 1.5 s.
 */
export const TELEGRAPH = {
  tier1Ticks: Math.round(0.5 * TICK_HZ),
  tier2Ticks: Math.round(0.8 * TICK_HZ),
  tier3MinTicks: Math.round(1.2 * TICK_HZ),
  tier3MaxTicks: Math.round(1.5 * TICK_HZ),
} as const;

/**
 * Longest an area may stay live: the dodge i-frames. A dodge pressed on the last telegraph tick
 * is invincible on every live tick, which is what makes every boss move dodgeable (design doc 5.3).
 */
export const ZONE_MAX_ACTIVE = DODGE.iframeLast - DODGE.iframeFirst + 1;

/** Salesman archetype (design doc 5.3): melee rush, tier-1 telegraph. */
export const SALESMAN = {
  speed: tilesPerSecond(1.5),
  reachPx: 40,
  windupTicks: TELEGRAPH.tier1Ticks,
  strikeTicks: 6,
  recoverTicks: 40,
  damageHalves: 1,
} as const;

/**
 * Flyer archetype (design doc 5.3, performance 3): keeps 3 to 6 tiles away and throws one sheet
 * after a tier-1 telegraph. Speeds, range and the pause are placeholders the design doc does not
 * fix. The folder's parry sends the sheet back (FOLDER).
 */
export const FLYER = {
  speed: tilesPerSecond(1.2),
  nearPx: 3 * TILE,
  farPx: 6 * TILE,
  windupTicks: TELEGRAPH.tier1Ticks,
  throwTicks: 8,
  recoverTicks: 60,
  shotSpeed: tilesPerSecond(4),
  shotRangePx: 8 * TILE,
  shotHalf: 3,
  damageHalves: 1,
} as const;

/**
 * Cheers kid (乾杯小弟, design doc 7.7): circles the operator on a ring and, after a tier-1
 * telegraph, sends a toast wave aimed where the operator stands at release. A wave that lands
 * costs no heart but adds a cup to the liver's receiving; one the folder's guard meets is a
 * refusal (婉拒), and his performance in content/enemies.json (3) counts refusals instead of hits:
 * the last one sends him off, the only way to close his case. Weapons only make him back off.
 * The ring, speeds, the orbit time and the pauses are placeholders the design doc does not fix.
 */
export const CHEERS = {
  speed: tilesPerSecond(1.5),
  nearPx: 2.5 * TILE,
  farPx: 4 * TILE,
  /**
   * Ticks spent circling on the ring before each toast. Each landed cup costs the liver about
   * 1.5 minutes of exploring, so a short orbit buries a player who has not learned to refuse yet.
   */
  circleTicks: 120,
  windupTicks: TELEGRAPH.tier1Ticks,
  throwTicks: 8,
  /** Backs away for this long after a toast, and after the first weapon to land on him since his last toast (backOff). */
  backOffTicks: 45,
  shotSpeed: tilesPerSecond(3.5),
  shotRangePx: 7 * TILE,
  shotHalf: 4,
  cupsPerWave: 1,
  /** Total refusals in a run after which the kid hands over the handbook page (design doc 7.7). */
  refusalsForPage: 10,
} as const;

/**
 * Rules shared by every boss (design doc 5.4): the stamp takes 40 budget; a stamp on a tier-3
 * proposal cancels it and puts the boss under review for 4 s, taking 1.5 times damage.
 */
export const BOSS = {
  stampDamage: 40,
  reviewTicks: 4 * TICK_HZ,
  reviewDamageFactor: 1.5,
} as const;
