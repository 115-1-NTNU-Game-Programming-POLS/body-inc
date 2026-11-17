import type { SemesterState } from './types.ts';

/**
 * The achievements of design doc 8.14 that exist so far. Each one's condition is itself a health
 * behaviour, and each unlocks something across runs; the progress slot keeps the ids earned.
 */
export const ACHIEVEMENTS = ['active_checkup'] as const;

export type AchievementId = (typeof ACHIEVEMENTS)[number];

export const isAchievement = (id: string): id is AchievementId => (ACHIEVEMENTS as readonly string[]).includes(id);

/**
 * 主動健檢: a patrol of the liver, first or overtime, on the day after a barbecue. The liver never lights (design doc 8.6), so
 * going there is the player's own choice, and a patrol that failed was still a visit.
 */
function activeCheckup(state: SemesterState): boolean {
  const bbqDays = new Set(state.history.filter((r) => r.events.some((e) => e.id === 'bbq')).map((r) => r.day));
  return state.history.some((r) => bbqDays.has(r.day - 1) && r.patrols.some((p) => p.floor === 'liver'));
}

/** The achievements a semester's history earns, in the order of ACHIEVEMENTS; whether they were earned before is the caller's. */
export function earnedAchievements(state: SemesterState): AchievementId[] {
  const earned: Record<AchievementId, boolean> = { active_checkup: activeCheckup(state) };
  return ACHIEVEMENTS.filter((id) => earned[id]);
}
