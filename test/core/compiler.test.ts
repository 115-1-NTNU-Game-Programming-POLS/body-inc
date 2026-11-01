import { describe, expect, it } from 'vitest';
import {
  decode, encode, playDay, PROJECT_DAY_MAX, PROJECT_FIN_PENALTY, PROJECT_FROM_DAY, PROJECT_NEED, PROJECT_REVIEW, projectRoom, RUN, SIT_LIMIT, startSemester, STUCK_MULT, WALK_EFFORT,
  type Answer, type DayView, type MorningPlan, type SemesterContext, type SemesterState, type Strategy,
} from '../../src/core/index.ts';
import { contextFor } from '../../sim/semester/scenario.ts';

const WITH = ['compiler', 'os', 'database', 'ta'];
const WITHOUT = ['os', 'database', 'networks', 'ta'];
const ctxFor = (courses?: readonly string[]): SemesterContext => contextFor(0.5, 1, { scenario: {}, ...(courses ? { courses } : {}) });

/** A day with no class: every hour of the free time is study unless the plan gives it to something else. */
const player = (plan: Partial<MorningPlan> = {}, seen: DayView[] = []): Strategy => ({
  plan: (view) => {
    seen.push(view);
    return { coffee: [], rest: [], ...plan };
  },
  choose: (_id, options) => options[0]!,
  floor: () => ({ patrol: 'gut' }),
  night: () => ({ bed: 22.5, nextWake: 7, lateNight: 'rest' }),
});

const day = (ctx: SemesterContext, n: number, plan?: Partial<MorningPlan>, from?: Partial<SemesterState>): SemesterState =>
  playDay({ ...startSemester(ctx, 1), day: n, ...from }, ctx, player(plan));

/** Study the day gave, taken from the record so it does not depend on how the efficiency is built. */
const studied = (s: SemesterState): number => s.progress + s.staging;

describe('the stuck point of sitting at the desk (design doc 8.3)', () => {
  // Day 7 is a weekend, so there is no class: hours 9 to 21 are free but for the meals.
  const free = 7;

  it('cuts the efficiency to three tenths from the hour after three in a row, with the card only', () => {
    const plain = day(ctxFor(WITHOUT), free);
    const stuck = day(ctxFor(WITH), free);
    expect(studied(stuck)).toBeLessThan(studied(plain) * 0.9);
    expect(studied(stuck)).toBeGreaterThan(0);
  });

  it('is cleared by a rest hour, so the same hours split by a rest lose nothing to it', () => {
    const ctx = ctxFor(WITH);
    const rest = [11, 15, 19];
    const split = day(ctx, free, { rest });
    const noCard = day(ctxFor(WITHOUT), free, { rest });
    // Rest hours never leave three in a row at the desk, so the card changes nothing.
    expect(studied(split)).toBeCloseTo(studied(noCard), 9);
  });

  it('is eased by a walk, which costs a quarter of the hour it falls in and is worth more than sitting on', () => {
    const ctx = ctxFor(WITH);
    const sit = day(ctx, free);
    const walk = day(ctx, free, { walk: true });
    expect(studied(walk)).toBeGreaterThan(studied(sit));
    // Never more than the card-free day, which has neither the stuck point nor the walks.
    expect(studied(walk)).toBeLessThan(studied(day(ctxFor(WITHOUT), free)));
  });

  it('is worth exactly 0.3 of an hour from the fourth in a row, and 0.75 when a walk comes first', () => {
    // On a Sunday the project takes hours 13 to 16 right after the lunch break, so the fourth hour is the one past three in a row.
    const ctx = ctxFor(WITH);
    const rest = [8, 9, 10, 11, 17, 19, 20, 21];
    const hours = (project: number, walk = false): number => day(ctx, free, { rest, project, walk }).project;
    const e = hours(3) / 3;
    expect(e).toBeGreaterThan(0);
    expect(hours(4)).toBeCloseTo(e * (3 + STUCK_MULT), 9);
    expect(hours(4, true)).toBeCloseTo(e * (3 + WALK_EFFORT), 9);
    expect(hours(3, true)).toBeCloseTo(e * 3, 9);
    expect(SIT_LIMIT).toBe(3);
  });

  it('refuses a walk without the card, which has no stuck point', () => {
    expect(() => day(ctxFor(WITHOUT), free, { walk: true })).toThrow(RangeError);
    expect(() => day(ctxFor(), free, { walk: true })).toThrow(RangeError);
  });
});

describe('the project hours a morning plan can count on', () => {
  const room = (ctx: SemesterContext, n: number, rest: readonly number[], write: number): number =>
    projectRoom(ctx.params, ctx.courses, n, ctx.params.wake, n === ctx.params.midDay || n === ctx.params.finDay, rest, write);

  it('is what the day leaves after class, meals, the card\'s hours, rest and writing, up to the cap', () => {
    const ctx = ctxFor(WITH);
    // A weekday has 8 free hours (8, 9, 13, 16, 17, 19, 20, 21), the TA's office hours of day 8 take 16 and 17, and a weekend has 12.
    expect([room(ctx, 3, [], 0), room(ctx, 8, [], 0), room(ctx, 7, [], 0)]).toEqual([4, 4, 4]);
    expect(room(ctx, 8, [], 3)).toBe(3);
    expect(room(ctx, 3, [16, 17, 20, 21], 3)).toBe(1);
    expect(room(ctx, 3, [8, 9, 13, 16, 17, 19, 20, 21], 0)).toBe(0);
    expect(room(ctx, 3, [8, 9, 13, 16, 17, 19, 20, 21], 3)).toBe(0);
    // A rest hour that class or the TA already holds is not taken twice.
    expect(room(ctx, 8, [16, 17, 10, 11], 0)).toBe(4);
    expect(room(ctx, 8, [8, 9, 13, 19, 20], 0)).toBe(1);
  });

  it('is what the day plays when no event comes in, for every rest plan and hours of writing', () => {
    const ctx = ctxFor(WITH);
    const plans = [[], [21], [17, 21], [16, 17, 20, 21], [8, 9, 13, 16, 17, 19, 20, 21]];
    for (const n of [3, 5, 6, 7, 8, 9]) {
      const writing = startSemester(ctx, 1).homework.some((a) => a.announce <= n && n < a.due) ? [0, 3] : [0];
      for (const rest of plans) {
        for (const write of writing) {
          const can = room(ctx, n, rest, write);
          for (let project = 0; project <= PROJECT_DAY_MAX; project++) {
            const s = day(ctx, n, { rest, write, project });
            expect(s.history[0]!.project?.hours ?? 0, `day ${n}, rest ${rest.join()}, write ${write}, asked ${project}`).toBe(Math.min(project, can));
          }
        }
      }
    }
  });
});

describe('the final project', () => {
  it('opens on day 3 with the card, until it is done, and the view tells the progress it needs', () => {
    const ctx = ctxFor(WITH);
    const seen: DayView[] = [];
    let s = startSemester(ctx, 1);
    for (let i = 0; i < 4; i++) s = playDay(s, ctx, player({}, seen));
    expect(seen.map((v) => v.project?.open)).toEqual([false, false, true, true]);
    expect(seen[0]!.project).toMatchObject({ done: 0, need: PROJECT_NEED });
    expect(PROJECT_FROM_DAY).toBe(3);
    const none: DayView[] = [];
    playDay(startSemester(ctxFor(WITHOUT), 1), ctxFor(WITHOUT), player({}, none));
    expect(none[0]).not.toHaveProperty('project');
  });

  it('takes the hours the day gives it instead of study, and counts them as progress of its own', () => {
    const ctx = ctxFor(WITH);
    const s = day(ctx, 8, { project: 3 });
    const rec = s.history[0]!;
    expect(rec.project?.hours).toBe(3);
    expect(s.project).toBeGreaterThan(0);
    expect(rec.project?.gain).toBeCloseTo(s.project, 9);
    expect(studied(s)).toBeLessThan(studied(day(ctx, 8)));
    expect(day(ctx, 8).history[0]!.project).toBeUndefined();
  });

  it('is done once the progress reaches what it needs, and is then shut', () => {
    const ctx = ctxFor(WITH);
    const s = day(ctx, 8, { project: PROJECT_DAY_MAX }, { project: PROJECT_NEED - 0.1 });
    expect(s.history[0]!.project?.done).toBe(true);
    const seen: DayView[] = [];
    playDay(s, ctx, player({}, seen));
    expect(seen[0]!.project?.open).toBe(false);
    expect(() => day(ctx, 8, { project: 1 }, { project: PROJECT_NEED })).toThrow(RangeError);
  });

  it('is refused before it opens, past the cap, as part of an hour, and without the card', () => {
    expect(() => day(ctxFor(WITH), 2, { project: 1 })).toThrow(RangeError);
    expect(() => day(ctxFor(WITH), 8, { project: PROJECT_DAY_MAX + 1 })).toThrow(RangeError);
    expect(() => day(ctxFor(WITH), 8, { project: 1.5 })).toThrow(RangeError);
    expect(() => day(ctxFor(WITH), 8, { project: -1 })).toThrow(RangeError);
    expect(() => day(ctxFor(WITHOUT), 8, { project: 1 })).toThrow(RangeError);
  });

  it('costs the final exam percent when it is not done, and only the final', () => {
    const ctx = ctxFor(WITH);
    const fin = (project: number): number => day(ctx, 10, {}, { progress: 37, project }).fin!;
    // The design doc says 8 off the percent and 10 review points for a project handed in.
    expect([PROJECT_FIN_PENALTY, PROJECT_REVIEW]).toEqual([8, 10]);
    expect(fin(PROJECT_NEED) - fin(0)).toBeCloseTo(8, 9);
    expect(fin(PROJECT_NEED - 0.01)).toBe(fin(0));
    const mid = (project: number): number => day(ctx, 5, {}, { progress: 18, project }).mid!;
    expect(mid(0)).toBe(mid(PROJECT_NEED));
    const noCard = (project: number): number => day(ctxFor(WITHOUT), 10, {}, { progress: 37, project }).fin!;
    expect(noCard(0)).toBe(noCard(PROJECT_NEED));
  });

  it('never takes the final below 0', () => {
    expect(day(ctxFor(WITH), 10, {}, { progress: 0, project: 0 }).fin).toBe(0);
  });
});

describe('the compiler hours in a saved run', () => {
  it('survive the run slot, and a version-4 run reads as it was', () => {
    const answers: Answer[] = [
      { kind: 'plan', plan: { coffee: [], rest: [], project: 2, walk: true } }, { kind: 'floor', choice: { patrol: 'brain' } },
      { kind: 'night', plan: { bed: 22.5, nextWake: 7, lateNight: 'rest' } },
    ];
    const run = { semester: { seed: 1, courses: WITH, days: [answers] } };
    expect(decode(RUN, encode(RUN, run))).toEqual({ kind: 'ok', data: run });
    const old = JSON.stringify({ schema: 4, data: { semester: { seed: 1, courses: WITH, days: [] } } });
    expect(decode(RUN, old).kind).toBe('migrated');
    const bad = JSON.stringify({ schema: 5, data: { semester: { seed: 1, days: [[{ kind: 'plan', plan: { coffee: [], rest: [], walk: 'yes' } }]] } } });
    expect(decode(RUN, bad).kind).toBe('invalid');
  });
});
