/**
 * The strategies and readings the playtest sweeps of the course cards share (design doc 9.6): `tuning.ts` and `homework.ts`
 * print them as tables, `checks.ts` asserts the thresholds of the design doc on them.
 */
import {
  clauseProblem, creditsOf, GRADE_HOURS, MAX_DEBUG_PER_NIGHT, OPEN_COURSES, PROJECT_DAY_MAX, runSemester, selectionProblem, summarize, withClause, WRITE_HOURS,
  type DayView, type MorningPlan, type NightPlan, type Strategy,
} from '../../src/core/index.ts';
import { ARCHETYPES } from './archetypes.ts';
import { contextFor, scenarioFor } from './scenario.ts';

export const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

/** The balanced archetype with one change to the card's own decision, so two variants differ only by that decision. */
export const variant = (
  plan: (v: DayView) => Partial<MorningPlan>,
  night: (v: DayView, base: NightPlan) => NightPlan,
): Strategy => {
  const base = ARCHETYPES.balanced;
  return { ...base, plan: (v) => ({ ...base.plan(v), ...plan(v) }), night: (v) => night(v, base.night(v)) };
};

/** Nights of the contest are the ones the view marks open; `bed` is the planned bedtime the hours come after. */
export const contest = (hours: number, bed: number, from = 0): Strategy =>
  variant(() => ({}), (v, b) => (v.rank?.open && hours > 0 && v.day >= from ? { ...b, bed, rank: hours } : b));

/** `perDay` project hours whenever the view allows them, from day `from`, until the project is done. */
export const project = (perDay: number, from: number, walk: boolean): Strategy =>
  variant((v) => (v.project?.open && v.day >= from ? { project: Math.min(perDay, PROJECT_DAY_MAX), walk } : {}), (_v, b) => b);

/** `early` writes on the first day the assignment is open and debugs two hours a night; the other writes on the last day and debugs the whole night. */
export const homeworkPlayer = (early: boolean): Strategy => {
  const base = ARCHETYPES.balanced;
  return {
    ...base,
    plan: (v) => {
      const h = v.homework.find((x) => x.written < WRITE_HOURS && (early || x.due - v.day === 1));
      return { ...base.plan(v), ...(h ? { write: WRITE_HOURS - h.written } : {}) };
    },
    night: (v) => {
      const h = v.homework.find((x) => x.debug !== undefined && x.debugged < x.debug);
      const hours = h ? Math.min(early ? 2 : MAX_DEBUG_PER_NIGHT, h.debug! - h.debugged) : 0;
      return { ...base.night(v), ...(hours > 0 ? { debug: hours } : {}) };
    },
  };
};

/**
 * The TA line's grading played three ways: not at all, in the day hours of the weekend after the midterm (3 hours, then the rest),
 * or all of it in the night of day 6. The hours come from the view, so a card that offers none is simply not played.
 */
export const grader = (when: 'skip' | 'day' | 'night'): Strategy =>
  variant(
    (v) => (when === 'day' && v.grade?.open && v.day > 5 ? { grade: Math.min(v.grade.need - v.grade.done, 3) } : {}),
    (v, b) => (when === 'night' && v.grade?.night && v.day === 6 && v.grade.need > v.grade.done ? { ...b, grade: v.grade.need - v.grade.done } : b),
  );

/** The cards of the grading sweep: the TA line with cards that ask for nothing else of the week after the midterm. */
export const TA_COURSES: readonly string[] = ['database', 'networks', 'software', 'ta'];

export interface GradeRow {
  /** Percent of semesters whose grades were handed in on time. */
  readonly onTime: number;
  /** Mean hours slept on the night of day 6, the night the all-nighter grades. */
  readonly sleep: number;
  /** Mean study progress the final exam counted. */
  readonly progress: number;
}

/** `strategy` over seeds 1 to `n` at `skill`, with the TA line's grading read the way the sweep of design doc 9.6 reads it. */
export function gradeRow(n: number, skill: number, strategy: Strategy): GradeRow {
  const base = contextFor(skill, 1, { scenario: {} });
  const onTime: number[] = [];
  const sleep: number[] = [];
  const progress: number[] = [];
  for (let seed = 1; seed <= n; seed++) {
    const ctx = { ...base, courses: TA_COURSES, scenario: scenarioFor(seed) };
    const end = runSemester(ctx, strategy, seed);
    onTime.push(end.graded >= GRADE_HOURS ? 100 : 0);
    progress.push(end.progress);
    const night = end.history[5];
    const next = end.history[6];
    if (night?.bedEnd !== undefined && next) sleep.push(24 + next.wake - night.bedEnd);
  }
  return { onTime: mean(onTime), sleep: mean(sleep), progress: mean(progress) };
}

/** Every selection of the cards the picker opens that overtime clause `level` lets stand, as the sweep of design doc 9.6 plays them. */
export function openSelections(level: number): string[][] {
  const ids = OPEN_COURSES.map((c) => c.id);
  const out: string[][] = [];
  for (let mask = 1; mask < 1 << ids.length; mask++) {
    const picks = ids.filter((_, i) => (mask & (1 << i)) !== 0);
    if (selectionProblem(picks) === undefined && clauseProblem(level, creditsOf(picks)) === undefined) out.push(picks);
  }
  return out;
}

export interface ClauseRow {
  /** Percent of semesters that passed both exams. */
  readonly pass: number;
  /** Mean percent of the final exam. */
  readonly fin: number;
  /** Mean study progress the final exam counted. */
  readonly progress: number;
}

/** `strategy` over seeds 1 to `n` at `skill`, taking `courses` under overtime clause `level`. */
export function clauseRow(n: number, skill: number, level: number, courses: readonly string[], strategy: Strategy): ClauseRow {
  const pass: number[] = [];
  const fin: number[] = [];
  const progress: number[] = [];
  for (let seed = 1; seed <= n; seed++) {
    const ctx = withClause(contextFor(skill, seed, { courses }), seed, level);
    const end = runSemester(ctx, strategy, seed);
    const m = summarize(end, ctx);
    pass.push(m.passMid && m.passFin ? 100 : 0);
    fin.push(m.fin);
    progress.push(end.progress);
  }
  return { pass: mean(pass), fin: mean(fin), progress: mean(progress) };
}

/** The cards of the assignment sweeps: operating systems with nothing else that asks for the evenings. */
export const HOMEWORK_COURSES: readonly string[] = ['os', 'database', 'networks', 'ta'];

export interface HomeworkRow {
  readonly grade: number;
  readonly pass: number;
  readonly handed: number;
  /** Percent of the debugging nights that ended at 01:00 or later. */
  readonly after01: number;
  readonly sleep: number;
}

/** `strategy` over seeds 1 to `n` at `skill`, with the assignments played the way the sweep of design doc 9.6 reads them. */
export function homeworkRow(n: number, skill: number, strategy: Strategy): HomeworkRow {
  const base = contextFor(skill, 1, { scenario: {} });
  const grades: number[] = [];
  const pass: number[] = [];
  const handed: number[] = [];
  const late: number[] = [];
  const sleep: number[] = [];
  for (let seed = 1; seed <= n; seed++) {
    const ctx = { ...base, courses: HOMEWORK_COURSES, scenario: scenarioFor(seed) };
    const end = runSemester(ctx, strategy, seed);
    const m = summarize(end, ctx);
    grades.push(m.grade);
    pass.push(m.passMid && m.passFin ? 100 : 0);
    handed.push(end.history.reduce((a, r) => a + r.homework.filter((h) => h.done).length, 0));
    end.history.forEach((r, i) => {
      if (r.bedEnd === undefined) return;
      const next = end.history[i + 1];
      if (next) sleep.push(24 + next.wake - r.bedEnd);
      if (r.homework.some((h) => h.debugged > 0)) late.push(r.bedEnd >= 25 ? 100 : 0);
    });
  }
  return { grade: mean(grades), pass: mean(pass), handed: mean(handed), after01: mean(late), sleep: mean(sleep) };
}
