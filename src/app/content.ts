import caffeineJson from '../../content/bosses/caffeine.json';
import toastJson from '../../content/bosses/toast.json';
import greyboxChapter from '../../content/chapters/greybox.json';
import liverChapter from '../../content/chapters/liver.json';
import midtermChapter from '../../content/chapters/midterm.json';
import prologueChapter from '../../content/chapters/prologue.json';
import enemiesJson from '../../content/enemies.json';
import feedbackJson from '../../content/feedback.json';
import handbookJson from '../../content/handbook.json';
import paramsJson from '../../content/params.json';
import rescueJson from '../../content/rescue.json';
import speakersJson from '../../content/speakers.json';
import stringsJson from '../../content/strings/zh-TW.json';
import tagsJson from '../../content/tags.json';
import {
  loadBossTable, loadDeck, loadDictionary, loadDialogueTable, loadEnemyTable, loadExamTable, loadRescues, readContent,
  type BossTable, type ChapterFile, type Deck, type DialogueFile, type DialogueTable, type EnemyTable, type ExamTable, type RescueTable, type TagDictionary,
} from '../core/index.ts';
import { speakerProblems, type Speakers } from './dialogue.ts';
import { feedbackProblems, noteFields, type FeedbackTable, type StringTable } from './feedback.ts';
import { handbookProblems } from './handbook.ts';

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
export const BOSS_FILES: readonly unknown[] = [caffeineJson, toastJson];
export const BOSSES: BossTable = loadBossTable(BOSS_FILES, ENEMIES, PARAMS);

/** Every file in content/exams, found by pattern; check-content words the problems this load throws on. */
const examSources = import.meta.glob<unknown>('../../content/exams/*.json', { import: 'default', eager: true });
export const EXAMS: ExamTable = loadExamTable(Object.values(examSources), ENEMIES, TAGS, PARAMS);

/**
 * Every CSV in content/dialogue, found by pattern so that a new file needs no change here. The
 * check (tools/check-dialogue.ts) reports problems in Chinese; this load stops startup on any.
 */
const dialogueSources = import.meta.glob<string>('../../content/dialogue/*.csv', { query: '?raw', import: 'default', eager: true });
export const DIALOGUE_FILES: readonly DialogueFile[] = Object.entries(dialogueSources)
  .map(([path, text]) => ({ file: path.replace('../../', ''), text }))
  .sort((a, b) => (a.file < b.file ? -1 : 1));
export const DIALOGUES: DialogueTable = loadDialogueTable(DIALOGUE_FILES, TAGS);
export const SPEAKERS: Speakers = readContent('speakers', speakersJson).speakers;
/** Every spoken and reply text, for the font gate: dialogue is not in content/strings, but it is drawn with the same fonts. */
export const DIALOGUE_TEXT: readonly string[] = [...DIALOGUES.values()].flatMap((d) => d.lines.map((l) => l.text));
const speakerIssues = speakerProblems(DIALOGUES, SPEAKERS);
if (speakerIssues.length > 0) throw new Error(`content/dialogue:\n  ${speakerIssues.join('\n  ')}`);

/**
 * Every file in content/chapters. The first is the new game; the others are reached through a
 * chapter's `next`. A chapter left out here is never loaded, so its rooms never reach the game
 * even though the map check passes them.
 */
export const CHAPTER_FILES: readonly unknown[] = [prologueChapter, greyboxChapter, midtermChapter, liverChapter];
/** The rescue sequences rooms open with a `rescue` Trigger; check-content words the problems this load throws on. */
export const RESCUES: RescueTable = loadRescues(readContent('rescue', rescueJson), TAGS);
export const CHAPTERS: ReadonlyMap<string, ChapterFile> = new Map(CHAPTER_FILES.map((f) => {
  const c = readContent('chapter', f);
  return [c.id, c] as const;
}));

/**
 * Every file in content/decks, found by pattern, by chapter id. A chapter without one opens with
 * no cards. The deck check (tools/check-decks.ts) reports problems in Chinese; this load stops
 * startup on any.
 */
const deckSources = import.meta.glob<unknown>('../../content/decks/*.json', { import: 'default', eager: true });
export const DECKS: ReadonlyMap<string, Deck> = new Map(Object.values(deckSources).map((raw) => {
  const d = loadDeck(raw, TAGS);
  return [d.chapter, d] as const;
}));

const problems = feedbackProblems(FEEDBACK, STRINGS, noteFields(ENEMIES));
if (problems.length > 0) throw new Error(`content/feedback.json:\n  ${problems.join('\n  ')}`);

/** The handbook's pages in screen order; their text is in STRINGS. */
export const HANDBOOK = readContent('handbook', handbookJson);
const pageProblems = handbookProblems(HANDBOOK, [{ file: 'content/strings/zh-TW.json', value: STRINGS }]);
if (pageProblems.length > 0) throw new Error(`content/handbook.json:\n  ${pageProblems.join('\n  ')}`);
