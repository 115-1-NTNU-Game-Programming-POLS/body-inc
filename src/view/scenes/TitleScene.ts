import Phaser from 'phaser';
import { tryResume } from '../../app/chapters.ts';
import { str } from '../../app/content.ts';
import { sharedKeys } from '../../app/input.ts';
import type { ChapterContent, ChapterEntry, ChapterState, StoryData } from '../../core/index.ts';
import { addText } from '../text/fonts.ts';
import type { NameData } from './NameScene.ts';
import type { CardsData } from './OpeningScene.ts';
import { beginRun } from './run.ts';

const PAPER = '#f4efe4';
const INK = '#0c2d5e';
const DIM = '#6b7a94';

interface Item {
  readonly text: Phaser.GameObjects.Text;
  readonly enabled: boolean;
  readonly run: () => void;
}

/**
 * Title screen: a new game, or continue from the latest time clock, or from the start of the next
 * chapter when the last one ended with no punch since, or rename the host. The first bundled
 * chapter is the new game; "continue" needs a save that still fits the bundled content.
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
    // The cold start measurement (docs/perf/cold-start.md) ends at the first frame drawn with the title.
    if (performance.getEntriesByName('title-ready').length === 0) {
      this.game.events.once(Phaser.Core.Events.POST_RENDER, () => performance.mark('title-ready'));
    }
    const chapters = this.registry.get('chapters') as ReadonlyMap<string, ChapterContent>;
    // Kept current by the world scene on every punch; this is the same copy the save slot holds.
    const story = this.registry.get('story') as StoryData;
    const first = [...chapters.values()][0];
    if (!first) throw new Error('no chapter is bundled; add one to CHAPTER_FILES in app/content.ts');
    const checkpoint = story.checkpoint;
    const saved = checkpoint ? chapters.get(checkpoint.chapter) : undefined;
    const resumed = saved && checkpoint ? tryResume(saved, checkpoint) : undefined;
    // Between chapters there is no punch yet, only where the next chapter starts.
    const entry = checkpoint ? null : story.entry;
    const entered = entry && chapters.has(entry.chapter) ? entry : undefined;
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
      make(420, 'title.new', true, () => this.newGame(first)),
      make(490, 'title.continue', resumed !== undefined || entered !== undefined, () => (resumed ? this.play(saved!, resumed) : this.enter(entered!))),
      // Only here, never during a chapter (issue #8).
      make(560, 'title.host', true, () => this.name({ mode: 'rename' })),
    ];
    if ((checkpoint && resumed === undefined) || (entry && entered === undefined)) {
      addText(this, w / 2, 626, str('title.stale'), { role: 'print', weight: 400, size: 20, color: DIM }).setOrigin(0.5);
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

  private play(ctx: ChapterContent, state: ChapterState): void {
    if (this.starting) return;
    this.starting = true;
    beginRun(this, ctx, state);
  }

  /** A new game asks for the host's name first; the name scene then starts it (run.ts startNewGame). */
  private newGame(ctx: ChapterContent): void {
    this.name({ mode: 'new', chapter: ctx.chapter.id });
  }

  private name(data: NameData): void {
    if (this.starting) return;
    this.starting = true;
    // Deferred so the confirming key is not also typed into the name box.
    window.setTimeout(() => this.scene.start('Name', data), 0);
  }

  /** The next chapter of a save made between chapters: its opening cards not yet answered, then its first room. */
  private enter(entry: ChapterEntry): void {
    this.cards({ chapter: entry.chapter, mode: 'opening', tags: entry.tags, tools: entry.tools });
  }

  private cards(data: CardsData): void {
    if (this.starting) return;
    this.starting = true;
    // Deferred for the same reason as in beginRun: the confirming key must reach the tracker first.
    window.setTimeout(() => this.scene.start('Opening', data), 0);
  }
}
