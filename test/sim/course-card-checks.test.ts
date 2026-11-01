import { afterEach, describe, expect, it, vi } from 'vitest';

type Checks = typeof import('../../sim/semester/checks.ts');
type Courses = typeof import('../../src/core/semester/courses.ts');
type Broken = { [K in keyof Courses]?: unknown };

/** The checks of design doc 9.6 with `broken` laid over the course constants, loaded fresh so the sim sees the change. */
async function checksWith(broken: (real: Courses) => Broken): Promise<Checks> {
  vi.resetModules();
  vi.doMock('../../src/core/semester/courses.ts', async (importOriginal) => {
    const real = await importOriginal<Courses>();
    return { ...real, ...broken(real) };
  });
  return import('../../sim/semester/checks.ts');
}

/** The names of the checks that fail under `broken`, over fewer seeds than the healthy run: the breakages are far from the thresholds. */
async function failingUnder(broken: (real: Courses) => Broken): Promise<string[]> {
  const { courseCardChecks } = await checksWith(broken);
  return courseCardChecks(100).filter((c) => !c.pass).map((c) => c.name);
}

afterEach(() => {
  vi.doUnmock('../../src/core/semester/courses.ts');
  vi.resetModules();
});

describe('the course card checks of design doc 9.6 (issue 45)', () => {
  it('hold for the cards as they are', async () => {
    const { courseCardChecks } = await checksWith(() => ({}));
    const results = courseCardChecks(300);
    expect(results.length).toBeGreaterThanOrEqual(7);
    expect(results.filter((c) => !c.pass), results.map((c) => `${c.name}: ${c.detail}`).join('\n')).toEqual([]);
  }, 60_000);

  it('fail the contest check when the leaderboard stops decaying', async () => {
    // Without the decay every hour of a night is worth the first, so 8 hours earn the same on four nights or on two.
    const failing = await failingUnder((real) => ({ rankGain: (hours: number, S: number) => real.RANK_FIRST * S * hours }));
    expect(failing).toEqual(['contest: 2 hours every night beats 4 hours on the last two']);
  }, 60_000);

  it('fail the late-start check when the debugging time is fixed at 1 hour', async () => {
    const failing = await failingUnder(() => ({ debugHoursFor: () => 1 }));
    expect(failing).toContain('assignments: starting the night before often does');
  }, 60_000);

  it('fail the assignment checks when a missed assignment costs the final exam nothing', async () => {
    const failing = await failingUnder(() => ({ HOMEWORK_MISS_PENALTY: 0 }));
    expect(failing).toContain('assignments: handing them in beats ignoring them (skill 0.2)');
    expect(failing).toContain('assignments: handing them in beats ignoring them (skill 0.5)');
  }, 60_000);
});
