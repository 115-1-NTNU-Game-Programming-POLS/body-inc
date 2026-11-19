/**
 * The burden guard rail of design doc 8.3 (高風險高回報的設計護欄), the row of design doc 9.6 that judges it, run by
 * `check-burden.ts` and by `test/sim/burden-checks.test.ts`. The test also runs it against broken rules, because a check that
 * still passes with the burden reward flattened or the hospital made harmless cannot tell a healthy rail from a broken one.
 *
 * The three criteria are read by burden class means, as the 9.6 row compares classes, not single selections: heavy means a
 * selection of 16 credits or more (heavy and full). The best strategy of a selection is the candidate with the most year-end
 * points on average, handbook pages left out; its sleep is the mean effective sleep of its nights, a hospital night counting
 * as the debt counts it (hospitalSleep). Dropping a course (停修), which 8.3's responsive player may do, is not in the semester
 * yet, so no candidate drops one.
 */
import {
  burdenOf, COURSES, creditsOf, runSemester, selectionProblem, yearEndPoints, type Burden, type DayView, type SemesterContext, type Strategy,
} from '../../src/core/index.ts';
import { ARCHETYPES } from './archetypes.ts';
import { mean } from './cards.ts';
import type { CardCheck } from './checks.ts';
import { owlOf, playerOf, responsiveOf } from './players.ts';
import { contextFor, scenarioFor } from './scenario.ts';

/** Percentage points by which the heavy-burden owl's hospital rate must exceed the light-burden responsive player's. */
export const HOSPITAL_MIN_GAP = 15;
/** Hours of effective sleep a night the best strategy of every selection must average. */
export const BEST_MIN_SLEEP = 7;

const HEAVY: readonly Burden[] = ['heavy', 'full'];

/** Every legal selection of the full course table, as the 9.6 row asks for every combination. */
export function allSelections(): string[][] {
  const ids = COURSES.map((c) => c.id);
  const out: string[][] = [];
  const pick = (from: number, taken: string[]): void => {
    if (taken.length >= 4 && selectionProblem(taken) === undefined) out.push([...taken]);
    if (taken.length === 6) return;
    for (let i = from; i < ids.length; i++) pick(i + 1, [...taken, ids[i]!]);
  };
  pick(0, []);
  return out;
}

/** Bedtimes of the balanced player who studies late and still keeps the exam eve early: the ground between 22:30 and 01:00. */
export const LATE_BEDS = [23, 23.5, 24, 24.5] as const;

const CARD_STYLE = { rank: 2, rankBed: 22, debug: 2, walk: true, project: (v: DayView) => (v.project?.open && v.day >= 6 ? 3 : 0) };

/** The balanced player studying until `bed` on every night but the exam eve, playing the cards as the responsive player does. */
export function lateStudier(bed: number): Strategy {
  const base = ARCHETYPES.balanced;
  return playerOf({ ...base, night: (v) => (v.examTomorrow ? base.night(v) : { ...base.night(v), bed, lateNight: 'study' }) }, CARD_STYLE, true);
}

/**
 * The strategies the best of a selection is taken from: the responsive player and the owl, every other archetype playing the
 * course cards the way the responsive player does (so that none is out of the running only for ignoring them), and the late
 * studiers of LATE_BEDS. Without the late studiers no candidate sleeps between the balanced player's 7.8 hours and the late
 * archetypes' 4.4, and the third criterion could not fail: a rule that stops punishing short sleep would still pass it.
 */
export function candidates(): Record<string, Strategy> {
  const out: Record<string, Strategy> = { responsive: responsiveOf(true), owl: owlOf(true) };
  for (const [name, base] of Object.entries(ARCHETYPES)) if (name !== 'balanced' && name !== 'nightOwl') out[name] = playerOf(base, CARD_STYLE, true);
  for (const bed of LATE_BEDS) out[`late${bed}`] = lateStudier(bed);
  return out;
}

export interface PlayerRow {
  readonly points: number;
  /** Percent of seeds with at least one stay in hospital. */
  readonly hospital: number;
  readonly sleep: number;
}

export interface BurdenRow {
  readonly courses: readonly string[];
  readonly burden: Burden;
  readonly players: Readonly<Record<string, PlayerRow>>;
}

/** `params` lays tuning over the game's, for the test that breaks a rule the rail rests on. */
export function burdenRows(
  n: number, skill: number, selections: readonly (readonly string[])[], players: Readonly<Record<string, Strategy>>,
  params: Partial<SemesterContext['params']> = {},
): BurdenRow[] {
  const game = contextFor(skill, 1, { scenario: {} });
  const base: SemesterContext = { ...game, params: { ...game.params, ...params } };
  return selections.map((courses) => {
    const rows: Record<string, PlayerRow> = {};
    for (const [name, strategy] of Object.entries(players)) {
      const points: number[] = [];
      const hospital: number[] = [];
      const sleep: number[] = [];
      for (let seed = 1; seed <= n; seed++) {
        const ctx: SemesterContext = { ...base, courses, scenario: scenarioFor(seed) };
        const end = runSemester(ctx, strategy, seed);
        points.push(yearEndPoints(end, ctx, 0));
        hospital.push(end.hospitals > 0 ? 100 : 0);
        sleep.push(mean(end.history.flatMap((r) => (r.slept === undefined ? [] : [r.slept]))));
      }
      rows[name] = { points: mean(points), hospital: mean(hospital), sleep: mean(sleep) };
    }
    return { courses, burden: burdenOf(creditsOf(courses)), players: rows };
  });
}

/** The best candidate of a row: the most points, the order of the candidates breaking a tie. */
export const bestOf = (row: BurdenRow): string => Object.keys(row.players).reduce((a, b) => (row.players[b]!.points > row.players[a]!.points ? b : a));

export function burdenChecks(rows: readonly BurdenRow[]): CardCheck[] {
  const f = (x: number): string => x.toFixed(1);
  const light = rows.filter((r) => r.burden === 'light');
  const heavy = rows.filter((r) => HEAVY.includes(r.burden));
  if (light.length === 0 || heavy.length === 0) {
    return [{ name: 'burden: the selections hold a light class and a heavy one', pass: false, detail: `${light.length} light and ${heavy.length} heavy selections` }];
  }
  const of = (group: readonly BurdenRow[], player: string, key: keyof PlayerRow): number => mean(group.map((r) => r.players[player]![key]));
  const lightResp = of(light, 'responsive', 'points');
  const heavyResp = of(heavy, 'responsive', 'points');
  const heavyOwl = of(heavy, 'owl', 'points');
  const gap = of(heavy, 'owl', 'hospital') - of(light, 'responsive', 'hospital');
  const short = rows.filter((r) => r.players[bestOf(r)]!.sleep < BEST_MIN_SLEEP);
  const worst = rows.reduce((a, b) => (b.players[bestOf(b)]!.sleep < a.players[bestOf(a)]!.sleep ? b : a));
  return [
    {
      name: 'burden: the responsive player earns more points with a heavy burden than with a light one',
      pass: heavyResp > lightResp,
      detail: `heavy ${f(heavyResp)} over ${heavy.length} selections against light ${f(lightResp)} over ${light.length}`,
    },
    {
      name: 'burden: the night owl with a heavy burden earns fewer points than the responsive player with a light one',
      pass: heavyOwl < lightResp,
      detail: `heavy owl ${f(heavyOwl)} against light responsive ${f(lightResp)}`,
    },
    {
      name: 'burden: the night owl with a heavy burden is in hospital clearly more often',
      pass: gap >= HOSPITAL_MIN_GAP,
      detail: `heavy owl ${f(of(heavy, 'owl', 'hospital'))}% against light responsive ${f(of(light, 'responsive', 'hospital'))}%, wanted at least ${HOSPITAL_MIN_GAP} points more`,
    },
    {
      name: `burden: the best strategy of every selection sleeps ${BEST_MIN_SLEEP} hours or more`,
      pass: short.length === 0,
      detail: short.length === 0
        ? `lowest ${worst.players[bestOf(worst)]!.sleep.toFixed(2)} h (${bestOf(worst)} on ${worst.courses.join(',')}) of ${rows.length} selections`
        : `${short.length} of ${rows.length} under, e.g. ${short.slice(0, 3).map((r) => `${bestOf(r)} on ${r.courses.join(',')} ${r.players[bestOf(r)]!.sleep.toFixed(2)} h`).join('; ')}`,
    },
  ];
}
