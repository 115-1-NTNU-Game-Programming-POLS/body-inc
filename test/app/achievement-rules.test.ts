import { describe, expect, it } from 'vitest';
import { commendation, newSemester } from '../../src/app/semester.ts';
import {
  ACHIEVEMENTS, earnedAchievements, GRADE_HOURS, OS_ASSIGNMENTS, playDay, rankNights, type AchievementId, type DayRecord, type SemesterContext,
  type SemesterState, type Strategy,
} from '../../src/core/index.ts';

/** The achievements of design doc 8.14 beyond 主動健檢, each read from a whole semester's record. */

const quiet: Strategy = {
  plan: () => ({ coffee: [], rest: [] }),
  choose: (_id, options) => options[0]!,
  floor: () => ({ patrol: 'brain' }),
  night: () => ({ bed: 22, nextWake: 7, lateNight: 'rest' }),
};

/** A semester without a barbecue played to its end in bed at 22:00, then given exam marks that pass (or fail) it. */
function full(courses?: string[], clause = 0, strategy: Strategy = quiet, pass = true): { ctx: SemesterContext; s: SemesterState } {
  const { ctx, state } = newSemester(1, [], courses, clause);
  let s = state;
  while (!s.ended) s = playDay(s, ctx, strategy);
  return { ctx, s: { ...s, mid: pass ? 100 : 0, fin: pass ? 100 : 0 } };
}
const withDay = (s: SemesterState, day: number, patch: Partial<DayRecord>): SemesterState =>
  ({ ...s, history: s.history.map((r) => (r.day === day ? { ...r, ...patch } : r)) });
const has = (s: SemesterState, ctx: SemesterContext, id: AchievementId): boolean => earnedAchievements(s, ctx).includes(id);

describe('準時下班', () => {
  it('needs every night in bed by 01:00 and the semester passed', () => {
    const { ctx, s } = full();
    expect(has(s, ctx, 'on_time')).toBe(true);
    expect(has(withDay(s, 4, { bedEnd: 25 }), ctx, 'on_time')).toBe(true);
    expect(has(withDay(s, 4, { bedEnd: 25.5 }), ctx, 'on_time')).toBe(false);
    expect(has(full(undefined, 0, quiet, false).s, ctx, 'on_time')).toBe(false);
  });
});

describe('早上那一杯', () => {
  it('needs a cup, every cup before noon, and the semester passed', () => {
    const { ctx, s } = full();
    expect(has(s, ctx, 'morning_cup')).toBe(false);
    const morning = withDay(withDay(s, 2, { coffee: [8] }), 5, { coffee: [9, 11] });
    expect(has(morning, ctx, 'morning_cup')).toBe(true);
    expect(has(withDay(morning, 6, { coffee: [12] }), ctx, 'morning_cup')).toBe(false);
    expect(has({ ...morning, fin: 0 }, ctx, 'morning_cup')).toBe(false);
  });

  it('is read from the cups the days really drank, not the plan', () => {
    const coffee: Strategy = { ...quiet, plan: (v) => ({ coffee: v.day === 2 ? [3, 8, 17] : [], rest: [] }) };
    const { ctx, s } = full(undefined, 0, coffee);
    // 03:00 is before waking, so that cup is never drunk.
    expect(s.history.find((r) => r.day === 2)!.coffee).toEqual([8, 17]);
    expect(s.history.filter((r) => r.day !== 2).every((r) => r.coffee === undefined)).toBe(true);
    expect(has(s, ctx, 'morning_cup')).toBe(false);
  });
});

describe('見好就收', () => {
  const ALGO = ['algorithms', 'os', 'database', 'networks'];

  it('needs the algorithms card, the contest played, every night of it in bed by 24:00, and the semester passed', () => {
    const { ctx, s } = full(ALGO);
    const { from, to } = rankNights(ctx.params);
    const played = withDay(s, from, { rank: { hours: 1, gain: 10 } });
    expect(has(s, ctx, 'call_it_a_night')).toBe(false);
    expect(has(played, ctx, 'call_it_a_night')).toBe(true);
    expect(has(withDay(played, to, { bedEnd: 24 }), ctx, 'call_it_a_night')).toBe(true);
    expect(has(withDay(played, to, { bedEnd: 24.5 }), ctx, 'call_it_a_night')).toBe(false);
    // A late night before the contest opened is not one of its nights.
    expect(has(withDay(played, from - 1, { bedEnd: 25 }), ctx, 'call_it_a_night')).toBe(true);
    expect(has({ ...played, fin: 0 }, ctx, 'call_it_a_night')).toBe(false);
    const other = full(['os', 'database', 'networks', 'software']);
    expect(has(withDay(other.s, from, { rank: { hours: 1, gain: 10 } }), other.ctx, 'call_it_a_night')).toBe(false);
  });
});

describe('留好緩衝', () => {
  it('needs the operating-systems card and the writing of both assignments begun two days or more before each is due', () => {
    const { ctx, s } = full(['os', 'database', 'networks', 'software']);
    expect(s.homework.map((a) => a.due)).toEqual(OS_ASSIGNMENTS.map((a) => a.due));
    const begin = (day: number, n: number) => (st: SemesterState) => withDay(st, day, { homework: [{ n, wrote: 1, debugged: 0, done: false, missed: false }] });
    const [first, second] = OS_ASSIGNMENTS;
    const early = begin(second!.due - 2, 2)(begin(first!.due - 2, 1)(s));
    expect(has(s, ctx, 'leave_buffer')).toBe(false);
    expect(has(early, ctx, 'leave_buffer')).toBe(true);
    // Passing does not come into it: the buffer is the behaviour.
    expect(has({ ...early, fin: 0 }, ctx, 'leave_buffer')).toBe(true);
    expect(has(begin(first!.due - 1, 1)(begin(second!.due - 2, 2)(s)), ctx, 'leave_buffer')).toBe(false);
    expect(has(begin(first!.due - 2, 1)(s), ctx, 'leave_buffer')).toBe(false);
  });
});

describe('也坐過台下', () => {
  const TA = ['ta', 'os', 'database', 'networks'];
  it('needs the TA card, every paper graded, and no night of grading past 00:00', () => {
    const { ctx, s } = full(TA);
    const graded = withDay({ ...s, graded: GRADE_HOURS }, 3, { gradeNight: 2, bedEnd: 24 });
    expect(has(graded, ctx, 'from_the_seats')).toBe(true);
    expect(has(withDay(graded, 3, { bedEnd: 24.5 }), ctx, 'from_the_seats')).toBe(false);
    // A late night without grading does not count against it.
    expect(has(withDay(graded, 4, { bedEnd: 25 }), ctx, 'from_the_seats')).toBe(true);
    expect(has({ ...graded, graded: GRADE_HOURS - 1 }, ctx, 'from_the_seats')).toBe(false);
  });

  it('is earned by a TA who grades at night and is in bed at 24:00', () => {
    const grader: Strategy = {
      ...quiet,
      plan: (v) => ({ coffee: [], rest: [], ...(v.grade?.open === true && v.grade.need > v.grade.done ? { grade: 1 } : {}) }),
      night: (v) => ({ bed: 22, nextWake: 7, lateNight: 'rest', ...(v.grade?.open === true && v.grade.night ? { grade: Math.min(2, v.grade.need - v.grade.done) } : {}) }),
    };
    const { ctx, s } = full(TA, 0, grader);
    const nights = s.history.filter((r) => r.gradeNight !== undefined);
    expect(nights.length).toBeGreaterThan(0);
    for (const r of nights) expect(r.gradeNight).toBeLessThanOrEqual(r.grade!.hours);
    expect(s.graded).toBe(GRADE_HOURS);
    expect(has(s, ctx, 'from_the_seats')).toBe(true);
  });
});

describe('學年結業', () => {
  it('needs the semester passed under clause 2', () => {
    const two = full(undefined, 2);
    expect(has(two.s, two.ctx, 'year_done')).toBe(true);
    expect(has({ ...two.s, fin: 0 }, two.ctx, 'year_done')).toBe(false);
    const one = full(undefined, 1);
    expect(has(one.s, one.ctx, 'year_done')).toBe(false);
  });
});

describe('the commendations', () => {
  it('mark every unlock that does not exist yet as not open, and only 主動健檢 has one that does', () => {
    for (const id of ACHIEVEMENTS) {
      const unlock = commendation(id).lines[2]!;
      expect(unlock.endsWith('（尚未開放）'), id).toBe(id !== 'active_checkup');
    }
  });
});
