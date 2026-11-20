import { afterEach, describe, expect, it, vi } from 'vitest';

type Expectations = typeof import('../../sim/semester/expectations.ts');
type Scoring = typeof import('../../src/core/exam/scoring.ts');

// The healthy run is the default run KNOWN_GAPS was measured over, one semester per selection; at fewer the known gaps drift
// past GAP_SLACK on sampling alone, so a shorter run does not judge them. The breakages are judged on a third of it, on
// figures far from their lines.
const BREAK_N = 105;

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

/** The verdict under `params`, naming each expectation that failed it with how. */
function judged(e: Expectations, params: Record<string, number | boolean> = {}): { ok: boolean; failed: string[] } {
  const results = e.expectations(BREAK_N, params);
  const { ok, lines } = e.verdict(results, BREAK_N);
  return { ok, failed: results.flatMap((r, i) => (/^(FAIL|WORSE|HOLDS)/.test(lines[i]!) ? [`${r.id} ${lines[i]!.slice(0, 5).trim()}`] : [])) };
}

afterEach(() => {
  vi.doUnmock('../../src/core/exam/scoring.ts');
  vi.resetModules();
});

describe('the four player archetypes of design doc 9.5', { timeout: 300_000 }, () => {
  it('hold for the rules as they are, the known gaps aside', async () => {
    const e = await load();
    const results = e.expectations(e.SELECTION_COUNT);
    const { ok, lines } = e.verdict(results);
    expect(ok, lines.join('\n')).toBe(true);
    expect(results.filter((r) => !r.pass).map((r) => r.id).sort()).toEqual(Object.keys(e.KNOWN_GAPS).sort());
  });

  // The breakages of design doc 9.6. Each must fail the run; the figures that only just tip (the informed player's average,
  // the night owl's patrol gap, the pass rate of 兩者都不會) are not pinned, the fighters' final pass of 35% to 70% against
  // 30% is.
  it('fail when the sleep debt barely slows study (sCoef 0.01)', async () => {
    const r = judged(await load(), { sCoef: 0.01 });
    expect(r.ok).toBe(false);
    expect(r.failed).toContain('fighter.final FAIL');
  });

  it('fail when the exam is not discounted by the sleep of its morning', async () => {
    const r = judged(await load(), { examDiscount: false });
    expect(r.ok).toBe(false);
    expect(r.failed).toContain('fighter.final FAIL');
  });

  it('fail when the performance factor reaches 2.0, through the informed player averaging over 80', async () => {
    // The fighters' final cannot catch it: the night owl's progress is too low for any factor to pass. The patrol gap tips
    // below 10% as well, but only just, so it is not pinned.
    const r = judged(await load(true));
    expect(r.ok).toBe(false);
    expect(r.failed).toContain('informed.grade FAIL');
  });
});

describe('what a run means', () => {
  const result = (id: string, pass: boolean, value = 0) => ({ id, name: id, pass, detail: '', value });

  it('passes when only the known gaps fail, near where they were listed', async () => {
    const e = await load();
    const gaps = Object.entries(e.KNOWN_GAPS).map(([id, g]) => result(id, false, g.at + g.worse * e.GAP_SLACK));
    expect(e.verdict([result('both.grade', true), ...gaps]).ok).toBe(true);
  });

  it('fails on any other failure, on a known gap that has started to hold, and on one that has moved further from the doc', async () => {
    const e = await load();
    expect(e.verdict([result('both.grade', false)]).ok).toBe(false);
    const [id, gap] = Object.entries(e.KNOWN_GAPS)[0]!;
    const holds = e.verdict([result(id, true)]);
    expect(holds.ok).toBe(false);
    expect(holds.lines[0]).toMatch(/take it off KNOWN_GAPS/);
    const worse = e.verdict([result(id, false, gap.at + gap.worse * (e.GAP_SLACK + 0.1))]);
    expect(worse.ok).toBe(false);
    expect(worse.lines[0]).toMatch(/^WORSE/);
    expect(e.verdict([result(id, false, gap.at - gap.worse * 20)]).ok).toBe(true);
    // On a shorter run neither a gap that holds nor one that moved fails it; any other failure still does.
    expect(e.verdict([result(id, true), result(id, false, gap.at + gap.worse * 20)], 105).ok).toBe(true);
    expect(e.verdict([result('both.grade', false)], 105).ok).toBe(false);
  });
});
