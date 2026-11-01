import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BASE_PERKS, decode, EMPTY_LOADS, encode, EARLY_SLEEP_GAUGE, EARLY_SLEEP_HOURS, GRADES, isWelfare, minutesProgress, OFFER_SIZE, patrolKit, perksOf, playDay, RUN, startSemester, STOP_GAUGE,
  WELFARE_CARDS, welfareOffer,
  type DayView, type FloorChoice, type NightPlan, type SemesterContext, type SemesterState, type Strategy,
} from '../../src/core/index.ts';
import { contextFor } from '../../sim/semester/scenario.ts';

const ctx: SemesterContext = contextFor(0.5, 1, { scenario: {} });
const osCtx: SemesterContext = contextFor(0.5, 1, { scenario: {}, courses: ['os', 'database', 'networks', 'software'] });
const algoCtx: SemesterContext = contextFor(0.5, 1, { scenario: {}, courses: ['algorithms', 'database', 'networks', 'software'] });

/** A strategy that does nothing but the floor and the night asked for, and keeps the views the floor question was put with. */
function day(choice: FloorChoice, night: Partial<NightPlan> = {}, plan: { write?: number } = {}, seen: DayView[] = []): Strategy {
  return {
    plan: () => ({ coffee: [], rest: [], ...plan }),
    choose: (_id, options) => options[0]!,
    floor: (view) => {
      seen.push(view);
      return choice;
    },
    night: () => ({ bed: 22.5, nextWake: 7, lateNight: 'rest', ...night }),
  };
}
const from = (c: SemesterContext, d: number, extra: Partial<SemesterState> = {}): SemesterState => ({ ...startSemester(c, 1), day: d, ...extra });

describe('the welfare cards (design doc 8.8)', () => {
  it('are the eight the rooms and the semester can carry out, each with its words', () => {
    expect(WELFARE_CARDS.map((c) => c.id).sort()).toEqual(['bind_master', 'early_sleep', 'early_start', 'fast_return', 'know_when_to_stop', 'minutes', 'quick_bind', 'recycle']);
    const strings = JSON.parse(readFileSync('content/strings/zh-TW.json', 'utf8')).strings as Record<string, { text: string }>;
    for (const { id } of WELFARE_CARDS) {
      expect(strings[`welfare.${id}.name`]?.text, id).toBeTruthy();
      expect(strings[`welfare.${id}.effect`]?.text, id).toBeTruthy();
    }
    expect(isWelfare('minutes')).toBe(true);
    expect(isWelfare('nope')).toBe(false);
  });

  it('change the fight only through the perks of the cards held', () => {
    expect(perksOf([])).toEqual(BASE_PERKS);
    expect(perksOf(['quick_bind'])).toEqual({ ...BASE_PERKS, bindHits: 2 });
    expect(perksOf(['bind_master'])).toEqual({ ...BASE_PERKS, bindSplash: 1 });
    expect(perksOf(['recycle'])).toEqual({ ...BASE_PERKS, parryBind: 2 });
    expect(perksOf(['fast_return'])).toEqual({ ...BASE_PERKS, parryBoost: true });
    expect(perksOf(['early_sleep', 'minutes', 'early_start', 'know_when_to_stop'])).toEqual(BASE_PERKS);
    expect(perksOf(['quick_bind', 'recycle', 'fast_return', 'bind_master'])).toEqual({ bindHits: 2, bindSplash: 1, parryBind: 2, parryBoost: true });
  });
});

describe('the offer of a rated patrol', () => {
  const offer = (grade: (typeof GRADES)[number], extra: Partial<Parameters<typeof welfareOffer>[0]> = {}) =>
    welfareOffer({ salt: 12345, day: 3, floor: 'brain', grade, held: [], courses: undefined, ...extra });

  it('is one card for C, two for B and three for A and S, never repeating one', () => {
    expect(GRADES.map((g) => offer(g).length)).toEqual([1, 2, 3, 3]);
    expect(OFFER_SIZE).toEqual({ C: 1, B: 2, A: 3, S: 3 });
    for (let salt = 0; salt < 40; salt++) {
      const cards = offer('S', { salt });
      expect(new Set(cards).size).toBe(cards.length);
    }
  });

  it('is the same on every replay and changes with the day and the run', () => {
    expect(offer('A')).toEqual(offer('A'));
    const seen = new Set<string>();
    for (let salt = 0; salt < 60; salt++) seen.add(offer('A', { salt }).join());
    expect(seen.size).toBeGreaterThan(5);
    const days = new Set<string>();
    for (let d = 1; d < 30; d++) days.add(offer('A', { day: d }).join());
    expect(days.size).toBeGreaterThan(3);
  });

  it('holds back what is held, what needs a course the semester did not take, and what another floor gives', () => {
    const all = (extra: Partial<Parameters<typeof welfareOffer>[0]>) => {
      const found = new Set<string>();
      for (let salt = 0; salt < 80; salt++) offer('S', { salt, ...extra }).forEach((c) => found.add(c));
      return found;
    };
    expect(all({}).has('early_start')).toBe(false);
    expect(all({}).has('know_when_to_stop')).toBe(false);
    expect(all({ courses: ['os'] }).has('early_start')).toBe(true);
    expect(all({ courses: ['os'] }).has('know_when_to_stop')).toBe(false);
    expect(all({ courses: ['algorithms'] }).has('know_when_to_stop')).toBe(true);
    expect(all({ held: ['minutes'] }).has('minutes')).toBe(false);
    // The liver gives the general affairs office's cards and none of the brain's.
    expect([...all({ floor: 'liver', courses: ['os', 'algorithms'] })].sort()).toEqual(['bind_master', 'fast_return', 'quick_bind', 'recycle']);
    expect(all({ floor: 'immune' }).has('minutes')).toBe(false);
  });

  it('runs out: a pool of two offers two, and nothing is offered once every card is held', () => {
    const pool = WELFARE_CARDS.filter((c) => c.course === undefined).map((c) => c.id);
    expect(offer('S', { held: pool.slice(2) })).toHaveLength(2);
    expect(offer('S', { held: pool })).toEqual([]);
  });

  it('refuses a rating that does not exist', () => {
    expect(() => offer('Z' as 'S')).toThrow(/not a rating/);
  });
});

describe('what a patrol starts with', () => {
  it('gives 早睡獎金 its gauge only after a night of at least 7.5 good hours', () => {
    expect(patrolKit(['early_sleep'], { slept: EARLY_SLEEP_HOURS, stopped: false }).gauge).toBe(EARLY_SLEEP_GAUGE);
    expect(patrolKit(['early_sleep'], { slept: EARLY_SLEEP_HOURS - 0.01, stopped: false }).gauge).toBe(0);
    expect(patrolKit(['early_sleep'], undefined).gauge).toBe(0);
    expect(patrolKit([], { slept: 9, stopped: true }).gauge).toBe(0);
  });

  it('gives 知所進退 its gauge only after a contest night left in time, and the larger one when both apply', () => {
    expect(patrolKit(['know_when_to_stop'], { slept: 5, stopped: true }).gauge).toBe(STOP_GAUGE);
    expect(patrolKit(['know_when_to_stop'], { slept: 5, stopped: false }).gauge).toBe(0);
    expect(patrolKit(['early_sleep', 'know_when_to_stop'], { slept: 8, stopped: true }).gauge).toBe(EARLY_SLEEP_GAUGE);
  });

  it('carries the perks of the cards held', () => {
    expect(patrolKit(['fast_return'], undefined).perks.parryBoost).toBe(true);
  });

  it('turns every third perfect dodge into half a point of progress with 會議紀錄, and nothing without it', () => {
    expect([0, 2, 3, 5, 6, 10].map((n) => minutesProgress(['minutes'], n))).toEqual([0, 0, 0.5, 0.5, 1, 1.5]);
    expect(minutesProgress([], 12)).toBe(0);
  });
});

describe('a welfare card in the semester', () => {
  /** A run salt for which `id` is among what a brain patrol rated A offers on day 2. */
  const saltOffering = (id: string, c: SemesterContext = ctx, grade: (typeof GRADES)[number] = 'A'): number => {
    for (let salt = 1; salt < 500; salt++) if (welfareOffer({ salt, day: 2, floor: 'brain', grade, held: [], courses: c.courses }).includes(id)) return salt;
    throw new Error(`no salt offers ${id}`);
  };
  const withSalt = (c: SemesterContext, d: number, salt: number, extra: Partial<SemesterState> = {}): SemesterState => {
    const s = from(c, d, extra);
    return { ...s, rng: { ...s.rng, setting: salt } };
  };

  it('is kept once picked from the offer, and recorded on the day', () => {
    const s = withSalt(ctx, 2, 77);
    const [first] = welfareOffer({ salt: 77, day: 2, floor: 'brain', grade: 'A', held: [], courses: undefined });
    const after = playDay(s, ctx, day({ patrol: 'brain', played: [{ grade: 'A' }], card: first! }));
    expect(after.welfare).toEqual([first]);
    expect(after.history.at(-1)!.card).toBe(first);
    // No pick leaves the state without the field, so a semester played without cards is the one it always was.
    expect(playDay(s, ctx, day({ patrol: 'brain', played: [{ grade: 'A' }] })).welfare).toBeUndefined();
  });

  it('refuses a card the patrol did not offer, one already held, and a pick after a failed or unplayed patrol', () => {
    const s = withSalt(ctx, 2, 77);
    const offered = welfareOffer({ salt: 77, day: 2, floor: 'brain', grade: 'A', held: [], courses: undefined });
    const other = WELFARE_CARDS.find((c) => c.course === undefined && !offered.includes(c.id))!.id;
    expect(() => playDay(s, ctx, day({ patrol: 'brain', played: [{ grade: 'A' }], card: other }))).toThrow(/not among the cards/);
    expect(() => playDay(s, ctx, day({ patrol: 'brain', played: [{ grade: 'C' }], card: offered[1]! }))).toThrow(/not among the cards/);
    expect(() => playDay({ ...s, welfare: [offered[0]!] }, ctx, day({ patrol: 'brain', played: [{ grade: 'A' }], card: offered[0]! }))).toThrow(/not among the cards/);
    expect(() => playDay(s, ctx, day({ patrol: 'brain', played: [{ failed: true }], card: offered[0]! }))).toThrow(/not failed/);
    expect(() => playDay(s, ctx, day({ patrol: 'brain', card: offered[0]! }))).toThrow(/not failed/);
    expect(() => playDay(s, ctx, day({ patrol: 'gut', played: [null], card: offered[0]! }))).toThrow(/not failed/);
  });

  it('is offered by the first patrol only: a rated overtime patrol after a floor with no rooms gives none', () => {
    const s = withSalt(ctx, 2, 77);
    const offered = welfareOffer({ salt: 77, day: 2, floor: 'brain', grade: 'S', held: [], courses: undefined });
    expect(() => playDay(s, ctx, day({ patrol: 'gut', overtime: 'brain', played: [null, { grade: 'S' }], card: offered[0]! }))).toThrow(/not failed/);
    const after = playDay(s, ctx, day({ patrol: 'brain', overtime: 'liver', played: [{ grade: 'S' }, { grade: 'S' }], card: offered[0]! }));
    expect(after.welfare).toEqual([offered[0]]);
    expect(after.history.at(-1)!.patrols.map((p) => p.overtime)).toEqual([false, true]);
  });

  describe('會議紀錄', () => {
    const baseline = (s: SemesterState, choice: FloorChoice) => playDay(s, ctx, day(choice));

    it('pays half a point of progress for every third perfect dodge of a patrol played with it held', () => {
      const s = withSalt(ctx, 2, 5, { welfare: ['minutes'] });
      const plain = baseline(withSalt(ctx, 2, 5), { patrol: 'brain', played: [{ grade: 'A', records: 9 }] });
      const paid = playDay(s, ctx, day({ patrol: 'brain', played: [{ grade: 'A', records: 9 }] }));
      expect(paid.progress - plain.progress).toBeCloseTo(1.5, 10);
      expect(paid.history.at(-1)!.minutes).toBe(1.5);
      expect(plain.history.at(-1)!.minutes).toBeUndefined();
    });

    it('pays nothing for a failed patrol, and nothing below three records', () => {
      const s = withSalt(ctx, 2, 5, { welfare: ['minutes'] });
      const plain = baseline(withSalt(ctx, 2, 5), { patrol: 'brain', played: [{ grade: 'A' }] });
      expect(playDay(s, ctx, day({ patrol: 'brain', played: [{ grade: 'A', records: 2 }] })).progress).toBe(plain.progress);
      expect(playDay(s, ctx, day({ patrol: 'brain', played: [{ failed: true }] })).progress).toBe(baseline(withSalt(ctx, 2, 5), { patrol: 'brain', played: [{ failed: true }] }).progress);
    });

    it('does not pay the patrol that gave it, but does pay the overtime one after it', () => {
      const salt = saltOffering('minutes');
      const s = withSalt(ctx, 2, salt);
      const choice = (records1: number, records2: number): FloorChoice => ({
        patrol: 'brain', overtime: 'liver', played: [{ grade: 'A', records: records1 }, { grade: 'B', records: records2 }], card: 'minutes',
      });
      const none = playDay(s, ctx, day(choice(0, 0)));
      expect(playDay(s, ctx, day(choice(9, 0))).progress).toBe(none.progress);
      expect(playDay(s, ctx, day(choice(0, 6))).progress - none.progress).toBeCloseTo(1, 10);
    });

    it('refuses a count of records that cannot be', () => {
      const s = withSalt(ctx, 2, 5);
      for (const records of [-1, 1.5]) {
        expect(() => playDay(s, ctx, day({ patrol: 'brain', played: [{ grade: 'A', records }] }))).toThrow(/records/);
      }
    });
  });

  describe('the night before a patrol', () => {
    it('records the sleep it gave, and 早睡獎金 turns a long one into a full gauge next day', () => {
      const seen: DayView[] = [];
      const night1 = playDay(from(ctx, 2, { welfare: ['early_sleep'] }), ctx, day({ patrol: 'brain' }));
      const slept = night1.history.at(-1)!.slept!;
      expect(slept).toBeGreaterThanOrEqual(EARLY_SLEEP_HOURS);
      playDay(night1, ctx, day({ patrol: 'brain' }, {}, {}, seen));
      expect(seen[0]!.welfare.kit.gauge).toBe(EARLY_SLEEP_GAUGE);
      expect(seen[0]!.welfare.held).toEqual(['early_sleep']);
    });

    it('gives a short night no bonus, and the card nobody holds gives none either', () => {
      const late = playDay(from(ctx, 2, { welfare: ['early_sleep'] }), ctx, day({ patrol: 'brain' }, { bed: 26 }));
      expect(late.history.at(-1)!.slept!).toBeLessThan(EARLY_SLEEP_HOURS);
      const seen: DayView[] = [];
      playDay(late, ctx, day({ patrol: 'brain' }, {}, {}, seen));
      expect(seen[0]!.welfare.kit.gauge).toBe(0);
      const without = playDay(from(ctx, 2), ctx, day({ patrol: 'brain' }));
      playDay(without, ctx, day({ patrol: 'brain' }, {}, {}, seen));
      expect(seen[1]!.welfare.kit.gauge).toBe(0);
    });

    it('counts the first emergency-room night as good sleep, as the debt does', () => {
      // Three floors over the line strike at once, which sends the operator to the emergency room on a night of four hours.
      const loads = { ...EMPTY_LOADS, brain: 95, stomach: 95, immune: 95 };
      const night = playDay(from(ctx, 2, { loads }), ctx, day({ patrol: 'gut' }, { bed: 27 }));
      const rec = night.history.at(-1)!;
      expect(rec.hospitalized).toBe(true);
      expect(rec.slept).toBe(ctx.params.hospitalSleep);
    });
  });

  describe('知所進退', () => {
    // The contest is open on the nights between the midterm and the final, days 6 to 9.
    const contest = (rank: number, bed = 22.5) => playDay(from(algoCtx, 6, { welfare: ['know_when_to_stop'] }), algoCtx, day({ patrol: 'brain' }, { bed, rank }));

    it('marks a contest night that was over by midnight, and only that', () => {
      expect(contest(1).history.at(-1)!.contestStop).toBe(true);
      expect(contest(1).history.at(-1)!.rank).toBeDefined();
      expect(contest(2).history.at(-1)!.contestStop).toBeUndefined();
      expect(contest(0).history.at(-1)!.contestStop).toBeUndefined();
    });

    it('starts the next patrol at 30', () => {
      const seen: DayView[] = [];
      playDay(contest(1), algoCtx, day({ patrol: 'brain' }, {}, {}, seen));
      expect(seen[0]!.welfare.kit.gauge).toBe(STOP_GAUGE);
      playDay(contest(2), algoCtx, day({ patrol: 'brain' }, {}, {}, seen));
      expect(seen[1]!.welfare.kit.gauge).toBe(0);
    });
  });

  describe('提早開工', () => {
    // The first assignment is announced on day 4 and falls due on day 7. Its debugging is fixed at 6 hours, the longest, so a second draw can only shorten it.
    const first = (s: SemesterState): SemesterState => ({ ...s, homework: s.homework.map((a, i) => (i === 0 ? { ...a, debug: 6 } : a)) });
    const started = (d: number, held: readonly string[], salt: number, written = 0) => {
      const s0 = withSalt(osCtx, d, salt, held.length > 0 ? { welfare: held } : {});
      const s = first({ ...s0, homework: s0.homework.map((a, i) => (i === 0 ? { ...a, written } : a)) });
      return playDay(s, osCtx, day({ patrol: 'gut' }, {}, { write: 1 })).homework[0]!;
    };

    it('keeps the shorter of two draws when the writing began two days or more before the due day', () => {
      const debugs = new Set<number>();
      for (let salt = 1; salt < 80; salt++) {
        const a = started(4, ['early_start'], salt);
        expect(a.written).toBe(1);
        expect(a.debug).toBeLessThanOrEqual(6);
        debugs.add(a.debug);
        expect(started(4, [], salt).debug, 'without the card').toBe(6);
      }
      expect(debugs.size).toBeGreaterThan(2);
      expect(Math.min(...debugs)).toBeLessThan(6);
    });

    it('never lengthens the debugging: a draw of one hour stays one hour whatever the second draw is', () => {
      for (let salt = 1; salt < 80; salt++) {
        const s0 = withSalt(osCtx, 4, salt, { welfare: ['early_start'] });
        const s = { ...s0, homework: s0.homework.map((a, i) => (i === 0 ? { ...a, debug: 1 } : a)) };
        expect(playDay(s, osCtx, day({ patrol: 'gut' }, {}, { write: 1 })).homework[0]!.debug, `salt ${salt}`).toBe(1);
      }
    });

    it('does nothing for a late start, or for the second hour of an assignment already begun', () => {
      for (let salt = 1; salt < 40; salt++) {
        expect(started(6, ['early_start'], salt).debug, 'one day before the due day').toBe(6);
        expect(started(4, ['early_start'], salt, 1).debug, 'already begun').toBe(6);
      }
    });
  });
});

describe('the run slot with welfare cards', () => {
  const run = {
    semester: {
      seed: 3,
      days: [[{ kind: 'floor' as const, choice: { patrol: 'brain' as const, played: [{ grade: 'A' as const, records: 4 }], card: 'minutes' } }]],
    },
  };

  it('keeps the card and the records through a save', () => {
    expect(decode(RUN, encode(RUN, run))).toEqual({ kind: 'ok', data: run });
  });

  it('reads a run saved before the cards, which has neither', () => {
    const old = { semester: { seed: 3, days: [[{ kind: 'floor', choice: { patrol: 'brain', played: [{ grade: 'A' }] } }]] } };
    expect(decode(RUN, JSON.stringify({ schema: 8, data: old }))).toEqual({ kind: 'migrated', from: 8, data: old });
  });

  it('refuses a card with no name and a count of records that is not a whole number', () => {
    for (const choice of [{ patrol: 'brain', card: '' }, { patrol: 'brain', played: [{ grade: 'A', records: 1.5 }] }, { patrol: 'brain', played: [{ grade: 'A', records: 'x' }] }]) {
      const data = { semester: { seed: 3, days: [[{ kind: 'floor', choice }]] } };
      expect(decode(RUN, JSON.stringify({ schema: 9, data })).kind, JSON.stringify(choice)).toBe('invalid');
    }
  });
});
