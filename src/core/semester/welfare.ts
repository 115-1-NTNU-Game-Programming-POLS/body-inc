import { BASE_PERKS, type Perks } from '../combat/perks.ts';
import { seedStreams, drawInt } from '../rng.ts';
import { takes } from './courses.ts';
import type { FloorId } from './floors.ts';
import { GRADES, type Grade } from './load.ts';

/**
 * The welfare cards of design doc 8.8 that the rooms and the semester can carry out. A card is given by a patrol and kept to the end of
 * the run; none of them undoes a cost of the health education (a hard rule of the doc). The ones not listed have no mechanic to act on
 * yet, see "福利卡的實作狀態" in docs/design-doc.md.
 */
export interface WelfareCard {
  readonly id: string;
  /** The department that gives it: a floor's patrol offers its own cards and the general affairs office's. */
  readonly source: FloorId | 'general';
  /** The course card it needs, when it is about one. */
  readonly course?: string;
  /** What it changes in a fight. */
  readonly perks?: Partial<Perks>;
}

export const WELFARE_CARDS: readonly WelfareCard[] = [
  { id: 'early_sleep', source: 'brain' },
  { id: 'minutes', source: 'brain' },
  { id: 'early_start', source: 'brain', course: 'os' },
  { id: 'know_when_to_stop', source: 'brain', course: 'algorithms' },
  { id: 'quick_bind', source: 'general', perks: { bindHits: 2 } },
  { id: 'bind_master', source: 'general', perks: { bindSplash: 1 } },
  { id: 'recycle', source: 'general', perks: { parryBind: 2 } },
  { id: 'fast_return', source: 'general', perks: { parryBoost: true } },
];

/** The cards offered for a rating (design doc 8.8): one for C, two for B, three for A and S. */
export const OFFER_SIZE: Readonly<Record<Grade, number>> = { C: 1, B: 2, A: 3, S: 3 };

/** The effective sleep that earns 早睡獎金, and the gauge it starts the patrol with. */
export const EARLY_SLEEP_HOURS = 7.5;
export const EARLY_SLEEP_GAUGE = 50;
/** 知所進退: a contest night over by this hour on the extended clock, and the gauge the next patrol starts with. */
export const STOP_BY = 24;
export const STOP_GAUGE = 30;
/** 提早開工: the writing of an assignment must begin this many days before it falls due. */
export const EARLY_START_DAYS = 2;
/** 會議紀錄: perfect dodges that make one minute, and the progress a minute is worth. */
export const RECORDS_PER_MINUTE = 3;
export const MINUTE_PROGRESS = 0.5;

/** What the night before is worth to a patrol: the sleep it gave and whether the contest was left in time. */
export interface LastNight {
  readonly slept: number;
  readonly stopped: boolean;
}

/** What a patrol starts with: the gauge the cards give, and how they change the fight. */
export interface PatrolKit {
  readonly gauge: number;
  readonly perks: Perks;
}

export function perksOf(held: readonly string[]): Perks {
  let perks = BASE_PERKS;
  for (const card of WELFARE_CARDS) if (held.includes(card.id) && card.perks) perks = { ...perks, ...card.perks };
  return perks;
}

export function patrolKit(held: readonly string[], last: LastNight | undefined): PatrolKit {
  const early = held.includes('early_sleep') && last !== undefined && last.slept >= EARLY_SLEEP_HOURS ? EARLY_SLEEP_GAUGE : 0;
  const stop = held.includes('know_when_to_stop') && last?.stopped === true ? STOP_GAUGE : 0;
  return { gauge: Math.max(early, stop), perks: perksOf(held) };
}

/** Progress the minutes of a played patrol add, with 會議紀錄 held: one per three perfect dodges. */
export const minutesProgress = (held: readonly string[], records: number): number =>
  held.includes('minutes') ? Math.floor(records / RECORDS_PER_MINUTE) * MINUTE_PROGRESS : 0;

export interface OfferRequest {
  /** Fixed for the run (the semester's setting stream), so the same day offers the same cards on every replay. */
  readonly salt: number;
  readonly day: number;
  readonly floor: FloorId;
  readonly grade: Grade;
  readonly held: readonly string[];
  readonly courses: readonly string[] | undefined;
}

/** The cards a played patrol offers, in the order they are shown: the pool of its floor, not yet held, drawn without a repeat. */
export function welfareOffer(r: OfferRequest): readonly string[] {
  if (!GRADES.includes(r.grade)) throw new RangeError(`"${String(r.grade)}" is not a rating`);
  const pool = WELFARE_CARDS
    .filter((c) => (c.source === 'general' || c.source === r.floor) && !r.held.includes(c.id) && (c.course === undefined || takes(r.courses, c.course)))
    .map((c) => c.id);
  let streams = seedStreams(Math.imul(r.salt ^ 0x9e3779b9, 31) + r.day);
  const out: string[] = [];
  for (let i = 0; i < OFFER_SIZE[r.grade] && pool.length > 0; i++) {
    let j: number;
    [j, streams] = drawInt(streams, 'setting', pool.length);
    out.push(pool.splice(j, 1)[0]!);
  }
  return out;
}
