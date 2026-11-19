import { describe, expect, it } from 'vitest';
import { str } from '../../src/app/content.ts';
import { daySummary, newSemester } from '../../src/app/semester.ts';
import { playDay, record, type SemesterContext, type SemesterState, type Strategy } from '../../src/core/index.ts';
import { ARCHETYPES } from '../../sim/semester/archetypes.ts';

const night = (bed: number): Strategy => ({
  plan: () => ({ coffee: [], rest: [] }),
  choose: (_id, options) => options[0]!,
  floor: () => ({ patrol: 'brain' }),
  night: () => ({ bed, nextWake: 7, lateNight: 'rest' }),
});
const ILL = ['throat', 'cold', 'fever', 'well', 'stopped', 'cured'].map((k) => `semester.sum.ill.${k}`);

/** The illness lines of each day's summary, by their key. */
function told(exposure: number, plan: readonly Strategy[]): string[][] {
  const { ctx: base, state } = newSemester(1, []);
  const ctx: SemesterContext = { ...base, params: { ...base.params, campusExposure: exposure, infBase: 1 } };
  let s: SemesterState = state;
  const days: string[][] = [];
  for (const strategy of plan) {
    const next = playDay(s, ctx, strategy);
    const lines = daySummary(s, next, ctx);
    days.push(ILL.filter((key) => lines.includes(str(key))).map((key) => key.slice('semester.sum.ill.'.length)));
    s = next;
  }
  return days;
}

describe('what the player is told about a cold (design doc 9.1)', () => {
  it('says the host caught it, and each step up the ladder and back down', () => {
    expect(told(1, [night(26), night(26), night(22), night(22)])).toEqual([['throat', 'cold'], ['fever'], [], ['well']]);
  });

  it('says when an early night stopped the sore throat', () => {
    expect(told(1, [night(22)])).toEqual([['throat', 'stopped']]);
  });

  it('says the hospital cured it when a fever ends in the emergency room', () => {
    let found = 0;
    for (let seed = 1; seed <= 40 && found === 0; seed++) {
      const { ctx, state } = newSemester(seed, []);
      let s: SemesterState = state;
      while (s.history.at(-1)?.settled !== false && !s.bankrupt) {
        const next = playDay(s, ctx, ARCHETYPES.nightOwl);
        const r = next.history.at(-1)!;
        if (r.crisis?.fever === true) {
          expect(daySummary(s, next, ctx)).toContain(str('semester.sum.ill.cured'));
          expect(daySummary(s, next, ctx)).not.toContain(str('semester.sum.ill.well'));
          found += 1;
          break;
        }
        s = next;
      }
    }
    expect(found).toBe(1);
  });

  it('says nothing of the cold on the final exam day, which has no night', () => {
    const { ctx: base, state } = newSemester(1, []);
    const ctx: SemesterContext = { ...base, params: { ...base.params, campusExposure: 0 } };
    let s: SemesterState = state;
    while (s.day < ctx.params.days) s = playDay(s, ctx, night(22));
    const [log, node] = record(s.tags.log, { kind: 'rule', key: 'test', at: 0 });
    const ill: SemesterState = { ...s, tags: { ...s.tags, log }, illness: { stage: 'cold', nights: 2, node } };
    const next = playDay(ill, ctx, night(22));
    expect(next.history.at(-1)!.settled).toBe(false);
    const lines = daySummary(ill, next, ctx);
    expect(ILL.filter((key) => lines.includes(str(key)))).toEqual([]);
  });

  it('says nothing about a cold when none was caught', () => {
    expect(told(0, [night(26), night(26), night(22)])).toEqual([[], [], []]);
  });
});
