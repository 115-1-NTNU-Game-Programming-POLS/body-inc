import { afterEach, describe, expect, it, vi } from 'vitest';

type Checks = typeof import('../../sim/semester/checks.ts');
type Courses = typeof import('../../src/core/semester/courses.ts');
type Broken = { [K in keyof Courses]?: unknown };
type Clauses = typeof import('../../src/core/semester/clauses.ts');

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

/** The same under `broken` laid over the clause rules, which `withClause` and the credit cap are read from. */
async function failingUnderClauses(broken: (real: Clauses) => Partial<Clauses>): Promise<string[]> {
  vi.resetModules();
  vi.doMock('../../src/core/semester/clauses.ts', async (importOriginal) => {
    const real = await importOriginal<Clauses>();
    return { ...real, ...broken(real) };
  });
  const { courseCardChecks } = await import('../../sim/semester/checks.ts');
  return courseCardChecks(100).filter((c) => !c.pass).map((c) => c.name);
}

afterEach(() => {
  vi.doUnmock('../../src/core/semester/courses.ts');
  vi.doUnmock('../../src/core/semester/clauses.ts');
  vi.resetModules();
});

describe('the course card checks of design doc 9.6 (issue 45)', () => {
  it('hold for the cards as they are', async () => {
    const { courseCardChecks } = await checksWith(() => ({}));
    const results = courseCardChecks(300);
    expect(results.length).toBeGreaterThanOrEqual(19);
    expect(results.filter((c) => !c.pass), results.map((c) => `${c.name}: ${c.detail}`).join('\n')).toEqual([]);
  }, 120_000);

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

  it('fail the grading checks when the papers never open', async () => {
    const failing = await failingUnder(() => ({ gradeDays: () => ({ from: 99, to: 99 }) }));
    expect(failing).toContain('grading: grading by day on the weekend hands the grades in');
    expect(failing).toContain('grading: grading all in one night hands the grades in too');
  }, 60_000);

  it('fail the skipping check when the papers need no hours', async () => {
    // With nothing to grade every semester has its grades in, the one that skips included.
    const failing = await failingUnder(() => ({ GRADE_HOURS: 0 }));
    expect(failing).toContain('grading: skipping the papers leaves the grades unhanded');
  }, 60_000);

  it('fail the night checks when a night has no room to stay up', async () => {
    const failing = await failingUnder(() => ({ nightRoom: () => 0 }));
    expect(failing).toContain('grading: grading all in one night hands the grades in too');
    expect(failing).toContain('grading: the all-nighter costs the night\'s sleep');
  }, 60_000);

  it('fail the study cost check when sleep files all of the day\'s study whatever its length', async () => {
    const failing = await failingUnder(() => ({ archiveRate: () => 1 }));
    expect(failing).toContain('grading: the all-nighter costs more study than grading by day');
  }, 60_000);

  it('fail both cost checks when a clause changes nothing', async () => {
    const failing = await failingUnderClauses(() => ({ withClause: (ctx: unknown) => ctx as never }));
    expect(failing).toContain('clauses: level 1 makes the final harder');
    expect(failing).toContain('clauses: the setting card of level 2 costs study');
  }, 60_000);

  it('fail the final check alone when level 1 leaves the final threshold where it was', async () => {
    const failing = await failingUnderClauses((real) => ({ withClause: (ctx, seed, level) => ({ ...real.withClause(ctx, seed, level), finMult: 1 }) }));
    expect(failing).toContain('clauses: level 1 makes the final harder');
    expect(failing).not.toContain('clauses: the setting card of level 2 costs study');
  }, 60_000);

  it('fail the setting card check alone when level 2 draws no card', async () => {
    const failing = await failingUnderClauses((real) => ({
      withClause: (ctx, seed, level) => {
        const { setting: _drawn, ...rest } = real.withClause(ctx, seed, level);
        return rest;
      },
    }));
    expect(failing).toContain('clauses: the setting card of level 2 costs study');
    expect(failing).not.toContain('clauses: level 1 makes the final harder');
  }, 60_000);

  it('fail the stacking check when level 2 lets the heaviest selection stand', async () => {
    // The cap reads the base credits when the module loads, so a base that is the top limit lets every selection through.
    const failing = await failingUnder(() => ({ BASE_CREDITS: 22 }));
    expect(failing).toContain('clauses: the responsive player passes every selection level 2 lets stand');
  }, 60_000);
});
