import {
  ChapterError, GameSetupError, parseRoom, resumeChapter, stepChapter,
  type ChapterContent, type ChapterFile, type ChapterState, type Checkpoint, type GameEvent, type TiledMap,
} from '../core/index.ts';
import { BOSSES, DIALOGUES, ENEMIES, PARAMS, TAGS } from './content.ts';
import { missingDialogues } from './dialogue.ts';
import { FixedStepLoop } from './loop.ts';

/** Parses the loaded Tiled files of a chapter into the content `stepChapter` needs. */
export function chapterContent(chapter: ChapterFile, maps: ReadonlyMap<string, TiledMap>): ChapterContent {
  const rooms = new Map([...maps].map(([path, map]) => [path, parseRoom(path, map, TAGS)] as const));
  const missing = missingDialogues(rooms, DIALOGUES);
  if (missing.length > 0) throw new Error(`rooms start conversations that do not exist:\n  ${missing.join('\n  ')}`);
  return {
    chapter,
    rooms,
    dialogues: DIALOGUES,
    dict: TAGS,
    enemies: ENEMIES,
    bosses: BOSSES,
    params: PARAMS,
  };
}

/** Events after which the state holds a room the screen has not drawn yet, or no room at all. */
export const LEAVES_ROOM: ReadonlySet<GameEvent['type']> = new Set(['roomChanged', 'returnedToCheckpoint', 'chapterEnded']);

/** The loop a World scene plays: one rule tick is one `stepChapter`. */
export const chapterLoop = (ctx: ChapterContent, initial: ChapterState): FixedStepLoop<ChapterState, GameEvent> =>
  new FixedStepLoop<ChapterState, GameEvent>(initial, (state, input) => stepChapter(ctx, state, input), (e) => LEAVES_ROOM.has(e.type));

/**
 * The state "continue" starts from, or undefined when the saved checkpoint no longer fits the
 * bundled content (a room renamed or removed since): the title then offers only a new game.
 */
export function tryResume(ctx: ChapterContent, saved: Checkpoint): ChapterState | undefined {
  try {
    return resumeChapter(ctx, saved);
  } catch (e) {
    if (e instanceof ChapterError || e instanceof GameSetupError) return undefined;
    throw e;
  }
}
