import { describe, expect, it } from 'vitest';
import { PARAMS, str } from '../../src/app/content.ts';
import { courseNote, daySummary, endSummary, gradePrompt, morningPlan, newSemester, nightPlan, semesterContext, TUTORIAL_COURSES, TUTORIAL_SEED } from '../../src/app/semester.ts';
import { GRADE_HOURS, GRADE_PAPERS, gradeDays, playDay, runSemester, startSemester, type SemesterContext, type SemesterState } from '../../src/core/index.ts';
import { grader, TA_COURSES } from '../../sim/semester/cards.ts';
import { ARCHETYPES } from '../../sim/semester/archetypes.ts';

const unfilled = /[{}]/;
const due = gradeDays(PARAMS).to;

describe('the grading of the TA line in the screen texts (design doc 8.3)', () => {
  it('names the papers, the hours and the day the grades are due on the card, from the rules', () => {
    expect(courseNote('ta')).toContain(`${GRADE_PAPERS} 份考卷，約 ${GRADE_HOURS} 小時，第 ${due} 天交成績`);
    expect(courseNote('ta')).not.toMatch(unfilled);
  });

  it('fills every placeholder of the morning and the night question, and names what the plan so far leaves', () => {
    const grade = { done: 2, need: GRADE_HOURS, due };
    const day = gradePrompt(grade, false, 3);
    expect(day.title).toContain(`第 ${due} 天交成績`);
    expect(day.caption).toContain(`已改 2 / ${GRADE_HOURS} 小時`);
    expect(day.caption).toContain('最多排得下 3 小時');
    const night = gradePrompt(grade, true, 3);
    expect(night.caption).toContain(`第 ${due} 天就要交成績`);
    expect(day.title + day.caption + night.title + night.caption).not.toMatch(unfilled);
  });

  it('puts the hours in the plans only when there are some, so a run saved without grading replays as it was', () => {
    expect(morningPlan('none', 'grind')).not.toHaveProperty('grade');
    expect(morningPlan('none', 'grind', 0, 0, false, 3)).toMatchObject({ grade: 3 });
    expect(nightPlan('early')).not.toHaveProperty('grade');
    expect(nightPlan('early', 0, 0, 2)).toMatchObject({ grade: 2 });
    // The positional arguments before the new one keep their places.
    expect(morningPlan('none', 'grind', 1, 2, true)).toMatchObject({ write: 1, project: 2, walk: true });
    expect(nightPlan('early', 1, 2)).toMatchObject({ debug: 1, rank: 2 });
  });
});

describe('what the day and the semester say about the grading', () => {
  const ctx: SemesterContext = { ...semesterContext(7, TA_COURSES), scenario: {} };
  const sat = (from: Partial<SemesterState> = {}): SemesterState => ({ ...startSemester(ctx, 7), day: 6, ...from });
  const play = (before: SemesterState, grade: number, night = 0): SemesterState =>
    playDay(before, ctx, { ...ARCHETYPES.balanced, plan: (v) => ({ ...ARCHETYPES.balanced.plan(v), grade }), night: (v) => ({ ...ARCHETYPES.balanced.night(v), ...(night > 0 ? { grade: night } : {}) }) });

  it('tells the hours and the progress of a day that graded, and that the papers are done on the day they are', () => {
    const before = sat();
    const some = daySummary(before, play(before, 3), ctx);
    expect(some).toContain(`批改考卷：改了 3 小時，進度 3 / ${GRADE_HOURS}`);
    expect(some).not.toContain(str('semester.sum.grade.done'));
    const half = sat({ graded: 3 });
    const rest = daySummary(half, play(half, 2), ctx);
    expect(rest).toContain(`批改考卷：改了 2 小時，進度 ${GRADE_HOURS} / ${GRADE_HOURS}`);
    expect(rest).toContain(str('semester.sum.grade.done'));
    // The hours of the night count in the same line as those of the day.
    const both = daySummary(before, play(before, 2, 2), ctx);
    expect(both).toContain(`批改考卷：改了 4 小時，進度 4 / ${GRADE_HOURS}`);
    expect(daySummary(before, play(before, 0), ctx).some((l) => l.startsWith('批改考卷'))).toBe(false);
  });

  it('closes the semester with a line for the papers handed in, or for the day they were not', () => {
    const lines = (when: 'skip' | 'day'): string[] => endSummary(runSemester(ctx, grader(when), 7), ctx);
    expect(lines('day')).toContain(str('semester.end.grade.done'));
    expect(lines('day').join()).not.toContain('沒改完');
    const skipped = lines('skip');
    expect(skipped).toContain(`考卷沒改完，成績沒能在第 ${due} 天交出去`);
    expect(skipped).not.toContain(str('semester.end.grade.done'));
  });

  it('says nothing of the papers to a semester without the card', () => {
    const none = { ...semesterContext(7, ['os', 'database', 'networks', 'algorithms']), scenario: {} };
    const lines = endSummary(runSemester(none, ARCHETYPES.balanced, 7), none);
    expect(lines.some((l) => l.includes('考卷'))).toBe(false);
  });

  it('is part of the tutorial semester, which takes the TA line', () => {
    expect(TUTORIAL_COURSES).toContain('ta');
    const { ctx: tutorial, state } = newSemester(TUTORIAL_SEED, undefined, TUTORIAL_COURSES);
    expect(startSemester(tutorial, TUTORIAL_SEED).graded).toBe(0);
    expect(state.graded).toBe(0);
  });
});
