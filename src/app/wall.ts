import { startChapter, type ChapterContent, type ChapterState, type RoomModel, type Wall } from '../core/index.ts';
import { chapterLoop } from './chapters.ts';
import type { FixedStepLoop } from './loop.ts';
import type { GameEvent } from '../core/index.ts';

/** The chapter whose one room is the evidence wall (tools/maps/make-wall.ts). */
export const WALL_CHAPTER = 'wall';

/** What the registry holds while the wall is up: the report's wall, and what to do when the player is through with it. */
export interface WallSession {
  readonly wall: Wall;
  readonly done: () => void;
}

/**
 * The wall chapter with the report desk's handbook Pickup naming `page`. The room file can only
 * name a fixed page, but the page a report unlocks depends on what went wrong in the semester.
 */
export function wallContent(base: ChapterContent, page: string): ChapterContent {
  const rooms = new Map<string, RoomModel>();
  let patched = 0;
  for (const [path, room] of base.rooms) {
    const objects = room.objects.map((o) => {
      if (o.kind !== 'Pickup' || o.props['itemType'] !== 'handbook') return o;
      patched++;
      return { ...o, props: { ...o.props, itemId: page } };
    });
    rooms.set(path, { ...room, objects });
  }
  if (patched !== 1) throw new Error(`the wall chapter must have exactly one handbook Pickup (the report desk), found ${patched}`);
  return { ...base, rooms };
}

/** The loop a World scene plays for one report's wall; the player starts at the room's entrance. */
export function wallLoop(base: ChapterContent, page: string): { ctx: ChapterContent; loop: FixedStepLoop<ChapterState, GameEvent> } {
  const ctx = wallContent(base, page);
  return { ctx, loop: chapterLoop(ctx, startChapter(ctx)) };
}
