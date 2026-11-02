import { describe, expect, it } from 'vitest';
import { PARAMS, str } from '../../src/app/content.ts';
import { courseNote, newSemester, projectPrompt, TUTORIAL_SEED, walkPrompt } from '../../src/app/semester.ts';
import { advanceDay, creditsOf, isCommitted, OPEN_COURSES, PROJECT_FROM_DAY, rankSharePercent, SIT_LIMIT, type DayView } from '../../src/core/index.ts';

/** The view of the morning of `day` for a semester that takes `courses`; undefined when the day asks for no plan (the final exam day). */
const morning = (courses: string[], day: number): DayView | undefined => {
  const { ctx, state } = newSemester(TUTORIAL_SEED, undefined, courses);
  const step = advanceDay({ ...state, day }, ctx, []);
  return step.done || step.ask.kind !== 'plan' ? undefined : step.ask.view;
};

const days = Array.from({ length: PARAMS.finDay }, (_, i) => i + 1);
const hasDigit = (key: string): boolean => /\d/.test(str(key).replace(/\{[^{}]*\}/g, ''));
const unfilled = /[{}]/;

describe('the numbers in the card texts come from the rules (issue 42)', () => {
  it('names the contest nights the algorithms card really opens, and the share of the final', () => {
    // The nights are those between the midterm and the final (design doc 8.3), written here on their own.
    const nights = days.filter((d) => d > PARAMS.midDay && d < PARAMS.finDay);
    const open = days.filter((d) => morning(['algorithms', 'os', 'database', 'ta'], d)?.rank?.open);
    expect(open).toEqual(nights);
    expect(courseNote('algorithms')).toContain(`第 ${nights[0]} 到 ${nights.at(-1)} 天晚上`);
    expect(courseNote('algorithms')).toContain(`${rankSharePercent}%`);
  });

  it('names the days and hours the TA card really takes', () => {
    const hoursOn = (d: number): number => Array.from({ length: 24 }, (_, h) => h).filter((h) => isCommitted(['ta'], d, h)).length;
    const taken = days.filter((d) => hoursOn(d) > 0);
    expect(taken).toHaveLength(2);
    expect(hoursOn(taken[0]!)).toBe(hoursOn(taken[1]!));
    expect(courseNote('ta')).toContain(`第 ${taken[0]} 天與第 ${taken[1]} 天下午各有 ${hoursOn(taken[0]!)} 小時`);
  });

  it('names the last day the compiler project can be worked on, and the sit limit in the same question', () => {
    const open = days.filter((d) => morning(['compiler', 'os', 'database', 'ta'], d)?.project?.open);
    expect(open).toEqual(days.filter((d) => d >= PROJECT_FROM_DAY && d < PARAMS.finDay));
    const { title, caption } = projectPrompt({ done: 2.5, need: 10 }, 3, PARAMS);
    expect(title).toContain(`第 ${open.at(-1)} 天晚上前`);
    expect(caption).toContain('專案進度 2.5 / 10');
    expect(caption).toContain('最多排得下 3 小時');
    expect(caption).toContain(`超過 ${SIT_LIMIT} 小時`);
    expect(title + caption).not.toMatch(unfilled);
  });

  it('names the sit limit on every card of the walk question', () => {
    const { title, caption, options } = walkPrompt();
    expect(caption).toContain(`超過 ${SIT_LIMIT} 小時`);
    expect(options[0]!.note).toContain(`坐滿 ${SIT_LIMIT} 小時`);
    expect(options[1]!.label).toContain(`坐滿 ${SIT_LIMIT} 小時`);
    expect([title, caption, ...options.flatMap((o) => [o.label, o.note])].join()).not.toMatch(unfilled);
  });

  it('names the credits of the compiler card', () => {
    expect(courseNote('compiler')).toContain(`${creditsOf(['compiler'])} 學分`);
  });

  it('leaves no placeholder unfilled in the note of any card the picker opens', () => {
    expect(OPEN_COURSES.length).toBeGreaterThan(0);
    for (const c of OPEN_COURSES) expect(courseNote(c.id), c.id).not.toMatch(unfilled);
  });

  it('keeps hardcoded days, hours and credits out of the texts that take them from the rules', () => {
    for (const key of ['course.note.algorithms', 'course.note.compiler', 'course.note.ta', 'semester.grade.title', 'semester.grade.caption', 'semester.gradenight.caption', 'semester.project.title', 'semester.project.caption', 'semester.walk.caption', 'semester.walk.none.note', 'semester.walk.take']) {
      expect(hasDigit(key), key).toBe(false);
    }
  });
});
