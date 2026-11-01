import { describe, expect, it } from 'vitest';
import { fillStr, str } from '../../src/app/content.ts';
import { daySummary, endSummary, morningPlan, newSemester, nightPlan } from '../../src/app/semester.ts';
import { creditsOf, playDay, PROJECT_FIN_PENALTY, PROJECT_NEED, PROJECT_REVIEW, reviewPoints, summarize, type SemesterState, type Strategy } from '../../src/core/index.ts';

const player = (project: number, walk: boolean): Strategy => ({
  plan: () => morningPlan('none', 'balanced', 0, project, walk),
  choose: (_id, options) => options[0]!,
  floor: () => ({ patrol: 'brain' }),
  night: () => nightPlan('early'),
});

const WITH = ['compiler', 'os', 'database', 'ta'];
const WITHOUT = ['os', 'database', 'networks', 'ta'];

describe('what the player is told about the compiler project', () => {
  it('lists the hours given and the progress, and says when it is done', () => {
    const { ctx, state } = newSemester(1, [], WITH);
    const before = { ...state, day: 8 };
    const after = playDay(before, ctx, player(3, false));
    expect(daySummary(before, after, ctx)).toContain(fillStr('semester.sum.project', { hours: 3, done: after.project.toFixed(1), need: PROJECT_NEED }));
    expect(daySummary(before, after, ctx)).not.toContain(str('semester.sum.project.done'));
    const nearly = { ...before, project: PROJECT_NEED - 0.1 };
    expect(daySummary(nearly, playDay(nearly, ctx, player(4, false)), ctx)).toContain(str('semester.sum.project.done'));
    expect(daySummary(before, playDay(before, ctx, player(0, false)), ctx).some((l) => l.startsWith('專案'))).toBe(false);
  });

  it('closes the semester with the review points or the penalty, and with nothing without the card or after bankruptcy', () => {
    const end = (courses: readonly string[], project: number): { ctx: ReturnType<typeof newSemester>['ctx']; s: SemesterState } => {
      const { ctx, state } = newSemester(1, [], courses);
      return { ctx, s: playDay({ ...state, day: 10, mid: 80, progress: 40, project }, ctx, player(0, false)) };
    };
    const done = end(WITH, PROJECT_NEED);
    expect(endSummary(done.s, done.ctx)).toContain(fillStr('semester.end.project.done', { points: PROJECT_REVIEW }));
    const missed = end(WITH, 1);
    expect(endSummary(missed.s, missed.ctx)).toContain(fillStr('semester.end.project.fail', { points: PROJECT_FIN_PENALTY }));
    const without = end(WITHOUT, 0);
    expect(endSummary(without.s, without.ctx).some((l) => l.includes('專案'))).toBe(false);
    expect(endSummary({ ...missed.s, bankrupt: true }, missed.ctx).some((l) => l.includes('專案'))).toBe(false);
  });

  it('pays the review points into the review line, and only for a passed semester', () => {
    const { ctx, state } = newSemester(1, [], WITH);
    const end = (progress: number, project: number): SemesterState => playDay({ ...state, day: 10, mid: 80, progress, project }, ctx, player(0, false));
    const reviewOf = (s: SemesterState): number => Number(/學期評價：(\d+) 點/.exec(endSummary(s, ctx).find((l) => l.startsWith('學期評價'))!)![1]);
    const done = end(40, PROJECT_NEED);
    const grade = summarize(done, ctx).grade;
    expect(summarize(done, ctx).passFin).toBe(true);
    expect(reviewOf(done)).toBe(Math.round(reviewPoints(grade, creditsOf(WITH), PROJECT_REVIEW)));
    expect(reviewOf(done)).toBeGreaterThan(Math.round(reviewPoints(grade, creditsOf(WITH))));
    const failed = end(0, PROJECT_NEED);
    expect(summarize(failed, ctx).passFin).toBe(false);
    expect(endSummary(failed, ctx).some((l) => l.includes('另加') || l.startsWith('學期評價'))).toBe(false);
  });

  it('leaves the penalty line out when the final was spent in hospital, where nothing was sat to take it off', () => {
    const { ctx, state } = newSemester(1, [], WITH);
    const hospital = playDay({ ...state, day: 10, mid: 80, progress: 40, project: 0, hospitalDay: 10 }, ctx, player(0, false));
    expect(hospital.history.at(-1)!.kind).toBe('hospital');
    expect(endSummary(hospital, ctx).some((l) => l.includes('專案'))).toBe(false);
  });
});
