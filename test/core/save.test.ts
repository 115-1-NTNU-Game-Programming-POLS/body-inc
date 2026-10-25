import { describe, expect, it } from 'vitest';
import { checkSlotDef, decode, encode, SaveDefinitionError, SETTINGS, SLOTS, type SlotDef } from '../../src/core/index.ts';

interface V3 {
  readonly name: string;
  readonly volume: number;
  readonly muted: boolean;
}

// v1 { vol: 0..10 }, v2 { volume: 0..1 }, v3 adds name and muted.
const DEMO: SlotDef<V3> = {
  name: 'demo',
  version: 3,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'volume', 'muted'],
    properties: { name: { type: 'string' }, volume: { type: 'number', minimum: 0, maximum: 1 }, muted: { type: 'boolean' } },
  },
  defaults: () => ({ name: 'default', volume: 1, muted: false }),
  migrations: {
    1: (d) => ({ volume: (d as { vol: number }).vol / 10 }),
    2: (d) => ({ name: 'migrated', ...(d as object), muted: false }),
  },
};

const stored = (schema: number, data: unknown): string => JSON.stringify({ schema, data });

describe('save slots', () => {
  it('migrates an old version through every step in order', () => {
    expect(decode(DEMO, stored(1, { vol: 5 }))).toEqual({ kind: 'migrated', from: 1, data: { name: 'migrated', volume: 0.5, muted: false } });
    expect(decode(DEMO, stored(2, { volume: 0.3 }))).toEqual({ kind: 'migrated', from: 2, data: { name: 'migrated', volume: 0.3, muted: false } });
  });

  it('reads the current version as is and round-trips encode', () => {
    const data = { name: 'x', volume: 0.2, muted: true };
    expect(decode(DEMO, encode(DEMO, data))).toEqual({ kind: 'ok', data });
  });

  it('gives defaults for an empty slot', () => {
    expect(decode(DEMO, null)).toEqual({ kind: 'empty', data: DEMO.defaults() });
  });

  it('marks unreadable text and non-envelopes as corrupt', () => {
    for (const text of ['{oops', '[]', '{"data":{}}', '{"schema":0,"data":{}}', '{"schema":1.5,"data":{}}', '{"schema":2}']) {
      expect(decode(DEMO, text).kind, text).toBe('corrupt');
    }
  });

  it('refuses a newer version without touching it', () => {
    expect(decode(DEMO, stored(4, { anything: true }))).toEqual({ kind: 'newer', from: 4, data: DEMO.defaults() });
  });

  it('marks a payload that fails the schema, or a throwing migration, as invalid', () => {
    const bad = decode(DEMO, stored(3, { name: 'x', volume: 2, muted: false }));
    expect(bad.kind).toBe('invalid');
    expect(bad.data).toEqual(DEMO.defaults());
    expect(decode(DEMO, stored(1, null)).kind).toBe('invalid');
  });

  it('checkSlotDef catches a missing migration and bad defaults', () => {
    expect(() => checkSlotDef(DEMO)).not.toThrow();
    expect(() => checkSlotDef({ ...DEMO, migrations: { 1: DEMO.migrations[1]! } })).toThrow(/from version 2 to 3/);
    expect(() => checkSlotDef({ ...DEMO, migrations: { 2: DEMO.migrations[2]! } })).toThrow(SaveDefinitionError);
    expect(() => checkSlotDef({ ...DEMO, defaults: () => ({ name: 'x', volume: 5, muted: false }) })).toThrow(/defaults/);
  });

  it('every shipped slot is well defined', () => {
    for (const slot of SLOTS as readonly SlotDef<unknown>[]) expect(() => checkSlotDef(slot)).not.toThrow();
    expect(decode(SETTINGS, stored(1, { textScale: 1.25, gameSpeed: 0.8 })).kind).toBe('ok');
    expect(decode(SETTINGS, stored(1, { textScale: 2, gameSpeed: 1 })).kind).toBe('invalid');
  });
});
