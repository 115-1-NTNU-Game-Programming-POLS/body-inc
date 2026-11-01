/**
 * The course cards of design doc 8.3, as far as the semester rules use them: the credits that set
 * the exam thresholds and the burden of the semester, and the fixed hours a course takes. The
 * pressure shapes and the course events of the cards are not modelled yet.
 */
export interface Course {
  readonly id: string;
  readonly credits: number;
  /** A semester side line (0 credits, takes a slot, at most one of each). */
  readonly side: boolean;
  /** The presentation opens only the cards whose chain falls on the brain and the liver (design doc 14.1). */
  readonly open: boolean;
}

export const COURSES: readonly Course[] = [
  { id: 'algorithms', credits: 3, side: false, open: true },
  { id: 'os', credits: 3, side: false, open: true },
  { id: 'software', credits: 3, side: false, open: false },
  { id: 'networks', credits: 3, side: false, open: false },
  { id: 'database', credits: 3, side: false, open: true },
  { id: 'compiler', credits: 4, side: false, open: true },
  { id: 'capstone', credits: 3, side: false, open: false },
  { id: 'ta', credits: 0, side: true, open: true },
  { id: 'internship', credits: 0, side: true, open: false },
];

export const OPEN_COURSES: readonly Course[] = COURSES.filter((c) => c.open);

export const MIN_COURSES = 4;
export const MAX_COURSES = 6;
export const MIN_CREDITS = 9;
export const MAX_CREDITS = 22;
/** The credits the exam thresholds of content/params.json are tuned for. */
export const BASE_CREDITS = 12;
const THRESHOLD_PER_CREDIT = 0.08;
/**
 * ASSUME: above the base each credit costs half as much as below it. The re-simulation of design doc 9.6 found that at the
 * full 8% the responsive player at skill 0.5 fell under the 85% bound in 50 of the 315 selections, all but one of them
 * with the compiler card; the project's practice share (PROJECT_PRACTICE_SHARE) and this slope bring that to none.
 */
const THRESHOLD_PER_CREDIT_HEAVY = 0.04;

export type SelectionProblem = 'unknown' | 'duplicate' | 'few' | 'many' | 'low_credits' | 'high_credits';

const creditsIn = (table: readonly Course[], ids: readonly string[]): number =>
  ids.reduce((sum, id) => sum + (table.find((c) => c.id === id)?.credits ?? 0), 0);

export const creditsOf = (ids: readonly string[]): number => creditsIn(COURSES, ids);

/**
 * The first rule of design doc 8.3 the selection breaks, or undefined when it can start a semester.
 * Which cards are offered (`open`) is the picker's business, not a rule: a saved run must keep
 * replaying when a card is closed again. `table` is the card table; the nine cards cannot reach
 * the top credit limit, so a test passes a heavier one.
 */
export function selectionProblem(ids: readonly string[], table: readonly Course[] = COURSES): SelectionProblem | undefined {
  if (ids.some((id) => !table.some((c) => c.id === id))) return 'unknown';
  if (new Set(ids).size !== ids.length) return 'duplicate';
  if (ids.length < MIN_COURSES) return 'few';
  if (ids.length > MAX_COURSES) return 'many';
  const credits = creditsIn(table, ids);
  if (credits < MIN_CREDITS) return 'low_credits';
  if (credits > MAX_CREDITS) return 'high_credits';
  return undefined;
}

export type Burden = 'light' | 'standard' | 'heavy' | 'full';

export const burdenOf = (credits: number): Burden => (credits <= 12 ? 'light' : credits <= 15 ? 'standard' : credits <= 18 ? 'heavy' : 'full');

/** What a passed semester's review is multiplied by (design doc 8.3): the reward for carrying more. */
export const BURDEN_REWARD: Readonly<Record<Burden, number>> = { light: 1, standard: 1.15, heavy: 1.35, full: 1.6 };

/** Exam thresholds are tuned for 12 credits; each credit below moves them by 8% of that and each credit above by 4%. */
export const thresholdMult = (credits: number): number =>
  1 + (credits > BASE_CREDITS ? THRESHOLD_PER_CREDIT_HEAVY : THRESHOLD_PER_CREDIT) * (credits - BASE_CREDITS);

interface Commitment {
  readonly day: number;
  readonly hours: readonly number[];
}

/**
 * Hours a course takes on fixed days, which the day spends as work whatever the plan says. The TA's
 * office hours are the afternoon of days 2 and 8, 2 hours each (design doc 8.3), placed on the two
 * hours after class.
 */
const COMMITMENTS: Readonly<Record<string, readonly Commitment[]>> = {
  ta: [{ day: 2, hours: [16, 17] }, { day: 8, hours: [16, 17] }],
};

/** Whether the semester took the card `id`; a context without a course list (the old sims) takes none. */
export const takes = (courses: readonly string[] | undefined, id: string): boolean => courses?.includes(id) === true;

/** Whether a course takes hour `h` of `day`; the day's loop asks every hour, so this allocates nothing. */
export const isCommitted = (courses: readonly string[], day: number, h: number): boolean =>
  courses.some((id) => (COMMITMENTS[id] ?? []).some((c) => c.day === day && c.hours.includes(h)));

export type FixedHour = 'exam' | 'class' | 'meal' | 'work';

/** What hour `h` of a day is already spoken for by whatever the plan says, in the order the day takes them; undefined when the plan decides it. */
export function fixedHour(
  k: { readonly weekend: readonly number[]; readonly classes: readonly number[]; readonly meals: readonly number[]; readonly examHours: readonly number[] },
  courses: readonly string[] | undefined, day: number, wake: number, examDay: boolean, h: number,
): FixedHour | undefined {
  if (examDay && k.examHours.includes(h)) return 'exam';
  if (!k.weekend.includes(day) && k.classes.includes(h)) return 'class';
  if (h === wake || k.meals.slice(1).includes(h)) return 'meal';
  if (courses !== undefined && isCommitted(courses, day, h)) return 'work';
  return undefined;
}

/** The two system-programming assignments of the operating-systems card (design doc 8.3): announced on `announce`, handed in by the morning of `due`. */
export const OS_ASSIGNMENTS: readonly { readonly announce: number; readonly due: number }[] = [
  { announce: 2, due: 4 },
  { announce: 6, due: 9 },
];

/** Hours of writing, spent in the day, before the debugging the night holds. */
export const WRITE_HOURS = 3;
/** Debugging hours 1 to 6 in percent (design doc 8.3); the draw is made when the semester starts and shown when the writing is done. */
export const DEBUG_PERCENT: readonly number[] = [20, 25, 20, 15, 12, 8];
/** Study progress a handed-in assignment is worth. ASSUME: more than the hours it takes, or skipping it would be the better play; the re-simulation of design doc 9.6 sets it. */
export const HOMEWORK_PROGRESS = 8;
/**
 * Final exam percent each assignment not handed in costs. ASSUME: raising HOMEWORK_PROGRESS does not make handing in
 * worth it, because the exam curve already tops out for a player who studies, so skipping has to cost something.
 */
export const HOMEWORK_MISS_PENALTY = 4;
/** The most debugging hours a night offers, which keeps bedtime inside the extended clock. */
export const MAX_DEBUG_PER_NIGHT = 4;

/** The debugging hours a roll in [0, 1) draws. */
export function debugHoursFor(roll: number): number {
  let edge = 0;
  for (let h = 0; h < DEBUG_PERCENT.length; h++) {
    edge += DEBUG_PERCENT[h]! / 100;
    if (roll < edge) return h + 1;
  }
  return DEBUG_PERCENT.length;
}

/**
 * The share of a card's study hours that a paper exam asks for (design doc 8.3); the rest is
 * practice, which counts at once. Cards missing here have no exam form of their own.
 */
const PAPER_SHARE: Readonly<Record<string, number>> = { algorithms: 0.5, os: 1, networks: 1, database: 1, compiler: 0 };

/**
 * The share of the semester's study hours that waits in the staging pile for sleep to archive.
 * ASSUME: hours are spread over the cards with an exam by credits, since study is not yet chosen per card.
 */
export function paperShare(ids: readonly string[]): number {
  let paper = 0;
  let total = 0;
  for (const id of ids) {
    const share = PAPER_SHARE[id];
    if (share === undefined) continue;
    const credits = creditsOf([id]);
    paper += credits * share;
    total += credits;
  }
  return total === 0 ? 0 : paper / total;
}

/** Effective sleep that archives the whole staging pile (design doc 8.3). */
export const ARCHIVE_SLEEP = 7;
/** What is left of the part sleep did not archive by the next day. */
export const UNARCHIVED_KEPT = 0.5;

export const archiveRate = (effectiveSleep: number): number => Math.min(1, effectiveSleep / ARCHIVE_SLEEP);

/**
 * The whole hours a night can still push bedtime back from `bed`, given the `delay` already taken, before the extended clock
 * stops. Debugging and the contest both spend them, and the cards offer no more than this.
 */
export const nightRoom = (k: { readonly bedMax: number; readonly bedOverrun: number }, bed: number, delay: number): number =>
  Math.max(0, Math.floor(k.bedMax + k.bedOverrun - (bed + delay)));

/**
 * The compiler card's final project (design doc 8.3). The design fixes the deadline (day 9), the +10 year-end review points
 * for finishing and the -8 on the final exam percent otherwise; the rest is ASSUME until the re-simulation of design doc 9.6:
 * it opens on day 3, needs 10 units of study-efficiency hours, and a day can give it 4 hours.
 */
export const PROJECT_FROM_DAY = 3;
export const PROJECT_NEED = 10;
export const PROJECT_DAY_MAX = 4;
export const PROJECT_REVIEW = 10;
export const PROJECT_FIN_PENALTY = 8;
/**
 * The share of a project hour that also counts as study progress, like the other hands-on work of the compiler card (design
 * doc 8.3). ASSUME: without it the project's 12 hours came out of the final exam's study and the card failed the responsive
 * player at skill 0.2 whatever the threshold; the re-simulation of design doc 9.6 sets it.
 */
export const PROJECT_PRACTICE_SHARE = 0.5;

/**
 * The project hours a morning plan can count on: what is left of the day from `wake` to the evening after the fixed hours, the
 * `rest` hours and the `write` hours of the assignment, up to PROJECT_DAY_MAX. It cannot see the events of the day, which put
 * work in front of the project once they are chosen, so the hours played can still fall short of the ones planned.
 */
export function projectRoom(
  k: Parameters<typeof fixedHour>[0] & { readonly bedMin: number },
  courses: readonly string[] | undefined, day: number, wake: number, examDay: boolean, rest: readonly number[], write: number,
): number {
  let free = 0;
  for (let h = wake; h < k.bedMin; h++) if (fixedHour(k, courses, day, wake, examDay, h) === undefined && !rest.includes(h)) free++;
  return Math.max(0, Math.min(PROJECT_DAY_MAX, free - write));
}

/**
 * Sitting at the desk (design doc 8.3): from the hour after this many in a row, the stuck point of a compiler assignment
 * cuts the efficiency to 0.3. A walk of 15 minutes clears the count and the hour it falls in is worth three quarters.
 * ASSUME: the stuck point is met by any long sit while the card is taken, since study is not yet chosen per card.
 */
export const SIT_LIMIT = 3;
export const STUCK_MULT = 0.3;
export const WALK_EFFORT = 0.75;

/** Score that fills the board, the first hour's score at S = 1, how much each further hour of the same night keeps, and the most hours a night. */
export const RANK_FULL = 60;
export const RANK_FIRST = 10;
export const RANK_DECAY = 0.6;
export const MAX_RANK_HOURS = 4;
/** The share of the final exam percent the board is worth. */
export const RANK_SHARE = 0.3;

/** The score `hours` of one night add: 10, 6, 3.6, 2.16 times that day's S for the hours in turn. */
export function rankGain(hours: number, S: number): number {
  let gain = 0;
  for (let h = 0; h < hours; h++) gain += RANK_FIRST * S * RANK_DECAY ** h;
  return gain;
}

/** The board as a percent of full marks, which is what the final exam takes its share from. */
export const rankPercent = (score: number): number => 100 * Math.min(1, score / RANK_FULL);

/** A passed semester's review: the grade times the reward of its burden, plus a flat `bonus` such as the final project's. */
export const reviewPoints = (grade: number, credits: number, bonus = 0): number => grade * BURDEN_REWARD[burdenOf(credits)] + bonus;
