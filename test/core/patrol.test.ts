import { describe, expect, it } from 'vitest';
import {
  advanceDay, decode, encode, EMPTY_LOADS, GRADES, HITS_FOR_A, MIST, NO_TALLY, patrolReduction, playDay, ratePatrol, RUN, runSemester, startSemester, tallyPatrol,
  type FloorChoice, type Grade, type PatrolResult, type SemesterContext, type SemesterState, type Strategy,
} from '../../src/core/index.ts';
import { ARCHETYPES } from '../../sim/semester/archetypes.ts';
import { contextFor } from '../../sim/semester/scenario.ts';

const ctx: SemesterContext = contextFor(0.5, 1, { scenario: {} });

const striker = (choice: FloorChoice): Strategy => ({
  plan: () => ({ coffee: [], rest: [] }),
  choose: (_id, options) => options[0]!,
  floor: () => choice,
  night: () => ({ bed: 22.5, nextWake: 7, lateNight: 'rest' }),
});

/** Day 2 from a state whose brain sits at 80 (orange, under a strike, high enough that no rating cuts it to the floor), after one patrol of `choice`. */
const brainAfter = (choice: FloorChoice): number => {
  const from: SemesterState = { ...startSemester(ctx, 1), day: 2, loads: { ...EMPTY_LOADS, brain: 80 } };
  return playDay(from, ctx, striker(choice)).loads.brain;
};

describe('the rating of a played patrol (design doc 8.5)', () => {
  const goals = (core: boolean, side: boolean) => ({ core, side });

  it('is C at most without the core goal, however clean the run', () => {
    expect(ratePatrol(NO_TALLY, goals(false, true))).toEqual({ grade: 'C' });
  });

  it('lifts B one step for few hits and one for the side goal, so S needs both', () => {
    const rate = (hits: number, side: boolean) => ratePatrol({ hits, forced: false, records: 0 }, goals(true, side));
    expect(rate(HITS_FOR_A + 1, false)).toEqual({ grade: 'B' });
    expect(rate(HITS_FOR_A, false)).toEqual({ grade: 'A' });
    expect(rate(HITS_FOR_A + 1, true)).toEqual({ grade: 'A' });
    expect(rate(0, true)).toEqual({ grade: 'S' });
    expect(rate(HITS_FOR_A, true)).toEqual({ grade: 'S' });
  });

  it('is a failure after a forced clock-out, even with every goal done', () => {
    expect(ratePatrol({ hits: 0, forced: true, records: 0 }, goals(true, true))).toEqual({ failed: true });
  });

  it('counts the perfect dodges as records, and puts them on the rating only when there are some', () => {
    const t = tallyPatrol(NO_TALLY, [{ type: 'perfectDodge' }, { type: 'dodge' }, { type: 'perfectDodge' }, { type: 'perfectDodge' }]);
    expect(t).toEqual({ hits: 0, forced: false, records: 3 });
    expect(ratePatrol(t, goals(true, false))).toEqual({ grade: 'A', records: 3 });
    expect(ratePatrol(t, goals(false, false))).toEqual({ grade: 'C', records: 3 });
    expect(ratePatrol(NO_TALLY, goals(true, false))).toEqual({ grade: 'A' });
    expect(ratePatrol({ ...t, forced: true }, goals(true, true))).toEqual({ failed: true });
  });

  it('does not count a perfect dodge that only the automatic-perfect assist made perfect', () => {
    const t = tallyPatrol(NO_TALLY, [{ type: 'perfectDodge' }, { type: 'perfectDodge', assisted: true }, { type: 'perfectDodge', assisted: true }, { type: 'perfectDodge' }]);
    expect(t).toEqual({ hits: 0, forced: false, records: 2 });
    // Only assisted dodges: nothing changes, so the rating carries no records.
    expect(tallyPatrol(NO_TALLY, [{ type: 'perfectDodge', assisted: true }])).toBe(NO_TALLY);
  });

  it('counts the hearts lost and the forced clock-out among a patrol\'s events, and nothing else', () => {
    const t = tallyPatrol(NO_TALLY, [{ type: 'heartLost' }, { type: 'dodge' }, { type: 'clung' }, { type: 'hit' }]);
    expect(t).toEqual({ hits: 2, forced: false, records: 0 });
    expect(tallyPatrol(t, [{ type: 'heartLost', cause: MIST.cause }])).toBe(t);
    expect(tallyPatrol(t, [{ type: 'forcedLeave' }])).toEqual({ hits: 2, forced: true, records: 0 });
    expect(tallyPatrol(t, [{ type: 'dodge' }])).toBe(t);
  });
});

describe('a played patrol in the semester', () => {
  it('cuts the load by the rating it earned, one step of the ladder per rating', () => {
    const loads = GRADES.map((grade) => brainAfter({ patrol: 'brain', played: [{ grade }] }));
    GRADES.forEach((grade, i) => {
      if (i > 0) expect(loads[i - 1]! - loads[i]!, `${GRADES[i - 1]} to ${grade}`).toBeCloseTo(ctx.params.floorPatrolPerGrade, 6);
    });
    expect(brainAfter({ patrol: 'brain', played: [{ grade: 'C' }] })).toBe(brainAfter({ patrol: 'gut' }) - patrolReduction('C', ctx.params) - ctx.params.floorNeglect);
  });

  it('cuts nothing when it failed, but still waives the neglect bonus of a floor past yellow', () => {
    const failed = brainAfter({ patrol: 'brain', played: [{ failed: true }] });
    const skipped = brainAfter({ patrol: 'gut' });
    const cut: Grade = 'C';
    expect(skipped - failed).toBeCloseTo(ctx.params.floorNeglect, 6);
    expect(brainAfter({ patrol: 'brain', played: [{ grade: cut }] })).toBeCloseTo(failed - patrolReduction(cut, ctx.params), 6);
  });

  it('records the failure, which reads as a C that cut nothing', () => {
    const from: SemesterState = { ...startSemester(ctx, 1), day: 2 };
    const rec = playDay(from, ctx, striker({ patrol: 'brain', played: [{ failed: true }] })).history.at(-1)!;
    expect(rec.patrols).toEqual([{ floor: 'brain', grade: 'C', overtime: false, failed: true }]);
  });

  it('draws a floor with no rooms to play from the skill, the one next to it being played', () => {
    const from: SemesterState = { ...startSemester(ctx, 1), day: 2 };
    const drawn = playDay(from, ctx, striker({ patrol: 'gut', overtime: 'brain' })).history.at(-1)!.patrols;
    const mixed = playDay(from, ctx, striker({ patrol: 'gut', overtime: 'brain', played: [null, { grade: 'S' }] })).history.at(-1)!.patrols;
    expect(mixed[0]).toEqual(drawn[0]);
    expect(mixed[1]).toEqual({ floor: 'brain', grade: 'S', overtime: true });
  });

  it('asks for one result for each floor chosen, and a rating that exists', () => {
    const from: SemesterState = { ...startSemester(ctx, 1), day: 2 };
    expect(() => playDay(from, ctx, striker({ patrol: 'brain', overtime: 'liver', played: [{ grade: 'A' }] }))).toThrow(/1 played patrols were given for 2 chosen/);
    expect(() => playDay(from, ctx, striker({ patrol: 'brain', played: [{ grade: 'A' }, { grade: 'A' }] }))).toThrow(/2 played patrols were given for 1 chosen/);
    expect(() => playDay(from, ctx, striker({ patrol: 'brain', played: [{ grade: 'Z' as Grade }] }))).toThrow(/not a rating/);
  });

  it('replays a whole semester to the same state as the skill-drawn one when each result is the grade the skill drew', () => {
    // The draw is made whether or not the rooms were played: skipping it would shift the stream the exams are drawn from.
    for (const name of ['nightOwl', 'balanced'] as const) {
      const base = ARCHETYPES[name];
      const baseline = runSemester(ctx, base, 4);
      const drawn = new Map(baseline.history.map((r) => [r.day, r.patrols.map((p): PatrolResult => ({ grade: p.grade }))]));
      const played: Strategy = {
        ...base,
        floor: (view, tags) => ({ ...base.floor(view, tags), ...(drawn.get(view.day)?.length ? { played: drawn.get(view.day)! } : {}) }),
      };
      expect(baseline.history.some((r) => r.patrols.length > 0), name).toBe(true);
      expect(runSemester(ctx, played, 4), name).toEqual(baseline);
    }
  });

  it('hands the floor question the tags of the moment, which the rooms are entered with', () => {
    const asked: string[] = [];
    const from: SemesterState = { ...startSemester(ctx, 1), day: 2 };
    let step = advanceDay(from, ctx, []);
    const answers = [] as Parameters<typeof advanceDay>[2][number][];
    for (let i = 0; i < 20 && !step.done; i++) {
      const ask = step.ask;
      asked.push(ask.kind);
      if (ask.kind === 'floor') {
        expect(ask.tags).toBeDefined();
        return;
      }
      answers.push(
        ask.kind === 'plan' ? { kind: 'plan', plan: { coffee: [], rest: [] } }
          : ask.kind === 'event' ? { kind: 'event', option: ask.options[0]! }
            : { kind: 'night', plan: { bed: 22.5, nextWake: 7, lateNight: 'rest' } },
      );
      step = advanceDay(from, ctx, answers);
    }
    throw new Error(`the day never asked for a floor: ${asked.join(', ')}`);
  });
});

describe('the run slot with played patrols', () => {
  const played = [{ grade: 'A' as const }, { failed: true as const }, null];
  const run = {
    semester: {
      seed: 3,
      days: [[{ kind: 'floor' as const, choice: { patrol: 'brain' as const, overtime: 'liver' as const, played } }]],
    },
  };

  it('keeps the results through a save', () => {
    expect(decode(RUN, encode(RUN, run))).toEqual({ kind: 'ok', data: run });
  });

  it('reads a run saved before the patrols were played, which has no results', () => {
    const old = { semester: { seed: 3, days: [[{ kind: 'floor', choice: { patrol: 'brain' } }]] } };
    expect(decode(RUN, JSON.stringify({ schema: 7, data: old }))).toEqual({ kind: 'migrated', from: 7, data: old });
  });

  it('refuses a result that is neither a rating nor a failure', () => {
    for (const bad of [{ grade: 'Z' }, { failed: false }, {}, { grade: 'A', failed: true }]) {
      const data = { semester: { seed: 3, days: [[{ kind: 'floor', choice: { patrol: 'brain', played: [bad] } }]] } };
      expect(decode(RUN, JSON.stringify({ schema: 9, data })).kind, JSON.stringify(bad)).toBe('invalid');
    }
  });
});
