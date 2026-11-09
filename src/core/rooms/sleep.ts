/**
 * The sleep bar of a bed that takes time to sleep in (design doc 7.5, and the liver's third
 * puzzle in 7.7). Lying down on a sleep bed with `sleepSeconds` above 0 starts the bar; it fills
 * while the operator sleeps and the chapter ends once it is full. Something can wake the operator
 * (半夜醒來): the bar then stops where it is until the operator lies down on a sleep bed again. It
 * never empties, since the evidence only supports waking up, not lying awake (design doc 7.5).
 *
 * Two things wake the operator: the stomach's mixer, which sounds its alarm after every
 * `ALARM_SECONDS` of the sleep during which it held food, and a hit. The state is the room's,
 * like the mixer's: a door or a forced leave drops it, so the bar starts over on the next try.
 */
import { TICK_HZ } from '../time.ts';

/** How long the mixer runs during a sleep before its alarm wakes the operator (design doc 7.5: every 20 seconds). */
export const ALARM_SECONDS = 20;
export const ALARM_TICKS = ALARM_SECONDS * TICK_HZ;

export interface SleepState {
  /** The bed lain down on last. */
  readonly bed: number;
  /** Ticks slept so far, up to `need`. */
  readonly slept: number;
  readonly need: number;
  /** Woken and not yet lying down again: the bar stands still and the operator moves freely. */
  readonly awake: boolean;
  /** Ticks of this sleep the mixer has held food since the last alarm; it starts over once the mixer is empty. */
  readonly alarm: number;
  /** Times woken so far. */
  readonly wakes: number;
}

export const WAKE_CAUSES = ['mixer', 'hurt'] as const;
export type WakeCause = (typeof WAKE_CAUSES)[number];

export type SleepEvent =
  | { readonly type: 'sleepInterrupted'; readonly object: number; readonly cause: WakeCause; readonly wakes: number }
  /** The bar filled: the chapter ends as a sleep bed without a bar would end it at once. */
  | { readonly type: 'sleptThrough'; readonly object: number; readonly wakes: number };

/** Lying down on `bed`: a fresh bar, or the bar of this visit going on from where it stopped. */
export function lieDown(sleep: SleepState | undefined, bed: number, seconds: number): SleepState {
  if (sleep) return { ...sleep, bed, awake: false, alarm: 0 };
  return { bed, slept: 0, need: Math.round(seconds * TICK_HZ), awake: false, alarm: 0, wakes: 0 };
}

export const asleep = (sleep: SleepState | undefined): boolean => sleep !== undefined && !sleep.awake && sleep.slept < sleep.need;

/**
 * One tick of sleep. `mixerFull` is whether the room's mixer holds food after this tick's mixer
 * step; `hurt` whether the operator lost a heart this tick. A full bar wins over an alarm on the
 * same tick, and a hit over the alarm.
 */
export function stepSleep(sleep: SleepState, mixerFull: boolean, hurt: boolean): { sleep: SleepState; events: SleepEvent[] } {
  if (!asleep(sleep)) return { sleep, events: [] };
  const slept = sleep.slept + 1;
  if (slept >= sleep.need) {
    return { sleep: { ...sleep, slept: sleep.need, alarm: 0 }, events: [{ type: 'sleptThrough', object: sleep.bed, wakes: sleep.wakes }] };
  }
  const alarm = mixerFull ? sleep.alarm + 1 : 0;
  const cause: WakeCause | undefined = hurt ? 'hurt' : alarm >= ALARM_TICKS ? 'mixer' : undefined;
  if (cause === undefined) return { sleep: { ...sleep, slept, alarm }, events: [] };
  const wakes = sleep.wakes + 1;
  return { sleep: { ...sleep, slept, alarm: 0, awake: true, wakes }, events: [{ type: 'sleepInterrupted', object: sleep.bed, cause, wakes }] };
}
