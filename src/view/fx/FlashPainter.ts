import Phaser from 'phaser';
import { flashLook, type HitAs, type Warning } from '../../app/comfort.ts';
import { comfortIn } from './comfortIn.ts';

const INK = 0x0c2d5e;
/** Four copies one pixel off in each direction make a 1 px outline that stays crisp under the 2x camera. */
const OFFSETS: ReadonlyArray<readonly [number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]];

/**
 * Draws a sprite's flash, or the form "reduce flashes" gives it (art direction 9.2). The caller
 * has placed the sprite and chosen its frame for the frame; this may shift it a pixel and puts
 * the outline behind it.
 */
export class FlashPainter {
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly hitAs: HitAs;
  private copies: Phaser.GameObjects.Sprite[] | undefined;

  constructor(sprite: Phaser.GameObjects.Sprite, hitAs: HitAs) {
    this.sprite = sprite;
    this.hitAs = hitAs;
  }

  /** Returns whether the sprite was painted solid white; the caller restores its own tint otherwise. */
  paint(hit: boolean, warning: Warning, tick: number): boolean {
    const look = flashLook({ hit, warning }, this.hitAs, comfortIn(this.sprite.scene).lessFlash, tick);
    if (look.white) this.sprite.setTintFill(0xffffff);
    if (look.shiftX !== 0) this.sprite.x += look.shiftX;
    // Without WebGL there is no tint, so the copies would be plain sprites and the "outline" a fatter one.
    if (look.outline && this.sprite.scene.sys.game.renderer.type === Phaser.WEBGL) this.show();
    else this.hide();
    return look.white;
  }

  private show(): void {
    const s = this.sprite;
    this.copies ??= OFFSETS.map(() => s.scene.add.sprite(0, 0, s.texture.key).setTintFill(INK));
    this.copies.forEach((c, i) => {
      const [dx, dy] = OFFSETS[i]!;
      c.setTexture(s.texture.key, s.frame.name).setOrigin(s.originX, s.originY).setFlip(s.flipX, s.flipY)
        .setScale(s.scaleX, s.scaleY).setAngle(s.angle).setAlpha(s.alpha)
        .setPosition(s.x + dx, s.y + dy).setDepth(s.depth - 0.5).setVisible(s.visible);
    });
  }

  hide(): void {
    this.copies?.forEach((c) => c.setVisible(false));
  }

  destroy(): void {
    this.copies?.forEach((c) => c.destroy());
    this.copies = undefined;
  }
}
