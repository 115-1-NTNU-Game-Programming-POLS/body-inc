import { describe, expect, it } from 'vitest';
import { fillStr, PARAMS, str } from '../../src/app/content.ts';
import { courseNote, newSemester, TUTORIAL_SEED } from '../../src/app/semester.ts';
import { advanceDay, isCommitted, projectDue, rankNights, SIT_LIMIT, type DayView } from '../../src/core/index.ts';

/** The view of the morning of `day` for a semester that takes `courses`; undefined when the day asks for no plan (the final exam day). */
const morning = (courses: string[], day: number): DayView | undefined => {
  const { ctx, state } = newSemester(TUTORIAL_SEED, undefined, courses);
  const step = advanceDay({ ...state, day }, ctx, []);
  return step.done || step.ask.kind !== 'plan' ? undefined : step.ask.view;
};

const days = Array.from({ length: PARAMS.finDay }, (_, i) => i + 1);
const hasDigit = (key: string): boolean => /\d/.test(str(key).replace(/\{[^{}]*\}/g, ''));

describe('the numbers in the card texts come from the rules (issue 42)', () => {
  it('names the contest nights the algorithms card really opens, and the share of the final', () => {
    const open = days.filter((d) => morning(['algorithms', 'os', 'database', 'ta'], d)?.rank?.open);
    expect(open.length).toBeGreaterThan(0);
    const { from, to } = rankNights(PARAMS);
    expect([open[0], open.at(-1)]).toEqual([from, to]);
    expect(open).toHaveLength(to - from + 1);
    expect(courseNote('algorithms')).toContain(`第 ${from} 到 ${to} 天晚上`);
    expect(courseNote('algorithms')).toContain('30%');
  });

  it('names the days and hours the TA card really takes', () => {
    const taken = days.filter((d) => isCommitted(['ta'], d, 16));
    expect(taken).toHaveLength(2);
    const hours = Array.from({ length: 24 }, (_, h) => h).filter((h) => isCommitted(['ta'], taken[0]!, h));
    expect(courseNote('ta')).toContain(`第 ${taken[0]} 天與第 ${taken[1]} 天下午各有 ${hours.length} 小時`);
  });

  it('names the last day the compiler project can be worked on', () => {
    const open = days.filter((d) => morning(['compiler', 'os', 'database', 'ta'], d)?.project?.open);
    expect(open.at(-1)).toBe(projectDue(PARAMS));
    expect(fillStr('semester.project.title', { due: projectDue(PARAMS) })).toContain(`第 ${open.at(-1)} 天晚上前`);
  });

  it('names the credits of the compiler card and the sit limit of its stuck point', () => {
    expect(courseNote('compiler')).toContain('4 學分');
    for (const key of ['semester.project.caption', 'semester.walk.caption', 'semester.walk.none.note', 'semester.walk.take']) {
      expect(str(key), key).toContain('{limit}');
      expect(fillStr(key, { limit: SIT_LIMIT, done: 0, need: 10, room: 3 }), key).not.toMatch(/[{}]/);
    }
  });

  it('leaves no placeholder unfilled in any card note, and no hardcoded day, hour or credit count in the texts that take one', () => {
    const { ctx } = newSemester(TUTORIAL_SEED, undefined, ['algorithms', 'os', 'database', 'ta']);
    for (const c of ctx.courses ?? []) expect(courseNote(c), c).not.toMatch(/[{}]/);
    for (const key of ['course.note.algorithms', 'course.note.compiler', 'course.note.ta', 'semester.project.title', 'semester.project.caption', 'semester.walk.caption', 'semester.walk.none.note', 'semester.walk.take']) {
      expect(hasDigit(key), key).toBe(false);
    }
  });
});
