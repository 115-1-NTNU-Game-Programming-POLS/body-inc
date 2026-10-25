import Phaser from 'phaser';
import { addText } from '../text/fonts.ts';
import { CARD } from '../text/styles.ts';

const INK = 0x0c2d5e;
const STAMP_RED = 0xc8372d;
const PAPER = 0xfbfaf6;
/** Life cards carry this strip on top (art direction 8.1: one card frame, told apart by the top strip). */
const LIFE_STRIP = 0xf5df7a;
/** Hand-written paper corners (art direction 8.1): top left 16, top right 6, bottom right 18, bottom left 8. */
const CORNERS = { tl: 16, tr: 6, br: 18, bl: 8 };
const SHADOW = 6;
const STRIP_H = 10;
const BADGE_R = 14;
const MIN_HEIGHT = 220;

export interface CardTexts {
  /** A small line above the question, e.g. which card of how many. */
  readonly caption?: string;
  readonly title: string;
  readonly options: readonly { readonly label: string; readonly note: string }[];
}

interface Face {
  readonly frame: Phaser.GameObjects.Graphics;
  readonly badge: Phaser.GameObjects.Graphics;
  readonly h: number;
}

/**
 * One card question and its 2 to 3 options laid side by side as paper cards, centred on the
 * screen. It only draws: what a click or key means is up to the scene, through `onPick`.
 */
export class CardTable {
  private readonly layer: Phaser.GameObjects.Container;
  private readonly faces: Face[] = [];

  constructor(scene: Phaser.Scene, texts: CardTexts, scale: number, onPick: (index: number) => void, onHover?: (index: number) => void) {
    this.layer = scene.add.container(0, 0);
    const cx = scene.scale.width / 2;
    let y = 96;
    if (texts.caption) {
      this.layer.add(addText(scene, cx, y, texts.caption, { role: 'print', weight: 700, size: 18 * scale, color: '#c9d3e3' }).setOrigin(0.5, 0));
      y += 36 * scale;
    }
    const title = addText(scene, cx, y, texts.title, {
      role: CARD.title.role, weight: 700, size: CARD.title.fontSize * scale, color: '#fbfaf6', maxWidth: CARD.title.maxWidth(scale), lineHeight: CARD.title.lineHeight,
    }).setOrigin(0.5, 0).setAlign('center');
    this.layer.add(title);
    const top = y + title.displayHeight + 40;

    const n = texts.options.length;
    const left = cx - (n * CARD.width + (n - 1) * CARD.gap) / 2;
    const bodies = texts.options.map((o, i) => {
      const label = addText(scene, CARD.padding, STRIP_H + 44, o.label, {
        role: CARD.label.role, weight: 700, size: CARD.label.fontSize * scale, color: '#0c2d5e', maxWidth: CARD.innerWidth, lineHeight: CARD.label.lineHeight,
      });
      const note = addText(scene, CARD.padding, label.y + label.displayHeight + 14, o.note, {
        role: CARD.note.role, weight: 400, size: CARD.note.fontSize * scale, color: '#2b3448', maxWidth: CARD.innerWidth, lineHeight: CARD.note.lineHeight,
      });
      const number = addText(scene, CARD.padding + BADGE_R, STRIP_H + 22, String(i + 1), { role: 'print', weight: 700, size: 16, color: '#fbfaf6' }).setOrigin(0.5);
      return { label, note, number, bottom: note.y + note.displayHeight + CARD.padding };
    });
    // Every card as tall as the tallest, so the row reads as one hand of cards.
    const h = Math.max(MIN_HEIGHT, ...bodies.map((b) => Math.ceil(b.bottom)));
    bodies.forEach((b, i) => {
      const frame = scene.add.graphics();
      const badge = scene.add.graphics();
      const zone = scene.add.zone(0, 0, CARD.width, h).setOrigin(0, 0).setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => onPick(i));
      if (onHover) zone.on('pointerover', () => onHover(i));
      this.layer.add(scene.add.container(left + i * (CARD.width + CARD.gap), top, [frame, badge, b.label, b.note, b.number, zone]));
      this.faces.push({ frame, badge, h });
    });
  }

  /** Redraws the frames: the highlighted card has the heavy outline and the red badge. */
  paint(cursor: number): void {
    this.faces.forEach((f, i) => {
      const on = i === cursor;
      const g = f.frame.clear();
      g.fillStyle(INK, 0.2).fillRoundedRect(SHADOW, SHADOW, CARD.width, f.h, CORNERS);
      g.fillStyle(PAPER).fillRoundedRect(0, 0, CARD.width, f.h, CORNERS);
      g.fillStyle(LIFE_STRIP).fillRect(CORNERS.tl, 0, CARD.width - CORNERS.tl - CORNERS.tr, STRIP_H);
      g.lineStyle(on ? 3 : 1, INK, on ? 1 : 0.5).strokeRoundedRect(on ? 1.5 : 0.5, on ? 1.5 : 0.5, CARD.width - (on ? 3 : 1), f.h - (on ? 3 : 1), CORNERS);
      f.badge.clear().fillStyle(on ? STAMP_RED : INK).fillCircle(CARD.padding + BADGE_R, STRIP_H + 22, BADGE_R);
    });
  }

  destroy(): void {
    this.layer.destroy(true);
    this.faces.length = 0;
  }
}
