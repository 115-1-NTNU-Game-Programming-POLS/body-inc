import caffeineJson from '../../content/bosses/caffeine.json';
import enemiesJson from '../../content/enemies.json';
import feedbackJson from '../../content/feedback.json';
import paramsJson from '../../content/params.json';
import stringsJson from '../../content/strings/zh-TW.json';
import tagsJson from '../../content/tags.json';
import { loadBossTable, loadDictionary, loadEnemyTable, readContent, type BossTable, type EnemyTable, type TagDictionary } from '../core/index.ts';
import { feedbackProblems, noteFields, type FeedbackTable, type StringTable } from './feedback.ts';

/** Content is bundled and parsed once at startup; core receives the parsed objects. */
export const TAGS: TagDictionary = loadDictionary(tagsJson);
export const ENEMIES: EnemyTable = loadEnemyTable(enemiesJson);
export const FEEDBACK: FeedbackTable = readContent('feedback', feedbackJson);
export const STRINGS: StringTable = readContent('strings', stringsJson);
export const PARAMS = readContent('params', paramsJson).defaults;
/** Every file in content/bosses. One left out stops startup: its enemy then names a boss with no file. */
export const BOSS_FILES: readonly unknown[] = [caffeineJson];
export const BOSSES: BossTable = loadBossTable(BOSS_FILES, ENEMIES, PARAMS);

const problems = feedbackProblems(FEEDBACK, STRINGS, noteFields(ENEMIES));
if (problems.length > 0) throw new Error(`content/feedback.json:\n  ${problems.join('\n  ')}`);
