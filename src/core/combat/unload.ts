import { centeredBox, type Box } from '../collision/boxes.ts';
import { TICK_HZ, TILE } from '../time.ts';
import type { Vec } from './movement.ts';

/**
 * The stomach logistics chief's 強制卸貨 (design doc 6.2), the partner skill on L: an acid zone
 * spat ahead of the operator that lies for 3 seconds, hurts and shoves back whatever stands in it,
 * and then cools for 9 seconds (the cooldown counts from the raise). It is the operator's own aim,
 * made four-way, that decides where it lies, so the zone is a plain rectangle on the ground. It
 * hits only ordinary defeatable enemies: immune and reforming ones are neither beaten nor shoved
 * (the design doc has no acid answer for them), the cheers kid is closed by refusals only, and a
 * boss is left to its own controller. It does not care for a manager's shield, since spit is
 * not a thrown weapon, as with the stamp. The zone's size, the damage and the shove are
 * placeholders for playtesting: the design doc fixes only the 3 seconds and the 9.
 */
export const UNLOAD = {
  ticks: 3 * TICK_HZ,
  cooldownTicks: 9 * TICK_HZ,
  /** The zone starts this far ahead of the operator's centre and runs `lengthPx` on. */
  gapPx: 8,
  lengthPx: 3 * TILE,
  halfWidthPx: 0.75 * TILE,
  /** Every this many ticks in the zone costs an enemy `damage`, the first of them on the tick it is raised. */
  damageEveryTicks: Math.round(0.5 * TICK_HZ),
  damage: 1,
  /** Pixels a tick an enemy in the zone is shoved along it, away from the operator: faster than any walker can come in. */
  shovePx: 1.2,
} as const;

export interface UnloadState {
  /** Ticks the acid still lies, 0 when there is none. */
  readonly ticksLeft: number;
  /** Ticks until it can be spat again, counted from the raise. */
  readonly cooldown: number;
  /** Where the zone was spat from, the operator's centre at the raise. */
  readonly x: number;
  readonly y: number;
  /** Which way it runs: one of the four axis directions. */
  readonly dir: Vec;
}

export const UNLOAD_READY: UnloadState = { ticksLeft: 0, cooldown: 0, x: 0, y: 0, dir: { x: 0, y: 1 } };

/** The axis direction nearest to an aim vector; a tie goes to the horizontal like an enemy's strike. */
export function cardinalOf(v: Vec): Vec {
  if (Math.abs(v.x) >= Math.abs(v.y)) return { x: v.x < 0 ? -1 : 1, y: 0 };
  return { x: 0, y: v.y < 0 ? -1 : 1 };
}

/** One tick of the skill: time runs down, and a press that finds it ready spits the acid from `at` along `aim`. */
export function stepUnload(u: UnloadState, raise: boolean, at: Vec, aim: Vec): { readonly unload: UnloadState; readonly raised: boolean } {
  const ticksLeft = Math.max(0, u.ticksLeft - 1);
  const cooldown = Math.max(0, u.cooldown - 1);
  if (!raise || cooldown > 0) return { unload: { ...u, ticksLeft, cooldown }, raised: false };
  return { unload: { ticksLeft: UNLOAD.ticks, cooldown: UNLOAD.cooldownTicks, x: at.x, y: at.y, dir: cardinalOf(aim) }, raised: true };
}

/** The ground the acid covers while it lies. */
export function unloadBox(u: UnloadState): Box {
  const along = UNLOAD.gapPx + UNLOAD.lengthPx / 2;
  const half = UNLOAD.lengthPx / 2;
  const across = UNLOAD.halfWidthPx;
  return u.dir.x !== 0
    ? centeredBox(u.x + u.dir.x * along, u.y, half, across)
    : centeredBox(u.x, u.y + u.dir.y * along, across, half);
}

/** Ticks the acid has lain, counting the tick it was raised as 1: what the damage rhythm reads. */
export const unloadAge = (u: UnloadState): number => UNLOAD.ticks - u.ticksLeft + 1;
