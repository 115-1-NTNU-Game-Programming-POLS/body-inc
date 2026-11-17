import { MAX_CLAUSE } from './clauses.ts';
import { GRADE_HOURS, rankNights, takes } from './courses.ts';
import { summarize } from './semester.ts';
import type { SemesterContext, SemesterState } from './types.ts';
import { STOP_BY } from './welfare.ts';

/**
 * The achievements of design doc 8.14 that exist so far, in the order of its table. Each one's condition is itself a health
 * behaviour, and each unlocks something across runs; the progress slot keeps the ids earned. The rest of the table waits for
 * systems the semester does not have yet (illness, meals, mood, the night-before forecast, course drop, the internship).
 */
export const ACHIEVEMENTS = ['on_time', 'morning_cup', 'active_checkup', 'call_it_a_night', 'leave_buffer', 'from_the_seats', 'year_done'] as const;

export type AchievementId = (typeof ACHIEVEMENTS)[number];

export const isAchievement = (id: string): id is AchievementId => (ACHIEVEMENTS as readonly string[]).includes(id);

/** 準時下班 reads "after 01:00" as a bedtime later than this hour of the extended clock. */
export const LATE_BED = 25;
/** The hour every cup of 早上那一杯 comes before. */
export const MORNING_ENDS = 12;
/** 留好緩衝: days before it falls due that each assignment's writing begins by. */
export const BUFFER_DAYS = 2;

const passed = (state: SemesterState, ctx: SemesterContext): boolean => {
  const sum = summarize(state, ctx);
  return sum.passMid && sum.passFin;
};

const nights = (state: SemesterState): number[] => state.history.flatMap((r) => (r.bedEnd === undefined ? [] : [r.bedEnd]));

/** 準時下班: no night of the semester went to bed after 01:00, and it passed. */
function onTime(state: SemesterState, ctx: SemesterContext): boolean {
  return nights(state).every((bed) => bed <= LATE_BED) && passed(state, ctx);
}

/** 早上那一杯: coffee was drunk, every cup of it before noon, and the semester passed. A semester without a cup has no morning cup. */
function morningCup(state: SemesterState, ctx: SemesterContext): boolean {
  const cups = state.history.flatMap((r) => r.coffee ?? []);
  return cups.length > 0 && cups.every((h) => h < MORNING_ENDS) && passed(state, ctx);
}

/**
 * 主動健檢: a patrol of the liver, first or overtime, on the day after a barbecue. The liver never lights (design doc 8.6), so
 * going there is the player's own choice, and a patrol that failed was still a visit. An exam or hospital day has no elevator,
 * so the day after is the next day with one: a barbecue on the eve of the midterm would otherwise leave nothing to earn it on.
 */
function activeCheckup(state: SemesterState): boolean {
  return state.history.some((bbq) => {
    if (!bbq.events.some((e) => e.id === 'bbq')) return false;
    const after = state.history.find((r) => r.day > bbq.day && r.kind === 'normal');
    return after !== undefined && after.patrols.some((p) => p.floor === 'liver');
  });
}

/**
 * 見好就收: with the algorithms card, the leaderboard contest was played, every night of it ended in bed by 24:00, and the
 * semester passed. A semester that never played the contest has nothing to have stopped.
 */
function callItANight(state: SemesterState, ctx: SemesterContext): boolean {
  if (!takes(ctx.courses, 'algorithms') || !state.history.some((r) => r.rank !== undefined)) return false;
  const { from, to } = rankNights(ctx.params);
  const contest = state.history.filter((r) => r.day >= from && r.day <= to && r.bedEnd !== undefined);
  return contest.every((r) => r.bedEnd! <= STOP_BY) && passed(state, ctx);
}

/** 留好緩衝: with the operating-systems card, the writing of each assignment began at least two days before it fell due. */
function leaveBuffer(state: SemesterState, ctx: SemesterContext): boolean {
  if (!takes(ctx.courses, 'os') || state.homework.length === 0) return false;
  return state.homework.every((a, i) => {
    const begun = state.history.find((r) => r.homework.some((h) => h.n === i + 1 && h.wrote > 0));
    return begun !== undefined && a.due - begun.day >= BUFFER_DAYS;
  });
}

/** 也坐過台下: as the data-structures TA, every paper was graded in time and no night of grading went past 00:00. */
function fromTheSeats(state: SemesterState, ctx: SemesterContext): boolean {
  if (!takes(ctx.courses, 'ta') || state.graded < GRADE_HOURS) return false;
  return state.history.every((r) => r.gradeNight === undefined || (r.bedEnd !== undefined && r.bedEnd <= STOP_BY));
}

/** 學年結業: the semester was passed under the highest overtime clause there is (design doc 8.14 only plans level 2 for now). */
const yearDone = (state: SemesterState, ctx: SemesterContext): boolean => ctx.clause === MAX_CLAUSE && passed(state, ctx);

/** The achievements a semester's history earns, in the order of ACHIEVEMENTS; whether they were earned before is the caller's. */
export function earnedAchievements(state: SemesterState, ctx: SemesterContext): AchievementId[] {
  const earned: Record<AchievementId, boolean> = {
    on_time: onTime(state, ctx),
    morning_cup: morningCup(state, ctx),
    active_checkup: activeCheckup(state),
    call_it_a_night: callItANight(state, ctx),
    leave_buffer: leaveBuffer(state, ctx),
    from_the_seats: fromTheSeats(state, ctx),
    year_done: yearDone(state, ctx),
  };
  return ACHIEVEMENTS.filter((id) => earned[id]);
}
