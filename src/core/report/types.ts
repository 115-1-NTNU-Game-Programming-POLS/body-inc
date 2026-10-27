import type { ReportFile } from '../content/generated.ts';

/** How much a sentence is worth when a report has more of them than fit (docs/specs/ux-spec.md 4.6). */
export type ScoreClass = ReportFile['keys'][string]['score'];

export const SCORES: Readonly<Record<ScoreClass, number>> = { choice: 5, warning: 4, tag: 3, external: 2, effect: 1 };

/** The incident part of a report holds at most this many sentences (ux-spec 4.3). */
export const MAX_INCIDENT = 5;

/** The scope that stands for the company as a whole, for a fact that is about no department. */
export const COMPANY = 'company';

export type ReportVars = Readonly<Record<string, string | number>>;

/** One thing that happened before the crisis, before it is worded. */
export interface ReportFact {
  /** Bank key of its sentence; one with no entry in the bank is worded by the fallback. */
  readonly key: string;
  /** Tells apart facts of one key that concern different parts (a floor); each scope merges on its own. */
  readonly scope?: string;
  /** Rule minute. */
  readonly at: number;
  readonly vars?: ReportVars;
  /** A direct parent of the crisis: it is always reported (ux-spec 4.6). */
  readonly parent?: boolean;
}

/** A fact placed on the narrative calendar. */
export interface PlacedFact {
  readonly fact: ReportFact;
  readonly day: number;
  /** Minutes into the narrative day; 1440 and more is after midnight, before waking. */
  readonly minute: number;
}

export type SentenceForm = 'single' | 'run' | 'spread';

/** The facts of one key and scope, merged into one sentence (ux-spec 4.6). */
export interface SentenceGroup {
  readonly key: string;
  readonly scope?: string;
  readonly form: SentenceForm;
  readonly members: readonly PlacedFact[];
  /** Distinct narrative days, ascending. */
  readonly days: readonly number[];
  readonly firstDay: number;
  readonly lastDay: number;
  /** Rule minute of the earliest member; the group sorts by it. */
  readonly at: number;
  readonly parent: boolean;
}

export interface IncidentLine {
  readonly key: string;
  readonly scope?: string;
  readonly form: SentenceForm;
  readonly text: string;
  readonly firstDay: number;
  readonly lastDay: number;
  readonly at: number;
  /** Worded by the fallback sentence for want of a template. */
  readonly generic: boolean;
}

export type StringLookup = (stringKey: string) => string;

/** What the engine needs to write one report; the producer of a mode builds it from its causal log. */
export interface ReportInput {
  readonly kind: 'notice' | 'bankruptcy';
  /** The run's seed; it picks among the variants of a sentence. */
  readonly seed: number;
  /** Wake hour of each day, from day 1: a night before it belongs to the day before. */
  readonly wakes: readonly number[];
  /** Rule minute of the crisis; nothing later is reported. */
  readonly at: number;
  readonly facts: readonly ReportFact[];
  /** Scopes (floors) on strike that night. */
  readonly struck: readonly string[];
  /** The liver struck while the stomach was empty: the dizzy crisis of design doc 8.6. */
  readonly fasting: boolean;
  /** Notice only: the day spent in hospital, when the notice is dated, and what the stay cost. */
  readonly hospital?: {
    readonly day: number;
    readonly issueDay: number;
    /** Wake hour of the issue day. */
    readonly wake: number;
    readonly cap: number;
    readonly debtPercent: number;
    readonly missedExam?: 'mid' | 'fin';
  };
  /** Bankruptcy only: the case this one follows. */
  readonly previous?: { readonly at: number; readonly struck: readonly string[]; readonly fasting: boolean };
  /** Handbook pages the player already holds. */
  readonly known: ReadonlySet<string>;
}

export interface ReportDocument {
  readonly kind: 'notice' | 'bankruptcy';
  /** The digits of the case number: two for the day of the emergency room, two for the hour, as in 人體急字第 0222 號. */
  readonly number: string;
  readonly lines: readonly string[];
  readonly incident: readonly IncidentLine[];
  /** Handbook page this report unlocks. */
  readonly unlock: string;
  readonly theme: string;
  /** Sentences of the incident worded by the fallback; the batch check wants none. */
  readonly generic: number;
  /** The scopes on strike, as the report names them. */
  readonly struck: readonly string[];
}
