import Phaser from 'phaser';
import type { FixedStepLoop } from '../../app/loop.ts';
import { selectHearts, selectTick, TICK_HZ } from '../../core/index.ts';
import { STRINGS } from '../../app/content.ts';
import { issueMessage, type SaveIssue } from '../../app/storage.ts';
import { addText, updateText } from '../text/fonts.ts';
import type { WorldNote } from './WorldScene.ts';

const str = (key: string): string => {
  const s = STRINGS.strings[key];
  if (!s) throw new Error(`content/strings has no "${key}"`);
  return s.text;
};

/** 7 x 6 heart, drawn at 4 px per cell; '#' is filled. */
const HEART = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
const CELL = 4;
const HEART_COLOR = 0xf08a80;
const EMPTY_COLOR = 0x3b4660;
const NOTE_SECONDS = 2.5;

/** Overlay at scale 1, separate from World so hit-stop and camera zoom never affect UI. */
export class HudScene extends Phaser.Scene {
  private controls!: Phaser.GameObjects.Text;
  private clock!: Phaser.GameObjects.Text;
  private hearts!: Phaser.GameObjects.Graphics;
  private shownHalves = -1;
  private shownSeconds = '';

  constructor() {
    super('Hud');
  }

  create(): void {
    this.hearts = this.add.graphics();
    this.controls = addText(this, 12, 46, str('hud.controls'), { role: 'print', weight: 700, size: 16, color: '#e8edf5' });
    this.clock = addText(this, 12, 70, '', { role: 'print', weight: 400, size: 16, color: '#e8edf5' });
this.saveNotices((this.registry.get('save-issues') as readonly SaveIssue[] | undefined) ?? []);
    const onNote = (n: WorldNote) => this.note(n);
    this.game.events.on('world-note', onNote);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.game.events.off('world-note', onNote));
  }

/** One line per distinct message, bottom left, kept on screen: lost progress must not go unnoticed. */
  private saveNotices(issues: readonly SaveIssue[]): void {
    const keys = [...new Set(issues.map(issueMessage).filter((k): k is string => k !== undefined))];
    keys.forEach((key, i) => {
      addText(this, 12, this.scale.height - 12 - (keys.length - 1 - i) * 26, str(key), {
        role: 'print', weight: 700, size: 16, color: '#2b2b2b', backgroundColor: '#f2c94c', padding: { x: 8, y: 3 },
      }).setOrigin(0, 1);
    });
  }

  /** Gray memo above the object (art direction 9.2), converted from world to screen once. */
  private note(n: WorldNote): void {
    const cam = this.scene.get('World').cameras.main;
    const sx = (n.worldX - cam.worldView.x) * cam.zoom;
    const sy = (n.worldY - cam.worldView.y) * cam.zoom;
    // Handwritten role: notes are the operator's sticky memos (art direction 8.2).
    const text = addText(this, sx, sy, n.text, {
      role: 'hand', weight: 400, size: 22, color: '#2b2b2b', backgroundColor: '#d9d6cf', padding: { x: 8, y: 4 },
    }).setOrigin(0.5, 1);
    this.tweens.add({ targets: text, alpha: 0, delay: (NOTE_SECONDS - 0.4) * 1000, duration: 400, onComplete: () => text.destroy() });
  }

  private drawHearts(halves: number, maxHalves: number): void {
    const g = this.hearts.clear();
    for (let h = 0; h < maxHalves / 2; h++) {
      const ox = 12 + h * (HEART[0]!.length * CELL + 6);
      HEART.forEach((row, r) => {
        for (let c = 0; c < row.length; c++) {
          if (row[c] !== '#') continue;
          // Left half of a heart is the first half point, right half the second.
          const half = h * 2 + (c < 3 ? 1 : 2);
          const filled = halves >= half || (c === 3 && halves >= h * 2 + 1);
          g.fillStyle(filled ? HEART_COLOR : EMPTY_COLOR).fillRect(ox + c * CELL, 12 + r * CELL, CELL, CELL);
        }
      });
    }
  }

  override update(): void {
    const loop = this.registry.get('loop') as FixedStepLoop | undefined;
    if (!loop) return;
    const { halves, maxHalves } = selectHearts(loop.state);
    if (halves !== this.shownHalves) {
      this.shownHalves = halves;
      this.drawHearts(halves, maxHalves);
    }
    const seconds = (selectTick(loop.state) / TICK_HZ).toFixed(1);
    if (seconds !== this.shownSeconds) {
      this.shownSeconds = seconds;
      updateText(this.clock, str('hud.rule_time').replace('{seconds}', seconds));
    }
  }
}
