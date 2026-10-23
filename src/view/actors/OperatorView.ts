import Phaser from 'phaser';
import { tagKey, type ManifestEntry } from '../../app/assets.ts';
import type { OperatorState } from '../../core/index.ts';

/** Side frames are drawn facing right; left mirrors the side tag. */
const DIR_TAG = { down: 'down', up: 'up', left: 'side', right: 'side' } as const;

export class OperatorView {
  private readonly scene: Phaser.Scene;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly key: string;

  constructor(scene: Phaser.Scene, entry: ManifestEntry) {
    this.scene = scene;
    this.key = entry.key;
    this.sprite = scene.add.sprite(0, 0, entry.key, '0');
    this.sprite.setOrigin(entry.anchor[0] / entry.frame[0], entry.anchor[1] / entry.frame[1]);
  }

  render(prev: Readonly<OperatorState>, cur: Readonly<OperatorState>, alpha: number): void {
    const x = prev.x + (cur.x - prev.x) * alpha;
    const y = prev.y + (cur.y - prev.y) * alpha;
    this.sprite.setPosition(x, y).setDepth(y).setFlipX(cur.facing === 'left');
    const anim = tagKey(this.key, `walk_${DIR_TAG[cur.facing]}`);
    if (cur.vx !== 0 || cur.vy !== 0) {
      this.sprite.play(anim, true);
      return;
    }
    this.sprite.anims.stop();
    const first = this.scene.anims.get(anim)?.frames[0];
    if (first) this.sprite.setFrame(first.textureFrame);
  }
}
