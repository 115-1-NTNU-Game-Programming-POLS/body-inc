import { MINUTES_PER_DAY } from '../clock.ts';
import { calculateSemesterGrade, scoreExam } from '../exam/scoring.ts';
import { caffeineOf, metabolise } from '../outer/caffeine.ts';
import { drawFloat, seedStreams } from '../rng.ts';
import { sleepFactor } from '../spirit.ts';
import { addCauses, record, type NodeData, type SourceNodeKind } from '../tags/causal.ts';
import type { TagDictionary } from '../tags/dictionary.ts';
import { addAmount, amount, EMPTY_TAGS, flag, holds, lowerAmount, onWake, setAmount, setFlag, type TagState } from '../tags/store.ts';
import { EMPTY_LOADS, elevatorPanel, FLOORS, lightOf, litFloors, mapFloors, type FloorId } from './floors.ts';
import {
  archiveRate, creditsOf, debugHoursFor, fixedHour, HOMEWORK_MISS_PENALTY, HOMEWORK_PROGRESS, MAX_DEBUG_PER_NIGHT, MAX_RANK_HOURS, nightRoom, OS_ASSIGNMENTS, paperShare, rankGain,
  PROJECT_DAY_MAX, PROJECT_FIN_PENALTY, PROJECT_FROM_DAY, PROJECT_NEED, PROJECT_PRACTICE_SHARE, projectDue, rankNights, rankPercent, RANK_SHARE, selectionProblem, SIT_LIMIT, STUCK_MULT, takes, thresholdMult, UNARCHIVED_KEPT,
  WALK_EFFORT, WRITE_HOURS,
} from './courses.ts';
import { liverClues, liverStrikes } from './liver.ts';
import { contributions, nextLoad, strikes, type DayFacts } from './load.ts';
import { examPerformance, gradeFor } from './rating.ts';
import type {
  Assignment, DayRecord, DayView, HomeworkDay, PatrolRecord, SemesterContext, SemesterEvent, SemesterParams, SemesterState, SemesterSummary, Strategy,
} from './types.ts';

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
  for (const [day, ids] of Object.entries(ctx.scenario)) {
    for (const id of ids) if (!ctx.events.has(id)) throw new RangeError(`scenario day ${day} names the unknown event "${id}"`);
  }
  let tags = EMPTY_TAGS;
  if ((ctx.startDebt ?? 0) > 0) {
    const [t, cause] = source(tags, 'rule', 'semester.start', 0);
    tags = setAmount(t, ctx.dict, 'sleep_debt', ctx.startDebt!, cause, 0);
  }
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
    day: 1, wake: ctx.params.wake, tags, progress: 0, staging: 0, rank: 0, project: 0, loads: EMPTY_LOADS, loadCauses: mapFloors(() => []), cupsHist: [], zeroCupDays: 0, liverOrders: [],
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
  alcoholCups: number;
  fasting: boolean;
  deadline: boolean;
  lateSnack: boolean;
  workLeft: number;
  /** Hours of the day still to be spent writing the assignment at index `writeIdx` of the state. */
  writeLeft: number;
  writeIdx: number;
  /** Hours of the day still to go to the compiler project, the hours it got, and whether a walk breaks up the sitting. */
  projectLeft: number;
  projectHours: number;
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

function viewOf(d: DayRun): DayView {
  const { ctx, s } = d;
  const k = ctx.params;
  const open = rankOpen(ctx, s);
  return {
    day: s.day,
    wake: s.wake,
    weekend: k.weekend.includes(s.day),
    exam: d.exam,
    examTomorrow: examOn(s.day + 1, ctx) !== null,
    sleepDebt: amount(s.tags, ctx.dict, 'sleep_debt'),
    S: d.S,
    caffeine: caffeineOf(s.tags, ctx.dict),
    progress: s.progress,
    staging: s.staging,
    bedDelay: d.bedDelay + d.overtimeDelay,
    hospitals: s.hospitals,
    panel: elevatorPanel(d.morningLoads, k),
    liverClues: liverClues(d.morningLoads.liver, s.liverOrders, k),
    modifiers: activeModifiers(s.tags, ctx.dict),
    homework: workable(s).map(({ a, i }) => ({
      n: i + 1, due: a.due, written: a.written, debugged: a.debugged, ...(a.written >= WRITE_HOURS ? { debug: a.debug } : {}),
    })),
    ...(open === undefined ? {} : { rank: { score: s.rank, open } }),
    ...(takes(ctx.courses, 'compiler')
      ? { project: { done: s.project, need: PROJECT_NEED, open: s.day >= PROJECT_FROM_DAY && s.day <= projectDue(k) && s.project < PROJECT_NEED && s.hospitalDay !== s.day } }
      : {}),
  };
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
    if (opt.alcohol !== undefined && opt.alcohol > 0) {
      tags = addAmount(tags, dict, 'alcohol', opt.alcohol, cause, at);
      d.alcoholCups += opt.alcohol;
      d.evidence.liver.push(cause);
      orders = [...orders, d.s.day];
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
    d.workLeft += opt.workHours ?? 0;
    d.bedDelay += opt.bedDelay ?? 0;
    d.played.push({ id: ev.id, option: pick });
    d.s = { ...d.s, tags, liverOrders: orders };
  }
}

function activityAt(d: DayRun, h: number, rest: ReadonlySet<number>): Activity {
  const k = d.ctx.params;
  const fixed = fixedHour(k, d.ctx.courses, d.s.day, d.s.wake, d.exam !== null, h);
  if (fixed !== undefined) return fixed;
  if (d.workLeft > 0) {
    d.workLeft -= 1;
    return 'work';
  }
  if (d.writeLeft > 0 && !rest.has(h)) {
    d.writeLeft -= 1;
    d.s = withAssignment(d.s, d.writeIdx, { written: d.s.homework[d.writeIdx]!.written + 1 });
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

/** Spends `dur` hours on an activity; study moves the semester's progress, the paper-exam part of it into the staging pile, and the project a share of it at once. */
function spend(d: DayRun, dur: number, activity: Activity, effort = 1): void {
  const { dict, params: k } = d.ctx;
  let { tags, progress, staging, project } = d.s;
  if (activity === 'study' || activity === 'project') {
    const boost = caffeineBoost(caffeineOf(tags, dict), flag(tags, dict, 'caffeine_tolerant'), k);
    const efficiency = d.S * boost * (flag(tags, dict, 'withdrawal') ? k.withdrawal : 1) * (d.brainStrike ? k.floorStrikeStudyMult : 1);
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
}

function sitExam(d: DayRun, kind: 'mid' | 'fin'): number {
  const k = d.ctx.params;
  const load = d.ctx.courses === undefined ? 1 : thresholdMult(creditsOf(d.ctx.courses));
  const threshold = (kind === 'mid' ? k.passMid : k.passFin * (d.ctx.finMult ?? 1)) * load;
  const result = scoreExam({
    kind: 'regular', progress: d.s.progress, sExamDay: d.S, passThreshold: threshold, ...examPerformance(d.ctx.skill, roll(d), k),
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

function patrol(d: DayRun, floor: FloorId, overtime: boolean): PatrolRecord {
  if (!FLOORS.includes(floor)) throw new RangeError(`"${String(floor)}" is not a floor`);
  return { floor, grade: gradeFor(d.ctx.skill, roll(d), d.ctx.params), overtime };
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

/** The night settlement: sleep, debt, floor loads, strikes, a trip to the emergency room, waking up. */
function settle(d: DayRun, n: Night): Outcome {
  const { dict, params: k } = d.ctx;
  const day = d.s.day;
  const at = minuteOf(day, n.bedEnd);
  const sleepHours = Math.max(0, 24 + n.nextWake - n.bedEnd);
  const residual = caffeineOf(d.s.tags, dict);
  const alcoholAtBed = amount(d.s.tags, dict, 'alcohol') > 0;
  const mult = caffeineSleepCoef(residual, k) * (alcoholAtBed ? k.alcoholSleep : 1) * (d.lateSnack ? k.snackSleep : 1);
  const effective = sleepHours * mult;
  let [tags, rule] = source(d.s.tags, 'rule', 'sleep', at, { bed: n.bedEnd, sleep: sleepHours, effective });

  const debtBefore = amount(tags, dict, 'sleep_debt');
  const debtAfter = nextSleepDebt(debtBefore, effective, k);
  tags = setAmount(tags, dict, 'sleep_debt', debtAfter, rule, at);
  if (debtAfter > debtBefore) tags = explainDebt(d, tags, n, residual, alcoholAtBed, at);

  const facts: DayFacts = {
    debtAfter, deadline: d.deadline, tolerant: flag(tags, dict, 'caffeine_tolerant'), lateSnack: d.lateSnack,
    alcoholCups: d.alcoholCups, fasting: d.fasting,
  };
  const add = contributions(facts, k);
  const grades = new Map(n.patrols.map((p) => [p.floor, p.grade] as const));
  let loads = mapFloors((f) => {
    const grade = grades.get(f);
    return nextLoad(f, d.morningLoads[f], add[f], { sleep: effective, ...(grade ? { grade } : {}), attended: grade !== undefined || n.hospitalDay }, k);
  });

  const orderBefore = d.s.liverOrders.some((o) => o < day);
  const dupMedication = flag(tags, dict, 'dup_medication');
  const struck = FLOORS.filter((f) => (f === 'liver'
    ? liverStrikes({ load: loads.liver, alcohol: alcoholAtBed, dupMedication, orders: d.s.liverOrders, day }, k)
    : strikes(f, loads[f], k)));
  // Design doc 8.6: a struck liver plus an empty stomach is the dizzy-and-sweating crisis.
  const crisisNight = struck.includes('liver') && d.fasting;
  const er = struck.length >= 2 || crisisNight;

  // A load is a running sum, so a floor's causes accumulate until it is calm again (under the yellow line).
  const tonight: Record<FloorId, number[]> = {
    brain: [...(debtAfter > 0 ? nodeOf(tags, 'sleep_debt') : []), ...(facts.tolerant ? nodeOf(tags, 'caffeine_tolerant') : []), ...d.evidence.brain],
    stomach: d.evidence.stomach,
    liver: d.evidence.liver,
    immune: [],
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
    const [log, node] = record(tags.log, { kind: 'crisis', key: 'er', at, causes: strikeNodes });
    tags = { ...tags, log };
    crisis = { node, at, fasting: crisisNight };
    if (hospitals >= 2) {
      bankrupt = true;
    } else {
      // The first visit is a hospital day: loads fall to the cap, debt halves, and the night counts as 9 good hours.
      const halved = amount(tags, dict, 'sleep_debt') * k.hospitalDebtMult;
      tags = setAmount(tags, dict, 'sleep_debt', nextSleepDebt(halved, k.hospitalSleep, k), rule, at);
      loads = mapFloors((f) => Math.min(loads[f], k.hospitalFloorLoad));
      hospitalDay = day + 1;
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
  d.s = {
    ...d.s, tags, loads, loadCauses, progress: d.s.progress + archived, staging: (staged - archived) * UNARCHIVED_KEPT, cupsHist, zeroCupDays, hospitals, bankrupt, day: day + 1, wake: er && !bankrupt ? k.wake : n.nextWake,
    ...(hospitalDay !== undefined ? { hospitalDay } : {}),
  };
  return {
    strikes: struck,
    hospitalized: er,
    loadsSettled,
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
    cups: 0, alcoholCups: 0, fasting: false, deadline: false, lateSnack: false, workLeft: 0, writeLeft: 0, writeIdx: -1, projectLeft: 0, projectHours: 0, walk: false, sit: 0, bedDelay: 0, overtimeDelay: 0, studyHours: 0, lateStudy: 0,
    evidence: { brain: [], stomach: [], liver: [] },
    pending: hospitalDay ? [] : (ctx.scenario[day] ?? []).map((id) => ctx.events.get(id)!).sort((a, b) => a.hour - b.hour),
    played: [],
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
      spend(d, 1, 'rest');
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
  if (!hospitalDay && exam === null) {
    const choice = strategy.floor(viewOf(d));
    patrols.push(patrol(d, choice.patrol, false));
    if (choice.overtime !== undefined) {
      if (choice.overtime === choice.patrol) throw new RangeError('an overtime patrol must be on a second floor');
      patrols.push(patrol(d, choice.overtime, true));
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
  // The contest comes after the debugging and pushes bedtime the same way; the first hour of a night is worth the most.
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
    spend(d, STEP, activity, sitting(d, activity, STEP));
  }

  // An event in the night can use up the room the plan saw, and the clamp then takes those hours off the bedtime. Only the hours
  // that still fit once the other delays are counted were really spent, so the contest gives way first, then the debugging.
  const stayedUp = debugHours + rankHours;
  const fit = Math.min(stayedUp, nightRoom(k, bedBase, d.bedDelay + d.overtimeDelay - stayedUp));
  const debugSpent = Math.min(debugHours, fit);
  const rankSpent = fit - debugSpent;
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
  const outcome = settle(d, { bedEnd, ...(d.lateStudy > 0 ? { studyEnd: k.bedMin + d.lateStudy } : {}), nextWake: woke, patrols, hospitalDay });
  const rec: DayRecord = {
    ...header,
    bedEnd,
    kind: hospitalDay ? 'hospital' : exam !== null ? 'exam' : 'normal',
    settled: true,
    patrols, events: d.played, loadsAfter: d.s.loads, studyHours: d.studyHours, homework: homeworkDelta(from.homework, d.s.homework), ...(rankDone ? { rank: rankDone } : {}),
    ...(d.projectHours > 0 ? { project: { hours: d.projectHours, gain: d.s.project - from.project, done: from.project < PROJECT_NEED && d.s.project >= PROJECT_NEED } } : {}),
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
