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
import { contest, homeworkPlayer, homeworkRow, mean } from './cards.ts';
import { ARCHETYPES } from './archetypes.ts';
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

const CONTEST_COURSES = ['algorithms', 'os', 'database', 'ta'];

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
  return out;
}
