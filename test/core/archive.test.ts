import { describe, expect, it } from 'vitest';
import {
  archiveRate, ARCHIVE_SLEEP, COURSES, paperShare, playDay, startSemester, UNARCHIVED_KEPT,
  type SemesterContext, type SemesterState, type Strategy,
} from '../../src/core/index.ts';
import { contextFor } from '../../sim/semester/scenario.ts';

const PAPER = ['database', 'os', 'networks', 'ta'];
const PRACTICE = ['compiler', 'software', 'capstone', 'ta'];
const ctxFor = (courses?: readonly string[]): SemesterContext => contextFor(0.5, 1, { scenario: {}, ...(courses ? { courses } : {}) });

const HOURS = Array.from({ length: 14 }, (_, i) => 8 + i);

/** Studies all day, or rests all day; goes to bed at `bed` (study before it when `late`) and wakes at 7. */
const player = (opts: { bed?: number; late?: boolean; rest?: boolean; coffee?: number[] } = {}): Strategy => ({
  plan: () => ({ coffee: opts.coffee ?? [], rest: opts.rest ? HOURS : [] }),
  choose: (_id, options) => options[0]!,
  floor: () => ({ patrol: 'gut' }),
  night: () => ({ bed: opts.bed ?? 22.5, nextWake: 7, lateNight: opts.late ? 'study' : 'rest' }),
});

const day = (ctx: SemesterContext, from: SemesterState, opts?: Parameters<typeof player>[0]): SemesterState => playDay(from, ctx, player(opts));

describe('what share of the study waits for sleep (design doc 8.3)', () => {
  it('is all of it for paper exams, none for practice, and credits decide the mix', () => {
    expect(paperShare(PAPER)).toBe(1);
    expect(paperShare(PRACTICE.filter((c) => c === 'compiler'))).toBe(0);
    expect(paperShare(['algorithms', 'database'])).toBe(0.75);
    // 3 credits of algorithms at half, 3 of the operating systems and 3 of the database at full, out of 9.
    expect(paperShare(['algorithms', 'os', 'database', 'ta'])).toBeCloseTo(7.5 / 9, 12);
    expect(paperShare(['compiler', 'database'])).toBeCloseTo(3 / 7, 12);
  });

  it('counts only the cards that have an exam, so a card without one dilutes nothing', () => {
    expect(paperShare(['software', 'capstone', 'ta', 'internship'])).toBe(0);
    expect(paperShare(['database', 'software', 'capstone'])).toBe(1);
    expect(COURSES.every((c) => paperShare([c.id]) >= 0 && paperShare([c.id]) <= 1)).toBe(true);
  });

  it('archives the whole pile from 7 hours of effective sleep and a part of it below', () => {
    expect(ARCHIVE_SLEEP).toBe(7);
    expect([0, 3.5, 6, 7, 9].map(archiveRate)).toEqual([0, 0.5, 6 / 7, 1, 1]);
  });
});

describe('a day of study before and after sleep', () => {
  it('keeps the study in the staging pile until the night, then files all of it after a full night', () => {
    const ctx = ctxFor(PAPER);
    const s0 = startSemester(ctx, 1);
    const noCourses = day(ctxFor(), startSemester(ctxFor(), 1));
    const s = day(ctx, s0);
    const rec = s.history[0]!;
    expect(rec.archive?.rate).toBe(1);
    expect(rec.archive!.staged).toBeGreaterThan(0);
    expect(rec.archive!.archived).toBeCloseTo(rec.archive!.staged, 12);
    expect(s.staging).toBe(0);
    // With a full night nothing is lost, so the semester is where it would be without a course list.
    expect(s.progress).toBeCloseTo(noCourses.progress, 9);
  });

  it('counts the study of a practice card at once, with nothing waiting', () => {
    const ctx = ctxFor(PRACTICE);
    const s = day(ctx, startSemester(ctx, 1));
    expect(s.history[0]!.archive).toBeUndefined();
    expect(s.staging).toBe(0);
    expect(s.progress).toBeGreaterThan(0);
  });

  it('files only a part of it after a short night, and keeps half of the rest', () => {
    const ctx = ctxFor(PAPER);
    const s = day(ctx, startSemester(ctx, 1), { bed: 25, late: true });
    const { staged, rate, archived } = s.history[0]!.archive!;
    // 25:00 to 07:00 is 6 hours, with no caffeine or drink to take any of it away.
    expect(rate).toBeCloseTo(6 / 7, 12);
    expect(archived).toBeCloseTo(staged * rate, 12);
    expect(s.progress).toBeCloseTo(archived, 12);
    expect(s.staging).toBeCloseTo(staged * (1 - rate) * UNARCHIVED_KEPT, 12);
    expect(s.staging).toBeGreaterThan(0);
  });

  it('goes by the sleep that counts, so coffee drunk late files less than the same night without it', () => {
    const ctx = ctxFor(PAPER);
    const plain = day(ctx, startSemester(ctx, 1)).history[0]!.archive!;
    const coffee = day(ctx, startSemester(ctx, 1), { coffee: [20, 21] }).history[0]!.archive!;
    // The bed is 22:30 and the wake 07:00, 8.5 hours either way; only the caffeine at bedtime differs.
    expect(plain.rate).toBe(1);
    expect(coffee.rate).toBeLessThan(1);
  });

  it('counts the first night in the emergency room as the 9 good hours it is for the debt', () => {
    const ctx = ctxFor(PAPER);
    const s0 = startSemester(ctx, 1);
    const short = { bed: 25, late: true };
    expect(day(ctx, s0, short).history[0]!.archive!.rate).toBeCloseTo(6 / 7, 12);
    const strained = { ...s0, loads: { ...s0.loads, brain: 100, stomach: 100 } };
    const s = day(ctx, strained, short);
    expect(s.history[0]!.hospitalized).toBe(true);
    expect(s.history[0]!.archive!.rate).toBe(1);
    expect(s.staging).toBe(0);
  });

  it('files what was left over on the next full night', () => {
    const ctx = ctxFor(PAPER);
    const short = day(ctx, startSemester(ctx, 1), { bed: 25, late: true });
    const next = day(ctx, short, { rest: true });
    expect(next.history[1]!.archive).toMatchObject({ staged: short.staging, rate: 1 });
    expect(next.staging).toBe(0);
    expect(next.progress).toBeCloseTo(short.progress + short.staging, 12);
  });

  it('does not let an exam count what sleep has not yet filed', () => {
    const ctx = ctxFor(PAPER);
    const at = { ...startSemester(ctx, 1), day: 5, progress: 10 };
    const bare = playDay(at, ctx, player({ rest: true }));
    const piled = playDay({ ...at, staging: 50 }, ctx, player({ rest: true }));
    expect(piled.mid).toBe(bare.mid);
    expect(bare.mid).toBeGreaterThan(0);
    // What was piled before the exam is filed that night.
    expect(piled.progress).toBeCloseTo(bare.progress + 50, 9);
  });
});
