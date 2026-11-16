import { describe, expect, it } from 'vitest';
import { bloodTestPrompt } from '../../src/app/semester.ts';
import { playDay, startSemester, type DayView, type SemesterState, type Strategy } from '../../src/core/index.ts';
import { BLOOD_TEST_DAYS } from '../../src/core/semester/scenario.ts';
import { contextFor, EVENTS, scenarioFor } from '../../sim/semester/scenario.ts';

/**
 * The health office's blood test in the semester (design doc 8.6): the one active check that
 * reads the liver's exact load, once a semester, for an afternoon.
 */

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

/** No coffee, no rest, the brain patrol, bed at 22:00; `test` decides the blood test, every other event takes its first option. */
const player = (test: 'go' | 'decline', seen: DayView[] = []): Strategy => ({
  plan: (view) => {
    seen.push(view);
    return { coffee: [], rest: [] };
  },
  choose: (id, options, view) => {
    seen.push(view);
    return id === 'blood_test' ? test : options[0]!;
  },
  floor: () => ({ patrol: 'brain' }),
  night: (view) => {
    seen.push(view);
    return { bed: 22, nextWake: 7, lateNight: 'rest' };
  },
});

/** A semester whose liver already carries `load`, with the blood test on day 3 and nothing else. */
function onDay3(load: number): { s: SemesterState; ctx: ReturnType<typeof contextFor> } {
  const ctx = contextFor(0.5, 1, { scenario: { 3: ['blood_test'] } });
  let s = startSemester(ctx, 1);
  s = { ...s, day: 3, loads: { ...s.loads, liver: load } };
  return { s, ctx };
}

describe('the blood test (design doc 8.6)', () => {
  it('comes once a semester, on a school day off the exams and past the first two days', () => {
    const days = new Set<number>();
    for (const seed of SEEDS) {
      const on = Object.entries(scenarioFor(seed)).filter(([, ids]) => ids.includes('blood_test')).map(([d]) => Number(d));
      expect(on, `seed ${seed}`).toHaveLength(1);
      days.add(on[0]!);
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
    const { s, ctx } = onDay3(47.5);
    const seen: DayView[] = [];
    const went = playDay(s, ctx, player('go', seen));
    const stayed = playDay(s, ctx, player('decline'));
    const day = went.history[went.history.length - 1]!;
    expect(day.events).toEqual([{ id: 'blood_test', option: 'go' }]);
    expect(day.bloodTest).toBe(47.5);
    // The plan of the morning came before it, the night after it.
    expect(seen[0]!.bloodTest).toBeUndefined();
    expect(seen[seen.length - 1]!.bloodTest).toEqual({ day: 3, load: 47.5 });
    expect(stayed.history[stayed.history.length - 1]!.bloodTest).toBeUndefined();
    expect(day.studyHours).toBe(stayed.history[stayed.history.length - 1]!.studyHours - 2);

    // The next morning still shows the day-3 reading, not the load the night moved it to.
    const next: DayView[] = [];
    playDay(went, { ...ctx, scenario: {} }, player('decline', next));
    expect(went.loads.liver).not.toBe(47.5);
    expect(next[0]!.bloodTest).toEqual({ day: 3, load: 47.5 });
  });

  it('declining leaves no load anywhere a player can see', () => {
    const { s, ctx } = onDay3(47.5);
    const seen: DayView[] = [];
    playDay(s, ctx, player('decline', seen));
    for (const v of seen) {
      expect(v.bloodTest).toBeUndefined();
      expect(JSON.stringify(v)).not.toContain('47.5');
    }
  });

  it('has a title and a card for each option, like every event', () => {
    const ev = EVENTS.find((e) => e.id === 'blood_test')!;
    expect(Object.keys(ev.options)).toEqual(['decline', 'go']);
    expect(ev.options['decline']).toEqual({});
  });

  it('reports the reading against the red line, in the band the elevator would light it at', () => {
    const at = (load: number) => bloodTestPrompt({ load });
    expect(at(12.4).title).toBe('抽血結果：肝的負荷 12（紅線 85）');
    expect(at(39.9).caption).toContain('在正常範圍');
    expect(at(40).caption).toContain('有點高');
    expect(at(60).caption).toContain('很高');
    expect(at(85).caption).toContain('到了紅線');
    for (const load of [0, 50, 90]) expect(at(load).caption).toContain('只有抽血才看得到');
    expect(at(0).options).toHaveLength(1);
  });
});
