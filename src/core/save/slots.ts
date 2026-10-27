import type { RuleClock } from '../clock.ts';
import { DEFAULT_HOST, readHostName } from '../host/name.ts';
import type { TagState } from '../tags/store.ts';
import { isRecord, type Schema } from '../content/schema.ts';
import type { SlotDef } from './save.ts';
import { TOOLS, type Tool } from '../tools.ts';

/**
 * Player settings. Text scale is the 100% / 125% choice of art direction 8.2; game speed 0.8
 * is the "flexible hours" assist of the design doc. Cross-run progress and the semester run
 * (design doc 13.5) get their own slots when those systems exist.
 */
export interface Settings {
  readonly textScale: 1 | 1.25;
  readonly gameSpeed: 1 | 0.8;
}

export const SETTINGS: SlotDef<Settings> = {
  name: 'settings',
  version: 1,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['textScale', 'gameSpeed'],
    properties: {
      textScale: { enum: [1, 1.25] },
      gameSpeed: { enum: [1, 0.8] },
    },
  },
  defaults: () => ({ textScale: 1, gameSpeed: 1 }),
  migrations: {},
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
    // Version 4 keeps tools and the next chapter's entry. Before it every chapter started with the stamp.
    3: (data) => {
      if (!isRecord(data)) return data;
      const cp = data['checkpoint'];
      return { ...data, entry: null, checkpoint: isRecord(cp) ? { ...cp, tools: [...TOOLS] } : cp };
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
}

export const PROGRESS: SlotDef<ProgressData> = {
  name: 'progress',
  version: 2,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['handbook', 'hostName'],
    properties: {
      handbook: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
      // The schema cannot count characters; savedHost applies the full rules after loading.
      hostName: { type: 'string', minLength: 1 },
    },
  },
  defaults: () => ({ handbook: [], hostName: DEFAULT_HOST }),
  migrations: {
    // Version 2 keeps the host's name; before it the host was always 小晨.
    1: (data) => (isRecord(data) ? { ...data, hostName: DEFAULT_HOST } : data),
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

export const SLOTS = [SETTINGS, STORY, PROGRESS] as const;
