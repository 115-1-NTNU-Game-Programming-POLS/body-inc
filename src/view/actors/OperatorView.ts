import Phaser from 'phaser';
import { tagKey, type ManifestEntry } from '../../app/assets.ts';
import { DODGE, FOLDER, inDodgeIframes, parryOpen, STAMP_LAND, STAPLER, swingBox, type OperatorState } from '../../core/index.ts';

/**
 * Where clinging stacks ride, in latch order: back, left shoulder, top of the head (art
 * direction 5.6), as offsets from the feet with a depth offset so the back one sits behind.
 * The back one peeks out past the body edge; centred it was hidden and two stacks read as one.
 */
const STACK_ANCHORS: ReadonlyArray<readonly [number, number, number]> = [[12, -20, -1], [-8, -30, 1], [0, -46, 1]];

/** Side frames are drawn facing right; left mirrors the side tag. */
const DIR_TAG = { down: 'down', up: 'up', left: 'side', right: 'side' } as const;
/** Invulnerability blink: alpha 0.5 and 1.0 alternate every 0.1 s (art direction 9.2). */
const BLINK_TICKS = 6;

/**
 * Picks the operator's pose from the snapshot (art direction 5.3). Dodge reuses walk frame 2
 * squashed to 0.85 with afterimages on the invincible frames; there is no dodge tag yet.
 */
export class OperatorView {
  private readonly scene: Phaser.Scene;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly key: string;
  private readonly stacks: Phaser.GameObjects.Sprite[];
  /** The folder's swing and guard: no folder frames are in the atlas yet, so they are drawn as shapes. */
  private readonly folderFx: Phaser.GameObjects.Graphics;
  private flashUntil = 0;
  private lastFireTick = -1e9;
  private lastGhostTick = -1;

  constructor(scene: Phaser.Scene, entry: ManifestEntry, mini: ManifestEntry) {
    this.scene = scene;
    this.key = entry.key;
    this.sprite = scene.add.sprite(0, 0, entry.key, '0');
    this.sprite.setOrigin(entry.anchor[0] / entry.frame[0], entry.anchor[1] / entry.frame[1]);
    this.stacks = STACK_ANCHORS.map(() => scene.add.sprite(0, 0, mini.key, '0')
      .setOrigin(mini.anchor[0] / mini.frame[0], mini.anchor[1] / mini.frame[1]).setVisible(false));
    this.folderFx = scene.add.graphics();
  }

  /** Draws one mini per clinging stack; the core state decides how many there are. */
  renderStacks(count: number): void {
    const s = this.sprite;
    this.stacks.forEach((mini, i) => {
      const [dx, dy, depth] = STACK_ANCHORS[i]!;
      mini.setVisible(i < count).setPosition(s.x + dx, s.y + dy).setDepth(s.depth + depth);
    });
  }

  flash(ticks: number, now: number): void {
    this.flashUntil = now + ticks;
  }

  fired(now: number): void {
    this.lastFireTick = now;
  }

  private still(tag: string, index = 0): void {
    this.sprite.anims.stop();
    const frame = this.scene.anims.get(tagKey(this.key, tag))?.frames[index];
    if (frame) this.sprite.setFrame(frame.textureFrame);
  }

  /** x, y are the interpolated feet position; cur supplies the action and velocity. */
  render(cur: Readonly<OperatorState>, x: number, y: number, tick: number): void {
    const dir = DIR_TAG[cur.facing];
    const a = cur.action;
    this.sprite.setPosition(Math.round(x), Math.round(y)).setDepth(y).setFlipX(cur.facing === 'left').setScale(1);

    if (a.kind === 'stamp') {
      // Frame 0 is the raised stamp, frame 1 the press on the landing frame.
      this.still('stamp_down', a.frame >= STAMP_LAND ? 1 : 0);
      this.sprite.setFlipX(false);
    } else if (a.kind === 'dodge') {
      this.still(`walk_${dir}`, 1);
      this.sprite.setScale(1, 0.85).setAlpha(1);
      if (inDodgeIframes(a) && (a.frame - DODGE.iframeFirst) % 3 === 0 && tick !== this.lastGhostTick) {
        this.lastGhostTick = tick;
        this.afterimage();
      }
    } else if (a.kind === 'hurt') {
      this.still(`hurt_${dir}`);
    } else if (a.kind === 'swing' || a.kind === 'guard') {
      // The stapler's push pose stands in until the atlas has folder frames (art direction 5.3).
      this.still(`attack_${dir}`, a.kind === 'swing' && a.frame >= FOLDER.hitFrame ? 1 : 0);
    } else if (tick - this.lastFireTick < STAPLER.intervalTicks) {
      // Push 5 frames, recoil 5: one cycle per staple.
      this.still(`attack_${dir}`, tick - this.lastFireTick < 5 ? 1 : 0);
    } else if (cur.vx !== 0 || cur.vy !== 0) {
      this.sprite.play(tagKey(this.key, `walk_${dir}`), true);
    } else {
      this.still(`walk_${dir}`);
    }

    const invuln = a.kind !== 'dodge' && tick < cur.invulnUntil;
    this.sprite.setAlpha(invuln && Math.floor(tick / BLINK_TICKS) % 2 === 0 ? 0.5 : 1);
    if (tick < this.flashUntil) this.sprite.setTintFill(0xffffff);
    else this.sprite.clearTint();
    this.renderFolder(cur, a);
  }

  /** The guard as a 120 degree wedge, white while it parries and teal after; a swing as a short white slash. */
  private renderFolder(cur: Readonly<OperatorState>, a: OperatorState['action']): void {
    const g = this.folderFx.clear().setDepth(this.sprite.depth + 2);
    if (a.kind === 'guard') {
      const half = (FOLDER.guardHalfAngleDeg * Math.PI) / 180;
      const base = Math.atan2(cur.aim.y, cur.aim.x);
      g.fillStyle(parryOpen(a) ? 0xffffff : 0x2a9d8f, parryOpen(a) ? 0.6 : 0.3);
      g.slice(this.sprite.x, this.sprite.y - 10, 24, base - half, base + half, false);
      g.fillPath();
    } else if (a.kind === 'swing' && a.frame >= FOLDER.hitFrame && a.frame < FOLDER.hitFrame + 3) {
      const b = swingBox(cur);
      g.fillStyle(0xffffff, 0.5);
      g.fillEllipse((b.left + b.right) / 2, (b.top + b.bottom) / 2, b.right - b.left, b.bottom - b.top);
    }
  }

  /** Teal afterimage at 0.5 opacity fading out (art direction 5.3). */
  private afterimage(): void {
    const s = this.sprite;
    const ghost = this.scene.add.sprite(s.x, s.y, s.texture.key, s.frame.name)
      .setOrigin(s.originX, s.originY).setFlipX(s.flipX).setScale(s.scaleX, s.scaleY)
      .setDepth(s.depth - 1).setAlpha(0.5).setTintFill(0x2a9d8f);
    this.scene.tweens.add({ targets: ghost, alpha: 0, duration: 200, onComplete: () => ghost.destroy() });
  }

  get position(): { x: number; y: number } {
    return { x: this.sprite.x, y: this.sprite.y };
  }
}
