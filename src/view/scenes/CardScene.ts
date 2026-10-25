import Phaser from 'phaser';
import { str } from '../../app/content.ts';
import { sharedKeys, type KeyboardInput } from '../../app/input.ts';
import type { FixedStepLoop } from '../../app/loop.ts';
import { cardText, eventCard, type ChapterContent, type ChapterState, type GameEvent, type Settings } from '../../core/index.ts';
import { addText } from '../text/fonts.ts';
import { CardTable } from '../ui/cardTable.ts';

const INK = 0x0c2d5e;

/**
 * An event card over the frozen room. Like the dialogue scene it only draws: the card runs in
 * core, the highlight comes from the chapter state, and a click on an option reaches core as a
 * pick on the next tick.
 */
export class CardScene extends Phaser.Scene {
  private keys!: KeyboardInput;
  private layer!: Phaser.GameObjects.Container;
  private table: CardTable | undefined;
  /** The card drawn, or empty when none is shown. */
  private shown = '';
  private cursor = -1;

  constructor() {
    super('Card');
  }

  create(): void {
    this.keys = sharedKeys(this.registry, window);
    this.keys.ignoreMouse(false);
    this.layer = this.add.container(0, 0);
    this.table = undefined;
    this.shown = '';
    this.cursor = -1;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.clear());
  }

  override update(): void {
    const loop = this.registry.get('loop') as FixedStepLoop<ChapterState, GameEvent> | undefined;
    const chapters = this.registry.get('chapters') as ReadonlyMap<string, ChapterContent> | undefined;
    const card = loop?.state.card;
    const ctx = loop && chapters?.get(loop.state.run.chapter);
    if (!card || !ctx) {
      if (this.shown !== '') {
        this.clear();
        this.keys.ignoreMouse(false);
      }
      return;
    }
    if (card.id !== this.shown) this.show(ctx, card.id);
    if (card.cursor !== this.cursor) {
      this.cursor = card.cursor;
      this.table?.paint(card.cursor);
    }
  }

  private clear(): void {
    this.table?.destroy();
    this.table = undefined;
    this.layer.removeAll(true);
    this.shown = '';
    this.cursor = -1;
  }

  private show(ctx: ChapterContent, id: string): void {
    this.clear();
    this.shown = id;
    // Mouse0 is also attack, which confirms the highlighted option: a click must count only on a card.
    this.keys.ignoreMouse(true);
    const card = eventCard(ctx, id);
    const t = cardText(ctx.deck!.chapter, card.id);
    const scale = (this.registry.get('settings') as Settings | undefined)?.textScale ?? 1;
    this.layer.add(this.add.rectangle(0, 0, this.scale.width, this.scale.height, INK, 0.72).setOrigin(0, 0));
    this.table = new CardTable(this, {
      caption: str('deck.event'),
      title: str(t.title),
      options: card.options.map((o) => ({ label: str(t.option(o.id)), note: str(t.note(o.id)) })),
    }, scale, (i) => this.keys.queuePick(i + 1));
    this.layer.add(addText(this, this.scale.width - 24, this.scale.height - 24, str('deck.hint'), {
      role: 'print', weight: 400, size: 18, color: '#e8edf5',
    }).setOrigin(1, 1));
  }
}
