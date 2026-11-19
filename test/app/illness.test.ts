import { describe, expect, it } from 'vitest';
import { str } from '../../src/app/content.ts';
import { daySummary, newSemester } from '../../src/app/semester.ts';
import { playDay, type SemesterContext, type SemesterState, type Strategy } from '../../src/core/index.ts';

const night = (bed: number): Strategy => ({
  plan: () => ({ coffee: [], rest: [] }),
  choose: (_id, options) => options[0]!,
  floor: () => ({ patrol: 'brain' }),
  night: () => ({ bed, nextWake: 7, lateNight: 'rest' }),
});
const ILL = ['throat', 'cold', 'fever', 'well', 'stopped'].map((k) => `semester.sum.ill.${k}`);

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

  it('says nothing about a cold when none was caught', () => {
    expect(told(0, [night(26), night(26), night(22)])).toEqual([[], [], []]);
  });
});
