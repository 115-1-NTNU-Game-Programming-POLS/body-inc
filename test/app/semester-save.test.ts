import { describe, expect, it } from 'vitest';
import { newSemester, resumeSemester } from '../../src/app/semester.ts';
import {
  advanceDay, checkSlotDef, decode, encode, RUN, type Answer, type Ask, type SemesterRun, type SemesterState, type Strategy,
} from '../../src/core/index.ts';
import { ARCHETYPES, type ArchetypeName } from '../../sim/semester/archetypes.ts';

const answerFrom = (strategy: Strategy, ask: Ask): Answer => {
  switch (ask.kind) {
    case 'plan': return { kind: 'plan', plan: strategy.plan(ask.view) };
    case 'event': return { kind: 'event', option: strategy.choose(ask.id, ask.options, ask.view) };
    case 'floor': return { kind: 'floor', choice: strategy.floor(ask.view) };
    case 'night': return { kind: 'night', plan: strategy.night(ask.view) };
  }
};

/** The semester played to its end, with the state and the saved run at every morning. */
function play(seed: number, strategy: Strategy): { mornings: { state: SemesterState; run: SemesterRun }[]; end: SemesterState } {
  const { ctx, state } = newSemester(seed);
  const mornings = [{ state, run: { seed, days: [] as Answer[][] } }];
  let s = state;
  const days: Answer[][] = [];
  while (!s.ended) {
    const answers: Answer[] = [];
    for (let guard = 0; guard < 50; guard++) {
      const step = advanceDay(s, ctx, answers);
      if (step.done) {
        s = step.state;
        break;
      }
      answers.push(answerFrom(strategy, step.ask));
    }
    days.push(answers);
    if (!s.ended) mornings.push({ state: s, run: { seed, days: days.map((d) => [...d]) } });
  }
  return { mornings, end: s };
}

describe('the semester save (run slot)', () => {
  it('is a well-formed slot definition', () => {
    expect(() => checkSlotDef(RUN)).not.toThrow();
    expect(decode(RUN, null)).toEqual({ kind: 'empty', data: { semester: null } });
  });

  it('replays to the very state the player was in, at every morning of every kind of semester', () => {
    for (const name of Object.keys(ARCHETYPES) as ArchetypeName[]) {
      for (const seed of [1, 2, 3]) {
        const { mornings } = play(seed, ARCHETYPES[name]);
        for (const [i, m] of mornings.entries()) {
          // Through the stored text, as a reload would.
          const stored = decode(RUN, encode(RUN, { semester: m.run }));
          expect(stored.kind, `${name} ${seed} day ${i + 1}`).toBe('ok');
          const back = resumeSemester(stored.data.semester!);
          expect(back?.state, `${name} ${seed} day ${i + 1}`).toEqual(m.state);
        }
      }
    }
  });

  it('goes on from a resumed morning to the same ending as a semester that was never interrupted', () => {
    const strategy = ARCHETYPES.balanced;
    const { mornings, end } = play(2, strategy);
    const mid = mornings[Math.floor(mornings.length / 2)]!;
    const back = resumeSemester(mid.run)!;
    let s = back.state;
    while (!s.ended) {
      const answers: Answer[] = [];
      for (;;) {
        const step = advanceDay(s, back.ctx, answers);
        if (step.done) {
          s = step.state;
          break;
        }
        answers.push(answerFrom(strategy, step.ask));
      }
    }
    expect(s).toEqual(end);
  });

  it('deals the same events for the same seed, so a saved seed is enough', () => {
    expect(newSemester(7).ctx.scenario).toEqual(newSemester(7).ctx.scenario);
    expect(JSON.stringify(newSemester(7).ctx.scenario)).not.toBe(JSON.stringify(newSemester(8).ctx.scenario));
  });

  describe('a save the rules no longer fit', () => {
    const { mornings, end } = play(1, ARCHETYPES.balanced);
    const some = mornings[3]!.run;

    it('is refused when an answer is of the wrong kind or names an option the event does not have', () => {
      const swapped = some.days.map((d, i) => (i === 0 ? [d[1]!, d[0]!, ...d.slice(2)] : d));
      expect(resumeSemester({ seed: some.seed, days: swapped })).toBeUndefined();
      const bad = some.days.map((d) => d.map((a) => (a.kind === 'event' ? { ...a, option: 'no_such_option' } : a)));
      expect(some.days.some((d) => d.some((a) => a.kind === 'event')), 'the sample needs an event to rename').toBe(true);
      expect(resumeSemester({ seed: some.seed, days: bad })).toBeUndefined();
    });

    it('is refused when a day is missing answers or has too many', () => {
      expect(resumeSemester({ seed: some.seed, days: [some.days[0]!.slice(0, -1)] })).toBeUndefined();
      expect(resumeSemester({ seed: some.seed, days: [[...some.days[0]!, some.days[0]![0]!]] })).toBeUndefined();
    });

    it('is refused when it replays to the end of the semester, which is never saved', () => {
      const full = play(1, ARCHETYPES.balanced);
      expect(full.end.ended).toBe(true);
      expect(end.ended).toBe(true);
      const lastMorning = full.mornings.at(-1)!.run;
      // One more finished day than the last morning has is the end of the semester.
      const { ctx } = newSemester(1);
      const finishing: Answer[] = [];
      const lastState = full.mornings.at(-1)!.state;
      for (;;) {
        const step = advanceDay(lastState, ctx, finishing);
        if (step.done) break;
        finishing.push(answerFrom(ARCHETYPES.balanced, step.ask));
      }
      expect(resumeSemester({ seed: 1, days: [...lastMorning.days, finishing] })).toBeUndefined();
    });
  });

  describe('storage', () => {
    const run: SemesterRun = {
      seed: 5,
      days: [[
        { kind: 'plan', plan: { coffee: [8], rest: [21] } },
        { kind: 'event', option: 'decline' },
        { kind: 'floor', choice: { patrol: 'brain', overtime: 'liver' } },
        { kind: 'night', plan: { bed: 24.5, nextWake: 7, lateNight: 'study' } },
      ]],
    };
    const text = (data: unknown): string => JSON.stringify({ schema: 1, data });

    it('keeps a run exactly', () => {
      expect(decode(RUN, encode(RUN, { semester: run }))).toEqual({ kind: 'ok', data: { semester: run } });
    });

    it('starts empty when the stored text is not a run', () => {
      for (const bad of [
        { semester: { seed: -1, days: [] } },
        { semester: { seed: 1.5, days: [] } },
        { semester: { seed: 1 } },
        { semester: { seed: 1, days: [[{ kind: 'floor', choice: { patrol: 'heart' } }]] } },
        { semester: { seed: 1, days: [[{ kind: 'night', plan: { bed: 24, nextWake: 7, lateNight: 'play' } }]] } },
        { semester: { seed: 1, days: [[{ kind: 'plan', plan: { coffee: [8], rest: [] }, extra: 1 }]] } },
        { semester: { seed: 1, days: [[{ kind: 'sleep' }]] } },
        { semester: { seed: 1, days: [], extra: true } },
      ]) {
        const d = decode(RUN, text(bad));
        expect(d.kind, JSON.stringify(bad)).toBe('invalid');
        expect(d.data).toEqual({ semester: null });
      }
    });
  });
});
