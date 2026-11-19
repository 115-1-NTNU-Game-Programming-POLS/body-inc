import { afterEach, describe, expect, it, vi } from 'vitest';

type Burden = typeof import('../../sim/semester/burden.ts');
type Courses = typeof import('../../src/core/semester/courses.ts');

/** Two light selections and two heavy ones (16 credits, which takes the cards not open yet): the classes the rail compares. */
const SELECTIONS = [
  ['algorithms', 'os', 'database', 'ta'],
  ['algorithms', 'os', 'compiler', 'ta'],
  ['algorithms', 'os', 'database', 'compiler', 'software'],
  ['algorithms', 'os', 'software', 'networks', 'compiler', 'ta'],
];
const N = 10;

/** The rail with `broken` laid over the course constants, loaded fresh so the rules see the change. */
async function railWith(broken: (real: Courses) => Partial<Courses> = () => ({})): Promise<Burden> {
  vi.resetModules();
  vi.doMock('../../src/core/semester/courses.ts', async (importOriginal) => {
    const real = await importOriginal<Courses>();
    return { ...real, ...broken(real) };
  });
  return import('../../sim/semester/burden.ts');
}

async function failing(broken?: (real: Courses) => Partial<Courses>, params: Record<string, number> = {}): Promise<string[]> {
  const b = await railWith(broken);
  const all = b.candidates();
  const players = { responsive: all.responsive!, owl: all.owl!, crammer: all.crammer!, drinkerFed: all.drinkerFed! };
  return b.burdenChecks(b.burdenRows(N, 0.5, SELECTIONS, players, params)).filter((c) => !c.pass).map((c) => c.name);
}

afterEach(() => {
  vi.doUnmock('../../src/core/semester/courses.ts');
  vi.resetModules();
});

describe('the burden guard rail of design doc 8.3', () => {
  it('holds for the rules as they are', async () => {
    expect(await failing()).toEqual([]);
  }, 120_000);

  it('fails the first criterion when a heavy burden earns no more than a light one', async () => {
    const flat = (): Partial<Courses> => ({ BURDEN_REWARD: { light: 1, standard: 1, heavy: 1, full: 1 } });
    expect(await failing(flat)).toEqual(['burden: the responsive player earns more points with a heavy burden than with a light one']);
  }, 120_000);

  it('fails the hospital half of the second when no one catches a cold', async () => {
    expect(await failing(undefined, { campusExposure: 0 })).toEqual(['burden: the night owl with a heavy burden is in hospital clearly more often']);
  }, 120_000);

  it('fails the third when short sleep stops costing, because a late studier then earns the most', async () => {
    const b = await railWith();
    const players = { responsive: b.candidates().responsive!, owl: b.candidates().owl!, late24: b.lateStudier(24), late24_5: b.lateStudier(24.5) };
    const run = (params: Record<string, number>): string[] =>
      b.burdenChecks(b.burdenRows(N, 0.5, SELECTIONS, players, params)).filter((c) => !c.pass).map((c) => c.name);
    expect(run({})).toEqual([]);
    expect(run({ sleepNeed: 6.5 })).toEqual(['burden: the best strategy of every selection sleeps 7 hours or more']);
  }, 120_000);

  it('reads every legal selection of the full course table', async () => {
    const { allSelections } = await railWith();
    const all = allSelections();
    expect(all.length).toBe(315);
    expect(new Set(all.map((s) => s.join(','))).size).toBe(315);
  });
});

describe('the criteria themselves', () => {
  const row = (burden: 'light' | 'heavy', players: Record<string, [number, number, number]>) => ({
    courses: [burden],
    burden,
    players: Object.fromEntries(Object.entries(players).map(([k, [points, hospital, sleep]]) => [k, { points, hospital, sleep }])),
  });
  const healthy = [
    row('light', { responsive: [90, 0, 8], owl: [10, 30, 4] }),
    row('heavy', { responsive: [110, 0, 7.8], owl: [6, 30, 4] }),
  ];
  const names = async (rows: Parameters<Burden['burdenChecks']>[0]): Promise<string[]> =>
    (await railWith()).burdenChecks(rows).filter((c) => !c.pass).map((c) => c.name.replace(/^burden: /, ''));

  it('pass on rows that meet them', async () => {
    expect(await names(healthy)).toEqual([]);
  });

  it('fail when the heavy owl earns as much as the light responsive player', async () => {
    expect(await names([healthy[0]!, row('heavy', { responsive: [110, 0, 7.8], owl: [95, 30, 4] })]))
      .toEqual(['the night owl with a heavy burden earns fewer points than the responsive player with a light one']);
  });

  it('fail when the owl is in hospital barely more often', async () => {
    expect(await names([healthy[0]!, row('heavy', { responsive: [110, 0, 7.8], owl: [6, 14, 4] })]))
      .toEqual(['the night owl with a heavy burden is in hospital clearly more often']);
  });

  it('fail when the best strategy of some selection sleeps under 7 hours, even by a little', async () => {
    expect(await names([healthy[0]!, row('heavy', { responsive: [110, 0, 6.9], owl: [6, 30, 4] })]))
      .toEqual(['the best strategy of every selection sleeps 7 hours or more']);
    // The best is the one with the most points: a short sleeper that earns less does not count.
    expect(await names([healthy[0]!, row('heavy', { responsive: [110, 0, 7.8], owl: [6, 30, 4], short: [100, 0, 5] })])).toEqual([]);
  });

  it('fail outright when a class is missing', async () => {
    expect(await names([healthy[0]!])).toEqual(['the selections hold a light class and a heavy one']);
  });
});
