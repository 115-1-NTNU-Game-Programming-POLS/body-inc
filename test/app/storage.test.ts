import { describe, expect, it } from 'vitest';
import { corruptKey, issueMessage, SaveStore, type KeyValueStore } from '../../src/app/storage.ts';
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
    expect(mem.items.get(corruptKey('settings'))).toBe('{broken');
  });

  it('keeps corrupt text in place when its backup cannot be written', () => {
    const mem = new MemoryStore();
    mem.items.set(KEY, '{broken');
    mem.failWrites = new DOMException('no', 'QuotaExceededError');
    const saves = new SaveStore(mem);
    expect(saves.load(SETTINGS)).toEqual({ data: SETTINGS.defaults(), issues: [{ kind: 'corrupt', slot: 'settings', backedUp: false }], needsWrite: false });
    // The write that freed space must still not replace the only copy.
    mem.failWrites = null;
    expect(saves.save(SETTINGS, SETTINGS.defaults())).toEqual([]);
    expect(mem.items.get(KEY)).toBe('{broken');
  });

  it('keeps the corrupt backup of each slot separate', () => {
    const mem = new MemoryStore();
    const other = { ...SETTINGS, name: 'other' };
    mem.items.set(KEY, '{a');
    mem.items.set('hbc.v1.other', '{b');
    const saves = new SaveStore(mem);
    saves.load(SETTINGS);
    saves.load(other);
    expect([mem.items.get(corruptKey('settings')), mem.items.get(corruptKey('other'))]).toEqual(['{a', '{b']);
  });

  it('does not overwrite a slot it failed to read', () => {
    const mem = new MemoryStore();
    mem.items.set(KEY, encode(SETTINGS, { textScale: 1.25, gameSpeed: 0.8 }));
    mem.failReads = true;
    const saves = new SaveStore(mem);
    saves.load(SETTINGS);
    expect(saves.save(SETTINGS, SETTINGS.defaults())).toEqual([]);
    expect(JSON.parse(mem.items.get(KEY)!).data).toEqual({ textScale: 1.25, gameSpeed: 0.8 });
  });

  it('recognises a full store by legacy code or from another realm', () => {
    const mem = new MemoryStore();
    const saves = new SaveStore(mem);
    for (const err of [{ name: 'Error', code: 22 }, { name: 'NS_ERROR_DOM_QUOTA_REACHED', code: 1014 }, { name: 'QuotaExceededError' }]) {
      mem.failWrites = err as DOMException;
      expect(saves.save(SETTINGS, SETTINGS.defaults())[0], JSON.stringify(err)).toMatchObject({ reason: 'quota' });
    }
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
      { kind: 'write-failed', slot: 's', reason: 'blocked' }, { kind: 'corrupt', slot: 's', backedUp: true }, { kind: 'corrupt', slot: 's', backedUp: false }, { kind: 'newer', slot: 's', version: 2 },
    ] as const;
    for (const issue of kinds) expect(STRINGS.strings[issueMessage(issue)!], JSON.stringify(issue)).toBeDefined();
    expect(new Set(kinds.map(issueMessage)).size).toBe(kinds.length - 1); // read-failed shares unavailable's text
    expect(issueMessage({ kind: 'migrated', slot: 's', from: 1, to: 2 })).toBeUndefined();
  });
});
