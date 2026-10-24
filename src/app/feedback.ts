import type { DomainEvent } from '../core/index.ts';

/**
 * content/feedback.json: domain event type to presentation (architecture section 4). The art
 * and audio owners tune it without touching rules. A note is a key into content/strings;
 * "{field}" in a note key is filled from the event, e.g. "solution.{solution}".
 */
export interface ParticlePreset {
  readonly texture: string;
  /** [min, max] in world pixels per second. */
  readonly speed: readonly number[];
  readonly life: number;
}

export interface Feedback {
  readonly flashTarget?: number;
  readonly flashOperator?: number;
  readonly shake?: { readonly px: number; readonly seconds: number };
  readonly particles?: readonly { readonly preset: string; readonly count: number }[];
  readonly bounce?: boolean;
  readonly closeOut?: boolean;
  readonly note?: string;
}

export interface FeedbackTable {
  readonly version: 1;
  readonly presets: Readonly<Record<string, ParticlePreset>>;
  readonly events: Readonly<Partial<Record<DomainEvent['type'], Feedback>>>;
}

export interface StringTable {
  readonly version: 1;
  readonly strings: Readonly<Record<string, { readonly text: string; readonly fact: string }>>;
}

/** A Record keyed by the union, so adding an event to core without listing it here fails to compile. */
const ALL_EVENTS: Record<DomainEvent['type'], true> = {
  bumpWall: true, fire: true, dodge: true, perfectDodge: true, telegraph: true, hit: true, caseClosed: true,
  dispersed: true, reformed: true, respawned: true, immuneBounce: true, heartLost: true, freeze: true, forcedLeave: true,
};
/** Every event type core can emit; a feedback key outside this list is a typo. */
export const EVENT_TYPES = Object.keys(ALL_EVENTS) as DomainEvent['type'][];

export function feedbackProblems(table: FeedbackTable, strings: StringTable): string[] {
  const out: string[] = [];
  for (const [name, p] of Object.entries(table.presets)) {
    if (p.speed.length !== 2 || p.speed[0]! > p.speed[1]!) out.push(`preset "${name}": speed must be [min, max]`);
  }
  for (const [type, fb] of Object.entries(table.events)) {
    if (!(EVENT_TYPES as readonly string[]).includes(type)) out.push(`feedback for unknown event "${type}"`);
    for (const p of fb?.particles ?? []) if (!table.presets[p.preset]) out.push(`${type}: unknown particle preset "${p.preset}"`);
    if (fb?.note && !fb.note.includes('{') && !strings.strings[fb.note]) out.push(`${type}: note "${fb.note}" is not in content/strings`);
  }
  return out;
}

/** Fills "{field}" placeholders from the event; undefined when the string table lacks the key. */
export function noteText(note: string, event: DomainEvent, strings: StringTable): string | undefined {
  const key = note.replace(/\{(\w+)\}/g, (_, f: string) => String((event as unknown as Record<string, unknown>)[f] ?? ''));
  return strings.strings[key]?.text;
}
