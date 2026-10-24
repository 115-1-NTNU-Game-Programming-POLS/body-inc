import { describe, expect, it } from 'vitest';
import { CORRUPT_KEY, issueMessage, SaveStore, type KeyValueStore } from '../../src/app/storage.ts';
import { encode, SETTINGS } from '../../src/core/index.ts';
import { STRINGS } from '../../src/app/content.ts';

class MemoryStore implements KeyValueStore {
  readonly items = new Map<string, string>();
  failWrites: DOMException | null = null;
  failReads = false;
  getItem(k: string): string | null {
    if (this.failReads) throw new DOMException('denied', 'SecurityError');
    return this.items.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    if (this.failWrites) throw this.failWrites;
    this.items.set(k, v);
  }
  removeItem(k: string): void {
    this.items.delete(k);
  }
}

const KEY = 'hbc.v1.settings';

describe('SaveStore', () => {
  it('asks for a first write when the slot is empty, then reads it back', () => {
    const mem = new MemoryStore();
    const saves = new SaveStore(mem);
    const first = saves.load(SETTINGS);
    expect(first).toEqual({ data: SETTINGS.defaults(), issues: [], needsWrite: true });
    expect(saves.save(SETTINGS, { textScale: 1.25, gameSpeed: 0.8 })).toEqual([]);
    expect(new SaveStore(mem).load(SETTINGS)).toEqual({ data: { textScale: 1.25, gameSpeed: 0.8 }, issues: [], needsWrite: false });
  });

  it('reports a blocked or full storage instead of throwing', () => {
    const mem = new MemoryStore();
    const saves = new SaveStore(mem);
    mem.failWrites = new DOMException('no', 'SecurityError');
    expect(saves.save(SETTINGS, SETTINGS.defaults())).toEqual([{ kind: 'write-failed', slot: 'settings', reason: 'blocked' }]);
    mem.failWrites = new DOMException('no', 'QuotaExceededError');
    expect(saves.save(SETTINGS, SETTINGS.defaults())).toEqual([{ kind: 'write-failed', slot: 'settings', reason: 'quota' }]);
  });

  it('reports missing storage and failing reads', () => {
    const none = new SaveStore(null);
    expect(none.load(SETTINGS).issues).toEqual([{ kind: 'unavailable' }]);
    expect(none.save(SETTINGS, SETTINGS.defaults())).toEqual([{ kind: 'unavailable' }]);
    const mem = new MemoryStore();
    mem.failReads = true;
    expect(new SaveStore(mem).load(SETTINGS)).toEqual({ data: SETTINGS.defaults(), issues: [{ kind: 'read-failed', slot: 'settings' }], needsWrite: false });
  });

  it('backs up corrupt text before defaults replace it', () => {
    const mem = new MemoryStore();
    mem.items.set(KEY, '{broken');
    const loaded = new SaveStore(mem).load(SETTINGS);
    expect(loaded).toEqual({ data: SETTINGS.defaults(), issues: [{ kind: 'corrupt', slot: 'settings', backedUp: true }], needsWrite: true });
    expect(JSON.parse(mem.items.get(CORRUPT_KEY)!)).toEqual({ slot: 'settings', text: '{broken' });
  });

  it('says so when the corrupt backup itself cannot be written', () => {
    const mem = new MemoryStore();
    mem.items.set(KEY, '{broken');
    mem.failWrites = new DOMException('no', 'SecurityError');
    expect(new SaveStore(mem).load(SETTINGS).issues).toEqual([{ kind: 'corrupt', slot: 'settings', backedUp: false }]);
  });

  it('never overwrites a save from a newer build', () => {
    const mem = new MemoryStore();
    const future = JSON.stringify({ schema: 99, data: { whatever: 1 } });
    mem.items.set(KEY, future);
    const saves = new SaveStore(mem);
    expect(saves.load(SETTINGS)).toEqual({ data: SETTINGS.defaults(), issues: [{ kind: 'newer', slot: 'settings', version: 99 }], needsWrite: false });
    expect(saves.save(SETTINGS, SETTINGS.defaults())).toEqual([]);
    expect(mem.items.get(KEY)).toBe(future);
  });

  it('asks to write back a migrated slot', () => {
    const mem = new MemoryStore();
    const v2 = { ...SETTINGS, version: 2, migrations: { 1: (d: unknown) => d } };
    mem.items.set(KEY, encode(SETTINGS, { textScale: 1.25, gameSpeed: 1 }));
    expect(new SaveStore(mem).load(v2)).toEqual({
      data: { textScale: 1.25, gameSpeed: 1 }, issues: [{ kind: 'migrated', slot: 'settings', from: 1, to: 2 }], needsWrite: true,
    });
  });

  it('every visible issue has a string', () => {
    const kinds = [
      { kind: 'unavailable' }, { kind: 'read-failed', slot: 's' }, { kind: 'write-failed', slot: 's', reason: 'quota' },
      { kind: 'write-failed', slot: 's', reason: 'blocked' }, { kind: 'corrupt', slot: 's', backedUp: true }, { kind: 'newer', slot: 's', version: 2 },
    ] as const;
    for (const issue of kinds) expect(STRINGS.strings[issueMessage(issue)!], issue.kind).toBeDefined();
    expect(issueMessage({ kind: 'migrated', slot: 's', from: 1, to: 2 })).toBeUndefined();
  });
});
