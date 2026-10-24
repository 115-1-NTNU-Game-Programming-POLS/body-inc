import { decode, encode, type SlotDef } from '../core/save/save.ts';

/**
 * localStorage adapter for core save slots (ux-spec section 8). Storage can be missing (private
 * modes, blocked site data), full, or hold text a broken build wrote; none of that may crash
 * the game. Every failure comes back as an issue the HUD can show, and every slot is read and
 * written on its own so one bad slot never costs the others.
 */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const KEY_PREFIX = 'hbc.v1.';
/** Where unreadable save text is kept before defaults replace it, so it can still be recovered. */
export const CORRUPT_KEY = `${KEY_PREFIX}corrupt`;

export type SaveIssue =
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'read-failed'; readonly slot: string }
  | { readonly kind: 'write-failed'; readonly slot: string; readonly reason: 'quota' | 'blocked' }
  | { readonly kind: 'corrupt'; readonly slot: string; readonly backedUp: boolean }
  | { readonly kind: 'newer'; readonly slot: string; readonly version: number }
  | { readonly kind: 'migrated'; readonly slot: string; readonly from: number; readonly to: number };

/** String key of the notice for an issue; migrations are silent. */
export function issueMessage(issue: SaveIssue): string | undefined {
  switch (issue.kind) {
    case 'unavailable': return 'save.unavailable';
    case 'read-failed': return 'save.unavailable';
    case 'write-failed': return issue.reason === 'quota' ? 'save.write_quota' : 'save.write_blocked';
    case 'corrupt': return 'save.corrupt';
    case 'newer': return 'save.newer';
    case 'migrated': return undefined;
  }
}

const isQuota = (e: unknown): boolean =>
  e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');

export interface Loaded<T> {
  readonly data: T;
  readonly issues: readonly SaveIssue[];
  /** True when the slot should be written now: it was empty, migrated, or replaced after corruption. */
  readonly needsWrite: boolean;
}

export class SaveStore {
  private readonly store: KeyValueStore | null;
  /** Slots holding a newer build's save; writing them would destroy it. */
  private readonly locked = new Set<string>();

  constructor(store: KeyValueStore | null) {
    this.store = store;
  }

  load<T>(def: SlotDef<T>): Loaded<T> {
    if (!this.store) return { data: def.defaults(), issues: [{ kind: 'unavailable' }], needsWrite: false };
    const key = KEY_PREFIX + def.name;
    let text: string | null;
    try {
      text = this.store.getItem(key);
    } catch {
      return { data: def.defaults(), issues: [{ kind: 'read-failed', slot: def.name }], needsWrite: false };
    }
    const d = decode(def, text);
    switch (d.kind) {
      case 'ok': return { data: d.data, issues: [], needsWrite: false };
      case 'empty': return { data: d.data, issues: [], needsWrite: true };
      case 'migrated': return { data: d.data, issues: [{ kind: 'migrated', slot: def.name, from: d.from, to: def.version }], needsWrite: true };
      case 'newer':
        this.locked.add(def.name);
        return { data: d.data, issues: [{ kind: 'newer', slot: def.name, version: d.from }], needsWrite: false };
      case 'corrupt':
      case 'invalid': {
        const backedUp = this.write(CORRUPT_KEY, JSON.stringify({ slot: def.name, text })) === undefined;
        return { data: d.data, issues: [{ kind: 'corrupt', slot: def.name, backedUp }], needsWrite: true };
      }
    }
  }

  /** Writes a slot; returns the issues instead of throwing. */
  save<T>(def: SlotDef<T>, data: T): SaveIssue[] {
    if (!this.store) return [{ kind: 'unavailable' }];
    if (this.locked.has(def.name)) return [];
    const reason = this.write(KEY_PREFIX + def.name, encode(def, data));
    return reason ? [{ kind: 'write-failed', slot: def.name, reason }] : [];
  }

  private write(key: string, value: string): 'quota' | 'blocked' | undefined {
    try {
      this.store!.setItem(key, value);
      return undefined;
    } catch (e) {
      return isQuota(e) ? 'quota' : 'blocked';
    }
  }
}

/**
 * window.localStorage, or null when the browser refuses access (reading the property itself
 * throws when site data is blocked). Dev builds accept `?storage=blocked` or `?storage=full`
 * to simulate failing writes, since a normal browser profile never fails.
 */
export function browserStore(win: Window): KeyValueStore | null {
  let store: KeyValueStore;
  try {
    store = win.localStorage;
  } catch {
    return null;
  }
  const mode = import.meta.env.DEV ? new URLSearchParams(win.location.search).get('storage') : null;
  if (mode !== 'blocked' && mode !== 'full') return store;
  const error = mode === 'full' ? new DOMException('simulated', 'QuotaExceededError') : new DOMException('simulated', 'SecurityError');
  return {
    getItem: (k) => store.getItem(k),
    removeItem: (k) => store.removeItem(k),
    setItem: () => { throw error; },
  };
}
