import type { TagDictionary } from '../tags/dictionary.ts';
import { holds, type TagState } from '../tags/store.ts';
import type { RoomModel } from './tiled.ts';

/**
 * A room as the player finds it: variant layers and tag-driven spawns are decided once, from
 * the tags at the moment of entry (build plan P2). Tags that change while the player is inside
 * do not rebuild the room; the next entry does.
 */
export interface EnteredRoom extends RoomModel {
  /** Ids of the variants whose `when` held at entry, in map order. */
  readonly active: readonly string[];
}

const DECIDED_AT_ENTRY = new Set(['Spawn', 'Pickup', 'Box']);

/**
 * Keeps base objects plus those of active variants, and drops Spawns, Pickups and Boxes whose own
 * `when` fails: like an enemy, an item or a box is there or not for the whole visit. Other kinds
 * keep their `when` for the system that owns them (a Trigger fires later, not now).
 */
export function enterRoom(room: RoomModel, tags: TagState, dict: TagDictionary): EnteredRoom {
  const active = room.variants.filter((v) => holds(tags, dict, v.when)).map((v) => v.id);
  const on = new Set(active);
  const objects = room.objects.filter((o) => {
    if (o.variant !== undefined && !on.has(o.variant)) return false;
    const when = DECIDED_AT_ENTRY.has(o.kind) ? o.conditions['when'] : undefined;
    return when === undefined || holds(tags, dict, when);
  });
  return { ...room, objects, active };
}
