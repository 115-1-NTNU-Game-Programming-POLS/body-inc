import Phaser from 'phaser';
import { tagKey, type ManifestEntry } from '../../app/assets.ts';
import { bossMove, BOSS_HURT, TICK_HZ, type BossDef, type EnemyState } from '../../core/index.ts';
import type { ActorFx } from '../fx/FeedbackPlayer.ts';
import { dashedCircle, tier1Flash } from '../fx/telegraph.ts';

const RED = 0xc8372d;
const INK = 0x0c2d5e;
const PAPER = 0xf4efe4;
/** Proposal sheet (art direction 9.2): 32 x 40, printed in 6 steps, 8 px above the head. */
const SHEET_W = 32;
const SHEET_H = 40;
const SHEET_STEPS = 6;
/** Where the minis of a power cut pile on him, as offsets from his feet. */
const PILE: ReadonlyArray<readonly [number, number]> = [[-14, -18], [14, -20], [-8, -34], [10, -38], [0, -50], [-18, -44], [18, -30], [0, -26]];

/**
 * Draws a boss from its core state (art direction 5.5): the pose per move, the tier-3 proposal
 * and the rotating red ring around his hurtbox, the review countdown dots, and the adenosine
 * piled on him during a power cut. The proposal's printed words are left to the Hud overlay,
 * which does not exist yet, so the placeholder sheet carries lines and an empty stamp box.
 */
export class BossView implements ActorFx {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly effectLift = 40;
  private readonly scene: Phaser.Scene;
  private readonly entry: ManifestEntry;
  private readonly marks: Phaser.GameObjects.Graphics;
  private readonly bubble: Phaser.GameObjects.Image;
  private readonly minis: Phaser.GameObjects.Sprite[];
  private flashUntil = 0;
  private gone = false;

  constructor(scene: Phaser.Scene, entry: ManifestEntry, mini: ManifestEntry) {
    this.scene = scene;
    this.entry = entry;
    this.sprite = scene.add.sprite(0, 0, entry.key, '0').setOrigin(entry.anchor[0] / entry.frame[0], entry.anchor[1] / entry.frame[1]);
    this.marks = scene.add.graphics().setDepth(1e5);
    this.bubble = scene.add.image(0, 0, 'fx-alert-bubble').setOrigin(0.5, 1).setDepth(1e5).setVisible(false);
    this.minis = PILE.map(() => scene.add.sprite(0, 0, mini.key, '0')
      .setOrigin(mini.anchor[0] / mini.frame[0], mini.anchor[1] / mini.frame[1]).setVisible(false));
  }

  flash(ticks: number, now: number): void {
    this.flashUntil = now + ticks;
  }

  bounce(): void {}

  /** Budget at zero: he shrinks to 0.6 and slides out sideways (art direction 5.5). */
  closeOut(): void {
    this.gone = true;
    this.scene.tweens.killTweensOf(this.sprite);
    this.marks.clear();
    this.bubble.setVisible(false);
    for (const m of this.minis) m.setVisible(false);
    this.pose('surprised_down');
    this.scene.tweens.add({
      targets: this.sprite, scale: 0.6, duration: 300,
      onComplete: () => this.scene.tweens.add({ targets: this.sprite, x: this.sprite.x + 360, duration: 1200, onComplete: () => this.sprite.setVisible(false) }),
    });
  }

  private pose(tag: string, play = false): void {
    const key = tagKey(this.entry.key, tag);
    if (play) {
      this.sprite.play(key, true);
      return;
    }
    this.sprite.anims.stop();
    const frame = this.scene.anims.get(key)?.frames[0];
    if (frame) this.sprite.setFrame(frame.textureFrame);
  }

  render(prev: Readonly<EnemyState> | undefined, cur: Readonly<EnemyState>, def: BossDef, pinned: number, alpha: number, tick: number): void {
    if (!cur.boss) return;
    if (this.gone) {
      // A forced leave brings a defeated boss back with a fresh budget.
      if (cur.phase === 'closed') return;
      this.gone = false;
      this.scene.tweens.killTweensOf(this.sprite);
      this.sprite.setScale(1).setVisible(true);
    }
    const b = cur.boss;
    const p = prev ?? cur;
    if (b.behaviour === 'toast' || def.behaviour === 'toast') {
      this.renderToast(p, cur, alpha, tick);
      return;
    }
    const boosted = b.residue >= def.boostMin;
    // Caffeine shows as a quicker animation and a 1 px tremor (art direction 5.5).
    const jitter = boosted && b.stunned === 0 && b.review === 0 && Math.floor(tick / 3) % 2 === 0 ? 1 : 0;
    const x = Math.round(p.x + (cur.x - p.x) * alpha) + jitter;
    const y = Math.round(p.y + (cur.y - p.y) * alpha);
    this.sprite.setPosition(x, y).setDepth(y);
    this.sprite.anims.timeScale = boosted ? def.boost : 1;

    const g = this.marks.clear();
    const move = b.move && b.move.id !== 'drink' && b.move.id !== 'summon' ? bossMove(def, b.move.id) : undefined;
    const telegraphing = move !== undefined && b.move!.frame <= move.telegraphTicks;
    let flash = false;

    if (b.review > 0) this.pose('review_down', true);
    else if (b.stunned > 0) this.pose('idle_down');
    else if (b.move?.id === 'drink') this.pose('drink_down');
    else if (move?.tier === 3 && telegraphing) this.pose('propose_down');
    else if (move && (move.tier === 2 || !telegraphing)) this.pose('throw_down');
    else this.pose('idle_down', true);

    if (move?.tier === 1 && telegraphing) {
      flash = tier1Flash(b.move!.frame - 1);
    }
    this.bubble.setVisible(move?.tier === 1 && telegraphing).setPosition(x, y - this.entry.frame[1] + 4);

    if (move?.tier === 3 && telegraphing) {
      // The sheet prints top down in six steps over the telegraph.
      const steps = Math.min(SHEET_STEPS, Math.ceil((b.move!.frame / move.telegraphTicks) * SHEET_STEPS));
      const h = Math.round((SHEET_H * steps) / SHEET_STEPS);
      const sx = x - SHEET_W / 2;
      const sy = y - this.entry.anchor[1] - 8 - SHEET_H;
      g.fillStyle(INK).fillRect(sx - 1, sy - 1, SHEET_W + 2, h + 2);
      g.fillStyle(PAPER).fillRect(sx, sy, SHEET_W, h);
      g.fillStyle(INK);
      for (let ly = sy + 6; ly < sy + Math.min(h, 24); ly += 5) g.fillRect(sx + 4, ly, SHEET_W - 8, 1);
      if (steps === SHEET_STEPS) dashedRect(g, sx + SHEET_W - 15, sy + SHEET_H - 13, 11, 9, RED);
      dashedCircle(g, x, y - BOSS_HURT.height / 2, BOSS_HURT.halfW + 10, RED, tick / 40);
    }
    if (b.review > 0) {
      // Four dots, one going out each second (art direction 9.2).
      const lit = Math.ceil(b.review / TICK_HZ);
      for (let i = 0; i < 4; i++) {
        g.fillStyle(i < lit ? RED : INK, i < lit ? 1 : 0.4).fillCircle(x - 9 + i * 6, y - this.entry.anchor[1] - 6, 2);
      }
    }
    this.minis.forEach((m, i) => {
      const [dx, dy] = PILE[i]!;
      m.setVisible(i < pinned).setPosition(x + dx, y + dy).setDepth(y + 1);
    });

    if (tick < this.flashUntil || flash) this.sprite.setTintFill(0xffffff);
    else if (b.stunned > 0) this.sprite.setTint(0x9aa0ab);
    else this.sprite.clearTint();
  }

  /**
   * The toast boss stands and sings: the bubble and the tier-1 flash before each wave, the breath
   * pose with a dashed ring while he is open, and the surprised pose once he has given up. He does
   * not slide out, since he is not beaten (design doc 7.7).
   */
  private renderToast(p: Readonly<EnemyState>, cur: Readonly<EnemyState>, alpha: number, tick: number): void {
    const b = cur.boss;
    if (b?.behaviour !== 'toast') return;
    const x = Math.round(p.x + (cur.x - p.x) * alpha);
    const y = Math.round(p.y + (cur.y - p.y) * alpha);
    this.sprite.setPosition(x, y).setDepth(y);
    const g = this.marks.clear();
    const telegraphing = b.move !== null && cur.phase !== 'closed';
    this.bubble.setVisible(telegraphing).setPosition(x, y - this.entry.frame[1] + 4);
    if (cur.phase === 'closed') this.pose('surprised_down');
    else if (b.part === 'breath') {
      this.pose('breath_down');
      dashedCircle(g, x, y - BOSS_HURT.height / 2, BOSS_HURT.halfW + 10, INK, tick / 40);
    } else if (telegraphing) this.pose('wave_down');
    else this.pose('idle_down', true);
    const flash = telegraphing && tier1Flash(b.move!.frame - 1);
    if (tick < this.flashUntil || flash) this.sprite.setTintFill(0xffffff);
    else this.sprite.clearTint();
  }
}

function dashedRect(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, color: number): void {
  g.fillStyle(color);
  for (let i = 0; i < w; i += 3) { g.fillRect(x + i, y, 2, 1); g.fillRect(x + i, y + h - 1, 2, 1); }
  for (let j = 0; j < h; j += 3) { g.fillRect(x, y + j, 1, 2); g.fillRect(x + w - 1, y + j, 1, 2); }
}
