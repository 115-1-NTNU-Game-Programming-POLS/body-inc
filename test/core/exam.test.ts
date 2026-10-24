import { describe, expect, it } from 'vitest';
import {
  calculateExamBase, calculateSemesterGrade, EXAM_SCORING, scoreExam,
  type CombatPerformance, type ExamInput, type ExamReadiness,
} from '../../src/core/index.ts';

const READY: ExamReadiness = { progress: 18, sExamDay: 1, passThreshold: 18 };
const ZERO: CombatPerformance = { answerRate: 0, hitScore: 0, bonusRate: 0 };
const PERFECT: CombatPerformance = { answerRate: 1, hitScore: 1, bonusRate: 1 };
const regular = (performance: CombatPerformance, readiness: ExamReadiness = READY): ExamInput => (
  { ...readiness, ...performance, kind: 'regular' }
);

describe('exam base (design doc 8.9)', () => {
  it('uses 60 points at the pass threshold and caps the base at 100', () => {
    expect(calculateExamBase(READY)).toBe(60);
    expect(calculateExamBase({ ...READY, progress: 90 })).toBe(100);
  });

  it('scales linearly with progress below the cap, including zero', () => {
    expect(calculateExamBase({ ...READY, progress: 0 })).toBe(0);
    expect(calculateExamBase({ ...READY, progress: 4.5 })).toBe(15);
    expect(calculateExamBase({ ...READY, progress: 9 })).toBe(30);
  });

  it('scales linearly with exam-day S, including its lower bound', () => {
    expect(calculateExamBase({ ...READY, sExamDay: 0.3 })).toBe(18);
    expect(calculateExamBase({ ...READY, sExamDay: 0.5 })).toBe(30);
    expect(calculateExamBase({ ...READY, sExamDay: 0.75 })).toBe(45);
  });

  it('uses the caller-provided threshold as the divisor', () => {
    expect(calculateExamBase({ progress: 37, sExamDay: 1, passThreshold: 37 })).toBe(60);
    expect(calculateExamBase({ ...READY, passThreshold: 36 })).toBe(30);
  });

  it('treats progress as points and accepts finite positive thresholds without an invented ceiling', () => {
    expect(calculateExamBase({ progress: 150, sExamDay: 1, passThreshold: 300 })).toBe(30);
    expect(calculateExamBase({ progress: Number.MAX_VALUE, sExamDay: 0.5, passThreshold: Number.MAX_VALUE })).toBe(30);
    expect(calculateExamBase({ progress: Number.MIN_VALUE, sExamDay: 1, passThreshold: Number.MIN_VALUE })).toBe(60);
    expect(calculateExamBase({ ...READY, passThreshold: Number.MIN_VALUE })).toBe(100);
  });

  it('caps the base before applying the performance factor', () => {
    const score = scoreExam(regular(ZERO, { ...READY, progress: 90 }));
    expect(score.base).toBe(100);
    expect(score.examPercent).toBe(75);
  });
});

describe('combat performance and exam percent (design doc 8.9)', () => {
  it('has factor 0.75 at performance 0 and factor 1.25 at performance 1', () => {
    expect(scoreExam(regular(ZERO))).toEqual({
      kind: 'regular', base: 60, performance: 0, factor: 0.75, examPercent: 45, violationRecorded: false,
    });
    expect(scoreExam(regular(PERFECT))).toEqual({
      kind: 'regular', base: 60, performance: 1, factor: 1.25, examPercent: 75, violationRecorded: false,
    });
  });

  it.each([
    ['answerRate', 0.6, 1.05, 63],
    ['hitScore', 0.25, 0.875, 52.5],
    ['bonusRate', 0.15, 0.825, 49.5],
  ] as const)('pins the %s weight while holding the other inputs at zero', (argument, performance, factor, percent) => {
    const score = scoreExam(regular({ ...ZERO, [argument]: 1 }));
    expect(score.kind).toBe('regular');
    if (score.kind === 'fever-makeup') throw new Error('Expected a combat score');
    expect(score.performance).toBeCloseTo(performance, 12);
    expect(score.factor).toBeCloseTo(factor, 12);
    expect(score.examPercent).toBeCloseTo(percent, 12);
  });

  it('combines fractional inputs without rounding the result', () => {
    const score = scoreExam(regular({ answerRate: 0.5, hitScore: 0.8, bonusRate: 0.2 }));
    if (score.kind === 'fever-makeup') throw new Error('Expected a combat score');
    expect(score.performance).toBeCloseTo(0.53, 12);
    expect(score.factor).toBeCloseTo(1.015, 12);
    expect(score.examPercent).toBeCloseTo(60.9, 12);
  });

  it('reproduces the worked claims: 50 becomes 62.5 at best and 85 becomes 63.75 at worst', () => {
    expect(scoreExam(regular(PERFECT, { progress: 50, sExamDay: 1, passThreshold: 60 })).examPercent).toBe(62.5);
    expect(scoreExam(regular(ZERO, { progress: 85, sExamDay: 1, passThreshold: 60 })).examPercent).toBe(63.75);
  });

  it('caps the final exam percent at 100', () => {
    expect(scoreExam(regular(PERFECT, { ...READY, progress: 90 })).examPercent).toBe(100);
  });

  it('gives zero points for zero progress even with perfect performance', () => {
    expect(scoreExam(regular(PERFECT, { ...READY, progress: 0 })).examPercent).toBe(0);
  });

  it('keeps the shared parameter table frozen at runtime', () => {
    expect(Object.isFrozen(EXAM_SCORING)).toBe(true);
  });
});

describe('exam-day fever choices (design doc 8.9)', () => {
  it('needs no combat inputs for makeup and gives the base below 70 without a violation', () => {
    expect(scoreExam({ ...READY, kind: 'fever-makeup' })).toEqual({
      kind: 'fever-makeup', base: 60, examPercent: 60, violationRecorded: false,
    });
  });

  it('caps makeup at 70 for a base both below and at the base cap', () => {
    expect(scoreExam({ progress: 80, sExamDay: 1, passThreshold: 60, kind: 'fever-makeup' })).toEqual({
      kind: 'fever-makeup', base: 80, examPercent: 70, violationRecorded: false,
    });
    expect(scoreExam({ ...READY, progress: 90, kind: 'fever-makeup' }).examPercent).toBe(70);
  });

  it('treats perfect combat performance as 0.4 when sitting with fever and flags the violation', () => {
    expect(scoreExam({ ...READY, ...PERFECT, kind: 'fever-sit' })).toEqual({
      kind: 'fever-sit', base: 60, performance: 0.4, factor: 0.95, examPercent: 57, violationRecorded: true,
    });
    expect(scoreExam(regular(PERFECT)).violationRecorded).toBe(false);
  });

  it('preserves fever performance below the cap and still flags the violation', () => {
    expect(scoreExam({ ...READY, ...ZERO, hitScore: 1, kind: 'fever-sit' })).toEqual({
      kind: 'fever-sit', base: 60, performance: 0.25, factor: 0.875, examPercent: 52.5, violationRecorded: true,
    });
  });

  it('leaves readiness and combat inputs unchanged', () => {
    const input = Object.freeze({ ...READY, ...PERFECT, kind: 'fever-sit' } as const);
    scoreExam(input);
    expect(input).toEqual({ ...READY, ...PERFECT, kind: 'fever-sit' });
  });
});

describe('semester grade (design doc 8.9)', () => {
  it('pins the midterm weight at 0.4 and the final weight at 0.6', () => {
    expect(calculateSemesterGrade(100, 0)).toBe(40);
    expect(calculateSemesterGrade(0, 100)).toBe(60);
  });

  it('accepts both percentage endpoints and keeps fractional grades', () => {
    expect(calculateSemesterGrade(0, 0)).toBe(0);
    expect(calculateSemesterGrade(100, 100)).toBe(100);
    expect(calculateSemesterGrade(62.5, 63.75)).toBe(63.25);
  });
});

describe('exam input validation', () => {
  const invalidReadiness = [
    ...[NaN, Infinity, -Infinity, -0.01].map((value) => ({ argument: 'progress', value } as const)),
    ...[NaN, Infinity, -Infinity, -0.01, 0, 0.3 - Number.EPSILON, 1 + Number.EPSILON]
      .map((value) => ({ argument: 'sExamDay', value } as const)),
    ...[NaN, Infinity, -Infinity, -0.01, 0].map((value) => ({ argument: 'passThreshold', value } as const)),
  ];

  it.each(invalidReadiness)('rejects $argument=$value in the base and every exam path', ({ argument, value }) => {
    const readiness = { ...READY, [argument]: value };
    const calls = [
      () => calculateExamBase(readiness),
      () => scoreExam(regular(PERFECT, readiness)),
      () => scoreExam({ ...readiness, ...PERFECT, kind: 'fever-sit' }),
      () => scoreExam({ ...readiness, kind: 'fever-makeup' }),
    ];
    for (const call of calls) {
      expect(call).toThrow(RangeError);
      expect(call).toThrow(new RegExp(argument));
    }
  });

  const invalidCombat = (['answerRate', 'hitScore', 'bonusRate'] as const).flatMap((argument) => (
    [NaN, Infinity, -Infinity, -0.01, 1 + Number.EPSILON].map((value) => ({ argument, value }))
  ));

  it.each(invalidCombat)('rejects $argument=$value even when fever would cap performance', ({ argument, value }) => {
    for (const kind of ['regular', 'fever-sit'] as const) {
      const call = () => scoreExam({ ...READY, ...PERFECT, [argument]: value, kind });
      expect(call).toThrow(RangeError);
      expect(call).toThrow(new RegExp(argument));
    }
  });

  const invalidGrades = (['midtermPercent', 'finalPercent'] as const).flatMap((argument) => (
    [NaN, Infinity, -Infinity, -0.01, 100 + 1e-10].map((value) => ({ argument, value }))
  ));

  it.each(invalidGrades)('rejects $argument=$value', ({ argument, value }) => {
    const call = () => calculateSemesterGrade(argument === 'midtermPercent' ? value : 60, argument === 'finalPercent' ? value : 60);
    expect(call).toThrow(RangeError);
    expect(call).toThrow(new RegExp(argument));
  });
});
