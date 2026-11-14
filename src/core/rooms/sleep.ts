/**
 * The sleep bar of a bed that takes time to sleep in (design doc 7.5). Lying down on a sleep bed
 * with `sleepSeconds` above 0 starts the bar; it fills while the operator sleeps and the chapter
 * ends once it is full. Something can wake the operator (半夜醒來): the bar then stops where it is
 * until the operator lies down on such a bed again. It never empties, since the evidence only
 * supports waking up, not lying awake (design doc 7.5).
 *
 * Two things wake the operator for now: the stomach's mixer, which sounds its alarm after every
 * `ALARM_SECONDS` of the sleep during which it was digesting, and a hit. The liver's third puzzle
 * (7.7) will wake it by a rule of its own. The stomach boss's third stage has a bar of its own, kept
 * on him (core/combat/bosses/snack.ts), since the operator fights through it instead of lying in bed. The state
 * is the room's, like the mixer's: a door, a forced leave or a return to a checkpoint drops it, so
 * the bar starts over on the next try.
 */
import { TICK_HZ } from '../time.ts';

/** How long the mixer digests during a sleep before its alarm wakes the operator (design doc 7.5: every 20 seconds). */
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
  /** Ticks of this sleep the mixer has been digesting since the last alarm; it starts over once the mixer stops. */
  readonly alarm: number;
  /** Times woken so far. */
  readonly wakes: number;
}

export const WAKE_CAUSES = ['mixer', 'hurt'] as const;
export type WakeCause = (typeof WAKE_CAUSES)[number];

export type SleepEvent =
  | { readonly type: 'sleepInterrupted'; readonly object: number; readonly cause: WakeCause; readonly wakes: number }
  /** The bar filled, after `wakes` wakings: the chapter ends as a sleep bed without a bar would end it at once. */
  | { readonly type: 'sleepFilled'; readonly object: number; readonly wakes: number };

/**
 * Lying down on `bed`: a fresh bar, or the bar of this visit going on from where it stopped. A bar
 * already under way keeps its length, whatever another bed's `sleepSeconds` says.
 */
export function lieDown(sleep: SleepState | undefined, bed: number, seconds: number): SleepState {
  if (sleep) return { ...sleep, bed, awake: false, alarm: 0 };
  return { bed, slept: 0, need: Math.round(seconds * TICK_HZ), awake: false, alarm: 0, wakes: 0 };
}

export const asleep = (sleep: SleepState | undefined): boolean => sleep !== undefined && !sleep.awake && sleep.slept < sleep.need;

/**
 * One tick of sleep. `mixerBusy` is whether the room's mixer is digesting after this tick's mixer
 * step (a parcel waiting for room at the outlet is done, so it does not count); `hurt` whether
 * something landed on the operator this tick. A hit wins over everything on the same tick, the
 * filling of the bar included, so the bar stops one tick short and a lethal hit never ends the
 * chapter; a full bar wins over an alarm. The next lying down fills it.
 */
export function stepSleep(sleep: SleepState, mixerBusy: boolean, hurt: boolean): { sleep: SleepState; events: SleepEvent[] } {
  if (!asleep(sleep)) return { sleep, events: [] };
  if (sleep.slept + 1 >= sleep.need && !hurt) {
    return { sleep: { ...sleep, slept: sleep.need, alarm: 0 }, events: [{ type: 'sleepFilled', object: sleep.bed, wakes: sleep.wakes }] };
  }
  const slept = Math.min(sleep.slept + 1, sleep.need - 1);
  const alarm = mixerBusy ? sleep.alarm + 1 : 0;
  const cause: WakeCause | undefined = hurt ? 'hurt' : alarm >= ALARM_TICKS ? 'mixer' : undefined;
  if (cause === undefined) return { sleep: { ...sleep, slept, alarm }, events: [] };
  const wakes = sleep.wakes + 1;
  return { sleep: { ...sleep, slept, alarm: 0, awake: true, wakes }, events: [{ type: 'sleepInterrupted', object: sleep.bed, cause, wakes }] };
}
