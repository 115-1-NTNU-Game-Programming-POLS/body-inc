import type { RuleClock } from '../clock.ts';
import { DEFAULT_HOST, readHostName } from '../host/name.ts';
import type { TagState } from '../tags/store.ts';
import { isRecord, type Schema } from '../content/schema.ts';
import type { SlotDef } from './save.ts';
import type { Answer } from '../semester/interactive.ts';
import { FLOORS } from '../semester/floors.ts';
import { GRADES } from '../semester/load.ts';
import { TOOLS, type Tool } from '../tools.ts';

/** The choices of each setting, in the order the pause menu cycles through them. */
export const TEXT_SCALES = [1, 1.25] as const;
export const GAME_SPEEDS = [1, 0.8, 0.7] as const;

/**
 * The on/off assists of "flexible hours" (design doc 5.7), in the order the pause menu lists them.
 * Three change the fight (core/combat/assists.ts), one changes the input and two the presentation.
 */
export const ASSIST_FLAGS = ['halfDamage', 'neverEmpty', 'autoPerfect', 'toggleAttack', 'noShake', 'lessFlash'] as const;
export type AssistFlag = (typeof ASSIST_FLAGS)[number];

/**
 * Player settings. Text scale is the 100% / 125% choice of art direction 8.2; game speed 0.8 and
 * 0.7 and the assist flags are the "flexible hours" of design doc 5.7.
 */
export interface Settings extends Readonly<Record<AssistFlag, boolean>> {
  readonly textScale: (typeof TEXT_SCALES)[number];
  readonly gameSpeed: (typeof GAME_SPEEDS)[number];
}

const ALL_OFF: Readonly<Record<AssistFlag, false>> = Object.fromEntries(ASSIST_FLAGS.map((f) => [f, false])) as Record<AssistFlag, false>;

// Version 1 had the two choices only. Version 2 adds the assist flags, which an old save has off.
export const SETTINGS: SlotDef<Settings> = {
  name: 'settings',
  version: 2,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['textScale', 'gameSpeed', ...ASSIST_FLAGS],
    properties: {
      textScale: { enum: [...TEXT_SCALES] },
      gameSpeed: { enum: [...GAME_SPEEDS] },
      ...Object.fromEntries(ASSIST_FLAGS.map((f) => [f, { type: 'boolean' }])),
    },
  },
  defaults: () => ({ textScale: 1, gameSpeed: 1, ...ALL_OFF }),
  // The flags go first so a version 1 file that somehow holds one is judged by the schema, not overwritten.
  migrations: { 1: (data) => ({ ...ALL_OFF, ...(data as object) }) },
};

/**
 * The latest time clock the player punched (design doc 5.6): where to come back after a forced
 * leave or a restart. Tags and the rule clock are what the outer layer had decided by then;
 * `fired` is the one-time triggers already used, so a restart does not replay them.
 */
export interface Checkpoint {
  readonly chapter: string;
  /** Room path as folder/map, the key of the chapter's room library. */
  readonly roomId: string;
  readonly x: number;
  readonly y: number;
  readonly tags: TagState;
  readonly clock: RuleClock;
  readonly fired: readonly string[];
  /** Toggle switches that were on at the punch, as `roomId#objectId`. */
  readonly switches: readonly string[];
  /** Where boxes were last left, by `roomId#objectId`; entering a room settles them (core/rooms/boxes.ts). */
  readonly boxes: readonly BoxPlace[];
  /** Tools held at the punch; the prologue punches before the stamp is handed over. */
  readonly tools: readonly Tool[];
}

export interface BoxPlace {
  readonly key: string;
  readonly col: number;
  readonly row: number;
}

/**
 * Where the next chapter of the story starts when nothing has been punched in it yet: the tags the
 * last chapter's closing cards left and the tools carried over. "Continue" plays its opening cards
 * not yet answered, then starts it.
 */
export interface ChapterEntry {
  readonly chapter: string;
  readonly tags: TagState;
  readonly tools: readonly Tool[];
}

export interface StoryData {
  readonly checkpoint: Checkpoint | null;
  /** Set between chapters; a punch in the new chapter replaces it with the checkpoint. */
  readonly entry: ChapterEntry | null;
}

const INT = { type: 'integer', minimum: 0 } as const satisfies Schema;
const STR = { type: 'string' } as const satisfies Schema;

const TAG_ENTRY: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['value', 'node'],
  properties: {
    value: { anyOf: [{ type: 'number' }, { const: true }] },
    node: INT,
    until: { type: 'number' },
    wakesLeft: INT,
  },
};

const CAUSAL_NODE: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'kind', 'key', 'at', 'causes'],
  properties: {
    id: INT,
    kind: { enum: ['card', 'event', 'choice', 'activity', 'rule', 'tag', 'effect', 'crisis'] },
    key: STR,
    at: INT,
    causes: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['node', 'at'], properties: { node: INT, at: INT } },
    },
    data: { type: 'object', additionalProperties: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] } },
  },
};

const TAGS: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['values', 'log'],
  properties: {
    values: { type: 'object', additionalProperties: TAG_ENTRY },
    log: { type: 'object', additionalProperties: false, required: ['nodes'], properties: { nodes: { type: 'array', items: CAUSAL_NODE } } },
  },
};

const TOOL_LIST: Schema = { type: 'array', uniqueItems: true, items: { enum: [...TOOLS] } };

const ENTRY: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['chapter', 'tags', 'tools'],
  properties: { chapter: { type: 'string', minLength: 1 }, tags: TAGS, tools: TOOL_LIST },
};

const CHECKPOINT: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['chapter', 'roomId', 'x', 'y', 'tags', 'clock', 'fired', 'switches', 'boxes', 'tools'],
  properties: {
    chapter: { type: 'string', minLength: 1 },
    roomId: { type: 'string', minLength: 1 },
    x: { type: 'number' },
    y: { type: 'number' },
    tags: TAGS,
    tools: TOOL_LIST,
    clock: { type: 'object', additionalProperties: false, required: ['day', 'minute'], properties: { day: { type: 'integer', minimum: 1 }, minute: INT } },
    fired: { type: 'array', items: STR },
    switches: { type: 'array', items: STR },
    boxes: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['key', 'col', 'row'], properties: { key: { type: 'string', minLength: 1 }, col: INT, row: INT } },
    },
  },
};

/** Story progress: the checkpoint of the chapter being played, or the entry of the next one, or neither on a fresh save. */
export const STORY: SlotDef<StoryData> = {
  name: 'story',
  version: 4,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['checkpoint', 'entry'],
    properties: { checkpoint: { anyOf: [{ type: 'null' }, CHECKPOINT] }, entry: { anyOf: [{ type: 'null' }, ENTRY] } },
  },
  defaults: () => ({ checkpoint: null, entry: null }),
  migrations: {
    // Version 2 keeps the toggle switches; a version-1 checkpoint was punched before any existed.
    1: (data) => {
      if (!isRecord(data) || !isRecord(data['checkpoint'])) return data;
      return { ...data, checkpoint: { ...data['checkpoint'], switches: [] } };
    },
    // Version 3 keeps where boxes were left; before it every box was where the map put it.
    2: (data) => {
      if (!isRecord(data) || !isRecord(data['checkpoint'])) return data;
      return { ...data, checkpoint: { ...data['checkpoint'], boxes: [] } };
    },
    // Version 4 keeps tools and the next chapter's entry. Before it every chapter started with the
    // stamp, which was the only tool then; the folder, added later, must not appear in an old save.
    3: (data) => {
      if (!isRecord(data)) return data;
      const cp = data['checkpoint'];
      return { ...data, entry: null, checkpoint: isRecord(cp) ? { ...cp, tools: ['stamp'] } : cp };
    },
  },
};

/**
 * Cross-run progress (design doc 13.5): what outlives every run and every chapter. The handbook
 * and the host's name so far; achievements, the career tree and the rest join it when they exist.
 */
export interface ProgressData {
  /** Unlocked handbook page ids, in the order they were found. */
  readonly handbook: readonly string[];
  /** What `{host}` reads as. A new game or a checkpoint never resets it; see `savedHost`. */
  readonly hostName: string;
  /** Semesters played to their end; 0 makes the next one the scripted first week (design doc 8.13). */
  readonly semestersDone: number;
  /** The highest overtime clause level the player may start at (design doc 8.14); absent is 0. A clear of that level opens the next. */
  readonly clauseUnlocked?: number;
}

export const PROGRESS: SlotDef<ProgressData> = {
  name: 'progress',
  version: 4,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['handbook', 'hostName', 'semestersDone'],
    properties: {
      handbook: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
      // The schema cannot count characters; savedHost applies the full rules after loading.
      hostName: { type: 'string', minLength: 1 },
      semestersDone: INT,
      // The levels that exist are the rules' business (core/semester/clauses.ts); the save only keeps a count.
      clauseUnlocked: INT,
    },
  },
  defaults: () => ({ handbook: [], hostName: DEFAULT_HOST, semestersDone: 0 }),
  migrations: {
    // Version 2 keeps the host's name; before it the host was always 小晨.
    1: (data) => (isRecord(data) ? { ...data, hostName: DEFAULT_HOST } : data),
    // Version 3 counts finished semesters; a save from before it has none on record.
    2: (data) => (isRecord(data) ? { ...data, semestersDone: 0 } : data),
    // Version 4 adds the unlocked clause level as an optional field; a save from before it has unlocked none.
    3: (data) => data,
  },
};

/**
 * The saved name if it still passes the naming rules, otherwise the default. Storage can be
 * edited by hand, and a name the rules refuse could break a line or a placeholder.
 */
export function savedHost(progress: ProgressData): string {
  const read = readHostName(progress.hostName);
  return read.ok && read.name === progress.hostName ? read.name : DEFAULT_HOST;
}

/** Progress with the page added, or undefined when it was already there, so nothing needs saving. */
export function withPage(progress: ProgressData, id: string): ProgressData | undefined {
  return progress.handbook.includes(id) ? undefined : { ...progress, handbook: [...progress.handbook, id] };
}

/**
 * A semester in progress (design doc 13.5, ux-spec section 8). The rules are a pure function of the
 * seed and the answers (core/semester/interactive.ts), so those alone are kept: replaying them
 * gives back the state at the morning after the last finished day.
 */
export interface SemesterRun {
  readonly seed: number;
  /** The course cards taken (design doc 8.3); absent in a run saved before there was a selection, which replays without them. */
  readonly courses?: readonly string[];
  /** The overtime clause level (design doc 8.14); absent is level 0, which is what a run saved before the clauses replays as. */
  readonly clause?: number;
  /** The answers of each finished day, in the order the day asked its questions. */
  readonly days: readonly (readonly Answer[])[];
}

export interface RunData {
  readonly semester: SemesterRun | null;
}

const FLOOR: Schema = { enum: [...FLOORS] };

const ANSWER: Schema = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'plan'],
      properties: {
        kind: { const: 'plan' },
        plan: {
          type: 'object',
          additionalProperties: false,
          required: ['coffee', 'rest'],
          properties: { coffee: { type: 'array', items: INT }, rest: { type: 'array', items: INT }, write: INT, project: INT, grade: INT, walk: { type: 'boolean' } },
        },
      },
    },
    { type: 'object', additionalProperties: false, required: ['kind', 'option'], properties: { kind: { const: 'event' }, option: { type: 'string', minLength: 1 } } },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'choice'],
      properties: {
        kind: { const: 'floor' },
        choice: {
          type: 'object',
          additionalProperties: false,
          required: ['patrol'],
          properties: {
            patrol: FLOOR,
            overtime: FLOOR,
            played: {
              type: 'array',
              items: {
                anyOf: [
                  { type: 'null' },
                  { type: 'object', additionalProperties: false, required: ['grade'], properties: { grade: { enum: [...GRADES] }, records: INT } },
                  { type: 'object', additionalProperties: false, required: ['failed'], properties: { failed: { const: true } } },
                ],
              },
            },
            card: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'plan'],
      properties: {
        kind: { const: 'night' },
        plan: {
          type: 'object',
          additionalProperties: false,
          required: ['bed', 'nextWake', 'lateNight'],
          properties: { bed: { type: 'number' }, nextWake: INT, lateNight: { enum: ['study', 'rest'] }, debug: INT, rank: INT, grade: INT },
        },
      },
    },
  ],
};

export const RUN: SlotDef<RunData> = {
  name: 'run',
  version: 9,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['semester'],
    properties: {
      semester: {
        anyOf: [
          { type: 'null' },
          {
            type: 'object',
            additionalProperties: false,
            required: ['seed', 'days'],
            properties: {
              seed: INT,
              courses: { type: 'array', items: { type: 'string', minLength: 1 } },
              clause: INT,
              days: { type: 'array', items: { type: 'array', items: ANSWER } },
            },
          },
        ],
      },
    },
  },
  defaults: () => ({ semester: null }),
  // Versions 2 to 9 add optional fields (the course list; the hours of writing and debugging; the contest hours; the project hours and the walk; the grading hours; the overtime clause; the results of the patrols played; the welfare card picked and the records a patrol made); an older run is valid without them.
  migrations: { 1: (data) => data, 2: (data) => data, 3: (data) => data, 4: (data) => data, 5: (data) => data, 6: (data) => data, 7: (data) => data, 8: (data) => data },
};

export const SLOTS = [SETTINGS, STORY, PROGRESS, RUN] as const;
