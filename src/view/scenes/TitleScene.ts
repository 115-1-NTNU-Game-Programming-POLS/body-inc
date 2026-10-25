import Phaser from 'phaser';
import { chapterLoop, tryResume } from '../../app/chapters.ts';
import { str } from '../../app/content.ts';
import { sharedKeys } from '../../app/input.ts';
import { startChapter, type ChapterContent, type StoryData } from '../../core/index.ts';
import { addText } from '../text/fonts.ts';

const PAPER = '#f4efe4';
const INK = '#0c2d5e';
const DIM = '#6b7a94';

interface Item {
  readonly text: Phaser.GameObjects.Text;
  readonly enabled: boolean;
  readonly run: () => void;
}

/**
 * Title screen: a new game, or continue from the latest time clock. The first bundled chapter is
 * the new game; "continue" needs a checkpoint that still fits the bundled content.
 */
export class TitleScene extends Phaser.Scene {
  private items: Item[] = [];
  private index = 0;
  private starting = false;

  constructor() {
    super('Title');
  }

  create(): void {
    this.starting = false;
    const chapters = this.registry.get('chapters') as ReadonlyMap<string, ChapterContent>;
    // Kept current by the world scene on every punch; this is the same copy the save slot holds.
    const story = this.registry.get('story') as StoryData;
    const first = [...chapters.values()][0];
    if (!first) throw new Error('no chapter is bundled; add one to CHAPTER_FILES in app/content.ts');
    const checkpoint = story.checkpoint;
    const saved = checkpoint ? chapters.get(checkpoint.chapter) : undefined;
    const resumed = saved && checkpoint ? tryResume(saved, checkpoint) : undefined;
    // From here on the tracker sees every key, so `play` knows which ones are still down.
    sharedKeys(this.registry, window);

    const w = this.scale.width;
    addText(this, w / 2, 190, str('title.name'), { role: 'hand', weight: 700, size: 64, color: PAPER }).setOrigin(0.5);
    if (this.registry.get('ended') === true) {
      addText(this, w / 2, 290, str('title.ended'), { role: 'hand', weight: 400, size: 26, color: DIM }).setOrigin(0.5);
    }

    const plate = { padding: { x: 20, y: 8 } } as const;
    const make = (y: number, key: string, enabled: boolean, run: () => void): Item => ({
      text: addText(this, w / 2, y, str(key), { role: 'print', weight: 700, size: 32, color: enabled ? PAPER : DIM, ...plate }).setOrigin(0.5),
      enabled,
      run,
    });
    this.items = [
      make(420, 'title.new', true, () => this.play(first, startChapter(first))),
      make(490, 'title.continue', resumed !== undefined, () => this.play(saved!, resumed!)),
    ];
    if (checkpoint && resumed === undefined) {
      addText(this, w / 2, 556, str('title.stale'), { role: 'print', weight: 400, size: 20, color: DIM }).setOrigin(0.5);
    }
    this.index = 0;
    this.items.forEach((item, i) => {
      if (!item.enabled) return;
      item.text.setInteractive({ useHandCursor: true });
      item.text.on('pointerover', () => this.select(i));
      item.text.on('pointerup', () => item.run());
    });
    this.select(0);
    addText(this, w / 2, this.scale.height - 56, str('title.hint'), { role: 'print', weight: 400, size: 18, color: DIM }).setOrigin(0.5);

    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyW' || e.code === 'ArrowUp') this.move(-1);
      else if (e.code === 'KeyS' || e.code === 'ArrowDown') this.move(1);
      else if (['Enter', 'NumpadEnter', 'KeyJ', 'Space'].includes(e.code) && !e.repeat) this.items[this.index]?.run();
    };
    this.input.keyboard?.on('keydown', onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.input.keyboard?.off('keydown', onKey));
  }

  /** Moves to the next item that can be chosen; a disabled "continue" is skipped. */
  private move(step: number): void {
    for (let i = 1; i <= this.items.length; i++) {
      const next = (this.index + step * i + this.items.length * i) % this.items.length;
      if (this.items[next]?.enabled) return this.select(next);
    }
  }

  private select(i: number): void {
    this.index = i;
    this.items.forEach((item, n) => {
      const on = n === i;
      item.text.setColor(on ? INK : item.enabled ? PAPER : DIM).setBackgroundColor(on ? PAPER : 'rgba(0, 0, 0, 0)');
    });
  }

  private play(ctx: ChapterContent, state: ReturnType<typeof startChapter>): void {
    if (this.starting) return;
    this.starting = true;
    this.registry.set('ended', false);
    this.registry.set('loop', chapterLoop(ctx, state));
    // Phaser calls this from its own keydown handler, which runs before the input tracker has
    // recorded that same key. Handing over one task later lets the tracker see it, so the J that
    // chose this item is ignored until released instead of being the first staple.
    window.setTimeout(() => {
      sharedKeys(this.registry, window).ignoreHeld();
      this.scene.start('World');
      this.scene.launch('Hud');
    }, 0);
  }
}
