import { TICK_HZ, TILE } from '../time.ts';
import type { Vec } from './movement.ts';

/**
 * The chairman's 畫大餅 shield (design doc 5.1, 7.4), the partner skill on L. It stops thrown
 * shots, never areas or strikes, so a boss move stays avoidable by dodging alone. Its size and its
 * duration are the base values times S, which the chairman's tired days shrink to a coin; the
 * cooldown is not scaled. The base numbers are placeholders for playtesting, as the design doc
 * fixes only the scaling.
 */
export const PIE = {
  radiusPx: 2.5 * TILE,
  ticks: Math.round(4 * TICK_HZ),
  cooldownTicks: Math.round(12 * TICK_HZ),
  /** The shield is centred on the operator's body, not the feet. */
  liftPx: 8,
} as const;

export interface PieState {
  /** Ticks the raised shield still holds, 0 when down. */
  readonly ticksLeft: number;
  /** Ticks until it can be raised again, counted from the raise. */
  readonly cooldown: number;
  /** The radius it was raised with. */
  readonly radiusPx: number;
}

export const PIE_READY: PieState = { ticksLeft: 0, cooldown: 0, radiusPx: 0 };

/** S from the chairman's spirit P = 0.5 + 0.5 S (spirit.ts), which is all a room keeps of the night's sleep. */
export const sleepOfSpirit = (p: number): number => Math.min(1, Math.max(0, 2 * p - 1));

/** One tick of the shield: time runs down, and a press that finds it ready raises it. */
export function stepPie(pie: PieState, raise: boolean, p: number): { readonly pie: PieState; readonly raised: boolean } {
  const ticksLeft = Math.max(0, pie.ticksLeft - 1);
  const cooldown = Math.max(0, pie.cooldown - 1);
  if (!raise || cooldown > 0) return { pie: { ...pie, ticksLeft, cooldown }, raised: false };
  const s = sleepOfSpirit(p);
  return { pie: { ticksLeft: Math.max(1, Math.round(PIE.ticks * s)), cooldown: PIE.cooldownTicks, radiusPx: PIE.radiusPx * s }, raised: true };
}

/** Whether a shot at `at` is inside the raised shield round the operator at `op`. */
export const pieCovers = (pie: PieState | undefined, op: Vec, at: Vec): boolean =>
  pie !== undefined && pie.ticksLeft > 0 && Math.hypot(at.x - op.x, at.y - (op.y - PIE.liftPx)) <= pie.radiusPx;
