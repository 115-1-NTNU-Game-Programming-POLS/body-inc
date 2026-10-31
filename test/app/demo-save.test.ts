import { describe, expect, it } from 'vitest';
import { DEMO_RUN } from '../../src/app/demo.ts';
import { floorChoice, resumeSemester, TUTORIAL_SEED } from '../../src/app/semester.ts';
import { advanceDay, decode, encode, RUN, type Answer, type DayView, type SemesterState } from '../../src/core/index.ts';

const morning = (): { state: SemesterState; view: DayView } => {
  const back = resumeSemester(DEMO_RUN);
  if (back === undefined) throw new Error('the demo save no longer replays');
  const step = advanceDay(back.state, back.ctx, []);
  if (step.done || step.ask.kind !== 'plan') throw new Error('the morning did not ask for a plan');
  return { state: back.state, view: step.ask.view };
};

/** Plays the days from the demo's morning, patrolling `first` on day 4 and the brain after, with the plan and bed of the save. */
const playOn = (first: 'liver' | 'brain', until: number): SemesterState => {
  const back = resumeSemester(DEMO_RUN)!;
  let state = back.state;
  while (state.day <= until) {
    const answers: Answer[] = [];
    for (;;) {
      const step = advanceDay(state, back.ctx, answers);
      if (step.done) {
        state = step.state;
        break;
      }
      const { ask } = step;
      if (ask.kind === 'floor') answers.push({ kind: 'floor', choice: floorChoice(state.day === 4 ? first : 'brain') });
      else if (ask.kind === 'plan') answers.push(DEMO_RUN.days[0]![0]!);
      else if (ask.kind === 'night') answers.push(DEMO_RUN.days[0]!.at(-1)!);
      else answers.push({ kind: 'event', option: ask.options[0]! });
    }
  }
  return state;
};

describe('the demo save (design doc 14.1)', () => {
  it('is a run of the scripted first week that replays to the morning of day 4', () => {
    expect(DEMO_RUN.seed).toBe(TUTORIAL_SEED);
    expect(DEMO_RUN.days).toHaveLength(3);
    expect(morning().state.day).toBe(4);
    expect(decode(RUN, encode(RUN, { semester: DEMO_RUN }))).toEqual({ kind: 'ok', data: { semester: DEMO_RUN } });
  });

  it('answers the barbecue of day 2 with the binge and nothing else', () => {
    const events = DEMO_RUN.days.map((answers) => answers.filter((a) => a.kind === 'event'));
    expect(events).toEqual([[], [{ kind: 'event', option: 'binge' }], []]);
  });

  it('shows the demo opening: a dark panel with the liver\'s order on file and the stomach jammed', () => {
    const { view } = morning();
    expect(view.panel.buttons.map((b) => b.light)).toEqual(view.panel.buttons.map(() => 'off'));
    expect(view.liverClues).toMatchObject({ orders: [2], stomachJam: true });
    expect(view.sleepDebt).toBeGreaterThan(0.5);
  });

  it('leads to the midterm on day 5 with the result it had when the demo was written', () => {
    const { mid } = playOn('liver', 6);
    expect(Math.round(mid ?? NaN)).toBe(86);
    expect(Math.round(playOn('brain', 6).mid ?? NaN)).toBe(86);
  });

  it('lets the liver be patrolled on day 4 and clears the jam', () => {
    const state = playOn('liver', 4);
    expect(state.history.at(-1)?.patrols.map((p) => p.floor)).toEqual(['liver']);
    const back = resumeSemester(DEMO_RUN)!;
    const step = advanceDay(state, back.ctx, []);
    if (step.done || step.ask.kind !== 'plan') throw new Error('expected the morning of day 5');
    expect(step.ask.view.liverClues.stomachJam).toBe(false);
  });

  it('is refused once an answer no longer fits (a changed option)', () => {
    const days = DEMO_RUN.days.map((d) => d.map((a) => (a.kind === 'event' ? { ...a, option: 'gone' } : a)));
    expect(resumeSemester({ seed: DEMO_RUN.seed, days })).toBeUndefined();
  });
});
