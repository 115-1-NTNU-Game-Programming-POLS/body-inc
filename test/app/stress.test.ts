import { describe, expect, it } from 'vitest';
import { fillStr, str } from '../../src/app/content.ts';
import { daySummary, newSemester } from '../../src/app/semester.ts';
import { playDay, type SemesterState, type Strategy } from '../../src/core/index.ts';

const quiet: Strategy = {
  plan: () => ({ coffee: [], rest: [] }),
  choose: (_id, options) => options[0]!,
  floor: () => ({ patrol: 'brain' }),
  night: () => ({ bed: 22, nextWake: 7, lateNight: 'rest' }),
};
const cram: Strategy = { ...quiet, night: () => ({ bed: 26, nextWake: 7, lateNight: 'study' }) };
const calm: Strategy = { ...quiet, plan: () => ({ coffee: [], rest: [8, 9, 10, 11, 13, 14, 15, 16, 17, 19, 20, 21] }) };

describe('what the player is told about stress (design doc 9.1)', () => {
  it('gives the stress after every night, and says when chronic stress begins and when it ends', () => {
    const { ctx, state } = newSemester(1, []);
    let s: SemesterState = state;
    const days: string[][] = [];
    for (const strategy of [cram, cram, cram, cram, calm, calm, calm, calm]) {
      const next = playDay(s, ctx, strategy);
      days.push(daySummary(s, next, ctx));
      s = next;
    }
    s.history.forEach((r, i) => expect(days[i]).toContain(fillStr('semester.sum.stress', { p: Math.round(r.stress!) })));
    const said = (key: string): number[] => days.flatMap((lines, i) => (lines.includes(str(key)) ? [s.history[i]!.day] : []));
    const chronic = s.history.filter((r) => r.chronicStress === true).map((r) => r.day);
    expect(chronic.length).toBeGreaterThan(1);
    expect(said('semester.sum.chronic.on')).toEqual([chronic[0]]);
    expect(said('semester.sum.chronic.off')).toEqual([chronic.at(-1)! + 1]);
  });
});
