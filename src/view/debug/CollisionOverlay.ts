import Phaser from 'phaser';
import {
  boxAt, centeredBox, enemyHurtbox, isHittable, OPERATOR_BODY, OPERATOR_HURT, strikeBox, TILE, type Box, type GameState,
} from '../../core/index.ts';

/**
 * F1 debug view of what core collides with, drawn from core boxes rather than sprite bounds:
 * walls red, operator body cyan and hurtbox green, enemy hurtboxes yellow, live strikes magenta,
 * staples white. It shows the latest tick, so it can lead the interpolated sprites by a tick.
 */
export class CollisionOverlay {
  private readonly tiles: Phaser.GameObjects.Graphics;
  private readonly boxes: Phaser.GameObjects.Graphics;
  private visible = false;

  constructor(scene: Phaser.Scene, state: GameState) {
    const grid = state.room.grid;
    this.tiles = scene.add.graphics().setDepth(1e6).setVisible(false);
    this.tiles.fillStyle(0xff3b30, 0.25);
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        if (grid.solid[r * grid.cols + c]) this.tiles.fillRect(c * TILE, r * TILE, TILE, TILE);
      }
    }
    this.boxes = scene.add.graphics().setDepth(1e6 + 1).setVisible(false);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.tiles.setVisible(this.visible);
    this.boxes.setVisible(this.visible);
  }

  render(state: GameState): void {
    if (!this.visible) return;
    const g = this.boxes.clear();
    const draw = (b: Box, color: number) => g.lineStyle(1, color, 1).strokeRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
    const op = state.operator;
    draw(boxAt(OPERATOR_BODY, op.x, op.y), 0x00e5ff);
    draw(boxAt(OPERATOR_HURT, op.x, op.y), 0x34c759);
    for (const e of state.enemies) {
      if (isHittable(e)) draw(enemyHurtbox(e), 0xffd60a);
      if (e.phase === 'strike') draw(strikeBox(e), 0xff2d95);
    }
    for (const p of state.projectiles) draw(centeredBox(p.x, p.y, 2, 2), 0xffffff);
  }
}
