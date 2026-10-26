import type Phaser from 'phaser';
import { chapterLoop } from '../../app/chapters.ts';
import { sharedKeys } from '../../app/input.ts';
import type { SaveStore } from '../../app/storage.ts';
import { STORY, type ChapterContent, type ChapterState, type StoryData } from '../../core/index.ts';

/** No time clock and no chapter to enter: what a new game or the last chapter's end leaves. */
export const NO_STORY: StoryData = { checkpoint: null, entry: null };

/** Writes the story slot and the registry copy the title reads; the copy follows even when the write failed. */
export function saveStory(scene: Phaser.Scene, story: StoryData): void {
  const issues = (scene.registry.get('saves') as SaveStore).save(STORY, story);
  if (issues.length > 0) scene.game.events.emit('save-issues', issues);
  scene.registry.set('story', story);
}

/** Starts play from a menu scene (the title or the opening cards): the rule loop, the room and the HUD. */
export function beginRun(scene: Phaser.Scene, ctx: ChapterContent, state: ChapterState): void {
  scene.registry.set('ended', false);
  scene.registry.set('loop', chapterLoop(ctx, state));
  // Phaser calls this from its own keydown handler, which runs before the input tracker has
  // recorded that same key. Handing over one task later lets the tracker see it, so the J that
  // chose the item is ignored until released instead of being the first staple.
  window.setTimeout(() => {
    sharedKeys(scene.registry, window).ignoreHeld();
    scene.scene.start('World');
    scene.scene.launch('Hud');
  }, 0);
}
