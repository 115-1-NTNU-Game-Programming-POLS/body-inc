import { TICK_HZ } from '../time.ts';
import type { RoomObject } from './tiled.ts';

/**
 * A toggle switch's cooldown (design doc 7.5, 8.5, 8.8). It belongs to the visit: the switch itself
 * is remembered between visits and the cooldown is not, and a forced leave ends it. The rules are in
 * docs/authoring/rooms-and-dialogue.md.
 */

export interface Cooling {
  readonly id: number;
  /** Counts down from the tick the switch changed. */
  readonly left: number;
}

export const cooldownTicks = (o: RoomObject): number => Math.round(Number(o.props['cooldownSeconds'] ?? 0) * TICK_HZ);

export const coolingLeft = (cooling: readonly Cooling[], id: number): number => cooling.find((c) => c.id === id)?.left ?? 0;

export const coolDown = (cooling: readonly Cooling[]): readonly Cooling[] =>
  cooling.length === 0 ? cooling : cooling.map((c) => ({ id: c.id, left: c.left - 1 })).filter((c) => c.left > 0);

export const startCooling = (cooling: readonly Cooling[], id: number, ticks: number): readonly Cooling[] =>
  ticks > 0 ? [...cooling.filter((c) => c.id !== id), { id, left: ticks }].sort((a, b) => a.id - b.id) : cooling;
