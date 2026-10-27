import type { EnemyTable, FeedbackFile, GameEvent, StringsFile } from '../core/index.ts';
import { OBJECT_CLASSES } from '../core/rooms/classes.ts';

/** The values of an enum member, from the class definition, so a new value needs its note. */
const enumValues = (cls: string, member: string): readonly string[] => {
  const spec = OBJECT_CLASSES[cls]![member]!;
  return spec.type === 'enum' ? spec.values : [];
};
const BED_TYPES = enumValues('Bed', 'bedType');
/** An open door is never reported as locked. */
const LOCKS = enumValues('Door', 'lock').filter((l) => l !== 'none');
/**
 * A handbook page is announced by the handbook itself, which knows whether the page is new, so
 * its pickup has no note of its own and needs no string.
 */
const NOTED_ITEMS = enumValues('Pickup', 'itemType').filter((t) => t !== 'handbook');

/**
 * content/feedback.json: domain event type to presentation (architecture section 4). The art
 * and audio owners tune it without touching rules. A note is a key into content/strings;
 * "{field}" in a note key is filled from the event, e.g. "solution.{solution}".
 * Shapes come from content/schema; this file checks the references a schema cannot.
 */
export type FeedbackTable = FeedbackFile;
export type StringTable = StringsFile;

/** A Record keyed by the union, so adding an event to core without listing it here fails to compile. */
const ALL_EVENTS: Record<GameEvent['type'], true> = {
  bumpWall: true, fire: true, dodge: true, perfectDodge: true, telegraph: true, hit: true, caseClosed: true,
  dispersed: true, reformed: true, respawned: true, immuneBounce: true, heartLost: true, freeze: true, forcedLeave: true,
  gaugeFull: true, stampRaised: true, stampLanded: true, stampVoid: true, clung: true, forcedNap: true,
  bossStage: true, bossDrink: true, bossSummon: true, powerCut: true, proposalRejected: true, bossDefeated: true,
  doorEntered: true, doorLocked: true, switchChanged: true, boxMoved: true, boxDelivered: true, portFilled: true, crateTaken: true, pickedUp: true,
  triggerEntered: true, talk: true, bedUse: true,
  roomChanged: true, dialogueOpened: true, dialogueClosed: true, handbookUnlocked: true, bedRefused: true, napped: true,
  checkpointSaved: true, clockAdvanced: true, cardOpened: true, cardChosen: true, toolGranted: true, glucoseRefilled: true, dizzyChanged: true,
  rescueOpened: true, rescueStep: true, rescueDone: true,
  outerRequested: true, returnedToCheckpoint: true, chapterEnded: true,
};
/** Every event type core can emit; a feedback key outside this list is a typo. */
export const EVENT_TYPES = Object.keys(ALL_EVENTS) as GameEvent['type'][];

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

/** Per event type, the values each note placeholder can take. */
export type NoteFields = Readonly<Partial<Record<GameEvent['type'], Readonly<Record<string, readonly string[]>>>>>;

/**
 * `fields` lists, per event, the values each note placeholder can take (e.g. every immune
 * enemy's solution), so a templated note is checked as strictly as a plain one.
 */
export function feedbackProblems(table: FeedbackTable, strings: StringTable, fields: NoteFields): string[] {
  const out: string[] = [];
  for (const [name, p] of Object.entries(table.presets)) {
    if (p.speed.length !== 2 || p.speed[0]! > p.speed[1]!) out.push(`preset "${name}": speed must be [min, max]`);
  }
  for (const [type, fb] of Object.entries(table.events)) {
    if (!(EVENT_TYPES as readonly string[]).includes(type)) out.push(`feedback for unknown event "${type}"`);
    for (const p of fb?.particles ?? []) if (!table.presets[p.preset]) out.push(`${type}: unknown particle preset "${p.preset}"`);
    if (!fb?.note) continue;
    const { keys, unknown } = noteKeys(fb.note, fields[type as GameEvent['type']] ?? {});
    for (const f of unknown) out.push(`${type}: note "${fb.note}" uses unknown placeholder "{${f}}"`);
    if (unknown.length > 0) continue;
    for (const k of keys) if (!strings.strings[k]) out.push(`${type}: note "${k}" is not in content/strings`);
  }
  return out;
}

/**
 * Placeholder values for the notes in content/feedback.json, taken from the enemy table: a
 * staple bounces only off immune enemies, while the stamp is void on reforming ones too.
 */
export function noteFields(table: EnemyTable): NoteFields {
  const solutions = (keep: (category: string) => boolean) => [...new Set(
    [...table.enemies.values()].filter((e) => keep(e.category) && e.solution !== undefined).map((e) => e.solution!),
  )].sort();
  return {
    immuneBounce: { solution: solutions((c) => c === 'immune') },
    stampVoid: { solution: solutions((c) => c !== 'defeatable') },
    bossStage: { stage: ['2', '3'] },
    bedRefused: { bedType: [...BED_TYPES] },
    doorLocked: { lock: [...LOCKS] },
    pickedUp: { itemType: [...NOTED_ITEMS] },
  };
}

/** Fills "{field}" placeholders from the event; undefined when the string table lacks the key. */
export function noteText(note: string, event: GameEvent, strings: StringTable): string | undefined {
  const key = note.replace(/\{(\w+)\}/g, (_, f: string) => String((event as unknown as Record<string, unknown>)[f] ?? ''));
  return strings.strings[key]?.text;
}
