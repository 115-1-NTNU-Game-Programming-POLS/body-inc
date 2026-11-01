import { describe, expect, it } from 'vitest';
import {
  amount, decode, encode, GRADE_HOURS, gradeDays, gradeRoom, playDay, RUN, startSemester,
  type DayView, type MorningPlan, type NightPlan, type SemesterContext, type SemesterState, type Strategy,
} from '../../src/core/index.ts';
import { contextFor } from '../../sim/semester/scenario.ts';

const WITH = ['os', 'database', 'networks', 'ta'];
const WITHOUT = ['os', 'database', 'networks', 'algorithms'];
const ctxFor = (courses: readonly string[]): SemesterContext => contextFor(0.5, 1, { scenario: {}, courses });

// Days 6 and 7 are the weekend: no class, so hours 8 to 11, 13 to 17 and 19 to 21 are free but for the meals.
const SAT = 6;
const SUN = 7;

const player = (plan: Partial<MorningPlan> = {}, night: Partial<NightPlan> = {}, seen: DayView[] = []): Strategy => ({
  plan: (view) => {
    seen.push(view);
    return { coffee: [], rest: [], ...plan };
  },
  choose: (_id, options) => options[0]!,
  floor: () => ({ patrol: 'gut' }),
  night: (view) => {
    seen.push(view);
    return { bed: 22.5, nextWake: 7, lateNight: 'rest', ...night };
  },
});

const day = (ctx: SemesterContext, n: number, plan?: Partial<MorningPlan>, night?: Partial<NightPlan>, from?: Partial<SemesterState>): SemesterState =>
  playDay({ ...startSemester(ctx, 1), day: n, ...from }, ctx, player(plan, night));

const studied = (s: SemesterState): number => s.progress + s.staging;
const debtOf = (ctx: SemesterContext, s: SemesterState): number => amount(s.tags, ctx.dict, 'sleep_debt');

describe('the midterm grading of the TA line (design doc 8.3)', () => {
  it('opens on the midterm day, closes after day 7, and leaves the last night to nobody', () => {
    const ctx = ctxFor(WITH);
    const { from, to } = gradeDays(ctx.params);
    expect([from, to]).toEqual([5, 7]);
    const open = (n: number): { day: boolean; night: boolean } => {
      const seen: DayView[] = [];
      playDay({ ...startSemester(ctx, 1), day: n }, ctx, player({}, {}, seen));
      const g = seen[0]!.grade!;
      expect(g.need).toBe(GRADE_HOURS);
      expect(g.due).toBe(7);
      return { day: g.open, night: g.night };
    };
    expect([4, 5, 6, 7, 8].map(open)).toEqual([
      { day: false, night: false }, { day: true, night: true }, { day: true, night: true }, { day: true, night: false }, { day: false, night: false },
    ]);
  });

  it('is absent without the card, and a plan for it is refused there', () => {
    const ctx = ctxFor(WITHOUT);
    const seen: DayView[] = [];
    playDay({ ...startSemester(ctx, 1), day: SAT }, ctx, player({}, {}, seen));
    expect(seen[0]!.grade).toBeUndefined();
    expect(() => day(ctx, SAT, { grade: 1 })).toThrow(RangeError);
    expect(() => day(ctx, SAT, {}, { grade: 1 })).toThrow(RangeError);
  });

  it('takes the hours it is given out of the study, as the same hours of rest would', () => {
    const ctx = ctxFor(WITH);
    const graded = day(ctx, SAT, { grade: 3 });
    expect(graded.graded).toBe(3);
    // The first three free hours of the day are 8, 9 and 10, so resting them loses exactly the study the grading did.
    const rested = day(ctx, SAT, { rest: [8, 9, 10] });
    expect(studied(graded)).toBeCloseTo(studied(rested), 9);
    expect(studied(graded)).toBeLessThan(studied(day(ctx, SAT)));
    expect(graded.history[0]!.grade).toEqual({ hours: 3, done: false });
  });

  it('refuses hours the papers cannot take: too many, fractions, a closed day, or a day after the papers are done', () => {
    const ctx = ctxFor(WITH);
    expect(() => day(ctx, SAT, { grade: GRADE_HOURS + 1 })).toThrow(RangeError);
    expect(() => day(ctx, SAT, { grade: 1.5 })).toThrow(RangeError);
    expect(() => day(ctx, SAT, { grade: -1 })).toThrow(RangeError);
    expect(() => day(ctx, 4, { grade: 1 })).toThrow(RangeError);
    expect(() => day(ctx, 8, { grade: 1 })).toThrow(RangeError);
    expect(() => day(ctx, SUN, { grade: 3 }, {}, { graded: 3 })).toThrow(RangeError);
    expect(day(ctx, SUN, { grade: 2 }, {}, { graded: 3 }).graded).toBe(GRADE_HOURS);
  });

  it('is done at 5 hours, however they are split between the days, and the record says on which day it finished', () => {
    const ctx = ctxFor(WITH);
    const first = day(ctx, SAT, { grade: 3 });
    const second = playDay(first, ctx, player({ grade: 2 }));
    expect(second.graded).toBe(GRADE_HOURS);
    expect(first.history[0]!.grade!.done).toBe(false);
    expect(second.history[1]!.grade).toEqual({ hours: 2, done: true });
    // Nothing more is offered once the papers are done.
    const seen: DayView[] = [];
    playDay({ ...second, day: 8 }, ctx, player({}, {}, seen));
    expect(seen[0]!.grade).toMatchObject({ done: GRADE_HOURS, open: false, night: false });
  });

  it('does not open on a hospital day, which the player does not plan', () => {
    const ctx = ctxFor(WITH);
    const seen: DayView[] = [];
    playDay({ ...startSemester(ctx, 1), day: SAT, hospitalDay: SAT }, ctx, player({}, {}, seen));
    expect(seen.every((v) => v.grade === undefined || (!v.grade.open && !v.grade.night))).toBe(true);
  });

  it('pushes bedtime back by the night hours and leaves the debt to show for it', () => {
    const ctx = ctxFor(WITH);
    const early = day(ctx, SAT);
    const late = day(ctx, SAT, {}, { grade: 5 });
    expect(late.graded).toBe(GRADE_HOURS);
    expect(late.history[0]!.bedEnd! - early.history[0]!.bedEnd!).toBe(5);
    expect(late.history[0]!.grade).toEqual({ hours: 5, done: true });
    expect(debtOf(ctx, late)).toBeGreaterThan(debtOf(ctx, early));
    // The night hours are not study hours, but they take the sleep that files the day's study (design doc 8.3): bed at 27:30 is
    // 3.5 hours of sleep, so half the pile is archived and the other half keeps half of itself, three quarters in all.
    expect(studied(late)).toBeCloseTo(studied(early) * 0.75, 9);
  });

  it('closes the last night: the grades are due the next day, and papers graded after midnight of day 7 would be too late', () => {
    const ctx = ctxFor(WITH);
    expect(() => day(ctx, SUN, {}, { grade: 1 })).toThrow(RangeError);
    expect(() => day(ctx, SAT, {}, { grade: GRADE_HOURS + 1 })).toThrow(RangeError);
    expect(() => day(ctx, SAT, {}, { grade: 1 }, { graded: GRADE_HOURS })).toThrow(RangeError);
  });

  it('counts only the hours that fit before the clock stops, and the contest gives way to the grading', () => {
    const ctx = ctxFor(['algorithms', 'os', 'database', 'ta']);
    // Bed 27 leaves two hours of room (the clock stops at 29), so a night of 3 grading hours holds 2 and no contest hour at all.
    const crowded = day(ctx, SAT, {}, { bed: 27, grade: 3, rank: 2 });
    expect(crowded.graded).toBe(2);
    expect(crowded.rank).toBe(0);
    expect(crowded.history[0]!.rank).toBeUndefined();
    // With room for both they both count.
    const both = day(ctx, SAT, {}, { bed: 22.5, grade: 3, rank: 2 });
    expect(both.graded).toBe(3);
    expect(both.rank).toBeGreaterThan(0);
    expect(both.history[0]!.rank!.hours).toBe(2);
    expect(both.history[0]!.bedEnd).toBe(22.5 + 5);
  });

  it('plans the morning from what the day leaves: the free hours less the writing, up to what is left to grade', () => {
    const ctx = ctxFor(WITH);
    const room = (n: number, rest: readonly number[], write: number, graded: number): number =>
      gradeRoom(ctx.params, ctx.courses, n, ctx.params.wake, n === ctx.params.midDay, rest, write, graded);
    // A weekend has 12 free hours; day 5 has the exam (9, 10), the class (11, 14, 15) and the meals taken off the 14 hours of the day.
    expect(room(SAT, [], 0, 0)).toBe(GRADE_HOURS);
    expect(room(SAT, [], 0, 3)).toBe(2);
    expect(room(SAT, [8, 9, 10, 11, 13, 14, 15, 16, 17], 0, 0)).toBe(3);
    expect(room(SAT, [8, 9, 10, 11, 13, 14, 15, 16, 17], 2, 0)).toBe(1);
    // The midterm day is a weekday with the exam at 9 and 10, so only 8, 13, 16, 17 and 19 to 21 are free.
    expect(room(5, [], 0, 0)).toBe(5);
    expect(room(5, [16, 17, 19, 20, 21], 0, 0)).toBe(2);
    expect(room(5, [], 3, 0)).toBe(4);
  });

  it('is kept by a saved run: the hours of the plan and of the night survive the slot', () => {
    const run = {
      semester: {
        seed: 3, courses: ['os', 'database', 'networks', 'ta'],
        days: [[
          { kind: 'plan' as const, plan: { coffee: [], rest: [17, 21], grade: 3 } },
          { kind: 'floor' as const, choice: { patrol: 'gut' as const } },
          { kind: 'night' as const, plan: { bed: 22.5, nextWake: 7, lateNight: 'rest' as const, grade: 2 } },
        ]],
      },
    };
    expect(decode(RUN, encode(RUN, run))).toEqual({ kind: 'ok', data: run });
  });

  it('reads a run saved before the grading existed, which has no such hours', () => {
    const old = { semester: { seed: 3, courses: ['os', 'ta'], days: [[{ kind: 'plan', plan: { coffee: [], rest: [17] } }]] } };
    expect(decode(RUN, JSON.stringify({ schema: 5, data: old }))).toEqual({ kind: 'migrated', from: 5, data: old });
  });
});
