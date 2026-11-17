import { BURDEN_REWARD, burdenOf, creditsOf, PROJECT_NEED, PROJECT_REVIEW, takes } from './courses.ts';
import { summarize } from './semester.ts';
import type { SemesterContext, SemesterState } from './types.ts';

/**
 * The nodes of the lateral career tree (design doc 8.14) that exist so far, with the line each belongs to and its price in
 * year-end review points. A node unlocks an option, never a number on the body.
 */
export const CAREER_NODES = {
  // 健檢提前: the health office's blood test is booked on day 3 instead of falling on a day the seed draws.
  early_checkup: { line: 'audit', price: 40 },
} as const satisfies Record<string, { readonly line: string; readonly price: number }>;

export type CareerNode = keyof typeof CAREER_NODES;

export const CAREER_ORDER = Object.keys(CAREER_NODES) as CareerNode[];

export const isCareerNode = (id: string): id is CareerNode => Object.hasOwn(CAREER_NODES, id);

/** The day 健檢提前 books the blood test on. */
export const BOOKED_BLOOD_TEST_DAY = 3;

/** A stay in hospital takes a fifth off the semester's points (design doc 8.14: "× 0.8^住院次數"). */
export const HOSPITAL_FACTOR = 0.8;

/**
 * The health score of design doc 8.11 (結局): 100 less 4 per hour of sleep debt at the end, 6 per floor-day of strike (30 at
 * most), and 10 per crisis. Its fourth term, 5 per day of chronic stress, waits for a chronic-stress tag the semester does not
 * have yet, so it is left out rather than guessed.
 */
export function healthScore(state: SemesterState, ctx: SemesterContext): number {
  const debt = summarize(state, ctx).finalDebt;
  const strikeDays = state.history.reduce((n, r) => n + r.strikes.length, 0);
  const crises = state.history.filter((r) => r.crisis !== undefined).length;
  return Math.max(0, 100 - 4 * debt - Math.min(30, 6 * strikeDays) - 10 * crises);
}

/**
 * The year-end review points a finished semester earns (design doc 8.14, content spec 5.3). A bankrupt semester earns 3 per day
 * it lasted and 5 per handbook page it found; any other earns half its grade and half its health score and 5 per page, a fifth
 * less for each stay in hospital. A passed semester's points are multiplied by its burden's reward and the finished compiler
 * project adds its 10 (design doc 8.3). The restart factor of a semester begun again from the midterm is 1, since there is no
 * such restart yet. `pages` are the handbook pages first found during the semester, which only the progress knows.
 */
export function yearEndPoints(state: SemesterState, ctx: SemesterContext, pages: number): number {
  if (!Number.isInteger(pages) || pages < 0) throw new RangeError(`a semester cannot have found ${pages} handbook pages`);
  const sum = summarize(state, ctx);
  if (sum.bankrupt) return Math.round(3 * state.history.length + 5 * pages);
  const passed = sum.passMid && sum.passFin;
  const base = (0.5 * sum.grade + 0.5 * healthScore(state, ctx) + 5 * pages) * HOSPITAL_FACTOR ** state.hospitals;
  if (!passed || ctx.courses === undefined) return Math.round(base);
  const bonus = takes(ctx.courses, 'compiler') && state.project >= PROJECT_NEED ? PROJECT_REVIEW : 0;
  return Math.round(base * BURDEN_REWARD[burdenOf(creditsOf(ctx.courses))] + bonus);
}

/** Why a node cannot be bought with `points` by a player who owns `owned`, or undefined when it can. */
export function cannotBuy(id: CareerNode, points: number, owned: readonly string[]): 'owned' | 'short' | undefined {
  if (owned.includes(id)) return 'owned';
  return points < CAREER_NODES[id].price ? 'short' : undefined;
}
