import { describe, expect, it } from 'vitest';
import { fillStr } from '../../src/app/content.ts';
import { daySummary, endSummary, newSemester, nightPlan } from '../../src/app/semester.ts';
import { playDay, RANK_FULL, type SemesterState, type Strategy } from '../../src/core/index.ts';

const player = (rank: number): Strategy => ({
  plan: () => ({ coffee: [], rest: [] }),
  choose: (_id, options) => options[0]!,
  floor: () => ({ patrol: 'brain' }),
  night: () => nightPlan('early', 0, rank),
});

const WITH = ['algorithms', 'os', 'database', 'ta'];
const WITHOUT = ['os', 'database', 'networks', 'ta'];

describe('what the player is told about the leaderboard', () => {
  it('lists the hours spent, the score they added and the board so far', () => {
    const { ctx, state } = newSemester(1, [], WITH);
    const before = { ...state, day: 6 };
    const after = playDay(before, ctx, player(2));
    const rec = after.history[0]!.rank!;
    expect(daySummary(before, after, ctx)).toContain(fillStr('semester.sum.rank', { hours: 2, gain: rec.gain.toFixed(1), score: after.rank.toFixed(1) }));
    expect(daySummary(before, playDay(before, ctx, player(0)), ctx).some((l) => l.startsWith('排行榜'))).toBe(false);
  });

  it('closes the semester with the board and its share when the card was taken, and with nothing otherwise', () => {
    const end = (courses: readonly string[]): SemesterState => {
      const { ctx, state } = newSemester(1, [], courses);
      return playDay({ ...state, day: 10, progress: 40, rank: 30 }, ctx, player(0));
    };
    const lines = endSummary(end(WITH), newSemester(1, [], WITH).ctx);
    expect(lines).toContain(fillStr('semester.end.rank', { score: '30.0', full: RANK_FULL, share: 30 }));
    expect(endSummary(end(WITHOUT), newSemester(1, [], WITHOUT).ctx).some((l) => l.startsWith('排行榜'))).toBe(false);
  });

  it('leaves the board out when the final scored 0 whole: a bankrupt semester or a final spent in hospital', () => {
    const { ctx, state } = newSemester(1, [], WITH);
    const done = playDay({ ...state, day: 10, progress: 40, rank: 30 }, ctx, player(0));
    const lines = (s: SemesterState): string[] => endSummary(s, ctx);
    expect(lines(done).some((l) => l.startsWith('排行榜'))).toBe(true);
    expect(lines({ ...done, bankrupt: true }).some((l) => l.startsWith('排行榜'))).toBe(false);
    const hospital = playDay({ ...state, day: 10, progress: 40, rank: 30, hospitalDay: 10 }, ctx, player(0));
    expect(hospital.history.at(-1)!.kind).toBe('hospital');
    expect(lines(hospital).some((l) => l.startsWith('排行榜'))).toBe(false);
  });
});
