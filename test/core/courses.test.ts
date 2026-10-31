import { describe, expect, it } from 'vitest';
import {
  BURDEN_REWARD, burdenOf, committedHours, COURSES, creditsOf, isCommitted, OPEN_COURSES, playDay, reviewPoints, selectionProblem, startSemester, thresholdMult,
  type Course, type SemesterContext, type SemesterState, type Strategy,
} from '../../src/core/index.ts';
import { contextFor } from '../../sim/semester/scenario.ts';

const OPEN = ['algorithms', 'os', 'database', 'compiler', 'ta'];

describe('the course selection (design doc 8.3)', () => {
  it('opens the five cards of the presentation and lists all nine', () => {
    expect(COURSES).toHaveLength(9);
    expect(OPEN_COURSES.map((c) => c.id)).toEqual(OPEN);
    expect(creditsOf(OPEN)).toBe(13);
  });

  it('accepts 4 to 6 cards and refuses the rest, reporting the first rule broken', () => {
    expect(selectionProblem(['algorithms', 'os', 'database', 'ta'])).toBeUndefined();
    expect(selectionProblem(OPEN)).toBeUndefined();
    expect(selectionProblem(['algorithms', 'os', 'database'])).toBe('few');
    expect(selectionProblem(['algorithms', 'os', 'database', 'ta', 'ta'])).toBe('duplicate');
    expect(selectionProblem(['algorithms', 'os', 'database', 'nope'])).toBe('unknown');
    expect(selectionProblem([...OPEN, 'internship'])).toBeUndefined();
    expect(selectionProblem([...OPEN, 'internship', 'networks'])).toBe('many');
    // Which cards are offered is the picker's business: a card the presentation does not open still passes the rules.
    expect(selectionProblem(['algorithms', 'os', 'database', 'networks'])).toBeUndefined();
  });

  it('keeps the credits between 9 and 22 (the top limit is checked on a heavier table)', () => {
    expect(selectionProblem(['ta', 'internship', 'algorithms', 'os'])).toBe('low_credits');
    expect(selectionProblem(['algorithms', 'os', 'database', 'ta'])).toBeUndefined();
    const heavy: readonly Course[] = COURSES.map((c) => ({ ...c, credits: 4 }));
    expect(selectionProblem(['algorithms', 'os', 'software', 'networks', 'database', 'compiler'], heavy)).toBe('high_credits');
  });

  it('puts the burden at 12, 15 and 18 credits, with the reward of the design doc', () => {
    expect([9, 12, 13, 15, 16, 18, 19, 22].map(burdenOf)).toEqual(['light', 'light', 'standard', 'standard', 'heavy', 'heavy', 'full', 'full']);
    expect(BURDEN_REWARD).toEqual({ light: 1, standard: 1.15, heavy: 1.35, full: 1.6 });
    expect(reviewPoints(80, 13)).toBeCloseTo(92);
    expect(reviewPoints(80, 9)).toBe(80);
  });

  it('moves the exam thresholds 8% a credit around the 12 they are tuned for', () => {
    expect(thresholdMult(12)).toBe(1);
    expect(thresholdMult(9)).toBeCloseTo(0.76);
    expect(thresholdMult(13)).toBeCloseTo(1.08);
    expect(thresholdMult(22)).toBeCloseTo(1.8);
  });

  it('takes the TA office hours on the afternoon of days 2 and 8 only when the course is taken', () => {
    expect([...committedHours(['ta'], 2)]).toEqual([16, 17]);
    expect([...committedHours(['ta'], 8)]).toEqual([16, 17]);
    for (const day of [1, 3, 4, 5, 6, 7, 9, 10]) expect(committedHours(['ta'], day).size, `day ${day}`).toBe(0);
    expect(committedHours(['algorithms', 'os'], 2).size).toBe(0);
    for (let day = 1; day <= 10; day++) for (let h = 0; h < 28; h++) expect(isCommitted(['ta'], day, h), `day ${day} hour ${h}`).toBe(committedHours(['ta'], day).has(h));
  });
});

describe('the courses in the semester rules', () => {
  const quiet: Strategy = {
    plan: () => ({ coffee: [], rest: [] }),
    choose: (_id, options) => options[0]!,
    floor: () => ({ patrol: 'brain' }),
    night: () => ({ bed: 22, nextWake: 7, lateNight: 'rest' }),
  };
  const withCourses = (courses?: readonly string[]): SemesterContext => contextFor(0.5, 1, { scenario: {}, ...(courses ? { courses } : {}) });
  const dayOf = (ctx: SemesterContext, day: number): SemesterState => playDay({ ...startSemester(ctx, 1), day }, ctx, quiet);

  it('refuses to start a semester on a selection that breaks a rule', () => {
    expect(() => startSemester(withCourses(['algorithms']), 1)).toThrow(/few/);
    expect(() => startSemester(withCourses(['algorithms', 'os', 'database', 'ta', 'ta']), 1)).toThrow(/duplicate/);
  });

  it('scales both exam thresholds with the credits and leaves a semester without courses as it was', () => {
    const nine = withCourses(['algorithms', 'os', 'database', 'ta']);
    const thirteen = withCourses(OPEN);
    const none = withCourses();
    const mid = (ctx: SemesterContext): number => playDay({ ...startSemester(ctx, 1), day: 5, progress: 18 }, ctx, quiet).mid!;
    const fin = (ctx: SemesterContext): number => playDay({ ...startSemester(ctx, 1), day: 10, progress: 37 }, ctx, quiet).fin!;
    expect(mid(nine)).toBeGreaterThan(mid(none));
    expect(mid(none)).toBeGreaterThan(mid(thirteen));
    expect(fin(nine)).toBeGreaterThan(fin(none));
    expect(fin(none)).toBeGreaterThan(fin(thirteen));
  });

  it('spends the office hours as work, so the day studies two hours less', () => {
    const ta = withCourses(['algorithms', 'os', 'database', 'ta']);
    const plain = withCourses(['algorithms', 'os', 'database', 'compiler']);
    const hours = (ctx: SemesterContext, day: number): number => dayOf(ctx, day).history.at(-1)!.studyHours;
    expect(hours(plain, 2) - hours(ta, 2)).toBe(2);
    expect(hours(plain, 8) - hours(ta, 8)).toBe(2);
    expect(hours(plain, 3)).toBe(hours(ta, 3));
  });
});
