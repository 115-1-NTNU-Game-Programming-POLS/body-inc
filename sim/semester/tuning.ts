/**
 * Playtest sweep for the algorithms contest and the compiler project (design doc 9.6): `node tuning.ts [n=300]`.
 * Each variant plays the balanced archetype with one change to the card's own decision, over the same seeds, so a column
 * differs between rows only by that decision. The table is a balance reading, not an invariant check.
 */
import { creditsOf, rankGain, reviewPoints, runSemester, summarize, PROJECT_DAY_MAX, PROJECT_NEED, PROJECT_REVIEW, type DayView, type MorningPlan, type NightPlan, type SemesterContext, type SemesterState, type Strategy } from '../../src/core/index.ts';
import { ARCHETYPES } from './archetypes.ts';
import { contextFor, scenarioFor } from './scenario.ts';

const n = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 300);
const SKILLS = [0.2, 0.5, 0.9] as const;

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const pct = (xs: readonly boolean[]): number => (100 * xs.filter(Boolean).length) / Math.max(1, xs.length);
const f1 = (x: number): string => x.toFixed(1).padStart(6);

const variant = (
  plan: (v: DayView) => Partial<MorningPlan>,
  night: (v: DayView, base: NightPlan) => NightPlan,
): Strategy => {
  const base = ARCHETYPES.balanced;
  return { ...base, plan: (v) => ({ ...base.plan(v), ...plan(v) }), night: (v) => night(v, base.night(v)) };
};

/** Nights of the contest are the ones the view marks open; `bed` is the planned bedtime the hours come after. */
const contest = (hours: number, bed: number, from = 0): Strategy =>
  variant(() => ({}), (v, b) => (v.rank?.open && hours > 0 && v.day >= from ? { ...b, bed, rank: hours } : b));

/** `perDay` project hours whenever the view allows them, from day `from`, until the project is done. */
const project = (perDay: number, from: number, walk: boolean): Strategy =>
  variant((v) => (v.project?.open && v.day >= from ? { project: Math.min(perDay, PROJECT_DAY_MAX), walk } : {}), (_v, b) => b);

const sleepOf = (s: SemesterState): number => {
  const h = s.history;
  return mean(h.flatMap((r, i) => (r.bedEnd !== undefined && h[i + 1] ? [24 + h[i + 1]!.wake - r.bedEnd] : [])));
};

interface Row {
  readonly label: string;
  readonly courses: readonly string[];
  readonly strategy: Strategy;
}

function report(title: string, rows: readonly Row[], extra: (s: SemesterState) => number, extraName: string): void {
  console.log(`\n${title}`);
  console.log(`${'variant'.padEnd(22)} skill   fin  grade review  pass%  hosp%  sleep  ${extraName.padStart(8)}`);
  for (const skill of SKILLS) {
    for (const row of rows) {
      const ends: SemesterState[] = [];
      const ctxs: SemesterContext[] = [];
      for (let seed = 1; seed <= n; seed++) {
        const ctx = { ...contextFor(skill, seed, { courses: row.courses }), scenario: scenarioFor(seed) };
        ends.push(runSemester(ctx, row.strategy, seed));
        ctxs.push(ctx);
      }
      const sums = ends.map((s, i) => summarize(s, ctxs[i]!));
      const credits = creditsOf(row.courses);
      const review = sums.map((m, i) => {
        const bonus = row.courses.includes('compiler') && ends[i]!.project >= PROJECT_NEED ? PROJECT_REVIEW : 0;
        return m.passMid && m.passFin ? reviewPoints(m.grade, credits, bonus) : 0;
      });
      console.log([
        row.label.padEnd(22), skill.toFixed(1).padStart(5), f1(mean(sums.map((m) => m.fin))), f1(mean(sums.map((m) => m.grade))), f1(mean(review)),
        f1(pct(sums.map((m) => m.passMid && m.passFin))), f1(pct(sums.map((m) => m.hospitalized))), f1(mean(ends.map(sleepOf))), f1(mean(ends.map(extra))).padStart(8),
      ].join(' '));
    }
  }
}

const ALGO = ['algorithms', 'os', 'database', 'ta'];
/** The same credits without a card of its own to play, as the yardstick for what the card adds. */
const PLAIN = ['os', 'database', 'networks', 'ta'];
report('Algorithms contest (nights of days 6 to 9)', [
  { label: 'plain cards (yardstick)', courses: PLAIN, strategy: contest(0, 22.5) },
  { label: 'no contest', courses: ALGO, strategy: contest(0, 22.5) },
  { label: '1h, ends 23:00', courses: ALGO, strategy: contest(1, 22) },
  { label: '1h, ends 23:30', courses: ALGO, strategy: contest(1, 22.5) },
  { label: '2h, ends 24:00', courses: ALGO, strategy: contest(2, 22) },
  { label: '2h, ends 00:30', courses: ALGO, strategy: contest(2, 22.5) },
  { label: '3h, ends 01:00', courses: ALGO, strategy: contest(3, 22) },
  { label: '4h, ends 02:00', courses: ALGO, strategy: contest(4, 22) },
  { label: '4h, last 2 nights', courses: ALGO, strategy: contest(4, 22, 8) },
], (s) => s.rank, 'board');
console.log(`gain of the first night at S = 1: ${[1, 2, 3, 4].map((h) => rankGain(h, 1).toFixed(1)).join(' / ')} for 1 to 4 hours`);

const COMP = ['compiler', 'os', 'database', 'ta'];
report('Compiler final project (from day 3)', [
  { label: 'no project', courses: COMP, strategy: project(0, 3, false) },
  { label: '1h a day, walk', courses: COMP, strategy: project(1, 3, true) },
  { label: '2h a day, walk', courses: COMP, strategy: project(2, 3, true) },
  { label: '2h a day, no walk', courses: COMP, strategy: project(2, 3, false) },
  { label: '4h from day 7', courses: COMP, strategy: project(4, 7, true) },
  { label: '4h from day 7, no walk', courses: COMP, strategy: project(4, 7, false) },
  { label: '3h from day 6, walk', courses: COMP, strategy: project(3, 6, true) },
  { label: '3h from day 6, no walk', courses: COMP, strategy: project(3, 6, false) },
  { label: '4h from day 8', courses: COMP, strategy: project(4, 8, true) },
], (s) => (s.project >= PROJECT_NEED ? 100 : 0), 'done%');

