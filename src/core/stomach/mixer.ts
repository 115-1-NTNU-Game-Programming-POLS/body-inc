import { TICK_HZ } from '../time.ts';
import {
  canEnter, coldStoreAt, hopperTiles, mixerOf, mixerOutlet, nearest, onConveyor, onHopper, onPort, PARCEL, portOf, type BoxState, type Occupants, type Tile,
} from '../rooms/boxes.ts';
import type { RoomModel } from '../rooms/tiled.ts';
import { isOrder } from './orders.ts';

/**
 * The stomach's mixer (design doc 7.5). A food box that comes to rest on the hopper is taken in
 * and digested for its portion's time; then it comes out on the outlet side as a parcel, the only
 * box a parcel port (the small intestine's gate) takes in. Every box inside is digested at once,
 * up to `capacity`; the box after that jams the mixer, and the stomach's manager throws every box
 * back out, undigested. The rules for authors are in docs/authoring/rooms-and-dialogue.md.
 *
 * What the mixer holds belongs to the visit, like a box pushed but not delivered: a forced leave or
 * a walk out of the room empties it, and the boxes it held start from home again. A box it has set
 * down, a parcel or a thrown box, is remembered like a pushed one; settling then makes it food again
 * at home, unless it rests on a plate, where it stays.
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
  /** A courier's order (core/stomach/orders.ts): digested like any box, but it leaves no parcel behind. */
  readonly order?: true;
  /** Places the batch takes of the capacity; only a boss delivery sets it (DELIVERY_SLOTS), every other box takes one. */
  readonly slots?: number;
}

/** A box the stomach boss threw, as opposed to a courier's order or a box fed by hand: only his carry `slots`. */
export const isDelivery = (b: Batch): boolean => b.slots !== undefined;

/**
 * Places a boss delivery takes of the mixer's capacity (design doc 7.5, stage 2: the large portion is
 * "2 格大"). A box fed by hand takes one whatever its portion, since the design doc asks for the
 * doubling only in the boss fight.
 */
export const DELIVERY_SLOTS: Readonly<Record<Portion, number>> = { small: 1, normal: 1, large: 2 };

export const slotsUsed = (state: MixerState): number => state.batches.reduce((n, b) => n + (b.slots ?? 1), 0);

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

/**
 * Where the mixer set a box down, a parcel or a thrown box, reported like any other box move so the
 * chapter's box memory follows it: a box the mixer leaves on a plate stays there like a pushed one.
 */
export interface MixerMove { readonly type: 'boxMoved'; readonly object: number; readonly col: number; readonly row: number; readonly by: 'mixer' }

export interface MixerStep {
  readonly mixer: MixerState;
  readonly boxes: readonly BoxState[];
  readonly events: readonly (MixerEvent | MixerMove)[];
}

/**
 * A box the stomach boss threw lands on the hopper (design doc 7.5). It is taken in like a fed box
 * while the mixer has room, and digested like an order: it leaves no parcel. The box after the
 * capacity makes the mixer protest instead: everything it held is lost with it and the caller raises
 * the area attack. `id` is an order id, so it cannot clash with a box of the map.
 */
export function takeDelivery(
  state: MixerState, capacity: number, id: number, portion: Portion,
): { readonly mixer: MixerState; readonly jammed: boolean; readonly count: number } {
  const slots = DELIVERY_SLOTS[portion];
  const count = slotsUsed(state) + slots;
  if (count > capacity) return { mixer: EMPTY_MIXER, jammed: true, count };
  const batches = [...state.batches, { box: id, portion, left: portionTicks(portion), order: true as const, slots }];
  return { mixer: { batches }, jammed: false, count };
}

/** A box's type as drawn now: a parcel or acetaldehyde crate carries its own, a map box takes the map's. */
export function boxTypeOf(room: Pick<RoomModel, 'objects'>, b: BoxState): string {
  if (b.boxType !== undefined) return b.boxType;
  return String(room.objects.find((o) => o.id === b.id)?.props['boxType'] ?? 'crate');
}

/** The portion a food box was drawn with, `normal` for one the map does not have, such as a courier's order. */
export function portionOf(room: Pick<RoomModel, 'objects'>, id: number): Portion {
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
  const events: (MixerEvent | MixerMove)[] = [];
  let all = [...boxes];
  // A finished order is gone at once: only the boxes the puzzle fed come out as parcels, so a
  // courier's deliveries load the mixer (its capacity, its alarm) and never count at the gate.
  let batches = state.batches.map((b) => (b.left > 0 ? { ...b, left: b.left - 1 } : b)).filter((b) => !(b.order && b.left === 0));
  const port = portOf(room);
  // A thrown box lands nowhere that would take it straight back: not on the hopper, not on a port,
  // not on a belt, running or not, which could carry it in again, and not on a cold store, which
  // would chill it though nobody sent it there.
  const free = (t: Tile) => canEnter(room, all, t, occupants) && !onHopper(room, t) && !(port && onPort(port, t)) && !onConveyor(room, t)
    && coldStoreAt(room, t) === undefined;

  const outlet = mixerOutlet(room);
  for (const b of batches.filter((x) => x.left === 0)) {
    // A parcel comes out on the outlet tile and nowhere else. While that tile is taken (the parcel
    // before it not yet carried off, a box, a body, a shut gate) it waits inside and keeps its place
    // in the capacity, so a line that backs up into the mixer can jam it: eating too fast only causes
    // a queue (design doc 7.5). A parcel port on the outlet tile may take it: that is what a gate is for.
    const t = outlet && canEnter(room, all, outlet, occupants) ? outlet : undefined;
    if (!t) break;
    all.push({ ...resting(b.box, t), boxType: PARCEL });
    batches = batches.filter((x) => x.box !== b.box);
    events.push({ type: 'parcelOut', object: b.box, mixer: mixer.id, col: t.col, row: t.row });
    events.push({ type: 'boxMoved', object: b.box, col: t.col, row: t.row, by: 'mixer' });
  }

  const capacity = Number(mixer.props['capacity']);
  const fed = all.filter((b) => b.left === 0 && onHopper(room, b) && boxTypeOf(room, b) === 'food').sort((a, b) => a.id - b.id);
  for (const [i, b] of fed.entries()) {
    all = all.filter((x) => x.id !== b.id);
    if (slotsUsed({ batches }) < capacity) {
      const portion = portionOf(room, b.id);
      batches = [...batches, { box: b.id, portion, left: portionTicks(portion), ...(isOrder(b) ? { order: true as const } : {}) }];
      events.push({ type: 'mixerFed', object: b.id, mixer: mixer.id, portion, count: slotsUsed({ batches }), capacity });
      continue;
    }
    // Jammed: everything inside, this box and any still on the hopper come back out undigested.
    const thrown = [...batches.map((x) => x.box), ...fed.slice(i).map((x) => x.id)].sort((x, y) => x - y);
    all = all.filter((x) => !thrown.includes(x.id));
    const from = hopperTiles(room)[0]!;
    const moves: MixerMove[] = [];
    for (const id of thrown) {
      const t = nearest(room, from, free);
      // Only a room whose every free floor tile is taken has nowhere to put it; it is back home on the next visit.
      if (!t) continue;
      // An order is no Tiled object, so it has to carry the type the map would have given it.
      all.push(isOrder({ id }) ? { ...resting(id, t), boxType: 'food' } : resting(id, t));
      moves.push({ type: 'boxMoved', object: id, col: t.col, row: t.row, by: 'mixer' });
    }
    batches = [];
    events.push({ type: 'mixerJammed', mixer: mixer.id, boxes: thrown.length }, ...moves);
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
