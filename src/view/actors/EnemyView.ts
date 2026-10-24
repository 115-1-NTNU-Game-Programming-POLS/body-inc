import Phaser from 'phaser';
import { tagKey, type ManifestEntry } from '../../app/assets.ts';
import { REFORM_TICKS, TICK_HZ, type EnemyState } from '../../core/index.ts';
import { REFORM_STAGES } from '../fx/textures.ts';

/** Logical enemy id to manifest key; the view owns this, core only knows `salesman`. */
export const SKINS: Readonly<Record<string, string>> = {
  salesman: 'suit-base',
  energy_seller: 'energy-seller',
  cheers: 'cheers',
  flyer: 'flyer',
  adenosine: 'adenosine',
  alcohol_barrel: 'alcohol-barrel',
};

/** Ticks of the tier-1 telegraph that show a white flash: 0.00-0.08 s and 0.25-0.33 s. */
const FLASH_WINDOWS: ReadonlyArray<readonly [number, number]> = [[0, 5], [15, 20]];

const isHidden = (e: Readonly<EnemyState>): boolean => e.phase === 'closed' || e.phase === 'dispersed';

export class EnemyView {
  readonly sprite: Phaser.GameObjects.Sprite;
  private readonly bubble: Phaser.GameObjects.Image;
  private readonly ring: Phaser.GameObjects.Image;
  private readonly entry: ManifestEntry;
  private readonly tags: ReadonlySet<string>;
  private flashUntil = 0;

  constructor(scene: Phaser.Scene, entry: ManifestEntry) {
    this.entry = entry;
    this.tags = new Set(entry.tags.map((t) => t.name));
    this.sprite = scene.add.sprite(0, 0, entry.key, '0').setOrigin(entry.anchor[0] / entry.frame[0], entry.anchor[1] / entry.frame[1]);
    this.bubble = scene.add.image(0, 0, 'fx-alert-bubble').setOrigin(0.5, 1).setVisible(false);
    this.ring = scene.add.image(0, 0, 'fx-reform-ring-1').setVisible(false);
  }

  /** First of the listed tags the atlas has; up-facing poses fall back to side (art direction 5.4). */
  private pick(...names: string[]): string | undefined {
    const name = names.find((n) => this.tags.has(n));
    return name ? tagKey(this.entry.key, name) : undefined;
  }

  flash(ticks: number, now: number): void {
    this.flashUntil = now + ticks;
  }

  render(prev: Readonly<EnemyState> | undefined, cur: Readonly<EnemyState>, alpha: number, tick: number, ms: number): void {
    const hidden = isHidden(cur);
    // Reappearing (respawn at home, reform) is a jump, not a move: interpolating would slide it.
    const p = prev && !(isHidden(prev) && !hidden) ? prev : cur;
    const x = p.x + (cur.x - p.x) * alpha;
    const y = p.y + (cur.y - p.y) * alpha;
    this.sprite.setVisible(!hidden);
    this.ring.setVisible(cur.phase === 'dispersed');
    if (cur.phase === 'dispersed') {
      const stage = Math.min(REFORM_STAGES, 1 + Math.floor((cur.phaseTicks / REFORM_TICKS) * REFORM_STAGES));
      this.ring.setTexture(`fx-reform-ring-${stage}`).setPosition(Math.round(x), Math.round(y - 12)).setDepth(y);
    }
    const windup = cur.phase === 'windup';
    this.bubble.setVisible(windup).setPosition(Math.round(x), Math.round(y - this.entry.frame[1] + 2)).setDepth(1e5);
    if (hidden) return;

    const dir = windup || cur.phase === 'strike' ? cur.strikeDir : { x: cur.x - p.x, y: cur.y - p.y };
    const side = Math.abs(dir.x) > Math.abs(dir.y);
    const d = side ? 'side' : dir.y < 0 ? 'up' : 'down';
    // Reforming enemies bob 2 px on a 1.6 s sine (art direction 5.6).
    const bob = cur.category === 'reforming' ? Math.round(Math.sin((ms / 1600) * Math.PI * 2) * 2) : 0;
    this.sprite.setPosition(Math.round(x), Math.round(y) + bob).setDepth(y).setFlipX(side && dir.x < 0);

    const inFlash = windup && FLASH_WINDOWS.some(([a, b]) => cur.phaseTicks >= a && cur.phaseTicks < b);
    if (tick < this.flashUntil || inFlash) this.sprite.setTintFill(0xffffff);
    else this.sprite.clearTint();

    let anim: string | undefined;
    if (cur.frozen > 0) anim = this.pick(`hurt_${d}`, 'hurt_side', 'hurt_down');
    else if (windup) anim = this.pick(`windup_${d}`, 'windup_side', 'windup_down');
    else if (cur.phase === 'strike') anim = this.pick(`attack_${d}`, 'attack_side', 'attack_down');
    const moving = cur.x !== p.x || cur.y !== p.y;
    if (!anim) anim = this.pick(`walk_${d}`, 'walk_side', 'walk_down', 'float_down', 'idle_down');
    if (!anim) return;
    if (moving || cur.category === 'reforming') this.sprite.play(anim, true);
    else {
      this.sprite.anims.stop();
      const first = this.sprite.scene.anims.get(anim)?.frames[0];
      if (first) this.sprite.setFrame(first.textureFrame);
    }
  }

  /** Soft bounce for immune objects: no hit-stop, only a squash (art direction 9.2). */
  bounce(): void {
    // Held fire bounces every 167 ms but the squash lasts 200 ms; restart from scale 1 so
    // overlapping tweens cannot leave the sprite shrunk.
    const tweens = this.sprite.scene.tweens;
    tweens.killTweensOf(this.sprite);
    this.sprite.setScale(1);
    tweens.add({ targets: this.sprite, scaleX: 0.92, scaleY: 0.92, duration: 100, yoyo: true });
  }

  /** Case closed: a 0.4 s spin and shrink on a copy, so the rule state can drop the enemy at once. */
  closeOut(): void {
    const ghost = this.sprite.scene.add.sprite(this.sprite.x, this.sprite.y, this.sprite.texture.key, this.sprite.frame.name)
      .setOrigin(this.sprite.originX, this.sprite.originY).setDepth(this.sprite.depth);
    this.sprite.scene.tweens.add({
      targets: ghost, scaleX: { from: 1, to: -1 }, duration: 0.2 * 1000, yoyo: true,
      onComplete: () => this.sprite.scene.tweens.add({ targets: ghost, scale: 0, duration: (8 / TICK_HZ) * 1000, onComplete: () => ghost.destroy() }),
    });
  }

  destroy(): void {
    this.sprite.destroy();
    this.bubble.destroy();
    this.ring.destroy();
  }
}
