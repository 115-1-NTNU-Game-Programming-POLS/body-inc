/**
 * The four player archetypes of design doc 9.5, read on the semester core, run by `check-archetypes.ts` and by
 * `test/sim/archetype-checks.test.ts`. The test also runs them against the breakages design doc 9.6 names (the sleep debt
 * coefficient at 0.01, no exam discount, the performance factor capped at 2.0), because a check that still passes then cannot
 * tell a healthy rule from a broken one.
 *
 * The semesters are played as 9.5 asks: overtime clause 0, no course cards, skill 0.2 for a player who cannot fight and 0.9
 * for one who can. 「兩者都不會」 is the balanced player and every archetype below it, averaged. 「約」 is read as within
 * ABOUT of the doc's figure. The doc's last paragraph adds that a fixed patrol order must score at least FIXED_MIN_GAP less
 * than patrolling by the lights and the work orders.
 *
 * Some expectations do not hold yet. They are listed in KNOWN_GAPS with the reason, so the run reports them without failing,
 * and a gap that starts to hold fails until it is taken off the list, so the list cannot go stale.
 */
import { FLOORS, runSemester, summarize, yearEndPoints, type SemesterContext, type Strategy } from '../../src/core/index.ts';
import { ARCHETYPES } from './archetypes.ts';
import { mean } from './cards.ts';
import { responsiveOf } from './players.ts';
import { contextFor, scenarioFor } from './scenario.ts';

export const SKILL_LOW = 0.2;
export const SKILL_HIGH = 0.9;
/** How far from the doc's average a grade may be and still be 「約」 it. */
export const ABOUT = 10;
/** Percent of semesters in hospital that 「幾乎不住院」 allows. */
export const ALMOST_NEVER = 5;
/** The smallest advantage, as a share of the fixed order's points, of patrolling by the lights over a fixed order. */
export const FIXED_MIN_GAP = 0.1;

export interface Expectation {
  readonly id: string;
  readonly name: string;
  readonly pass: boolean;
  readonly detail: string;
}

/** Expectations that do not hold yet, with why; see the module comment. */
export const KNOWN_GAPS: Readonly<Record<string, string>> = {
  'fighter.hospital': 'the roommate cold of design doc 9.1 is not in the semester yet, so the night owl meets fewer colds',
  'neither.fail': 'the balanced player passes every semester at skill 0.2, so the archetypes below it pass about half',
  'informed.grade': 'the responsive player who cannot fight averages about 80, ten points over the doc',
  'patrol.order': 'the floors worsen too slowly for the order to matter: the balanced player scores the same either way (9.5 says to raise the neglect bonus)',
};

interface Row {
  readonly pass: number;
  readonly fin: number;
  readonly hospital: number;
  readonly grade: number;
  readonly points: number;
}

/** `params` lays tuning over the game's, for the breakages. */
export function rowOf(n: number, skill: number, strategy: Strategy, params: Partial<SemesterContext['params']> = {}): Row {
  const pct = (xs: readonly boolean[]): number => (100 * xs.filter(Boolean).length) / Math.max(1, xs.length);
  const sums = [];
  const points: number[] = [];
  const hospital: boolean[] = [];
  for (let seed = 1; seed <= n; seed++) {
    const game = contextFor(skill, seed, {});
    const ctx: SemesterContext = { ...game, params: { ...game.params, ...params }, scenario: scenarioFor(seed) };
    const end = runSemester(ctx, strategy, seed);
    sums.push(summarize(end, ctx));
    points.push(yearEndPoints(end, ctx, 0));
    hospital.push(end.hospitals > 0);
  }
  return {
    pass: pct(sums.map((m) => m.passMid && m.passFin)),
    fin: pct(sums.map((m) => m.passFin)),
    hospital: pct(hospital),
    grade: mean(sums.map((m) => m.grade)),
    points: mean(points),
  };
}

/** The balanced player patrolling the floors in a fixed order, one a day, whatever the lights read. */
export const fixedOrder: Strategy = { ...ARCHETYPES.balanced, floor: (v) => ({ patrol: FLOORS[(v.day - 1) % FLOORS.length]! }) };

const BELOW_BALANCED = ['balanced', 'drinkerBlind', 'drinkerFed', 'drinkerInformed', 'insomniac', 'partier'] as const;

export function expectations(n: number, params: Partial<SemesterContext['params']> = {}): Expectation[] {
  const f = (x: number): string => x.toFixed(1);
  const row = (skill: number, s: Strategy): Row => rowOf(n, skill, s, params);
  const responsive = responsiveOf(true);
  const both = row(SKILL_HIGH, responsive);
  const informed = row(SKILL_LOW, responsive);
  const fighters = { nightOwl: row(SKILL_HIGH, ARCHETYPES.nightOwl), crammer: row(SKILL_HIGH, ARCHETYPES.crammer) };
  const neither = BELOW_BALANCED.map((name) => row(SKILL_LOW, ARCHETYPES[name]));
  const neitherPass = mean(neither.map((r) => r.pass));
  const lights = row(SKILL_HIGH, ARCHETYPES.balanced);
  const fixed = row(SKILL_HIGH, fixedOrder);
  const gap = (lights.points - fixed.points) / Math.max(1e-9, fixed.points);
  const fighterList = Object.entries(fighters);
  return [
    { id: 'both.grade', name: '兩者都會: about 90 on average', pass: Math.abs(both.grade - 90) <= ABOUT, detail: `${f(both.grade)}, wanted 90 ± ${ABOUT}` },
    { id: 'both.hospital', name: '兩者都會: almost never in hospital', pass: both.hospital <= ALMOST_NEVER, detail: `${f(both.hospital)}%, wanted at most ${ALMOST_NEVER}%` },
    { id: 'informed.pass', name: '懂衛教、不會打: passes 85% or more', pass: informed.pass >= 85, detail: `${f(informed.pass)}%` },
    { id: 'informed.grade', name: '懂衛教、不會打: about 70 on average', pass: Math.abs(informed.grade - 70) <= ABOUT, detail: `${f(informed.grade)}, wanted 70 ± ${ABOUT}` },
    {
      id: 'fighter.final',
      name: '會打、不懂衛教: passes the final 30% or less',
      pass: fighterList.every(([, r]) => r.fin <= 30),
      detail: fighterList.map(([k, r]) => `${k} ${f(r.fin)}%`).join(', '),
    },
    {
      id: 'fighter.hospital',
      name: '會打、不懂衛教: in hospital at least once in most semesters',
      pass: fighterList.every(([, r]) => r.hospital > 50),
      detail: fighterList.map(([k, r]) => `${k} ${f(r.hospital)}%`).join(', '),
    },
    { id: 'neither.fail', name: '兩者都不會: fails more often than not', pass: neitherPass < 50, detail: `${f(neitherPass)}% pass over ${BELOW_BALANCED.join(', ')}` },
    {
      id: 'patrol.order',
      name: `patrolling by the lights scores ${FIXED_MIN_GAP * 100}% more than a fixed order`,
      pass: gap >= FIXED_MIN_GAP,
      detail: `${f(lights.points)} points against ${f(fixed.points)}, ${f(100 * gap)}% more`,
    },
  ];
}

/** What a run of `expectations` means: a known gap that fails is reported, a known gap that holds and any other failure fail. */
export function verdict(results: readonly Expectation[]): { readonly ok: boolean; readonly lines: string[] } {
  const lines: string[] = [];
  let ok = true;
  for (const r of results) {
    const known = KNOWN_GAPS[r.id];
    if (r.pass && known !== undefined) {
      ok = false;
      lines.push(`HOLDS ${r.name}: ${r.detail} (listed as a known gap; take it off KNOWN_GAPS)`);
    } else if (r.pass) {
      lines.push(`ok    ${r.name}: ${r.detail}`);
    } else if (known !== undefined) {
      lines.push(`gap   ${r.name}: ${r.detail} (${known})`);
    } else {
      ok = false;
      lines.push(`FAIL  ${r.name}: ${r.detail}`);
    }
  }
  return { ok, lines };
}
