/**
 * The responsive player and the night owl of the selection sweep (design doc 9.6), shared by `combos.ts` and the clause check.
 * Both use the cards they hold: the owl pours every hour into the contest, the project and the debugging, the responsive
 * player takes the hours the cards ask for and keeps its bedtime.
 */
import { MAX_DEBUG_PER_NIGHT, WRITE_HOURS, type DayView, type MorningPlan, type NightPlan, type Strategy } from '../../src/core/index.ts';
import { ARCHETYPES } from './archetypes.ts';

export interface Style {
  readonly rank: number;
  readonly rankBed: number;
  readonly project: (v: DayView) => number;
  readonly debug: number;
  readonly walk: boolean;
}

/** One hour of write per free hour is not asked: the plan only names how many of the assignment's hours remain. */
export function playerOf(base: Strategy, style: Style, homework: boolean): Strategy {
  return {
    ...base,
    plan: (v): MorningPlan => {
      const open = homework ? v.homework.find((h) => h.written < WRITE_HOURS) : undefined;
      const project = style.project(v);
      return {
        ...base.plan(v),
        ...(open ? { write: WRITE_HOURS - open.written } : {}),
        ...(project > 0 ? { project } : {}),
        ...(style.walk && v.project ? { walk: true } : {}),
      };
    },
    night: (v): NightPlan => {
      const b = base.night(v);
      const next = homework ? v.homework.find((h) => h.debug !== undefined && h.debugged < h.debug) : undefined;
      const debug = next ? Math.min(style.debug, MAX_DEBUG_PER_NIGHT, next.debug! - next.debugged) : 0;
      return {
        ...b,
        ...(debug > 0 ? { debug } : {}),
        ...(v.rank?.open && style.rank > 0 ? { bed: style.rankBed, rank: style.rank } : {}),
      };
    },
  };
}

export const responsiveOf = (homework: boolean): Strategy =>
  playerOf(ARCHETYPES.balanced, { rank: 2, rankBed: 22, debug: 2, walk: true, project: (v) => (v.project?.open && v.day >= 6 ? 3 : 0) }, homework);

export const owlOf = (homework: boolean): Strategy =>
  playerOf(ARCHETYPES.nightOwl, { rank: 4, rankBed: 25, debug: MAX_DEBUG_PER_NIGHT, walk: false, project: (v) => (v.project?.open ? 4 : 0) }, homework);
