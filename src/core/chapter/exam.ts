import type { TickInput } from '../combat/operator.ts';
import { LOCK_TICKS } from '../dialogue/runner.ts';
import { EXAM_SCORING, scoreExam, type ExamScore } from '../exam/scoring.ts';
import { adenosineFor, scoreTag, takenTag, type ExamDef, type ExamKind, type ExamTally } from '../exam/fight.ts';
import { beginExam } from '../game.ts';
import { caffeineOf, CLOAK } from '../outer/caffeine.ts';
import { sleepFactor, type SleepCoefficients } from '../spirit.ts';
import type { TagDictionary } from '../tags/dictionary.ts';
import { amount, flag, type TagState } from '../tags/store.ts';
import { TICK_HZ } from '../time.ts';
import { ChapterError, type ChapterContent, type ChapterResult, type ChapterState, type GameEvent, type Run } from './chapter.ts';
import { applyEffects } from './effects.ts';
import { confirmPressed, type TalkResult } from './talk.ts';

/**
 * The exam's panels (design doc 7.6). Before the fight the forecast shows both readiness bars
 * and what the morning's state will do in the room, so its effect is seen before it is felt;
 * after it the result shows each segment's readiness, the S of the morning, the performance
 * factor and the score. Both freeze the room like a conversation and close on a confirm.
 */

export interface ExamForecast {
  /** Each segment's readiness in percent: its tag, never below the floor. */
  readonly bars: readonly { readonly kind: ExamKind; readonly readiness: number }[];
  /** S of the exam morning (design doc glossary). */
  readonly s: number;
  readonly adenosine: number;
  /** How long the caffeine cloak will last in the fight, in whole seconds. */
  readonly cloakSeconds: number;
  readonly breakfast: boolean;
}

export interface SegmentResult {
  readonly kind: ExamKind;
  readonly readiness: number;
  readonly answerRate: number;
  readonly hitScore: number;
  readonly bonusRate: number;
  /** No bonus case appeared in the segment, so onusRate stands in for it (see examResult). */
  readonly noBonus: boolean;
  readonly score: ExamScore;
}

export interface ExamResult {
  readonly segments: readonly SegmentResult[];
  /** The mean of the segments' percents (design doc 7.6), whole. */
  readonly total: number;
  readonly s: number;
  /** The computer test scored clearly above the written one: practice done, filing not (design doc 7.6). */
  readonly practiceOnly: boolean;
}

/** Strings every exam's panels and HUD line show, whatever the exam. */
export const EXAM_PANEL_KEYS: readonly string[] = [
  'exam.forecast.title', 'exam.forecast.ready', 'exam.forecast.state', 'exam.forecast.s', 'exam.forecast.breakfast.true', 'exam.forecast.breakfast.false',
  'exam.forecast.rules', 'exam.panel.start', 'exam.panel.continue', 'exam.result.title', 'exam.result.segment', 'exam.result.detail', 'exam.result.detail.no_bonus', 'exam.result.s',
  'exam.result.total', 'exam.result.practice_only', 'exam.hud.question', 'exam.hud.cases', 'exam.hud.step', 'exam.hud.hits', 'exam.hud.break',
];

/** How far the computer test must score above the written one for the result to say so; "clearly" is not a number in the design doc. */
export const PRACTICE_GAP = 15;

export interface ExamPanel {
  readonly id: string;
  readonly age: number;
  readonly forecast?: ExamForecast;
  readonly result?: ExamResult;
}

export function examOf(ctx: ChapterContent, id: string): ExamDef {
  const def = ctx.exams?.get(id);
  if (!def) throw new ChapterError(`${ctx.chapter.id}: exam "${id}" is not in content/exams (the map check and Boot should have caught this)`);
  return def;
}

const readiness = (def: ExamDef, tags: TagState, dict: TagDictionary, tag: string): number =>
  Math.min(100, Math.max(def.floor, amount(tags, dict, tag)));

const sleepDebt = (tags: TagState, dict: TagDictionary): number => amount(tags, dict, 'sleep_debt');

/** Whole seconds the cloak holds adenosine off: until the residue falls below the near line on the boss clock, at most cloakTicks. */
export function cloakSecondsFor(def: ExamDef, residue: number): number {
  if (residue < CLOAK.nearAt) return 0;
  const t = Math.ceil(Math.log(CLOAK.nearAt / residue) / Math.log(def.decayPerTick));
  return Math.floor(Math.min(def.cloakTicks, t) / TICK_HZ);
}

export function examForecast(def: ExamDef, tags: TagState, dict: TagDictionary, k: SleepCoefficients): ExamForecast {
  const debt = sleepDebt(tags, dict);
  return {
    bars: def.segments.map((s) => ({ kind: s.kind, readiness: readiness(def, tags, dict, s.readinessTag) })),
    s: sleepFactor(debt, k),
    adenosine: adenosineFor(def, debt),
    cloakSeconds: cloakSecondsFor(def, caffeineOf(tags, dict)),
    breakfast: dict.tags.has('breakfast') && flag(tags, dict, 'breakfast'),
  };
}

/**
 * Each segment through the shared scoring of design doc 8.9: the base is readiness times S,
 * scaled so a bar at passAt gives 60; the performance weighs answers, hits and the bonus.
 */
export function examResult(def: ExamDef, tallies: readonly ExamTally[], tags: TagState, dict: TagDictionary, k: SleepCoefficients): ExamResult {
  const s = sleepFactor(sleepDebt(tags, dict), k);
  const segments = def.segments.map((seg, i): SegmentResult => {
    const t = tallies[i]!;
    const answerRate = t.questions > 0 ? Math.min(1, t.answered / t.questions) : 0;
    const hitScore = Math.max(0, 1 - t.hits / def.hitsForZero);
    // A stage answered before its bonus case appears never offers one; scoring that as a missed
    // bonus would punish speed, and as a hit would hand out the 15% for free. So the bonus part
    // then scores as the rest of the performance does.
    const { answerWeight: wa, hitWeight: wh } = EXAM_SCORING;
    const bonusRate = t.bonusOffered > 0 ? t.bonusHit / t.bonusOffered : (wa * answerRate + wh * hitScore) / (wa + wh);
    const r = readiness(def, tags, dict, seg.readinessTag);
    return {
      kind: seg.kind, readiness: r, answerRate, hitScore, bonusRate, noBonus: t.bonusOffered === 0,
      score: scoreExam({ kind: 'regular', progress: r, passThreshold: def.passAt, sExamDay: s, answerRate, hitScore, bonusRate }),
    };
  });
  const total = Math.round(segments.reduce((sum, x) => sum + x.score.examPercent, 0) / segments.length);
  const oj = segments.find((x) => x.kind === 'oj')?.score.examPercent;
  const proof = segments.find((x) => x.kind === 'proof')?.score.examPercent;
  return { segments, total, s, practiceOnly: oj !== undefined && proof !== undefined && oj - proof >= PRACTICE_GAP };
}

export function openForecast(ctx: ChapterContent, run: Run, id: string): ExamPanel {
  return { id, age: 0, forecast: examForecast(examOf(ctx, id), run.tags, ctx.dict, ctx.params) };
}

/**
 * The fight is over: its score and that it was sat go into the tags, as one rule entry of the
 * causal log so the close-out report can cite it, and the result panel opens.
 */
export function finishExam(ctx: ChapterContent, state: ChapterState, id: string, tallies: readonly ExamTally[]): TalkResult {
  const def = examOf(ctx, id);
  const result = examResult(def, tallies, state.run.tags, ctx.dict, ctx.params);
  const out = applyEffects(ctx.dict, state.run.tags, state.game.clock, [
    { kind: 'amount', name: scoreTag(id), mode: 'set', value: result.total },
    { kind: 'flag', name: takenTag(id) },
  ], { kind: 'rule', key: `exam.${id}` }, ctx.params);
  return {
    state: { ...state, run: { ...state.run, tags: out.tags }, exam: { id, age: 0, result } },
    events: [{ type: 'examResult', exam: id, total: result.total }],
  };
}

/** One tick of an open panel: a confirm, or a click, closes it once the lock has passed. */
export function stepExamPanel(ctx: ChapterContent, state: ChapterState, input: TickInput): ChapterResult {
  const p = state.exam!;
  if (p.age < LOCK_TICKS) return { state: { ...state, exam: { ...p, age: p.age + 1 } }, events: [] };
  if (!confirmPressed(input) && input.pick === undefined) return { state, events: [] };
  const { exam: _, ...rest } = state;
  const def = examOf(ctx, p.id);
  if (p.result) {
    // The conversation after the exam opens on the next tick, like a chapter's intro.
    return { state: { ...rest, pending: def.afterDialogue }, events: [{ type: 'examClosed', exam: p.id }] };
  }
  const begun = beginExam(state.game, def, caffeineOf(state.run.tags, ctx.dict), sleepDebt(state.run.tags, ctx.dict));
  const events: GameEvent[] = [{ type: 'examClosed', exam: p.id }, ...begun.events];
  return { state: { ...rest, game: begun.state }, events };
}
