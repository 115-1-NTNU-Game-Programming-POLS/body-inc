import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOSSES, DECKS, DIALOGUES, ENEMIES, PARAMS, TAGS } from '../../src/app/content.ts';
import {
  parseRoom, readContent, roomsOf, startChapter, stepChapter, ticksPerMinute,
  type ChapterContent, type TickInput, type TiledMap,
} from '../../src/core/index.ts';

const CHAPTER = readContent('chapter', JSON.parse(readFileSync('content/chapters/greybox.json', 'utf8')));
const load = (path: string) => parseRoom(path, JSON.parse(readFileSync(`public/assets/maps/${path}.tmj`, 'utf8')) as TiledMap, TAGS);
const base: ChapterContent = {
  chapter: CHAPTER,
  rooms: new Map(roomsOf(CHAPTER).map((p) => [p, load(p)])),
  dialogues: DIALOGUES, dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS, deck: DECKS.get('greybox')!,
};
const NONE: TickInput = { move: { x: 0, y: 0 } };

/** The chapter clock after standing still for `minutes` of it. */
function minuteAfter(ctx: ChapterContent, minutes: number): number {
  let s = startChapter(ctx, { room: 'greybox/rest-room' });
  for (let i = 0; i < minutes * ticksPerMinute(ctx.params) + 1; i++) s = stepChapter(ctx, s, NONE).state;
  return s.game.clock.minute;
}

describe('a patrol chapter (design doc 8.5)', () => {
  it('does not run the chapter clock, which a story chapter does', () => {
    const start = startChapter(base, { room: 'greybox/rest-room' }).game.clock.minute;
    expect(minuteAfter(base, 5)).toBe(start + 5);
    expect(minuteAfter({ ...base, chapter: { ...CHAPTER, patrol: 'brain' } }, 5)).toBe(start);
  });
});
