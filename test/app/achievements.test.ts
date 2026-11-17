import { describe, expect, it } from 'vitest';
import { commendation, finishSemester, hasAchievement, workOrderTray } from '../../src/app/semester.ts';
import { SaveStore } from '../../src/app/storage.ts';
import {
  ACHIEVEMENTS, decode, DEFAULT_HOST, earnedAchievements, encode, playDay, PROGRESS, startSemester,
  type DayRecord, type FloorId, type ProgressData, type SemesterState, type Strategy,
} from '../../src/core/index.ts';
import { contextFor } from '../../sim/semester/scenario.ts';

/** The achievements of design doc 8.14, the first of which is 主動健檢 (design doc 8.6). */

const fresh: ProgressData = { handbook: [], hostName: DEFAULT_HOST, semestersDone: 0 };
const store = (): { saves: SaveStore; data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { saves: new SaveStore({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) }), data };
};

/** First option of every event except the barbecue, where it drinks; patrols `floors[day]` (brain when unset), bed at 22:00. */
const player = (floors: Record<number, FloorId>, overtime: Record<number, FloorId> = {}): Strategy => ({
  plan: () => ({ coffee: [], rest: [] }),
  choose: (id, options) => (id === 'bbq' ? 'drink' : options[0]!),
  floor: (view) => ({ patrol: floors[view.day] ?? 'brain', ...(overtime[view.day] ? { overtime: overtime[view.day]! } : {}) }),
  night: () => ({ bed: 22, nextWake: 7, lateNight: 'rest' }),
});

/** Days 1 to `to` with a barbecue on day 2. */
function days(to: number, strategy: Strategy, bbq: readonly number[] = [2]): SemesterState {
  const ctx = contextFor(0.5, 1, { scenario: Object.fromEntries(bbq.map((d) => [d, ['bbq']])) });
  let s = startSemester(ctx, 1);
  while (s.day <= to) s = playDay(s, ctx, strategy);
  return s;
}

describe('主動健檢 (design doc 8.14)', () => {
  it('is earned by patrolling the liver on the day after a barbecue', () => {
    expect(earnedAchievements(days(3, player({ 3: 'liver' })))).toEqual(['active_checkup']);
  });

  it('counts the overtime patrol as well as the first one', () => {
    expect(earnedAchievements(days(3, player({ 3: 'brain' }, { 3: 'liver' })))).toEqual(['active_checkup']);
  });

  it('is not earned by the liver on the barbecue day itself, two days after, or on a semester without a barbecue', () => {
    expect(earnedAchievements(days(3, player({ 2: 'liver' })))).toEqual([]);
    expect(earnedAchievements(days(4, player({ 4: 'liver' })))).toEqual([]);
    expect(earnedAchievements(days(4, player({ 3: 'liver', 4: 'liver' }), []))).toEqual([]);
    expect(earnedAchievements(days(3, player({})))).toEqual([]);
  });

  it('needs the barbecue: another event the day before does not count', () => {
    const ctx = contextFor(0.5, 1, { scenario: { 2: ['deadline'] } });
    let st = startSemester(ctx, 1);
    while (st.day <= 3) st = playDay(st, ctx, player({ 3: 'liver' }));
    expect(st.history.find((r) => r.day === 2)!.events.map((e) => e.id)).toEqual(['deadline']);
    expect(earnedAchievements(st)).toEqual([]);
  });

  it('counts a failed patrol, which was still a visit', () => {
    const s = days(3, player({ 3: 'liver' }));
    const failed: SemesterState = {
      ...s, history: s.history.map((r): DayRecord => (r.day === 3 ? { ...r, patrols: r.patrols.map((p) => ({ ...p, failed: true })) } : r)),
    };
    expect(earnedAchievements(failed)).toEqual(['active_checkup']);
  });
});

describe('achievements in the progress slot', () => {
  it('keeps an achievement earned for the first time, writes it, and commends only that one', () => {
    const { saves, data } = store();
    const one = finishSemester(saves, fresh, { level: 0, cleared: false }, ['active_checkup']);
    expect(one.commended).toEqual(['active_checkup']);
    expect(one.progress.achievements).toEqual(['active_checkup']);
    expect(decode(PROGRESS, data.get('hbc.v1.progress') ?? null).data.achievements).toEqual(['active_checkup']);
    const two = finishSemester(saves, one.progress, { level: 0, cleared: false }, ['active_checkup']);
    expect(two.commended).toEqual([]);
    expect(two.progress.achievements).toEqual(['active_checkup']);
  });

  it('keeps what was earned before, an id this build does not know included, and adds the new one after it', () => {
    const { saves } = store();
    const done = finishSemester(saves, { ...fresh, achievements: ['from_a_later_build'] }, { level: 0, cleared: false }, ['active_checkup']);
    expect(done.progress.achievements).toEqual(['from_a_later_build', 'active_checkup']);
    expect(done.commended).toEqual(['active_checkup']);
  });

  it('adds no field for a semester that earned nothing', () => {
    const { saves } = store();
    expect('achievements' in finishSemester(saves, fresh, { level: 0, cleared: false }).progress).toBe(false);
  });

  it('reads a version 4 save as having earned nothing, and round-trips one with achievements', () => {
    const v4 = JSON.stringify({ schema: 4, data: { handbook: [], hostName: DEFAULT_HOST, semestersDone: 2 } });
    const read = decode(PROGRESS, v4);
    expect(read.kind).toBe('migrated');
    expect(read.data.achievements).toBeUndefined();
    expect(hasAchievement(read.data, 'active_checkup')).toBe(false);
    const withOne: ProgressData = { ...fresh, achievements: ['active_checkup'] };
    expect(decode(PROGRESS, encode(PROGRESS, withOne)).data).toEqual(withOne);
    expect(hasAchievement(withOne, 'active_checkup')).toBe(true);
  });
});

describe('what the achievement shows', () => {
  it('has a commendation with a name, a reason and an unlock for every achievement', () => {
    for (const id of ACHIEVEMENTS) {
      const c = commendation(id);
      expect(c.title).toBe('嘉獎令');
      expect(c.lines).toHaveLength(3);
      for (const line of c.lines) expect(line).not.toMatch(/^achievement\./);
    }
  });

  it('lists the work orders of the semester by day in the tray, and no load', () => {
    expect(workOrderTray([])).toBe('肝臟工單匣：本局還沒有送進肝的工單');
    expect(workOrderTray([2, 3, 3])).toBe('肝臟工單匣：本局 3 張，第 2、3 天');
  });

  it('fills the tray from the clues the view already carries', () => {
    const s = days(3, player({}), [2, 3]);
    expect(s.liverOrders.length).toBeGreaterThan(0);
    expect(workOrderTray(s.liverOrders)).toContain('第 2、3 天');
  });
});
