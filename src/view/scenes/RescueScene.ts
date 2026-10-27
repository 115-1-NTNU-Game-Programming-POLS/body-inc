import Phaser from 'phaser';
import { str } from '../../app/content.ts';
import { sharedKeys, type KeyboardInput } from '../../app/input.ts';
import type { FixedStepLoop } from '../../app/loop.ts';
import { offered, rescueComplete, rescueOf, type ChapterContent, type ChapterState, type GameEvent, type RescueState, type Settings } from '../../core/index.ts';
import { addText } from '../text/fonts.ts';

const INK = 0x0c2d5e;
const PAPER = 0xfbfaf6;
const STAMP_RED = 0xc8372d;
const PANEL = { w: 720, padding: 28, row: 44 } as const;

/**
 * The rescue panel over the frozen room (design doc 7.7). Like the card scene it only draws: the
 * sequence runs in core, and a click on an action reaches core as a pick on the next tick. Every
 * action stays on the list until it is the right one and done, so nothing here can end it badly.
 */
export class RescueScene extends Phaser.Scene {
  private keys!: KeyboardInput;
  private layer!: Phaser.GameObjects.Container;
  /** What is drawn, so the panel is rebuilt only when the rescue state changes. */
  private shown = '';

  constructor() {
    super('Rescue');
  }

  create(): void {
    this.keys = sharedKeys(this.registry, window);
    this.layer = this.add.container(0, 0);
    this.shown = '';
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.clear());
  }

  override update(): void {
    const loop = this.registry.get('loop') as FixedStepLoop<ChapterState, GameEvent> | undefined;
    const chapters = this.registry.get('chapters') as ReadonlyMap<string, ChapterContent> | undefined;
    const rescue = loop?.state.rescue;
    const ctx = loop && chapters?.get(loop.state.run.chapter);
    if (!rescue || !ctx) {
      if (this.shown !== '') {
        this.clear();
        this.keys.ignoreMouse(false);
      }
      return;
    }
    const key = `${rescue.id}|${rescue.done}|${rescue.cursor}|${JSON.stringify(rescue.reply)}`;
    if (key !== this.shown) this.show(ctx, rescue, key);
  }

  private clear(): void {
    this.layer.removeAll(true);
    this.shown = '';
  }

  private show(ctx: ChapterContent, s: RescueState, key: string): void {
    this.clear();
    this.shown = key;
    // Mouse0 is also attack, which confirms the highlighted action: a click must count only on an action.
    this.keys.ignoreMouse(true);
    const r = rescueOf(ctx, s.id);
    const at = `rescue.${r.id}`;
    const label = (a: string) => str(`${at}.action.${a}`);
    const scale = (this.registry.get('settings') as Settings | undefined)?.textScale ?? 1;
    const inner = PANEL.w - 2 * PANEL.padding;
    const left = (this.scale.width - PANEL.w) / 2;
    const items: Phaser.GameObjects.GameObject[] = [];
    let y = PANEL.padding;
    const text = (t: string, size: number, color: string, weight: 400 | 700 = 400) => {
      const o = addText(this, PANEL.padding, y, t, { role: 'print', weight, size: size * scale, color, maxWidth: inner, lineHeight: 1.5 });
      items.push(o);
      y += o.displayHeight + 12;
      return o;
    };
    text(str('rescue.title'), 22, '#0c2d5e', 700);
    text(str(`${at}.prompt`), 18, '#2b3448');
    text(str('rescue.progress').replace('{n}', String(Math.min(s.done, r.steps.length))).replace('{total}', String(r.steps.length)), 15, '#5a6478', 700);

    const reply = s.reply;
    if (reply) {
      const said = reply.kind === 'early' ? str(`${at}.early`).replace('{step}', label(reply.next)) : str(`${at}.reply.${reply.action}`);
      text(said, 18, reply.kind === 'step' ? '#0c2d5e' : '#8a2a22', 700);
      if (reply.kind === 'step' && reply.helped) text(str(`${at}.helper`), 18, '#0c2d5e', 700);
    }

    const rows: { y: number; on: boolean }[] = [];
    if (rescueComplete(r, s)) {
      text(str(`${at}.done`), 20, '#0c2d5e', 700);
      text(str('rescue.continue'), 15, '#5a6478');
    } else {
      y += 4;
      offered(r, s.done).forEach((a, i) => {
        const on = i === s.cursor;
        const row = addText(this, PANEL.padding + 40, y + 8, label(a), { role: 'print', weight: on ? 700 : 400, size: 18 * scale, color: '#0c2d5e', maxWidth: inner - 40 });
        const number = addText(this, PANEL.padding + 14, y + PANEL.row / 2, String(i + 1), { role: 'print', weight: 700, size: 15, color: '#fbfaf6' }).setOrigin(0.5);
        const h = Math.max(PANEL.row, row.displayHeight + 16);
        const zone = this.add.zone(PANEL.padding, y, inner, h).setOrigin(0, 0).setInteractive({ useHandCursor: true });
        zone.on('pointerdown', () => this.keys.queuePick(i + 1));
        rows.push({ y, on });
        items.push(row, number, zone);
        y += h + 6;
      });
      text(str('rescue.hint'), 14, '#5a6478');
    }

    const h = y + PANEL.padding - 12;
    const top = Math.max(24, (this.scale.height - h) / 2);
    const g = this.add.graphics();
    g.fillStyle(INK, 0.2).fillRoundedRect(6, 6, PANEL.w, h, 12);
    g.fillStyle(PAPER).fillRoundedRect(0, 0, PANEL.w, h, 12).lineStyle(2, INK, 1).strokeRoundedRect(1, 1, PANEL.w - 2, h - 2, 12);
    for (const row of rows) {
      g.lineStyle(row.on ? 3 : 1, INK, row.on ? 1 : 0.35).strokeRoundedRect(PANEL.padding, row.y, inner, PANEL.row, 6);
      g.fillStyle(row.on ? STAMP_RED : INK).fillCircle(PANEL.padding + 14, row.y + PANEL.row / 2, 11);
    }
    this.layer.add(this.add.rectangle(0, 0, this.scale.width, this.scale.height, INK, 0.72).setOrigin(0, 0));
    this.layer.add(this.add.container(left, top, [g, ...items]));
  }
}
