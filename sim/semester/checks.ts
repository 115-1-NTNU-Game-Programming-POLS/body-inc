/**
 * The discrimination checks of the course cards (design doc 9.6), run by `check-cards.ts` and by
 * `test/sim/course-card-checks.test.ts`. The test runs them against the real constants and against broken ones, because a
 * check that still passes with the leaderboard not decaying or the debugging time fixed cannot tell a healthy card from a
 * broken one.
 *
 * The contest is read on the board of the spread-out comparison, every contest night of 2 hours against the last two nights
 * of 4 hours: `tuning.ts` explains why the plain 3 and 4 hour rows hide the decay (the final exam caps the board they show).
 */
import { runSemester } from '../../src/core/index.ts';
import { clauseRow, contest, grader, gradeRow, homeworkPlayer, homeworkRow, mean, openSelections } from './cards.ts';
import { ARCHETYPES } from './archetypes.ts';
import { owlOf, responsiveOf } from './players.ts';
import { contextFor, scenarioFor } from './scenario.ts';

export interface CardCheck {
  readonly name: string;
  readonly pass: boolean;
  readonly detail: string;
}

/** The smallest advantage design doc 9.6 asks of stopping early at the contest. */
export const CONTEST_MIN_RATIO = 1.15;
/** Percent of debugging nights ending after 01:00: under this for the early start, over the other for the night before. */
export const EARLY_MAX_AFTER01 = 10;
export const LATE_MIN_AFTER01 = 50;
/** Percent of semesters that must hand the grades in when the player grades, however the hours are spread. */
export const GRADES_MIN_ON_TIME = 95;
/** Hours of sleep the all-night grading must cost against grading by day, and points of study progress it must cost on top of the day's. */
export const NIGHT_MIN_SLEEP_COST = 3;
export const NIGHT_MIN_STUDY_COST = 2;
/** Points of study progress the grading hours must take from a player who grades by day (so the column is a choice). */
export const DAY_MIN_STUDY_COST = 3;

/** Points of final exam percent clause 1 must take from the responsive player, and points of study progress the setting card of clause 2 must take on top. */
export const CLAUSE1_MIN_FIN_COST = 2;
export const CLAUSE2_MIN_STUDY_COST = 2;
/** Percent of seeds the responsive player must pass at skill 0.5 on every selection a clause lets stand (design doc 9.6). */
export const CLAUSE_MIN_PASS = 60;

const CONTEST_COURSES = ['algorithms', 'os', 'database', 'ta'];
/** The selection the clause costs are read on: the contest, the assignments and the project, the hours the setting card competes for. */
const CLAUSE_COURSES = ['algorithms', 'os', 'compiler', 'ta'];

function boardOf(n: number, skill: number, strategy: Parameters<typeof runSemester>[1]): number {
  const boards: number[] = [];
  for (let seed = 1; seed <= n; seed++) {
    const ctx = { ...contextFor(skill, seed, { courses: CONTEST_COURSES }), scenario: scenarioFor(seed) };
    boards.push(runSemester(ctx, strategy, seed).rank);
  }
  return mean(boards);
}

export function courseCardChecks(n = 300): CardCheck[] {
  const out: CardCheck[] = [];
  const f = (x: number): string => x.toFixed(2);

  const ratio = boardOf(n, 0.5, contest(2, 22)) / boardOf(n, 0.5, contest(4, 22, 8));
  out.push({ name: 'contest: 2 hours every night beats 4 hours on the last two', pass: ratio >= CONTEST_MIN_RATIO, detail: `board ratio ${f(ratio)}, wanted at least ${CONTEST_MIN_RATIO}` });

  const early = homeworkRow(n, 0.5, homeworkPlayer(true));
  const before = homeworkRow(n, 0.5, homeworkPlayer(false));
  out.push({ name: 'assignments: starting early rarely ends after 01:00', pass: early.after01 < EARLY_MAX_AFTER01, detail: `${early.after01.toFixed(1)}%, wanted under ${EARLY_MAX_AFTER01}%` });
  out.push({ name: 'assignments: starting the night before often does', pass: before.after01 > LATE_MIN_AFTER01, detail: `${before.after01.toFixed(1)}%, wanted over ${LATE_MIN_AFTER01}%` });

  for (const skill of [0.2, 0.5]) {
    const e = homeworkRow(n, skill, homeworkPlayer(true));
    const l = homeworkRow(n, skill, homeworkPlayer(false));
    const ignore = homeworkRow(n, skill, ARCHETYPES.balanced);
    out.push({
      name: `assignments: starting early is the better play (skill ${skill})`,
      pass: e.pass >= l.pass && e.grade >= l.grade,
      detail: `early ${e.pass.toFixed(1)}% pass, grade ${e.grade.toFixed(1)}; night before ${l.pass.toFixed(1)}%, ${l.grade.toFixed(1)}`,
    });
    out.push({
      name: `assignments: handing them in beats ignoring them (skill ${skill})`,
      pass: e.grade > ignore.grade,
      detail: `early grade ${e.grade.toFixed(1)}, ignored ${ignore.grade.toFixed(1)}`,
    });
  }

  // The TA line's grading (design doc 8.3). The play does not depend on the skill (the papers are no combat), so one skill reads it.
  const skip = gradeRow(n, 0.5, grader('skip'));
  const byDay = gradeRow(n, 0.5, grader('day'));
  const byNight = gradeRow(n, 0.5, grader('night'));
  out.push({ name: 'grading: skipping the papers leaves the grades unhanded', pass: skip.onTime === 0, detail: `${skip.onTime.toFixed(1)}% on time, wanted 0%` });
  out.push({ name: 'grading: grading by day on the weekend hands the grades in', pass: byDay.onTime >= GRADES_MIN_ON_TIME, detail: `${byDay.onTime.toFixed(1)}% on time, wanted at least ${GRADES_MIN_ON_TIME}%` });
  out.push({ name: 'grading: grading all in one night hands the grades in too', pass: byNight.onTime >= GRADES_MIN_ON_TIME, detail: `${byNight.onTime.toFixed(1)}% on time, wanted at least ${GRADES_MIN_ON_TIME}%` });
  out.push({
    name: 'grading: the all-nighter costs the night\'s sleep',
    pass: byDay.sleep - byNight.sleep >= NIGHT_MIN_SLEEP_COST,
    detail: `${f(byNight.sleep)} h against ${f(byDay.sleep)} h, wanted at least ${NIGHT_MIN_SLEEP_COST} h less`,
  });
  out.push({
    name: 'grading: grading by day takes study from the final',
    pass: skip.progress - byDay.progress >= DAY_MIN_STUDY_COST,
    detail: `progress ${f(byDay.progress)} against ${f(skip.progress)} skipped, wanted at least ${DAY_MIN_STUDY_COST} less`,
  });
  out.push({
    name: 'grading: the all-nighter costs more study than grading by day',
    pass: byDay.progress - byNight.progress >= NIGHT_MIN_STUDY_COST,
    detail: `progress ${f(byNight.progress)} against ${f(byDay.progress)} by day, wanted at least ${NIGHT_MIN_STUDY_COST} less`,
  });

  // The overtime clauses (design doc 8.3) and the stacking of burden and clause (design doc 9.6), played by the responsive player.
  const responsive = responsiveOf(true);
  const owl = owlOf(true);
  const at = (level: number) => clauseRow(n, 0.5, level, CLAUSE_COURSES, responsive);
  const [c0, c1, c2] = [at(0), at(1), at(2)];
  out.push({ name: 'clauses: level 1 makes the final harder', pass: c0.fin - c1.fin >= CLAUSE1_MIN_FIN_COST, detail: `final ${f(c1.fin)}% against ${f(c0.fin)}%, wanted at least ${CLAUSE1_MIN_FIN_COST} less` });
  out.push({ name: 'clauses: the setting card of level 2 costs study', pass: c1.progress - c2.progress >= CLAUSE2_MIN_STUDY_COST, detail: `progress ${f(c2.progress)} against ${f(c1.progress)}, wanted at least ${CLAUSE2_MIN_STUDY_COST} less` });
  for (const level of [1, 2]) {
    const rows = openSelections(level).map((courses) => ({ courses, resp: clauseRow(n, 0.5, level, courses, responsive).pass, owl: clauseRow(n, 0.5, level, courses, owl).pass }));
    const worst = rows.reduce((a, b) => (b.resp < a.resp ? b : a));
    out.push({
      name: `clauses: the responsive player passes every selection level ${level} lets stand`,
      pass: worst.resp >= CLAUSE_MIN_PASS,
      detail: `worst ${worst.resp.toFixed(1)}% on ${worst.courses.join(',')} of ${rows.length} selections, wanted at least ${CLAUSE_MIN_PASS}%`,
    });
    out.push({ name: `clauses: the night owl passes none of them at level ${level}`, pass: rows.every((r) => r.owl === 0), detail: `best owl pass ${Math.max(...rows.map((r) => r.owl)).toFixed(1)}%, wanted 0%` });
  }
  return out;
}
