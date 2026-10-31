import { describe, expect, it } from 'vitest';
import { endSummary, newSemester, resumeSemester, TUTORIAL_COURSES, TUTORIAL_SEED } from '../../src/app/semester.ts';
import { burdenOf, creditsOf, decode, encode, runSemester, RUN, selectionProblem, summarize, type SemesterRun } from '../../src/core/index.ts';
import { ARCHETYPES } from '../../sim/semester/archetypes.ts';

const run = (courses?: readonly string[]): SemesterRun => ({ seed: TUTORIAL_SEED, ...(courses ? { courses } : {}), days: [] });

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
    expect(resumeSemester(run(['algorithms', 'os', 'database', 'networks']))).toBeUndefined();
  });

  it('adds the review line to the end of a passed semester only, with the reward of its burden', () => {
    const { ctx } = newSemester(TUTORIAL_SEED, undefined, [...TUTORIAL_COURSES]);
    const outcomes = Object.values(ARCHETYPES).map((strategy) => {
      const end = runSemester(ctx, strategy, TUTORIAL_SEED);
      const sum = summarize(end, ctx);
      const review = endSummary(end, ctx).filter((l) => l.startsWith('學期評價'));
      return { passed: sum.passMid && sum.passFin, review, grade: sum.grade };
    });
    // Both sides must occur, or the check below could hold for a line that is always or never there.
    expect(outcomes.some((o) => o.passed)).toBe(true);
    expect(outcomes.some((o) => !o.passed)).toBe(true);
    for (const o of outcomes) expect(o.review, JSON.stringify(o)).toHaveLength(o.passed ? 1 : 0);
    const first = outcomes.find((o) => o.passed)!;
    expect(first.review[0]).toContain(`${Math.round(first.grade)} 點`);
    expect(first.review[0]).toContain('輕鬆');
    // At 13 credits the burden is standard and the points are the grade times 1.15; at 9 the reward is 1 and a missing factor would not show.
    const full = newSemester(TUTORIAL_SEED, undefined, ['algorithms', 'os', 'database', 'compiler', 'ta']).ctx;
    const heavier = Object.values(ARCHETYPES).flatMap((strategy) => {
      const end = runSemester(full, strategy, TUTORIAL_SEED);
      const sum = summarize(end, full);
      return sum.passMid && sum.passFin ? [{ grade: sum.grade, line: endSummary(end, full).find((l) => l.startsWith('學期評價')) }] : [];
    });
    expect(heavier.length).toBeGreaterThan(0);
    for (const h of heavier) {
      expect(h.line).toContain(`${Math.round(h.grade * 1.15)} 點`);
      expect(h.line).toContain('標準');
      expect(h.line).toContain('×1.15');
    }
    const bare = newSemester(TUTORIAL_SEED).ctx;
    const end = runSemester(bare, ARCHETYPES.balanced, TUTORIAL_SEED);
    expect(endSummary(end, bare).some((l) => l.startsWith('學期評價'))).toBe(false);
  });
});
