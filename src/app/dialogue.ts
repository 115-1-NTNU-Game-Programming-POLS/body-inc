import { OPERATOR_SPEAKER, type ContentTypes, type DialogueTable } from '../core/index.ts';

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
