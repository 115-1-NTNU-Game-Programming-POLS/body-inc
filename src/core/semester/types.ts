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
  /** The emergency-room entry of the causal log, when the night ended there. */
  readonly crisis?: { readonly node: number; readonly at: number };
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
}

export interface SemesterState {
  readonly day: number;
  readonly wake: number;
  readonly tags: TagState;
  readonly progress: number;
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
  /** Days on which a liver-loading event pinned a work order. */
  readonly liverOrders: readonly number[];
  readonly hospitals: number;
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
  readonly hospitals: number;
  readonly panel: ElevatorPanel;
  readonly liverClues: LiverClues;
  /** Dictionary modifiers that hold now (design doc 8.7). */
  readonly modifiers: readonly string[];
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
