import type { Deck, ExamTable, RescueTable, RoomObject } from '../core/index.ts';

type Rooms = ReadonlyMap<string, { readonly objects: readonly Pick<RoomObject, 'id' | 'kind' | 'props'>[] }>;

/** Exams that rooms open but content/exams lacks; the map check's rule again, at Boot. */
export function missingExams(rooms: Rooms, exams: ExamTable): string[] {
  const out: string[] = [];
  for (const [path, room] of rooms) {
    for (const o of room.objects) {
      if (o.kind !== 'Trigger' || o.props['event'] !== 'exam') continue;
      const id = String(o.props['eventId']);
      if (!exams.has(id)) out.push(`${path}: Trigger #${o.id} opens exam "${id}", which content/exams does not define`);
    }
  }
  return out;
}
/** Rescues that rooms open but content/rescue.json lacks; the map check's rule again, at Boot. */
export function missingRescues(rooms: Rooms, rescues: RescueTable): string[] {
  const out: string[] = [];
  for (const [path, room] of rooms) {
    for (const o of room.objects) {
      if (o.kind !== 'Trigger' || o.props['event'] !== 'rescue') continue;
      const id = String(o.props['eventId']);
      if (!rescues.has(id)) out.push(`${path}: Trigger #${o.id} opens rescue "${id}", which content/rescue.json does not define`);
    }
  }
  return out;
}

/**
 * Event cards that rooms ask for but the chapter's deck does not hold: a Trigger with event
 * `card` names one by its eventId. The map check catches these in CI; this is the same rule where
 * the game starts, so a stale bundle stops at Boot instead of throwing in the middle of a tick.
 */
export function missingCards(
  rooms: ReadonlyMap<string, { readonly objects: readonly Pick<RoomObject, 'id' | 'kind' | 'props'>[] }>,
  deck: Deck | undefined,
): string[] {
  const out: string[] = [];
  for (const [path, room] of rooms) {
    for (const o of room.objects) {
      if (o.kind !== 'Trigger' || o.props['event'] !== 'card') continue;
      const id = String(o.props['eventId']);
      if (deck?.events.has(id)) continue;
      out.push(`${path}: Trigger #${o.id} shows event card "${id}", which ${deck ? `content/decks/${deck.chapter}.json does not define` : 'no deck defines (the chapter has no file under content/decks)'}`);
    }
  }
  return out;
}
