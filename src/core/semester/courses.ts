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

/** Exam thresholds are tuned for 12 credits; each credit above or below moves them by 8% of that. */
export const thresholdMult = (credits: number): number => 1 + THRESHOLD_PER_CREDIT * (credits - BASE_CREDITS);

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

export function committedHours(courses: readonly string[], day: number): ReadonlySet<number> {
  const hours = new Set<number>();
  for (const id of courses) for (const c of COMMITMENTS[id] ?? []) if (c.day === day) c.hours.forEach((h) => hours.add(h));
  return hours;
}

/** Whether a course takes hour `h` of `day`; the day's loop asks every hour, so this allocates nothing. */
export const isCommitted = (courses: readonly string[], day: number, h: number): boolean =>
  courses.some((id) => (COMMITMENTS[id] ?? []).some((c) => c.day === day && c.hours.includes(h)));

/** A passed semester's review: the grade times the reward of its burden. */
export const reviewPoints = (grade: number, credits: number): number => grade * BURDEN_REWARD[burdenOf(credits)];
