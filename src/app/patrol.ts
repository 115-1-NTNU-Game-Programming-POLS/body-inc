import {
  EMPTY_TAGS, NO_TALLY, patrolGoals, patrolTags, ratePatrol, startChapter, tallyPatrol,
  type ChapterContent, type ChapterState, type FloorId, type GameEvent, type PatrolKit, type PatrolResult, type PatrolTally, type TagState,
} from '../core/index.ts';
import { chapterLoop } from './chapters.ts';
import type { FixedStepLoop } from './loop.ts';

/** The chapter whose rooms a floor's patrol plays in (tools/maps/make-patrol.ts); a floor without one is not played. */
export const PATROL_CHAPTERS: Readonly<Partial<Record<FloorId, string>>> = { brain: 'patrol-brain', liver: 'patrol-liver' };

export const patrolChapter = (chapters: ReadonlyMap<string, ChapterContent>, floor: FloorId): ChapterContent | undefined => {
  const id = PATROL_CHAPTERS[floor];
  return id === undefined ? undefined : chapters.get(id);
};

export interface PatrolPlay {
  readonly ctx: ChapterContent;
  readonly loop: FixedStepLoop<ChapterState, GameEvent>;
  /** The result as it stands: what the rooms' goals and the hits so far rate, or a failure once the operator was sent home. */
  readonly rate: () => PatrolResult;
}

/** What the registry holds while a patrol is up: the way the rooms are played, and what to do once they are through with. */
export interface PatrolSession {
  readonly floor: FloorId;
  readonly play: PatrolPlay;
  readonly done: (result: PatrolResult) => void;
}

/**
 * The rooms of `floor`'s patrol, entered with the body's tags of the moment and the gauge and fighting rules the welfare cards give.
 * The tally follows the loop's events for as long as the loop lives.
 */
export function patrolLoop(base: ChapterContent, floor: FloorId, tags: TagState = EMPTY_TAGS, seed = 1, room?: string, kit?: PatrolKit): PatrolPlay {
  const state = startChapter(base, {
    tags: patrolTags(floor, tags, base.dict), seed, ...(room ? { room } : {}), ...(kit ? { gauge: kit.gauge, perks: kit.perks } : {}),
  });
  const loop = chapterLoop(base, state);
  let tally: PatrolTally = NO_TALLY;
  loop.onEvent((e) => {
    tally = tallyPatrol(tally, [e]);
  });
  return { ctx: base, loop, rate: () => ratePatrol(tally, patrolGoals(base, loop.state)) };
}
