import { overlaps, type Box } from '../collision/boxes.ts';
import type { Body } from '../collision/grid.ts';
import { TILE } from '../time.ts';
import type { RoomModel, RoomObject } from './tiled.ts';

/** How far past its body the operator can reach a talk or bed object. */
export const INTERACT_REACH = 16;

/** A point object (no size in Tiled) is treated as one tile centred on the point. */
const POINT_SIZE = TILE;

export type SocketName = 'N' | 'E' | 'S' | 'W';

/**
 * Doors and triggers fire when the operator steps onto them; NPCs, beds, pickups and toggle
 * switches wait for the interact key (design doc 5.2: E also picks things up). A hold switch is a
 * pressure plate, pressed by standing on it.
 */
const TOUCHED = new Set(['Door', 'Trigger']);
const reached = (o: RoomObject): boolean =>
  o.kind === 'NPC' || o.kind === 'Bed' || o.kind === 'Pickup' || (o.kind === 'Switch' && o.props['mode'] === 'toggle');

export function objectBox(o: RoomObject): Box {
  const left = o.width > 0 ? o.x : o.x - POINT_SIZE / 2;
  const top = o.height > 0 ? o.y : o.y - POINT_SIZE / 2;
  return { left, top, right: left + (o.width > 0 ? o.width : POINT_SIZE), bottom: top + (o.height > 0 ? o.height : POINT_SIZE) };
}

/**
 * A closed door is drawn in the solid wall, so a body can only ever stand flush against its box.
 * Doors therefore count as touched from 2 px away; an open door fires 2 px early, which no one notices.
 */
const DOOR_MARGIN = 2;

const grown = (b: Box, by: number): Box => ({ left: b.left - by, top: b.top - by, right: b.right + by, bottom: b.bottom + by });

interface Placed {
  readonly o: RoomObject;
  readonly box: Box;
}

interface Index {
  readonly touched: readonly Placed[];
  readonly reached: readonly Placed[];
  readonly plates: readonly Placed[];
  readonly levers: readonly Placed[];
}

/**
 * Objects never change while a room is played, yet both lookups run on every rule tick or HUD
 * frame, so the sorted, boxed lists are made once per room. Keyed by the objects array, which a
 * room keeps for as long as it is played.
 */
const indexes = new WeakMap<readonly RoomObject[], Index>();

function indexOf(room: RoomModel): Index {
  let index = indexes.get(room.objects);
  if (!index) {
    const byId = [...room.objects].sort((a, b) => a.id - b.id);
    index = {
      touched: byId.filter((o) => TOUCHED.has(o.kind)).map((o) => ({ o, box: grown(objectBox(o), o.kind === 'Door' ? DOOR_MARGIN : 0) })),
      reached: byId.filter(reached).map((o) => ({ o, box: objectBox(o) })),
      plates: byId.filter((o) => o.kind === 'Switch' && o.props['mode'] === 'hold').map((o) => ({ o, box: objectBox(o) })),
      levers: byId.filter((o) => o.kind === 'Switch' && o.props['mode'] === 'toggle').map((o) => ({ o, box: objectBox(o) })),
    };
    indexes.set(room.objects, index);
  }
  return index;
}

/** Doors and triggers the operator body overlaps, in object id order. */
export function touchedObjects(room: RoomModel, body: Box): RoomObject[] {
  return indexOf(room).touched.filter((p) => overlaps(body, p.box)).map((p) => p.o);
}

/** Ids of the hold switches (pressure plates) the box stands on, in id order. */
export function platesUnder(room: RoomModel, box: Box): number[] {
  return indexOf(room).plates.filter((p) => overlaps(box, p.box)).map((p) => p.o.id);
}

/** The lowest-id toggle switch the box overlaps, for a staple hitting one. */
export function leverAt(room: RoomModel, box: Box): RoomObject | undefined {
  return indexOf(room).levers.find((p) => overlaps(box, p.box))?.o;
}

/**
 * The talk, bed, pickup or switch object the interact key would use: the nearest one whose box
 * meets the body grown by INTERACT_REACH, and the lowest id when two are equally near; a pickup
 * already taken is not there. One definition for the rule and for the HUD prompt, so the prompt
 * never promises what the key will not do.
 */
export function reachableObject(
  room: RoomModel, body: Box, feet: { readonly x: number; readonly y: number }, taken: readonly number[],
): RoomObject | undefined {
  const reach = grown(body, INTERACT_REACH);
  let best: { o: RoomObject; d: number } | undefined;
  for (const { o, box } of indexOf(room).reached) {
    if (!overlaps(reach, box) || (o.kind === 'Pickup' && taken.includes(o.id))) continue;
    const d = Math.hypot((box.left + box.right) / 2 - feet.x, (box.top + box.bottom) / 2 - feet.y);
    if (!best || d < best.d) best = { o, d };
  }
  return best?.o;
}

/** Where the operator stands after coming through `door`: just inside it, clear of the door box. */
export function arrivalPoint(door: RoomObject, body: Body): { x: number; y: number } {
  const box = objectBox(door);
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  const gap = 2;
  switch (door.props['socket']) {
    case 'N': return { x: cx, y: box.bottom + body.height + gap };
    case 'S': return { x: cx, y: box.top - gap };
    case 'W': return { x: box.right + body.halfW + gap, y: cy + body.height / 2 };
    case 'E': return { x: box.left - body.halfW - gap, y: cy + body.height / 2 };
    default: throw new Error(`door #${door.id} has no valid socket`);
  }
}
