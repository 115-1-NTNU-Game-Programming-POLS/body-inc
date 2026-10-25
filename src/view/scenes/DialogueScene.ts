import Phaser from 'phaser';
import { SPEAKERS, str } from '../../app/content.ts';
import { portraitKey } from '../../app/dialogue.ts';
import { sharedKeys, type KeyboardInput } from '../../app/input.ts';
import type { FixedStepLoop } from '../../app/loop.ts';
import { selectDialogue, type ChapterContent, type ChapterState, type DialogueView, type GameEvent, type Settings } from '../../core/index.ts';
import { addText } from '../text/fonts.ts';
import { DIALOGUE, MEMO, REPLY } from '../text/styles.ts';

const INK = 0x0c2d5e;
const STAMP_RED = 0xc8372d;
const WHITE = 0xfbfaf6;
const NOTE = 0xf5df7a;
/** Dialogue box (art direction 12.5): 1184 x 200 at (48, 544), white with a 3 px ink outline. */
const BOX = { x: 48, y: 544, w: 1184, h: 200 } as const;
const TAG = { w: 160, h: 40 } as const;
/** Portrait (art direction 6.1): 300 px high, the bottom 80 px behind the box. */
const PORTRAIT = { x: 72, height: 300, hidden: 80 } as const;
/** The liver has no box; its portrait stands on the lower edge. */
const MEMO_PORTRAIT_BOTTOM = 704;
const SLIDE_PX = 520;
const SLIDE_MS = 180;
const SLIDE_STAGGER_MS = 60;
/** Six frames at 60 fps: 1.0 to 1.03 and back, in place of lip-sync (art direction 6.1). */
const BOUNCE_MS = 50;
const BLINK_MS = 400;

interface ReplyNote {
  readonly frame: Phaser.GameObjects.Graphics;
  readonly badge: Phaser.GameObjects.Graphics;
  readonly w: number;
  readonly h: number;
}

/**
 * The conversation on screen: a box with a name tag and portrait, or the liver's sticky note, and
 * the player's replies as notes sliding in from the right. It only draws what the chapter state
 * says; the conversation itself runs in core, and a click on a reply reaches it as a pick on the
 * next tick, like a key.
 */
export class DialogueScene extends Phaser.Scene {
  private keys!: KeyboardInput;
  private layer!: Phaser.GameObjects.Container;
  /** Which node is drawn: conversation and position. Empty when nothing is shown. */
  private shown = '';
  /** The spoken line drawn last, so replies appearing under it do not bounce the portrait again. */
  private spoken = '';
  private notes: ReplyNote[] = [];
  private cursor = -1;
  private marker: Phaser.GameObjects.Graphics | undefined;

  constructor() {
    super('Dialogue');
  }

  create(): void {
    this.keys = sharedKeys(this.registry, window);
    this.layer = this.add.container(0, 0);
    this.shown = '';
    this.spoken = '';
    this.notes = [];
    this.cursor = -1;
    this.marker = undefined;
  }

  override update(time: number): void {
    const loop = this.registry.get('loop') as FixedStepLoop<ChapterState, GameEvent> | undefined;
    const chapters = this.registry.get('chapters') as ReadonlyMap<string, ChapterContent> | undefined;
    const ctx = loop && chapters?.get(loop.state.run.chapter);
    const view = ctx && loop ? selectDialogue(ctx.dialogues, loop.state.dialogue) : undefined;
    if (!view) {
      if (this.shown !== '') {
        this.clear();
        this.shown = '';
        this.spoken = '';
      }
      return;
    }
    const key = `${view.id}:${view.at}`;
    if (key !== this.shown) this.show(view, key);
    else if (view.cursor !== this.cursor) this.paint(view.cursor);
    this.marker?.setAlpha(Math.floor(time / BLINK_MS) % 2 === 0 ? 1 : 0.25);
  }

  private textScale(): number {
    return (this.registry.get('settings') as Settings | undefined)?.textScale ?? 1;
  }

  private put<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.layer.add(o);
    return o;
  }

  private clear(): void {
    this.tweens.killAll();
    this.layer.removeAll(true);
    this.notes = [];
    this.cursor = -1;
    this.marker = undefined;
  }

  private show(view: DialogueView, key: string): void {
    this.clear();
    this.shown = key;
    const scale = this.textScale();
    const line = view.line;
    const speaker = line ? SPEAKERS[line.speaker] : undefined;
    const memo = speaker?.style === 'memo';
    if (line && speaker) {
      const spoken = `${line.speaker}|${line.expression}|${line.text}`;
      const bounce = spoken !== this.spoken;
      this.spoken = spoken;
      const portrait = speaker.portrait ? this.portrait(line.speaker, line.expression, memo ? MEMO_PORTRAIT_BOTTOM : BOX.y + PORTRAIT.hidden) : undefined;
      if (portrait && bounce) {
        this.tweens.add({ targets: portrait, scaleY: portrait.scaleY * 1.03, duration: BOUNCE_MS, yoyo: true, ease: 'Sine.easeOut' });
      }
      if (memo) this.memo(line.text, scale);
      else this.box(line.speaker, line.text, scale);
    }
    const choosing = view.options.length > 0;
    if (choosing) this.replies(view.options, memo ? MEMO.replyBottom : BOX.y - 16, scale);
    else if (line && !memo) this.continueMark();
    this.put(addText(this, BOX.x + BOX.w, this.scale.height - 2, str(choosing ? 'dialogue.hint_choose' : 'dialogue.hint'), {
      role: 'print', weight: 700, size: 16, color: '#e8edf5', backgroundColor: 'rgba(12, 45, 94, 0.82)', padding: { x: 6, y: 2 },
    }).setOrigin(1, 1));
    this.paint(view.cursor);
  }

  private portrait(speaker: string, expression: string, bottom: number): Phaser.GameObjects.Image {
    const image = this.put(this.add.image(PORTRAIT.x, bottom, portraitKey(speaker, expression)).setOrigin(0, 1));
    return image.setScale(PORTRAIT.height / image.height);
  }

  private box(speaker: string, text: string, scale: number): void {
    const g = this.put(this.add.graphics());
    g.fillStyle(INK, 0.35).fillRect(BOX.x + 6, BOX.y + 6, BOX.w, BOX.h);
    g.fillStyle(WHITE).fillRect(BOX.x, BOX.y, BOX.w, BOX.h);
    g.lineStyle(3, INK, 1).strokeRect(BOX.x + 1.5, BOX.y + 1.5, BOX.w - 3, BOX.h - 3);
    const tag = { x: BOX.x + 24, y: BOX.y - TAG.h / 2 };
    g.fillStyle(INK, 0.35).fillRect(tag.x + 4, tag.y + 4, TAG.w, TAG.h);
    g.fillStyle(NOTE).fillRect(tag.x, tag.y, TAG.w, TAG.h);
    g.lineStyle(2, INK, 1).strokeRect(tag.x + 1, tag.y + 1, TAG.w - 2, TAG.h - 2);
    this.put(addText(this, tag.x + TAG.w / 2, tag.y + TAG.h / 2, str(`speaker.${speaker}`), {
      role: 'hand', weight: 700, size: 22, color: '#0c2d5e',
    }).setOrigin(0.5));
    this.put(addText(this, BOX.x + 32, BOX.y + 24, text, {
      role: DIALOGUE.role, weight: 400, size: DIALOGUE.fontSize * scale, color: '#1d2433', maxWidth: DIALOGUE.maxWidth(scale), lineHeight: DIALOGUE.lineHeight,
    }));
  }

  private memo(text: string, scale: number): void {
    const g = this.put(this.add.graphics());
    const { x, y } = MEMO.at;
    g.fillStyle(INK, 0.35).fillRect(x + 6, y + 6, MEMO.noteWidth, MEMO.noteHeight);
    g.fillStyle(NOTE).fillRect(x, y, MEMO.noteWidth, MEMO.noteHeight);
    g.lineStyle(2, INK, 1).strokeRect(x + 1, y + 1, MEMO.noteWidth - 2, MEMO.noteHeight - 2);
    this.put(addText(this, x + MEMO.padding, y + MEMO.padding, text, {
      role: MEMO.role, weight: 400, size: MEMO.fontSize * scale, color: '#2b2b2b', maxWidth: MEMO.maxWidth(scale), lineHeight: MEMO.lineHeight,
    }));
  }

  /** Replies stack upward from `bottom`, right-aligned with the box, each sliding in a little after the one below. */
  private replies(options: readonly string[], bottom: number, scale: number): void {
    const x = BOX.x + BOX.w - REPLY.noteWidth;
    const texts = options.map((o) => addText(this, REPLY.padding, REPLY.padding, o, {
      role: REPLY.role, weight: 400, size: REPLY.fontSize * scale, color: '#2b2b2b', maxWidth: REPLY.maxWidth(scale), lineHeight: REPLY.lineHeight,
    }));
    let y = bottom;
    for (let i = options.length - 1; i >= 0; i--) {
      const text = texts[i]!;
      const h = Math.ceil(text.displayHeight) + 2 * REPLY.padding;
      y -= h;
      const frame = this.add.graphics();
      const badge = this.add.graphics();
      const number = addText(this, -16, 17, String(i + 1), { role: 'print', weight: 700, size: 16, color: '#fbfaf6' }).setOrigin(0.5);
      const zone = this.add.zone(0, 0, REPLY.noteWidth, h).setOrigin(0, 0).setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => this.keys.queuePick(i + 1));
      const note = this.put(this.add.container(x + SLIDE_PX, y, [frame, badge, text, number, zone]));
      note.setAlpha(0);
      this.tweens.add({ targets: note, x, alpha: 1, duration: SLIDE_MS, delay: (options.length - 1 - i) * SLIDE_STAGGER_MS, ease: 'Cubic.easeOut' });
      this.notes[i] = { frame, badge, w: REPLY.noteWidth, h };
      y -= REPLY.gap;
    }
  }

  /** Redraws the reply frames: the chosen note has the heavy outline and the red badge. */
  private paint(cursor: number): void {
    this.cursor = cursor;
    this.notes.forEach((n, i) => {
      const on = i === cursor;
      n.frame.clear();
      n.frame.fillStyle(INK, 0.35).fillRect(4, 4, n.w, n.h);
      n.frame.fillStyle(NOTE).fillRect(0, 0, n.w, n.h);
      n.frame.lineStyle(on ? 3 : 1, INK, on ? 1 : 0.5).strokeRect(on ? 1.5 : 0.5, on ? 1.5 : 0.5, n.w - (on ? 3 : 1), n.h - (on ? 3 : 1));
      n.badge.clear();
      n.badge.fillStyle(on ? STAMP_RED : INK).fillCircle(-16, 17, 12);
    });
  }

  /** A small blinking triangle at the box corner: a spoken line waits to be dismissed. */
  private continueMark(): void {
    const g = this.put(this.add.graphics());
    g.fillStyle(INK).fillTriangle(BOX.x + BOX.w - 48, BOX.y + BOX.h - 36, BOX.x + BOX.w - 30, BOX.y + BOX.h - 36, BOX.x + BOX.w - 39, BOX.y + BOX.h - 24);
    this.marker = g;
  }
}
