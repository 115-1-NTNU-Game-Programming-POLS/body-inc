import {
  advanceDay, amount, BURDEN_REWARD, burdenOf, composeReport, creditsOf, EVENTS, reviewPoints, PROGRESS, prototypeContext, semesterInputs, startSemester, summarize, withBarbecueOn,
  type FloorChoice, type FloorId, type MorningPlan, type NightPlan, type ProgressData, type ReportDocument, type Scenario, type SemesterContext, type SemesterRun, type SemesterState,
} from '../core/index.ts';
import { fillStr as fill, PARAMS, REPORT, str, STRINGS, TAGS } from './content.ts';
import type { SaveIssue, SaveStore } from './storage.ts';

/**
 * The patrol is not played yet (design doc 8.5 wants four rooms per patrol): its grade is drawn from
 * this abstract combat skill, as in `sim/`. 0.5 is a player who is neither struggling nor skilled.
 */
export const PATROL_SKILL = 0.5;

/**
 * The seed of the scripted first week (design doc 8.13, PM decision S3). The script is keyed on the
 * seed so a saved run replays it with no extra field; a clock seed hits it once in 2^31 starts.
 */
export const TUTORIAL_SEED = 20_261_207;

/** The days of the tutorial script whose first screen carries a line from the chairman; the strings are `semester.tutor.<day>`. */
export const TUTOR_DAYS = [1, 3] as const;

/**
 * The first three days are fixed: nothing on day 1 and day 3, the barbecue on the evening of day 2
 * (design doc 8.13). From day 4 the seed deals as usual.
 */
export const tutorialScenario = (dealt: Scenario): Scenario => ({ ...dealt, 1: [], 2: ['bbq'], 3: [] });

/** The seed of a new semester: the scripted first week until one has been played to its end, then the clock. */
export const freshSeed = (semestersDone: number, now: number): number => (semestersDone === 0 ? TUTORIAL_SEED : now % 2_147_483_647);

/** The progress after a semester ran to its end, and issues from writing it; the registry copy follows even when the write failed. */
export function finishSemester(saves: SaveStore, progress: ProgressData): { progress: ProgressData; issues: SaveIssue[] } {
  const next = { ...progress, semestersDone: progress.semestersDone + 1 };
  return { progress: next, issues: saves.save(PROGRESS, next) };
}

/** The chairman's line for the morning of `day`, or undefined when the semester is not the tutorial or the day has none. */
export const tutorLine = (seed: number, day: number): string | undefined =>
  seed === TUTORIAL_SEED && (TUTOR_DAYS as readonly number[]).includes(day) ? str(`semester.tutor.${day}`) : undefined;

/** The courses of the scripted first week (design doc 8.13): the algorithms, the operating systems, the database and the TA line, 9 credits. */
export const TUTORIAL_COURSES = ['algorithms', 'os', 'database', 'ta'] as const;

/** A new semester's rules and its events, which the seed alone fixes; `courses` are what the player took, absent for the dev semesters. */
export function semesterContext(seed: number, courses?: readonly string[]): SemesterContext {
  const dealt = prototypeContext(TAGS, PARAMS, PATROL_SKILL, seed);
  const base = seed === TUTORIAL_SEED ? { ...dealt, scenario: tutorialScenario(dealt.scenario) } : dealt;
  return courses === undefined ? base : { ...base, courses };
}

/** `bbqDays` is a dev override (app/session.ts semesterFromQuery); a normal game takes the events its seed deals. */
export const newSemester = (seed: number, bbqDays?: readonly number[], courses?: readonly string[]): { ctx: SemesterContext; state: SemesterState } => {
  const dealt = semesterContext(seed, courses);
  const ctx = bbqDays === undefined ? dealt : { ...dealt, scenario: withBarbecueOn(dealt.scenario, bbqDays) };
  return { ctx, state: startSemester(ctx, seed) };
};

/**
 * The semester a saved run was in, at the morning after its last finished day, or undefined when
 * the answers or the seed's events no longer fit the rules (an event or option renamed since): the title then offers
 * only a new semester. A run that had already ended is never saved, so one that replays to its end
 * is stale too.
 */
export function resumeSemester(run: SemesterRun): { ctx: SemesterContext; state: SemesterState } | undefined {
  try {
    const { ctx, state: start } = newSemester(run.seed, undefined, run.courses);
    let state = start;
    for (const answers of run.days) {
      const step = advanceDay(state, ctx, answers);
      if (!step.done || step.state.ended) return undefined;
      state = step.state;
    }
    return { ctx, state };
  } catch (e) {
    if (e instanceof RangeError) return undefined;
    throw e;
  }
}

/** The cups of coffee a morning offers, by hour of the day; the strings are `semester.coffee.<id>`. */
export const COFFEE_PLANS = {
  none: [],
  morning: [8],
  two: [8, 17],
} as const satisfies Record<string, readonly number[]>;

/** The hours of the day spent resting instead of studying; the strings are `semester.rest.<id>`. */
export const REST_PLANS = {
  grind: [21],
  balanced: [17, 21],
  easy: [16, 17, 20, 21],
} as const satisfies Record<string, readonly number[]>;

/** Bedtime on the extended clock (25 is 01:00) and what the hours before it go to; the strings are `semester.night.<id>`. */
export const NIGHT_PLANS = {
  early: { bed: 22.5, lateNight: 'rest' },
  midnight: { bed: 24, lateNight: 'rest' },
  late: { bed: 25, lateNight: 'study' },
} as const satisfies Record<string, Pick<NightPlan, 'bed' | 'lateNight'>>;

export type CoffeePlanId = keyof typeof COFFEE_PLANS;
export type RestPlanId = keyof typeof REST_PLANS;
export type NightPlanId = keyof typeof NIGHT_PLANS;

export const morningPlan = (coffee: CoffeePlanId, rest: RestPlanId): MorningPlan => ({ coffee: [...COFFEE_PLANS[coffee]], rest: [...REST_PLANS[rest]] });

/** Everyone wakes at the usual hour; sleeping in is not offered yet. */
export const nightPlan = (id: NightPlanId): NightPlan => ({ ...NIGHT_PLANS[id], nextWake: PARAMS.wake });

export const floorChoice = (patrol: FloorId, overtime?: FloorId): FloorChoice => (overtime === undefined ? { patrol } : { patrol, overtime });

/** 0 for Monday: day 1 of a semester is a Monday (design doc 8.1). */
export const weekdayOf = (day: number): number => (day - 1) % 7;

/** Whether any option of the event pours a drink, which shows the under-18 notice (design doc 11.3). */
export const servesAlcohol = (eventId: string): boolean =>
  Object.values(EVENTS.find((e) => e.id === eventId)?.options ?? {}).some((o) => (o.alcohol ?? 0) > 0);

const floorName = (floor: FloorId): string => str(`semester.floor.${floor}`);
const percent = (x: number): number => Math.round(x);
const oneDecimal = (x: number): string => x.toFixed(1);

/**
 * What the player is told after a day: the exam, the patrols, sleep debt and progress, and any
 * strike or trip to the emergency room. It reads the finished day's record and tags, never a floor
 * load, so the liver can only appear here once it has struck.
 */
export function daySummary(before: SemesterState, after: SemesterState, ctx: SemesterContext): string[] {
  const rec = after.history[after.history.length - 1];
  if (rec === undefined || after.history.length !== before.history.length + 1) throw new RangeError('daySummary needs the states before and after exactly one day');
  const k = ctx.params;
  const lines: string[] = [];
  // A hospital day that falls on an exam day is recorded as a hospital day, and the exam counts as 0.
  if (before.day === k.midDay) lines.push(fill('semester.sum.exam.mid', { p: percent(after.mid ?? 0) }));
  if (before.day === k.finDay) lines.push(fill('semester.sum.exam.fin', { p: percent(after.fin ?? 0) }));
  for (const p of rec.patrols) lines.push(fill(p.overtime ? 'semester.sum.overtime' : 'semester.sum.patrol', { floor: floorName(p.floor), grade: p.grade }));
  lines.push(fill('semester.sum.debt', { debt: oneDecimal(amount(after.tags, ctx.dict, 'sleep_debt')) }));
  lines.push(fill('semester.sum.progress', { progress: oneDecimal(after.progress) }));
  for (const f of rec.strikes) lines.push(fill('semester.sum.strike', { floor: floorName(f) }));
  if (rec.kind === 'hospital') lines.push(str('semester.sum.hospital_day'));
  if (rec.hospitalized) lines.push(str(after.bankrupt ? 'semester.sum.bankrupt' : 'semester.sum.hospital'));
  return lines;
}

/**
 * The document the emergency room of the day just finished produced (a closure notice for the
 * first visit, a bankruptcy report for the second), or nothing when the day sent no one there.
 * `known` is the handbook pages the player holds before reading it, which decides whether the
 * report says a page is unlocked or only referred to.
 */
export function visitReport(state: SemesterState, ctx: SemesterContext, seed: number, known: ReadonlySet<string>): ReportDocument | undefined {
  const last = state.history[state.history.length - 1];
  if (last?.crisis === undefined) return undefined;
  const text = (k: string): string => {
    const s = STRINGS.strings[k];
    if (!s) throw new RangeError(`content/strings has no "${k}"`);
    return s.text;
  };
  // Only the visit this day ended is written; the earlier ones were shown on their own days.
  const input = semesterInputs(state, ctx, { cfg: REPORT, text, seed, known }).at(-1);
  return input === undefined ? undefined : composeReport(input, { cfg: REPORT, text, seed });
}

/** The semester's result once it has ended: the two exams, the grade, and how the semester went. */
export function endSummary(state: SemesterState, ctx: SemesterContext): string[] {
  if (!state.ended) throw new RangeError('the semester has not ended');
  const sum = summarize(state, ctx);
  const lines = [
    fill('semester.end.exams', { mid: percent(sum.mid), fin: percent(sum.fin) }),
    fill('semester.end.grade', { grade: percent(sum.grade) }),
    str(sum.passMid && sum.passFin ? 'semester.end.pass' : 'semester.end.fail'),
  ];
  if (sum.bankrupt) lines.push(str('semester.end.bankrupt'));
  else if (sum.hospitalized) lines.push(str('semester.end.hospital'));
  lines.push(fill('semester.end.debt', { debt: oneDecimal(sum.finalDebt) }));
  if (ctx.courses !== undefined && sum.passMid && sum.passFin) {
    const credits = creditsOf(ctx.courses);
    const burden = burdenOf(credits);
    lines.push(fill('semester.end.review', { points: percent(reviewPoints(sum.grade, credits)), burden: str(`semester.burden.${burden}`), reward: BURDEN_REWARD[burden].toFixed(2) }));
  }
  return lines;
}
