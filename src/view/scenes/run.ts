import type Phaser from 'phaser';
import { chapterLoop } from '../../app/chapters.ts';
import { sharedKeys } from '../../app/input.ts';
import type { ChapterContent, ChapterState } from '../../core/index.ts';

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
