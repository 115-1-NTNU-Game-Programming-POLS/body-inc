import { describe, expect, it } from 'vitest';
import {
  flag, infectionChance, playDay, record, runSemester, startSemester, type Illness, type SemesterContext, type SemesterState, type Strategy,
} from '../../src/core/index.ts';
import { ARCHETYPES } from '../../sim/semester/archetypes.ts';
import { contextFor } from '../../sim/semester/scenario.ts';

const base = contextFor(0.5, 1, { scenario: {} });
const K = base.params;
const withParams = (patch: Partial<SemesterContext['params']>): SemesterContext => ({ ...base, params: { ...base.params, ...patch } });
// No exposure: the ladder tests start the cold themselves and nothing else is caught.
const SHUT = withParams({ campusExposure: 0, roommateExposure: 0 });

const night = (bed: number, nextWake = 7): Strategy => ({
  plan: () => ({ coffee: [], rest: [] }),
  choose: (_id, options) => options[0]!,
  floor: () => ({ patrol: 'brain' }),
  night: () => ({ bed, nextWake, lateNight: 'rest' }),
});
const early = night(22);
const late = night(26);

function ill(stage: Illness, nights: number, ctx = SHUT): SemesterState {
  const s = startSemester(ctx, 1);
  const [log, node] = record(s.tags.log, { kind: 'rule', key: 'infection', at: 0, causes: [] });
  return { ...s, tags: { ...s.tags, log }, illness: { stage, nights, node } };
}
const stages = (s0: SemesterState, ctx: SemesterContext, plan: readonly Strategy[]): (Illness | undefined)[] => {
  let s = s0;
  for (const strategy of plan) s = playDay(s, ctx, strategy);
  return s.history.map((r) => r.illness);
};

describe('the chance of catching a cold (design doc 9.1)', () => {
  it('is 0.3 raised by the immune load, chronic stress, a debt of 3 hours and a striking immune floor', () => {
    expect(infectionChance(0, false, 0, false, K)).toBeCloseTo(0.3);
    expect(infectionChance(50, false, 0, false, K)).toBeCloseTo(0.45);
    expect(infectionChance(0, true, 0, false, K)).toBeCloseTo(0.45);
    expect(infectionChance(0, false, 2.9, false, K)).toBeCloseTo(0.3);
    expect(infectionChance(0, false, 3, false, K)).toBeCloseTo(0.42);
    expect(infectionChance(0, false, 0, true, K)).toBeCloseTo(0.6);
    expect(infectionChance(100, true, 3, true, K)).toBe(1);
  });

  it('catches on every exposure when both chances are certain, and the morning tells the strategy', () => {
    const ctx = withParams({ campusExposure: 1, infBase: 1 });
    const seen: (Illness | undefined)[] = [];
    const spy: Strategy = { ...late, plan: (v) => { seen.push(v.illness); return late.plan(v); } };
    let s = startSemester(ctx, 1);
    for (let i = 0; i < 3; i++) s = playDay(s, ctx, spy);
    expect(s.history.map((r) => r.infected !== undefined)).toEqual([true, false, false]);
    expect(s.history.map((r) => r.illness)).toEqual(['cold', 'fever', 'fever']);
    expect(seen).toEqual(['throat', 'cold', 'fever']);
  });

  it('catches nothing when there is no exposure', () => {
    const end = runSemester(SHUT, ARCHETYPES.nightOwl, 1);
    expect(end.history.some((r) => r.infected !== undefined || r.illness !== undefined)).toBe(false);
  });

  it('moves no other draw of the semester', () => {
    const run = (ctx: SemesterContext): SemesterState => {
      let s = startSemester(ctx, 7);
      for (let i = 0; i < 4; i++) s = playDay(s, ctx, early);
      return s;
    };
    expect(run(withParams({ campusExposure: 1, infBase: 1 })).rng).toEqual(run(SHUT).rng);
  });
});

describe('the ladder of a cold (design doc 9.1, the old sim)', () => {
  it('ends a sore throat with an early night of enough sleep, and otherwise makes it a cold', () => {
    expect(stages(ill('throat', 1), SHUT, [early])).toEqual([undefined]);
    expect(stages(ill('throat', 1), SHUT, [night(24)])).toEqual(['cold']);
  });

  it('turns a cold into a fever on a night under 7 hours, which lasts two nights', () => {
    expect(stages(ill('cold', 2), SHUT, [late, early, early])).toEqual(['fever', 'fever', undefined]);
  });

  it('counts a night of 8.5 hours or more twice, and a shorter one once', () => {
    expect(stages(ill('cold', 2), SHUT, [early])).toEqual([undefined]);
    expect(stages(ill('cold', 2), SHUT, [night(23, 6)])).toEqual(['cold']);
  });

  it('keeps the cold and fever tags in step with the stage, the fever citing the cold, and the immune load citing the stage of the day', () => {
    // From an immune load of 45 the floor stays past yellow, below which it cites nothing; the omen cap keeps it from striking.
    const start = ill('throat', 1);
    let s: SemesterState = { ...start, loads: { ...start.loads, immune: 45 } };
    s = playDay(s, SHUT, late);
    expect([flag(s.tags, SHUT.dict, 'cold'), flag(s.tags, SHUT.dict, 'fever')]).toEqual([true, false]);
    const coldNode = s.tags.values['cold']!.node;
    // The day was a sore throat's, so the cold set tonight is not yet behind the load.
    expect(s.loadCauses.immune).not.toContain(coldNode);
    s = playDay(s, SHUT, late);
    expect(s.loadCauses.immune).toContain(coldNode);
    expect([flag(s.tags, SHUT.dict, 'cold'), flag(s.tags, SHUT.dict, 'fever')]).toEqual([false, true]);
    const feverNode = s.tags.values['fever']!.node;
    expect(s.tags.log.nodes[feverNode]!.causes.map((c) => c.node)).toContain(coldNode);
    s = playDay(s, SHUT, early);
    expect(s.loadCauses.immune).toContain(feverNode);
    s = playDay(s, SHUT, early);
    expect([flag(s.tags, SHUT.dict, 'cold'), flag(s.tags, SHUT.dict, 'fever')]).toEqual([false, false]);
  });

  it('loads the immune floor by 25 a night with a cold and 40 with a fever, by the stage the day had (the old sim)', () => {
    // From an immune load of 50, so that the night's sleep does not floor it at zero.
    const after = (s: SemesterState, strategy = early): number => playDay({ ...s, loads: { ...s.loads, immune: 50 } }, SHUT, strategy).history[0]!.loadsAfter.immune;
    const well = after(startSemester(SHUT, 1));
    const wellLate = after(startSemester(SHUT, 1), night(24));
    // A sore throat loads nothing, even on the night it becomes a cold.
    expect(after(ill('throat', 1), night(24)) - wellLate).toBe(0);
    // The last night of a cold, which an early night ends, still loads it.
    expect(after(ill('cold', 2)) - well).toBe(25);
    expect(after(ill('cold', 3)) - well).toBe(25);
    expect(after(ill('fever', 1)) - well).toBe(40);
  });

  it('studies at 0.8 with a cold and 0.5 with a fever', () => {
    const gain = (s: SemesterState): number => playDay(s, SHUT, early).progress - s.progress;
    const well = gain(startSemester(SHUT, 1));
    expect(gain(ill('cold', 3)) / well).toBeCloseTo(0.8);
    expect(gain(ill('fever', 2)) / well).toBeCloseTo(0.5);
  });
});

describe('a fever in the emergency room (design doc 8.11)', () => {
  it('counts a night as a fever night by the stage the day had, not the one the night turns it into', () => {
    // An orange brain left unpatrolled strikes tonight; a single strike sends to hospital only on a day spent with a fever.
    const away: Strategy = { ...late, floor: () => ({ patrol: 'gut' }) };
    const night1 = (stage: Illness): SemesterState => {
      const s = ill(stage, 2);
      return playDay({ ...s, loads: { ...s.loads, brain: 84 } }, SHUT, away);
    };
    const fever = night1('fever').history[0]!;
    const cold = night1('cold').history[0]!;
    expect([fever.strikes, cold.strikes]).toEqual([['brain'], ['brain']]);
    expect(fever.crisis?.fever).toBe(true);
    // The cold turns into a fever tonight, but the day was a cold's.
    expect(cold.illness).toBe('fever');
    expect(cold.crisis).toBeUndefined();
  });

  const owl = Array.from({ length: 60 }, (_, i) => i + 1).map((seed) => runSemester(contextFor(0.5, seed, { scenario: {} }), ARCHETYPES.nightOwl, seed));
  const visits = owl.flatMap((end) => end.history.flatMap((r, i) => (r.crisis !== undefined ? [{ end, r, i }] : [])));
  const fever = visits.filter(({ r }) => r.crisis!.fever === true);

  it('sends a host with a fever to hospital when a single floor strikes', () => {
    expect(fever.some(({ r }) => r.strikes.length === 1)).toBe(true);
    for (const { r } of fever) expect(r.strikes.length).toBeGreaterThanOrEqual(1);
  });

  it('cites the fever as a parent of the crisis, and the hospital cures the cold', () => {
    for (const { end, r, i } of fever) {
      const nodes = end.tags.log.nodes;
      expect(nodes[r.crisis!.node]!.causes.some((c) => nodes[c.node]!.key === 'fever')).toBe(true);
      expect(r.illness).toBeUndefined();
      const next = end.history[i + 1];
      if (next !== undefined) expect([next.kind, next.infected]).toEqual(['hospital', undefined]);
    }
  });

  it('marks a visit as a fever only when the host was ill, and every other visit is two strikes or the fasting liver', () => {
    for (const { end, r, i } of visits) {
      const before = end.history[i - 1]?.illness;
      if (r.crisis!.fever === true) expect(before === 'cold' || before === 'fever').toBe(true);
      else expect(r.strikes.length >= 2 || r.crisis!.fasting).toBe(true);
    }
  });
});

describe('the roommate with a cold (design doc 9.1 and its event table)', () => {
  const ROOMMATE = withParams({ campusExposure: 0, roommateExposure: 1 });
  const CATCHES = withParams({ campusExposure: 0, roommateExposure: 1, infBase: 1 });

  it('comes on 15% of evenings', () => {
    let evenings = 0;
    let contacts = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const end = runSemester({ ...base, params: { ...K, campusExposure: 0 } }, early, seed);
      for (const r of end.history.filter((x) => x.settled !== false && x.kind !== 'hospital')) {
        evenings += 1;
        if (r.roommate === true) contacts += 1;
      }
    }
    expect(contacts / evenings).toBeGreaterThan(0.12);
    expect(contacts / evenings).toBeLessThan(0.18);
  });

  it('loads the immune floor by 5 on the evening of the contact, whether or not the host catches it', () => {
    const after = (ctx: SemesterContext, s = startSemester(ctx, 1)): number =>
      playDay({ ...s, loads: { ...s.loads, immune: 50 } }, ctx, early).history[0]!.loadsAfter.immune;
    expect(after(withParams({ campusExposure: 0, roommateExposure: 1, infBase: 0 })) - after(SHUT)).toBe(5);
    expect(after(withParams({ campusExposure: 0, roommateExposure: 1 }), ill('cold', 3, ROOMMATE)) - after(SHUT, ill('cold', 3))).toBe(5);
  });

  it('gives the host a sore throat that evening, before the bedtime is chosen, citing the roommate and what raised the chance', () => {
    const seen: (Illness | undefined)[] = [];
    const spy: Strategy = { ...late, night: (v) => { seen.push(v.illness); return late.night(v); } };
    const s = playDay(startSemester(CATCHES, 1), CATCHES, spy);
    expect(seen).toEqual(['throat']);
    const r = s.history[0]!;
    expect([r.roommate, r.infected, r.illness]).toEqual([true, 'roommate', 'cold']);
    const nodes = s.tags.log.nodes;
    const infection = nodes.find((n) => n.key === 'infection.roommate')!;
    expect(infection.kind).toBe('effect');
    expect(infection.causes.map((c) => nodes[c.node]!.key)).toContain('roommate_cold');
    expect(nodes.find((n) => n.key === 'event.roommate_cold.contact')!.at % 1440).toBe(CATCHES.params.bedMin * 60);
  });

  it('is stopped by the same early night as a cold from campus', () => {
    const r = playDay(startSemester(CATCHES, 1), CATCHES, early).history[0]!;
    expect([r.infected, r.illness]).toEqual(['roommate', undefined]);
  });

  it('gives nothing to a host who is already ill, and is not met on a day in hospital', () => {
    const s = playDay(ill('cold', 3, CATCHES), CATCHES, early);
    expect([s.history[0]!.roommate, s.history[0]!.infected]).toEqual([true, undefined]);
    const r = playDay({ ...startSemester(CATCHES, 1), hospitalDay: 1 }, CATCHES, early).history[0]!;
    expect([r.kind, r.roommate, r.infected]).toEqual(['hospital', undefined, undefined]);
  });

  it('rolls apart from the campus, so an evening with the roommate says nothing of the next morning', () => {
    // Before the roommate had its own salt, its roll of one day was the campus roll of the next.
    const ctx = withParams({ campusExposure: 0.5, roommateExposure: 0.5, infBase: 1 });
    let contactDays = 0;
    let thenCampus = 0;
    let campusDays = 0;
    let sameEvening = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const h = runSemester(ctx, early, seed).history;
      for (let i = 0; i < h.length; i++) {
        if (h[i]!.infected === 'campus') {
          campusDays += 1;
          if (h[i]!.roommate === true) sameEvening += 1;
        }
        if (i + 1 === h.length || h[i]!.roommate !== true || h[i]!.illness !== undefined) continue;
        contactDays += 1;
        if (h[i + 1]!.infected === 'campus') thenCampus += 1;
      }
    }
    expect(Math.min(contactDays, campusDays)).toBeGreaterThan(100);
    expect(thenCampus / contactDays).toBeGreaterThan(0.35);
    expect(thenCampus / contactDays).toBeLessThan(0.65);
    expect(sameEvening / campusDays).toBeGreaterThan(0.35);
    expect(sameEvening / campusDays).toBeLessThan(0.65);
  });
});
