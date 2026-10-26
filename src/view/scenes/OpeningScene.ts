import Phaser from 'phaser';
import { str } from '../../app/content.ts';
import {
  CHAPTER_OPENS, cardText, EMPTY_TAGS, openingFor, playCards, startChapter,
  type ChapterContent, type DeckCard, type Settings, type TagState, type Tool,
} from '../../core/index.ts';
import { addText } from '../text/fonts.ts';
import { CardTable } from '../ui/cardTable.ts';
import { beginRun, NO_STORY, saveStory } from './run.ts';

const DIM = '#c9d3e3';
/** How long a chosen card stays highlighted before the next one, so the choice is seen. */
const CHOSEN_MS = 220;
const CONFIRM = ['Enter', 'NumpadEnter', 'KeyJ', 'KeyE', 'Space'];
const PREV = ['KeyW', 'KeyA', 'ArrowUp', 'ArrowLeft'];
const NEXT = ['KeyS', 'KeyD', 'ArrowDown', 'ArrowRight'];
const PICK = ['Digit1', 'Digit2', 'Digit3'];
const PICK_PAD = ['Numpad1', 'Numpad2', 'Numpad3'];

export interface CardsData {
  readonly chapter: string;
  /**
   * `opening`: the chapter's opening cards not yet answered, then the chapter starts.
   * `closing`: the ended chapter's closing cards, then its `next` chapter's opening, or the title.
   */
  readonly mode?: 'opening' | 'closing';
  /** Tags the chapter starts from: what the last chapter's closing cards left. */
  readonly tags?: TagState;
  readonly tools?: readonly Tool[];
}

/**
 * A chapter's cards (design doc 4.2), one at a time, outside the rule loop like the title: the
 * opening cards before the first room, or the closing cards after the last. The picks only decide
 * the tags the next chapter starts with, and each pick is logged as a card in the causal record,
 * which is also how the next chapter knows which of its opening cards were already answered.
 */
export class OpeningScene extends Phaser.Scene {
  private ctx!: ChapterContent;
  private data_!: CardsData;
  private cards: readonly DeckCard[] = [];
  private picks: number[] = [];
  private cursor = 0;
  private table: CardTable | undefined;
  private busy = false;

  constructor() {
    super('Opening');
  }

  create(data: CardsData): void {
    const chapters = this.registry.get('chapters') as ReadonlyMap<string, ChapterContent>;
    const ctx = chapters.get(data.chapter);
    if (!ctx) throw new Error(`cards: chapter "${data.chapter}" is not bundled`);
    this.ctx = ctx;
    this.data_ = data;
    const deck = ctx.deck;
    this.cards = !deck ? [] : data.mode === 'closing' ? deck.closing : openingFor(deck, data.tags ?? EMPTY_TAGS);
    this.picks = [];
    this.table = undefined;
    this.busy = false;
    if (this.cards.length === 0) {
      this.busy = true;
      this.finish();
      return;
    }
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
    return this.cards[this.picks.length]!;
  }

  private deal(): void {
    this.table?.destroy();
    const card = this.card();
    const t = cardText(this.ctx.deck!.chapter, card.id);
    const heading = str(this.data_.mode === 'closing' ? 'deck.closing' : 'deck.opening');
    const caption = `${heading}　${str('deck.progress').replace('{n}', String(this.picks.length + 1)).replace('{total}', String(this.cards.length))}`;
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
      if (this.picks.length < this.cards.length) return this.deal();
      this.busy = true;
      this.finish();
    });
  }

  private finish(): void {
    const tools = this.data_.tools ?? [];
    if (this.data_.mode !== 'closing') {
      const opening = playCards(this.ctx.chapter.id, this.cards, this.ctx.dict, this.picks, CHAPTER_OPENS, this.ctx.params, this.data_.tags ?? EMPTY_TAGS);
      beginRun(this, this.ctx, startChapter(this.ctx, { tags: opening.tags, clock: opening.clock, tools }));
      return;
    }
    // A new day: only what the closing cards decide carries over, not the ended chapter's own tags.
    const closing = playCards(this.ctx.chapter.id, this.cards, this.ctx.dict, this.picks, CHAPTER_OPENS, this.ctx.params, EMPTY_TAGS);
    const chapters = this.registry.get('chapters') as ReadonlyMap<string, ChapterContent>;
    const next = this.ctx.chapter.next !== undefined ? chapters.get(this.ctx.chapter.next) : undefined;
    // Deferred like beginRun: the confirming key must reach the input tracker before the next scene reads it.
    if (!next) {
      // The story is over, so "continue" must not lead back into the chapter just finished.
      saveStory(this, NO_STORY);
      this.registry.set('ended', true);
      window.setTimeout(() => this.scene.start('Title'), 0);
      return;
    }
    saveStory(this, { checkpoint: null, entry: { chapter: next.chapter.id, tags: closing.tags, tools } });
    const data: CardsData = { chapter: next.chapter.id, mode: 'opening', tags: closing.tags, tools };
    window.setTimeout(() => this.scene.restart(data), 0);
  }
}
