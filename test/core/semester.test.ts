import { describe, expect, it } from 'vitest';
import {
  activeModifiers, amount, caffeineBoost, caffeineOf, caffeineSleepCoef, calculateSemesterGrade, contributions, drawFloat, elevatorPanel,
  examPerformance, FLOORS, flag,
  gradeFor, lightOf, liverClues, liverStrikes, nextLoad, nextSleepDebt, patrolReduction, playDay, record, runSemester, scoreExam, seedStreams,
  semesterProblems, setFlag, sleepFactor, startSemester, strikes, summarize, trace, type DayRecord, type DayView, type Loads,
  type SemesterContext, type SemesterEvent, type SemesterState, type Strategy,
} from '../../src/core/index.ts';
import { ARCHETYPES } from '../../sim/semester/archetypes.ts';
import { bingeWeek, contextFor, crunchWeek, scenarioFor } from '../../sim/semester/scenario.ts';

const CTX = contextFor(0.5, 1, { scenario: {} });
const K = CTX.params;
const zero: Loads = { brain: 0, immune: 0, stomach: 0, liver: 0, gut: 0 };
const loads = (patch: Partial<Loads>): Loads => ({ ...zero, ...patch });

/** Nothing planned: no coffee, no rest, the first option of every event, the brain patrol, bed at 22:00. */
const quiet: Strategy = {
  plan: () => ({ coffee: [], rest: [] }),
  choose: (_id, options) => options[0]!,
  floor: () => ({ patrol: 'brain' }),
  night: () => ({ bed: 22, nextWake: 7, lateNight: 'rest' }),
};
const play = (s: SemesterState, ctx: SemesterContext, strategy: Strategy = quiet): SemesterState => playDay(s, ctx, strategy);
const last = <T>(xs: readonly T[]): T => xs[xs.length - 1]!;

describe('lights (design doc 8.4)', () => {
  it('lights yellow at 40, orange at 60 and red at 85, and not a point earlier', () => {
    const at = (x: number) => lightOf('brain', x, K);
    expect([39.99, 40, 59.99, 60, 84.99, 85, 100].map(at)).toEqual(['off', 'yellow', 'yellow', 'orange', 'orange', 'red', 'red']);
  });

  it('keeps the liver dark at any load (design doc 8.6)', () => {
    for (const load of [0, 40, 60, 85, 100]) expect(lightOf('liver', load, K)).toBe('off');
    for (const f of FLOORS.filter((x) => x !== 'liver')) expect(lightOf(f, 100, K)).toBe('red');
  });

  it('puts the smiley note on the liver button and nowhere else, and carries no load', () => {
    const panel = elevatorPanel(loads({ liver: 100, brain: 90 }), K);
    expect(panel.buttons.map((b) => b.note)).toEqual([undefined, undefined, undefined, 'liver_ok', undefined]);
    expect(panel.buttons.find((b) => b.floor === 'liver')!.light).toBe('off');
    expect(JSON.stringify(panel)).not.toMatch(/\b(90|100)\b/);
  });

  it('marks the heaviest unlit floor for a routine patrol when fewer than two floors are lit', () => {
    expect(elevatorPanel(loads({ stomach: 20 }), K).routine).toBe('stomach');
    expect(elevatorPanel(loads({ brain: 45, gut: 30, stomach: 20 }), K).routine).toBe('gut');
    expect(elevatorPanel(zero, K).routine).toBe('brain');
    expect(elevatorPanel(loads({ brain: 45, immune: 41, gut: 30 }), K).routine).toBeUndefined();
  });

  it('never routes the routine marker to the liver, however heavy it is', () => {
    expect(elevatorPanel(loads({ liver: 90, gut: 5 }), K).routine).toBe('gut');
    expect(elevatorPanel(loads({ liver: 90 }), K).routine).toBe('brain');
  });
});

describe('the nightly load (design doc 8.4)', () => {
  const night = (sleep: number, extra: { grade?: 'C' | 'B' | 'A' | 'S'; attended?: boolean } = {}) => ({
    sleep, ...(extra.grade ? { grade: extra.grade } : {}), attended: extra.attended ?? extra.grade !== undefined,
  });

  it('repairs two points per effective sleep hour and stops at 0', () => {
    expect(nextLoad('brain', 30, 0, night(8), K)).toBe(14);
    expect(nextLoad('brain', 10, 0, night(8), K)).toBe(0);
  });

  it('adds the neglect bonus only to an unpatrolled floor that began at 40 or more', () => {
    expect(nextLoad('brain', 40, 0, night(8), K)).toBe(34);
    expect(nextLoad('brain', 39.9, 0, night(8), K)).toBeCloseTo(23.9);
    expect(nextLoad('brain', 40, 0, night(8, { attended: true }), K)).toBe(24);
  });

  it('lowers a patrolled floor by 30 plus 10 per grade step', () => {
    expect((['C', 'B', 'A', 'S'] as const).map((g) => patrolReduction(g, K))).toEqual([30, 40, 50, 60]);
    expect(nextLoad('brain', 70, 0, night(0, { grade: 'S' }), K)).toBe(10);
    expect(nextLoad('brain', 70, 0, night(0, { grade: 'C' }), K)).toBe(40);
  });

  it('caps the night at 84 for a floor that began under orange, so a strike always follows an orange night', () => {
    expect(nextLoad('brain', 59.9, 100, night(0), K)).toBe(84);
    expect(nextLoad('brain', 60, 100, night(0), K)).toBe(100);
    expect(strikes('brain', nextLoad('brain', 59.9, 100, night(0), K), K)).toBe(false);
  });

  it('lets a patrol bring a striking floor down to 70 and no lower', () => {
    expect(nextLoad('brain', 90, 0, night(8, { grade: 'S' }), K)).toBe(70);
    expect(nextLoad('brain', 85, 0, night(8, { grade: 'S' }), K)).toBe(70);
    expect(nextLoad('brain', 84.9, 0, night(8, { grade: 'S' }), K)).toBeCloseTo(8.9);
    expect(nextLoad('brain', 80, 0, night(8, { grade: 'S' }), K)).toBe(4);
    expect(nextLoad('brain', 90, 0, night(8), K)).toBe(84);
  });

  it('never stalls a patrol of the liver, which is not on strike by load', () => {
    expect(nextLoad('liver', 90, 0, night(8, { grade: 'S' }), K)).toBe(14);
    expect(nextLoad('stomach', 90, 0, night(8, { grade: 'S' }), K)).toBe(70);
  });

  it('stays within 0 to 100', () => {
    expect(nextLoad('brain', 99, 500, night(0), K)).toBe(100);
    expect(nextLoad('brain', 0, 0, night(24), K)).toBe(0);
  });

  it('reads the contribution column of 8.4 for the behaviours the prototype models', () => {
    const base = { debtAfter: 0, deadline: false, tolerant: false, lateSnack: false, alcoholCups: 0, fasting: false };
    expect(contributions({ ...base, debtAfter: 2, deadline: true, tolerant: true }, K)).toEqual(loads({ brain: 24 }));
    expect(contributions({ ...base, lateSnack: true }, K)).toEqual(loads({ stomach: 15 }));
    expect(contributions({ ...base, alcoholCups: 3 }, K).liver).toBe(24);
    expect(contributions({ ...base, alcoholCups: 3, fasting: true }, K).liver).toBe(36);
    expect(contributions(base, K)).toEqual(zero);
  });
});

describe('the liver (design doc 8.6)', () => {
  const base = { load: 90, alcohol: true, dupMedication: false, orders: [2], day: 3 };

  it('strikes only when load, a drink or a double medication at bedtime, and an earlier work order all hold', () => {
    expect(liverStrikes(base, K)).toBe(true);
    expect(liverStrikes({ ...base, load: 85 }, K)).toBe(true);
    expect(liverStrikes({ ...base, load: 84.9 }, K)).toBe(false);
    expect(liverStrikes({ ...base, alcohol: false }, K)).toBe(false);
    expect(liverStrikes({ ...base, alcohol: false, dupMedication: true }, K)).toBe(true);
    expect(liverStrikes({ ...base, orders: [3] }, K)).toBe(false);
    expect(liverStrikes({ ...base, orders: [] }, K)).toBe(false);
  });

  it('shows the cross-floor clues from 40 and the elevator stop from 60, while the light stays off', () => {
    expect(liverClues(39.9, [], K)).toEqual({ orders: [], stomachJam: false, elevatorStops: false });
    expect(liverClues(40, [2], K)).toEqual({ orders: [2], stomachJam: true, elevatorStops: false });
    expect(liverClues(60, [2], K)).toEqual({ orders: [2], stomachJam: true, elevatorStops: true });
    expect(lightOf('liver', 60, K)).toBe('off');
  });

  it('does not strike through the other floors rule', () => {
    expect(strikes('liver', 100, K)).toBe(false);
    expect(strikes('stomach', 85, K)).toBe(true);
    expect(strikes('stomach', 84.9, K)).toBe(false);
  });
});

describe('skill and rating', () => {
  it('blurs the skill by the noise and grades it against the cuts', () => {
    expect(gradeFor(0.2, 0.5, K)).toBe('C');
    expect(gradeFor(0.3, 0.5, K)).toBe('B');
    expect(gradeFor(0.6, 0.5, K)).toBe('A');
    expect(gradeFor(0.9, 0.5, K)).toBe('S');
    // the cut itself belongs to the better grade
    expect(gradeFor(0.25, 0.5, K)).toBe('B');
    // the roll moves the blurred skill by at most +-0.2
    expect(gradeFor(0.2, 0, K)).toBe('C');
    expect(gradeFor(0.2, 1, K)).toBe('B');
    expect(gradeFor(0.5, 1, K)).toBe('A');
    expect(gradeFor(0.95, 1, K)).toBe('S');
    expect(gradeFor(0.05, 0, K)).toBe('C');
  });

  it('uses one blurred skill for the three parts of the exam performance', () => {
    expect(examPerformance(0.5, 0.5, K)).toEqual({ answerRate: 0.5, hitScore: 0.5, bonusRate: 0.5 });
    expect(examPerformance(1, 1, K).answerRate).toBe(1);
    expect(examPerformance(0, 0, K).answerRate).toBe(0);
  });
});

describe('formulas carried from design doc 9.1', () => {
  it('gives the caffeine boost from a residual of 25, less when tolerant', () => {
    expect([24.9, 25].map((r) => caffeineBoost(r, false, K))).toEqual([1, 1.2]);
    expect(caffeineBoost(25, true, K)).toBe(1.1);
  });

  it('costs sleep from a residual of 15 up to 40% at 100', () => {
    expect(caffeineSleepCoef(14.9, K)).toBe(1);
    expect(caffeineSleepCoef(15, K)).toBeCloseTo(0.94);
    expect(caffeineSleepCoef(50, K)).toBeCloseTo(0.8);
    expect(caffeineSleepCoef(100, K)).toBeCloseTo(0.6);
    expect(caffeineSleepCoef(250, K)).toBeCloseTo(0.6);
  });

  it('grows the debt by the shortfall and repays half of the surplus', () => {
    expect(nextSleepDebt(1, 6, K)).toBe(3);
    expect(nextSleepDebt(0, 8, K)).toBe(0);
    expect(nextSleepDebt(3, 10, K)).toBe(2);
    expect(nextSleepDebt(0.5, 12, K)).toBe(0);
  });
});

describe('one day', () => {
  it('begins at wake and studies every hour that class and meals leave, until 22:00', () => {
    const s = play(startSemester(CTX, 1), CTX);
    // 15 hours from 07:00 to 22:00, minus three meals and four classes
    expect(s.progress).toBe(8);
    expect(last(s.history).studyHours).toBe(8);
    expect(s.day).toBe(2);
    expect(s.wake).toBe(7);
  });

  it('studies more on a weekend, where there are no classes', () => {
    const s = play({ ...startSemester(CTX, 1), day: 6 }, CTX);
    expect(s.progress).toBe(12);
  });

  it('spends planned rest hours and the hours an event eats on something other than study', () => {
    const resting: Strategy = { ...quiet, plan: () => ({ coffee: [], rest: [8, 9, 16] }) };
    expect(play(startSemester(CTX, 1), CTX, resting).progress).toBe(5);
  });

  it('scales study by S from the sleep debt of the morning', () => {
    const ctx = contextFor(0.5, 1, { scenario: {}, startDebt: 5 });
    const s = play(startSemester(ctx, 1), ctx);
    expect(sleepFactor(5, K)).toBeCloseTo(0.65);
    expect(s.progress).toBeCloseTo(8 * 0.65);
  });

  it('studies faster while a cup lasts, but not past the boost of 1.2', () => {
    const coffee: Strategy = { ...quiet, plan: () => ({ coffee: [8], rest: [] }) };
    const withCup = play(startSemester(CTX, 1), CTX, coffee).progress;
    expect(withCup).toBeGreaterThan(8);
    expect(withCup).toBeLessThan(8 * 1.2);
  });

  it('studies at half efficiency while the brain floor strikes', () => {
    const s = play({ ...startSemester(CTX, 1), loads: loads({ brain: 90 }) }, CTX);
    expect(s.progress).toBe(4);
  });

  it('lets the late-night hours count as study only when the player chose to study them', () => {
    const late = (lateNight: 'study' | 'rest'): Strategy => ({ ...quiet, night: () => ({ bed: 24, nextWake: 8, lateNight }) });
    expect(play(startSemester(CTX, 1), CTX, late('rest')).progress).toBe(8);
    expect(play(startSemester(CTX, 1), CTX, late('study')).progress).toBe(10);
  });

  it('pushes bedtime back an hour for an overtime patrol, which costs an hour of sleep', () => {
    const at = (bed: number, floor: Strategy['floor']) => {
      const s = play(startSemester(CTX, 1), CTX, { ...quiet, floor, night: () => ({ bed, nextWake: 7, lateNight: 'rest' }) });
      return { s, debt: amount(s.tags, CTX.dict, 'sleep_debt') };
    };
    const plain = () => ({ patrol: 'brain' as const });
    const overtime = () => ({ patrol: 'brain' as const, overtime: 'gut' as const });
    // 23:00 to 07:00 is exactly the 8 hours needed
    expect(at(23, plain).debt).toBe(0);
    expect(at(23, overtime).debt).toBe(1);
    expect(at(24, overtime).debt).toBe(2);
    const { s } = at(23, overtime);
    expect(last(s.history).patrols.map((p) => [p.floor, p.overtime])).toEqual([['brain', false], ['gut', true]]);
    expect(at(23, plain).s.history[0]!.patrols).toHaveLength(1);
  });

  it('refuses an overtime patrol on the same floor, a bad bedtime and a half-hour or negative wake-up', () => {
    expect(() => play(startSemester(CTX, 1), CTX, { ...quiet, floor: () => ({ patrol: 'brain', overtime: 'brain' }) })).toThrow(RangeError);
    expect(() => play(startSemester(CTX, 1), CTX, { ...quiet, night: () => ({ bed: 22.25, nextWake: 7, lateNight: 'rest' }) })).toThrow(/half an hour/);
    expect(() => play(startSemester(CTX, 1), CTX, { ...quiet, night: () => ({ bed: 22, nextWake: 7.5, lateNight: 'rest' }) })).toThrow(/whole hour/);
    expect(() => play(startSemester(CTX, 1), CTX, { ...quiet, night: () => ({ bed: 22, nextWake: -1, lateNight: 'rest' }) })).toThrow(/whole hour/);
  });

  it('caps a sleep-in at wakeCap, so a late wake-up cannot repay the debt without limit', () => {
    const ctx = contextFor(0.5, 1, { scenario: {}, startDebt: 10 });
    const debtAfter = (nextWake: number) => amount(
      play({ ...startSemester(ctx, 1), day: 2 }, ctx, { ...quiet, night: () => ({ bed: 22, nextWake, lateNight: 'rest' }) }).tags, ctx.dict, 'sleep_debt',
    );
    expect(K.wakeCap).toBe(11);
    expect(debtAfter(K.wakeCap)).toBeLessThan(debtAfter(7));
    expect(debtAfter(20)).toBe(debtAfter(K.wakeCap));
  });

  it('stops a run whose final exam never comes instead of playing on', () => {
    const ctx = contextFor(0.5, 1, { scenario: {}, params: { ...K, finDay: K.days + 2 } });
    expect(() => runSemester(ctx, quiet, 1)).toThrow(/has not ended after 10 days/);
  });

  it('refuses settings that would break the omen guarantee or scramble the lights', () => {
    const start = (params: Partial<typeof K>) => () => startSemester(contextFor(0.5, 1, { scenario: {}, params: { ...K, ...params } }), 1);
    expect(start({})).not.toThrow();
    expect(start({ floorOmenCap: K.floorRedAt })).toThrow(/floorOmenCap/);
    expect(start({ floorStallBest: K.floorRedAt })).toThrow(/floorStallBest/);
    expect(start({ floorOrangeAt: K.floorYellowAt })).toThrow(/strictly increasing/);
    expect(start({ floorRedAt: K.floorOrangeAt - 1 })).toThrow(/strictly increasing/);
    expect(start({ ratingCuts: [0.5, 0.25, 0.75] })).toThrow(/ratingCuts/);
  });

  it('caps the wake-up on an exam morning', () => {
    const late: Strategy = { ...quiet, night: () => ({ bed: 23, nextWake: 10, lateNight: 'rest' }) };
    const s = play({ ...startSemester(CTX, 1), day: 4 }, CTX, late);
    expect(s.wake).toBe(K.examWake);
  });

  it('spends the exam hours on the exam, not on study', () => {
    // hour 10 is a class either way, so the exam costs exactly the one study hour at 09:00
    const hours = (day: number) => last(play({ ...startSemester(CTX, 1), day }, CTX).history).studyHours;
    expect(K.examHours).toEqual([9, 10]);
    expect(hours(5)).toBe(hours(4) - 1);
  });

  it('caps a late night at two hours past the latest bedtime, however long an event runs', () => {
    const party: SemesterEvent = { id: 'party', hour: 22, options: { on: { bedDelay: 9 } } };
    const ctx = contextFor(0.5, 1, { scenario: { 2: ['party'] }, events: new Map([['party', party]]) });
    const up: Strategy = { ...quiet, night: () => ({ bed: 23, nextWake: 7, lateNight: 'rest' }) };
    const s = play({ ...startSemester(ctx, 1), day: 2 }, ctx, up);
    // bed at 05:00 (29:00) to 07:00 is 2 hours of sleep, 6 short of the 8 needed
    expect(amount(s.tags, ctx.dict, 'sleep_debt')).toBe(6);
  });

  it('refuses a plan that wakes before its own bedtime, and starts the day no earlier than a delayed bedtime allows', () => {
    const backwards: Strategy = { ...quiet, night: () => ({ bed: 27, nextWake: 0, lateNight: 'rest' }) };
    expect(() => play(startSemester(CTX, 1), CTX, backwards)).toThrow(/before the planned bedtime/);
    // waking at the very hour of going to bed is a night with no sleep, not a backwards one
    const ctx = contextFor(0.5, 1, { scenario: { 1: ['late_snack'] } });
    const edge: Strategy = { ...quiet, choose: () => 'go', night: () => ({ bed: 24, nextWake: 0, lateNight: 'rest' }) };
    const s = play(startSemester(ctx, 1), ctx, edge);
    expect([last(s.history).bedEnd, s.wake]).toEqual([25, 1]);
    // a half-hour bedtime rounds the wake-up hour up, never down into the night
    const half: Strategy = { ...edge, night: () => ({ bed: 23.5, nextWake: 0, lateNight: 'rest' }) };
    const late = play(startSemester(ctx, 1), ctx, half);
    expect([last(late.history).bedEnd, late.wake]).toEqual([24.5, 1]);
  });

  it('stamps an event with the half hour of the evening step it was offered in', () => {
    const ctx = contextFor(0.5, 1, { scenario: { 1: ['late_snack'] } });
    const s = play(startSemester(ctx, 1), ctx, { ...quiet, choose: () => 'takeout', night: () => ({ bed: 24, nextWake: 7, lateNight: 'rest' }) });
    expect(s.tags.log.nodes.find((n) => n.key === 'event.late_snack.takeout')!.at).toBe(23 * 60);
  });

  it('plays an event that comes up between the last half hour and bedtime, and lets it push bedtime back', () => {
    const chat = (hour: number): SemesterEvent => ({ id: 'chat', hour, options: { on: { bedDelay: 1 } } });
    const night: Strategy = { ...quiet, night: () => ({ bed: 22.5, nextWake: 7, lateNight: 'rest' }) };
    const day = (hour: number) => {
      const ctx = contextFor(0.5, 1, { scenario: { 2: ['chat'] }, events: new Map([['chat', chat(hour)]]) });
      return last(play({ ...startSemester(ctx, 1), day: 2 }, ctx, night).history);
    };
    expect([day(22.25).events, day(22.25).bedEnd]).toEqual([[{ id: 'chat', option: 'on' }], 23.5]);
    // one that comes up at the very minute of bedtime is still missed
    expect([day(22.5).events, day(22.5).bedEnd]).toEqual([[], 22.5]);
  });
});

describe('events and tags', () => {
  const evCtx = (scenario: Record<number, string[]>, over: Partial<SemesterContext> = {}) => contextFor(0.5, 1, { scenario, ...over });
  const pick = (id: string, option: string): Strategy => ({ ...quiet, choose: (event, options) => (event === id ? option : options[0]!) });

  it('logs every chosen option as an event, even one that changes nothing', () => {
    const ctx = evCtx({ 2: ['bbq'] });
    const s = play({ ...startSemester(ctx, 1), day: 2 }, ctx, pick('bbq', 'decline'));
    expect(s.tags.log.nodes.some((n) => n.kind === 'event' && n.key === 'event.bbq.decline')).toBe(true);
    expect(last(s.history).events).toEqual([{ id: 'bbq', option: 'decline' }]);
    expect(s.liverOrders).toEqual([]);
  });

  it('pins no work order for a drink of zero cups', () => {
    const sip: SemesterEvent = { id: 'sip', hour: 20, options: { none: { alcohol: 0 } } };
    const ctx = evCtx({ 2: ['sip'] }, { events: new Map([['sip', sip]]) });
    const s = play({ ...startSemester(ctx, 1), day: 2 }, ctx);
    expect(last(s.history).events).toEqual([{ id: 'sip', option: 'none' }]);
    expect(s.liverOrders).toEqual([]);
  });

  it('pins a work order on the liver for any drink and traces the alcohol back to the event', () => {
    const ctx = evCtx({ 2: ['bbq'] });
    const s = play({ ...startSemester(ctx, 1), day: 2 }, ctx, pick('bbq', 'drink'));
    expect(s.liverOrders).toEqual([2]);
    // the alcohol tag has ended with the morning, but the log still explains the liver's load
    const alcohol = s.tags.log.nodes.find((n) => n.kind === 'tag' && n.key === 'alcohol')!;
    expect(trace(s.tags.log, alcohol.id).some((n) => n.kind === 'event' && n.key === 'event.bbq.drink')).toBe(true);
    expect(amount(s.tags, ctx.dict, 'alcohol')).toBe(0);
  });

  it('pins one work order for each drinking event, so two drinks in a day are two orders', () => {
    const on = (id: string, hour: number): SemesterEvent => ({ id, hour, options: { on: { alcohol: 1 } } });
    const ctx = evCtx({ 2: ['a', 'b'] }, { events: new Map([['a', on('a', 19)], ['b', on('b', 20)]]) });
    expect(play({ ...startSemester(ctx, 1), day: 2 }, ctx).liverOrders).toEqual([2, 2]);
  });

  it('refuses an option the event does not have, and a scenario naming an unknown event', () => {
    const ctx = evCtx({ 2: ['bbq'] });
    expect(() => play({ ...startSemester(ctx, 1), day: 2 }, ctx, pick('bbq', 'shots'))).toThrow(/shots/);
    expect(() => startSemester(evCtx({ 3: ['karaoke'] }), 1)).toThrow(/karaoke/);
  });

  it('plays an event between two whole hours before bedtime, and misses one that comes up at bedtime', () => {
    const at = (hour: number): SemesterEvent => ({ id: 'chat', hour, options: { on: {} } });
    const events = (hour: number) => {
      const ctx = evCtx({ 2: ['chat'] }, { events: new Map([['chat', at(hour)]]) });
      return last(play({ ...startSemester(ctx, 1), day: 2 }, ctx).history).events;
    };
    expect(events(21.5)).toEqual([{ id: 'chat', option: 'on' }]);
    expect(events(22)).toEqual([]);
  });

  it('misses an event that comes up after the player is in bed', () => {
    const ctx = evCtx({ 2: ['late_snack'] });
    const s = play({ ...startSemester(ctx, 1), day: 2 }, ctx, pick('late_snack', 'go'));
    expect(last(s.history).events).toEqual([]);
    const awake = play({ ...startSemester(ctx, 1), day: 2 }, ctx, { ...pick('late_snack', 'takeout'), night: () => ({ bed: 24, nextWake: 7, lateNight: 'rest' }) });
    expect(last(awake.history).events).toEqual([{ id: 'late_snack', option: 'takeout' }]);
  });

  it('loads the stomach and costs sleep for a late snack, and leaves its modifier on for the next day', () => {
    const ctx = evCtx({ 2: ['late_snack'] });
    const eat: Strategy = { ...pick('late_snack', 'takeout'), night: () => ({ bed: 24, nextWake: 8, lateNight: 'rest' }) };
    const s = play({ ...startSemester(ctx, 1), day: 2 }, ctx, eat);
    // 8 hours in bed at 0.9 is 7.2 effective, a debt of 0.8
    expect(amount(s.tags, ctx.dict, 'sleep_debt')).toBeCloseTo(0.8);
    expect(flag(s.tags, ctx.dict, 'late_snack')).toBe(true);
    expect(activeModifiers(s.tags, ctx.dict)).toContain('mod.night_logistics');
    const next = play(s, ctx, eat);
    expect(flag(next.tags, ctx.dict, 'late_snack')).toBe(false);
  });

  it('puts the late snack on the stomach floor', () => {
    const ctx = evCtx({ 2: ['late_snack'] });
    const eat: Strategy = { ...pick('late_snack', 'takeout'), night: () => ({ bed: 24, nextWake: 8, lateNight: 'rest' }) };
    const s = play({ ...startSemester(ctx, 1), day: 2 }, ctx, eat);
    // 15 for the snack, 14.4 repaired by 7.2 effective hours
    expect(last(s.history).loadsAfter.stomach).toBeCloseTo(0.6);
  });

  it('ends the alcohol tag with the morning and lets the deadline pass', () => {
    const ctx = evCtx({ 2: ['bbq', 'deadline'] });
    const s = play({ ...startSemester(ctx, 1), day: 2 }, ctx, { ...quiet, choose: (id) => (id === 'bbq' ? 'drink' : 'squeeze') });
    expect(activeModifiers(s.tags, ctx.dict)).not.toContain('mod.alcohol_line');
    expect(flag(s.tags, ctx.dict, 'deadline')).toBe(false);
    expect(last(s.history).events.map((e) => e.id)).toEqual(['deadline', 'bbq']);
  });

  it('eats free hours for a squeezed deadline and delays bed for an overtime one', () => {
    const ctx = evCtx({ 2: ['deadline'] });
    const squeeze = play({ ...startSemester(ctx, 1), day: 2 }, ctx, pick('deadline', 'squeeze'));
    expect(squeeze.progress).toBe(6);
    // overtime pushes 22:00 to 24:00, so 7 hours in bed
    const overtime = play({ ...startSemester(ctx, 1), day: 2 }, ctx, pick('deadline', 'overtime'));
    expect(amount(overtime.tags, ctx.dict, 'sleep_debt')).toBe(1);
    expect(overtime.progress).toBe(8);
  });

  it('carries the deadline and the tolerance into the brain floor at the night settlement', () => {
    // a debt of 6 leaves 5.5 after nine good hours: 4 x 5.5 = 22 for the debt, minus 2 x 9 = 18 of repair
    const ctx = evCtx({ 2: ['deadline'] }, { startDebt: 6 });
    // patrol the gut, so that nothing takes the brain's load down again
    const away: Strategy = { ...pick('deadline', 'squeeze'), floor: () => ({ patrol: 'gut' }) };
    const base = (): SemesterState => ({ ...startSemester(ctx, 1), day: 2 });
    const plain = play(base(), ctx, away);
    expect(last(plain.history).loadsSettled.brain).toBeCloseTo(22 + 8 - 18);
    const s0 = base();
    const [log, cause] = record(s0.tags.log, { kind: 'rule', key: 'test', at: 0 });
    const tolerant = setFlag({ ...s0.tags, log }, ctx.dict, 'caffeine_tolerant', true, cause, 0);
    const withTolerance = play({ ...s0, tags: tolerant }, ctx, away);
    expect(last(withTolerance.history).loadsSettled.brain).toBeCloseTo(22 + 8 + 8 - 18);
    // and a patrol of the brain takes its load down by 30 to 60 on top
    const patrolled = play(base(), ctx, pick('deadline', 'squeeze'));
    expect(last(patrolled.history).loadsSettled.brain).toBeLessThan(12);
  });
});

describe('caffeine tolerance (design doc 9.1)', () => {
  const cups = (n: number): Strategy => ({ ...quiet, plan: () => ({ coffee: Array.from({ length: n }, (_, i) => 8 + i), rest: [] }) });

  it('builds after three days of two cups, and ends after two cup-free days', () => {
    let s = startSemester(CTX, 1);
    const tolerant = (x: SemesterState) => flag(x.tags, CTX.dict, 'caffeine_tolerant');
    s = play(s, CTX, cups(2));
    s = play(s, CTX, cups(2));
    expect(tolerant(s)).toBe(false);
    s = play(s, CTX, cups(2));
    expect(tolerant(s)).toBe(true);
    s = play(s, CTX, cups(0));
    expect(tolerant(s)).toBe(true);
    s = play(s, CTX, cups(0));
    expect(tolerant(s)).toBe(false);
  });

  it('does not count a single cup a day', () => {
    let s = startSemester(CTX, 1);
    for (let i = 0; i < 4; i++) s = play(s, CTX, cups(1));
    expect(flag(s.tags, CTX.dict, 'caffeine_tolerant')).toBe(false);
  });

  it('needs all of the last three days at two cups, not just one of them', () => {
    let s = startSemester(CTX, 1);
    for (const n of [2, 2, 1]) s = play(s, CTX, cups(n));
    expect(flag(s.tags, CTX.dict, 'caffeine_tolerant')).toBe(false);
  });

  it('counts only cup-free days in a row towards ending the tolerance', () => {
    let s = startSemester(CTX, 1);
    for (const n of [2, 2, 2, 0, 2, 0]) s = play(s, CTX, cups(n));
    expect(flag(s.tags, CTX.dict, 'caffeine_tolerant')).toBe(true);
  });

  it('slows study to 90% on the first cup-free day of a tolerant drinker, and only on that day', () => {
    let tolerant = startSemester(CTX, 1);
    for (let i = 0; i < 3; i++) tolerant = play(tolerant, CTX, cups(2));
    // the same morning, except that the cup-free streak has already begun, so no withdrawal
    const withdrawn = play(tolerant, CTX, cups(0));
    const control = play({ ...tolerant, zeroCupDays: 1 }, CTX, cups(0));
    const gain = (s: SemesterState) => s.progress - tolerant.progress;
    expect(gain(withdrawn)).toBeCloseTo(gain(control) * K.withdrawal);
    expect(flag(withdrawn.tags, CTX.dict, 'withdrawal')).toBe(false);
    // the second cup-free day is back to normal
    const second = play(withdrawn, CTX, cups(0));
    const secondControl = play({ ...withdrawn, zeroCupDays: 5 }, CTX, cups(0));
    expect(second.progress - withdrawn.progress).toBeCloseTo(secondControl.progress - withdrawn.progress);
  });
});

describe('exams and hospital (design doc 8.9, 8.11)', () => {
  it('scores the midterm on waking with that morning S and the progress so far, through the shared exam rules', () => {
    const ctx = contextFor(0.7, 1, { scenario: {} });
    const at = { ...startSemester(ctx, 1), day: 5, progress: 20 };
    const [r] = drawFloat(seedStreams(1), 'enemies');
    const expected = scoreExam({ kind: 'regular', progress: 20, sExamDay: 1, passThreshold: K.passMid, ...examPerformance(0.7, r, K) });
    const s = play(at, ctx);
    expect(s.mid).toBe(expected.examPercent);
    expect(last(s.history).kind).toBe('exam');
    expect(last(s.history).patrols).toEqual([]);
  });

  it('weighs the sleep debt of the morning in the exam score', () => {
    const rested = play({ ...startSemester(CTX, 1), day: 5, progress: 18 }, CTX);
    const ctx = contextFor(0.5, 1, { scenario: {}, startDebt: 5 });
    const tired = play({ ...startSemester(ctx, 1), day: 5, progress: 18 }, ctx);
    expect(tired.mid!).toBeLessThan(rested.mid!);
  });

  it('ends the semester with the final exam, before any night', () => {
    const s = play({ ...startSemester(CTX, 1), day: 10, progress: 60 }, CTX);
    expect(s.ended).toBe(true);
    expect(s.fin).toBeGreaterThan(0);
    expect(last(s.history).settled).toBe(false);
    expect(() => play(s, CTX)).toThrow(/over/);
  });

  it('applies the difficulty multiplier to the final threshold only', () => {
    const hard = contextFor(0.5, 1, { scenario: {}, finMult: 2 });
    const easy = play({ ...startSemester(CTX, 1), day: 10, progress: 37 }, CTX);
    const harder = play({ ...startSemester(hard, 1), day: 10, progress: 37 }, hard);
    expect(harder.fin!).toBeLessThan(easy.fin!);
    expect(play({ ...startSemester(hard, 1), day: 5, progress: 18 }, hard).mid).toBe(play({ ...startSemester(CTX, 1), day: 5, progress: 18 }, CTX).mid);
  });

  const drinkWeek = (days: number[]): SemesterContext => contextFor(0.5, 1, { scenario: Object.fromEntries(days.map((d) => [d, ['bbq']])) });

  it('walks a blind binge drinker to a liver strike on the third night, with hand-computed loads', () => {
    const ctx = drinkWeek([2, 3, 4]);
    const end = runSemester(ctx, ARCHETYPES.drinkerBlind, 1);
    const [, d2, d3, d4] = end.history as [DayRecord, DayRecord, DayRecord, DayRecord];
    // night 2: 6 cups fasting is 72, minus 2 x (8.5 h x 0.8) = 13.6
    expect(d2.loadsSettled.liver).toBeCloseTo(58.4);
    expect(d2.lights.liver).toBe('off');
    // night 3: 58.4 + 72 + 10 neglect - 13.6 is 126.8, held at 84 by the omen guarantee
    expect(d3.loadsSettled.liver).toBe(84);
    expect(d3.liverNote).toBe(true);
    expect(d3.strikes).toEqual([]);
    // night 4: 84 + 72 + 10 - 14.4 passes 100, with the drink in the body and orders from days 2 and 3
    expect(d4.loadsSettled.liver).toBe(100);
    expect(d4.strikes).toEqual(['liver']);
    expect(d4.liverStrike).toEqual({ alcoholAtBed: true, dupMedication: false, orderBefore: true });
    // fasting turns the strike into the dizzy crisis and a trip to the emergency room
    expect(d4.hospitalized).toBe(true);
    expect(d4.loadsAfter.liver).toBe(K.hospitalFloorLoad);
  });

  it('turns the first emergency visit into a hospital day that costs the midterm', () => {
    const ctx = drinkWeek([2, 3, 4]);
    let s = startSemester(ctx, 1);
    while (s.day <= 4) s = play(s, ctx, ARCHETYPES.drinkerBlind);
    expect(s.hospitals).toBe(1);
    expect(s.hospitalDay).toBe(5);
    expect(s.wake).toBe(K.wake);
    // debt 3.2 after the night, halved to 1.6, then 9 good hours repay half an hour of surplus x 1 hour
    expect(amount(s.tags, ctx.dict, 'sleep_debt')).toBeCloseTo(1.1);
    const progress = s.progress;
    const day5 = play(s, ctx, ARCHETYPES.drinkerBlind);
    expect(day5.mid).toBe(0);
    expect(day5.progress).toBe(progress);
    expect(last(day5.history).kind).toBe('hospital');
    expect(last(day5.history).patrols).toEqual([]);
    // no neglect on a hospital day: 40 minus 2 x 8 hours of sleep
    expect(last(day5.history).loadsAfter.liver).toBeCloseTo(24);
  });

  it('declares bankruptcy at the second emergency visit', () => {
    const ctx = drinkWeek([2, 3, 4, 6, 7]);
    const end = runSemester(ctx, ARCHETYPES.drinkerBlind, 1);
    expect(end.hospitals).toBe(2);
    expect(end.bankrupt).toBe(true);
    expect(end.ended).toBe(true);
    expect(last(end.history).day).toBe(7);
    const sum = summarize(end, ctx);
    expect(sum.passFin).toBe(false);
    expect(sum.fin).toBe(0);
    expect(sum.mid).toBe(0);
  });

  describe('the emergency room', () => {
    // Day 3 with a heavy building: a floor at 100 still ends the night at 86 after 12 hours in bed, which is red.
    const strained = (patch: Partial<Loads>): SemesterState => ({ ...startSemester(CTX, 1), day: 3, loads: loads(patch) });
    const gutPatrol: Strategy = { ...quiet, floor: () => ({ patrol: 'gut' }), night: () => ({ bed: 22, nextWake: 10, lateNight: 'rest' }) };

    it('lets a single floor strike without a trip to the emergency room', () => {
      const s = play(strained({ brain: 100 }), CTX, gutPatrol);
      expect(last(s.history).strikes).toEqual(['brain']);
      expect(last(s.history).hospitalized).toBe(false);
      expect(s.hospitals).toBe(0);
      expect(s.hospitalDay).toBeUndefined();
      expect(s.wake).toBe(10);
    });

    it('sends two floors on strike to the emergency room, with lighter floors left as they are', () => {
      const s = play(strained({ brain: 100, stomach: 100, immune: 30 }), CTX, gutPatrol);
      const rec = last(s.history);
      expect(rec.strikes).toEqual(['brain', 'stomach']);
      expect(rec.hospitalized).toBe(true);
      expect(s.hospitals).toBe(1);
      expect(s.hospitalDay).toBe(4);
      expect(s.wake).toBe(K.wake);
      expect(rec.loadsAfter.brain).toBe(K.hospitalFloorLoad);
      expect(rec.loadsAfter.stomach).toBe(K.hospitalFloorLoad);
      // 30 minus 2 x 12 hours in bed: below the cap, so the visit does not lift it
      expect(rec.loadsAfter.immune).toBe(6);
    });

    it('counts the hospital night as nine hours of caffeine clearing, whenever the player would have woken', () => {
      const lateCup = (nextWake: number): Strategy => ({
        ...gutPatrol, plan: () => ({ coffee: [21], rest: [] }), night: () => ({ bed: 22, nextWake, lateNight: 'rest' }),
      });
      const caffeine = (nextWake: number) => caffeineOf(play(strained({ brain: 100, stomach: 100 }), CTX, lateCup(nextWake)).tags, CTX.dict);
      expect(caffeine(7)).toBeGreaterThan(0);
      expect(caffeine(10)).toBe(caffeine(7));
    });

    // The liver is struck on day 3 by a drink in the body, a load past the line and the order of day 2.
    const liverNight = (option: string): SemesterState => {
      const ctx = contextFor(0.5, 1, { scenario: { 3: ['bbq'] } });
      const pick: Strategy = { ...quiet, choose: (id, options) => (id === 'bbq' ? option : options[0]!) };
      return play({ ...startSemester(ctx, 1), day: 3, loads: loads({ liver: 90 }), liverOrders: [2] }, ctx, pick);
    };

    it('does not send a drinker to hospital for a liver strike on a full stomach', () => {
      const s = liverNight('drink');
      expect(last(s.history).strikes).toEqual(['liver']);
      expect(last(s.history).hospitalized).toBe(false);
      expect(s.hospitals).toBe(0);
    });

    it('sends a drinker to hospital for a liver strike on an empty stomach', () => {
      const s = liverNight('drink_fasting');
      expect(last(s.history).strikes).toEqual(['liver']);
      expect(last(s.history).hospitalized).toBe(true);
      expect(s.hospitals).toBe(1);
    });

    it('records a final exam lost to a hospital day as a hospital day, scored 0', () => {
      const s = play({ ...startSemester(CTX, 1), day: 10, progress: 60, hospitalDay: 10 }, CTX);
      expect(s.fin).toBe(0);
      expect(s.ended).toBe(true);
      expect(last(s.history)).toMatchObject({ kind: 'hospital', settled: false, hospitalized: false });
    });

    it('strikes the liver on a double medication alone, and the invariant check accepts it', () => {
      const s0 = { ...startSemester(CTX, 1), day: 3, loads: loads({ liver: 100 }), liverOrders: [2] };
      const [log, cause] = record(s0.tags.log, { kind: 'rule', key: 'test', at: 0 });
      const s = play({ ...s0, tags: setFlag({ ...s0.tags, log }, CTX.dict, 'dup_medication', true, cause, 0) }, CTX);
      expect(last(s.history).strikes).toEqual(['liver']);
      expect(last(s.history).liverStrike).toEqual({ alcoholAtBed: false, dupMedication: true, orderBefore: true });
      expect(semesterProblems(s.history, K)).toEqual([]);
    });

    it('fails the semester at a second visit even if the final exam would have been a pass', () => {
      const s = { ...startSemester(CTX, 1), bankrupt: true, mid: 90, fin: 90 };
      expect(summarize(s, CTX).passFin).toBe(false);
    });
  });

  it('passes an exam from 60 percent, and grades the semester through the shared weights', () => {
    const at = (mid: number, fin: number) => summarize({ ...startSemester(CTX, 1), mid, fin }, CTX);
    expect(at(60, 60)).toMatchObject({ passMid: true, passFin: true });
    expect(at(59.9, 59.9)).toMatchObject({ passMid: false, passFin: false });
    expect(at(80, 40).grade).toBe(calculateSemesterGrade(80, 40));
    expect(at(80, 40).grade).not.toBe(at(40, 80).grade);
  });
});

describe('what the player is allowed to see', () => {
  it('hands strategies lights and clues but no floor load', () => {
    const views: DayView[] = [];
    const spy: Strategy = { ...ARCHETYPES.drinkerBlind, floor: (v) => { views.push(v); return ARCHETYPES.drinkerBlind.floor(v); } };
    const ctx = contextFor(0.5, 1, { scenario: { 2: ['bbq'], 3: ['bbq'] } });
    runSemester(ctx, spy, 1);
    expect(views.length).toBeGreaterThan(5);
    for (const v of views) {
      expect(Object.keys(v).sort()).toEqual([
        'S', 'caffeine', 'day', 'examTomorrow', 'exam', 'hospitals', 'liverClues', 'modifiers', 'panel', 'progress', 'sleepDebt', 'wake', 'weekend',
      ].sort());
      for (const b of v.panel.buttons) expect(Object.keys(b).every((k) => ['floor', 'light', 'note'].includes(k))).toBe(true);
    }
    // after a binge the clue is on while the light is not
    const jammed = views.find((v) => v.liverClues.stomachJam)!;
    expect(jammed.panel.buttons.find((b) => b.floor === 'liver')!.light).toBe('off');
    expect(jammed.liverClues.orders.length).toBeGreaterThan(0);
  });

  it('lets a player who follows the clue keep the liver from striking', () => {
    const informed = runSemester(contextFor(0.9, 1, { scenario: Object.fromEntries([2, 3, 4].map((d) => [d, ['bbq']])) }), ARCHETYPES.drinkerInformed, 1);
    expect(informed.history.some((r) => r.strikes.includes('liver'))).toBe(false);
    const day3 = informed.history[2]!;
    expect(day3.patrols[0]!.floor).toBe('liver');
  });
});

describe('every simulated state keeps the invariants', () => {
  const seeds = Array.from({ length: 30 }, (_, i) => i + 1);

  for (const [scenario, scenarioOf] of [['regular', scenarioFor], ['binge week', bingeWeek]] as const) {
    for (const [name, strategy] of Object.entries(ARCHETYPES)) {
      for (const skill of [0.2, 0.9]) {
        it(`${scenario}, ${name}, skill ${skill}: the liver never lights and no floor skips its orange night`, () => {
          for (const seed of seeds) {
            const ctx = contextFor(skill, seed, { scenario: scenarioOf(seed) });
            const end = runSemester(ctx, strategy, seed);
            expect(semesterProblems(end.history, ctx.params)).toEqual([]);
            expect(end.history.every((r) => r.lights.liver === 'off' && !r.lit.includes('liver'))).toBe(true);
            expect(end.ended).toBe(true);
          }
        });
      }
    }
  }

  it('replays to the same history for the same seed, and differs for another', () => {
    const run = (seed: number) => JSON.stringify(runSemester(contextFor(0.5, seed), ARCHETYPES.nightOwl, seed));
    expect(run(4)).toBe(run(4));
    expect(run(4)).not.toBe(run(5));
  });

  it('plays ten days with exams on days 5 and 10 and one patrol on each of the eight others', () => {
    const end = runSemester(contextFor(0.5, 3, { scenario: {} }), ARCHETYPES.balanced, 3);
    expect(end.history.map((r) => r.kind)).toEqual(['normal', 'normal', 'normal', 'normal', 'exam', 'normal', 'normal', 'normal', 'normal', 'exam']);
    expect(end.history.map((r) => r.patrols.length)).toEqual([1, 1, 1, 1, 0, 1, 1, 1, 1, 0]);
    expect(end.mid).toBeDefined();
    expect(end.fin).toBeDefined();
  });
});

describe('the invariant check can fail', () => {
  const ctx = contextFor(0.5, 1, { scenario: Object.fromEntries([2, 3, 4].map((d) => [d, ['bbq']])) });
  const end = runSemester(ctx, ARCHETYPES.drinkerBlind, 1);
  const history = end.history;
  const tamper = (i: number, patch: Partial<DayRecord>): readonly DayRecord[] => history.map((r, j) => (j === i ? { ...r, ...patch } : r));
  const find = (h: readonly DayRecord[]) => semesterProblems(h, K);

  it('passes the untouched history', () => {
    expect(find(history)).toEqual([]);
  });

  it('reports a lit liver, a missing note and a routine marker on the liver', () => {
    expect(find(tamper(2, { lights: { ...history[2]!.lights, liver: 'yellow' } })).join('\n')).toMatch(/liver light is yellow/);
    expect(find(tamper(2, { lit: ['liver'] })).join('\n')).toMatch(/counted among the lit floors/);
    expect(find(tamper(2, { liverNote: false })).join('\n')).toMatch(/smiley note/);
    expect(find(tamper(2, { routine: 'liver' })).join('\n')).toMatch(/routine patrol marker/);
  });

  it('reports a light that does not follow the load', () => {
    expect(find(tamper(2, { lights: { ...history[2]!.lights, brain: 'red' } })).join('\n')).toMatch(/brain showed red/);
  });

  it('reports a floor that skipped its orange night', () => {
    const r = history[1]!;
    const jump = tamper(1, { loadsSettled: { ...r.loadsSettled, stomach: 90 } });
    expect(find(jump).join('\n')).toMatch(/stomach rose from 0 to 90/);
  });

  it('reports a strike without its conditions, and a load outside 0 to 100', () => {
    expect(find(tamper(1, { strikes: ['liver'] })).join('\n')).toMatch(/without all three conditions/);
    expect(find(tamper(3, { liverStrike: { alcoholAtBed: false, dupMedication: false, orderBefore: true } })).join('\n')).toMatch(/without all three conditions/);
    expect(find(tamper(3, { liverStrike: { alcoholAtBed: true, dupMedication: false, orderBefore: false } })).join('\n')).toMatch(/without all three conditions/);
    expect(find(tamper(1, { loadsAfter: { ...history[1]!.loadsAfter, gut: 101 } })).join('\n')).toMatch(/outside 0 to 100/);
    expect(find(tamper(1, { liverStrike: { alcoholAtBed: true, dupMedication: false, orderBefore: true } })).join('\n')).toMatch(/not on strike/);
    // day 4 is the strike; a liver that settled under the line cannot have struck
    expect(find(tamper(3, { loadsSettled: { ...history[3]!.loadsSettled, liver: 50 } })).join('\n')).toMatch(/without all three conditions/);
  });

  it('reports a floor on strike that is below the line, and one above it that does not strike', () => {
    expect(find(tamper(1, { strikes: ['brain'] })).join('\n')).toMatch(/brain settles at .* and strikes/);
    expect(find(tamper(1, { loadsSettled: { ...history[1]!.loadsSettled, gut: 90 } })).join('\n')).toMatch(/gut/);
  });

  it('reports a day that does not begin where the last one ended', () => {
    expect(find(tamper(2, { loadsBefore: { ...history[2]!.loadsBefore, immune: 1 } })).join('\n')).toMatch(/immune began at 1/);
  });
});

describe('lights follow floors, not their order', () => {
  it('names every floor once', () => {
    expect([...FLOORS]).toEqual(['brain', 'immune', 'stomach', 'liver', 'gut']);
    expect(elevatorPanel(zero, K).buttons.map((b) => b.floor)).toEqual([...FLOORS]);
  });
});

describe('the causal log of a semester', () => {
  const MINUTES = 1440;
  const dayOf = (at: number): number => Math.floor(at / MINUTES) + 1;
  const bingeCtx = contextFor(0.5, 1, { scenario: Object.fromEntries([2, 3, 4].map((d) => [d, ['bbq']])) });
  const binge = runSemester(bingeCtx, ARCHETYPES.drinkerBlind, 1);
  const nodes = binge.tags.log.nodes;
  const strikeDay = binge.history[3]!;

  it('records the visit to the emergency room as a crisis, and which night and entry it was', () => {
    const crisis = nodes[strikeDay.crisis!.node]!;
    expect(crisis.kind).toBe('crisis');
    expect(crisis.key).toBe('er');
    expect(crisis.at).toBe(strikeDay.crisis!.at);
    expect(dayOf(crisis.at)).toBe(4);
    expect(binge.history.filter((r) => r.crisis).map((r) => r.day)).toEqual([4]);
  });

  it('records whether the liver struck on an empty stomach, which a strike of two floors never is', () => {
    expect(strikeDay.crisis!.fasting).toBe(true);
    const ctx = contextFor(0.5, 1, { scenario: crunchWeek(1) });
    const crammed = runSemester(ctx, ARCHETYPES.crammer, 1);
    const visit = crammed.history.find((r) => r.crisis)!;
    expect([visit.strikes, visit.crisis!.fasting]).toEqual([['brain', 'stomach'], false]);
  });

  it('makes the strikes of that night the parents of the crisis', () => {
    const crisis = nodes[strikeDay.crisis!.node]!;
    expect(crisis.causes.map((c) => nodes[c.node]!.key)).toEqual(['strike.liver']);
    expect(crisis.causes.map((c) => nodes[c.node]!.kind)).toEqual(['effect']);
  });

  it('cites every night of the binge behind the liver strike, not only the last', () => {
    const drinks = trace(binge.tags.log, strikeDay.crisis!.node).filter((n) => n.kind === 'event' && n.key.startsWith('event.bbq.'));
    expect(drinks.map((n) => dayOf(n.at))).toEqual([2, 3, 4]);
    expect(drinks.every((n) => n.data?.cups === 6)).toBe(true);
  });

  it('cites nothing that happened after the crisis', () => {
    const crisis = nodes[strikeDay.crisis!.node]!;
    const cited = trace(binge.tags.log, crisis.id);
    expect(cited.length).toBeGreaterThan(3);
    expect(cited.every((n) => n.at <= crisis.at)).toBe(true);
    expect(cited.at(-1)!.id).toBe(crisis.id);
  });

  it('keeps a floor causes while it is hot and drops them when it is calm', () => {
    let s = startSemester(bingeCtx, 1);
    s = play(s, bingeCtx, ARCHETYPES.drinkerBlind);
    expect(s.loadCauses.liver).toEqual([]);
    s = play(s, bingeCtx, ARCHETYPES.drinkerBlind);
    expect(s.loads.liver).toBeGreaterThanOrEqual(K.floorYellowAt);
    expect(s.loadCauses.liver.map((id) => s.tags.log.nodes[id]!.key)).toEqual(['event.bbq.binge']);
    s = play(s, bingeCtx, ARCHETYPES.drinkerBlind);
    expect(s.loadCauses.liver).toHaveLength(2);
    while (s.day <= 5) s = play(s, bingeCtx, ARCHETYPES.drinkerBlind);
    expect(s.loads.liver).toBeLessThan(K.floorYellowAt);
    expect(s.loadCauses.liver).toEqual([]);
  });

  it('keeps the causes of a floor that the hospital leaves exactly on the yellow line', () => {
    let s = startSemester(bingeCtx, 1);
    while (s.day <= 4) s = play(s, bingeCtx, ARCHETYPES.drinkerBlind);
    expect(s.loads.liver).toBe(K.hospitalFloorLoad);
    expect(K.hospitalFloorLoad).toBeGreaterThanOrEqual(K.floorYellowAt);
    expect(s.loadCauses.liver.length).toBeGreaterThan(0);
  });

  describe('a strike cites what loaded the floor', () => {
    const owl = (to: number): Strategy => ({ ...quiet, floor: () => ({ patrol: 'gut' }), night: () => ({ bed: to, nextWake: 11, lateNight: 'rest' }) });
    const struck = (floor: 'brain' | 'stomach', event: string, option: string, bed: number): string[] => {
      const ctx = contextFor(0.5, 1, { scenario: { 3: [event] } });
      const s = play({ ...startSemester(ctx, 1), day: 3, loads: loads({ [floor]: 100 }) }, ctx, { ...owl(bed), choose: () => option });
      expect(last(s.history).strikes).toContain(floor);
      const node = s.tags.log.nodes.find((n) => n.key === `strike.${floor}`)!;
      return node.causes.map((c) => s.tags.log.nodes[c.node]!.key);
    };

    it('names the deadline behind a brain strike', () => {
      expect(struck('brain', 'deadline', 'squeeze', 22)).toEqual(['event.deadline.squeeze']);
    });

    it('names the late snack behind a stomach strike', () => {
      expect(struck('stomach', 'late_snack', 'takeout', 24)).toEqual(['event.late_snack.takeout']);
    });
  });

  it('draws the day of each record and the hour sleep began', () => {
    expect(binge.history.map((r) => r.wake).slice(0, 4)).toEqual([K.wake, K.wake, K.wake, K.wake]);
    expect(binge.history[1]!.bedEnd).toBe(22.5);
    expect(binge.history.at(-1)!.bedEnd).toBeUndefined();
  });

  describe('what shortens a night is named as a cause of the sleep debt', () => {
    const causesOfDebt = (s: SemesterState): { kind: string; key: string; data?: unknown }[] => {
      const debt = s.tags.log.nodes[s.tags.values['sleep_debt']!.node]!;
      return debt.causes.map((c) => s.tags.log.nodes[c.node]!).map((n) => ({ kind: n.kind, key: n.key, data: n.data }));
    };
    const keys = (s: SemesterState): string[] => causesOfDebt(s).map((c) => c.key);
    const bedAt = (bed: number, lateNight: 'study' | 'rest' = 'rest'): Strategy => ({ ...quiet, night: () => ({ bed, nextWake: 7, lateNight }) });

    it('names a bedtime after midnight, and study when the hours went to study', () => {
      expect(keys(play(startSemester(CTX, 1), CTX, bedAt(25)))).toContain('stayed_up');
      expect(keys(play(startSemester(CTX, 1), CTX, bedAt(25, 'study')))).toContain('study_late');
      expect(keys(play(startSemester(CTX, 1), CTX, bedAt(25, 'study')))).not.toContain('stayed_up');
    });

    it('dates late study by when it stopped, and names the hours awake after it as a separate cause', () => {
      const snack = contextFor(0.5, 1, { scenario: { 1: ['late_snack'] } });
      const s = play(startSemester(snack, 1), snack, { ...bedAt(27, 'study'), choose: () => 'go' });
      const at = (key: string): number => s.tags.log.nodes.find((n) => n.key === key)!.at;
      // study ran to 03:00 and the snack kept the player up to 04:00
      expect([at('study_late'), at('stayed_up')]).toEqual([27 * 60, 28 * 60]);
      expect(keys(s)).toEqual(expect.arrayContaining(['study_late', 'stayed_up']));
    });

    it('counts study that stops exactly at midnight as late study', () => {
      expect(keys(play(startSemester(CTX, 1), CTX, bedAt(24, 'study')))).toContain('study_late');
    });

    it('does not call study that stopped before midnight a late night, only the hours awake after it', () => {
      const snack = contextFor(0.5, 1, { scenario: { 1: ['late_snack'] } });
      const s = play(startSemester(snack, 1), snack, { ...bedAt(23.5, 'study'), choose: () => 'go' });
      expect(keys(s)).toContain('stayed_up');
      expect(keys(s)).not.toContain('study_late');
    });

    it('does not call midnight early, and calls it late from midnight on', () => {
      const early = play(startSemester(CTX, 1), CTX, bedAt(23.5));
      expect(amount(early.tags, CTX.dict, 'sleep_debt')).toBeGreaterThan(0);
      expect(keys(early)).not.toContain('stayed_up');
      expect(keys(play(startSemester(CTX, 1), CTX, bedAt(24)))).toContain('stayed_up');
    });

    it('names the caffeine left at bedtime, with its residual, and the cup it came from', () => {
      const s = play(startSemester(CTX, 1), CTX, { ...quiet, plan: () => ({ coffee: [21], rest: [] }) });
      const effect = causesOfDebt(s).find((c) => c.key === 'caffeine_insomnia')!;
      expect(effect.kind).toBe('effect');
      expect((effect.data as { residual: number }).residual).toBeGreaterThan(K.cafDeadZone - 1);
      const id = s.tags.log.nodes.find((n) => n.key === 'caffeine_insomnia')!.id;
      expect(trace(s.tags.log, id).map((n) => n.key)).toContain('coffee');
      expect(keys(play(startSemester(CTX, 1), CTX, bedAt(25)))).not.toContain('caffeine_insomnia');
      // a morning cup is mostly gone by a 01:00 bedtime: some residual, but under the dead zone
      const morning = play(startSemester(CTX, 1), CTX, { ...bedAt(25), plan: () => ({ coffee: [8], rest: [] }) });
      expect(keys(morning)).not.toContain('caffeine_insomnia');
      expect(morning.tags.log.nodes.some((n) => n.kind === 'tag' && n.key === 'caffeine')).toBe(true);
    });

    it('names the drink in the body at bedtime and the snack', () => {
      const bbq = contextFor(0.5, 1, { scenario: { 1: ['bbq'] } });
      const drink = play(startSemester(bbq, 1), bbq, { ...quiet, choose: () => 'binge' });
      expect(keys(drink)).toContain('alcohol_sleep');
      const snackCtx = contextFor(0.5, 1, { scenario: { 1: ['late_snack'] } });
      const snack = play(startSemester(snackCtx, 1), snackCtx, { ...bedAt(25), choose: () => 'takeout' });
      expect(causesOfDebt(snack).some((c) => c.kind === 'tag' && c.key === 'late_snack')).toBe(true);
    });
  });
});
