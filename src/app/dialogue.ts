import { OPERATOR_SPEAKER, type ContentTypes, type DialogueTable, type GameEvent, type RoomObject } from '../core/index.ts';
import type { KeyboardInput } from './input.ts';

/**
 * When a conversation ends or an event card is chosen, keys still down from confirming it count as
 * released until they come up. A held J or left button is also a held attack, and the stapler
 * fires on a held attack.
 * Listeners run inside the tick, so this lands before the next tick samples. Returns the remover.
 */
export function releaseKeysOnClose(loop: { onEvent(fn: (e: GameEvent) => void): () => void }, keys: Pick<KeyboardInput, 'ignoreHeld'>): () => void {
  return loop.onEvent((e) => {
    if (e.type === 'dialogueClosed' || e.type === 'cardChosen') keys.ignoreHeld();
  });
}

export type Speakers = ContentTypes['speakers']['speakers'];

export interface PortraitFile {
  /** Phaser texture key. */
  readonly key: string;
  /** Under public/, as the loader takes it. */
  readonly url: string;
}

export const portraitKey = (speaker: string, expression: string): string => `portrait:${speaker}:${expression}`;

/** One file per speaker and expression the table uses, for the speakers that have portraits. */
export function portraitsUsed(table: DialogueTable, speakers: Speakers): PortraitFile[] {
  const files = new Map<string, PortraitFile>();
  for (const d of table.values()) {
    for (const l of d.lines) {
      if (!speakers[l.speaker]?.portrait) continue;
      const key = portraitKey(l.speaker, l.expression);
      files.set(key, { key, url: `assets/portraits/portrait-${l.speaker}-${l.expression}.png` });
    }
  }
  return [...files.values()];
}

/**
 * Conversations that rooms start but the table does not hold: an NPC's `dialogueId` or a dialogue
 * Trigger's `eventId`. The map check catches these in CI; this is the same rule where the game
 * starts, so a stale bundle stops at Boot instead of throwing in the middle of a tick.
 */
export function missingDialogues(
  rooms: ReadonlyMap<string, { readonly objects: readonly Pick<RoomObject, 'id' | 'kind' | 'props'>[] }>,
  table: DialogueTable,
): string[] {
  const out: string[] = [];
  for (const [path, room] of rooms) {
    for (const o of room.objects) {
      const id = o.kind === 'NPC' ? o.props['dialogueId'] : o.kind === 'Trigger' && o.props['event'] === 'dialogue' ? o.props['eventId'] : undefined;
      if (id === undefined || table.has(String(id))) continue;
      out.push(`${path}: ${o.kind} #${o.id} starts conversation "${String(id)}", which no file under content/dialogue defines`);
    }
  }
  return out;
}

/**
 * Speakers a conversation names that the registry does not know. The content check says it in
 * Chinese; this is the same rule where the game starts, so a table that slipped past never
 * reaches a scene that would draw `undefined` under a name tag.
 */
export function speakerProblems(table: DialogueTable, speakers: Speakers): string[] {
  const out: string[] = [];
  for (const d of table.values()) {
    const unknown = new Set(d.lines.map((l) => l.speaker).filter((s) => s !== OPERATOR_SPEAKER && !speakers[s]));
    for (const s of unknown) out.push(`${d.file}: ${d.id} names speaker "${s}", which content/speakers.json does not list`);
  }
  return out;
}
