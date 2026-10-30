import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  addAmount, addCauses, amount, advance, CausalError, compileCondition, DictionaryError, drawFloat, EMPTY_LOG, EMPTY_TAGS,
  expireTags, flag, holds, hourOf, loadDictionary, onWake, record, seedStreams, setAmount, setFlag, sleepUntil, startClock,
  TagError, trace, type TagState,
} from '../../src/core/index.ts';

const RAW = JSON.parse(readFileSync('content/tags.json', 'utf8'));
const dict = loadDictionary(RAW);

/** Records a source entry (a card, an event) and returns the state and its id. */
function source(s: TagState, key: string, at: number): [TagState, number] {
  const [log, id] = record(s.log, { kind: 'card', key, at });
  return [{ ...s, log }, id];
}

describe('tag dictionary', () => {
  it('loads content/tags.json with every tag of design doc 13.4', () => {
    for (const n of ['sleep_debt', 'caffeine', 'alcohol', 'fasting', 'core_dump', 'comparison']) expect(dict.tags.has(n)).toBe(true);
    expect(dict.aliases.get('mod.caffeine_cloak')?.condition.text).toBe('caffeine>=25');
  });

  const broken = (patch: (raw: typeof RAW) => void): string[] => {
    const raw = structuredClone(RAW);
    patch(raw);
    try {
      loadDictionary(raw);
      return [];
    } catch (e) {
      if (e instanceof DictionaryError) return [...e.problems];
      throw e;
    }
  };

  it('rejects a modifier that uses an undefined tag', () => {
    const p = broken((r) => r.modifiers.push({ name: 'mod.x', when: 'sleepy>1', facts: [] }));
    expect(p).toEqual(['modifier "mod.x": unknown-tag "sleepy>1"']);
  });

  it('rejects a modifier that refers to another modifier', () => {
    expect(broken((r) => r.modifiers.push({ name: 'mod.x', when: 'mod.caffeine_cloak', facts: [] }))[0]).toContain('unknown-tag');
  });

  it('reads a fade per hour for number tags and refuses it on a boolean tag', () => {
    expect(dict.tags.get('memory_desk')?.fadePerHour).toBe(0.05);
    expect(dict.tags.get('caffeine')?.fadePerHour).toBeUndefined();
    expect(broken((r) => (r.tags.find((t: { name: string }) => t.name === 'deadline').fadePerHour = 0.1))[0]).toContain('fadePerHour is only for number tags');
  });

  it('rejects unknown fields, duplicates, bad types and a missing hours span', () => {
    expect(broken((r) => (r.tags[0].colour = 'red'))).toEqual(['tags[0].colour: unknown field "colour"']);
    expect(broken((r) => r.tags.push({ ...r.tags[0] }))).toEqual(['tag "sleep_debt": defined twice']);
    expect(broken((r) => (r.tags[0].type = 'int'))).toEqual(['tags[0].type: enum "number", "boolean", got "int"']);
    expect(broken((r) => delete r.tags.find((t: { name: string }) => t.name === 'sugar_fatigue').hours)[0]).toContain('hours is required');
  });
});

describe('causal log (design doc 13.5)', () => {
  it('a derived entry without a source throws', () => {
    expect(() => record(EMPTY_LOG, { kind: 'tag', key: 'sleep_debt', at: 0 })).toThrow(CausalError);
    expect(() => record(EMPTY_LOG, { kind: 'effect', key: 'insomnia', at: 0, causes: [] })).toThrow(/no source/);
    expect(() => record(EMPTY_LOG, { kind: 'tag', key: 'sleep_debt', at: 0, causes: [5] })).toThrow(/does not exist/);
  });

  it('an entry without a key or a valid timestamp throws', () => {
    expect(() => record(EMPTY_LOG, { kind: 'card', key: '', at: 0 })).toThrow(/no key/);
    expect(() => record(EMPTY_LOG, { kind: 'card', key: 'coffee', at: 1.5 })).toThrow(/integer minute/);
    expect(() => record(EMPTY_LOG, { kind: 'card', key: 'coffee', at: Number.NaN })).toThrow(/integer minute/);
  });

  it('a cause cannot come after its effect', () => {
    const [log, late] = record(EMPTY_LOG, { kind: 'card', key: 'coffee', at: 900 });
    expect(() => record(log, { kind: 'effect', key: 'insomnia', at: 600, causes: [late] })).toThrow(/after the effect/);
  });

  it('tracing ignores causes added after the traced entry', () => {
    let log = EMPTY_LOG;
    let stayUp: number, tag: number, coffee: number, crisis: number, later: number;
    [log, stayUp] = record(log, { kind: 'activity', key: 'stayed_up', at: 100 });
    [log, tag] = record(log, { kind: 'tag', key: 'sleep_debt', at: 100, causes: [stayUp] });
    [log, coffee] = record(log, { kind: 'card', key: 'coffee', at: 150 });
    log = addCauses(log, tag, [coffee], 150);
    [log, crisis] = record(log, { kind: 'crisis', key: 'forced_nap', at: 200, causes: [tag] });
    [log, later] = record(log, { kind: 'event', key: 'all_nighter', at: 300 });
    log = addCauses(log, tag, [later], 300);
    expect(trace(log, crisis).map((n) => n.key)).toEqual(['stayed_up', 'sleep_debt', 'coffee', 'forced_nap']);
    expect(trace(log, crisis).map((n) => n.id)).not.toContain(later);
  });
});

describe('tag store', () => {
  it('a change without a source entry throws', () => {
    expect(() => setFlag(EMPTY_TAGS, dict, 'breakfast', true, 0, 0)).toThrow(CausalError);
    expect(() => addAmount(EMPTY_TAGS, dict, 'sleep_debt', 2, undefined as unknown as number, 0)).toThrow(/no source/);
  });

  it('rejects an undefined tag and the wrong type', () => {
    const [s, src] = source(EMPTY_TAGS, 'card.coffee', 0);
    expect(() => setFlag(s, dict, 'sleepy', true, src, 0)).toThrow(TagError);
    expect(() => setFlag(s, dict, 'sleep_debt', true, src, 0)).toThrow(/number tag/);
    expect(() => setAmount(s, dict, 'fasting', 1, src, 0)).toThrow(/boolean tag/);
  });

  it('causes accumulate instead of freezing at creation, and decreases add none', () => {
    let s = EMPTY_TAGS;
    let a: number, b: number, c: number;
    [s, a] = source(s, 'card.bed_0200', 60);
    s = addAmount(s, dict, 'sleep_debt', 3, a, 60);
    [s, b] = source(s, 'card.coffee_late', 120);
    s = addAmount(s, dict, 'sleep_debt', 1, b, 120);
    [s, c] = source(s, 'activity.nap', 180);
    s = addAmount(s, dict, 'sleep_debt', -1, c, 180);
    expect(amount(s, dict, 'sleep_debt')).toBe(3);
    const node = s.log.nodes[s.values['sleep_debt']!.node]!;
    expect(node.causes).toEqual([{ node: a, at: 60 }, { node: b, at: 120 }]);
  });

  it('numbers stop at 0 and a tag turned off and on again is a new episode', () => {
    let s = EMPTY_TAGS;
    let a: number;
    [s, a] = source(s, 'card.drink', 0);
    s = addAmount(s, dict, 'alcohol', 2, a, 0);
    const first = s.values['alcohol']!.node;
    s = addAmount(s, dict, 'alcohol', -5, a, 10);
    expect(amount(s, dict, 'alcohol')).toBe(0);
    expect(s.values['alcohol']).toBeUndefined();
    s = addAmount(s, dict, 'alcohol', 1, a, 20);
    expect(s.values['alcohol']!.node).not.toBe(first);
  });

  it('durations: hours, untilWake and nextDay', () => {
    let s = EMPTY_TAGS;
    let a: number;
    [s, a] = source(s, 'card.bubble_tea', 600);
    s = setFlag(s, dict, 'sugar_fatigue', true, a, 600);
    s = setFlag(s, dict, 'breakfast', true, a, 600);
    s = setFlag(s, dict, 'core_dump', true, a, 600);
    expect(flag(expireTags(s, 600 + 119), dict, 'sugar_fatigue')).toBe(true);
    expect(flag(expireTags(s, 600 + 120), dict, 'sugar_fatigue')).toBe(false);
    const day2 = onWake(s);
    expect(flag(day2, dict, 'breakfast')).toBe(false);
    expect(flag(day2, dict, 'core_dump')).toBe(true);
    expect(flag(onWake(day2), dict, 'core_dump')).toBe(false);
  });

  it('holds() evaluates conditions and aliases against the store', () => {
    let s = EMPTY_TAGS;
    let a: number;
    [s, a] = source(s, 'event.department_bbq', 0);
    const locked = compileCondition(dict, 'mod.warehouse_locked');
    s = addAmount(s, dict, 'alcohol', 2, a, 0);
    expect(holds(s, dict, locked)).toBe(false);
    s = setFlag(s, dict, 'fasting', true, a, 0);
    expect(holds(s, dict, locked)).toBe(true);
  });
});

describe('rule clock', () => {
  it('staying up past midnight is still the same logical day', () => {
    const c = advance(startClock(1, 23), 120);
    expect(c.day).toBe(1);
    expect(hourOf(c)).toBe(1);
    const woke = sleepUntil(c, 7);
    expect(woke.day).toBe(2);
    expect(hourOf(woke)).toBe(7);
    expect(woke.minute - c.minute).toBe(6 * 60);
  });

  it('a forced nap advances one hour; time never runs backward', () => {
    const c = startClock(1, 20);
    expect(advance(c, 60).minute - c.minute).toBe(60);
    expect(() => advance(c, -1)).toThrow();
    expect(() => advance(c, 0.5)).toThrow();
  });
});

describe('rng streams', () => {
  it('drawing from one stream leaves the others untouched', () => {
    const s0 = seedStreams(42);
    const [, s1] = drawFloat(s0, 'enemies');
    expect(s1.events).toBe(s0.events);
    expect(s1.map).toBe(s0.map);
    expect(s1.enemies).not.toBe(s0.enemies);
  });

  it('streams differ from each other and between nearby seeds', () => {
    const a = seedStreams(1);
    const b = seedStreams(2);
    expect(new Set([a.map, a.events, a.enemies]).size).toBe(3);
    expect(a.events).not.toBe(b.events);
    expect(seedStreams(1)).toEqual(a);
  });
});
