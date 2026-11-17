import { describe, expect, it } from 'vitest';
import { newSemester, rerollOffer, resumeSemester, settingChoices, TUTORIAL_SEED, workOrderTray } from '../../src/app/semester.ts';
import {
  decode, encode, playDay, RUN, startSemester, welfareOffer, type DayView, type FloorChoice, type SemesterContext, type SemesterState, type Strategy,
} from '../../src/core/index.ts';
import { contextFor } from '../../sim/semester/scenario.ts';

/** The career tree nodes of design doc 8.14 beyond 健檢提前: 工單明細, 多一種開局卡 and 開局重抽. */

const quiet: Strategy = {
  plan: () => ({ coffee: [], rest: [] }),
  choose: (_id, options) => options[0]!,
  floor: () => ({ patrol: 'brain' }),
  night: () => ({ bed: 22, nextWake: 7, lateNight: 'rest' }),
};

describe('工單明細', () => {
  it('lists the day and the cause of each work order under the count, and only the count without it', () => {
    const orders = [{ day: 2, event: 'bbq', option: 'drink' }, { day: 4, event: 'bbq', option: 'binge' }];
    expect(workOrderTray([2, 4])).toBe('肝臟工單匣：本局已送進 2 張工單');
    expect(workOrderTray([2, 4], orders)).toBe('肝臟工單匣：本局已送進 2 張工單\n第 2 天系烤（吃飽再喝）、第 4 天系烤（空腹狂飲）');
    expect(workOrderTray([], [])).toBe('肝臟工單匣：本局還沒有送進肝的工單');
  });

  it('gets them from the view, one for each order the liver was sent, with the option that sent it', () => {
    const ctx = contextFor(0.5, 1, { scenario: { 2: ['bbq'], 3: ['bbq'] } });
    const drinks: Strategy = { ...quiet, choose: (id, options, v) => (id === 'bbq' ? (v.day === 2 ? 'drink' : 'sober') : options[0]!) };
    const seen: DayView[] = [];
    let s = startSemester(ctx, 1);
    while (s.day <= 4) s = playDay(s, ctx, { ...drinks, floor: (v, t, l) => (seen.push(v), drinks.floor(v, t, l)) });
    expect(s.liverOrders).toEqual([2]);
    expect(s.workOrders).toEqual([{ day: 2, event: 'bbq', option: 'drink' }]);
    expect(seen.at(-1)!.workOrders.map((o) => o.day)).toEqual(seen.at(-1)!.liverClues.orders);
  });
});

describe('多一種開局卡', () => {
  const SEED = 4;

  it('offers both setting cards under a clause that draws one, and nothing otherwise', () => {
    const choices = settingChoices(SEED, undefined, 2, ['two_settings']);
    expect(choices.map((c) => c.id)).toEqual(['shifts', 'lab']);
    expect(choices.map((c) => c.label)).toEqual(['排班表', '實驗課']);
    for (const c of choices) expect(c.note).toContain(`設定卡「${c.label}」`);
    expect(settingChoices(SEED, undefined, 2, [])).toEqual([]);
    expect(settingChoices(SEED, undefined, 1, ['two_settings'])).toEqual([]);
    expect(settingChoices(TUTORIAL_SEED, undefined, 2, ['two_settings'])).toEqual([]);
  });

  it('gives the semester the card picked, on days the seed draws, and its replay from the save the same', () => {
    const dealt = newSemester(SEED, undefined, undefined, 2).ctx.setting!;
    for (const id of ['shifts', 'lab'] as const) {
      const picked = newSemester(SEED, undefined, undefined, 2, ['two_settings'], id).ctx.setting!;
      expect(picked.id).toBe(id);
      if (id === dealt.id) expect(picked).toEqual(dealt);
      const run = { seed: SEED, clause: 2, career: ['two_settings'], setting: id, days: [] };
      expect(resumeSemester(run)!.ctx.setting).toEqual(picked);
    }
  });

  it('refuses a pick without the node, under a clause that draws no card, or of a card that does not exist', () => {
    expect(() => newSemester(SEED, undefined, undefined, 2, [], 'lab')).toThrow(RangeError);
    expect(() => newSemester(SEED, undefined, undefined, 1, ['two_settings'], 'lab')).toThrow(RangeError);
    expect(() => newSemester(SEED, undefined, undefined, 2, ['two_settings'], 'night_shift')).toThrow(RangeError);
    expect(resumeSemester({ seed: SEED, clause: 2, setting: 'lab', days: [] })).toBeUndefined();
  });
});

describe('開局重抽', () => {
  const ctxOf = (reroll: boolean): SemesterContext => ({ ...contextFor(0.5, 1, { scenario: {} }), ...(reroll ? { reroll: true as const } : {}) });
  const offers = (v: DayView) => {
    const req = { salt: v.welfare.salt, day: v.day, floor: 'brain' as const, grade: 'A' as const, held: v.welfare.held, courses: undefined };
    const first = welfareOffer(req);
    return { first, again: welfareOffer({ ...req, instead: first }) };
  };
  /** Patrols the brain for an A every day and takes the first card, from the offer drawn again on the days in `rerolls`. */
  const picker = (rerolls: readonly number[], seen: DayView[] = []): Strategy => ({
    ...quiet,
    floor: (v): FloorChoice => {
      seen.push(v);
      const { first, again } = offers(v);
      const reroll = rerolls.includes(v.day);
      return { patrol: 'brain', played: [{ grade: 'A' }], card: (reroll ? again : first)[0]!, ...(reroll ? { reroll: true as const } : {}) };
    },
  });
  const play = (ctx: SemesterContext, strategy: Strategy, to: number): SemesterState => {
    let s = startSemester(ctx, 1);
    while (s.day <= to) s = playDay(s, ctx, strategy);
    return s;
  };

  it('draws the offer again from the cards the first did not show, the same on every replay', () => {
    const v = { day: 2, welfare: { salt: 7, held: [] } } as unknown as DayView;
    const { first, again } = offers(v);
    expect(again.length).toBe(first.length);
    expect(again.some((c) => first.includes(c))).toBe(false);
    expect(offers(v).again).toEqual(again);
  });

  it('lets a semester with the node take a card from the offer drawn again, once', () => {
    const seen: DayView[] = [];
    const s = play(ctxOf(true), picker([1], seen), 3);
    expect(s.history.map((r) => r.rerolled === true)).toEqual([true, false, false]);
    expect(s.history[0]!.card).toBe(offers(seen[0]!).again[0]);
    expect(seen.map((v) => v.welfare.rerolled)).toEqual([false, true, true]);
    expect(() => play(ctxOf(true), picker([1, 2]), 3)).toThrow(/drawn an offer again already/);
  });

  it('is not offered when the cards left cannot fill a whole offer, and such a pick is refused', () => {
    // The liver's pool is the four general cards: an A shows three and leaves one.
    const liver: Strategy = { ...quiet, floor: (v) => {
      const req = { salt: v.welfare.salt, day: v.day, floor: 'liver' as const, grade: 'A' as const, held: v.welfare.held, courses: undefined };
      const first = welfareOffer(req);
      const again = welfareOffer({ ...req, instead: first });
      expect([first.length, again.length]).toEqual([3, 1]);
      expect(rerollOffer(v, ctxOf(true), 'liver', { grade: 'A' }, first)).toEqual([]);
      return { patrol: 'liver', played: [{ grade: 'A' }], card: again[0]!, reroll: true };
    } };
    expect(() => play(ctxOf(true), liver, 1)).toThrow(/only 1 cards are left/);
  });

  it('refuses the offer drawn again without the node, or without a card picked from it', () => {
    expect(() => play(ctxOf(false), picker([1]), 1)).toThrow(/開局重抽/);
    const noCard: Strategy = { ...quiet, floor: () => ({ patrol: 'brain', played: [{ grade: 'A' }], reroll: true }) };
    expect(() => play(ctxOf(true), noCard, 1)).toThrow(/card picked/);
  });

  it('is given to a semester begun with the node, never to the scripted first week', () => {
    expect(newSemester(4, undefined, undefined, 0, ['reroll']).ctx.reroll).toBe(true);
    expect(newSemester(4).ctx.reroll).toBeUndefined();
    expect(newSemester(TUTORIAL_SEED, undefined, undefined, 0, ['reroll']).ctx.reroll).toBeUndefined();
  });
});

describe('the run slot', () => {
  it('keeps the setting card picked and the offer drawn again, and reads a version 11 run as having neither', () => {
    const run = {
      semester: { seed: 4, clause: 2, career: ['two_settings', 'reroll'], setting: 'lab', days: [[{ kind: 'floor' as const, choice: { patrol: 'brain' as const, card: 'minutes', reroll: true as const } }]] },
    };
    expect(decode(RUN, encode(RUN, run))).toEqual({ kind: 'ok', data: run });
    const v11 = JSON.stringify({ schema: 11, data: { semester: { seed: 4, days: [] } } });
    expect(decode(RUN, v11)).toEqual({ kind: 'migrated', from: 11, data: { semester: { seed: 4, days: [] } } });
  });
});
