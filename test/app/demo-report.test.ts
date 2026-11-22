import { describe, expect, it } from 'vitest';
import { REPORT_LAST, REPORT_RUN } from '../../src/app/demo.ts';
import { resumeSemester, REST_PLANS, visitReport } from '../../src/app/semester.ts';
import { advanceDay, decode, encode, RUN, type Answer, type SemesterState } from '../../src/core/index.ts';

/** Plays the run and then the last day, giving the report the scene would build on each day's end. */
function play() {
  const back = resumeSemester(REPORT_RUN);
  if (back === undefined) throw new Error('the report run no longer replays');
  const step = advanceDay(back.state, back.ctx, REPORT_LAST);
  if (!step.done) throw new Error('the last day asks for more than it is given');
  return { ...back, morning: back.state, after: step.state };
}

/** The reports of every day of the run, in order, from the same state the scene builds them from. */
function reports(days: readonly (readonly Answer[])[] = REPORT_RUN.days): { day: number; kind: string }[] | 'a day asks for more than it is given' {
  const back = resumeSemester({ ...REPORT_RUN, days: [] })!;
  let state: SemesterState = back.state;
  const out: { day: number; kind: string }[] = [];
  for (const answers of [...days, REPORT_LAST]) {
    const step = advanceDay(state, back.ctx, answers);
    if (!step.done) return 'a day asks for more than it is given';
    state = step.state;
    const doc = visitReport(state, back.ctx, REPORT_RUN.seed, new Set());
    if (doc) out.push({ day: state.history.length, kind: doc.kind });
  }
  return out;
}

describe('the pre-generated report (design doc 14.1, ux-spec 6)', () => {
  it('is a run of six days that replays to the morning of day 7, a format the run slot accepts', () => {
    expect(REPORT_RUN.days).toHaveLength(6);
    const { morning } = play();
    expect(morning.day).toBe(7);
    expect(morning.ended).toBe(false);
    expect(decode(RUN, encode(RUN, { semester: REPORT_RUN }))).toEqual({ kind: 'ok', data: { semester: REPORT_RUN } });
  });

  it('writes a closure notice on day 4 and a bankruptcy report on day 7, and the semester ends there', () => {
    expect(reports()).toEqual([{ day: 4, kind: 'notice' }, { day: 7, kind: 'bankruptcy' }]);
    expect(play().after.ended).toBe(true);
  });

  it('gives the last day\'s report as a finished document that unlocks the sleep page', () => {
    const { ctx, after } = play();
    const doc = visitReport(after, ctx, REPORT_RUN.seed, new Set())!;
    expect(doc.unlock).toBe('sleep_debt');
    expect(doc.lines.join('\n')).not.toMatch(/[{}]/);
    // The earlier visit is cited, which only a report written from the whole causal log can do.
    expect(doc.lines.join('\n')).toContain('人體急字第 0401 號');
  });

  it('gives no report for a last day that is not played to its night', () => {
    const { ctx, morning } = play();
    const step = advanceDay(morning, ctx, REPORT_LAST.slice(0, 1));
    expect(step.done).toBe(false);
  });

  it('is moved by its answers: with the long rest of the menu the operator is still sent away on day 4 but the company stays open', () => {
    const days = REPORT_RUN.days.map((answers) => answers.map((a): Answer => (a.kind === 'plan' ? { kind: 'plan', plan: { ...a.plan, rest: [...REST_PLANS.easy] } } : a)));
    // Not a string: a day that asks for more than it is given would differ too, and prove nothing about the rules.
    expect(reports(days)).toEqual([{ day: 4, kind: 'notice' }]);
  });
});
