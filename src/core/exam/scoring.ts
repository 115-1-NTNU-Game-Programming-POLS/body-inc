/** Scoring parameters from design doc 8.9; the S lower bound comes from 9.1. */
export const EXAM_SCORING = Object.freeze({
  baseAtThreshold: 60,
  maxPercent: 100,
  factorMinimum: 0.75,
  factorRange: 0.5,
  answerWeight: 0.6,
  hitWeight: 0.25,
  bonusWeight: 0.15,
  midtermWeight: 0.4,
  finalWeight: 0.6,
  makeupCap: 70,
  feverPerformanceCap: 0.4,
  minimumS: 0.3,
} as const);

export interface ExamReadiness {
  /** Accumulated points, not a percentage; no upper bound is specified in 8.3 or 9.1. */
  readonly progress: number;
  /** Design doc 9.1 implies 0.3..1 because sleep debt cannot be negative. */
  readonly sExamDay: number;
  readonly passThreshold: number;
}

export interface CombatPerformance {
  readonly answerRate: number;
  /** Caller-normalised 0..1 score; 8.9 does not define a mapping from times hit. */
  readonly hitScore: number;
  readonly bonusRate: number;
}

export type ExamInput = ExamReadiness & (
  | (CombatPerformance & { readonly kind: 'regular' | 'fever-sit' })
  | { readonly kind: 'fever-makeup' }
);

export type ExamScore = {
  readonly base: number;
  readonly examPercent: number;
} & (
  | {
    readonly kind: 'regular' | 'fever-sit';
    readonly performance: number;
    readonly factor: number;
    readonly violationRecorded: boolean;
  }
  | { readonly kind: 'fever-makeup'; readonly violationRecorded: false }
);

function checkRange(name: string, value: number, minimum: number, maximum: number): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be finite and in ${minimum}..${maximum}`);
  }
}

export function calculateExamBase(input: ExamReadiness): number {
  checkRange('progress', input.progress, 0, Number.MAX_VALUE);
  checkRange('sExamDay', input.sExamDay, EXAM_SCORING.minimumS, 1);
  if (!Number.isFinite(input.passThreshold) || input.passThreshold <= 0) {
    throw new RangeError('passThreshold must be finite and greater than 0');
  }

  // Divide first so large finite progress and thresholds do not overflow before the cap.
  return Math.min(EXAM_SCORING.maxPercent,
    EXAM_SCORING.baseAtThreshold * (input.progress / input.passThreshold) * input.sExamDay);
}

export function scoreExam(input: ExamInput): ExamScore {
  const base = calculateExamBase(input);
  if (input.kind === 'fever-makeup') {
    return { kind: input.kind, base, examPercent: Math.min(EXAM_SCORING.makeupCap, base), violationRecorded: false };
  }

  checkRange('answerRate', input.answerRate, 0, 1);
  checkRange('hitScore', input.hitScore, 0, 1);
  checkRange('bonusRate', input.bonusRate, 0, 1);
  const rawPerformance = EXAM_SCORING.answerWeight * input.answerRate
    + EXAM_SCORING.hitWeight * input.hitScore
    + EXAM_SCORING.bonusWeight * input.bonusRate;
  const violationRecorded = input.kind === 'fever-sit';
  const performance = violationRecorded ? Math.min(EXAM_SCORING.feverPerformanceCap, rawPerformance) : rawPerformance;
  const factor = EXAM_SCORING.factorMinimum + EXAM_SCORING.factorRange * performance;
  return { kind: input.kind, base, performance, factor,
    examPercent: Math.min(EXAM_SCORING.maxPercent, base * factor), violationRecorded };
}

export function calculateSemesterGrade(midtermPercent: number, finalPercent: number): number {
  checkRange('midtermPercent', midtermPercent, 0, EXAM_SCORING.maxPercent);
  checkRange('finalPercent', finalPercent, 0, EXAM_SCORING.maxPercent);
  return EXAM_SCORING.midtermWeight * midtermPercent + EXAM_SCORING.finalWeight * finalPercent;
}
