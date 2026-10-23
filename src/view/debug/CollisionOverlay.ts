import Phaser from 'phaser';
import { OPERATOR_BODY, TILE, type SolidGrid } from '../../core/index.ts';

/** F1 debug view of what core collides with, drawn from core data rather than sprite bounds. */
export class CollisionOverlay {
  private readonly tiles: Phaser.GameObjects.Graphics;
  private readonly body: Phaser.GameObjects.Rectangle;
  private visible = false;

  constructor(scene: Phaser.Scene, grid: SolidGrid) {
    this.tiles = scene.add.graphics().setDepth(1e6).setVisible(false);
    this.tiles.fillStyle(0xff3b30, 0.25);
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        if (grid.solid[r * grid.cols + c]) this.tiles.fillRect(c * TILE, r * TILE, TILE, TILE);
      }
    }
    this.body = scene.add.rectangle(0, 0, OPERATOR_BODY.halfW * 2, OPERATOR_BODY.height)
      .setOrigin(0.5, 1).setStrokeStyle(1, 0x00e5ff).setDepth(1e6).setVisible(false);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.tiles.setVisible(this.visible);
    this.body.setVisible(this.visible);
  }

  /** Same interpolated position as the sprite, so the box never runs a tick ahead of it. */
  render(x: number, y: number): void {
    if (this.visible) this.body.setPosition(x, y);
  }
}
