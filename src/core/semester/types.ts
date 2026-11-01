import type { ParamsFile } from '../content/generated.ts';
import type { MetabolismParams } from '../outer/caffeine.ts';
import type { RngStreams } from '../rng.ts';
import type { SleepCoefficients } from '../spirit.ts';
import type { TagDictionary } from '../tags/dictionary.ts';
import type { TagState } from '../tags/store.ts';
import type { ElevatorPanel, FloorId, Light, Loads } from './floors.ts';
import type { LiverClues } from './liver.ts';
import type { Grade, LoadParams } from './load.ts';
import type { SkillParams } from './rating.ts';

/** The rules of content/params.json that a semester reads; the file's `defaults` satisfies it. */
export type SemesterParams = SleepCoefficients & MetabolismParams & LoadParams & SkillParams & Pick<
  ParamsFile['defaults'],
  | 'days' | 'midDay' | 'finDay' | 'weekend' | 'examHours' | 'examWake' | 'wake' | 'bed' | 'bedMin' | 'bedMax' | 'bedOverrun' | 'wakeCap'
  | 'meals' | 'classes' | 'sleepNeed' | 'repayRatio' | 'cup' | 'boostMin' | 'boost' | 'boostTolerant' | 'cafSleepK' | 'cafDeadZone'
  | 'tolDays' | 'tolCups' | 'tolResetDays' | 'withdrawal' | 'alcoholSleep' | 'snackSleep' | 'passMid' | 'passFin'
  | 'hospitalDebtMult' | 'hospitalFloorLoad' | 'hospitalSleep' | 'floorStrikeStudyMult' | 'overtimeBedDelay' | 'examPassPercent'
>;

/** What one option of an event does to the day; only the fields it names. */
export interface EventOption {
  /** Cups of alcohol; any cup also pins a work order on the liver. */
  readonly alcohol?: number;
  readonly fasting?: boolean;
  readonly deadline?: boolean;
  readonly lateSnack?: boolean;
  /** Free hours of the day the event eats. */
  readonly workHours?: number;
  readonly bedDelay?: number;
}

export interface SemesterEvent {
  readonly id: string;
  /** The hour of the day the event comes up; one that comes up after the player is in bed is missed. */
  readonly hour: number;
  readonly options: Readonly<Record<string, EventOption>>;
}

/** Event ids per day. */
export type Scenario = Readonly<Record<number, readonly string[]>>;

export interface SemesterContext {
  readonly dict: TagDictionary;
  readonly params: SemesterParams;
  readonly events: ReadonlyMap<string, SemesterEvent>;
  readonly scenario: Scenario;
  /** The abstract combat skill k of design doc 9.5, 0 to 1. */
  readonly skill: number;
  /** Final-exam threshold multiplier of the difficulty ladder; 1 at level 0. */
  readonly finMult?: number;
  /** Sleep debt at the start of the semester; 0 at level 0. */
  readonly startDebt?: number;
  /**
   * The course cards the player took (design doc 8.3). Their credits move the exam thresholds and
   * some take fixed hours. Absent, the semester is the 12-credit one the thresholds are tuned for.
   */
  readonly courses?: readonly string[];
}

/** One assignment of the operating-systems card, as the state keeps it. `debug` is drawn at the start and stays hidden until the writing is done. */
export interface Assignment {
  readonly announce: number;
  readonly due: number;
  readonly written: number;
  readonly debug: number;
  readonly debugged: number;
  readonly done: boolean;
  readonly missed: boolean;
}

/** What the player may know of an assignment that can be worked on today; `debug` appears once the writing is done. */
export interface HomeworkView {
  readonly n: number;
  readonly due: number;
  readonly written: number;
  readonly debug?: number;
  readonly debugged: number;
}

export interface PatrolRecord {
  readonly floor: FloorId;
  readonly grade: Grade;
  readonly overtime: boolean;
}

export interface DayRecord {
  readonly day: number;
  /** Hour the day began; the report draws its narrative days from it (a night before this hour belongs to the day before). */
  readonly wake: number;
  /** Hour sleep began on the extended clock; absent on the final exam day, which has no night. */
  readonly bedEnd?: number;
  /** The emergency-room entry of the causal log, when the night ended there; `fasting` marks the liver strike on an empty stomach. */
  readonly crisis?: { readonly node: number; readonly at: number; readonly fasting: boolean };
  readonly kind: 'normal' | 'exam' | 'hospital';
  /** False on the final exam day, which ends before any night settlement. */
  readonly settled: boolean;
  /** Lights as the elevator showed them that morning. */
  readonly lights: Readonly<Record<FloorId, Light>>;
  readonly lit: readonly FloorId[];
  readonly liverNote: boolean;
  readonly routine?: FloorId;
  readonly patrols: readonly PatrolRecord[];
  readonly events: readonly { readonly id: string; readonly option: string }[];
  /** Hours spent studying, late night included. */
  readonly studyHours: number;
  /** Loads at the start and the end of the day. The player never sees them. */
  readonly loadsBefore: Loads;
  readonly loadsAfter: Loads;
  /** Loads as the night settlement computed them, before a hospital stay brought them down; strikes are judged on these. */
  readonly loadsSettled: Loads;
  /** Floors on strike after the night settlement. */
  readonly strikes: readonly FloorId[];
  /** Why the liver struck, when it did: the second and third condition of design doc 8.6. */
  readonly liverStrike?: { readonly alcoholAtBed: boolean; readonly dupMedication: boolean; readonly orderBefore: boolean };
  readonly hospitalized: boolean;
  /** What the day did to each assignment it touched: hours written and debugged, and whether it was handed in or came due unfinished. */
  readonly homework: readonly HomeworkDay[];
  /** What the night's sleep did to the staging pile; absent when the pile was empty. */
  readonly archive?: ArchiveDay;
  /** The leaderboard hours the night spent and the score they added; absent when none were spent. */
  readonly rank?: { readonly hours: number; readonly gain: number };
  /** The hours the day gave the compiler project and what they added; absent when none were spent. */
  readonly project?: { readonly hours: number; readonly gain: number; readonly done: boolean };
}

export interface ArchiveDay {
  /** The pile before sleep. */
  readonly staged: number;
  /** Share of it the sleep archived, from 0 to 1. */
  readonly rate: number;
  /** Progress it became. */
  readonly archived: number;
}

export interface HomeworkDay {
  readonly n: number;
  readonly wrote: number;
  readonly debugged: number;
  readonly done: boolean;
  readonly missed: boolean;
}

export interface SemesterState {
  readonly day: number;
  readonly wake: number;
  readonly tags: TagState;
  /** Practice and archived study, which an exam counts. */
  readonly progress: number;
  /** Paper-exam study done and not yet archived by sleep (design doc 8.3); an exam does not count it. */
  readonly staging: number;
  /** The algorithms card's leaderboard score (design doc 8.3); stays 0 when the card is not taken. */
  readonly rank: number;
  /** The compiler project's progress in study-efficiency hours (design doc 8.3); stays 0 when the card is not taken. */
  readonly project: number;
  readonly loads: Loads;
  /**
   * Causal log entries behind each floor's load since it was last calm (under the yellow line).
   * A load is a running sum over days, so a strike has to cite the nights that built it, not only
   * the night it crossed the line.
   */
  readonly loadCauses: Readonly<Record<FloorId, readonly number[]>>;
  /** Cups per finished day, for the tolerance rule. */
  readonly cupsHist: readonly number[];
  readonly zeroCupDays: number;
  /** The day of each work order, one per liver-loading event (design doc 8.6), so a day with two drinks appears twice. */
  readonly liverOrders: readonly number[];
  readonly hospitals: number;
  /** The assignments of the courses taken, in order; empty when the operating-systems card is not. */
  readonly homework: readonly Assignment[];
  readonly hospitalDay?: number;
  readonly bankrupt: boolean;
  readonly mid?: number;
  readonly fin?: number;
  readonly rng: RngStreams;
  readonly history: readonly DayRecord[];
  readonly ended: boolean;
}

/** The player's morning plan (design doc 8.2): coffee hours and the free hours spent resting. */
export interface MorningPlan {
  readonly coffee: readonly number[];
  readonly rest: readonly number[];
  /** Whole hours of the day's free time spent writing the assignment that can be worked on; absent is none. */
  readonly write?: number;
  /** Whole hours of the day's free time given to the compiler project; absent is none. */
  readonly project?: number;
  /** Take a 15-minute walk before the hour that would be the fourth in a row at the desk. */
  readonly walk?: boolean;
}

export interface FloorChoice {
  readonly patrol: FloorId;
  /** An overtime patrol of a second floor, at the price of a later bedtime (design doc 8.4). */
  readonly overtime?: FloorId;
}

export interface NightPlan {
  /** Planned bedtime on the extended clock (25 is 01:00), to the half hour. */
  readonly bed: number;
  /** Whole hour of the next morning; an exam morning caps it at examWake. */
  readonly nextWake: number;
  /** What the hours between 22:00 and bedtime go to. */
  readonly lateNight: 'study' | 'rest';
  /** Whole hours of debugging after the planned bedtime, which push bedtime back; absent is none. */
  readonly debug?: number;
  /** Whole hours of the leaderboard contest after the planned bedtime, on the nights it is open; absent is none. */
  readonly rank?: number;
}

/**
 * Everything a player can see when deciding. It holds lights and clues, never a floor load, so a
 * strategy written against it plays the same game as a person at the elevator.
 */
export interface DayView {
  readonly day: number;
  readonly wake: number;
  readonly weekend: boolean;
  readonly exam: 'mid' | 'fin' | null;
  readonly examTomorrow: boolean;
  readonly sleepDebt: number;
  readonly S: number;
  readonly caffeine: number;
  readonly progress: number;
  /** Study waiting for sleep to archive it. */
  readonly staging: number;
  /** Hours bedtime is already pushed back tonight (an overtime patrol, an event), which `nightRoom` takes off what the night can still give. */
  readonly bedDelay: number;
  readonly hospitals: number;
  readonly panel: ElevatorPanel;
  readonly liverClues: LiverClues;
  /** Dictionary modifiers that hold now (design doc 8.7). */
  readonly modifiers: readonly string[];
  /** The assignments that can be worked on today. */
  readonly homework: readonly HomeworkView[];
  /** The leaderboard of the algorithms card: the score so far, and whether tonight is a contest night; absent without the card. */
  readonly rank?: { readonly score: number; readonly open: boolean };
  /** The compiler card's final project: progress so far, what it needs, and whether it can take hours today; absent without the card. */
  readonly project?: { readonly done: number; readonly need: number; readonly open: boolean };
}

export interface Strategy {
  plan(view: DayView): MorningPlan;
  choose(eventId: string, options: readonly string[], view: DayView): string;
  floor(view: DayView): FloorChoice;
  night(view: DayView): NightPlan;
}

export interface SemesterSummary {
  readonly mid: number;
  readonly fin: number;
  readonly grade: number;
  readonly passMid: boolean;
  readonly passFin: boolean;
  readonly hospitalized: boolean;
  readonly bankrupt: boolean;
  readonly finalDebt: number;
}
