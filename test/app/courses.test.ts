import { describe, expect, it } from 'vitest';
import { fillStr, str } from '../../src/app/content.ts';
import { endSummary, newSemester, resumeSemester, TUTORIAL_COURSES, TUTORIAL_SEED } from '../../src/app/semester.ts';
import { BURDEN_REWARD, burdenOf, creditsOf, decode, encode, runSemester, RUN, selectionProblem, summarize, type SemesterRun } from '../../src/core/index.ts';
import { ARCHETYPES } from '../../sim/semester/archetypes.ts';

const run = (courses?: readonly string[]): SemesterRun => ({ seed: TUTORIAL_SEED, ...(courses ? { courses } : {}), days: [] });

/** The text before the first placeholder of the review line, which marks it among the lines of the last page. */
const REVIEW = str('semester.end.review').split('{')[0]!;
const reviewLine = (burden: 'light' | 'standard', grade: number): string =>
  fillStr('semester.end.review', { points: Math.round(grade * BURDEN_REWARD[burden]), burden: str(`semester.burden.${burden}`), reward: BURDEN_REWARD[burden].toFixed(2) });

describe('the courses of a saved semester', () => {
  it('gives the scripted first week a list that passes the selection rules at the lightest burden', () => {
    expect(selectionProblem([...TUTORIAL_COURSES])).toBeUndefined();
    expect(creditsOf(TUTORIAL_COURSES)).toBe(9);
    expect(burdenOf(9)).toBe('light');
  });

  it('keeps the list through the run slot, and reads a version-1 run as one without courses', () => {
    const picked = run([...TUTORIAL_COURSES]);
    expect(decode(RUN, encode(RUN, { semester: picked }))).toEqual({ kind: 'ok', data: { semester: picked } });
    const v1 = JSON.stringify({ schema: 1, data: { semester: { seed: 7, days: [] } } });
    expect(decode(RUN, v1)).toEqual({ kind: 'migrated', from: 1, data: { semester: { seed: 7, days: [] } } });
    const bad = JSON.stringify({ schema: 2, data: { semester: { seed: 7, courses: 'algorithms', days: [] } } });
    expect(decode(RUN, bad).kind).toBe('invalid');
  });

  it('replays a run on the rules of its courses, and refuses a list that breaks them', () => {
    const back = resumeSemester(run([...TUTORIAL_COURSES]));
    expect(back?.ctx.courses).toEqual([...TUTORIAL_COURSES]);
    expect(resumeSemester(run())?.ctx.courses).toBeUndefined();
    expect(resumeSemester(run(['algorithms']))).toBeUndefined();
    // A card the picker does not offer still replays: rules do not depend on what a build opens.
    expect(resumeSemester(run(['algorithms', 'os', 'database', 'networks']))?.ctx.courses).toEqual(['algorithms', 'os', 'database', 'networks']);
  });

  it('adds the review line to the end of a passed semester only, with the reward of its burden', () => {
    const { ctx } = newSemester(TUTORIAL_SEED, undefined, [...TUTORIAL_COURSES]);
    const outcomes = Object.values(ARCHETYPES).map((strategy) => {
      const end = runSemester(ctx, strategy, TUTORIAL_SEED);
      const sum = summarize(end, ctx);
      const review = endSummary(end, ctx).filter((l) => l.startsWith(REVIEW));
      return { passed: sum.passMid && sum.passFin, review, grade: sum.grade };
    });
    // Both sides must occur, or the check below could hold for a line that is always or never there.
    expect(outcomes.some((o) => o.passed)).toBe(true);
    expect(outcomes.some((o) => !o.passed)).toBe(true);
    for (const o of outcomes) expect(o.review, JSON.stringify(o)).toHaveLength(o.passed ? 1 : 0);
    for (const o of outcomes.filter((x) => x.passed)) expect(o.review).toEqual([reviewLine('light', o.grade)]);
    // At 13 credits the burden is standard and the points are the grade times its reward; at 9 the reward is 1 and a missing factor would not show.
    const full = newSemester(TUTORIAL_SEED, undefined, ['algorithms', 'os', 'database', 'compiler', 'ta']).ctx;
    const heavier = Object.values(ARCHETYPES).flatMap((strategy) => {
      const end = runSemester(full, strategy, TUTORIAL_SEED);
      const sum = summarize(end, full);
      return sum.passMid && sum.passFin ? [{ grade: sum.grade, lines: endSummary(end, full).filter((l) => l.startsWith(REVIEW)) }] : [];
    });
    expect(heavier.length).toBeGreaterThan(0);
    for (const h of heavier) expect(h.lines).toEqual([reviewLine('standard', h.grade)]);
    expect(BURDEN_REWARD.standard).toBeGreaterThan(1);
    const bare = newSemester(TUTORIAL_SEED).ctx;
    const end = runSemester(bare, ARCHETYPES.balanced, TUTORIAL_SEED);
    expect(endSummary(end, bare).some((l) => l.startsWith(REVIEW))).toBe(false);
  });
});
