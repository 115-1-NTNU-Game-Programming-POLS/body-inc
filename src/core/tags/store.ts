import { addCauses, CausalError, EMPTY_LOG, record, type CausalLog } from './causal.ts';
import { evaluateCondition, type Condition } from './condition.ts';
import type { TagDef, TagDictionary } from './dictionary.ts';

/**
 * Current tag values plus the causal log that explains them. A tag is present only while it
 * is on (true, or a number above 0); turning it off ends that episode, and turning it on again
 * starts a new log entry so old causes are not blamed for a new episode.
 *
 * Numeric tags never go below 0: every tag in the dictionary is an amount (hours, cups, residual).
 */
export interface TagEntry {
  readonly value: number | true;
  /** The causal log entry for this episode of the tag. */
  readonly node: number;
  /** Rule minute at which an `hours` tag ends. */
  readonly until?: number;
  /** Wake-ups left for `untilWake` (1) and `nextDay` (2) tags. */
  readonly wakesLeft?: number;
}

export interface TagState {
  readonly values: Readonly<Record<string, TagEntry>>;
  readonly log: CausalLog;
}

export const EMPTY_TAGS: TagState = { values: {}, log: EMPTY_LOG };

export class TagError extends Error {}

function def(dict: TagDictionary, name: string): TagDef {
  const d = dict.tags.get(name);
  if (!d) throw new TagError(`"${name}" is not in the tag dictionary`);
  return d;
}

function expiry(d: TagDef, at: number): Pick<TagEntry, 'until' | 'wakesLeft'> {
  switch (d.duration.kind) {
    case 'hours': return { until: at + Math.round(d.duration.hours * 60) };
    case 'untilWake': return { wakesLeft: 1 };
    case 'nextDay': return { wakesLeft: 2 };
    case 'persistent': return {};
  }
}

function put(state: TagState, d: TagDef, value: number | boolean, source: number, at: number): TagState {
  if (!Number.isInteger(source) || !state.log.nodes[source]) {
    throw new CausalError(`change to "${d.name}" has no source entry (got ${String(source)})`);
  }
  const old = state.values[d.name];
  const on = value === true || (typeof value === 'number' && value > 0);
  const values = { ...state.values };
  if (!on) {
    delete values[d.name];
    return { ...state, values };
  }
  // A flag set again by a new source gains that cause and restarts its duration.
  const rising = !old || value === true || (typeof value === 'number' && typeof old.value === 'number' && value > old.value);
  let log = state.log;
  let node: number;
  if (old) {
    node = old.node;
    // Only an increase explains the tag; repaying sleep debt is not a cause of sleep debt.
    if (rising) log = addCauses(log, node, [source], at);
  } else {
    [log, node] = record(log, { kind: 'tag', key: d.name, at, causes: [source] });
  }
  const timing = rising || !old ? expiry(d, at) : { until: old.until, wakesLeft: old.wakesLeft };
  values[d.name] = {
    value: value === true ? true : (value as number),
    node,
    ...(timing.until !== undefined ? { until: timing.until } : {}),
    ...(timing.wakesLeft !== undefined ? { wakesLeft: timing.wakesLeft } : {}),
  };
  return { values, log };
}

/** Sets a boolean tag on or off. `source` is a causal log entry id; a missing one throws. */
export function setFlag(state: TagState, dict: TagDictionary, name: string, on: boolean, source: number, at: number): TagState {
  const d = def(dict, name);
  if (d.type !== 'boolean') throw new TagError(`"${name}" is a number tag; use setAmount or addAmount`);
  return put(state, d, on, source, at);
}

export function setAmount(state: TagState, dict: TagDictionary, name: string, value: number, source: number, at: number): TagState {
  const d = def(dict, name);
  if (d.type !== 'number') throw new TagError(`"${name}" is a boolean tag; use setFlag`);
  if (!Number.isFinite(value)) throw new TagError(`"${name}" cannot be set to ${value}`);
  return put(state, d, Math.max(0, value), source, at);
}

export function addAmount(state: TagState, dict: TagDictionary, name: string, delta: number, source: number, at: number): TagState {
  return setAmount(state, dict, name, amount(state, dict, name) + delta, source, at);
}

export function amount(state: TagState, dict: TagDictionary, name: string): number {
  if (def(dict, name).type !== 'number') throw new TagError(`"${name}" is a boolean tag`);
  const e = state.values[name];
  return typeof e?.value === 'number' ? e.value : 0;
}

export function flag(state: TagState, dict: TagDictionary, name: string): boolean {
  if (def(dict, name).type !== 'boolean') throw new TagError(`"${name}" is a number tag`);
  return state.values[name] !== undefined;
}

/** Ends `hours` tags whose time is up. Expiry follows the dictionary, so it needs no source. */
export function expireTags(state: TagState, now: number): TagState {
  const kept = Object.entries(state.values).filter(([, e]) => e.until === undefined || e.until > now);
  return kept.length === Object.keys(state.values).length ? state : { ...state, values: Object.fromEntries(kept) };
}

/** Called once per wake-up: `untilWake` tags end, `nextDay` tags move to their last day. */
export function onWake(state: TagState): TagState {
  const values: Record<string, TagEntry> = {};
  for (const [k, e] of Object.entries(state.values)) {
    if (e.wakesLeft === undefined) values[k] = e;
    else if (e.wakesLeft > 1) values[k] = { ...e, wakesLeft: e.wakesLeft - 1 };
  }
  return { ...state, values };
}

export function holds(state: TagState, dict: TagDictionary, cond: Condition): boolean {
  return evaluateCondition(
    cond,
    (n) => state.values[n]?.value ?? (dict.tags.get(n)?.type === 'number' ? 0 : false),
    (n) => dict.aliases.get(n)?.condition,
  );
}
