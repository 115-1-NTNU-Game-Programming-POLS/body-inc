import { MINUTES_PER_DAY } from '../clock.ts';
import { calculateSemesterGrade, scoreExam } from '../exam/scoring.ts';
import { caffeineOf, metabolise } from '../outer/caffeine.ts';
import { drawFloat, nextFloat, seedStreams } from '../rng.ts';
import { sleepFactor } from '../spirit.ts';
import { addCauses, record, type NodeData, type SourceNodeKind } from '../tags/causal.ts';
import type { TagDictionary } from '../tags/dictionary.ts';
import { addAmount, amount, EMPTY_TAGS, flag, holds, lowerAmount, onWake, setAmount, setFlag, type TagState } from '../tags/store.ts';
import { clauseProblem, MAX_CLAUSE, validClause } from './clauses.ts';
import { EMPTY_LOADS, elevatorPanel, FLOORS, lightOf, litFloors, mapFloors, type FloorId } from './floors.ts';
import {
  archiveRate, creditsOf, debugHoursFor, fixedHour, GRADE_HOURS, gradeDays, HOMEWORK_MISS_PENALTY, HOMEWORK_PROGRESS, MAX_DEBUG_PER_NIGHT, MAX_RANK_HOURS, nightRoom, OS_ASSIGNMENTS, paperShare, rankGain,
  PROJECT_DAY_MAX, PROJECT_FIN_PENALTY, PROJECT_FROM_DAY, PROJECT_NEED, PROJECT_PRACTICE_SHARE, projectDue, rankNights, rankPercent, RANK_SHARE, selectionProblem, SIT_LIMIT, STUCK_MULT, takes, thresholdMult, UNARCHIVED_KEPT,
  WALK_EFFORT, WRITE_HOURS,
} from './courses.ts';
import { liverClues, liverStrikes } from './liver.ts';
import { contributions, GRADES, nextLoad, strikes, type DayFacts } from './load.ts';
import { isFailed, type PatrolResult } from './patrol.ts';
import { examPerformance, gradeFor } from './rating.ts';
import type {
  Assignment, DayRecord, DayView, HomeworkDay, Illness, LiverReading, PatrolRecord, SemesterContext, SemesterEvent, SemesterParams, SemesterState, SemesterSummary, Strategy, WelfareView,
} from './types.ts';
import { EARLY_START_DAYS, minutesProgress, patrolKit, STOP_BY, welfareOffer } from './welfare.ts';

const STEP = 0.5;

export const minuteOf = (day: number, hour: number): number => (day - 1) * MINUTES_PER_DAY + Math.round(hour * 60);

/** Design doc 9.1: 1.2 (1.1 when tolerant) from a residual of boostMin, else 1. */
export const caffeineBoost = (residual: number, tolerant: boolean, k: { boostMin: number; boost: number; boostTolerant: number }): number =>
  residual >= k.boostMin ? (tolerant ? k.boostTolerant : k.boost) : 1;

/** Design doc 9.1: 1 - 0.4 x min(1, residual / 100), and 1 under the dead zone. */
export const caffeineSleepCoef = (residual: number, k: { cafDeadZone: number; cafSleepK: number }): number =>
  residual < k.cafDeadZone ? 1 : 1 - k.cafSleepK * Math.min(1, residual / 100);

/** Design doc 9.1: debt grows by the shortfall; sleep past the need repays only repayRatio of the surplus. */
export const nextSleepDebt = (debt: number, effectiveSleep: number, k: { sleepNeed: number; repayRatio: number }): number =>
  effectiveSleep <= k.sleepNeed
    ? debt + (k.sleepNeed - effectiveSleep)
    : Math.max(0, debt - k.repayRatio * (effectiveSleep - k.sleepNeed));

function source(tags: TagState, kind: SourceNodeKind, key: string, at: number, data?: NodeData): [TagState, number] {
  const [log, id] = record(tags.log, { kind, key, at, ...(data ? { data } : {}) });
  return [{ ...tags, log }, id];
}

/** A derived entry of the causal log: an effect that follows from `causes`. */
function derive(tags: TagState, key: string, at: number, causes: readonly number[], data?: NodeData): [TagState, number] {
  const [log, id] = record(tags.log, { kind: 'effect', key, at, causes, ...(data ? { data } : {}) });
  return [{ ...tags, log }, id];
}

const MIDNIGHT = 24;

/** The dictionary modifiers that hold now (design doc 8.7). */
export function activeModifiers(tags: TagState, dict: TagDictionary): string[] {
  return [...dict.aliases].filter(([, alias]) => holds(tags, dict, alias.condition)).map(([name]) => name);
}

/** Settings that would break a guarantee of design doc 8.4 are refused when the semester starts. */
function checkParams(k: SemesterParams): void {
  const rising = (names: string, xs: readonly number[]): void => {
    if (!xs.every((x, i) => i === 0 || xs[i - 1]! < x)) throw new RangeError(`${names} must be strictly increasing, got ${xs.join(', ')}`);
  };
  rising('floorYellowAt, floorOrangeAt, floorRedAt', [k.floorYellowAt, k.floorOrangeAt, k.floorRedAt]);
  rising('ratingCuts', k.ratingCuts);
  if (k.floorOmenCap >= k.floorRedAt) throw new RangeError('floorOmenCap must stay under floorRedAt, or a floor could strike with no orange night before');
  if (k.floorStallBest >= k.floorRedAt) throw new RangeError('floorStallBest must stay under floorRedAt, or a patrol could not lift a floor off the red line');
}

export function startSemester(ctx: SemesterContext, seed: number): SemesterState {
  checkParams(ctx.params);
  const problem = ctx.courses === undefined ? undefined : selectionProblem(ctx.courses);
  if (problem !== undefined) throw new RangeError(`the course selection breaks a rule of design doc 8.3 (${problem}): ${ctx.courses!.join(', ')}`);
  if (ctx.clause !== undefined && !validClause(ctx.clause)) throw new RangeError(`the overtime clause must be a whole level from 0 to ${MAX_CLAUSE}, got ${ctx.clause}`);
  if (ctx.clause !== undefined && ctx.courses !== undefined && clauseProblem(ctx.clause, creditsOf(ctx.courses)) !== undefined) {
    throw new RangeError(`overtime clause ${ctx.clause} does not stack with ${creditsOf(ctx.courses)} credits: ${ctx.courses.join(', ')}`);
  }
  for (const [day, ids] of Object.entries(ctx.scenario)) {
    for (const id of ids) if (!ctx.events.has(id)) throw new RangeError(`scenario day ${day} names the unknown event "${id}"`);
  }
  const [started, start] = source(EMPTY_TAGS, 'rule', 'semester.start', 0);
  let tags = setAmount(started, ctx.dict, 'stress', ctx.params.stress0, start, 0);
  if ((ctx.startDebt ?? 0) > 0) tags = setAmount(tags, ctx.dict, 'sleep_debt', ctx.startDebt!, start, 0);
  let rng = seedStreams(seed);
  const homework: Assignment[] = [];
  // The debugging hours are fixed by the seed, so starting early or late cannot reroll them (design doc 8.3).
  if (ctx.courses?.includes('os')) {
    for (const a of OS_ASSIGNMENTS) {
      let roll: number;
      [roll, rng] = drawFloat(rng, 'map');
      homework.push({ ...a, written: 0, debug: debugHoursFor(roll), debugged: 0, done: false, missed: false });
    }
  }
  return {
    day: 1, wake: ctx.params.wake, tags, progress: 0, staging: 0, rank: 0, project: 0, graded: 0, loads: EMPTY_LOADS, loadCauses: mapFloors(() => []), cupsHist: [], zeroCupDays: 0, liverOrders: [], workOrders: [],
    hospitals: 0, homework, bankrupt: false, rng, history: [], ended: false,
  };
}

/** The assignments that can be worked on on the day of `s`: announced, not yet due, not handed in. */
const workable = (s: SemesterState): { a: Assignment; i: number }[] =>
  s.homework.flatMap((a, i) => (a.announce <= s.day && s.day < a.due && !a.done ? [{ a, i }] : []));

const withAssignment = (s: SemesterState, i: number, patch: Partial<Assignment>): SemesterState =>
  ({ ...s, homework: s.homework.map((a, j) => (j === i ? { ...a, ...patch } : a)) });

function homeworkDelta(before: readonly Assignment[], after: readonly Assignment[]): HomeworkDay[] {
  return after.flatMap((a, i) => {
    const b = before[i]!;
    const day: HomeworkDay = { n: i + 1, wrote: a.written - b.written, debugged: a.debugged - b.debugged, done: a.done && !b.done, missed: a.missed && !b.missed };
    return day.wrote > 0 || day.debugged > 0 || day.done || day.missed ? [day] : [];
  });
}

type Activity = 'study' | 'rest' | 'class' | 'meal' | 'exam' | 'work' | 'project';
type StressKey = keyof SemesterParams['stressPerHour'];

/** The rows of `stressPerHour` the semester's hours are charged at; a free hour is leisure. */
const STRESS_OF: Readonly<Record<Activity, StressKey>> = { study: 'study', project: 'study', rest: 'leisure', class: 'class', meal: 'meal', exam: 'exam', work: 'work' };

/** One day in progress: the state it is rebuilding and what the day has done so far. */
interface DayRun {
  s: SemesterState;
  readonly ctx: SemesterContext;
  readonly strategy: Strategy;
  readonly exam: 'mid' | 'fin' | null;
  readonly S: number;
  readonly brainStrike: boolean;
  /** Share of the day's study that goes to the staging pile. */
  readonly paper: number;
  readonly morningLoads: SemesterState['loads'];
  cups: number;
  /** Hours the day's cups were drunk at. */
  coffee: number[];
  /** The patrol's welfare offer was drawn again today. */
  rerolled: boolean;
  alcoholCups: number;
  fasting: boolean;
  deadline: boolean;
  lateSnack: boolean;
  /** The latest reading of the liver's load today; undefined until something reads it. */
  reading: LiverReading | undefined;
  workLeft: number;
  /** Hours of the day still to be spent writing the assignment at index `writeIdx` of the state. */
  writeLeft: number;
  writeIdx: number;
  /** Hours of the day still to go to the compiler project, the hours it got, and whether a walk breaks up the sitting. */
  projectLeft: number;
  projectHours: number;
  /** Hours of the day still to go to the TA line's grading. */
  gradeLeft: number;
  walk: boolean;
  /** Hours sat at the desk in a row. */
  sit: number;
  bedDelay: number;
  /** What an overtime patrol pushes bedtime back, known once the patrol is chosen. */
  overtimeDelay: number;
  studyHours: number;
  /** Hours between the end of the evening and bedtime spent studying. */
  lateStudy: number;
  /** The events of the day behind each floor's contribution tonight, for the causal log. */
  evidence: Record<'brain' | 'stomach' | 'liver', number[]>;
  pending: SemesterEvent[];
  played: { id: string; option: string }[];
  /** Progress the day's patrols added through 會議紀錄. */
  minutes: number;
  /** Stress through the day, kept within 0 to 100 after every charge as the old sim's was (design doc 9.1). */
  stress: number;
  /** Hours of the next charge that a compiler walk takes, at the walking rate instead of the hour's own. */
  walked: number;
  /** The events behind the day's stress, for the causal log. */
  stressCauses: number[];
}

const examOn = (day: number, ctx: SemesterContext): 'mid' | 'fin' | null =>
  day === ctx.params.midDay ? 'mid' : day === ctx.params.finDay ? 'fin' : null;

/**
 * Whether the leaderboard contest is open tonight (design doc 8.3): the nights between the midterm and the final, never on a
 * hospital day. Undefined when the algorithms card is not taken.
 */
const rankOpen = (ctx: SemesterContext, s: SemesterState): boolean | undefined => {
  if (!takes(ctx.courses, 'algorithms')) return undefined;
  const { from, to } = rankNights(ctx.params);
  return s.day >= from && s.day <= to && s.hospitalDay !== s.day;
};

/**
 * Whether the midterm papers of the TA line can be graded in today's free hours (`day`) or tonight after bedtime (`night`): from
 * the midterm to the day the grades are due, and a night only while a day is left to hand them in. Undefined without the card.
 */
const gradeOpen = (ctx: SemesterContext, s: SemesterState): { readonly day: boolean; readonly night: boolean } | undefined => {
  if (!takes(ctx.courses, 'ta')) return undefined;
  const { from, to } = gradeDays(ctx.params);
  const left = s.graded < GRADE_HOURS && s.hospitalDay !== s.day;
  return { day: left && s.day >= from && s.day <= to, night: left && s.day >= from && s.day < to };
};

/** The welfare cards in hand and what the night just gone gives the patrol; the salt is the run's own, which no stream of the day draws. */
function welfareView(s: SemesterState, today: boolean): WelfareView {
  const held = s.welfare ?? [];
  const night = s.history[s.history.length - 1];
  const last = night?.slept === undefined ? undefined : { slept: night.slept, stopped: night.contestStop === true };
  return { held, kit: patrolKit(held, last), ...(last ? { last } : {}), salt: s.rng.setting, rerolled: today || rerolledBefore(s) };
}

const rerolledBefore = (s: SemesterState): boolean => s.history.some((r) => r.rerolled === true);

/** 提早開工: the debugging hours a second draw gives assignment `i`, fixed by the run like the first so the card cannot reroll them. */
const earlyDebug = (s: SemesterState, i: number): number => debugHoursFor(nextFloat((s.rng.setting + Math.imul(i + 1, 0x9e3779b1)) >>> 0)[0]);

function viewOf(d: DayRun): DayView {
  const { ctx, s } = d;
  const k = ctx.params;
  const open = rankOpen(ctx, s);
  const grading = gradeOpen(ctx, s);
  return {
    day: s.day,
    wake: s.wake,
    weekend: k.weekend.includes(s.day),
    exam: d.exam,
    examTomorrow: examOn(s.day + 1, ctx) !== null,
    sleepDebt: amount(s.tags, ctx.dict, 'sleep_debt'),
    stress: amount(s.tags, ctx.dict, 'stress'),
    chronicStress: flag(s.tags, ctx.dict, 'chronic_stress'),
    ...(s.illness !== undefined ? { illness: s.illness.stage } : {}),
    S: d.S,
    caffeine: caffeineOf(s.tags, ctx.dict),
    progress: s.progress,
    staging: s.staging,
    bedDelay: d.bedDelay + d.overtimeDelay,
    hospitals: s.hospitals,
    welfare: welfareView(s, d.rerolled),
    panel: elevatorPanel(d.morningLoads, k),
    liverClues: liverClues(d.morningLoads.liver, s.liverOrders, k, s.day, s.rng.setting),
    workOrders: s.workOrders,
    ...readingOf(d),
    modifiers: activeModifiers(s.tags, ctx.dict),
    homework: workable(s).map(({ a, i }) => ({
      n: i + 1, due: a.due, written: a.written, debugged: a.debugged, ...(a.written >= WRITE_HOURS ? { debug: a.debug } : {}),
    })),
    ...(open === undefined ? {} : { rank: { score: s.rank, open } }),
    ...(takes(ctx.courses, 'compiler')
      ? { project: { done: s.project, need: PROJECT_NEED, open: s.day >= PROJECT_FROM_DAY && s.day <= projectDue(k) && s.project < PROJECT_NEED && s.hospitalDay !== s.day } }
      : {}),
    ...(grading === undefined ? {} : { grade: { done: s.graded, need: GRADE_HOURS, due: gradeDays(k).to, open: grading.day, night: grading.night } }),
  };
}

/** Today's reading of the liver if there is one, else the latest of the days gone. */
function readingOf(d: DayRun): { liverReading?: LiverReading & { day: number } } {
  if (d.reading !== undefined) return { liverReading: { ...d.reading, day: d.s.day } };
  const last = [...d.s.history].reverse().find((r) => r.liverReading !== undefined);
  return last ? { liverReading: { ...last.liverReading!, day: last.day } } : {};
}

function roll(d: DayRun): number {
  const [r, rng] = drawFloat(d.s.rng, 'enemies');
  d.s = { ...d.s, rng };
  return r;
}

/** Plays the events due by `upTo`; with `before`, only those strictly earlier, for the moment bedtime comes. */
function applyEvents(d: DayRun, upTo: number, before = false): void {
  const { dict } = d.ctx;
  while (d.pending.length > 0 && (before ? d.pending[0]!.hour < upTo : d.pending[0]!.hour <= upTo)) {
    const ev = d.pending.shift()!;
    const keys = Object.keys(ev.options);
    const pick = d.strategy.choose(ev.id, keys, viewOf(d));
    const opt = ev.options[pick];
    if (opt === undefined) throw new RangeError(`strategy chose "${pick}" for event "${ev.id}"; its options are ${keys.join(', ')}`);
    const at = minuteOf(d.s.day, upTo);
    // Every choice is logged, even one that changes nothing, so the report can tell what was chosen.
    let [tags, cause] = source(d.s.tags, 'event', `event.${ev.id}.${pick}`, at, { cups: opt.alcohol ?? 0 });
    let orders = d.s.liverOrders;
    let workOrders = d.s.workOrders;
    if (opt.alcohol !== undefined && opt.alcohol > 0) {
      tags = addAmount(tags, dict, 'alcohol', opt.alcohol, cause, at);
      d.alcoholCups += opt.alcohol;
      d.evidence.liver.push(cause);
      orders = [...orders, d.s.day];
      workOrders = [...workOrders, { day: d.s.day, event: ev.id, option: pick }];
    }
    if (opt.fasting) {
      tags = setFlag(tags, dict, 'fasting', true, cause, at);
      d.fasting = true;
    }
    if (opt.deadline) {
      tags = setFlag(tags, dict, 'deadline', true, cause, at);
      d.deadline = true;
      d.evidence.brain.push(cause);
    }
    if (opt.lateSnack) {
      tags = setFlag(tags, dict, 'late_snack', true, cause, at);
      d.lateSnack = true;
      d.evidence.stomach.push(cause);
    }
    if (opt.stress !== undefined && opt.stress > 0) {
      addStress(d, opt.stress);
      d.stressCauses.push(cause);
    }
    // Loads move only in the night settlement, so the afternoon's load is the morning's.
    if (opt.bloodTest) d.reading = { load: d.morningLoads.liver, by: 'blood_test' };
    d.workLeft += opt.workHours ?? 0;
    d.bedDelay += opt.bedDelay ?? 0;
    d.played.push({ id: ev.id, option: pick });
    d.s = { ...d.s, tags, liverOrders: orders, workOrders };
  }
}

function activityAt(d: DayRun, h: number, rest: ReadonlySet<number>): Activity {
  const k = d.ctx.params;
  const fixed = fixedHour(k, d.ctx.courses, d.s.day, d.s.wake, d.exam !== null, h, d.ctx.setting?.commitments);
  if (fixed !== undefined) return fixed;
  if (d.workLeft > 0) {
    d.workLeft -= 1;
    return 'work';
  }
  if (d.writeLeft > 0 && !rest.has(h)) {
    d.writeLeft -= 1;
    const a = d.s.homework[d.writeIdx]!;
    // 提早開工: the first hour of an assignment begun early draws its debugging again and keeps the shorter.
    const early = a.written === 0 && a.due - d.s.day >= EARLY_START_DAYS && (d.s.welfare ?? []).includes('early_start');
    d.s = withAssignment(d.s, d.writeIdx, { written: a.written + 1, ...(early ? { debug: Math.min(a.debug, earlyDebug(d.s, d.writeIdx)) } : {}) });
    return 'work';
  }
  // Papers all graded early leave the planned hours to study, like a finished project.
  if (d.s.graded >= GRADE_HOURS) d.gradeLeft = 0;
  if (d.gradeLeft > 0 && !rest.has(h)) {
    d.gradeLeft -= 1;
    d.s = { ...d.s, graded: d.s.graded + 1 };
    return 'work';
  }
  // The hours a finish takes depend on the day's efficiency, so the plan cannot cap them; the ones past it go back to study.
  if (d.s.project >= PROJECT_NEED) d.projectLeft = 0;
  if (d.projectLeft > 0 && !rest.has(h)) {
    d.projectLeft -= 1;
    return 'project';
  }
  return rest.has(h) ? 'rest' : 'study';
}

function addStress(d: DayRun, x: number): void {
  d.stress = Math.min(100, Math.max(0, d.stress + x));
}

/** Spends `dur` hours on an activity; study moves the semester's progress, the paper-exam part of it into the staging pile, and the project a share of it at once. */
function spend(d: DayRun, dur: number, activity: Activity, effort = 1, stressAs: StressKey = STRESS_OF[activity]): void {
  const { dict, params: k } = d.ctx;
  addStress(d, k.stressPerHour.walk * d.walked);
  addStress(d, k.stressPerHour[stressAs] * (dur - d.walked));
  d.walked = 0;
  let { tags, progress, staging, project } = d.s;
  if (activity === 'study' || activity === 'project') {
    const boost = caffeineBoost(caffeineOf(tags, dict), flag(tags, dict, 'caffeine_tolerant'), k);
    const ill = d.s.illness?.stage;
    const sick = ill === 'cold' ? k.coldStudy : ill === 'fever' ? k.feverStudy : 1;
    const efficiency = d.S * boost * (flag(tags, dict, 'withdrawal') ? k.withdrawal : 1) * (d.brainStrike ? k.floorStrikeStudyMult : 1) * sick;
    const gain = efficiency * dur * effort;
    if (activity === 'project') {
      project += gain;
      progress += gain * PROJECT_PRACTICE_SHARE;
      d.projectHours += dur;
    } else {
      progress += gain * (1 - d.paper);
      staging += gain * d.paper;
      d.studyHours += dur;
    }
  }
  tags = metabolise(tags, dict, Math.round(dur * 60), k);
  d.s = { ...d.s, tags, progress, staging, project };
}

/**
 * What the desk does to the next `dur` hours: with the compiler card, a long unbroken sit leaves the stuck point's 0.3, and a
 * planned walk before the hour that would pass SIT_LIMIT clears it at the price of a quarter of that hour (design doc 8.3), in the
 * late-night steps as in the day's hours. Anything but study or the project at the desk ends the sit.
 */
function sitting(d: DayRun, activity: Activity, dur: number): number {
  if (!takes(d.ctx.courses, 'compiler')) return 1;
  if (activity !== 'study' && activity !== 'project') {
    d.sit = 0;
    return 1;
  }
  let effort = 1;
  if (d.walk && d.sit >= SIT_LIMIT) {
    d.sit = 0;
    effort = 1 - (1 - WALK_EFFORT) / dur;
    d.walked = 1 - WALK_EFFORT;
  }
  if (d.sit >= SIT_LIMIT) effort *= STUCK_MULT;
  d.sit += dur;
  return effort;
}

function drinkCup(d: DayRun, h: number): void {
  const { dict, params: k } = d.ctx;
  const at = minuteOf(d.s.day, h);
  const [tags, cause] = source(d.s.tags, 'card', 'coffee', at, { cups: 1 });
  d.s = { ...d.s, tags: addAmount(tags, dict, 'caffeine', k.cup, cause, at) };
  d.cups += 1;
  d.coffee.push(h);
}

function sitExam(d: DayRun, kind: 'mid' | 'fin'): number {
  const k = d.ctx.params;
  const load = d.ctx.courses === undefined ? 1 : thresholdMult(creditsOf(d.ctx.courses));
  const threshold = (kind === 'mid' ? k.passMid : k.passFin * (d.ctx.finMult ?? 1)) * load;
  const result = scoreExam({
    // examDiscount off is the breakage of design doc 9.6 that the archetype checks must catch.
    kind: 'regular', progress: d.s.progress, sExamDay: k.examDiscount ? d.S : 1, passThreshold: threshold, ...examPerformance(d.ctx.skill, roll(d), k),
  });
  let percent = result.examPercent;
  if (kind === 'fin') {
    // The leaderboard is a share of the final exam alone, and an unfinished compiler project or a missed assignment costs it a few points (design doc 8.3).
    if (takes(d.ctx.courses, 'algorithms')) percent = (1 - RANK_SHARE) * percent + RANK_SHARE * rankPercent(d.s.rank);
    if (takes(d.ctx.courses, 'compiler') && d.s.project < PROJECT_NEED) percent = Math.max(0, percent - PROJECT_FIN_PENALTY);
    percent = Math.max(0, percent - HOMEWORK_MISS_PENALTY * d.s.homework.filter((a) => a.missed).length);
  }
  return percent;
}

function patrol(d: DayRun, floor: FloorId, overtime: boolean, played?: PatrolResult): PatrolRecord {
  if (!FLOORS.includes(floor)) throw new RangeError(`"${String(floor)}" is not a floor`);
  // Drawn even when the rooms were played, so the stream the rest of the semester draws from stays where a skill-drawn patrol leaves it.
  const drawn = gradeFor(d.ctx.skill, roll(d), d.ctx.params);
  if (played === undefined) return { floor, grade: drawn, overtime };
  if (played.liverRead === true) {
    if (floor !== 'liver') throw new RangeError(`the highlighter read the liver in the patrol of ${floor}`);
    d.reading = { load: d.morningLoads.liver, by: 'highlighter' };
  }
  if (isFailed(played)) return { floor, grade: 'C', overtime, failed: true };
  if (!GRADES.includes(played.grade)) throw new RangeError(`"${String(played.grade)}" is not a rating`);
  const records = played.records ?? 0;
  if (!Number.isInteger(records) || records < 0) throw new RangeError(`a patrol cannot have made ${records} records`);
  // 會議紀錄 pays at the end of the patrol, with the cards held then.
  const minutes = minutesProgress(d.s.welfare ?? [], records);
  if (minutes > 0) {
    d.s = { ...d.s, progress: d.s.progress + minutes };
    d.minutes += minutes;
  }
  return { floor, grade: played.grade, overtime };
}

function wholeHalfHours(name: string, v: number): number {
  if (!Number.isFinite(v) || !Number.isInteger(v * 2)) throw new RangeError(`${name} must be a multiple of half an hour, got ${v}`);
  return v;
}

interface Night {
  /** Hour the day's activities end and sleep begins. */
  readonly bedEnd: number;
  /** Hour late-night study stopped; absent when none was done. An event or an overtime patrol can keep the player up past it. */
  readonly studyEnd?: number;
  readonly nextWake: number;
  readonly patrols: readonly PatrolRecord[];
  readonly hospitalDay: boolean;
}

interface Outcome {
  readonly strikes: readonly FloorId[];
  readonly hospitalized: boolean;
  readonly loadsSettled: SemesterState['loads'];
  readonly liverStrike?: NonNullable<DayRecord['liverStrike']>;
  readonly crisis?: NonNullable<DayRecord['crisis']>;
  readonly archive?: NonNullable<DayRecord['archive']>;
  readonly slept: number;
  readonly stress: number;
  readonly chronicStress?: true;
  readonly illness?: Illness;
  readonly roommate?: true;
  readonly caught?: true;
}

const nodeOf = (tags: TagState, name: string): number[] => (tags.values[name] ? [tags.values[name]!.node] : []);

/**
 * Names what shortened tonight's sleep as causes of the sleep debt, so a report that traces the
 * debt back finds the late bedtime, the caffeine, the drinks and the snack by name.
 */
function explainDebt(d: DayRun, tags: TagState, n: Night, residual: number, alcoholAtBed: boolean, at: number): TagState {
  const k = d.ctx.params;
  const why: number[] = [];
  if (n.studyEnd !== undefined && n.studyEnd >= MIDNIGHT) {
    const [t, id] = source(tags, 'activity', 'study_late', minuteOf(d.s.day, n.studyEnd), { until: n.studyEnd });
    tags = t;
    why.push(id);
  }
  if (n.bedEnd >= MIDNIGHT && (n.studyEnd === undefined || n.bedEnd > n.studyEnd)) {
    const [t, id] = source(tags, 'activity', 'stayed_up', at, { bed: n.bedEnd });
    tags = t;
    why.push(id);
  }
  if (residual >= k.cafDeadZone) {
    const [t, id] = derive(tags, 'caffeine_insomnia', at, nodeOf(tags, 'caffeine'), { residual: Math.round(residual) });
    tags = t;
    why.push(id);
  }
  if (alcoholAtBed) {
    const [t, id] = derive(tags, 'alcohol_sleep', at, nodeOf(tags, 'alcohol'));
    tags = t;
    why.push(id);
  }
  if (d.lateSnack) why.push(...nodeOf(tags, 'late_snack'));
  return { ...tags, log: addCauses(tags.log, tags.values['sleep_debt']!.node, why, at) };
}

/**
 * A roll in [0, 1) for `day` and `n` (0 or 1) that draws from no stream, so the cold does not move any other draw of the
 * semester. Day d's n = 2 would be day d + 1's n = 0, so another source of rolls takes its own `salt` instead of more n.
 */
const illnessRoll = (salt: number, day: number, n: 0 | 1): number => nextFloat((salt ^ Math.imul(day * 2 + n + 1, 0x85ebca6b)) >>> 0)[0];
/** Salts the roommate's rolls apart from the campus ones; no two days' inputs differ by it (checked for days 1 to 100). */
const ROOMMATE_SALT = 0x9e3779b9;

/**
 * The chance of catching a cold on an exposure (design doc 9.1): infBase, raised by the immune floor's load, by chronic stress,
 * by a sleep debt of debtInfAt hours or more and while the immune floor strikes, and never above 1.
 */
export function infectionChance(immune: number, chronic: boolean, debt: number, immuneStriking: boolean, k: SemesterParams): number {
  const p = k.infBase * (1 + immune / 100) * (chronic ? k.chronicInf : 1) * (debt >= k.debtInfAt ? k.debtInf : 1) * (immuneStriking ? k.immuneStrikeInf : 1);
  return Math.min(1, p);
}

/**
 * The morning's exposure on campus and the infection it may bring (design doc 9.1). A host who has a cold already, or spends
 * the day in hospital, catches nothing. The infection cites what raised its chance.
 */
function catchCold(d: DayRun, hospitalDay: boolean): boolean {
  const { dict, params: k } = d.ctx;
  const s = d.s;
  if (hospitalDay || s.illness !== undefined) return false;
  if (illnessRoll(s.rng.setting, s.day, 0) >= k.campusExposure) return false;
  const chronic = flag(s.tags, dict, 'chronic_stress');
  const debt = amount(s.tags, dict, 'sleep_debt');
  const chance = infectionChance(s.loads.immune, chronic, debt, strikes('immune', s.loads.immune, k), k);
  if (illnessRoll(s.rng.setting, s.day, 1) >= chance) return false;
  const at = minuteOf(s.day, s.wake);
  // The exposure is a rule entry, so the infection is always an effect the report can word, citing what raised its chance.
  const [exposed, exposure] = source(s.tags, 'rule', 'campus.exposure', at);
  const causes = [exposure, ...s.loadCauses.immune, ...(chronic ? nodeOf(s.tags, 'chronic_stress') : []), ...(debt >= k.debtInfAt ? nodeOf(s.tags, 'sleep_debt') : [])];
  const [tags, node] = derive(exposed, 'infection', at, causes, { chance });
  d.s = { ...s, tags, illness: { stage: 'throat', nights: k.throatDays, node } };
  return true;
}

/**
 * The roommate's cold of the evening (design doc 9.1 and its event table: 15% a day for a host in the dorm, as the old sim's
 * roommate_cold). The contact loads the immune floor that night whether or not the host catches it (design doc 8.4); a host
 * already ill or in hospital catches nothing. Returns the tags, whether there was a contact, and whether the host caught it.
 */
function roommateCold(d: DayRun, tags0: TagState, hospitalDay: boolean, at: number): [TagState, boolean, boolean] {
  const { dict, params: k } = d.ctx;
  const s = d.s;
  if (hospitalDay || illnessRoll(s.rng.setting ^ ROOMMATE_SALT, s.day, 0) >= k.roommateExposure) return [tags0, false, false];
  const [sourced, contact] = source(tags0, 'event', 'roommate.cold', at);
  const tags = setFlag(sourced, dict, 'roommate', true, contact, at);
  if (s.illness !== undefined) return [tags, true, false];
  const chronic = flag(tags, dict, 'chronic_stress');
  const debt = amount(tags, dict, 'sleep_debt');
  const chance = infectionChance(s.loads.immune, chronic, debt, strikes('immune', s.loads.immune, k), k);
  if (illnessRoll(s.rng.setting ^ ROOMMATE_SALT, s.day, 1) >= chance) return [tags, true, false];
  const causes = [...nodeOf(tags, 'roommate'), ...s.loadCauses.immune, ...(chronic ? nodeOf(tags, 'chronic_stress') : []), ...(debt >= k.debtInfAt ? nodeOf(tags, 'sleep_debt') : [])];
  const [infected, node] = derive(tags, 'infection.roommate', at, causes, { chance });
  d.s = { ...d.s, illness: { stage: 'throat', nights: k.throatDays, node } };
  return [infected, true, true];
}

/**
 * Tonight's step of the cold (design doc 9.1, the old sim's ladder): an early night of restEff or more ends a sore throat, which
 * otherwise becomes a cold; a night under feverIfEffBelow turns a cold into a fever, and a night of coldFastSleep or more counts
 * twice; each stage ends when its nights run out. The cold and fever tags follow the stage, each citing the one before.
 */
function settleIllness(d: DayRun, tags0: TagState, bedEnd: number, effective: number, at: number): [TagState, SemesterState['illness']] {
  const { dict, params: k } = d.ctx;
  const ill = d.s.illness;
  let tags = tags0;
  if (ill === undefined) return [tags, undefined];
  const well = (): [TagState, undefined] => [setFlag(setFlag(tags, dict, 'cold', false, ill.node, at), dict, 'fever', false, ill.node, at), undefined];
  const become = (stage: Illness, nights: number, cause: number): [TagState, SemesterState['illness']] => {
    tags = setFlag(tags, dict, stage === 'fever' ? 'cold' : 'fever', false, cause, at);
    tags = setFlag(tags, dict, stage, true, cause, at);
    return [tags, { stage, nights, node: ill.node }];
  };
  if (ill.stage === 'throat') {
    if (bedEnd <= k.restBed && effective >= k.restEff) return well();
    const nights = ill.nights - 1;
    return nights > 0 ? [tags, { ...ill, nights }] : become('cold', k.coldDays, ill.node);
  }
  if (ill.stage === 'cold') {
    if (effective < k.feverIfEffBelow) return become('fever', k.feverDays, tags.values['cold']?.node ?? ill.node);
    const nights = ill.nights - (effective >= k.coldFastSleep ? 2 : 1);
    return nights > 0 ? [tags, { ...ill, nights }] : well();
  }
  const nights = ill.nights - 1;
  return nights > 0 ? [tags, { ...ill, nights }] : well();
}

/**
 * Tonight's stress (design doc 9.1): the day's hours and events raise it, every hour of effective sleep takes stressSleep off, and
 * it stays within 0 to 100. Chronic stress begins after chronicDays settlements in a row above chronicAt and ends after
 * chronicClearNights in a row under chronicClear.
 */
function settleStress(d: DayRun, tags0: TagState, rule: number, effective: number, at: number): TagState {
  const { dict, params: k } = d.ctx;
  let tags = tags0;
  let cause = rule;
  if (d.stressCauses.length > 0) [tags, cause] = derive(tags, 'stress.events', at, d.stressCauses);
  const after = Math.max(0, d.stress + k.stressSleep * effective);
  tags = setAmount(tags, dict, 'stress', after, cause, at);
  const before = d.s.history.flatMap((r) => (r.stress === undefined ? [] : [r.stress]));
  const run = (n: number): number[] | undefined => (before.length >= n - 1 ? [...before.slice(before.length - (n - 1)), after] : undefined);
  const chronicBefore = flag(tags, dict, 'chronic_stress');
  if (!chronicBefore && run(k.chronicDays)?.every((x) => x > k.chronicAt) === true) {
    const [t, node] = derive(tags, 'stress.chronic', at, nodeOf(tags, 'stress'));
    tags = setFlag(t, dict, 'chronic_stress', true, node, at);
  } else if (chronicBefore && run(k.chronicClearNights)?.every((x) => x < k.chronicClear) === true) {
    tags = setFlag(tags, dict, 'chronic_stress', false, rule, at);
  }
  return tags;
}

/** The night settlement: sleep, debt, floor loads, strikes, a trip to the emergency room, waking up. */
function settle(d: DayRun, n: Night): Outcome {
  const { dict, params: k } = d.ctx;
  const day = d.s.day;
  const at = minuteOf(day, n.bedEnd);
  const sleepHours = Math.max(0, 24 + n.nextWake - n.bedEnd);
  const residual = caffeineOf(d.s.tags, dict);
  const alcoholAtBed = amount(d.s.tags, dict, 'alcohol') > 0;
  const chronicAtBed = flag(d.s.tags, dict, 'chronic_stress');
  const mult = caffeineSleepCoef(residual, k) * (alcoholAtBed ? k.alcoholSleep : 1) * (d.lateSnack ? k.snackSleep : 1) * (chronicAtBed ? k.chronicSleep : 1);
  const effective = sleepHours * mult;
  let [tags, rule] = source(d.s.tags, 'rule', 'sleep', at, { bed: n.bedEnd, sleep: sleepHours, effective });
  let roommate: boolean;
  let caught: boolean;
  [tags, roommate, caught] = roommateCold(d, tags, n.hospitalDay, at);
  tags = settleStress(d, tags, rule, effective, at);
  const chronic = flag(tags, dict, 'chronic_stress');
  let illness: SemesterState['illness'];
  // The load and the emergency room read the stage the day had, as the old sim did; tonight's step only sets tomorrow's.
  const dayStage = d.s.illness?.stage;
  const dayIllness = dayStage === 'cold' || dayStage === 'fever' ? nodeOf(tags, dayStage) : [];
  [tags, illness] = settleIllness(d, tags, n.bedEnd, effective, at);

  const debtBefore = amount(tags, dict, 'sleep_debt');
  const debtAfter = nextSleepDebt(debtBefore, effective, k);
  tags = setAmount(tags, dict, 'sleep_debt', debtAfter, rule, at);
  if (debtAfter > debtBefore) tags = explainDebt(d, tags, n, residual, alcoholAtBed, at);

  const facts: DayFacts = {
    debtAfter, deadline: d.deadline, tolerant: flag(tags, dict, 'caffeine_tolerant'), lateSnack: d.lateSnack,
    alcoholCups: d.alcoholCups, fasting: d.fasting, chronic, roommate, ...(dayStage !== undefined ? { illness: dayStage } : {}),
  };
  const add = contributions(facts, k);
  // A failed patrol still looked after the floor, so the neglect bonus is waived, but it cuts nothing.
  const patrolled = new Map(n.patrols.map((p) => [p.floor, p] as const));
  let loads = mapFloors((f) => {
    const p = patrolled.get(f);
    const grade = p === undefined || p.failed ? undefined : p.grade;
    return nextLoad(f, d.morningLoads[f], add[f], { sleep: effective, ...(grade ? { grade } : {}), attended: p !== undefined || n.hospitalDay }, k);
  });

  const orderBefore = d.s.liverOrders.some((o) => o < day);
  const dupMedication = flag(tags, dict, 'dup_medication');
  const struck = FLOORS.filter((f) => (f === 'liver'
    ? liverStrikes({ load: loads.liver, alcohol: alcoholAtBed, dupMedication, orders: d.s.liverOrders, day }, k)
    : strikes(f, loads[f], k)));
  // Design doc 8.6: a struck liver plus an empty stomach is the dizzy-and-sweating crisis.
  const crisisNight = struck.includes('liver') && d.fasting;
  // Design doc 8.11: one floor on strike with a crisis tag is enough; the fever is the cold's (the old sim's crisis tag).
  const feverNight = struck.length >= 1 && dayStage === 'fever';
  const er = struck.length >= 2 || crisisNight || feverNight;

  // A load is a running sum, so a floor's causes accumulate until it is calm again (under the yellow line).
  const tonight: Record<FloorId, number[]> = {
    brain: [
      ...(debtAfter > 0 ? nodeOf(tags, 'sleep_debt') : []), ...(facts.tolerant ? nodeOf(tags, 'caffeine_tolerant') : []), ...(chronic ? nodeOf(tags, 'chronic_stress') : []),
      ...d.evidence.brain,
    ],
    stomach: d.evidence.stomach,
    liver: d.evidence.liver,
    immune: [...(chronic ? nodeOf(tags, 'chronic_stress') : []), ...(roommate ? nodeOf(tags, 'roommate') : []), ...dayIllness],
    gut: [],
  };
  const behind = mapFloors((f) => [...new Set([...d.s.loadCauses[f], ...tonight[f]])]);
  const strikeNodes: number[] = [];
  for (const f of struck) {
    const [t, id] = derive(tags, `strike.${f}`, at, behind[f].length > 0 ? behind[f] : [rule], { floor: f });
    tags = t;
    strikeNodes.push(id);
  }

  const loadsSettled = loads;
  let hospitals = d.s.hospitals;
  let hospitalDay: number | undefined;
  let bankrupt = false;
  let residualHours = sleepHours;
  let crisis: Outcome['crisis'];
  if (er) {
    hospitals += 1;
    const [log, node] = record(tags.log, { kind: 'crisis', key: 'er', at, causes: [...strikeNodes, ...(feverNight ? dayIllness : [])] });
    tags = { ...tags, log };
    crisis = { node, at, fasting: crisisNight, ...(feverNight ? { fever: true as const } : {}) };
    if (hospitals >= 2) {
      bankrupt = true;
    } else {
      // The first visit is a hospital day: loads fall to the cap, debt halves, and the night counts as 9 good hours.
      const halved = amount(tags, dict, 'sleep_debt') * k.hospitalDebtMult;
      tags = setAmount(tags, dict, 'sleep_debt', nextSleepDebt(halved, k.hospitalSleep, k), rule, at);
      loads = mapFloors((f) => Math.min(loads[f], k.hospitalFloorLoad));
      hospitalDay = day + 1;
      // The hospital treats the cold, as the old sim's did.
      if (illness !== undefined) {
        tags = setFlag(setFlag(tags, dict, 'cold', false, rule, at), dict, 'fever', false, rule, at);
        illness = undefined;
      }
      residualHours = k.hospitalSleep;
    }
  }
  tags = metabolise(tags, dict, Math.round(residualHours * 60), k);

  // Caffeine tolerance (design doc 9.1): three days of two cups or more; two cup-free days end it.
  const cupsHist = [...d.s.cupsHist, d.cups];
  const zeroCupDays = d.cups === 0 ? d.s.zeroCupDays + 1 : 0;
  if (cupsHist.length >= k.tolDays && cupsHist.slice(-k.tolDays).every((c) => c >= k.tolCups)) {
    tags = setFlag(tags, dict, 'caffeine_tolerant', true, rule, at);
  }
  if (zeroCupDays >= k.tolResetDays) tags = setFlag(tags, dict, 'caffeine_tolerant', false, rule, at);

  // Waking: untilWake tags end, the alcohol tag ends with the morning (design doc 8.6), the deadline is past.
  tags = onWake(tags);
  tags = lowerAmount(tags, dict, 'alcohol', amount(tags, dict, 'alcohol'));
  tags = setFlag(tags, dict, 'deadline', false, rule, at);

  // Sleep files the day's paper-exam study; what it did not reach keeps only half until the next night.
  const staged = d.s.staging;
  // The first emergency-room night counts as hospitalSleep good hours for the debt, so for the archive too.
  const rate = archiveRate(hospitalDay !== undefined ? k.hospitalSleep : effective);
  const archived = staged * rate;

  const loadCauses = mapFloors((f) => (loads[f] < k.floorYellowAt ? [] : behind[f]));
  const { illness: _before, ...kept } = d.s;
  d.s = {
    ...kept, tags, loads, loadCauses, ...(illness !== undefined ? { illness } : {}), progress: d.s.progress + archived, staging: (staged - archived) * UNARCHIVED_KEPT, cupsHist, zeroCupDays, hospitals, bankrupt, day: day + 1, wake: er && !bankrupt ? k.wake : n.nextWake,
    ...(hospitalDay !== undefined ? { hospitalDay } : {}),
  };
  return {
    strikes: struck,
    hospitalized: er,
    loadsSettled,
    // The first emergency-room night counts as good sleep for the debt, so for the early-sleep bonus too.
    slept: hospitalDay !== undefined ? k.hospitalSleep : effective,
    stress: amount(tags, dict, 'stress'),
    ...(chronic ? { chronicStress: true as const } : {}),
    ...(illness !== undefined ? { illness: illness.stage } : {}),
    ...(roommate ? { roommate: true as const } : {}),
    ...(caught ? { caught: true as const } : {}),
    ...(staged > 0 ? { archive: { staged, rate, archived } } : {}),
    ...(struck.includes('liver') ? { liverStrike: { alcoholAtBed, dupMedication, orderBefore } } : {}),
    ...(crisis ? { crisis } : {}),
  };
}

export function playDay(from: SemesterState, ctx: SemesterContext, strategy: Strategy): SemesterState {
  if (from.ended) throw new RangeError('the semester is over');
  // An assignment not handed in by the morning it falls due is missed, whatever the day brings.
  const s0: SemesterState = { ...from, homework: from.homework.map((a) => (a.due === from.day && !a.done ? { ...a, missed: true } : a)) };
  const { dict, params: k } = ctx;
  const day = s0.day;
  const exam = examOn(day, ctx);
  const hospitalDay = s0.hospitalDay === day;
  const debt = amount(s0.tags, dict, 'sleep_debt');
  const d: DayRun = {
    s: s0, ctx, strategy, exam, S: sleepFactor(debt, k), brainStrike: strikes('brain', s0.loads.brain, k), paper: ctx.courses === undefined ? 0 : paperShare(ctx.courses), morningLoads: s0.loads,
    cups: 0, coffee: [], rerolled: false, alcoholCups: 0, fasting: false, deadline: false, lateSnack: false, reading: hospitalDay || day !== 1 ? undefined : { load: s0.loads.liver, by: 'checkup' }, workLeft: 0, writeLeft: 0, writeIdx: -1, projectLeft: 0, projectHours: 0, gradeLeft: 0, walk: false, sit: 0, bedDelay: 0, overtimeDelay: 0, studyHours: 0, lateStudy: 0,
    evidence: { brain: [], stomach: [], liver: [] },
    pending: hospitalDay ? [] : (ctx.scenario[day] ?? []).map((id) => ctx.events.get(id)!).sort((a, b) => a.hour - b.hour),
    played: [],
    minutes: 0,
    stress: Math.min(100, amount(s0.tags, dict, 'stress') + (hospitalDay ? k.hospitalStress : 0)),
    walked: 0,
    stressCauses: [],
  };
  const panel = elevatorPanel(s0.loads, k);
  const header = {
    day,
    wake: s0.wake,
    lights: mapFloors((f) => lightOf(f, s0.loads[f], k)),
    lit: litFloors(panel),
    liverNote: panel.buttons.some((b) => b.floor === 'liver' && b.note === 'liver_ok'),
    ...(panel.routine ? { routine: panel.routine } : {}),
    loadsBefore: s0.loads,
  };

  // Exams are sat on waking, with that morning's S and the progress so far (design doc 8.9).
  if (exam !== null) {
    const percent = hospitalDay ? 0 : sitExam(d, exam);
    d.s = exam === 'mid' ? { ...d.s, mid: percent } : { ...d.s, fin: percent, ended: true };
  }
  if (exam === 'fin') {
    const rec: DayRecord = {
      ...header, kind: hospitalDay ? 'hospital' : 'exam', settled: false, patrols: [], events: [], loadsAfter: s0.loads, loadsSettled: s0.loads, strikes: [],
      hospitalized: false, studyHours: 0, homework: homeworkDelta(from.homework, d.s.homework),
    };
    return { ...d.s, history: [...d.s.history, rec] };
  }

  const infected = catchCold(d, hospitalDay);
  const view0 = viewOf(d);
  const plan = hospitalDay ? { coffee: [], rest: [] } : strategy.plan(view0);
  const rest = new Set(plan.rest);
  const coffee = new Set(plan.coffee);
  const toWrite = workable(d.s).find(({ a }) => a.written < WRITE_HOURS);
  const writeAsked = plan.write ?? 0;
  const writeCap = toWrite === undefined ? 0 : WRITE_HOURS - toWrite.a.written;
  if (!Number.isInteger(writeAsked) || writeAsked < 0 || writeAsked > writeCap) {
    throw new RangeError(`${writeAsked} hours of writing were planned and the day can take 0 to ${writeCap}`);
  }
  d.writeLeft = writeAsked;
  d.writeIdx = toWrite?.i ?? -1;
  const projectAsked = plan.project ?? 0;
  const projectOpen = view0.project?.open === true;
  if (!Number.isInteger(projectAsked) || projectAsked < 0 || projectAsked > PROJECT_DAY_MAX || (projectAsked > 0 && !projectOpen)) {
    throw new RangeError(`${projectAsked} hours of the project were planned and the day can take 0 to ${projectOpen ? PROJECT_DAY_MAX : 0}`);
  }
  const gradeAsked = plan.grade ?? 0;
  const gradeCap = view0.grade?.open === true ? GRADE_HOURS - d.s.graded : 0;
  if (!Number.isInteger(gradeAsked) || gradeAsked < 0 || gradeAsked > gradeCap) {
    throw new RangeError(`${gradeAsked} hours of grading were planned and the day can take 0 to ${gradeCap}`);
  }
  d.gradeLeft = gradeAsked;
  if (plan.walk === true && view0.project === undefined) throw new RangeError('a walk was planned, and only the compiler card has a stuck point to walk away from');
  d.projectLeft = projectAsked;
  d.walk = plan.walk === true;
  // The first cup-free day of a tolerant drinker is the withdrawal day (design doc 9.1).
  if (!hospitalDay && flag(d.s.tags, dict, 'caffeine_tolerant') && coffee.size === 0 && d.s.zeroCupDays === 0) {
    const at = minuteOf(day, d.s.wake);
    const [tags, cause] = source(d.s.tags, 'rule', 'caffeine.withdrawal', at);
    d.s = { ...d.s, tags: setFlag(tags, dict, 'withdrawal', true, cause, at) };
  }

  for (let h = d.s.wake; h < k.bedMin; h++) {
    if (hospitalDay) {
      spend(d, 1, 'rest', 1, 'hospital');
      continue;
    }
    applyEvents(d, h);
    if (coffee.has(h)) drinkCup(d, h);
    const activity = activityAt(d, h, rest);
    spend(d, 1, activity, sitting(d, activity, 1));
  }
  // An event between two whole hours before 22:00 is still due when the evening begins.
  if (!hospitalDay) applyEvents(d, k.bedMin, true);

  // The elevator comes after the day's events and before bedtime (design doc 8.1); exams replace the patrol.
  const patrols: PatrolRecord[] = [];
  let cardTaken: string | undefined;
  if (!hospitalDay && exam === null) {
    const choice = strategy.floor(viewOf(d), d.s.tags, d.morningLoads.liver);
    const rooms = 1 + (choice.overtime === undefined ? 0 : 1);
    if (choice.played !== undefined && choice.played.length !== rooms) {
      throw new RangeError(`${choice.played.length} played patrols were given for ${rooms} chosen`);
    }
    const first = choice.played?.[0] ?? undefined;
    patrols.push(patrol(d, choice.patrol, false, first));
    // The card is taken before the overtime patrol, which then has it.
    if (choice.reroll === true && choice.card === undefined) throw new RangeError('an offer drawn again must have a card picked from it');
    if (choice.card !== undefined) {
      if (first === undefined || isFailed(first)) throw new RangeError('a welfare card was picked, and only a played patrol that was not failed offers any');
      const request = { salt: d.s.rng.setting, day, floor: choice.patrol, grade: first.grade, held: d.s.welfare ?? [], courses: ctx.courses };
      let offer = welfareOffer(request);
      if (choice.reroll === true) {
        if (ctx.reroll !== true) throw new RangeError('an offer can only be drawn again with the career node 開局重抽');
        if (rerolledBefore(d.s)) throw new RangeError('the semester has drawn an offer again already');
        const again = welfareOffer({ ...request, instead: offer });
        if (again.length < offer.length) throw new RangeError(`only ${again.length} cards are left to draw again in place of ${offer.length}`);
        offer = again;
        d.rerolled = true;
      }
      if (!offer.includes(choice.card)) throw new RangeError(`"${choice.card}" is not among the cards the patrol offered (${offer.join(', ') || 'none'})`);
      d.s = { ...d.s, welfare: [...(d.s.welfare ?? []), choice.card] };
      cardTaken = choice.card;
    }
    if (choice.overtime !== undefined) {
      if (choice.overtime === choice.patrol) throw new RangeError('an overtime patrol must be on a second floor');
      patrols.push(patrol(d, choice.overtime, true, choice.played?.[1] ?? undefined));
      d.overtimeDelay = k.overtimeBedDelay;
    }
  }

  const night = hospitalDay
    ? { bed: k.bed, nextWake: k.wake, lateNight: 'rest' as const }
    : strategy.night(viewOf(d));
  const bedBase = Math.min(k.bedMax, Math.max(k.bedMin, wholeHalfHours('bed', night.bed)));
  if (!Number.isInteger(night.nextWake) || night.nextWake < 0) throw new RangeError(`nextWake must be a whole hour from 0, got ${night.nextWake}`);
  if (24 + night.nextWake < bedBase) throw new RangeError(`a plan to wake at ${night.nextWake} wakes before the planned bedtime ${bedBase}`);
  const sleptIn = Math.min(night.nextWake, k.wakeCap);
  const nextWake = examOn(day + 1, ctx) !== null ? Math.min(sleptIn, k.examWake) : sleptIn;
  // Debugging comes after the planned bedtime and pushes it back, as far as the clock goes; the hours that fit are the ones it counts.
  // Both it and the contest hold their hours in the bedtime delay now but are credited after the night loop, which can still lengthen it.
  const debugAsked = night.debug ?? 0;
  const toDebug = workable(d.s).find(({ a }) => a.written >= WRITE_HOURS);
  if (!Number.isInteger(debugAsked) || debugAsked < 0 || debugAsked > MAX_DEBUG_PER_NIGHT || (debugAsked > 0 && toDebug === undefined)) {
    throw new RangeError(`${debugAsked} hours of debugging were planned and the night can take 0 to ${toDebug === undefined ? 0 : MAX_DEBUG_PER_NIGHT}`);
  }
  let debugHours = 0;
  if (toDebug !== undefined && debugAsked > 0) {
    debugHours = Math.min(debugAsked, toDebug.a.debug - toDebug.a.debugged, nightRoom(k, bedBase, d.bedDelay + d.overtimeDelay));
    d.bedDelay += debugHours;
  }
  // The grading comes next and pushes bedtime the same way; the papers wait for no one, so it takes room before the contest.
  const gradeNightAsked = night.grade ?? 0;
  const gradeNightCap = gradeOpen(ctx, d.s)?.night === true ? GRADE_HOURS - d.s.graded : 0;
  if (!Number.isInteger(gradeNightAsked) || gradeNightAsked < 0 || gradeNightAsked > gradeNightCap) {
    throw new RangeError(`${gradeNightAsked} hours of grading were planned and the night can take 0 to ${gradeNightCap}`);
  }
  const gradeHours = Math.min(gradeNightAsked, nightRoom(k, bedBase, d.bedDelay + d.overtimeDelay));
  d.bedDelay += gradeHours;
  // The contest comes after the debugging and the grading and pushes bedtime the same way; the first hour of a night is worth the most.
  const rankAsked = night.rank ?? 0;
  const contestOpen = rankOpen(ctx, d.s) === true;
  if (!Number.isInteger(rankAsked) || rankAsked < 0 || rankAsked > MAX_RANK_HOURS || (rankAsked > 0 && !contestOpen)) {
    throw new RangeError(`${rankAsked} hours of the contest were planned and the night can take 0 to ${contestOpen ? MAX_RANK_HOURS : 0}`);
  }
  const rankHours = rankAsked > 0 ? Math.min(rankAsked, nightRoom(k, bedBase, d.bedDelay + d.overtimeDelay)) : 0;
  d.bedDelay += rankHours;
  const bedEndAt = (): number => Math.min(bedBase + d.bedDelay + d.overtimeDelay, k.bedMax + k.bedOverrun);
  for (let t = k.bedMin; ; t += STEP) {
    // Once bedtime has come, an event strictly before it is still due, and it may push bedtime back.
    if (!hospitalDay) applyEvents(d, t, t >= bedEndAt());
    if (t >= bedEndAt()) break;
    const late = t < bedBase && night.lateNight === 'study';
    if (late) d.lateStudy += STEP;
    const activity = late ? 'study' : 'rest';
    // Past the planned bedtime the hours went to what kept the player up: the debugging, the grading, the contest, an overtime patrol, an event.
    spend(d, STEP, activity, sitting(d, activity, STEP), hospitalDay ? 'hospital' : t >= bedBase ? 'work' : STRESS_OF[activity]);
  }

  // An event in the night can use up the room the plan saw, and the clamp then takes those hours off the bedtime. Only the hours
  // that still fit once the other delays are counted were really spent, so the contest gives way first, then the grading, then the debugging.
  const stayedUp = debugHours + gradeHours + rankHours;
  const fit = Math.min(stayedUp, nightRoom(k, bedBase, d.bedDelay + d.overtimeDelay - stayedUp));
  const debugSpent = Math.min(debugHours, fit);
  const gradeSpent = Math.min(gradeHours, fit - debugSpent);
  const rankSpent = fit - debugSpent - gradeSpent;
  if (gradeSpent > 0) d.s = { ...d.s, graded: d.s.graded + gradeSpent };
  const gradeNight = gradeSpent;
  if (toDebug !== undefined && debugSpent > 0) {
    const debugged = toDebug.a.debugged + debugSpent;
    const done = debugged >= toDebug.a.debug;
    d.s = withAssignment(d.s, toDebug.i, { debugged, done });
    if (done) d.s = { ...d.s, progress: d.s.progress + HOMEWORK_PROGRESS };
  }
  let rankDone: DayRecord['rank'];
  if (rankSpent > 0) {
    const gain = rankGain(rankSpent, d.S);
    d.s = { ...d.s, rank: d.s.rank + gain };
    rankDone = { hours: rankSpent, gain };
  }

  const bedEnd = Math.max(bedEndAt(), k.bedMin);
  // A delay can carry bedtime past the planned wake-up hour; the day never starts before the night ends.
  const woke = Math.max(nextWake, Math.ceil(bedEnd) - 24);
  const { caught, ...outcome } = settle(d, { bedEnd, ...(d.lateStudy > 0 ? { studyEnd: k.bedMin + d.lateStudy } : {}), nextWake: woke, patrols, hospitalDay });
  const rec: DayRecord = {
    ...header,
    bedEnd,
    kind: hospitalDay ? 'hospital' : exam !== null ? 'exam' : 'normal',
    settled: true,
    patrols, events: d.played, loadsAfter: d.s.loads, studyHours: d.studyHours, homework: homeworkDelta(from.homework, d.s.homework), ...(rankDone ? { rank: rankDone } : {}),
    ...(d.reading !== undefined ? { liverReading: d.reading } : {}),
    ...(d.projectHours > 0 ? { project: { hours: d.projectHours, gain: d.s.project - from.project, done: from.project < PROJECT_NEED && d.s.project >= PROJECT_NEED } } : {}),
    ...(d.s.graded > from.graded ? { grade: { hours: d.s.graded - from.graded, done: from.graded < GRADE_HOURS && d.s.graded >= GRADE_HOURS } } : {}),
    ...(rankSpent > 0 && bedEnd <= STOP_BY ? { contestStop: true as const } : {}),
    ...(d.coffee.length > 0 ? { coffee: [...d.coffee] } : {}),
    ...(gradeNight > 0 ? { gradeNight } : {}),
    ...(d.rerolled ? { rerolled: true as const } : {}),
    ...(cardTaken !== undefined ? { card: cardTaken } : {}),
    ...(d.minutes > 0 ? { minutes: d.minutes } : {}),
    ...(infected ? { infected: 'campus' as const } : caught ? { infected: 'roommate' as const } : {}),
    ...outcome,
  };
  const ended = d.s.bankrupt;
  return { ...d.s, history: [...d.s.history, rec], ended, ...(ended ? { fin: d.s.fin ?? 0 } : {}) };
}

export function runSemester(ctx: SemesterContext, strategy: Strategy, seed: number): SemesterState {
  let s = startSemester(ctx, seed);
  // Every turn is one day, so a semester that outlasts its calendar has a final exam that never comes.
  for (let turn = 0; !s.ended; turn++) {
    if (turn >= ctx.params.days) throw new RangeError(`the semester has not ended after ${ctx.params.days} days`);
    s = playDay(s, ctx, strategy);
  }
  return s;
}

export function summarize(s: SemesterState, ctx: SemesterContext): SemesterSummary {
  const k = ctx.params;
  const mid = s.mid ?? 0;
  const fin = s.fin ?? 0;
  return {
    mid, fin, grade: calculateSemesterGrade(mid, fin),
    passMid: mid >= k.examPassPercent,
    passFin: fin >= k.examPassPercent && !s.bankrupt,
    hospitalized: s.hospitals > 0,
    bankrupt: s.bankrupt,
    finalDebt: amount(s.tags, ctx.dict, 'sleep_debt'),
  };
}
