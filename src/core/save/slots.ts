import type { RuleClock } from '../clock.ts';
import type { TagState } from '../tags/store.ts';
import type { Schema } from '../content/schema.ts';
import type { SlotDef } from './save.ts';

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
}

export interface StoryData {
  readonly checkpoint: Checkpoint | null;
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

const CHECKPOINT: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['chapter', 'roomId', 'x', 'y', 'tags', 'clock', 'fired'],
  properties: {
    chapter: { type: 'string', minLength: 1 },
    roomId: { type: 'string', minLength: 1 },
    x: { type: 'number' },
    y: { type: 'number' },
    tags: {
      type: 'object',
      additionalProperties: false,
      required: ['values', 'log'],
      properties: {
        values: { type: 'object', additionalProperties: TAG_ENTRY },
        log: { type: 'object', additionalProperties: false, required: ['nodes'], properties: { nodes: { type: 'array', items: CAUSAL_NODE } } },
      },
    },
    clock: { type: 'object', additionalProperties: false, required: ['day', 'minute'], properties: { day: { type: 'integer', minimum: 1 }, minute: INT } },
    fired: { type: 'array', items: STR },
  },
};

/** Story progress: the checkpoint of the chapter being played, or none before the first punch. */
export const STORY: SlotDef<StoryData> = {
  name: 'story',
  version: 1,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['checkpoint'],
    properties: { checkpoint: { anyOf: [{ type: 'null' }, CHECKPOINT] } },
  },
  defaults: () => ({ checkpoint: null }),
  migrations: {},
};

export const SLOTS = [SETTINGS, STORY] as const;
