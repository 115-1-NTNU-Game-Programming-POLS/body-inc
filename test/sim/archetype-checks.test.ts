import { afterEach, describe, expect, it, vi } from 'vitest';

type Expectations = typeof import('../../sim/semester/expectations.ts');
type Scoring = typeof import('../../src/core/exam/scoring.ts');

const N = 40;

/** The expectations, loaded fresh, optionally with the exam scored as if the performance factor ran 0.75 to 2.0. */
async function load(capTwo = false): Promise<Expectations> {
  vi.resetModules();
  if (capTwo) {
    vi.doMock('../../src/core/exam/scoring.ts', async (importOriginal) => {
      const real = await importOriginal<Scoring>();
      // scoreExam reads EXAM_SCORING inside its own module, so the factor is widened on its result rather than on the constant.
      const scoreExam: Scoring['scoreExam'] = (input) => {
        const r = real.scoreExam(input);
        if (!('factor' in r)) return r;
        const factor = real.EXAM_SCORING.factorMinimum + 1.25 * r.performance;
        return { ...r, factor, examPercent: Math.min(real.EXAM_SCORING.maxPercent, r.base * factor) };
      };
      return { ...real, scoreExam };
    });
  }
  return import('../../sim/semester/expectations.ts');
}

const failing = (e: Expectations, params: Record<string, number | boolean> = {}): string[] =>
  e.expectations(N, params).filter((r) => !r.pass).map((r) => r.id);

afterEach(() => {
  vi.doUnmock('../../src/core/exam/scoring.ts');
  vi.resetModules();
});

describe('the four player archetypes of design doc 9.5', () => {
  it('hold for the rules as they are, the known gaps aside', async () => {
    const e = await load();
    const results = e.expectations(N);
    const { ok, lines } = e.verdict(results);
    expect(ok, lines.join('\n')).toBe(true);
    expect(results.filter((r) => !r.pass).map((r) => r.id).sort()).toEqual(Object.keys(e.KNOWN_GAPS).sort());
  }, 120_000);

  it('fail when the sleep debt barely slows study (sCoef 0.01, design doc 9.6)', async () => {
    const e = await load();
    expect(failing(e, { sCoef: 0.01 }).filter((id) => !(id in e.KNOWN_GAPS))).toEqual(['fighter.final']);
  }, 120_000);

  it('fail when the exam is not discounted by the sleep of its morning (design doc 9.6)', async () => {
    const e = await load();
    expect(failing(e, { examDiscount: false }).filter((id) => !(id in e.KNOWN_GAPS))).toEqual(['fighter.final']);
  }, 120_000);

  it('move the informed player further from 70 when the performance factor reaches 2.0, which only that known gap reads', async () => {
    // The third breakage of 9.6 is caught by no other expectation: the night owl's progress is too low for any factor to pass
    // it. Until the informed player's average comes down to about 70, this breakage goes unreported by the run.
    const grade = async (capTwo: boolean): Promise<number> =>
      Number((await load(capTwo)).expectations(N).find((r) => r.id === 'informed.grade')!.detail.split(',')[0]);
    const healthy = await grade(false);
    expect(await grade(true)).toBeGreaterThan(healthy + 5);
  }, 120_000);
});

describe('what a run means', () => {
  const result = (id: string, pass: boolean) => ({ id, name: id, pass, detail: '' });

  it('passes when only the known gaps fail', async () => {
    const e = await load();
    expect(e.verdict([result('both.grade', true), ...Object.keys(e.KNOWN_GAPS).map((id) => result(id, false))]).ok).toBe(true);
  });

  it('fails on any other failure, and on a known gap that has started to hold', async () => {
    const e = await load();
    expect(e.verdict([result('both.grade', false)]).ok).toBe(false);
    const [gap] = Object.keys(e.KNOWN_GAPS);
    const v = e.verdict([result(gap!, true)]);
    expect(v.ok).toBe(false);
    expect(v.lines[0]).toMatch(/take it off KNOWN_GAPS/);
  });
});
