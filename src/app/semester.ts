import {
  advanceDay, amount, BURDEN_REWARD, burdenOf, clauseFinMult, CLAUSE_CREDIT_CAP, commitmentsOf, composeReport, creditsOf, EVENTS, fixedHour, GRADE_HOURS, GRADE_PAPERS, gradeDays, HOMEWORK_MISS_PENALTY, HOMEWORK_PROGRESS, isFailed, patrolKit, PROJECT_FIN_PENALTY, PROJECT_NEED, PROJECT_REVIEW, projectDue, RANK_FULL, rankNights, RANK_SHARE, rankSharePercent, reviewPoints, PROGRESS, takes, prototypeContext, semesterInputs, settingHours, SIT_LIMIT, startSemester, summarize, unlockedAfter, welfareOffer, withBarbecueOn, withClause,
  type DayView, type FloorChoice, type FloorId, type MorningPlan, type NightPlan, type PatrolKit, type PatrolResult, type ProgressData, type ReportDocument, type Scenario, type SemesterContext, type SemesterRun, type SemesterState,
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

/**
 * The progress after a semester ran to its end, and issues from writing it; the registry copy follows even when the write failed.
 * `played` is the clause level the semester was played at and whether it was cleared, which decides what the next start may pick.
 */
export function finishSemester(saves: SaveStore, progress: ProgressData, played?: { readonly level: number; readonly cleared: boolean }): { progress: ProgressData; issues: SaveIssue[] } {
  const unlocked = played === undefined ? undefined : unlockedAfter(progress.clauseUnlocked ?? 0, played.level, played.cleared);
  const next = { ...progress, semestersDone: progress.semestersDone + 1, ...(unlocked === undefined ? {} : { clauseUnlocked: unlocked }) };
  return { progress: next, issues: saves.save(PROGRESS, next) };
}

/** Whether the semester passed both exams, which is what clears its clause level. */
export function semesterCleared(state: SemesterState, ctx: SemesterContext): boolean {
  const sum = summarize(state, ctx);
  return sum.passMid && sum.passFin;
}

export const clauseName = (level: number): string => str(`course.clause.name.${level}`);

/** The picker's note under clause `level`. */
export function clauseNote(level: number): string {
  const key = `course.clause.note.${level}`;
  switch (level) {
    case 1: return fill(key, { mult: clauseFinMult(level) });
    case 2: return fill(key, { cap: CLAUSE_CREDIT_CAP[level]! });
    default: return str(key);
  }
}

/** The first and last-plus-one hour of a block of fixed hours, as the texts name them. */
const spanOf = (hours: readonly number[]): { from: number; to: number } => ({ from: Math.min(...hours), to: Math.max(...hours) + 1 });

/**
 * What the morning of `day` tells of the clause and the setting card: on the first day the clause and the card's whole schedule,
 * on a day the card falls on a reminder of its hours.
 */
export function settingLines(ctx: SemesterContext, day: number): string[] {
  const lines: string[] = [];
  const level = ctx.clause ?? 0;
  const setting = ctx.setting;
  if (day === 1) {
    if (level > 0) lines.push(fill('semester.clause.intro', { level, name: clauseName(level), mult: clauseFinMult(level) }));
    const first = setting?.commitments[0];
    if (setting !== undefined && first !== undefined) {
      lines.push(fill(`semester.setting.intro.${setting.id}`, { days: setting.commitments.map((c) => c.day).join('、'), ...spanOf(first.hours) }));
    }
    return lines;
  }
  const hours = settingHours(setting, day);
  if (setting !== undefined && hours.length > 0) lines.push(fill(`semester.setting.today.${setting.id}`, spanOf(hours)));
  return lines;
}

/** The picker's note under card `id`. A note with a placeholder needs a case here; the test walks every open card to catch one without. */
export function courseNote(id: string): string {
  const key = `course.note.${id}`;
  switch (id) {
    case 'algorithms': {
      const { from, to } = rankNights(PARAMS);
      return fill(key, { from, to, share: rankSharePercent });
    }
    case 'compiler':
      return fill(key, { credits: creditsOf([id]) });
    case 'ta': {
      const [first, second] = commitmentsOf(id);
      return fill(key, { from: first!.day, to: second!.day, hours: first!.hours.length, papers: GRADE_PAPERS, grade: GRADE_HOURS, due: gradeDays(PARAMS).to });
    }
    default:
      return str(key);
  }
}

/** The title and caption of the compiler project question; `room` is the hours the plan so far leaves for it. */
export const projectPrompt = (project: { readonly done: number; readonly need: number }, room: number, params: { readonly finDay: number }): { title: string; caption: string } => ({
  title: fill('semester.project.title', { due: projectDue(params) }),
  caption: fill('semester.project.caption', { done: project.done.toFixed(1), need: project.need, room, limit: SIT_LIMIT }),
});

/** The title and caption of the grading question of the morning (`night` false) or of the night; `room` is the hours the plan so far leaves for it. */
export const gradePrompt = (grade: { readonly done: number; readonly need: number; readonly due: number }, night: boolean, room: number): { title: string; caption: string } => {
  const vars = { done: grade.done, need: grade.need, due: grade.due, room };
  return night
    ? { title: str('semester.gradenight.title'), caption: fill('semester.gradenight.caption', vars) }
    : { title: fill('semester.grade.title', vars), caption: fill('semester.grade.caption', vars) };
};

/** The walk question of the stuck point: its title and caption, and the cards for sitting on and for taking the walk, in that order. */
export function walkPrompt(): { title: string; caption: string; options: { label: string; note: string }[] } {
  const limit = { limit: SIT_LIMIT };
  return {
    title: str('semester.walk.title'),
    caption: fill('semester.walk.caption', limit),
    options: [
      { label: str('semester.walk.none'), note: fill('semester.walk.none.note', limit) },
      { label: fill('semester.walk.take', limit), note: str('semester.walk.take.note') },
    ],
  };
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

/**
 * `bbqDays` is a dev override (app/session.ts semesterFromQuery); a normal game takes the events its seed deals. `clause` is the
 * overtime clause level; the scripted first week is level 0 whatever is asked, and the clause comes last so the setting card
 * sees the events the semester really has.
 */
export const newSemester = (seed: number, bbqDays?: readonly number[], courses?: readonly string[], clause = 0): { ctx: SemesterContext; state: SemesterState } => {
  const dealt = semesterContext(seed, courses);
  const scened = bbqDays === undefined ? dealt : { ...dealt, scenario: withBarbecueOn(dealt.scenario, bbqDays) };
  const ctx = withClause(scened, seed, seed === TUTORIAL_SEED ? 0 : clause);
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
    const { ctx, state: start } = newSemester(run.seed, undefined, run.courses, run.clause);
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

export const morningPlan = (coffee: CoffeePlanId, rest: RestPlanId, write = 0, project = 0, walk = false, grade = 0): MorningPlan =>
  ({ coffee: [...COFFEE_PLANS[coffee]], rest: [...REST_PLANS[rest]], ...(write > 0 ? { write } : {}), ...(project > 0 ? { project } : {}), ...(grade > 0 ? { grade } : {}), ...(walk ? { walk } : {}) });

/** Everyone wakes at the usual hour; sleeping in is not offered yet. */
export const nightPlan = (id: NightPlanId, debug = 0, rank = 0, grade = 0): NightPlan =>
  ({ ...NIGHT_PLANS[id], nextWake: PARAMS.wake, ...(debug > 0 ? { debug } : {}), ...(rank > 0 ? { rank } : {}), ...(grade > 0 ? { grade } : {}) });

export const floorChoice = (patrol: FloorId, overtime?: FloorId, played?: readonly (PatrolResult | null)[], card?: string): FloorChoice =>
  ({ patrol, ...(overtime === undefined ? {} : { overtime }), ...(played === undefined || played.every((r) => r === null) ? {} : { played }), ...(card === undefined ? {} : { card }) });

/** The welfare cards the day's first patrol offers (design doc 8.8): none unless its rooms were played and it was not failed. */
export const patrolOffer = (view: DayView, ctx: SemesterContext, floor: FloorId, result: PatrolResult | null): readonly string[] =>
  result === null || isFailed(result) ? [] : welfareOffer({ salt: view.welfare.salt, day: view.day, floor, grade: result.grade, held: view.welfare.held, courses: ctx.courses });

export const welfareText = (id: string): { label: string; note: string } => ({ label: str(`welfare.${id}.name`), note: str(`welfare.${id}.effect`) });

export const welfareCaption = (held: readonly string[]): string =>
  held.length === 0 ? str('semester.welfare.caption.none') : fill('semester.welfare.caption', { held: held.map((id) => str(`welfare.${id}.name`)).join('、') });

/** What the overtime patrol starts with when `card` was picked after the first one: the kit the cards held then give. */
export const kitWith = (view: DayView, card: string | undefined): PatrolKit =>
  card === undefined ? view.welfare.kit : patrolKit([...view.welfare.held, card], view.welfare.last);

/** What the player is told right after the rooms of a patrol: the rating, or that it failed. */
export const patrolResultLine = (floor: FloorId, result: PatrolResult): string =>
  isFailed(result) ? fill('semester.patrol.failed', { floor: floorName(floor) }) : fill('semester.patrol.rated', { floor: floorName(floor), grade: result.grade });

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
  for (const p of rec.patrols) {
    const key = `semester.sum.${p.overtime ? 'overtime' : 'patrol'}${p.failed ? '.failed' : ''}`;
    lines.push(fill(key, { floor: floorName(p.floor), grade: p.grade }));
  }
  if (rec.card !== undefined) lines.push(fill('semester.sum.card', { name: str(`welfare.${rec.card}.name`) }));
  if (rec.minutes !== undefined) lines.push(fill('semester.sum.minutes', { p: oneDecimal(rec.minutes) }));
  lines.push(fill('semester.sum.debt', { debt: oneDecimal(amount(after.tags, ctx.dict, 'sleep_debt')) }));
  // Only the hours nothing else (class, meal, a course) already held are the card's to count.
  const taken = settingHours(ctx.setting, before.day).filter((h) => h < k.bedMin && fixedHour(k, ctx.courses, before.day, rec.wake, rec.kind === 'exam', h) === undefined);
  if (ctx.setting !== undefined && taken.length > 0 && rec.kind !== 'hospital') lines.push(fill('semester.sum.setting', { name: str(`semester.setting.name.${ctx.setting.id}`), hours: taken.length }));
  for (const h of rec.homework) {
    if (h.wrote > 0) lines.push(fill('semester.sum.hw.wrote', { n: h.n, hours: h.wrote }));
    if (h.debugged > 0) lines.push(fill('semester.sum.hw.debugged', { n: h.n, hours: h.debugged }));
    if (h.done) lines.push(fill('semester.sum.hw.done', { n: h.n, p: HOMEWORK_PROGRESS }));
    if (h.missed) lines.push(fill('semester.sum.hw.missed', { n: h.n }));
  }
  if (rec.project !== undefined) {
    lines.push(fill('semester.sum.project', { hours: rec.project.hours, done: oneDecimal(after.project), need: PROJECT_NEED }));
    if (rec.project.done) lines.push(str('semester.sum.project.done'));
  }
  if (rec.grade !== undefined) {
    lines.push(fill('semester.sum.grade', { hours: rec.grade.hours, done: after.graded, need: GRADE_HOURS }));
    if (rec.grade.done) lines.push(str('semester.sum.grade.done'));
  }
  if (rec.rank !== undefined) lines.push(fill('semester.sum.rank', { hours: rec.rank.hours, gain: oneDecimal(rec.rank.gain), score: oneDecimal(after.rank) }));
  if (rec.archive !== undefined) {
    const { staged, archived, rate } = rec.archive;
    lines.push(fill('semester.sum.archive', { staged: oneDecimal(staged), archived: oneDecimal(archived), rate: percent(rate * 100) }));
    if (rate < 1) lines.push(str('semester.sum.archive.half'));
  }
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

/**
 * The semester's result once it has ended: the two exams, the grade, and how the semester went. `opened` is the clause level
 * the clear just unlocked, which only the progress knows.
 */
export function endSummary(state: SemesterState, ctx: SemesterContext, opened?: number): string[] {
  if (!state.ended) throw new RangeError('the semester has not ended');
  const sum = summarize(state, ctx);
  const passed = sum.passMid && sum.passFin;
  const hospitalFinal = state.history.at(-1)?.kind === 'hospital';
  const projectDone = state.project >= PROJECT_NEED;
  const level = ctx.clause ?? 0;
  const lines = [
    ...(level > 0 ? [fill('semester.end.clause', { level, name: clauseName(level) })] : []),
    fill('semester.end.exams', { mid: percent(sum.mid), fin: percent(sum.fin) }),
    fill('semester.end.grade', { grade: percent(sum.grade) }),
    str(passed ? 'semester.end.pass' : 'semester.end.fail'),
    ...(opened === undefined ? [] : [fill('semester.end.clause.unlock', { next: opened, name: clauseName(opened) })]),
  ];
  // A bankrupt semester and a final spent in hospital score 0 whole, board and project penalty included, so those lines would only mislead.
  if (takes(ctx.courses, 'algorithms') && !sum.bankrupt && !hospitalFinal) lines.push(fill('semester.end.rank', { score: oneDecimal(state.rank), full: RANK_FULL, share: percent(RANK_SHARE * 100) }));
  if (sum.bankrupt) lines.push(str('semester.end.bankrupt'));
  else if (sum.hospitalized) lines.push(str('semester.end.hospital'));
  lines.push(fill('semester.end.debt', { debt: oneDecimal(sum.finalDebt) }));
  // The review points of a finished project are only paid into a passed semester's review below.
  if (takes(ctx.courses, 'compiler') && !sum.bankrupt) {
    if (projectDone && passed) lines.push(fill('semester.end.project.done', { points: PROJECT_REVIEW }));
    else if (!projectDone && !hospitalFinal) lines.push(fill('semester.end.project.fail', { points: PROJECT_FIN_PENALTY }));
  }
  // Late grades cost nothing but the line in the review (design doc 8.3), so the line only has a meaning to a semester that was not lost to bankruptcy.
  if (takes(ctx.courses, 'ta') && !sum.bankrupt) {
    if (state.graded >= GRADE_HOURS) lines.push(str('semester.end.grade.done'));
    else lines.push(fill('semester.end.grade.late', { due: gradeDays(ctx.params).to }));
  }
  const missed = state.homework.filter((a) => a.missed).length;
  if (missed > 0 && !sum.bankrupt && !hospitalFinal) lines.push(fill('semester.end.homework.missed', { missed, points: missed * HOMEWORK_MISS_PENALTY }));
  if (ctx.courses !== undefined && passed) {
    const credits = creditsOf(ctx.courses);
    const burden = burdenOf(credits);
    const bonus = takes(ctx.courses, 'compiler') && projectDone ? PROJECT_REVIEW : 0;
    lines.push(fill('semester.end.review', { points: percent(reviewPoints(sum.grade, credits, bonus)), burden: str(`semester.burden.${burden}`), reward: BURDEN_REWARD[burden].toFixed(2) }));
  }
  return lines;
}
