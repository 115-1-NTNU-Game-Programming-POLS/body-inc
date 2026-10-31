import { describe, expect, it } from 'vitest';
import {
  advanceDay, playDay, runSemester, startSemester, type Answer, type Ask, type SemesterContext, type SemesterState, type Strategy,
} from '../../src/core/index.ts';
import { ARCHETYPES, type ArchetypeName } from '../../sim/semester/archetypes.ts';
import { bingeWeek, contextFor, scenarioFor } from '../../sim/semester/scenario.ts';

const answerFrom = (strategy: Strategy, ask: Ask): Answer => {
  switch (ask.kind) {
    case 'plan': return { kind: 'plan', plan: strategy.plan(ask.view) };
    case 'event': return { kind: 'event', option: strategy.choose(ask.id, ask.options, ask.view) };
    case 'floor': return { kind: 'floor', choice: strategy.floor(ask.view) };
    case 'night': return { kind: 'night', plan: strategy.night(ask.view) };
  }
};

/** One day, answered one question at a time the way a screen would; also returns the questions in the order asked. */
function playByAsking(s: SemesterState, ctx: SemesterContext, strategy: Strategy): { state: SemesterState; asked: Ask[] } {
  const answers: Answer[] = [];
  const asked: Ask[] = [];
  for (let guard = 0; guard < 50; guard++) {
    const step = advanceDay(s, ctx, answers);
    if (step.done) return { state: step.state, asked };
    asked.push(step.ask);
    answers.push(answerFrom(strategy, step.ask));
  }
  throw new Error('the day never stopped asking');
}

function playAll(ctx: SemesterContext, strategy: Strategy, seed: number): SemesterState {
  let s = startSemester(ctx, seed);
  for (let day = 0; !s.ended; day++) {
    if (day > ctx.params.days) throw new Error('the semester never ended');
    s = playByAsking(s, ctx, strategy).state;
  }
  return s;
}

describe('asking a day one question at a time (build plan L3, the player side)', () => {
  it('plays exactly the semester that runSemester plays for the same choices', () => {
    for (const name of Object.keys(ARCHETYPES) as ArchetypeName[]) {
      for (const seed of [1, 2, 3, 4, 5]) {
        for (const scenario of [scenarioFor, bingeWeek]) {
          const ctx = contextFor(0.5, seed, { scenario: scenario(seed) });
          expect(playAll(ctx, ARCHETYPES[name], seed), `${name}, seed ${seed}`).toEqual(runSemester(ctx, ARCHETYPES[name], seed));
        }
      }
    }
  });

  it('asks the plan first, then each event as it comes, then the floor, then the night', () => {
    const ctx = contextFor(0.5, 1, { scenario: { 2: ['bbq', 'deadline'] } });
    const day1 = playByAsking(startSemester(ctx, 1), ctx, ARCHETYPES.balanced);
    expect(day1.asked.map((a) => a.kind)).toEqual(['plan', 'floor', 'night']);
    const day2 = playByAsking(day1.state, ctx, ARCHETYPES.balanced);
    // The deadline comes at 14:00 and the barbecue at 20:00.
    expect(day2.asked.map((a) => (a.kind === 'event' ? `event:${a.id}` : a.kind))).toEqual(['plan', 'event:deadline', 'event:bbq', 'floor', 'night']);
  });

  it('hands the event its options, and the view never carries a floor load', () => {
    const ctx = contextFor(0.5, 1, { scenario: { 1: ['bbq'] } });
    const { asked } = playByAsking(startSemester(ctx, 1), ctx, ARCHETYPES.balanced);
    const bbq = asked.find((a) => a.kind === 'event');
    expect(bbq && bbq.kind === 'event' && bbq.options).toEqual(['decline', 'sober', 'drink', 'drink_fasting', 'binge']);
    for (const a of asked) expect(Object.keys(a.view)).not.toContain('loads');
  });

  it('asks nothing on the final exam day, which is sat on waking', () => {
    const ctx = contextFor(0.5, 1, { scenario: {} });
    let s = startSemester(ctx, 1);
    while (s.day < ctx.params.finDay) s = playByAsking(s, ctx, ARCHETYPES.balanced).state;
    const step = advanceDay(s, ctx, []);
    expect(step.done).toBe(true);
    expect(step.done && step.state.ended).toBe(true);
  });

  it('is a function of the state and the answers, so asking again repeats the question', () => {
    const ctx = contextFor(0.5, 1);
    const s = startSemester(ctx, 1);
    expect(advanceDay(s, ctx, [])).toEqual(advanceDay(s, ctx, []));
    expect(playDay(s, ctx, ARCHETYPES.balanced)).toEqual(playByAsking(s, ctx, ARCHETYPES.balanced).state);
  });

  it('refuses an answer of the wrong kind, an option the event lacks, and an answer left over', () => {
    const ctx = contextFor(0.5, 1, { scenario: { 1: ['bbq'] } });
    const s = startSemester(ctx, 1);
    const plan: Answer = { kind: 'plan', plan: { coffee: [], rest: [] } };
    expect(() => advanceDay(s, ctx, [{ kind: 'night', plan: { bed: 22, nextWake: 7, lateNight: 'rest' } }])).toThrow(/asked for "plan"/);
    expect(() => advanceDay(s, ctx, [plan, { kind: 'event', option: 'shots' }])).toThrow(/not an option of event "bbq"/);
    const whole: Answer[] = [plan, { kind: 'event', option: 'decline' }, { kind: 'floor', choice: { patrol: 'brain' } }, { kind: 'night', plan: { bed: 22, nextWake: 7, lateNight: 'rest' } }];
    expect(advanceDay(s, ctx, whole).done).toBe(true);
    expect(() => advanceDay(s, ctx, [...whole, plan])).toThrow(/ended after 4 answers but 5 were given/);
  });
});
