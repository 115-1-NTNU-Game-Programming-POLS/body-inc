import { describe, expect, it } from 'vitest';
import { fillStr } from '../../src/app/content.ts';
import { daySummary, floorChoice, morningPlan, newSemester, nightPlan, resumeSemester, TUTORIAL_COURSES, TUTORIAL_SEED } from '../../src/app/semester.ts';
import { advanceDay, decode, encode, HOMEWORK_PROGRESS, RUN, WRITE_HOURS, type Answer, type SemesterRun } from '../../src/core/index.ts';

/** Plays days 1 to `through` of the tutorial semester, writing the first assignment on day 2 and debugging on the night of `debugNight`. */
function played(through: number, opts: { debugNight?: number } = {}): { run: SemesterRun; ctx: ReturnType<typeof newSemester>['ctx']; states: ReturnType<typeof newSemester>['state'][] } {
  const { ctx, state } = newSemester(TUTORIAL_SEED, undefined, [...TUTORIAL_COURSES]);
  let s = state;
  const states = [s];
  const days: Answer[][] = [];
  while (s.day <= through) {
    const answers: Answer[] = [];
    for (;;) {
      const step = advanceDay(s, ctx, answers);
      if (step.done) {
        s = step.state;
        break;
      }
      const { ask } = step;
      if (ask.kind === 'plan') answers.push({ kind: 'plan', plan: morningPlan('none', 'balanced', ask.view.day === 2 ? WRITE_HOURS : 0) });
      else if (ask.kind === 'event') answers.push({ kind: 'event', option: ask.options[0]! });
      else if (ask.kind === 'floor') answers.push({ kind: 'floor', choice: floorChoice('brain') });
      else answers.push({ kind: 'night', plan: nightPlan('early', ask.view.day === opts.debugNight ? Math.min(4, ask.view.homework[0]?.debug ?? 0) : 0) });
    }
    days.push(answers);
    states.push(s);
  }
  return { run: { seed: TUTORIAL_SEED, courses: [...TUTORIAL_COURSES], days }, ctx, states };
}

describe('the assignments in a saved semester', () => {
  it('keeps the hours of writing and debugging through the run slot and replays to the same state', () => {
    const { run, states } = played(3, { debugNight: 2 });
    const wrote = run.days[1]!.find((a) => a.kind === 'plan')!;
    expect(wrote).toMatchObject({ plan: { write: WRITE_HOURS } });
    expect(JSON.stringify(run.days[1])).toContain('"debug"');
    expect(decode(RUN, encode(RUN, { semester: run }))).toEqual({ kind: 'ok', data: { semester: run } });
    expect(resumeSemester(run)?.state).toEqual(states.at(-1));
  });

  it('reads a version-2 run as it was, and refuses a negative number of hours', () => {
    const v2 = JSON.stringify({ schema: 2, data: { semester: { seed: 7, courses: [...TUTORIAL_COURSES], days: [] } } });
    expect(decode(RUN, v2).kind).toBe('migrated');
    const bad = JSON.stringify({ schema: 3, data: { semester: { seed: 7, days: [[{ kind: 'plan', plan: { coffee: [], rest: [], write: -1 } }]] } } });
    expect(decode(RUN, bad).kind).toBe('invalid');
  });

  it('refuses a replay whose hours no longer fit (writing on a day with nothing to write)', () => {
    const { run } = played(2);
    const days = run.days.map((d, i) => (i === 0 ? d.map((a) => (a.kind === 'plan' ? { kind: 'plan' as const, plan: { ...a.plan, write: 2 } } : a)) : d));
    expect(resumeSemester({ ...run, days })).toBeUndefined();
  });
});

describe('what the player is told after a day with an assignment', () => {
  it('lists the hours written and debugged, the hand-in with its progress, and the miss', () => {
    const { ctx, states } = played(4, { debugNight: 2 });
    const line = (key: string, vars: Record<string, string | number>): string => fillStr(key, vars);
    const day2 = daySummary(states[1]!, states[2]!, ctx);
    expect(day2).toContain(line('semester.sum.hw.wrote', { n: 1, hours: WRITE_HOURS }));
    const spent = states[2]!.homework[0]!.debugged;
    expect(spent).toBeGreaterThan(0);
    expect(day2).toContain(line('semester.sum.hw.debugged', { n: 1, hours: spent }));
    const handedIn = states[2]!.homework[0]!.done;
    expect(day2.includes(line('semester.sum.hw.done', { n: 1, p: HOMEWORK_PROGRESS }))).toBe(handedIn);
    const day4 = daySummary(states[3]!, states[4]!, ctx);
    expect(day4.includes(line('semester.sum.hw.missed', { n: 1 }))).toBe(!handedIn);
    expect(daySummary(states[0]!, states[1]!, ctx).some((l) => l.startsWith('作業'))).toBe(false);
  });
});
