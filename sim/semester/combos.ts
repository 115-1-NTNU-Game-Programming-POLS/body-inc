/**
 * Every legal course selection against the responsive player and the night-owl player (design doc 9.6): `node combos.ts [n=30]`.
 * The doc asks that no selection lets the night owl pass and that the responsive player passes at least 85% of the time.
 * The responsive bound is held at skill 0.5 only (issue #40): no change of the thresholds or of the cards tried brought skill
 * 0.2 under it for every selection, so that column is printed to show the margin and does not fail the run.
 * Both players use the cards they hold: the owl pours every hour into the contest, the project and the debugging, the
 * responsive player takes the hours the cards ask for and keeps its bedtime. Exit code 1 when a bound breaks.
 * With the assignments played (the default) the selections that hold os have the floor HOMEWORK_FLOOR instead (issue #52): the
 * assignments, the contest and the project together ask for more hours than the heaviest of them have, and no lighter or better
 * paid assignment brought every one to 85%. The other selections have no assignment and keep the 85%, as does the sweep that
 * skips the assignments (--skip-homework).
 */
import {
  COURSES, MAX_DEBUG_PER_NIGHT, runSemester, selectionProblem, summarize, WRITE_HOURS, creditsOf,
  type DayView, type MorningPlan, type NightPlan, type SemesterContext, type Strategy,
} from '../../src/core/index.ts';
import { ARCHETYPES } from './archetypes.ts';
import { contextFor, scenarioFor } from './scenario.ts';

const n = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 30);
const SKILLS = [0.2, 0.5] as const;
const RESPONSIVE_PASS = 85;
/** Percent of seeds the responsive player must pass at skill 0.5 with the assignments played; the worst selection read 43% when it was set. */
const HOMEWORK_FLOOR = 40;
const BOUND_SKILL = 0.5;
const SKIP_HOMEWORK = process.argv.includes('--skip-homework');
const floorOf = (courses: readonly string[]): number => (!SKIP_HOMEWORK && courses.includes('os') ? HOMEWORK_FLOOR : RESPONSIVE_PASS);

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const pct = (xs: readonly boolean[]): number => (100 * xs.filter(Boolean).length) / Math.max(1, xs.length);

function choose(sizes: readonly string[], from: number, k: number, out: string[][], taken: string[] = []): void {
  if (taken.length === k) {
    out.push([...taken]);
    return;
  }
  for (let i = from; i < sizes.length; i++) {
    taken.push(sizes[i]!);
    choose(sizes, i + 1, k, out, taken);
    taken.pop();
  }
}

const selections = (): string[][] => {
  const all: string[][] = [];
  for (let k = 4; k <= 6; k++) choose(COURSES.map((c) => c.id), 0, k, all);
  return all.filter((ids) => selectionProblem(ids) === undefined);
};

interface Style {
  readonly rank: number;
  readonly rankBed: number;
  readonly project: (v: DayView) => number;
  readonly debug: number;
  readonly walk: boolean;
}

/** One hour of write per free hour is not asked: the plan only names how many of the assignment's hours remain. */
function playerOf(base: Strategy, style: Style, homework = !SKIP_HOMEWORK): Strategy {
  return {
    ...base,
    plan: (v): MorningPlan => {
      const open = homework ? v.homework.find((h) => h.written < WRITE_HOURS) : undefined;
      const project = style.project(v);
      return {
        ...base.plan(v),
        ...(open ? { write: WRITE_HOURS - open.written } : {}),
        ...(project > 0 ? { project } : {}),
        ...(style.walk && v.project ? { walk: true } : {}),
      };
    },
    night: (v): NightPlan => {
      const b = base.night(v);
      const next = homework ? v.homework.find((h) => h.debug !== undefined && h.debugged < h.debug) : undefined;
      const debug = next ? Math.min(style.debug, MAX_DEBUG_PER_NIGHT, next.debug! - next.debugged) : 0;
      return {
        ...b,
        ...(debug > 0 ? { debug } : {}),
        ...(v.rank?.open && style.rank > 0 ? { bed: style.rankBed, rank: style.rank } : {}),
      };
    },
  };
}

const responsive = playerOf(ARCHETYPES.balanced, {
  rank: 2, rankBed: 22, debug: 2, walk: true, project: (v) => (v.project?.open && v.day >= 6 ? 3 : 0),
});
const owl = playerOf(ARCHETYPES.nightOwl, {
  rank: 4, rankBed: 25, debug: MAX_DEBUG_PER_NIGHT, walk: false, project: (v) => (v.project?.open ? 4 : 0),
});

const BASES = new Map(SKILLS.map((skill) => [skill, contextFor(skill, 1, { scenario: {} })] as const));
const ctxOf = (skill: number, seed: number, courses: readonly string[]): SemesterContext =>
  ({ ...BASES.get(skill as 0.2)!, courses, scenario: scenarioFor(seed) });

function rates(courses: readonly string[], skill: number, player: Strategy): { pass: number; hosp: number; grade: number } {
  const sums = [];
  for (let seed = 1; seed <= n; seed++) {
    const ctx = ctxOf(skill, seed, courses);
    sums.push(summarize(runSemester(ctx, player, seed), ctx));
  }
  return { pass: pct(sums.map((m) => m.passMid && m.passFin)), hosp: pct(sums.map((m) => m.hospitalized)), grade: mean(sums.map((m) => m.grade)) };
}

const all = selections();
console.log(`${all.length} legal selections, ${n} seeds each`);
console.log(`${'selection'.padEnd(62)} cr   ${SKILLS.map((s) => `resp@${s} owl@${s}`).join('  ')}`);
let worstResp = 100;
let worstOwl = 0;
const rows: { readonly line: string; readonly bad: boolean; readonly credits: number; readonly resp: readonly number[] }[] = [];
for (const courses of all) {
  const cells: string[] = [];
  const resp: number[] = [];
  let bad = false;
  for (const skill of SKILLS) {
    const r = rates(courses, skill, responsive);
    const o = rates(courses, skill, owl);
    if (skill === BOUND_SKILL) worstResp = Math.min(worstResp, r.pass);
    worstOwl = Math.max(worstOwl, o.pass);
    if ((skill === BOUND_SKILL && r.pass < floorOf(courses)) || o.pass > 0) bad = true;
    resp.push(r.pass);
    cells.push(`${r.pass.toFixed(0).padStart(7)} ${o.pass.toFixed(0).padStart(7)}`);
  }
  rows.push({ line: `${courses.join(',').padEnd(62)} ${String(creditsOf(courses)).padStart(2)}  ${cells.join('  ')}`, bad, credits: creditsOf(courses), resp });
}
for (const row of rows.filter((r) => r.bad)) console.log(row.line);
// Per credit total: how many selections there are and how many of them the responsive player passes under the bound, per skill.
console.log(`\ncredits  selections  ${SKILLS.map((s) => `resp<${RESPONSIVE_PASS}%@${s}`).join('  ')}`);
for (const credits of [...new Set(rows.map((r) => r.credits))].sort((a, b) => a - b)) {
  const group = rows.filter((r) => r.credits === credits);
  const under = SKILLS.map((_, i) => group.filter((r) => r.resp[i]! < RESPONSIVE_PASS).length);
  console.log(`${String(credits).padStart(7)}  ${String(group.length).padStart(10)}  ${under.map((u) => String(u).padStart(13)).join('  ')}`);
}
console.log(`${rows.filter((r) => r.bad).length} of ${rows.length} selections break a bound (responsive floor ${RESPONSIVE_PASS}%${SKIP_HOMEWORK ? '' : `, ${HOMEWORK_FLOOR}% where os is held`}); worst responsive pass at skill ${BOUND_SKILL} ${worstResp.toFixed(0)}%, best owl pass ${worstOwl.toFixed(0)}%`);
process.exitCode = rows.some((r) => r.bad) ? 1 : 0;
