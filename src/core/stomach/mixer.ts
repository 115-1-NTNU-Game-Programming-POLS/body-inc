import { TICK_HZ } from '../time.ts';
import {
  canEnter, hopperTiles, mixerOf, mixerOutlet, nearest, onHopper, onPort, PARCEL, portOf, type BoxState, type Occupants, type Tile,
} from '../rooms/boxes.ts';
import type { RoomModel } from '../rooms/tiled.ts';

/**
 * The stomach's mixer (design doc 7.5). A food box that comes to rest on the hopper is taken in
 * and digested for its portion's time; then it comes out on the outlet side as a parcel, the only
 * box a parcel port (the small intestine's gate) takes in. Every box inside is digested at once,
 * up to `capacity`; the box after that jams the mixer, and the stomach's manager throws every box
 * back out, undigested. The rules for authors are in docs/authoring/rooms-and-dialogue.md.
 *
 * What the mixer holds belongs to the visit, like a box pushed but not delivered: a forced leave or
 * a walk out of the room empties it, and the boxes it held start from home again.
 */

/**
 * Seconds a portion takes (design doc 7.5). Fried food taking longer is not in these numbers until
 * fact-check item 14 is done.
 */
export const PORTION_SECONDS = { small: 15, normal: 20, large: 40 } as const;
export type Portion = keyof typeof PORTION_SECONDS;

const isPortion = (p: string): p is Portion => p in PORTION_SECONDS;
export const portionTicks = (p: Portion): number => PORTION_SECONDS[p] * TICK_HZ;

export interface Batch {
  /** The box's Tiled object id; it keeps it as a parcel. */
  readonly box: number;
  readonly portion: Portion;
  /** Ticks of digesting still to run; 0 once done and waiting for a free tile at the outlet. */
  readonly left: number;
}

export interface MixerState {
  /** In the order they were taken in, which is the order they come out when two finish together. */
  readonly batches: readonly Batch[];
}

export const EMPTY_MIXER: MixerState = { batches: [] };

export type MixerEvent =
  /** The mixer took a food box in; `count` is how many it holds now. */
  | { readonly type: 'mixerFed'; readonly object: number; readonly mixer: number; readonly portion: Portion; readonly count: number; readonly capacity: number }
  /** One box too many: every box it held, and the one that jammed it, are thrown back out. */
  | { readonly type: 'mixerJammed'; readonly mixer: number; readonly boxes: number }
  /** A box finished and came out as a parcel on this tile. */
  | { readonly type: 'parcelOut'; readonly object: number; readonly mixer: number; readonly col: number; readonly row: number };

export interface MixerStep {
  readonly mixer: MixerState;
  readonly boxes: readonly BoxState[];
  readonly events: readonly MixerEvent[];
}

/** A box's type as drawn now: a parcel or acetaldehyde crate carries its own, a map box takes the map's. */
export function boxTypeOf(room: Pick<RoomModel, 'objects'>, b: BoxState): string {
  if (b.boxType !== undefined) return b.boxType;
  return String(room.objects.find((o) => o.id === b.id)?.props['boxType'] ?? 'crate');
}

function portionOf(room: Pick<RoomModel, 'objects'>, id: number): Portion {
  const p = String(room.objects.find((o) => o.id === id)?.props['portion'] ?? 'normal');
  return isPortion(p) ? p : 'normal';
}

/** A box resting on a free tile, as the map drew it: thrown back out, it is food again. */
const resting = (id: number, t: Tile): BoxState => ({ id, col: t.col, row: t.row, left: 0, ticks: 0 });

/**
 * One tick of the mixer, after the port has taken its boxes in and before belts move: digesting
 * counts down, finished boxes come out, then food boxes at rest on the hopper go in. A box taken
 * in this tick has its whole time still to run after it. Ids order everything, so the result does
 * not depend on where a box sits in the array.
 */
export function stepMixer(room: RoomModel, state: MixerState, boxes: readonly BoxState[], occupants: Occupants): MixerStep {
  const mixer = mixerOf(room);
  if (!mixer) return { mixer: state, boxes, events: [] };
  const events: MixerEvent[] = [];
  let all = [...boxes];
  let batches = state.batches.map((b) => (b.left > 0 ? { ...b, left: b.left - 1 } : b));
  const port = portOf(room);
  // Nothing lands back on the hopper, or it would go straight in again, nor on a port, which would take it.
  const free = (t: Tile) => canEnter(room, all, t, occupants) && !onHopper(room, t) && !(port && onPort(port, t));

  const outlet = mixerOutlet(room);
  for (const b of batches.filter((x) => x.left === 0)) {
    // A parcel port by the outlet is allowed to take the parcel: that is what the gate is for.
    const t = outlet && nearest(room, outlet, (x) => canEnter(room, all, x, occupants) && !onHopper(room, x));
    // With no free tile the parcel waits inside, and the mixer stays that full until one frees up.
    if (!t) break;
    all.push({ ...resting(b.box, t), boxType: PARCEL });
    batches = batches.filter((x) => x.box !== b.box);
    events.push({ type: 'parcelOut', object: b.box, mixer: mixer.id, col: t.col, row: t.row });
  }

  const capacity = Number(mixer.props['capacity']);
  const fed = all.filter((b) => b.left === 0 && onHopper(room, b) && boxTypeOf(room, b) === 'food').sort((a, b) => a.id - b.id);
  for (const [i, b] of fed.entries()) {
    all = all.filter((x) => x.id !== b.id);
    if (batches.length < capacity) {
      const portion = portionOf(room, b.id);
      batches = [...batches, { box: b.id, portion, left: portionTicks(portion) }];
      events.push({ type: 'mixerFed', object: b.id, mixer: mixer.id, portion, count: batches.length, capacity });
      continue;
    }
    // Jammed: everything inside, this box and any still on the hopper come back out undigested.
    const thrown = [...batches.map((x) => x.box), ...fed.slice(i).map((x) => x.id)].sort((x, y) => x - y);
    all = all.filter((x) => !thrown.includes(x.id));
    const from = hopperTiles(room)[0]!;
    for (const id of thrown) {
      const t = nearest(room, from, free);
      // Only a room whose every floor tile is taken has nowhere to put it; it is back home on the next visit.
      if (t) all.push(resting(id, t));
    }
    batches = [];
    events.push({ type: 'mixerJammed', mixer: mixer.id, boxes: thrown.length });
    break;
  }
  // Kept as they were when nothing happened, so the solid grid built from the boxes stays cached.
  const counting = state.batches.some((b) => b.left > 0);
  return {
    mixer: counting || events.length > 0 ? { batches } : state,
    boxes: events.length > 0 ? all.sort((a, b) => a.id - b.id) : boxes,
    events,
  };
}
