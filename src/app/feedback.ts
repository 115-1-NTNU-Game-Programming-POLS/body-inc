import type { DomainEvent, EnemyTable, FeedbackFile, StringsFile } from '../core/index.ts';

/**
 * content/feedback.json: domain event type to presentation (architecture section 4). The art
 * and audio owners tune it without touching rules. A note is a key into content/strings;
 * "{field}" in a note key is filled from the event, e.g. "solution.{solution}".
 * Shapes come from content/schema; this file checks the references a schema cannot.
 */
export type FeedbackTable = FeedbackFile;
export type StringTable = StringsFile;

/** A Record keyed by the union, so adding an event to core without listing it here fails to compile. */
const ALL_EVENTS: Record<DomainEvent['type'], true> = {
  bumpWall: true, fire: true, dodge: true, perfectDodge: true, telegraph: true, hit: true, caseClosed: true,
  dispersed: true, reformed: true, respawned: true, immuneBounce: true, heartLost: true, freeze: true, forcedLeave: true,
};
/** Every event type core can emit; a feedback key outside this list is a typo. */
export const EVENT_TYPES = Object.keys(ALL_EVENTS) as DomainEvent['type'][];

/** Every key a note can produce: each "{field}" expands over the values core can put there. */
function noteKeys(note: string, fields: Readonly<Record<string, readonly string[]>>): { keys: string[]; unknown: string[] } {
  let keys = [note];
  const unknown: string[] = [];
  for (const [, field] of note.matchAll(/\{(\w+)\}/g)) {
    const values = fields[field!];
    if (!values) { unknown.push(field!); continue; }
    keys = keys.flatMap((k) => values.map((v) => k.replace(`{${field}}`, v)));
  }
  return { keys, unknown };
}

/**
 * `fields` lists the values each note placeholder can take (e.g. every immune enemy's
 * solution), so a templated note is checked as strictly as a plain one.
 */
export function feedbackProblems(
  table: FeedbackTable, strings: StringTable, fields: Readonly<Record<string, readonly string[]>>,
): string[] {
  const out: string[] = [];
  for (const [name, p] of Object.entries(table.presets)) {
    if (p.speed.length !== 2 || p.speed[0]! > p.speed[1]!) out.push(`preset "${name}": speed must be [min, max]`);
  }
  for (const [type, fb] of Object.entries(table.events)) {
    if (!(EVENT_TYPES as readonly string[]).includes(type)) out.push(`feedback for unknown event "${type}"`);
    for (const p of fb?.particles ?? []) if (!table.presets[p.preset]) out.push(`${type}: unknown particle preset "${p.preset}"`);
    if (!fb?.note) continue;
    const { keys, unknown } = noteKeys(fb.note, fields);
    for (const f of unknown) out.push(`${type}: note "${fb.note}" uses unknown placeholder "{${f}}"`);
    if (unknown.length > 0) continue;
    for (const k of keys) if (!strings.strings[k]) out.push(`${type}: note "${k}" is not in content/strings`);
  }
  return out;
}

/** Placeholder values for the notes in content/feedback.json, taken from the enemy table. */
export function noteFields(table: EnemyTable): Record<string, readonly string[]> {
  const immune = [...table.enemies.values()].filter((e) => e.category === 'immune' && e.solution !== undefined);
  return { solution: [...new Set(immune.map((e) => e.solution!))].sort() };
}

/** Fills "{field}" placeholders from the event; undefined when the string table lacks the key. */
export function noteText(note: string, event: DomainEvent, strings: StringTable): string | undefined {
  const key = note.replace(/\{(\w+)\}/g, (_, f: string) => String((event as unknown as Record<string, unknown>)[f] ?? ''));
  return strings.strings[key]?.text;
}
