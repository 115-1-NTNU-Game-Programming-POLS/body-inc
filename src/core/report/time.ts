import { MINUTES_PER_DAY } from '../clock.ts';

const DIGITS = '零一二三四五六七八九';
const ORDINALS = '一二三四五六七八九十';

/**
 * A count in Chinese numerals, 2 written 兩 (ux-spec 4.6: 連續三晚, 共兩杯). Counts of 100 and more,
 * which a ten-day semester never reaches, fall back to digits.
 */
export function zhCount(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`a count is a whole number from 0, got ${n}`);
  if (n === 2) return '兩';
  if (n < 10) return DIGITS[n]!;
  if (n < 20) return `十${n === 10 ? '' : DIGITS[n - 10]}`;
  if (n < 100) return `${DIGITS[Math.floor(n / 10)]}十${n % 10 === 0 ? '' : DIGITS[n % 10]}`;
  return String(n);
}

/** 一 to 十, for the numbered sentences of a report; 2 stays 二 here. */
export function ordinal(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 10) throw new RangeError(`ordinal is 1 to 10, got ${n}`);
  return ORDINALS[n - 1]!;
}

/**
 * The narrative day of a moment: the days run from waking to waking, so a night before the next
 * wake-up still belongs to the day that went to bed (ux-spec 4.6, "第 3 天深夜"). `wakes[d - 1]` is
 * the wake hour of day d; a moment before the first wake-up is on day 1.
 */
export function narrativeDay(at: number, wakes: readonly number[]): number {
  for (let d = wakes.length; d >= 1; d--) {
    if ((d - 1) * MINUTES_PER_DAY + Math.round(wakes[d - 1]! * 60) <= at) return d;
  }
  return 1;
}

/** Minutes into the narrative day; 1440 and more is after midnight. */
export const minuteOfDay = (at: number, day: number): number => at - (day - 1) * MINUTES_PER_DAY;

export type Period = 'morning' | 'noon' | 'afternoon' | 'evening' | 'night';

/** ux-spec 4.6: 05:00-10:59 morning, 11:00-13:59 noon, 14:00-17:59 afternoon, 18:00-22:59 evening, 23:00 to waking night. */
export function periodOf(minute: number): Period {
  const h = minute / 60;
  if (h >= 23) return 'night';
  if (h >= 18) return 'evening';
  if (h >= 14) return 'afternoon';
  if (h >= 11) return 'noon';
  return 'morning';
}

export const PERIOD_WORD: Readonly<Record<Period, string>> = {
  morning: '上午', noon: '中午', afternoon: '下午', evening: '晚間', night: '深夜',
};

/** The clock hour 0 to 23 of a moment, whole hours. */
export const clockHour = (minute: number): number => Math.floor(minute / 60) % 24;

/** "第 6 天", or "第 6 至 7 天" for a range; dates are always digits. */
export const dayRange = (first: number, last: number): string => (first === last ? `第 ${first} 天` : `第 ${first} 至 ${last} 天`);

export const hhmm = (minute: number): string => {
  const h = clockHour(minute);
  const m = Math.floor(minute % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
