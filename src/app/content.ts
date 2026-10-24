import enemiesJson from '../../content/enemies.json';
import feedbackJson from '../../content/feedback.json';
import stringsJson from '../../content/strings/zh-TW.json';
import tagsJson from '../../content/tags.json';
import { loadDictionary, loadEnemyTable, type EnemyTable, type TagDictionary } from '../core/index.ts';
import { feedbackProblems, noteFields, type FeedbackTable, type StringTable } from './feedback.ts';

/** Content is bundled and parsed once at startup; core receives the parsed objects. */
export const TAGS: TagDictionary = loadDictionary(tagsJson);
export const ENEMIES: EnemyTable = loadEnemyTable(enemiesJson);
export const FEEDBACK = feedbackJson as FeedbackTable;
export const STRINGS = stringsJson as StringTable;

const problems = feedbackProblems(FEEDBACK, STRINGS, noteFields(ENEMIES));
if (problems.length > 0) throw new Error(`content/feedback.json:\n  ${problems.join('\n  ')}`);
