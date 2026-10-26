import { MINUTES_PER_DAY, type RuleClock } from '../clock.ts';
import type { TagDictionary } from '../tags/dictionary.ts';
import { holds, type TagState } from '../tags/store.ts';
import type { RoomObject } from './tiled.ts';

/**
 * Door locks (design doc 13.3 names the five kinds and leaves their rules open; the rules chosen
 * here are written up in docs/authoring/rooms-and-dialogue.md). A room's puzzle must be
 * self-contained, so a switch lock is opened by switches in the same room, while the clock and
 * resource locks read global state, which is how progress crosses rooms.
 *
 *   none      always open
 *   switch    open while every Switch aimed at the door is on, and at least one is present
 *   clock     open while the chapter clock is inside lockParam, "HH:MM-HH:MM"
 *   resource  open while the condition in lockParam holds, e.g. "caffeine<50"
 *   key       not openable yet; it arrives with Pickup
 */

/** A daily window in minutes of the day. `to` may be 1440 (24:00); a window that ends before it starts runs past midnight. */
export interface ClockWindow {
  readonly from: number;
  readonly to: number;
}

const HHMM = /^([0-9]{2}):([0-9]{2})$/;

function minuteOfDay(text: string, allowEnd: boolean): number | undefined {
  const m = HHMM.exec(text);
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return undefined;
  if (h === 24 && min === 0 && allowEnd) return MINUTES_PER_DAY;
  return h < 24 ? h * 60 + min : undefined;
}

/** "08:00-10:00", "17:00-24:00" or "22:00-02:00"; undefined for anything else, including an empty window. */
export function parseClockWindow(text: string): ClockWindow | undefined {
  const parts = text.split('-');
  if (parts.length !== 2) return undefined;
  const from = minuteOfDay(parts[0]!, false);
  const to = minuteOfDay(parts[1]!, true);
  if (from === undefined || to === undefined || from === to) return undefined;
  return { from, to };
}

export function inWindow(w: ClockWindow, clock: RuleClock): boolean {
  const t = clock.minute % MINUTES_PER_DAY;
  return w.from < w.to ? t >= w.from && t < w.to : t >= w.from || t < w.to;
}

export const lockOf = (door: RoomObject): string => String(door.props['lock']);

/**
 * Whether some state of the game can open this door. A door that cannot is a closed door: it
 * needs no link in the chapter file, and is the way to leave a socket unused.
 */
export const mayOpen = (door: RoomObject): boolean => lockOf(door) !== 'key';

/** Switches aimed at `doorId`, in object id order. */
export function switchesFor(objects: readonly RoomObject[], doorId: number): RoomObject[] {
  return objects.filter((o) => o.kind === 'Switch' && o.props['target'] === doorId).sort((a, b) => a.id - b.id);
}

/**
 * Doors whose clock or resource lock is open now. The room knows neither tags nor which of its
 * doors the chapter links, so the chapter works this out every tick and hands it to the room.
 */
export function openByState(objects: readonly RoomObject[], tags: TagState, dict: TagDictionary, clock: RuleClock): number[] {
  const out: number[] = [];
  for (const o of objects) {
    if (o.kind !== 'Door') continue;
    const lock = lockOf(o);
    if (lock === 'clock') {
      const w = parseClockWindow(String(o.props['lockParam']));
      if (w && inWindow(w, clock)) out.push(o.id);
    } else if (lock === 'resource') {
      const c = o.conditions['lockParam'];
      if (c && holds(tags, dict, c)) out.push(o.id);
    }
  }
  return out.sort((a, b) => a - b);
}

/** A switch lock is open when it has switches and all of them are on. */
export function switchLockOpen(objects: readonly RoomObject[], doorId: number, on: readonly number[]): boolean {
  const aimed = switchesFor(objects, doorId);
  return aimed.length > 0 && aimed.every((s) => on.includes(s.id));
}

/**
 * The one rule for whether a door lets the operator through, used by the room step and the view.
 * `objects` are the room as entered, so a switch in an inactive variant does not exist.
 */
export function doorOpen(objects: readonly RoomObject[], door: RoomObject, switchesOn: readonly number[], unlocked: readonly number[]): boolean {
  switch (lockOf(door)) {
    case 'none': return true;
    case 'switch': return switchLockOpen(objects, door.id, switchesOn);
    case 'clock':
    case 'resource': return unlocked.includes(door.id);
    default: return false;
  }
}
