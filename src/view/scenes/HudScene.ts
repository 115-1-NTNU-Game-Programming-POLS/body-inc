import Phaser from 'phaser';
import type { FixedStepLoop } from '../../app/loop.ts';
import { selectTick, TICK_HZ } from '../../core/index.ts';

/** Overlay at scale 1, separate from World so hit-stop and camera zoom never affect UI. */
export class HudScene extends Phaser.Scene {
  private label!: Phaser.GameObjects.Text;

  constructor() {
    super('Hud');
  }

  create(): void {
    this.label = this.add.text(12, 10, '', { fontFamily: 'sans-serif', fontSize: '14px', color: '#e8edf5' });
  }

  override update(): void {
    const loop = this.registry.get('loop') as FixedStepLoop | undefined;
    if (!loop) return;
    const t = selectTick(loop.state);
    this.label.setText(`WASD 移動　F1 碰撞框　rule time ${(t / TICK_HZ).toFixed(1)} s`);
  }
}
