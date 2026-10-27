import { MINUTES_PER_DAY } from '../clock.ts';
import { calculateSemesterGrade, scoreExam } from '../exam/scoring.ts';
import { caffeineOf, metabolise } from '../outer/caffeine.ts';
import { drawFloat, seedStreams } from '../rng.ts';
import { sleepFactor } from '../spirit.ts';
import { record, type SourceNodeKind } from '../tags/causal.ts';
import type { TagDictionary } from '../tags/dictionary.ts';
import { addAmount, amount, EMPTY_TAGS, flag, holds, lowerAmount, onWake, setAmount, setFlag, type TagState } from '../tags/store.ts';
import { EMPTY_LOADS, elevatorPanel, FLOORS, lightOf, litFloors, mapFloors, type FloorId } from './floors.ts';
import { liverClues, liverStrikes } from './liver.ts';
import { contributions, nextLoad, strikes, type DayFacts } from './load.ts';
import { examPerformance, gradeFor } from './rating.ts';
import type {
  DayRecord, DayView, PatrolRecord, SemesterContext, SemesterEvent, SemesterParams, SemesterState, SemesterSummary, Strategy,
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

function source(tags: TagState, kind: SourceNodeKind, key: string, at: number): [TagState, number] {
  const [log, id] = record(tags.log, { kind, key, at });
  return [{ ...tags, log }, id];
}

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
  for (const [day, ids] of Object.entries(ctx.scenario)) {
    for (const id of ids) if (!ctx.events.has(id)) throw new RangeError(`scenario day ${day} names the unknown event "${id}"`);
  }
  let tags = EMPTY_TAGS;
  if ((ctx.startDebt ?? 0) > 0) {
    const [t, cause] = source(tags, 'rule', 'semester.start', 0);
    tags = setAmount(t, ctx.dict, 'sleep_debt', ctx.startDebt!, cause, 0);
  }
  return {
    day: 1, wake: ctx.params.wake, tags, progress: 0, loads: EMPTY_LOADS, cupsHist: [], zeroCupDays: 0, liverOrders: [],
    hospitals: 0, bankrupt: false, rng: seedStreams(seed), history: [], ended: false,
  };
}

type Activity = 'study' | 'rest' | 'class' | 'meal' | 'exam' | 'work';

/** One day in progress: the state it is rebuilding and what the day has done so far. */
interface DayRun {
  s: SemesterState;
  readonly ctx: SemesterContext;
  readonly strategy: Strategy;
  readonly exam: 'mid' | 'fin' | null;
  readonly S: number;
  readonly brainStrike: boolean;
  readonly morningLoads: SemesterState['loads'];
  cups: number;
  alcoholCups: number;
  fasting: boolean;
  deadline: boolean;
  lateSnack: boolean;
  workLeft: number;
  bedDelay: number;
  studyHours: number;
  pending: SemesterEvent[];
  played: { id: string; option: string }[];
}

const examOn = (day: number, ctx: SemesterContext): 'mid' | 'fin' | null =>
  day === ctx.params.midDay ? 'mid' : day === ctx.params.finDay ? 'fin' : null;

function viewOf(d: DayRun): DayView {
  const { ctx, s } = d;
  const k = ctx.params;
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
    hospitals: s.hospitals,
    panel: elevatorPanel(d.morningLoads, k),
    liverClues: liverClues(d.morningLoads.liver, s.liverOrders, k),
    modifiers: activeModifiers(s.tags, ctx.dict),
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
    let [tags, cause] = source(d.s.tags, 'event', `event.${ev.id}.${pick}`, at);
    let orders = d.s.liverOrders;
    if (opt.alcohol !== undefined && opt.alcohol > 0) {
      tags = addAmount(tags, dict, 'alcohol', opt.alcohol, cause, at);
      d.alcoholCups += opt.alcohol;
      if (!orders.includes(d.s.day)) orders = [...orders, d.s.day];
    }
    if (opt.fasting) {
      tags = setFlag(tags, dict, 'fasting', true, cause, at);
      d.fasting = true;
    }
    if (opt.deadline) {
      tags = setFlag(tags, dict, 'deadline', true, cause, at);
      d.deadline = true;
    }
    if (opt.lateSnack) {
      tags = setFlag(tags, dict, 'late_snack', true, cause, at);
      d.lateSnack = true;
    }
    d.workLeft += opt.workHours ?? 0;
    d.bedDelay += opt.bedDelay ?? 0;
    d.played.push({ id: ev.id, option: pick });
    d.s = { ...d.s, tags, liverOrders: orders };
  }
}

function activityAt(d: DayRun, h: number, rest: ReadonlySet<number>): Activity {
  const k = d.ctx.params;
  if (d.exam !== null && k.examHours.includes(h)) return 'exam';
  if (!k.weekend.includes(d.s.day) && k.classes.includes(h)) return 'class';
  if (h === d.s.wake || k.meals.slice(1).includes(h)) return 'meal';
  if (d.workLeft > 0) {
    d.workLeft -= 1;
    return 'work';
  }
  return rest.has(h) ? 'rest' : 'study';
}

/** Spends `dur` hours on an activity; only study moves the semester's progress. */
function spend(d: DayRun, dur: number, activity: Activity): void {
  const { dict, params: k } = d.ctx;
  let { tags, progress } = d.s;
  if (activity === 'study') {
    const boost = caffeineBoost(caffeineOf(tags, dict), flag(tags, dict, 'caffeine_tolerant'), k);
    const efficiency = d.S * boost * (flag(tags, dict, 'withdrawal') ? k.withdrawal : 1) * (d.brainStrike ? k.floorStrikeStudyMult : 1);
    progress += efficiency * dur;
    d.studyHours += dur;
  }
  tags = metabolise(tags, dict, Math.round(dur * 60), k);
  d.s = { ...d.s, tags, progress };
}

function drinkCup(d: DayRun, h: number): void {
  const { dict, params: k } = d.ctx;
  const at = minuteOf(d.s.day, h);
  const [tags, cause] = source(d.s.tags, 'card', 'coffee', at);
  d.s = { ...d.s, tags: addAmount(tags, dict, 'caffeine', k.cup, cause, at) };
  d.cups += 1;
}

function sitExam(d: DayRun, kind: 'mid' | 'fin'): number {
  const k = d.ctx.params;
  const threshold = kind === 'mid' ? k.passMid : k.passFin * (d.ctx.finMult ?? 1);
  const result = scoreExam({
    kind: 'regular', progress: d.s.progress, sExamDay: d.S, passThreshold: threshold, ...examPerformance(d.ctx.skill, roll(d), k),
  });
  return result.examPercent;
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
  readonly nextWake: number;
  readonly patrols: readonly PatrolRecord[];
  readonly hospitalDay: boolean;
}

interface Outcome {
  readonly strikes: readonly FloorId[];
  readonly hospitalized: boolean;
  readonly loadsSettled: SemesterState['loads'];
  readonly liverStrike?: NonNullable<DayRecord['liverStrike']>;
}

/** The night settlement: sleep, debt, floor loads, strikes, a trip to the emergency room, waking up. */
function settle(d: DayRun, n: Night): Outcome {
  const { dict, params: k } = d.ctx;
  const day = d.s.day;
  const at = minuteOf(day, n.bedEnd);
  let [tags, rule] = source(d.s.tags, 'rule', 'sleep', at);

  const sleepHours = Math.max(0, 24 + n.nextWake - n.bedEnd);
  const alcoholAtBed = amount(tags, dict, 'alcohol') > 0;
  const mult = caffeineSleepCoef(caffeineOf(tags, dict), k) * (alcoholAtBed ? k.alcoholSleep : 1) * (d.lateSnack ? k.snackSleep : 1);
  const effective = sleepHours * mult;
  const debtAfter = nextSleepDebt(amount(tags, dict, 'sleep_debt'), effective, k);
  tags = setAmount(tags, dict, 'sleep_debt', debtAfter, rule, at);

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
  const crisis = struck.includes('liver') && d.fasting;
  const er = struck.length >= 2 || crisis;

  const loadsSettled = loads;
  let hospitals = d.s.hospitals;
  let hospitalDay: number | undefined;
  let bankrupt = false;
  let residualHours = sleepHours;
  if (er) {
    hospitals += 1;
    const causes = [rule, ...['alcohol', 'fasting'].flatMap((t) => (tags.values[t] ? [tags.values[t]!.node] : []))];
    const [log] = record(tags.log, { kind: 'crisis', key: 'er', at, causes });
    tags = { ...tags, log };
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

  d.s = {
    ...d.s, tags, loads, cupsHist, zeroCupDays, hospitals, bankrupt, day: day + 1, wake: er && !bankrupt ? k.wake : n.nextWake,
    ...(hospitalDay !== undefined ? { hospitalDay } : {}),
  };
  return {
    strikes: struck,
    hospitalized: er,
    loadsSettled,
    ...(struck.includes('liver') ? { liverStrike: { alcoholAtBed, dupMedication, orderBefore } } : {}),
  };
}

export function playDay(s0: SemesterState, ctx: SemesterContext, strategy: Strategy): SemesterState {
  if (s0.ended) throw new RangeError('the semester is over');
  const { dict, params: k } = ctx;
  const day = s0.day;
  const exam = examOn(day, ctx);
  const hospitalDay = s0.hospitalDay === day;
  const debt = amount(s0.tags, dict, 'sleep_debt');
  const d: DayRun = {
    s: s0, ctx, strategy, exam, S: sleepFactor(debt, k), brainStrike: strikes('brain', s0.loads.brain, k), morningLoads: s0.loads,
    cups: 0, alcoholCups: 0, fasting: false, deadline: false, lateSnack: false, workLeft: 0, bedDelay: 0, studyHours: 0,
    pending: hospitalDay ? [] : (ctx.scenario[day] ?? []).map((id) => ctx.events.get(id)!).sort((a, b) => a.hour - b.hour),
    played: [],
  };
  const panel = elevatorPanel(s0.loads, k);
  const header = {
    day,
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
      hospitalized: false, studyHours: 0,
    };
    return { ...d.s, history: [...d.s.history, rec] };
  }

  const view0 = viewOf(d);
  const plan = hospitalDay ? { coffee: [], rest: [] } : strategy.plan(view0);
  const rest = new Set(plan.rest);
  const coffee = new Set(plan.coffee);
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
    spend(d, 1, activityAt(d, h, rest));
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
    }
  }

  const night = hospitalDay
    ? { bed: k.bed, nextWake: k.wake, lateNight: 'rest' as const }
    : strategy.night(viewOf(d));
  const bedBase = Math.min(k.bedMax, Math.max(k.bedMin, wholeHalfHours('bed', night.bed)));
  if (!Number.isInteger(night.nextWake) || night.nextWake < 0) throw new RangeError(`nextWake must be a whole hour from 0, got ${night.nextWake}`);
  const sleptIn = Math.min(night.nextWake, k.wakeCap);
  const nextWake = examOn(day + 1, ctx) !== null ? Math.min(sleptIn, k.examWake) : sleptIn;
  const overtimeDelay = patrols.some((p) => p.overtime) ? k.overtimeBedDelay : 0;
  const bedEndAt = (): number => Math.min(bedBase + d.bedDelay + overtimeDelay, k.bedMax + k.bedOverrun);
  for (let t = k.bedMin; t < bedEndAt(); t += STEP) {
    if (!hospitalDay) applyEvents(d, t);
    if (t >= bedEndAt()) break;
    spend(d, STEP, t < bedBase ? night.lateNight : 'rest');
  }

  const outcome = settle(d, { bedEnd: Math.max(bedEndAt(), k.bedMin), nextWake, patrols, hospitalDay });
  const rec: DayRecord = {
    ...header,
    kind: hospitalDay ? 'hospital' : exam !== null ? 'exam' : 'normal',
    settled: true,
    patrols, events: d.played, loadsAfter: d.s.loads, studyHours: d.studyHours, ...outcome,
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
