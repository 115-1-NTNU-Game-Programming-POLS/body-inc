import Phaser from 'phaser';
import { HANDBOOK, str } from '../../app/content.ts';
import { titleKey } from '../../app/handbook.ts';
import type { ProgressData, Settings } from '../../core/index.ts';
import { addText } from '../text/fonts.ts';
import { HANDBOOK as LAYOUT } from '../text/styles.ts';

const INK = 0x0c2d5e;
const PAPER = 0xf4efe4;
const HIGHLIGHT = 0xdfe6f2;
const PANEL = { x: 80, y: 56, w: 1120, h: 656 };
const INDEX = { x: 104, top: 168, step: 44, width: 300 };

/**
 * The employee handbook over the paused room (design doc 5.2: Tab). It only reads the progress
 * slot and draws; pages are unlocked elsewhere. Every page is listed, unfound ones as "???", so
 * the player sees how much is left to find.
 */
export class HandbookScene extends Phaser.Scene {
  private cursor = 0;
  private page!: Phaser.GameObjects.Container;
  private index: Phaser.GameObjects.Rectangle[] = [];

  constructor() {
    super('Handbook');
  }

  create(): void {
    const owned = new Set((this.registry.get('progress') as ProgressData | undefined)?.handbook ?? []);
    const scale = (this.registry.get('settings') as Settings | undefined)?.textScale ?? 1;
    const pages = HANDBOOK.pages;
    this.cursor = Math.max(0, pages.findIndex((p) => owned.has(p.id)));

    this.add.rectangle(0, 0, this.scale.width, this.scale.height, INK, 0.85).setOrigin(0, 0);
    this.add.rectangle(PANEL.x, PANEL.y, PANEL.w, PANEL.h, PAPER).setOrigin(0, 0).setStrokeStyle(3, INK);
    this.add.rectangle(LAYOUT.pageX - 32, PANEL.y + 24, 2, PANEL.h - 48, INK, 0.4).setOrigin(0, 0);
    addText(this, INDEX.x, 80, str('handbook.heading'), { role: 'hand', weight: 700, size: 32 * scale, color: '#0c2d5e' });
    const count = str('handbook.count').replace('{n}', String(pages.filter((p) => owned.has(p.id)).length)).replace('{total}', String(pages.length));
    addText(this, INDEX.x, 124, count, { role: 'print', weight: 400, size: 18 * scale, color: '#0c2d5e' });
    this.index = pages.map((p, i) => {
      const y = INDEX.top + i * INDEX.step;
      const row = this.add.rectangle(INDEX.x - 8, y - 6, INDEX.width, INDEX.step - 6, HIGHLIGHT).setOrigin(0, 0);
      addText(this, INDEX.x, y, owned.has(p.id) ? str(titleKey(p.id)) : str('handbook.unfound'), {
        role: 'print', weight: 400, size: 20 * scale, color: '#0c2d5e',
      });
      return row;
    });
    this.page = this.add.container(0, 0);
    addText(this, this.scale.width - 24, this.scale.height - 16, str('handbook.hint'), {
      role: 'print', weight: 400, size: 18 * scale, color: '#e8edf5',
    }).setOrigin(1, 1);
    this.show(owned, scale);

    const kb = this.input.keyboard!;
    kb.addCapture('TAB');
    const move = (by: number) => (e: KeyboardEvent) => {
      if (pages.length === 0) return;
      e.preventDefault();
      this.cursor = (this.cursor + by + pages.length) % pages.length;
      this.show(owned, scale);
    };
    for (const k of ['W', 'UP']) kb.on(`keydown-${k}`, move(-1));
    for (const k of ['S', 'DOWN']) kb.on(`keydown-${k}`, move(1));
    for (const k of ['TAB', 'ESC']) kb.on(`keydown-${k}`, (e: KeyboardEvent) => { if (!e.repeat) this.close(); });
  }

  private close(): void {
    this.scene.resume('World');
    this.scene.stop();
  }

  private show(owned: ReadonlySet<string>, scale: number): void {
    this.page.removeAll(true);
    this.index.forEach((r, i) => r.setVisible(i === this.cursor));
    const p = HANDBOOK.pages[this.cursor];
    if (!p) return;
    const x = LAYOUT.pageX;
    if (!owned.has(p.id)) {
      this.page.add(addText(this, x, 80, str('handbook.missing'), { role: 'print', weight: 400, size: 20 * scale, color: '#0c2d5e' }));
      return;
    }
    const t = LAYOUT.title;
    this.page.add(addText(this, x, 80, `〈${str(titleKey(p.id))}〉`, { role: t.role, weight: t.weight, size: t.fontSize * scale, color: '#0c2d5e' }));
    let y = LAYOUT.bodyTop;
    const b = LAYOUT.body;
    for (const key of p.body) {
      const text = addText(this, x, y, str(key), {
        role: b.role, weight: b.weight, size: b.fontSize * scale, lineHeight: b.lineHeight, maxWidth: LAYOUT.pageWidth, color: '#1d2433',
      });
      this.page.add(text);
      y += text.height + LAYOUT.paragraphGap;
    }
    this.page.add(addText(this, x, LAYOUT.bodyTop + LAYOUT.bodyHeight + 12, str('handbook.footer'), {
      role: 'print', weight: 400, size: 16 * scale, color: '#5a6170',
    }));
  }
}
