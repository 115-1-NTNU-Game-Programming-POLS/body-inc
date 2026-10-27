import { describe, expect, it } from 'vitest';
import { keepHost } from '../../src/app/host.ts';
import { SaveStore, type KeyValueStore } from '../../src/app/storage.ts';
import {
  checkSlotDef, decode, DEFAULT_HOST, encode, fillHost, graphemes, HOST_MAX, HOST_WORST, PROGRESS, readHostName, savedHost,
} from '../../src/core/index.ts';

describe('host name rules (issue #8)', () => {
  it('trims both ends and keeps a name of 1 to 6 characters', () => {
    expect(readHostName('  阿明 ')).toEqual({ ok: true, name: '阿明' });
    expect(readHostName('六個全形寬字')).toEqual({ ok: true, name: '六個全形寬字' });
    expect(readHostName('七個全形寬的字')).toEqual({ ok: false, problem: 'too-long' });
    expect(readHostName('A')).toEqual({ ok: true, name: 'A' });
  });

  it('refuses a name that is empty after trimming', () => {
    expect(readHostName('')).toEqual({ ok: false, problem: 'empty' });
    expect(readHostName(' 　 ')).toEqual({ ok: false, problem: 'empty' });
  });

  it('counts a character made of a surrogate pair as one', () => {
    // 𠮷 (U+20BB7) is two UTF-16 code units, so string.length would count 12 here.
    const six = '𠮷'.repeat(6);
    expect(six.length).toBe(12);
    expect(graphemes(six)).toBe(6);
    expect(readHostName(six)).toEqual({ ok: true, name: six });
    expect(readHostName(six + '𠮷')).toEqual({ ok: false, problem: 'too-long' });
  });

  it('refuses braces, angle brackets and control or format characters', () => {
    for (const bad of ['阿{明', '阿}', '<b>', '阿\n明', '阿\u0007', '阿​明', '阿 明', '阿 明'])expect(readHostName(bad)).toEqual({ ok: false, problem: 'bad-char' });
  });

  it('normalizes to NFC, so a decomposed accent counts and is kept as one character', () => {
    const decomposed = 'José';
    const read = readHostName(decomposed);
    expect(read).toEqual({ ok: true, name: 'José' });
    expect(read.ok && read.name.length).toBe(4);
  });

  it('the worst-case name is the longest allowed', () => {
    expect(graphemes(HOST_WORST)).toBe(HOST_MAX);
    expect(readHostName(HOST_WORST).ok).toBe(true);
  });

  it('fillHost replaces every {host} and leaves other text alone', () => {
    expect(fillHost('{host}說：{host}要睡了', '阿明')).toBe('阿明說：阿明要睡了');
    expect(fillHost('殘留 {residue}', '阿明')).toBe('殘留 {residue}');
    expect(fillHost('{hosts}', '阿明')).toBe('{hosts}');
  });
});

describe('the host name in the progress slot', () => {
  it('the slot definition has a migration for every version', () => {
    expect(() => checkSlotDef(PROGRESS)).not.toThrow();
  });

  it('a version-1 save from before the name existed loads with 小晨 and its pages', () => {
    const v1 = JSON.stringify({ schema: 1, data: { handbook: ['caffeine'] } });
    expect(decode(PROGRESS, v1)).toEqual({ kind: 'migrated', from: 1, data: { handbook: ['caffeine'], hostName: DEFAULT_HOST } });
  });

  it('round-trips a chosen name; a fresh save starts as 小晨', () => {
    expect(decode(PROGRESS, encode(PROGRESS, { handbook: [], hostName: '阿明' }))).toEqual({ kind: 'ok', data: { handbook: [], hostName: '阿明' } });
    expect(decode(PROGRESS, null).data.hostName).toBe(DEFAULT_HOST);
  });

  it('a saved name the rules refuse falls back to the default', () => {
    expect(savedHost({ handbook: [], hostName: '阿明' })).toBe('阿明');
    expect(savedHost({ handbook: [], hostName: '七個全形寬的字' })).toBe(DEFAULT_HOST);
    expect(savedHost({ handbook: [], hostName: '{host}' })).toBe(DEFAULT_HOST);
    // Untrimmed text was never written by the game, so it is not trusted either.
    expect(savedHost({ handbook: [], hostName: ' 阿明' })).toBe(DEFAULT_HOST);
  });

  it('keepHost writes at once and keeps the handbook pages', () => {
    const data = new Map<string, string>();
    const store: KeyValueStore = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
    const kept = keepHost(new SaveStore(store), { handbook: ['caffeine'], hostName: DEFAULT_HOST }, '阿明');
    expect(kept).toEqual({ progress: { handbook: ['caffeine'], hostName: '阿明' }, issues: [] });
    expect(decode(PROGRESS, data.get('hbc.v1.progress') ?? null)).toEqual({ kind: 'ok', data: { handbook: ['caffeine'], hostName: '阿明' } });
    data.clear();
    expect(keepHost(new SaveStore(store), kept.progress, '阿明').progress).toBe(kept.progress);
    expect(data.size).toBe(0);
  });
});
