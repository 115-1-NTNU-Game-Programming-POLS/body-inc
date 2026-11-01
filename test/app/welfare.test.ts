import { describe, expect, it } from 'vitest';
import { fillStr, str } from '../../src/app/content.ts';
import { daySummary, floorChoice, kitWith, newSemester, patrolOffer, welfareCaption, welfareText } from '../../src/app/semester.ts';
import { BASE_PERKS, GRADES, playDay, WELFARE_CARDS, welfareOffer, type DayView, type Strategy } from '../../src/core/index.ts';

const player = (choice: ReturnType<typeof floorChoice>, seen: DayView[] = []): Strategy => ({
  plan: () => ({ coffee: [], rest: [] }),
  choose: (_id, options) => options[0]!,
  floor: (view) => {
    seen.push(view);
    return choice;
  },
  night: () => ({ bed: 22.5, nextWake: 7, lateNight: 'rest' }),
});

describe('the welfare cards on the screens', () => {
  it('has a name and an effect line for every card, and a caption that lists the cards held', () => {
    for (const { id } of WELFARE_CARDS) {
      const { label, note } = welfareText(id);
      expect(label.length, id).toBeGreaterThan(0);
      expect(note.length, id).toBeGreaterThan(0);
    }
    expect(welfareCaption([])).toBe(str('semester.welfare.caption.none'));
    expect(welfareCaption(['minutes', 'recycle'])).toBe(fillStr('semester.welfare.caption', { held: '會議紀錄、公文回收' }));
  });

  it('puts the card on the floor answer only when one was picked', () => {
    expect(floorChoice('brain', undefined, [{ grade: 'A' }], 'minutes')).toEqual({ patrol: 'brain', played: [{ grade: 'A' }], card: 'minutes' });
    expect(floorChoice('brain', undefined, [{ grade: 'A' }])).toEqual({ patrol: 'brain', played: [{ grade: 'A' }] });
  });

  it('offers cards for a rated patrol of played rooms and for nothing else', () => {
    const { ctx, state } = newSemester(1, [], undefined);
    const seen: DayView[] = [];
    playDay(state, ctx, player({ patrol: 'brain' }, seen));
    const view = seen[0]!;
    expect(patrolOffer(view, ctx, 'brain', { grade: 'A' })).toHaveLength(3);
    expect(patrolOffer(view, ctx, 'brain', { grade: 'C' })).toHaveLength(1);
    expect(patrolOffer(view, ctx, 'brain', { failed: true })).toEqual([]);
    expect(patrolOffer(view, ctx, 'gut', null)).toEqual([]);
    // What the screen shows is what the rules will accept on the answer.
    for (const grade of GRADES) {
      expect(patrolOffer(view, ctx, 'brain', { grade })).toEqual(welfareOffer({ salt: state.rng.setting, day: state.day, floor: 'brain', grade, held: [], courses: ctx.courses }));
    }
  });

  it('plays a day with the card the screen picked, and tells the player about it after', () => {
    const { ctx, state } = newSemester(1, [], undefined);
    const seen: DayView[] = [];
    playDay(state, ctx, player({ patrol: 'brain' }, seen));
    const offer = patrolOffer(seen[0]!, ctx, 'brain', { grade: 'S' });
    const after = playDay(state, ctx, player(floorChoice('brain', undefined, [{ grade: 'S' }], offer[0])));
    expect(after.welfare).toEqual([offer[0]]);
    expect(daySummary(state, after, ctx)).toContain(fillStr('semester.sum.card', { name: str(`welfare.${offer[0]}.name`) }));
    expect(daySummary(state, playDay(state, ctx, player({ patrol: 'brain' })), ctx).some((l) => l.startsWith('福利卡'))).toBe(false);
  });

  it('shows 會議紀錄 in the summary when it paid', () => {
    const { ctx, state } = newSemester(1, [], undefined);
    const held = { ...state, welfare: ['minutes'] };
    const after = playDay(held, ctx, player({ patrol: 'brain', played: [{ grade: 'A', records: 6 }] }));
    expect(daySummary(held, after, ctx)).toContain(fillStr('semester.sum.minutes', { p: '1.0' }));
  });

  it('gives the overtime patrol the kit the card just picked makes, and the first patrol the one it had', () => {
    const { ctx, state } = newSemester(1, [], undefined);
    const seen: DayView[] = [];
    playDay({ ...state, welfare: ['fast_return'] }, ctx, player({ patrol: 'brain' }, seen));
    const view = seen[0]!;
    expect(view.welfare.kit.perks).toEqual({ ...BASE_PERKS, parryBoost: true });
    expect(kitWith(view, undefined)).toBe(view.welfare.kit);
    expect(kitWith(view, 'quick_bind').perks).toEqual({ ...BASE_PERKS, parryBoost: true, bindHits: 2 });
  });
});
