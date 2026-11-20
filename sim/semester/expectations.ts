/**
 * The four player archetypes of design doc 9.5, read on the semester core, run by `check-archetypes.ts` and by
 * `test/sim/archetype-checks.test.ts`. The test also runs them against the breakages design doc 9.6 names (the sleep debt
 * coefficient at 0.01, no exam discount, the performance factor capped at 2.0), because a check that still passes then cannot
 * tell a healthy rule from a broken one.
 *
 * The semesters are played as 9.5 asks, at overtime clause 0, with skill 0.2 for a player who cannot fight and 0.9 for one
 * who can, and over the legal course selections, since every semester of the game has one: semester i of a run plays seed i
 * and the i-th selection of RUN_ORDER, so the default run of SELECTION_COUNT semesters plays each selection once and a
 * shorter run keeps the mix of course loads of the whole.
 * Every archetype plays the course cards as the burden rail's candidates do (the responsive player's way, the night owl its
 * own). 「兩者都不會」 is the balanced player and the seven archetypes below it, averaged. 「約」 is read as within ABOUT of
 * the doc's figure. The doc's last paragraph adds that a fixed patrol order must score at least FIXED_MIN_GAP less than
 * patrolling by the lights and the work orders; it is played on the night owl without overtime, since the balanced player's
 * floors never light, courses or not, and the two orders cannot differ there.
 *
 * Some expectations do not hold yet. They are listed in KNOWN_GAPS with the reason and the value measured over the default
 * run, so the run reports them without failing. A shorter run samples a pass rate only to within several points, so it
 * reports the known gaps without judging them. A gap that starts to hold fails until it is taken off the list, so the list cannot go
 * stale, and a gap that moves more than GAP_SLACK the wrong way fails too, so a known gap cannot hide a regression.
 */
import { FLOORS, runSemester, summarize, yearEndPoints, type SemesterContext, type Strategy } from '../../src/core/index.ts';
import { ARCHETYPES, type ArchetypeName } from './archetypes.ts';
import { allSelections, CARD_STYLE } from './burden.ts';
import { mean } from './cards.ts';
import { owlOf, playerOf, responsiveOf } from './players.ts';
import { contextFor, scenarioFor } from './scenario.ts';
import { burdenOf, creditsOf, type Burden } from '../../src/core/semester/courses.ts';
import { nextInt, seedRng } from '../../src/core/rng.ts';

const ORDER_SEED = 1;

/**
 * The selections in the order a run plays them. allSelections() lists them depth first, so neighbours share most courses and
 * a plain prefix is nearly all of one load; instead each load class is shuffled with a fixed seed and the classes are
 * interleaved by their share, so every prefix keeps the mix of loads of the whole and spreads over the courses.
 */
export function runOrder(selections: readonly (readonly string[])[], seed = ORDER_SEED): (readonly string[])[] {
  const classes = new Map<Burden, (readonly string[])[]>();
  for (const sel of selections) {
    const b = burdenOf(creditsOf(sel));
    classes.set(b, [...(classes.get(b) ?? []), sel]);
  }
  let rng = seedRng(seed);
  const keyed: { key: number; sel: readonly string[] }[] = [];
  for (const list of classes.values()) {
    const shuffled = [...list];
    for (let i = shuffled.length - 1; i > 0; i--) {
      let j: number;
      [j, rng] = nextInt(rng, i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    shuffled.forEach((sel, i) => keyed.push({ key: (i + 0.5) / shuffled.length, sel }));
  }
  return keyed.sort((a, b) => a.key - b.key).map((k) => k.sel);
}

const RUN_ORDER = runOrder(allSelections());
/** A run of this many semesters plays every legal selection once. */
export const SELECTION_COUNT = RUN_ORDER.length;

export const SKILL_LOW = 0.2;
export const SKILL_HIGH = 0.9;
/** How far from the doc's average a grade may be and still be 「約」 it. */
export const ABOUT = 10;
/** Percent of semesters in hospital that 「幾乎不住院」 allows. */
export const ALMOST_NEVER = 5;
/** The smallest advantage, as a share of the fixed order's points, of patrolling by the lights over a fixed order. */
export const FIXED_MIN_GAP = 0.1;
/** How far a known gap may move the wrong way from its listed value, in its own unit, before the run fails. */
export const GAP_SLACK = 3;

export interface Expectation {
  readonly id: string;
  readonly name: string;
  readonly pass: boolean;
  readonly detail: string;
  /** The figure the expectation is judged on, which a known gap is held to. */
  readonly value: number;
}

export interface KnownGap {
  readonly reason: string;
  /** The value over the default run when the gap was listed. */
  readonly at: number;
  /** Which way is worse: 1 when a higher value is further from the doc, -1 when a lower one is. */
  readonly worse: 1 | -1;
}

/** Expectations that do not hold yet; see the module comment. */
export const KNOWN_GAPS: Readonly<Record<string, KnownGap>> = {
  'informed.pass': {
    reason: 'the heavy selections pull the unskilled responsive player under the pass line, though it averages about 75',
    at: 78.7,
    worse: -1,
  },
};

interface Row {
  readonly pass: number;
  readonly fin: number;
  readonly hospital: number;
  readonly grade: number;
  readonly points: number;
}

/** Semester `seed` of a run: the selection it plays and its scenario; `params` lays tuning over the game's, for the breakages. */
function semesterOf(skill: number, seed: number, params: Partial<SemesterContext['params']>): SemesterContext {
  const game = contextFor(skill, seed, {});
  return { ...game, params: { ...game.params, ...params }, courses: RUN_ORDER[(seed - 1) % RUN_ORDER.length]!, scenario: scenarioFor(seed) };
}

/** The archetype playing the course cards, as the burden rail's candidates do. */
export function withCards(name: ArchetypeName): Strategy {
  if (name === 'balanced') return responsiveOf(true);
  if (name === 'nightOwl') return owlOf(true);
  return playerOf(ARCHETYPES[name], CARD_STYLE, true);
}

export function rowOf(n: number, skill: number, strategy: Strategy, params: Partial<SemesterContext['params']> = {}): Row {
  const pct = (xs: readonly boolean[]): number => (100 * xs.filter(Boolean).length) / Math.max(1, xs.length);
  const sums = [];
  const points: number[] = [];
  const hospital: boolean[] = [];
  for (let seed = 1; seed <= n; seed++) {
    const ctx = semesterOf(skill, seed, params);
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

/** The share of patrol days on which some floor was lit or the liver showed a clue, for `strategy` at `skill`. */
export function litShare(n: number, skill: number, strategy: Strategy, params: Partial<SemesterContext['params']> = {}): number {
  let days = 0;
  let lit = 0;
  const spy: Strategy = {
    ...strategy,
    floor(v, tags, liverLoad) {
      days += 1;
      if (v.panel.buttons.some((b) => b.light !== 'off') || v.liverClues.stomachJam) lit += 1;
      return strategy.floor(v, tags, liverLoad);
    },
  };
  for (let seed = 1; seed <= n; seed++) runSemester(semesterOf(skill, seed, params), spy, seed);
  return lit / Math.max(1, days);
}

/** `strategy` patrolling by its own reading of the floors, without the overtime patrol. */
export const byLights = (strategy: Strategy): Strategy => ({ ...strategy, floor: (v, tags, liverLoad) => ({ patrol: strategy.floor(v, tags, liverLoad).patrol }) });

/** `strategy` patrolling the floors in turn, one a patrol day, whatever the lights read; the midterm day has no patrol. */
export const fixedOrder = (strategy: Strategy, midDay: number): Strategy => ({
  ...strategy,
  floor: (v) => ({ patrol: FLOORS[(v.day - 1 - (v.day > midDay ? 1 : 0)) % FLOORS.length]! }),
});

const BELOW_BALANCED = ['balanced', 'drinkerBlind', 'drinkerFed', 'drinkerInformed', 'insomniac', 'partier', 'nightOwl', 'crammer'] as const;

export function expectations(n: number, params: Partial<SemesterContext['params']> = {}): Expectation[] {
  const f = (x: number): string => x.toFixed(1);
  const row = (skill: number, s: Strategy): Row => rowOf(n, skill, s, params);
  const responsive = responsiveOf(true);
  const both = row(SKILL_HIGH, responsive);
  const informed = row(SKILL_LOW, responsive);
  const fighters = { nightOwl: row(SKILL_HIGH, withCards('nightOwl')), crammer: row(SKILL_HIGH, withCards('crammer')) };
  const neither = BELOW_BALANCED.map((name) => row(SKILL_LOW, withCards(name)));
  const neitherPass = mean(neither.map((r) => r.pass));
  const owl = byLights(withCards('nightOwl'));
  const lights = row(SKILL_HIGH, owl);
  const fixed = row(SKILL_HIGH, fixedOrder(owl, contextFor(SKILL_HIGH, 1, {}).params.midDay));
  const gap = (lights.points - fixed.points) / Math.max(1e-9, fixed.points);
  const lit = litShare(n, SKILL_HIGH, owl, params);
  const fighterList = Object.entries(fighters);
  return [
    { id: 'both.grade', name: '兩者都會: about 90 on average', pass: Math.abs(both.grade - 90) <= ABOUT, detail: `${f(both.grade)}, wanted 90 ± ${ABOUT}`, value: both.grade },
    {
      id: 'both.hospital',
      name: '兩者都會: almost never in hospital',
      pass: both.hospital <= ALMOST_NEVER,
      detail: `${f(both.hospital)}%, wanted at most ${ALMOST_NEVER}%`,
      value: both.hospital,
    },
    { id: 'informed.pass', name: '懂衛教、不會打: passes 85% or more', pass: informed.pass >= 85, detail: `${f(informed.pass)}%`, value: informed.pass },
    {
      id: 'informed.grade',
      name: '懂衛教、不會打: about 70 on average',
      pass: Math.abs(informed.grade - 70) <= ABOUT,
      detail: `${f(informed.grade)}, wanted 70 ± ${ABOUT}`,
      value: informed.grade,
    },
    {
      id: 'fighter.final',
      name: '會打、不懂衛教: passes the final 30% or less',
      pass: fighterList.every(([, r]) => r.fin <= 30),
      detail: fighterList.map(([k, r]) => `${k} ${f(r.fin)}%`).join(', '),
      value: Math.max(...fighterList.map(([, r]) => r.fin)),
    },
    {
      id: 'fighter.hospital',
      name: '會打、不懂衛教: in hospital at least once in most semesters',
      pass: fighterList.every(([, r]) => r.hospital > 50),
      detail: fighterList.map(([k, r]) => `${k} ${f(r.hospital)}%`).join(', '),
      value: Math.min(...fighterList.map(([, r]) => r.hospital)),
    },
    {
      id: 'neither.fail',
      name: '兩者都不會: fails more often than not',
      pass: neitherPass < 50,
      detail: `${f(neitherPass)}% pass over ${BELOW_BALANCED.join(', ')}`,
      value: neitherPass,
    },
    {
      id: 'patrol.order',
      name: `the night owl patrolling by the lights scores ${FIXED_MIN_GAP * 100}% more than in a fixed order`,
      // With no floor ever lit the two orders cannot differ, and the comparison would prove nothing.
      pass: gap >= FIXED_MIN_GAP && lit > 0,
      detail: `${f(lights.points)} points against ${f(fixed.points)}, ${f(100 * gap)}% more; a floor lit or a liver clue on ${f(100 * lit)}% of patrol days`,
      value: 100 * gap,
    },
  ];
}

/**
 * What a run of `n` semesters of `expectations` means: a known gap that fails within GAP_SLACK of its listed value is
 * reported; a known gap that holds or has moved further from the doc, and any other failure, fail the run. A known gap is
 * only judged on a run as long as the one it was listed from.
 */
export function verdict(results: readonly Expectation[], n = SELECTION_COUNT): { readonly ok: boolean; readonly lines: string[] } {
  const lines: string[] = [];
  let ok = true;
  for (const r of results) {
    const known = KNOWN_GAPS[r.id];
    if (known !== undefined && n !== SELECTION_COUNT) {
      lines.push(`gap?  ${r.name}: ${r.detail} (a known gap, not judged on a run of ${n}; it was listed from ${SELECTION_COUNT})`);
    } else if (r.pass && known !== undefined) {
      ok = false;
      lines.push(`HOLDS ${r.name}: ${r.detail} (listed as a known gap; take it off KNOWN_GAPS)`);
    } else if (r.pass) {
      lines.push(`ok    ${r.name}: ${r.detail}`);
    } else if (known !== undefined && (r.value - known.at) * known.worse > GAP_SLACK) {
      ok = false;
      lines.push(`WORSE ${r.name}: ${r.detail} (a known gap listed at ${known.at}, now more than ${GAP_SLACK} further from the doc)`);
    } else if (known !== undefined) {
      lines.push(`gap   ${r.name}: ${r.detail} (${known.reason})`);
    } else {
      ok = false;
      lines.push(`FAIL  ${r.name}: ${r.detail}`);
    }
  }
  return { ok, lines };
}
