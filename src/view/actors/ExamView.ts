import Phaser from 'phaser';
import { tagKey, type ManifestEntry } from '../../app/assets.ts';
import { selectExam, TICK_HZ, type EnemyState, type GameState } from '../../core/index.ts';
import type { ActorFx } from '../fx/FeedbackPlayer.ts';
import { tier1Flash } from '../fx/telegraph.ts';
import { addText } from '../text/fonts.ts';

/**
 * The exam room's actors (design doc 7.6). Art direction draws the paper's body and its grid
 * lines in code, with only its face from the `exam` atlas; the test cases and the proof steps
 * have no art yet, so they are code-drawn placeholders in the same palette.
 */

const INK = 0x0c2d5e;
const PAPER = 0xfbfaf6;
const RULE = 0xa9c4e8;
const STAMP_RED = 0xc8372d;
const GOLD = 0xd9a520;
const PAPER_SIZE = { w: 40, h: 52 } as const;

function makeExamTextures(scene: Phaser.Scene): void {
  const g = scene.make.graphics({}, false);
  const make = (key: string, w: number, h: number, draw: () => void) => {
    if (scene.textures.exists(key)) return;
    g.clear();
    draw();
    g.generateTexture(key, w, h);
  };
  make('exam-paper-body', PAPER_SIZE.w, PAPER_SIZE.h, () => {
    const { w, h } = PAPER_SIZE;
    g.fillStyle(INK).fillRect(0, 0, w, h);
    g.fillStyle(PAPER).fillRect(1, 1, w - 2, h - 2);
    // A folded corner and ruled lines below the face.
    g.fillStyle(RULE).fillTriangle(w - 9, 1, w - 1, 1, w - 1, 9);
    for (let y = 26; y < h - 4; y += 5) g.fillStyle(RULE).fillRect(5, y, w - 10, 1);
    g.fillStyle(STAMP_RED).fillRect(5, 4, 12, 2);
  });
  const card = (key: string, border: number) => make(key, 14, 16, () => {
    g.fillStyle(border).fillRect(0, 0, 14, 16);
    g.fillStyle(PAPER).fillRect(2, 2, 10, 12);
    g.fillStyle(INK).fillRect(4, 5, 6, 1).fillRect(4, 8, 6, 1).fillRect(4, 11, 4, 1);
  });
  card('exam-case', INK);
  card('exam-case-bonus', GOLD);
  g.destroy();
}

/** A code-drawn enemy: interpolated feet, white flash, the same squash and close-out as EnemyView. */
export class DrawnView implements ActorFx {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly effectLift: number;
  private flashUntil = 0;

  constructor(scene: Phaser.Scene, texture: string, lift: number) {
    this.sprite = scene.add.sprite(0, 0, texture).setOrigin(0.5, 1);
    this.effectLift = lift;
  }

  flash(ticks: number, now: number): void {
    this.flashUntil = now + ticks;
  }

  protected place(prev: Readonly<EnemyState> | undefined, cur: Readonly<EnemyState>, alpha: number, tick: number, white = false): { x: number; y: number } {
    const p = prev ?? cur;
    const x = p.x + (cur.x - p.x) * alpha;
    const y = p.y + (cur.y - p.y) * alpha;
    this.sprite.setVisible(cur.phase !== 'closed').setPosition(Math.round(x), Math.round(y)).setDepth(y);
    if (tick < this.flashUntil || white) this.sprite.setTintFill(0xffffff);
    else this.sprite.clearTint();
    return { x, y };
  }

  render(prev: Readonly<EnemyState> | undefined, cur: Readonly<EnemyState>, alpha: number, tick: number, _ms?: number): void {
    this.place(prev, cur, alpha, tick);
  }

  bounce(): void {
    const tweens = this.sprite.scene.tweens;
    tweens.killTweensOf(this.sprite);
    this.sprite.setScale(1);
    tweens.add({ targets: this.sprite, scaleX: 0.92, scaleY: 0.92, duration: 100, yoyo: true });
  }

  closeOut(): void {
    const ghost = this.sprite.scene.add.sprite(this.sprite.x, this.sprite.y, this.sprite.texture.key)
      .setOrigin(this.sprite.originX, this.sprite.originY).setDepth(this.sprite.depth);
    this.sprite.scene.tweens.add({
      targets: ghost, scaleX: { from: 1, to: -1 }, duration: 0.2 * 1000, yoyo: true,
      onComplete: () => this.sprite.scene.tweens.add({ targets: ghost, scale: 0, duration: (8 / TICK_HZ) * 1000, onComplete: () => ghost.destroy() }),
    });
  }

  destroy(): void {
    this.sprite.destroy();
  }
}

/** The paper: its body, a face that reacts to the fight, and the white flashes of its fan's warning. */
class PaperView extends DrawnView {
  private readonly face: Phaser.GameObjects.Sprite;
  private readonly entry: ManifestEntry;
  private readonly bubble: Phaser.GameObjects.Image;
  private mood = '';
  /** Frame of the barrage's telegraph this frame, from the exam state; 0 when none. */
  windup = 0;
  done = false;

  constructor(scene: Phaser.Scene, face: ManifestEntry) {
    super(scene, 'exam-paper-body', PAPER_SIZE.h - 8);
    this.entry = face;
    this.face = scene.add.sprite(0, 0, face.key, '0').setOrigin(0.5, 0);
    this.bubble = scene.add.image(0, 0, 'fx-alert-bubble').setOrigin(0.5, 1).setVisible(false);
  }

  override render(prev: Readonly<EnemyState> | undefined, cur: Readonly<EnemyState>, alpha: number, tick: number): void {
    const { x, y } = this.place(prev, cur, alpha, tick, this.windup > 0 && tier1Flash(this.windup - 1));
    const top = Math.round(y) - PAPER_SIZE.h;
    this.face.setVisible(this.sprite.visible).setPosition(Math.round(x), top + 6).setDepth(y + 0.1);
    this.bubble.setVisible(this.windup > 0).setPosition(Math.round(x), top - 2).setDepth(1e5);
    const mood = this.done ? 'satisfied' : this.windup > 0 ? 'quiz' : 'stern';
    if (mood === this.mood) return;
    this.mood = mood;
    const first = this.sprite.scene.anims.get(tagKey(this.entry.key, `${mood}_down`))?.frames[0];
    if (first) this.face.setFrame(first.textureFrame);
  }

  override destroy(): void {
    super.destroy();
    this.face.destroy();
    this.bubble.destroy();
  }
}

/** The exam enemies the view draws itself, by enemy type; WorldScene asks here before SKINS. */
export const DRAWN_TYPES: ReadonlySet<string> = new Set(['exam_paper', 'testcase', 'testcase_bonus']);

/** The proof steps on the floor and the paper's warnings, read from the exam state each frame. */
export class ExamLayer {
  private readonly scene: Phaser.Scene;
  private readonly face: ManifestEntry;
  private readonly floor: Phaser.GameObjects.Graphics;
  private readonly labels: Phaser.GameObjects.Text[] = [];
  private shownSteps = '';
  private paper: PaperView | undefined;

  constructor(scene: Phaser.Scene, face: ManifestEntry) {
    this.scene = scene;
    this.face = face;
    makeExamTextures(scene);
    // Over the tile layers (depth 0) and under every actor, whose depth is its feet's y: a mark on the floor.
    this.floor = scene.add.graphics().setDepth(1);
  }

  /** A view for one of DRAWN_TYPES. */
  viewFor(e: Readonly<EnemyState>): DrawnView {
    if (e.type === 'exam_paper') {
      this.paper = new PaperView(this.scene, this.face);
      return this.paper;
    }
    return new DrawnView(this.scene, e.type === 'testcase_bonus' ? 'exam-case-bonus' : 'exam-case', 12);
  }

  /** Called before the enemies render, so the paper's flash and face match this frame's state. */
  update(state: GameState, ms: number): void {
    const exam = selectExam(state)?.state;
    if (this.paper) {
      this.paper.windup = exam?.windup ?? 0;
      this.paper.done = exam?.part === 'done';
    }
    const steps = exam?.part === 'run' ? exam.steps : [];
    const key = steps.map((s) => `${s.order}@${s.x},${s.y}`).join('|');
    if (key !== this.shownSteps) {
      this.shownSteps = key;
      for (const l of this.labels) l.destroy();
      this.labels.length = 0;
      for (const s of steps) {
        this.labels.push(addText(this.scene, s.x, s.y, String(s.order + 1), { role: 'print', weight: 700, size: 12, color: '#0c2d5e' })
          .setOrigin(0.5).setDepth(2));
      }
    }
    const g = this.floor.clear();
    const pulse = 0.5 + 0.5 * Math.sin((ms / 500) * Math.PI);
    for (const s of steps) {
      const stamped = s.order < exam!.next;
      g.fillStyle(PAPER, 0.92).fillCircle(s.x, s.y, 11);
      g.lineStyle(2, INK, 1).strokeCircle(s.x, s.y, 11);
      if (stamped) g.lineStyle(3, STAMP_RED, 0.85).strokeCircle(s.x, s.y, 8);
      else if (s.order === exam!.next) g.lineStyle(2, STAMP_RED, 0.3 + 0.5 * pulse).strokeCircle(s.x, s.y, 14);
    }
  }

  destroy(): void {
    this.floor.destroy();
    for (const l of this.labels) l.destroy();
  }
}
