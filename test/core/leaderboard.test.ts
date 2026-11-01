import { describe, expect, it } from 'vitest';
import {
  decode, encode, LEADERBOARD_DAYS, MAX_RANK_HOURS, playDay, rankGain, rankPercent, RANK_FULL, RANK_SHARE, RUN, startSemester,
  type Answer, type SemesterContext, type SemesterState, type Strategy, type DayView,
} from '../../src/core/index.ts';
import { contextFor } from '../../sim/semester/scenario.ts';

const WITH = ['algorithms', 'os', 'database', 'ta'];
const WITHOUT = ['os', 'database', 'networks', 'ta'];
const ctxFor = (courses?: readonly string[]): SemesterContext => contextFor(0.5, 1, { scenario: {}, ...(courses ? { courses } : {}) });

/** Studies by default; goes to bed at 22:30 and spends `rank` hours on the contest after it, with an overtime patrol when asked. */
const player = (rank: number, opts: { bed?: number; overtime?: boolean; seen?: DayView[] } = {}): Strategy => ({
  plan: (view) => {
    opts.seen?.push(view);
    return { coffee: [], rest: [] };
  },
  choose: (_id, options) => options[0]!,
  floor: () => (opts.overtime ? { patrol: 'brain', overtime: 'gut' } : { patrol: 'brain' }),
  night: () => ({ bed: opts.bed ?? 22.5, nextWake: 7, lateNight: 'rest', ...(rank === 0 ? {} : { rank }) }),
});

const on = (ctx: SemesterContext, day: number, rank: number, opts?: Parameters<typeof player>[1]): SemesterState =>
  playDay({ ...startSemester(ctx, 1), day }, ctx, player(rank, opts));

describe('the leaderboard score (design doc 8.3)', () => {
  it('adds 10, 6, 3.6 and 2.16 for the hours of a night, times that day\'s S', () => {
    expect([0, 1, 2, 3, 4].map((h) => rankGain(h, 1))).toEqual([0, 10, 10 + 6, 10 + 6 + 3.6, 10 + 6 + 3.6 + 2.16].map((x) => expect.closeTo(x, 10)));
    expect(rankGain(3, 0.5)).toBeCloseTo(rankGain(3, 1) / 2, 12);
    expect(rankGain(0, 1)).toBe(0);
  });

  it('is full at 60 and goes no higher, and is worth 30% of the final exam', () => {
    expect([0, 30, 60, 90].map(rankPercent)).toEqual([0, 50, 100, 100]);
    expect(RANK_FULL).toBe(60);
    expect(RANK_SHARE).toBe(0.3);
    expect(LEADERBOARD_DAYS).toEqual([6, 7, 8, 9]);
  });
});

describe('a contest night', () => {
  it('pushes bedtime back by the hours spent and adds the score of the day\'s S', () => {
    const ctx = ctxFor(WITH);
    const s = on(ctx, 6, 3);
    const rec = s.history[0]!;
    expect(rec.bedEnd).toBe(22.5 + 3);
    expect(rec.rank).toEqual({ hours: 3, gain: expect.closeTo(rankGain(3, 1), 6) });
    expect(s.rank).toBeCloseTo(rankGain(3, 1), 6);
    expect(on(ctx, 6, 0).rank).toBe(0);
    expect(on(ctx, 6, 0).history[0]!.rank).toBeUndefined();
  });

  it('is worth less when S is lower, so a night after little sleep earns less', () => {
    const ctx = ctxFor(WITH);
    const tired = playDay({ ...startSemester(ctx, 1), day: 6, tags: startSemester(contextFor(0.5, 1, { scenario: {}, courses: WITH, startDebt: 8 }), 1).tags }, ctx, player(2));
    expect(tired.rank).toBeLessThan(on(ctx, 6, 2).rank);
    expect(tired.rank).toBeGreaterThan(0);
  });

  it('adds up over the nights', () => {
    const ctx = ctxFor(WITH);
    let s = startSemester(ctx, 1);
    s = playDay({ ...s, day: 6 }, ctx, player(2));
    const first = s.rank;
    s = playDay(s, ctx, player(2));
    expect(s.rank).toBeGreaterThan(first);
    expect(s.rank).toBeLessThan(2 * first + 1e-9);
  });

  it('counts only the hours that fit before the extended clock stops', () => {
    const ctx = ctxFor(WITH);
    const k = ctx.params;
    const s = on(ctx, 6, MAX_RANK_HOURS, { bed: 25, overtime: true });
    const room = Math.floor(k.bedMax + k.bedOverrun - (25 + k.overtimeBedDelay));
    expect(room).toBeLessThan(MAX_RANK_HOURS);
    expect(s.history[0]!.rank?.hours).toBe(room);
    expect(s.history[0]!.bedEnd).toBe(k.bedMax + k.bedOverrun);
  });

  it('is refused on a closed night, without the card, past the cap, or as a part of an hour', () => {
    expect(() => on(ctxFor(WITH), 5, 1)).toThrow(RangeError);
    expect(() => on(ctxFor(WITHOUT), 6, 1)).toThrow(RangeError);
    expect(() => on(ctxFor(), 6, 1)).toThrow(RangeError);
    expect(() => on(ctxFor(WITH), 6, MAX_RANK_HOURS + 1)).toThrow(RangeError);
    expect(() => on(ctxFor(WITH), 6, 1.5)).toThrow(RangeError);
    expect(() => on(ctxFor(WITH), 6, -1)).toThrow(RangeError);
  });
});

describe('what the player sees of the board', () => {
  it('shows the score and whether tonight is open, only with the algorithms card', () => {
    const seen: DayView[] = [];
    let s = startSemester(ctxFor(WITH), 1);
    for (let i = 0; i < 6; i++) s = playDay(s, ctxFor(WITH), player(0, { seen }));
    expect(seen.map((v) => v.rank?.open)).toEqual([false, false, false, false, false, true]);
    const without: DayView[] = [];
    playDay(startSemester(ctxFor(WITHOUT), 1), ctxFor(WITHOUT), player(0, { seen: without }));
    expect(without[0]).not.toHaveProperty('rank');
    expect(seen[5]!.rank?.score).toBe(0);
  });
});

describe('the final exam', () => {
  const fin = (courses: readonly string[] | undefined, rank: number): number => {
    const ctx = ctxFor(courses);
    return playDay({ ...startSemester(ctx, 1), day: 10, progress: 37, rank }, ctx, player(0)).fin!;
  };

  it('takes 30% of its percent from the board when the card is taken', () => {
    expect(fin(WITH, RANK_FULL) - fin(WITH, 0)).toBeCloseTo(RANK_SHARE * 100, 9);
    expect(fin(WITH, 30) - fin(WITH, 0)).toBeCloseTo(RANK_SHARE * 50, 9);
    expect(fin(WITH, 2 * RANK_FULL)).toBe(fin(WITH, RANK_FULL));
  });

  it('is unchanged by a board when the card is not taken, and the midterm never counts it', () => {
    expect(fin(WITHOUT, RANK_FULL)).toBe(fin(WITHOUT, 0));
    expect(fin(undefined, RANK_FULL)).toBe(fin(undefined, 0));
    const ctx = ctxFor(WITH);
    const mid = (rank: number): number => playDay({ ...startSemester(ctx, 1), day: 5, progress: 18, rank }, ctx, player(0)).mid!;
    expect(mid(RANK_FULL)).toBe(mid(0));
  });
});

describe('the contest hours in a saved run', () => {
  it('survive the run slot and replay to the same score', () => {
    const ctx = ctxFor(WITH);
    const answers: Answer[] = [
      { kind: 'plan', plan: { coffee: [], rest: [] } }, { kind: 'floor', choice: { patrol: 'brain' } },
      { kind: 'night', plan: { bed: 22.5, nextWake: 7, lateNight: 'rest', rank: 2 } },
    ];
    const run = { semester: { seed: 1, courses: WITH, days: [answers] } };
    expect(decode(RUN, encode(RUN, run))).toEqual({ kind: 'ok', data: run });
    const old = JSON.stringify({ schema: 3, data: { semester: { seed: 1, courses: WITH, days: [] } } });
    expect(decode(RUN, old).kind).toBe('migrated');
    const bad = JSON.stringify({ schema: 4, data: { semester: { seed: 1, days: [[{ kind: 'night', plan: { bed: 22.5, nextWake: 7, lateNight: 'rest', rank: -1 } }]] } } });
    expect(decode(RUN, bad).kind).toBe('invalid');
  });
});
