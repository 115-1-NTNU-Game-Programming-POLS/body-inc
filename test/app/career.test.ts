import { describe, expect, it } from 'vitest';
import { bankPoints, buyCareerNode, careerCards, endSummary, finishSemester, newSemester, resumeSemester, TUTORIAL_SEED } from '../../src/app/semester.ts';
import { SaveStore } from '../../src/app/storage.ts';
import {
  BOOKED_BLOOD_TEST_DAY, CAREER_NODES, cannotBuy, decode, DEFAULT_HOST, encode, healthScore, HOSPITAL_FACTOR, playDay, PROGRESS, RUN, startSemester,
  summarize, withBloodTestOn, yearEndPoints, type DayRecord, type ProgressData, type SemesterState, type Strategy,
} from '../../src/core/index.ts';
import { contextFor, scenarioFor } from '../../sim/semester/scenario.ts';

/** The lateral career tree of design doc 8.14: year-end review points banked across semesters and spent on nodes. */

const fresh: ProgressData = { handbook: [], hostName: DEFAULT_HOST, semestersDone: 0 };
const store = (): { saves: SaveStore; data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { saves: new SaveStore({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) }), data };
};
const quiet: Strategy = {
  plan: () => ({ coffee: [], rest: [] }),
  choose: (_id, options) => options[0]!,
  floor: () => ({ patrol: 'brain' }),
  night: () => ({ bed: 22, nextWake: 7, lateNight: 'rest' }),
};
const ctx = contextFor(0.5, 1, { scenario: {} });
/** A semester three days in, with `patch` laid over it. */
function at(patch: Partial<SemesterState> = {}): SemesterState {
  let s = startSemester(ctx, 1);
  while (s.day <= 3) s = playDay(s, ctx, quiet);
  return { ...s, ...patch };
}
const withDay = (s: SemesterState, day: number, patch: Partial<DayRecord>): SemesterState =>
  ({ ...s, history: s.history.map((r) => (r.day === day ? { ...r, ...patch } : r)) });

describe('the health score (design doc 8.11)', () => {
  it('takes 6 a floor-day of strike up to 30 off 100, and never a night in the emergency room', () => {
    const s = at();
    const base = healthScore(s, ctx);
    expect(base).toBeLessThanOrEqual(100);
    expect(healthScore(withDay(s, 2, { strikes: ['brain', 'gut'] }), ctx)).toBeCloseTo(base - 12);
    expect(healthScore(withDay(withDay(s, 1, { strikes: ['brain', 'gut', 'immune'] }), 2, { strikes: ['brain', 'gut', 'stomach'] }), ctx)).toBeCloseTo(base - 30);
    // The stay it ends in already takes a fifth off the year-end points, so the night itself costs the health score nothing.
    expect(healthScore(withDay(s, 2, { crisis: { node: 0, at: 0, fasting: false } }), ctx)).toBeCloseTo(base);
  });

  it('takes 5 off for each night settled under chronic stress', () => {
    const s = at();
    const base = healthScore(s, ctx);
    expect(s.history.some((r) => r.chronicStress === true)).toBe(false);
    expect(healthScore(withDay(withDay(s, 1, { chronicStress: true }), 3, { chronicStress: true }), ctx)).toBeCloseTo(base - 10);
  });
});

describe('the year-end review points (design doc 8.14)', () => {
  it('gives a bankrupt semester 3 a day and 5 a page', () => {
    const s = at({ bankrupt: true });
    expect(yearEndPoints(s, ctx, 0)).toBe(3 * s.history.length);
    expect(yearEndPoints(s, ctx, 2)).toBe(3 * s.history.length + 10);
  });

  it('gives any other half its grade and half its health score and 5 a page, a fifth off for each stay in hospital', () => {
    const s = at({ mid: 70, fin: 40 });
    const half = 0.5 * summarize(s, ctx).grade + 0.5 * healthScore(s, ctx);
    expect(yearEndPoints(s, ctx, 0)).toBe(Math.round(half));
    expect(yearEndPoints(s, ctx, 3)).toBe(Math.round(half + 15));
    expect(yearEndPoints({ ...s, hospitals: 2 }, ctx, 0)).toBe(Math.round(half * HOSPITAL_FACTOR ** 2));
  });

  it('multiplies a passed semester with courses by its burden, and adds the finished project whether or not it passed', () => {
    const { ctx: c } = newSemester(1, [], ['os', 'compiler', 'database', 'networks']);
    let s = startSemester(c, 1);
    s = { ...s, mid: 90, fin: 90, project: 10, history: at().history };
    expect(summarize(s, c).passFin).toBe(true);
    const half = 0.5 * summarize(s, c).grade + 0.5 * healthScore(s, c);
    expect(yearEndPoints(s, c, 0)).toBe(Math.round(half * 1.15 + 10));
    expect(yearEndPoints({ ...s, project: 9 }, c, 0)).toBe(Math.round(half * 1.15));
    const failed = { ...s, fin: 10 };
    expect(summarize(failed, c).passFin).toBe(false);
    expect(yearEndPoints(failed, c, 0)).toBe(Math.round(0.5 * summarize(failed, c).grade + 0.5 * healthScore(s, c) + 10));
    expect(yearEndPoints({ ...failed, project: 9 }, c, 0)).toBe(Math.round(0.5 * summarize(failed, c).grade + 0.5 * healthScore(s, c)));
    expect(yearEndPoints({ ...s, bankrupt: true }, c, 1)).toBe(3 * s.history.length + 5 + 10);
    expect(yearEndPoints({ ...s, project: 10 }, newSemester(1, [], ['os', 'database', 'networks', 'software']).ctx, 0)).toBe(
      yearEndPoints({ ...s, project: 0 }, newSemester(1, [], ['os', 'database', 'networks', 'software']).ctx, 0));
  });

  it('explains the points of a finished project on the end page of a bankrupt semester too', () => {
    const { ctx: c } = newSemester(1, [], ['os', 'compiler', 'database', 'networks']);
    const s = { ...startSemester(c, 1), history: at().history, bankrupt: true, ended: true, project: 10 };
    expect(endSummary(s, c)).toContain('期末專案完成，年終評價點數另加 10');
    expect(endSummary({ ...s, project: 9 }, c).some((l) => l.includes('期末專案'))).toBe(false);
  });

  it('refuses a page count that is not a whole number of 0 or more', () => {
    expect(() => yearEndPoints(at(), ctx, -1)).toThrow(RangeError);
    expect(() => yearEndPoints(at(), ctx, 1.5)).toThrow(RangeError);
  });

  it('puts the points on the last page of a semester that did not pass', () => {
    const { ctx: c, state } = newSemester(1);
    const end = playDay({ ...state, day: 10, mid: 20 }, c, quiet);
    expect(endSummary(end, c, undefined, 1)).toContain(`年終評價點數：${yearEndPoints(end, c, 1)} 點`);
  });
});

describe('the points and nodes in the progress slot', () => {
  it('banks a semester\'s points on top of what was left', () => {
    const { saves, data } = store();
    const one = finishSemester(saves, fresh, undefined, [], 30);
    expect(one.progress.careerPoints).toBe(30);
    const two = finishSemester(saves, one.progress, undefined, [], 25);
    expect(two.progress.careerPoints).toBe(55);
    expect(decode(PROGRESS, data.get('hbc.v1.progress') ?? null).data.careerPoints).toBe(55);
    expect('careerPoints' in finishSemester(saves, fresh).progress).toBe(false);
  });

  it('banks more points on top, saved, and refuses a count that is not a whole number of 0 or more', () => {
    const { saves, data } = store();
    const more = bankPoints(saves, { ...fresh, careerPoints: 12 }, 5);
    expect(more.progress.careerPoints).toBe(17);
    expect(decode(PROGRESS, data.get('hbc.v1.progress') ?? null).data.careerPoints).toBe(17);
    const same = { ...fresh, careerPoints: 3 };
    expect(bankPoints(saves, same, 0).progress).toBe(same);
    expect(() => bankPoints(saves, fresh, -1)).toThrow(RangeError);
    expect(() => bankPoints(saves, fresh, 0.5)).toThrow(RangeError);
  });

  it('buys a node it can afford, once, and saves it', () => {
    const { saves, data } = store();
    const price = CAREER_NODES.early_checkup.price;
    expect(buyCareerNode(saves, { ...fresh, careerPoints: price - 1 }, 'early_checkup')).toEqual({ refused: 'short' });
    const bought = buyCareerNode(saves, { ...fresh, careerPoints: price + 5 }, 'early_checkup');
    if ('refused' in bought) throw new Error('refused');
    expect(bought.progress).toMatchObject({ careerPoints: 5, career: ['early_checkup'] });
    expect(decode(PROGRESS, data.get('hbc.v1.progress') ?? null).data.career).toEqual(['early_checkup']);
    expect(buyCareerNode(saves, bought.progress, 'early_checkup')).toEqual({ refused: 'owned' });
    expect(cannotBuy('early_checkup', 999, ['early_checkup'])).toBe('owned');
  });

  it('reads a version 5 save as having no points and no nodes', () => {
    const v5 = JSON.stringify({ schema: 5, data: { handbook: [], hostName: DEFAULT_HOST, semestersDone: 1, achievements: ['active_checkup'] } });
    const read = decode(PROGRESS, v5);
    expect(read.kind).toBe('migrated');
    expect(read.data.careerPoints).toBeUndefined();
    expect(read.data.career).toBeUndefined();
  });

  it('shows each node with its price, marks the one owned and the one short of points, and ends with the way out', () => {
    const short = careerCards({ ...fresh, careerPoints: 10 });
    expect(short.title).toBe('職涯樹：可用 10 點');
    expect(short.cards.map((c) => c.node)).toEqual(['early_checkup', 'order_details', 'two_settings', 'reroll', undefined]);
    expect(short.cards.map((c) => c.allowed)).toEqual([false, false, false, false, true]);
    expect(short.cards[0]!.label).toBe('健檢提前（40 點）');
    expect(short.cards[0]!.note).toContain('點數還不夠');
    expect(careerCards({ ...fresh, careerPoints: 40 }).cards.map((c) => c.allowed)).toEqual([true, false, false, true, true]);
    expect(careerCards({ ...fresh, careerPoints: 60 }).cards.map((c) => c.label)).toEqual(['健檢提前（40 點）', '工單明細（60 點）', '多一種開局卡（50 點）', '開局重抽（40 點）', '回到標題']);
    const owned = careerCards({ ...fresh, careerPoints: 100, career: ['early_checkup'] });
    expect(owned.cards[0]).toMatchObject({ label: '健檢提前（已解鎖）', allowed: false });
    expect(owned.cards.at(-1)!.node).toBeUndefined();
  });
});

describe('健檢提前 (design doc 8.14)', () => {
  const testDays = (scenario: Record<number, readonly string[]>) => Object.entries(scenario).filter(([, ids]) => ids.includes('blood_test')).map(([d]) => Number(d));

  it('moves the blood test to day 3 and leaves every other event where it was', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const dealt = scenarioFor(seed);
      const booked = withBloodTestOn(dealt, BOOKED_BLOOD_TEST_DAY);
      expect(testDays(booked), `seed ${seed}`).toEqual([3]);
      const others = (s: Record<number, readonly string[]>) => Object.fromEntries(Object.entries(s).map(([d, ids]) => [d, ids.filter((id) => id !== 'blood_test')]).filter(([, ids]) => (ids as string[]).length > 0));
      expect(others(booked)).toEqual(others(dealt));
    }
  });

  it('shapes a semester begun with the node, its replay from the save, and never the scripted first week', () => {
    const seed = [1, 2, 3, 4, 5, 6, 7, 8, 9].find((s) => !testDays(scenarioFor(s)).includes(3))!;
    expect(testDays(newSemester(seed).ctx.scenario)).not.toEqual([3]);
    expect(testDays(newSemester(seed, undefined, undefined, 0, ['early_checkup']).ctx.scenario)).toEqual([3]);
    expect(testDays(newSemester(seed, undefined, undefined, 0, ['unknown_node']).ctx.scenario)).not.toEqual([3]);
    expect(newSemester(TUTORIAL_SEED, undefined, undefined, 0, ['early_checkup']).ctx.scenario).toEqual(newSemester(TUTORIAL_SEED).ctx.scenario);
    expect(testDays(resumeSemester({ seed, career: ['early_checkup'], days: [] })!.ctx.scenario)).toEqual([3]);
  });

  it('keeps the nodes of a run through the run slot, and reads an older run as having none', () => {
    const run = { semester: { seed: 4, career: ['early_checkup'], days: [] } };
    expect(decode(RUN, encode(RUN, run))).toEqual({ kind: 'ok', data: run });
    const v10 = JSON.stringify({ schema: 10, data: { semester: { seed: 4, days: [] } } });
    expect(decode(RUN, v10)).toEqual({ kind: 'migrated', from: 10, data: { semester: { seed: 4, days: [] } } });
  });
});
