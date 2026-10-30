import { PROGRESS, withPage, type Deck, type DialogueTable, type HandbookFile, type ProgressData, type RoomModel, type StringsFile } from '../core/index.ts';
import type { SaveIssue, SaveStore } from './storage.ts';

/** String key of a page's title; the body keys are listed in content/handbook.json. */
export const titleKey = (id: string): string => `handbook.${id}.title`;

/**
 * What a schema cannot say about content/handbook.json: ids are unique, and every page has its
 * title and paragraphs in each strings file. Chinese, because content authors read it.
 */
export function handbookProblems(file: HandbookFile, strings: readonly { readonly file: string; readonly value: StringsFile }[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of file.pages) {
    if (seen.has(p.id)) out.push(`手冊頁 id「${p.id}」重複`);
    seen.add(p.id);
    for (const s of strings) {
      for (const key of [titleKey(p.id), ...p.body]) {
        if (!s.value.strings[key]) out.push(`手冊頁「${p.id}」用到的文字「${key}」不在 ${s.file}`);
      }
    }
  }
  return out;
}

/**
 * Pages that rooms, conversations or cards unlock but the handbook does not have. The map,
 * dialogue and deck checks report these to authors; this repeats them at startup because an
 * unknown page would be saved to the progress slot and then crash the note that names it.
 */
export function missingPages(rooms: ReadonlyMap<string, RoomModel>, dialogues: DialogueTable, file: HandbookFile, deck?: Deck): string[] {
  const pages = new Set(file.pages.map((p) => p.id));
  const out: string[] = [];
  for (const [path, room] of rooms) {
    for (const o of room.objects) {
      const id = String(o.props['itemId']).trim();
      if (o.kind === 'Pickup' && o.props['itemType'] === 'handbook' && !pages.has(id)) out.push(`${path} #${o.id}: handbook page "${id}"`);
      const bed = String(o.props['unlocks'] ?? '').trim();
      if (o.kind === 'Bed' && bed !== '' && !pages.has(bed)) out.push(`${path} #${o.id}: handbook page "${bed}"`);
    }
  }
  for (const [id, d] of dialogues) {
    for (const l of d.lines) for (const e of l.effects) if (e.kind === 'unlock' && !pages.has(e.id)) out.push(`dialogue ${id}: handbook page "${e.id}"`);
  }
  for (const c of deck ? [...deck.opening, ...deck.events.values(), ...deck.closing] : []) {
    for (const o of c.options) for (const e of o.effects) if (e.kind === 'unlock' && !pages.has(e.id)) out.push(`card ${c.id}/${o.id}: handbook page "${e.id}"`);
  }
  return out;
}

export interface Kept {
  readonly progress: ProgressData;
  /** False when the page was already in the handbook; nothing was written then. */
  readonly isNew: boolean;
  readonly issues: readonly SaveIssue[];
}

/**
 * Records an unlocked page in the progress slot at once: a page outlives every run (design doc
 * 13.5), so it must not wait for the next checkpoint. The returned progress is the one to show
 * even when the write failed.
 */
export function keepPage(saves: Pick<SaveStore, 'save'>, progress: ProgressData, id: string): Kept {
  const next = withPage(progress, id);
  if (!next) return { progress, isNew: false, issues: [] };
  return { progress: next, isNew: true, issues: saves.save(PROGRESS, next) };
}
