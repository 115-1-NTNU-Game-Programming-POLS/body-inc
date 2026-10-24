/**
 * Outer-layer rule clock (hours and days), separate from the 60 Hz combat tick in time.ts.
 * Combat never advances it directly; a forced nap advancing one hour is a core rule.
 *
 * `minute` counts from day 1 00:00 and only grows, so it orders every causal log entry.
 * `day` is the logical day and changes only on waking: staying up until 01:00 is still the
 * night of the same day, and wake times differ (06:00 make-up class, 11:00 free morning).
 */
export interface RuleClock {
  readonly day: number;
  readonly minute: number;
}

export const MINUTES_PER_DAY = 24 * 60;

export class ClockError extends Error {}

export function startClock(day: number, hour: number, minute = 0): RuleClock {
  if (!Number.isInteger(day) || day < 1) throw new ClockError(`day must be a positive integer, got ${day}`);
  const m = (day - 1) * MINUTES_PER_DAY + hour * 60 + minute;
  if (!Number.isInteger(m) || hour < 0 || hour >= 24 || minute < 0 || minute >= 60) {
    throw new ClockError(`invalid time ${hour}:${minute}`);
  }
  return { day, minute: m };
}

export function advance(clock: RuleClock, minutes: number): RuleClock {
  if (!Number.isInteger(minutes) || minutes < 0) throw new ClockError(`can only advance by whole non-negative minutes, got ${minutes}`);
  return { day: clock.day, minute: clock.minute + minutes };
}

/** Hour of the wall clock, 0 to 23. */
export const hourOf = (clock: RuleClock): number => Math.floor((clock.minute % MINUTES_PER_DAY) / 60);

/** Sleeps until the next occurrence of wakeHour:00 and starts the next logical day. */
export function sleepUntil(clock: RuleClock, wakeHour: number): RuleClock {
  const target = wakeHour * 60;
  const now = clock.minute % MINUTES_PER_DAY;
  const wait = (target - now + MINUTES_PER_DAY) % MINUTES_PER_DAY || MINUTES_PER_DAY;
  return { day: clock.day + 1, minute: clock.minute + wait };
}
