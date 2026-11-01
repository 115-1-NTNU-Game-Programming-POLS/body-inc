import { describe, expect, it } from 'vitest';
import {
  advanceDay, debugHoursFor, DEBUG_PERCENT, HOMEWORK_MISS_PENALTY, HOMEWORK_PROGRESS, MAX_DEBUG_PER_NIGHT, OS_ASSIGNMENTS, playDay, startSemester, WRITE_HOURS,
  type Answer, type DayView, type SemesterContext, type SemesterState, type Strategy,
} from '../../src/core/index.ts';
import { contextFor } from '../../sim/semester/scenario.ts';

const COURSES = ['algorithms', 'os', 'database', 'ta'];
const ctxFor = (courses: readonly string[] | null = COURSES, seed = 1): SemesterContext => contextFor(0.5, seed, { scenario: {}, ...(courses ? { courses } : {}) });

interface Plan { write?: number; debug?: number }

/** Studies by default; `plan(day)` says how many hours that day writes and how many it debugs after the bedtime of 22:30. */
const player = (plan: (day: number) => Plan = () => ({}), seen: DayView[] = []): Strategy => ({
  plan: (view) => {
    seen.push(view);
    const w = plan(view.day).write;
    return { coffee: [], rest: [], ...(w === undefined ? {} : { write: w }) };
  },
  choose: (_id, options) => options[0]!,
  floor: () => ({ patrol: 'brain' }),
  night: (view) => {
    const g = plan(view.day).debug;
    return { bed: 22.5, nextWake: 7, lateNight: 'rest', ...(g === undefined ? {} : { debug: g }) };
  },
});

const play = (ctx: SemesterContext, strategy: Strategy, from: SemesterState, upTo: number): SemesterState => {
  let s = from;
  while (s.day <= upTo && !s.ended) s = playDay(s, ctx, strategy);
  return s;
};

/** The first seed whose first assignment has the debugging hours `want` accepts; the tests need a long and a short one. */
const seedWhere = (want: (debug: number) => boolean): number => {
  for (let seed = 1; seed < 500; seed++) if (want(startSemester(ctxFor(COURSES, seed), seed).homework[0]!.debug)) return seed;
  throw new Error('no seed in 1..499 draws such a debugging time');
};

const open = (seed: number): { ctx: SemesterContext; s0: SemesterState; debug: number } => {
  const ctx = ctxFor(COURSES, seed);
  const s0 = startSemester(ctx, seed);
  return { ctx, s0, debug: s0.homework[0]!.debug };
};

const SHORT = seedWhere((d) => d === 2);
const LONG = seedWhere((d) => d === 6);

describe('the debugging hours (design doc 8.3)', () => {
  it('draws 1 to 6 hours with the percentages of the design doc', () => {
    expect(DEBUG_PERCENT.reduce((a, b) => a + b, 0)).toBe(100);
    expect([0, 0.199, 0.2, 0.449, 0.45, 0.649, 0.65, 0.799, 0.8, 0.919, 0.92, 0.999].map(debugHoursFor)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  });

  it('is fixed by the seed when the semester starts, and varies from seed to seed', () => {
    const a = startSemester(ctxFor(), 7).homework.map((h) => h.debug);
    expect(a).toHaveLength(OS_ASSIGNMENTS.length);
    expect(startSemester(ctxFor(), 7).homework.map((h) => h.debug)).toEqual(a);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) seen.add(startSemester(ctxFor(), seed).homework.map((h) => h.debug).join());
    expect(seen.size).toBeGreaterThan(10);
  });

  it('exists only for a semester that takes the operating-systems card', () => {
    expect(startSemester(ctxFor(['algorithms', 'database', 'compiler', 'ta']), 1).homework).toEqual([]);
    expect(startSemester(ctxFor(null), 1).homework).toEqual([]);
  });
});

describe('writing an assignment', () => {
  it('shows an assignment only from its announcement to the day before it is due', () => {
    const { ctx, s0 } = open(SHORT);
    const seen: DayView[] = [];
    play(ctx, player(() => ({}), seen), s0, 4);
    expect(seen.map((v) => [v.day, v.homework.map((h) => h.n)])).toEqual([[1, []], [2, [1]], [3, [1]], [4, []]]);
  });

  it('hides the debugging hours until the writing is done', () => {
    const { ctx, s0, debug } = open(SHORT);
    const before: DayView[] = [];
    play(ctx, player((d) => (d === 2 ? { write: 2 } : {}), before), s0, 3);
    expect(before.filter((v) => v.day >= 2).map((v) => v.homework[0]!.debug)).toEqual([undefined, undefined]);
    const after: DayView[] = [];
    play(ctx, player((d) => (d === 2 ? { write: 3 } : {}), after), s0, 3);
    expect(after.find((v) => v.day === 3)!.homework[0]).toMatchObject({ written: WRITE_HOURS, debug });
  });

  it('spends the writing hours as work, so the day studies that much less', () => {
    const { ctx, s0 } = open(SHORT);
    const hours = (write: number): number => play(ctx, player((d) => (d === 2 ? { write } : {})), { ...s0, day: 2 }, 2).history[0]!.studyHours;
    expect(hours(0) - hours(2)).toBe(2);
    expect(hours(0) - hours(3)).toBe(3);
  });

  it('takes at most the 3 hours the assignment needs, over as many days as it takes', () => {
    const { ctx, s0 } = open(SHORT);
    const done = play(ctx, player((d) => (d === 2 ? { write: 2 } : d === 3 ? { write: 1 } : {})), s0, 3);
    expect(done.homework[0]!.written).toBe(3);
    expect(done.history[1]!.homework).toEqual([{ n: 1, wrote: 2, debugged: 0, done: false, missed: false }]);
    expect(() => play(ctx, player((d) => (d === 2 ? { write: 4 } : {})), s0, 2)).toThrow(/writing/);
    expect(() => play(ctx, player((d) => (d === 1 ? { write: 1 } : {})), s0, 1)).toThrow(/writing/);
  });
});

describe('debugging an assignment', () => {
  const written = (seed: number): { ctx: SemesterContext; s: SemesterState; debug: number } => {
    const { ctx, s0, debug } = open(seed);
    return { ctx, s: play(ctx, player((d) => (d === 2 ? { write: 3 } : {})), s0, 2), debug };
  };
  /** Night of day 2 after writing it that day: plays day 2 with the writing and `ask` hours of debugging. */
  const dayTwo = (seed: number, ask: number): SemesterState => {
    const { ctx, s0 } = open(seed);
    return playDay({ ...s0, day: 2 }, ctx, player(() => ({ write: 3, debug: ask })));
  };

  it('comes after the planned bedtime and pushes it back by the hours spent', () => {
    const s = dayTwo(SHORT, 2);
    expect(s.history[0]!.bedEnd).toBe(22.5 + 2);
    expect(s.homework[0]!.debugged).toBe(2);
    expect(dayTwo(SHORT, 0).history[0]!.bedEnd).toBe(22.5);
  });

  it('hands the assignment in when its last hour is done, for the progress it is worth', () => {
    const done = dayTwo(SHORT, MAX_DEBUG_PER_NIGHT);
    // Asking for more than is left spends only what is left: the debugging of this seed is 2 hours.
    expect(done.homework[0]).toMatchObject({ debugged: 2, done: true });
    expect(done.history[0]!.bedEnd).toBe(22.5 + 2);
    expect(done.history[0]!.homework).toEqual([{ n: 1, wrote: 3, debugged: 2, done: true, missed: false }]);
    const idle = playDay({ ...open(SHORT).s0, day: 2 }, open(SHORT).ctx, player(() => ({ write: 3 })));
    // The two hours of debugging cost sleep, so less of the day's study is archived that night; the hand-in is the rest of the difference.
    const lost = idle.history[0]!.archive!.archived - done.history[0]!.archive!.archived;
    expect(lost).toBeGreaterThan(0);
    expect(done.progress - idle.progress).toBeCloseTo(HOMEWORK_PROGRESS - lost, 6);
  });

  it('spreads a long debugging over nights, and is handed in only after the last one', () => {
    const first = dayTwo(LONG, MAX_DEBUG_PER_NIGHT);
    expect(first.homework[0]).toMatchObject({ debugged: MAX_DEBUG_PER_NIGHT, done: false });
    const second = playDay(first, open(LONG).ctx, player((d) => (d === 3 ? { debug: MAX_DEBUG_PER_NIGHT } : {})));
    expect(second.homework[0]).toMatchObject({ debugged: 6, done: true });
    expect(second.history[1]!.bedEnd).toBe(22.5 + 2);
  });

  it('refuses debugging before the writing is done, and more than a night can take', () => {
    const { ctx, s0 } = open(SHORT);
    expect(() => play(ctx, player((d) => (d === 2 ? { debug: 1 } : {})), s0, 2)).toThrow(/debugging/);
    const { ctx: c, s } = written(SHORT);
    expect(() => play(c, player((d) => (d === 3 ? { debug: MAX_DEBUG_PER_NIGHT + 1 } : {})), s, 3)).toThrow(/debugging/);
  });
});

describe('handing in and missing', () => {
  it('marks an assignment missed on the morning it falls due, and not before', () => {
    const { ctx, s0 } = open(SHORT);
    const day3 = play(ctx, player(), s0, 3);
    expect(day3.homework[0]).toMatchObject({ done: false, missed: false });
    const day4 = play(ctx, player(), s0, 4);
    expect(day4.homework[0]).toMatchObject({ done: false, missed: true });
    expect(day4.history[3]!.homework).toEqual([{ n: 1, wrote: 0, debugged: 0, done: false, missed: true }]);
    expect(day4.homework[1]).toMatchObject({ done: false, missed: false });
  });

  it('never marks a handed-in assignment missed', () => {
    const { ctx, s0 } = open(SHORT);
    const handed = playDay({ ...s0, day: 2 }, ctx, player(() => ({ write: 3, debug: MAX_DEBUG_PER_NIGHT })));
    expect(handed.homework[0]!.done).toBe(true);
    expect(play(ctx, player(), handed, 4).homework[0]).toMatchObject({ done: true, missed: false });
  });

  it('works the second assignment the same way on its own days', () => {
    const { ctx, s0 } = open(SHORT);
    const seen: DayView[] = [];
    play(ctx, player(() => ({}), seen), s0, 9);
    expect(seen.filter((v) => v.homework.length > 0).map((v) => [v.day, v.homework[0]!.n])).toEqual([[2, 1], [3, 1], [6, 2], [7, 2], [8, 2]]);
  });

  it('takes the penalty off the final for each assignment not handed in, and off nothing else', () => {
    const { ctx, s0 } = open(SHORT);
    const exam = (day: number, missed: number): SemesterState =>
      playDay({ ...s0, day, progress: 30, homework: s0.homework.map((a, i) => ({ ...a, missed: i < missed })) }, ctx, player());
    expect(HOMEWORK_MISS_PENALTY).toBeGreaterThan(0);
    expect(exam(10, 0).fin! - exam(10, 1).fin!).toBeCloseTo(HOMEWORK_MISS_PENALTY, 9);
    expect(exam(10, 0).fin! - exam(10, 2).fin!).toBeCloseTo(2 * HOMEWORK_MISS_PENALTY, 9);
    expect(exam(5, 0).mid).toBe(exam(5, 2).mid);
  });
});

describe('answers through the interactive day', () => {
  it('takes the hours of writing as part of the plan', () => {
    const ctx = ctxFor(COURSES, SHORT);
    const s0: SemesterState = { ...startSemester(ctx, SHORT), day: 2 };
    const answers: Answer[] = [
      { kind: 'plan', plan: { coffee: [], rest: [], write: 3 } },
      { kind: 'floor', choice: { patrol: 'brain' } },
      { kind: 'night', plan: { bed: 22.5, nextWake: 7, lateNight: 'rest', debug: 1 } },
    ];
    const step = advanceDay(s0, ctx, answers);
    expect(step.done).toBe(true);
    if (step.done) expect(step.state.homework[0]).toMatchObject({ written: 3, debugged: 1 });
  });
});
