import caffeineJson from '../../content/bosses/caffeine.json';
import greyboxChapter from '../../content/chapters/greybox.json';
import enemiesJson from '../../content/enemies.json';
import feedbackJson from '../../content/feedback.json';
import paramsJson from '../../content/params.json';
import stringsJson from '../../content/strings/zh-TW.json';
import tagsJson from '../../content/tags.json';
import { loadBossTable, loadDictionary, loadEnemyTable, readContent, type BossTable, type ChapterFile, type EnemyTable, type TagDictionary } from '../core/index.ts';
import { feedbackProblems, noteFields, type FeedbackTable, type StringTable } from './feedback.ts';

/** Content is bundled and parsed once at startup; core receives the parsed objects. */
export const TAGS: TagDictionary = loadDictionary(tagsJson);
export const ENEMIES: EnemyTable = loadEnemyTable(enemiesJson);
export const FEEDBACK: FeedbackTable = readContent('feedback', feedbackJson);
export const STRINGS: StringTable = readContent('strings', stringsJson);
/** A screen string by key; a key the table lacks is a bug in the scene, so it throws. */
export const str = (key: string): string => {
  const s = STRINGS.strings[key];
  if (!s) throw new Error(`content/strings has no "${key}"`);
  return s.text;
};
export const PARAMS = readContent('params', paramsJson).defaults;
/** Every file in content/bosses. One left out stops startup: its enemy then names a boss with no file. */
export const BOSS_FILES: readonly unknown[] = [caffeineJson];
export const BOSSES: BossTable = loadBossTable(BOSS_FILES, ENEMIES, PARAMS);

/**
 * Every file in content/chapters, in the order the title screen offers them. A chapter left out
 * here is never loaded, so its rooms never reach the game even though the map check passes them.
 */
export const CHAPTER_FILES: readonly unknown[] = [greyboxChapter];
export const CHAPTERS: ReadonlyMap<string, ChapterFile> = new Map(CHAPTER_FILES.map((f) => {
  const c = readContent('chapter', f);
  return [c.id, c] as const;
}));

const problems = feedbackProblems(FEEDBACK, STRINGS, noteFields(ENEMIES));
if (problems.length > 0) throw new Error(`content/feedback.json:\n  ${problems.join('\n  ')}`);
