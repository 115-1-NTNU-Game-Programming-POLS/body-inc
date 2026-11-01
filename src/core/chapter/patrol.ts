import { acetaldehydeCrates, waitingCrates } from '../liver/line.ts';
import type { PatrolGoals } from '../semester/patrol.ts';
import { record } from '../tags/causal.ts';
import { flag, setAmount, type TagState } from '../tags/store.ts';
import type { TagDictionary } from '../tags/dictionary.ts';
import type { ChapterContent, ChapterState } from './chapter.ts';

/** The room of every patrol chapter whose goal is the core goal (design doc 8.5). */
export const CORE_ROOM = 'core';

/** The most crates the production line of the liver patrol starts with, and the fewest: even a quiet day has something to route. */
export const CRATES_MIN = 2;
export const CRATES_MAX = 4;

/**
 * The tags the rooms of a patrol are entered with. The chapter clock does not run in them, so the line of the liver, which
 * turns waiting alcohol into acetaldehyde only as time passes, would never produce a crate: the day's waiting and finished
 * crates all stand out of the first line already.
 */
export function patrolTags(floor: string, tags: TagState, dict: TagDictionary): TagState {
  if (floor !== 'liver') return tags;
  const orders = waitingCrates(tags, dict) + acetaldehydeCrates(tags, dict);
  const [log, cause] = record(tags.log, { kind: 'rule', key: 'patrol.line', at: 0 });
  const out = setAmount({ ...tags, log }, dict, 'alcohol', 0, cause, 0);
  return setAmount(out, dict, 'acetaldehyde', Math.min(CRATES_MAX, Math.max(CRATES_MIN, orders)), cause, 0);
}

/**
 * What the patrol has achieved as it stands, read where the operator is: the core goal counts only from inside the core room, and
 * is the rest room's adenosine all locked (the brain) or every acetaldehyde crate taken into the second line (the liver).
 */
export function patrolGoals(ctx: ChapterContent, state: ChapterState): PatrolGoals {
  const side = flag(state.run.tags, ctx.dict, 'patrol_side');
  if (state.run.roomId !== `${ctx.chapter.id}/${CORE_ROOM}`) return { core: false, side };
  switch (ctx.chapter.patrol) {
    case 'brain': return { core: state.game.enemies.filter((e) => e.clings).every((e) => e.phase === 'closed'), side };
    case 'liver': return { core: acetaldehydeCrates(state.run.tags, ctx.dict) === 0, side };
    default: return { core: false, side };
  }
}
