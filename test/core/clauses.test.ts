import { describe, expect, it } from 'vitest';
import {
  BASE_CREDITS, CLAUSE_CREDIT_CAP, clauseFinMult, clauseProblem, creditsOf, DISRUPT_FROM, fixedHour, MAX_CLAUSE, playDay, runSemester, scenarioFor, SETTING_DAYS, SETTING_IDS, settingFor, settingHours, startSemester,
  summarize, unlockedAfter, validClause, withClause, type MorningPlan, type SemesterContext, type SemesterState, type Strategy,
} from '../../src/core/index.ts';
import { ARCHETYPES } from '../../sim/semester/archetypes.ts';
import { contextFor } from '../../sim/semester/scenario.ts';

const COURSES = ['algorithms', 'os', 'compiler', 'ta'];
const HEAVY = ['algorithms', 'os', 'database', 'compiler'];
const seeds = Array.from({ length: 60 }, (_, i) => i + 1);

const base = (seed: number, courses: readonly string[] = COURSES): SemesterContext => contextFor(0.5, seed, { courses });

/** Studies every hour the day leaves it: no rest hours and no coffee, so the hours a card takes are the hours study loses. */
const grinder: Strategy = {
  ...ARCHETYPES.balanced,
  plan: (): MorningPlan => ({ coffee: [], rest: [] }),
};

describe('the overtime clauses (design doc 8.3)', () => {
  it('has the three levels the presentation builds, and refuses any other', () => {
    expect([-1, 0, 1, 2, 3, 1.5].map((l) => validClause(l))).toEqual([false, true, true, true, false, false]);
    expect(MAX_CLAUSE).toBe(2);
    expect(() => withClause(base(1), 1, 3)).toThrow(RangeError);
    expect(() => withClause(base(1), 1, 0.5)).toThrow(RangeError);
  });

  it('raises the final threshold from level 1 and keeps it there at level 2', () => {
    expect([0, 1, 2].map(clauseFinMult)).toEqual([1, 1.1, 1.1]);
    expect(withClause(base(1), 1, 0).finMult).toBeUndefined();
    expect(withClause(base(1), 1, 1).finMult).toBeCloseTo(1.1, 12);
    expect(withClause(base(1), 1, 2).finMult).toBeCloseTo(1.1, 12);
  });

  it('leaves level 0 untouched and gives level 1 no setting card', () => {
    const ctx = base(3);
    expect(withClause(ctx, 3, 0)).toBe(ctx);
    const one = withClause(ctx, 3, 1);
    expect(one.clause).toBe(1);
    expect(one.setting).toBeUndefined();
    expect(one.scenario).toBe(ctx.scenario);
  });

  it('makes the final exam harder for the same days, and only the final', () => {
    const fin = (level: number, seed: number): { mid: number; fin: number } => {
      const ctx = withClause(base(seed), seed, level);
      const m = summarize(runSemester(ctx, ARCHETYPES.balanced, seed), ctx);
      return { mid: m.mid, fin: m.fin };
    };
    const rows = seeds.slice(0, 20).map((seed) => [fin(0, seed), fin(1, seed)] as const);
    for (const [a, b] of rows) {
      expect(b.mid).toBe(a.mid);
      expect(b.fin).toBeLessThanOrEqual(a.fin);
    }
    expect(rows.some(([a, b]) => b.fin < a.fin)).toBe(true);
  });
});

describe('the setting card (design doc 8.12)', () => {
  it('is drawn at level 2 for every seed and never below it', () => {
    expect(DISRUPT_FROM).toBe(2);
    for (const seed of seeds) {
      expect(withClause(base(seed), seed, 2).setting, `seed ${seed}`).toBeDefined();
      expect(withClause(base(seed), seed, 1).setting, `seed ${seed}`).toBeUndefined();
      expect(base(seed).setting).toBeUndefined();
    }
  });

  it('is fixed by the seed, and both cards come up across seeds', () => {
    const ids = seeds.map((seed) => withClause(base(seed), seed, 2).setting!.id);
    expect(seeds.map((seed) => withClause(base(seed), seed, 2).setting)).toEqual(seeds.map((seed) => withClause(base(seed), seed, 2).setting));
    expect(new Set(ids)).toEqual(new Set(SETTING_IDS));
  });

  it('does not move the events the seed deals', () => {
    for (const seed of seeds) {
      const ctx = withClause(base(seed), seed, 2);
      expect(ctx.scenario).toEqual(scenarioFor(seed));
    }
  });

  it('takes its hours from the params, on distinct days that are no exam day and carry no barbecue', () => {
    const k = base(1).params;
    for (const seed of seeds) {
      const ctx = withClause(base(seed), seed, 2);
      const { id, commitments } = ctx.setting!;
      const days = commitments.map((c) => c.day);
      expect(days, `seed ${seed}`).toHaveLength(SETTING_DAYS[id]);
      expect(new Set(days).size).toBe(days.length);
      expect([...days], 'sorted').toEqual([...days].sort((a, b) => a - b));
      for (const c of commitments) {
        expect(c.hours).toEqual(id === 'shifts' ? k.shiftHours : k.labHours);
        expect([k.midDay, k.finDay]).not.toContain(c.day);
        expect(ctx.scenario[c.day] ?? []).not.toContain('bbq');
        if (id === 'lab') expect(k.weekend).not.toContain(c.day);
      }
    }
  });

  it('takes fewer days when the pool runs short, and none when no day is left', () => {
    const k = base(1).params;
    const everyEvening = Object.fromEntries(Array.from({ length: k.days }, (_, i) => [i + 1, ['bbq']]));
    expect(settingFor(1, 2, k, everyEvening)?.commitments).toEqual([]);
    const oneFree = { ...everyEvening, 1: [] };
    for (let seed = 1; seed <= 20; seed++) {
      const got = settingFor(seed, 2, k, oneFree);
      expect(got!.commitments.length).toBeLessThanOrEqual(1);
    }
  });

  it('is read as no hours on a day it does not fall on', () => {
    const ctx = withClause(base(4), 4, 2);
    const fall = ctx.setting!.commitments.map((c) => c.day);
    expect(settingHours(ctx.setting, fall[0]!)).toEqual(ctx.setting!.commitments[0]!.hours);
    expect(settingHours(ctx.setting, 5)).toEqual([]);
    expect(settingHours(undefined, 1)).toEqual([]);
  });

  it('is spent as work whatever the plan says, so each of its free hours costs a study hour', () => {
    const k = base(1).params;
    for (const seed of seeds.slice(0, 12)) {
      // No events: a deadline's work hours take whatever hours are left, and the ones that do not fit the day are dropped, which would hide the card's own cost.
      const plain: SemesterContext = { ...base(seed), scenario: {} };
      const ctx = withClause(plain, seed, 2);
      const day = ctx.setting!.commitments[0]!.day;
      const from = (c: SemesterContext): SemesterState => ({ ...startSemester(c, seed), day });
      // Hours a class, a meal or a course already holds are not the card's to take.
      const taken = ctx.setting!.commitments[0]!.hours.filter((h) => h < k.bedMin && fixedHour(k, plain.courses, day, k.wake, false, h) === undefined).length;
      const without = playDay(from(plain), plain, grinder).history[0]!.studyHours;
      const with_ = playDay(from(ctx), ctx, grinder).history[0]!.studyHours;
      expect(without - with_, `seed ${seed} day ${day}`).toBe(taken);
      expect(taken).toBeGreaterThan(0);
    }
  });
});

describe('the clause and the burden together (design doc 9.6)', () => {
  it('lets level 2 stand only up to the credits the thresholds are tuned for', () => {
    expect(CLAUSE_CREDIT_CAP).toHaveLength(MAX_CLAUSE + 1);
    expect(CLAUSE_CREDIT_CAP[2]).toBe(BASE_CREDITS);
    expect(clauseProblem(2, BASE_CREDITS)).toBeUndefined();
    expect(clauseProblem(2, BASE_CREDITS + 1)).toBe('burden');
    expect(clauseProblem(1, 22)).toBeUndefined();
    expect(clauseProblem(0, 22)).toBeUndefined();
  });

  it('refuses to start a semester the clause does not stand with', () => {
    expect(creditsOf(HEAVY)).toBeGreaterThan(BASE_CREDITS);
    expect(() => startSemester(withClause(base(1, HEAVY), 1, 2), 1)).toThrow(RangeError);
    expect(() => startSemester(withClause(base(1, HEAVY), 1, 1), 1)).not.toThrow();
    expect(() => startSemester(withClause(base(1, COURSES), 1, 2), 1)).not.toThrow();
  });

  it('refuses a clause level the rules do not have, even in a context built by hand', () => {
    expect(() => startSemester({ ...base(1), clause: 3 }, 1)).toThrow(RangeError);
  });
});

describe('what a clear unlocks', () => {
  it('opens the next level when the top unlocked one is cleared, and stops at the last', () => {
    expect(unlockedAfter(0, 0, true)).toBe(1);
    expect(unlockedAfter(1, 1, true)).toBe(2);
    expect(unlockedAfter(2, 2, true)).toBe(MAX_CLAUSE);
  });

  it('opens nothing for a failed semester or a level below the top one', () => {
    expect(unlockedAfter(0, 0, false)).toBe(0);
    expect(unlockedAfter(2, 1, true)).toBe(2);
    expect(unlockedAfter(1, 0, true)).toBe(1);
  });
});
