import { describe, expect, it } from 'vitest';
import { fillStr, str } from '../../src/app/content.ts';
import { daySummary, newSemester } from '../../src/app/semester.ts';
import { playDay, type Strategy } from '../../src/core/index.ts';

const player = (bed: number, late: boolean): Strategy => ({
  plan: () => ({ coffee: [], rest: [] }),
  choose: (_id, options) => options[0]!,
  floor: () => ({ patrol: 'brain' }),
  night: () => ({ bed, nextWake: 7, lateNight: late ? 'study' : 'rest' }),
});

const summaryOf = (courses: readonly string[], bed: number, late: boolean): string[] => {
  const { ctx, state } = newSemester(1, [], courses);
  return daySummary(state, playDay(state, ctx, player(bed, late)), ctx);
};

describe('what the player is told about the sleep archive', () => {
  const PAPER = ['database', 'os', 'networks', 'ta'];

  it('names the pile, what it became and the rate, and warns that the rest keeps only half', () => {
    const lines = summaryOf(PAPER, 25, true);
    const line = lines.find((l) => l.startsWith('睡眠歸檔'));
    expect(line).toMatch(/^睡眠歸檔：暫存的 \d+\.\d 點，歸入學業進度 \d+\.\d 點（歸檔率 86%）$/);
    expect(lines).toContain(str('semester.sum.archive.half'));
    expect(fillStr('semester.sum.archive', { staged: '1.0', archived: '0.9', rate: 86 })).toContain('86%');
  });

  it('leaves the warning out after a full night', () => {
    const lines = summaryOf(PAPER, 22.5, false);
    expect(lines.some((l) => l.includes('（歸檔率 100%）'))).toBe(true);
    expect(lines).not.toContain(str('semester.sum.archive.half'));
  });

  it('says nothing about archiving when the courses have no paper exam', () => {
    expect(summaryOf(['compiler', 'software', 'capstone', 'ta'], 25, true).some((l) => l.startsWith('睡眠歸檔'))).toBe(false);
  });
});
