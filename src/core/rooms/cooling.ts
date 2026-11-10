import { TICK_HZ } from '../time.ts';
import type { RoomObject } from './tiled.ts';

/**
 * A toggle switch's cooldown (design doc 7.5, 8.5, 8.8: the sorting center's fork lever). A switch with
 * `cooldownSeconds` above 0 takes no new throw, by the interact key or a staple, for that long after
 * it last changed; a press in the meantime does nothing and says so. The cooldown belongs to the
 * visit: the switch itself is remembered between visits and the cooldown is not, and a forced leave
 * ends it. The rules for authors are in docs/authoring/rooms-and-dialogue.md.
 */

export interface Cooling {
  /** The switch's object id. */
  readonly id: number;
  /** Ticks until it takes a throw again, counting down from the tick it changed. */
  readonly left: number;
}

/** The switch's cooldown in ticks; 0 for a switch with none. */
export const cooldownTicks = (o: RoomObject): number => Math.round(Number(o.props['cooldownSeconds'] ?? 0) * TICK_HZ);

/** Ticks left on a switch; 0 when it takes a throw now. */
export const coolingLeft = (cooling: readonly Cooling[], id: number): number => cooling.find((c) => c.id === id)?.left ?? 0;

/** One tick off every cooldown; a switch whose cooldown ends is gone from the list. */
export const coolDown = (cooling: readonly Cooling[]): readonly Cooling[] =>
  cooling.length === 0 ? cooling : cooling.map((c) => ({ id: c.id, left: c.left - 1 })).filter((c) => c.left > 0);

/** The list with `ticks` of cooldown set on the switch, in id order; unchanged for a switch with none. */
export const startCooling = (cooling: readonly Cooling[], id: number, ticks: number): readonly Cooling[] =>
  ticks > 0 ? [...cooling.filter((c) => c.id !== id), { id, left: ticks }].sort((a, b) => a.id - b.id) : cooling;
