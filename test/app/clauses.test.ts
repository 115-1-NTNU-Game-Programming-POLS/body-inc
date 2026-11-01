import { describe, expect, it } from 'vitest';
import { PARAMS, str } from '../../src/app/content.ts';
import {
  clauseName, clauseNote, daySummary, endSummary, finishSemester, newSemester, resumeSemester, semesterCleared, settingLines, TUTORIAL_COURSES, TUTORIAL_SEED,
} from '../../src/app/semester.ts';
import { SaveStore } from '../../src/app/storage.ts';
import {
  advanceDay, CLAUSE_CREDIT_CAP, clauseFinMult, commitmentsOf, decode, DEFAULT_HOST, encode, MAX_CLAUSE, PROGRESS, RUN, runSemester, settingHours, withClause, type Answer, type ProgressData, type SemesterContext, type SemesterRun, type SemesterState, type Strategy,
} from '../../src/core/index.ts';
import { ARCHETYPES } from '../../sim/semester/archetypes.ts';

const COURSES = ['algorithms', 'os', 'compiler', 'ta'];
/** Cards with nothing to hand in, so the plain balanced player has no assignment or project to miss. */
const PLAIN = ['database', 'networks', 'software', 'ta'];
const unfilled = /[{}]/;

/** A seed whose setting card is `id`, found rather than assumed so the tests do not depend on how the draw falls. */
const seedWith = (id: 'shifts' | 'lab'): number => {
  for (let seed = 1; seed < 200; seed++) if (newSemester(seed, undefined, COURSES, 2).ctx.setting?.id === id) return seed;
  throw new Error(`no seed under 200 draws ${id}`);
};

/** Plays the answers that end a day on the first option of every question, until `until` days are finished. */
function playDays(seed: number, clause: number, until: number): { ctx: SemesterContext; state: SemesterState; days: Answer[][] } {
  const { ctx, state: start } = newSemester(seed, undefined, COURSES, clause);
  let state = start;
  const days: Answer[][] = [];
  while (days.length < until) {
    const answers: Answer[] = [];
    for (;;) {
      const step = advanceDay(state, ctx, answers);
      if (step.done) {
        state = step.state;
        break;
      }
      answers.push(
        step.ask.kind === 'plan' ? { kind: 'plan', plan: { coffee: [], rest: [] } }
          : step.ask.kind === 'event' ? { kind: 'event', option: step.ask.options[0]! }
            : step.ask.kind === 'floor' ? { kind: 'floor', choice: { patrol: 'gut' } }
              : { kind: 'night', plan: { bed: 22.5, nextWake: PARAMS.wake, lateNight: 'rest' } },
      );
    }
    days.push(answers);
  }
  return { ctx, state, days };
}

/** The lines of the summary of `day` in a semester at level 2 that played the days before it on the first option of every question. */
function summaryOn(seed: number, day: number): { ctx: SemesterContext; lines: string[] } {
  const { ctx, state: before } = playDays(seed, 2, day - 1);
  const answers: Answer[] = [];
  for (;;) {
    const step = advanceDay(before, ctx, answers);
    if (step.done) return { ctx, lines: daySummary(before, step.state, ctx) };
    answers.push(
      step.ask.kind === 'plan' ? { kind: 'plan', plan: { coffee: [], rest: [] } }
        : step.ask.kind === 'event' ? { kind: 'event', option: step.ask.options[0]! }
          : step.ask.kind === 'floor' ? { kind: 'floor', choice: { patrol: 'gut' } }
            : { kind: 'night', plan: { bed: 22.5, nextWake: PARAMS.wake, lateNight: 'rest' } },
    );
  }
}
describe('starting a semester under a clause', () => {
  it('puts the level and its setting card in the context, and none in the scripted first week', () => {
    const { ctx } = newSemester(seedWith('shifts'), undefined, COURSES, 2);
    expect(ctx.clause).toBe(2);
    expect(ctx.setting?.id).toBe('shifts');
    expect(ctx.finMult).toBeCloseTo(clauseFinMult(2), 12);
    const tutorial = newSemester(TUTORIAL_SEED, undefined, [...TUTORIAL_COURSES], 2).ctx;
    expect(tutorial.clause).toBeUndefined();
    expect(tutorial.setting).toBeUndefined();
    expect(tutorial.finMult).toBeUndefined();
  });

  it('draws the card from the events the semester really has, a dev barbecue override included', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { ctx } = newSemester(seed, [2, 3, 4], COURSES, 2);
      for (const c of ctx.setting!.commitments) expect([2, 3, 4], `seed ${seed}`).not.toContain(c.day);
    }
  });

  it('refuses a selection the clause does not stand with', () => {
    expect(() => newSemester(1, undefined, ['algorithms', 'os', 'database', 'compiler'], 2)).toThrow(RangeError);
    expect(() => newSemester(1, undefined, ['algorithms', 'os', 'database', 'compiler'], 1)).not.toThrow();
  });

  it('refuses to give a context a second clause, which would compound the final multiplier', () => {
    const once = newSemester(3, undefined, COURSES, 1).ctx;
    expect(() => withClause(once, 3, 2)).toThrow(RangeError);
    expect(() => withClause(once, 3, 0)).toThrow(RangeError);
  });
});

describe('a saved run keeps its clause', () => {
  it('replays to the same card and the same state, and is stale for a level the rules do not have', () => {
    const seed = seedWith('lab');
    const { ctx, state, days } = playDays(seed, 2, 3);
    const run: SemesterRun = { seed, courses: COURSES, clause: 2, days };
    const back = resumeSemester(run);
    expect(back?.ctx.setting).toEqual(ctx.setting);
    expect(back?.state.day).toBe(state.day);
    expect(back?.state.progress).toBe(state.progress);
    expect(resumeSemester({ ...run, clause: MAX_CLAUSE + 1 })).toBeUndefined();
    // Without the field the run replays as level 0, which is not the semester it was played at.
    const { clause: _gone, ...unmarked } = run;
    expect(resumeSemester(unmarked)?.ctx.setting).toBeUndefined();
  });

  it('is written to the run slot with the level and read back', () => {
    const run: SemesterRun = { seed: 5, courses: COURSES, clause: 2, days: [] };
    expect(decode(RUN, encode(RUN, { semester: run }))).toEqual({ kind: 'ok', data: { semester: run } });
    const bad = JSON.stringify({ schema: 7, data: { semester: { seed: 5, clause: -1, days: [] } } });
    expect(decode(RUN, bad).kind).toBe('invalid');
  });

  it('opens a run saved before the clauses as they were', () => {
    const v6 = JSON.stringify({ schema: 6, data: { semester: { seed: 5, courses: COURSES, days: [] } } });
    expect(decode(RUN, v6)).toEqual({ kind: 'migrated', from: 6, data: { semester: { seed: 5, courses: COURSES, days: [] } } });
  });
});

describe('the unlocked level is kept in the progress', () => {
  const fresh: ProgressData = { handbook: [], hostName: DEFAULT_HOST, semestersDone: 0 };
  const store = (): { saves: SaveStore; data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { saves: new SaveStore({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) }), data };
  };

  it('opens the next level when the top one is cleared, and writes it', () => {
    const { saves, data } = store();
    const one = finishSemester(saves, fresh, { level: 0, cleared: true });
    expect(one.progress).toEqual({ ...fresh, semestersDone: 1, clauseUnlocked: 1 });
    const two = finishSemester(saves, one.progress, { level: 1, cleared: true });
    expect(two.progress.clauseUnlocked).toBe(2);
    expect(decode(PROGRESS, data.get('hbc.v1.progress') ?? null).data.clauseUnlocked).toBe(2);
  });

  it('opens nothing for a failed semester, a lower level, or the last level', () => {
    const { saves } = store();
    const at = (unlocked: number): ProgressData => ({ ...fresh, clauseUnlocked: unlocked });
    expect(finishSemester(saves, at(1), { level: 1, cleared: false }).progress.clauseUnlocked).toBe(1);
    expect(finishSemester(saves, at(2), { level: 0, cleared: true }).progress.clauseUnlocked).toBe(2);
    expect(finishSemester(saves, at(MAX_CLAUSE), { level: MAX_CLAUSE, cleared: true }).progress.clauseUnlocked).toBe(MAX_CLAUSE);
  });

  it('leaves the progress alone when the semester does not say what it played', () => {
    expect(finishSemester(store().saves, fresh).progress).toEqual({ ...fresh, semestersDone: 1 });
  });

  it('opens a progress saved before the clauses with none unlocked', () => {
    const v3 = JSON.stringify({ schema: 3, data: { handbook: [], hostName: DEFAULT_HOST, semestersDone: 2 } });
    expect(decode(PROGRESS, v3)).toEqual({ kind: 'migrated', from: 3, data: { handbook: [], hostName: DEFAULT_HOST, semestersDone: 2 } });
    expect(decode(PROGRESS, encode(PROGRESS, { ...fresh, clauseUnlocked: 2 })).data.clauseUnlocked).toBe(2);
    expect(decode(PROGRESS, JSON.stringify({ schema: 4, data: { ...fresh, clauseUnlocked: -1 } })).kind).toBe('invalid');
  });

  it('counts a semester as cleared when both exams were passed, and not when none of it was studied', () => {
    const slacker: Strategy = { ...ARCHETYPES.balanced, plan: () => ({ coffee: [], rest: Array.from({ length: 14 }, (_, i) => 8 + i) }) };
    const cleared = [1, 2, 3, 4, 5].map((seed) => {
      const { ctx } = newSemester(seed, undefined, PLAIN);
      return [semesterCleared(runSemester(ctx, ARCHETYPES.balanced, seed), ctx), semesterCleared(runSemester(ctx, slacker, seed), ctx)] as const;
    });
    expect(cleared.map(([studied]) => studied)).toContain(true);
    expect(cleared.map(([, idle]) => idle)).toEqual([false, false, false, false, false]);
  });
});

describe('what the player is told', () => {
  it('names the clause and the whole schedule of the setting card on the first morning, from the rules', () => {
    const seed = seedWith('shifts');
    const { ctx } = newSemester(seed, undefined, COURSES, 2);
    const lines = settingLines(ctx, 1);
    expect(lines).toHaveLength(2);
    const days = ctx.setting!.commitments.map((c) => c.day);
    const hours = ctx.setting!.commitments[0]!.hours;
    expect(lines[0]).toContain(`加班條款 2，${clauseName(2)}`);
    expect(lines[0]).toContain(`×${clauseFinMult(2)}`);
    expect(lines[1]).toContain(`第 ${days.join('、')} 天`);
    expect(lines[1]).toContain(`${Math.min(...hours)} 點到 ${Math.max(...hours) + 1} 點`);
    expect(lines.join()).not.toMatch(unfilled);
  });

  it('names the hours of the lab on its own, and only on the days it falls on', () => {
    const { ctx } = newSemester(seedWith('lab'), undefined, COURSES, 2);
    const fall = ctx.setting!.commitments.map((c) => c.day);
    const day = fall.find((d) => d !== 1)!;
    const hours = settingHours(ctx.setting, day);
    expect(settingLines(ctx, day)).toEqual([`今天 ${Math.min(...hours)} 點到 ${Math.max(...hours) + 1} 點有實驗課。`]);
    const free = Array.from({ length: PARAMS.days }, (_, i) => i + 2).find((d) => !fall.includes(d))!;
    expect(settingLines(ctx, free)).toEqual([]);
  });

  it('says only the clause at level 1 and nothing at level 0', () => {
    expect(settingLines(newSemester(3, undefined, COURSES, 1).ctx, 1)).toHaveLength(1);
    expect(settingLines(newSemester(3, undefined, COURSES, 1).ctx, 4)).toEqual([]);
    expect(settingLines(newSemester(3, undefined, COURSES).ctx, 1)).toEqual([]);
    expect(settingLines(newSemester(TUTORIAL_SEED, undefined, [...TUTORIAL_COURSES], 2).ctx, 1)).toEqual([]);
  });

  it('counts the hours the card really took in the summary of its day', () => {
    const seed = seedWith('shifts');
    const { ctx, lines } = summaryOn(seed, newSemester(seed, undefined, COURSES, 2).ctx.setting!.commitments[0]!.day);
    expect(lines).toContain(`排班表：占去 ${ctx.setting!.commitments[0]!.hours.length} 小時`);
    expect(lines.join()).not.toMatch(unfilled);
  });

  it('does not count the hours another block already held, as on a day the lab meets the TA office hours', () => {
    const ta = commitmentsOf('ta').map((c) => c.day);
    let found: { seed: number; day: number } | undefined;
    for (let seed = 1; seed < 400 && found === undefined; seed++) {
      const setting = newSemester(seed, undefined, COURSES, 2).ctx.setting;
      const day = setting?.id === 'lab' ? setting.commitments.find((c) => ta.includes(c.day))?.day : undefined;
      if (day !== undefined) found = { seed, day };
    }
    expect(found, 'a seed whose lab falls on an office-hour day').toBeDefined();
    const { ctx, lines } = summaryOn(found!.seed, found!.day);
    const k = ctx.params;
    const held = (h: number): boolean => k.classes.includes(h) || k.meals.includes(h) || commitmentsOf('ta').some((c) => c.day === found!.day && c.hours.includes(h));
    const taken = settingHours(ctx.setting, found!.day).filter((h) => !held(h)).length;
    expect(taken).toBeLessThan(settingHours(ctx.setting, found!.day).length - 2);
    expect(lines).toContain(`實驗課：占去 ${taken} 小時`);
  });
  it('writes the clause and what the clear opened into the end of the semester', () => {
    const { ctx, state } = playDays(7, 1, 10);
    expect(state.ended).toBe(true);
    const plain = endSummary(state, ctx);
    expect(plain[0]).toBe(`加班條款 1：${clauseName(1)}`);
    expect(plain.join()).not.toContain('解鎖');
    const opened = endSummary(state, ctx, 2);
    expect(opened).toContain(`通過了，加班條款 2「${clauseName(2)}」解鎖。`);
    expect(endSummary(playDays(7, 0, 10).state, playDays(7, 0, 10).ctx).join()).not.toContain('加班條款');
  });

  it('fills every note of the picker, with the numbers taken from the rules', () => {
    for (let level = 0; level <= MAX_CLAUSE; level++) {
      expect(clauseNote(level), `level ${level}`).not.toMatch(unfilled);
      expect(clauseName(level), `level ${level}`).not.toMatch(unfilled);
    }
    expect(clauseNote(1)).toContain(`×${clauseFinMult(1)}`);
    expect(clauseNote(2)).toContain(`${CLAUSE_CREDIT_CAP[2]} 學分`);
    for (const key of ['course.clause.note.1', 'course.clause.note.2', 'course.pick.problem.clause', 'semester.clause.intro', 'semester.setting.intro.shifts', 'semester.setting.intro.lab', 'semester.setting.today.shifts', 'semester.setting.today.lab', 'semester.sum.setting', 'semester.end.clause.unlock']) {
      expect(/\d/.test(str(key).replace(/\{[^{}]*\}/g, '')), key).toBe(false);
    }
  });
});
