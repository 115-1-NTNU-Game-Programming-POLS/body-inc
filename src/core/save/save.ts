import { validate, type Schema } from '../content/schema.ts';

/**
 * Versioned save slots (design doc 13.5, ux-spec section 8). Core only turns stored text into
 * data and back; reading and writing storage is the app's job, so every rule here runs in Node.
 *
 * A stored slot is `{ "schema": <version>, "data": <payload> }`. Loading an older version runs
 * the slot's migrations in order (migrations[v] turns version v into v + 1), then checks the
 * result against the current schema. A newer version than the game knows is never migrated or
 * overwritten blindly: it may come from a newer build in another tab.
 */
export interface SlotDef<T> {
  /** Storage key suffix, e.g. "settings" for hbc.v1.settings. */
  readonly name: string;
  readonly version: number;
  readonly schema: Schema;
  readonly defaults: () => T;
  /** migrations[v] upgrades a version-v payload to version v + 1, for every v below `version`. */
  readonly migrations: Readonly<Record<number, (data: unknown) => unknown>>;
}

export type Decoded<T> =
  | { readonly kind: 'empty'; readonly data: T }
  | { readonly kind: 'ok'; readonly data: T }
  | { readonly kind: 'migrated'; readonly data: T; readonly from: number }
  /** Not JSON, or not a save envelope; the raw text should be kept aside before it is replaced. */
  | { readonly kind: 'corrupt'; readonly data: T; readonly detail: string }
  /** Written by a newer build; the slot must not be overwritten. */
  | { readonly kind: 'newer'; readonly data: T; readonly from: number }
  /** A known version whose payload fails the schema after migration; treated like corrupt. */
  | { readonly kind: 'invalid'; readonly data: T; readonly from: number; readonly detail: string };

export class SaveDefinitionError extends Error {}

/** Throws if a version has no migration, so a schema bump without one fails in tests, not for players. */
export function checkSlotDef<T>(def: SlotDef<T>): void {
  for (let v = 1; v < def.version; v++) {
    if (!def.migrations[v]) throw new SaveDefinitionError(`${def.name}: no migration from version ${v} to ${v + 1}`);
  }
  const problems = validate(def.schema, def.defaults());
  if (problems.length > 0) throw new SaveDefinitionError(`${def.name}: defaults do not match the schema`);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function decode<T>(def: SlotDef<T>, text: string | null): Decoded<T> {
  if (text === null) return { kind: 'empty', data: def.defaults() };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { kind: 'corrupt', data: def.defaults(), detail: (e as Error).message };
  }
  if (!isRecord(raw) || !Number.isInteger(raw['schema']) || (raw['schema'] as number) < 1 || !('data' in raw)) {
    return { kind: 'corrupt', data: def.defaults(), detail: 'not a { schema, data } envelope' };
  }
  const from = raw['schema'] as number;
  if (from > def.version) return { kind: 'newer', data: def.defaults(), from };

  let data = raw['data'];
  try {
    for (let v = from; v < def.version; v++) data = def.migrations[v]!(data);
  } catch (e) {
    return { kind: 'invalid', data: def.defaults(), from, detail: `migration failed: ${(e as Error).message}` };
  }
  const problems = validate(def.schema, data);
  if (problems.length > 0) {
    return { kind: 'invalid', data: def.defaults(), from, detail: `${problems[0]!.path || '(root)'}: ${problems[0]!.code}` };
  }
  return from === def.version ? { kind: 'ok', data: data as T } : { kind: 'migrated', data: data as T, from };
}

export function encode<T>(def: SlotDef<T>, data: T): string {
  return JSON.stringify({ schema: def.version, data });
}
