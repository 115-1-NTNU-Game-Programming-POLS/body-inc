import Phaser from 'phaser';
import type { FixedStepLoop } from '../../app/loop.ts';
import { selectHearts, selectTick, TICK_HZ } from '../../core/index.ts';
import type { WorldNote } from './WorldScene.ts';

/** 7 x 6 heart, drawn at 4 px per cell; '#' is filled. */
const HEART = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
const CELL = 4;
const HEART_COLOR = 0xf08a80;
const EMPTY_COLOR = 0x3b4660;
const NOTE_SECONDS = 2.5;

/** Overlay at scale 1, separate from World so hit-stop and camera zoom never affect UI. */
export class HudScene extends Phaser.Scene {
  private label!: Phaser.GameObjects.Text;
  private hearts!: Phaser.GameObjects.Graphics;
  private shownHalves = -1;

  constructor() {
    super('Hud');
  }

  create(): void {
    this.hearts = this.add.graphics();
    this.label = this.add.text(12, 46, '', { fontFamily: 'sans-serif', fontSize: '14px', color: '#e8edf5' });
    const onNote = (n: WorldNote) => this.note(n);
    this.game.events.on('world-note', onNote);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.game.events.off('world-note', onNote));
  }

  /** Gray memo above the object (art direction 9.2), converted from world to screen once. */
  private note(n: WorldNote): void {
    const cam = this.scene.get('World').cameras.main;
    const sx = (n.worldX - cam.worldView.x) * cam.zoom;
    const sy = (n.worldY - cam.worldView.y) * cam.zoom;
    const text = this.add.text(sx, sy, n.text, {
      fontFamily: '"LXGW WenKai TC", "Noto Sans TC", sans-serif', fontSize: '20px', color: '#2b2b2b',
      backgroundColor: '#d9d6cf', padding: { x: 8, y: 4 },
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
    const t = selectTick(loop.state);
    this.label.setText(`WASD 移動　J／左鍵 釘書機（按住連射）　空白／K 閃身　F1 碰撞框　rule time ${(t / TICK_HZ).toFixed(1)} s`);
  }
}
