import { describe, expect, it } from 'vitest';
import { readingPrompt } from '../../src/app/semester.ts';
import { playDay, startSemester, type DayView, type PatrolResult, type SemesterState, type Strategy } from '../../src/core/index.ts';
import { BLOOD_TEST_DAYS } from '../../src/core/semester/scenario.ts';
import { contextFor, EVENTS, scenarioFor } from '../../sim/semester/scenario.ts';

/**
 * The three readings of the liver's exact load in the semester (design doc 8.6): the start-of-term
 * checkup on day 1, the health office's blood test once a semester for an afternoon, and the
 * highlighter lit on the liver in its patrol.
 */

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

/**
 * No coffee, no rest, bed at 22:00; `test` decides the blood test, every other event takes its first option. `patrol` is the floor
 * and, when given, how its rooms were played.
 */
const player = (test: 'go' | 'decline', seen: DayView[] = [], patrol: { floor: 'brain' | 'liver'; played?: PatrolResult } = { floor: 'brain' }): Strategy => ({
  plan: (view) => {
    seen.push(view);
    return { coffee: [], rest: [] };
  },
  choose: (id, options, view) => {
    seen.push(view);
    return id === 'blood_test' ? test : options[0]!;
  },
  floor: (view) => {
    seen.push(view);
    return { patrol: patrol.floor, ...(patrol.played ? { played: [patrol.played] } : {}) };
  },
  night: (view) => {
    seen.push(view);
    return { bed: 22, nextWake: 7, lateNight: 'rest' };
  },
});

/** A semester on the morning of `day` whose liver already carries `load`, with `events` that day and nothing else. */
function on(day: number, load: number, events: string[] = []): { s: SemesterState; ctx: ReturnType<typeof contextFor> } {
  const ctx = contextFor(0.5, 1, { scenario: events.length > 0 ? { [day]: events } : {} });
  const s = startSemester(ctx, 1);
  return { s: { ...s, day, loads: { ...s.loads, liver: load } }, ctx };
}
const last = (s: SemesterState) => s.history[s.history.length - 1]!;

describe('the blood test (design doc 8.6)', () => {
  it('comes once a semester, on a school day off the exams and past the first two days', () => {
    const days = new Set<number>();
    for (const seed of SEEDS) {
      const at = Object.entries(scenarioFor(seed)).filter(([, ids]) => ids.includes('blood_test')).map(([d]) => Number(d));
      expect(at, `seed ${seed}`).toHaveLength(1);
      days.add(at[0]!);
    }
    expect([...days].sort()).toEqual([...BLOOD_TEST_DAYS]);
    const k = contextFor(0.5, 1).params;
    for (const d of BLOOD_TEST_DAYS) {
      expect(d === k.midDay || d === k.finDay || k.weekend.includes(d) || d < 3, `day ${d}`).toBe(false);
    }
  });

  // The snapshot was recorded with the blood test's draw taken out of scenarioFor, so it holds the schedule from before it.
  it('is drawn after every other event, so their days are what they were', () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const without = Object.fromEntries(Object.entries(scenarioFor(seed))
        .map(([d, ids]) => [d, ids.filter((id) => id !== 'blood_test')]).filter(([, ids]) => (ids as string[]).length > 0));
      expect(without, `seed ${seed}`).toMatchSnapshot();
    }
  });

  it('going reads the liver load into the day and every view after it, and costs two free hours', () => {
    const { s, ctx } = on(3, 47.5, ['blood_test']);
    const seen: DayView[] = [];
    const went = playDay(s, ctx, player('go', seen));
    const stayed = playDay(s, ctx, player('decline'));
    expect(last(went).events).toEqual([{ id: 'blood_test', option: 'go' }]);
    expect(last(went).liverReading).toEqual({ load: 47.5, by: 'blood_test' });
    // The plan of the morning came before it, the night after it.
    expect(seen[0]!.liverReading).toBeUndefined();
    expect(seen[seen.length - 1]!.liverReading).toEqual({ day: 3, load: 47.5, by: 'blood_test' });
    expect(last(stayed).liverReading).toBeUndefined();
    expect(last(went).studyHours).toBe(last(stayed).studyHours - 2);

    // The next morning still shows the day-3 reading, not the load the night moved it to.
    const next: DayView[] = [];
    playDay(went, { ...ctx, scenario: {} }, player('decline', next));
    expect(went.loads.liver).not.toBe(47.5);
    expect(next[0]!.liverReading).toEqual({ day: 3, load: 47.5, by: 'blood_test' });
  });

  it('declining leaves no load anywhere a player can see', () => {
    const { s, ctx } = on(3, 47.5, ['blood_test']);
    const seen: DayView[] = [];
    playDay(s, ctx, player('decline', seen));
    for (const v of seen) {
      expect(v.liverReading).toBeUndefined();
      expect(JSON.stringify(v)).not.toContain('47.5');
    }
  });

  it('has a card to stay and one to go, and staying changes nothing', () => {
    const ev = EVENTS.find((e) => e.id === 'blood_test')!;
    expect(Object.keys(ev.options)).toEqual(['decline', 'go']);
    expect(ev.options['decline']).toEqual({});
  });
});

describe('the start-of-term checkup (design doc 8.6)', () => {
  it('reads the starting load on the morning of day 1, before the plan, and not on any later morning', () => {
    const { s, ctx } = on(1, 20);
    const seen: DayView[] = [];
    const after = playDay(s, ctx, player('decline', seen));
    expect(seen[0]!.liverReading).toEqual({ day: 1, load: 20, by: 'checkup' });
    expect(last(after).liverReading).toEqual({ load: 20, by: 'checkup' });
    const day3 = on(3, 20);
    const later: DayView[] = [];
    expect(last(playDay(day3.s, day3.ctx, player('decline', later))).liverReading).toBeUndefined();
    expect(later[0]!.liverReading).toBeUndefined();
  });

  it('gives way to a later reading, which is the one the views carry', () => {
    const { s, ctx } = on(1, 20);
    let state = playDay(s, ctx, player('decline'));
    state = { ...state, loads: { ...state.loads, liver: 33 } };
    const seen: DayView[] = [];
    playDay(state, { ...ctx, scenario: { 2: ['blood_test'] } }, player('go', seen));
    expect(seen[0]!.liverReading).toEqual({ day: 1, load: 20, by: 'checkup' });
    expect(seen[seen.length - 1]!.liverReading).toEqual({ day: 2, load: 33, by: 'blood_test' });
  });
});

describe('the highlighter in the liver patrol (design doc 8.6)', () => {
  it('a patrol that lit the liver reads the morning load into the day and the night after it', () => {
    const { s, ctx } = on(3, 61);
    const seen: DayView[] = [];
    const after = playDay(s, ctx, player('decline', seen, { floor: 'liver', played: { grade: 'B', liverRead: true } }));
    expect(last(after).liverReading).toEqual({ load: 61, by: 'highlighter' });
    expect(seen[seen.length - 1]!.liverReading).toEqual({ day: 3, load: 61, by: 'highlighter' });
    // The floor was asked before the patrol was played, so its view had not read it yet.
    expect(seen.filter((v) => v.liverReading === undefined).length).toBeGreaterThan(0);
  });

  it('a failed patrol keeps what it saw; one that never lit the liver reads nothing', () => {
    const { s, ctx } = on(3, 61);
    expect(last(playDay(s, ctx, player('decline', [], { floor: 'liver', played: { failed: true, liverRead: true } }))).liverReading)
      .toEqual({ load: 61, by: 'highlighter' });
    expect(last(playDay(s, ctx, player('decline', [], { floor: 'liver', played: { grade: 'S' } }))).liverReading).toBeUndefined();
  });

  it('refuses a liver reading from the patrol of another floor', () => {
    const { s, ctx } = on(3, 61);
    expect(() => playDay(s, ctx, player('decline', [], { floor: 'brain', played: { grade: 'B', liverRead: true } }))).toThrow(/brain/);
  });

  it('hands the strategy the load only as the figure for the patrol, never in the view', () => {
    const { s, ctx } = on(3, 61.25);
    const loads: number[] = [];
    const seen: DayView[] = [];
    playDay(s, ctx, { ...player('decline', seen), floor: (view, _tags, liverLoad) => { seen.push(view); loads.push(liverLoad); return { patrol: 'brain' }; } });
    expect(loads).toEqual([61.25]);
    for (const v of seen) expect(JSON.stringify(v)).not.toContain('61.25');
  });
});

describe('the report card of a reading', () => {
  it('reads against the red line, in the band the elevator would light it at, titled by what read it', () => {
    const at = (load: number, by: 'checkup' | 'blood_test' = 'blood_test') => readingPrompt({ load, by });
    expect(at(12.4).title).toBe('抽血結果：肝的負荷 12（紅線 85）');
    expect(at(20, 'checkup').title).toBe('開學健檢：肝的負荷 20（紅線 85）');
    expect(at(39.9).caption).toContain('在正常範圍');
    expect(at(40).caption).toContain('有點高');
    expect(at(60).caption).toContain('很高');
    expect(at(85).caption).toContain('到了紅線');
    for (const load of [0, 50, 90]) expect(at(load).caption).toContain('只有抽血才看得到');
    expect(at(0).options).toHaveLength(1);
  });
});
