import Phaser from 'phaser';
import { str } from '../../app/content.ts';
import { CHAPTER_OPENS, cardText, playOpening, startChapter, type ChapterContent, type DeckCard, type Settings } from '../../core/index.ts';
import { addText } from '../text/fonts.ts';
import { CardTable } from '../ui/cardTable.ts';
import { beginRun } from './run.ts';

const DIM = '#c9d3e3';
/** How long a chosen card stays highlighted before the next one, so the choice is seen. */
const CHOSEN_MS = 220;
const CONFIRM = ['Enter', 'NumpadEnter', 'KeyJ', 'KeyE', 'Space'];
const PREV = ['KeyW', 'KeyA', 'ArrowUp', 'ArrowLeft'];
const NEXT = ['KeyS', 'KeyD', 'ArrowDown', 'ArrowRight'];
const PICK = ['Digit1', 'Digit2', 'Digit3'];
const PICK_PAD = ['Numpad1', 'Numpad2', 'Numpad3'];

/**
 * The chapter's opening cards (design doc 4.2), one at a time, before the first room. It is a
 * menu outside the rule loop, like the title: the picks only decide the tags and clock the chapter
 * starts with, and the chapter start logs each pick as a card in the causal record.
 */
export class OpeningScene extends Phaser.Scene {
  private ctx!: ChapterContent;
  private picks: number[] = [];
  private cursor = 0;
  private table: CardTable | undefined;
  private busy = false;

  constructor() {
    super('Opening');
  }

  create(data: { chapter: string }): void {
    const chapters = this.registry.get('chapters') as ReadonlyMap<string, ChapterContent>;
    const ctx = chapters.get(data.chapter);
    if (!ctx?.deck) throw new Error(`opening cards: chapter "${data.chapter}" is not bundled or has no deck`);
    this.ctx = ctx;
    this.picks = [];
    this.table = undefined;
    this.busy = false;
    addText(this, this.scale.width - 24, this.scale.height - 24, str('deck.hint'), { role: 'print', weight: 400, size: 18, color: DIM }).setOrigin(1, 1);

    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const n = this.card().options.length;
      if (PREV.includes(e.code)) this.move(-1);
      else if (NEXT.includes(e.code)) this.move(1);
      else if (CONFIRM.includes(e.code)) this.choose(this.cursor);
      else {
        const i = Math.max(PICK.indexOf(e.code), PICK_PAD.indexOf(e.code));
        if (i >= 0 && i < n) this.choose(i);
      }
    };
    this.input.keyboard?.on('keydown', onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown', onKey);
      this.table?.destroy();
    });
    this.deal();
  }

  private card(): DeckCard {
    return this.ctx.deck!.opening[this.picks.length]!;
  }

  private deal(): void {
    this.table?.destroy();
    const deck = this.ctx.deck!;
    const card = this.card();
    const t = cardText(deck.chapter, card.id);
    const caption = `${str('deck.opening')}　${str('deck.progress').replace('{n}', String(this.picks.length + 1)).replace('{total}', String(deck.opening.length))}`;
    const scale = (this.registry.get('settings') as Settings | undefined)?.textScale ?? 1;
    this.table = new CardTable(this, {
      caption,
      title: str(t.title),
      options: card.options.map((o) => ({ label: str(t.option(o.id)), note: str(t.note(o.id)) })),
    }, scale, (i) => this.choose(i), (i) => this.select(i));
    this.select(0);
  }

  private select(i: number): void {
    if (this.busy) return;
    this.cursor = i;
    this.table?.paint(i);
  }

  private move(step: number): void {
    const n = this.card().options.length;
    this.select((this.cursor + step + n) % n);
  }

  private choose(i: number): void {
    if (this.busy) return;
    this.select(i);
    this.busy = true;
    this.picks.push(i);
    this.time.delayedCall(CHOSEN_MS, () => {
      this.busy = false;
      if (this.picks.length < this.ctx.deck!.opening.length) return this.deal();
      const opening = playOpening(this.ctx.deck!, this.ctx.dict, this.picks, CHAPTER_OPENS, this.ctx.params);
      this.busy = true;
      beginRun(this, this.ctx, startChapter(this.ctx, { tags: opening.tags, clock: opening.clock }));
    });
  }
}
