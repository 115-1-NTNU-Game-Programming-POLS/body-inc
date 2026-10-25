import Phaser from 'phaser';
import type { FixedStepLoop } from '../../app/loop.ts';
import {
  MINUTES_PER_DAY, selectBoss, selectClock, selectGauge, selectHearts, selectInteractable, selectTick, TICK_HZ,
  type BossSummary, type ChapterState, type GameEvent, type GameState,
} from '../../core/index.ts';
import { str } from '../../app/content.ts';
import { issueMessage, type SaveIssue } from '../../app/storage.ts';
import { addText, updateText } from '../text/fonts.ts';
import type { WorldNote } from './WorldScene.ts';

/** 7 x 6 heart, drawn at 4 px per cell; '#' is filled. */
const HEART = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
const CELL = 4;
const HEART_COLOR = 0xf08a80;
const EMPTY_COLOR = 0x3b4660;
const NOTE_SECONDS = 2.5;
/** Rejection gauge (art direction 8.3): a 200 x 16 ink pad in the one HUD red, ticked at 50%. */
const GAUGE_X = 12;
const GAUGE_Y = 44;
const GAUGE_W = 200;
const GAUGE_H = 16;
const INK = 0x0c2d5e;
const STAMP_RED = 0xc8372d;
/** When full the pad pulses once every 2 s (art direction 8.3). */
const FULL_PULSE_MS = 2000;
/** Boss nameplate (art direction 8.3): top centre, x 400 to 880, y 16, 480 x 72. */
const PLATE = { x: 400, y: 16, w: 480, h: 72 } as const;
/** Caffeine's residue curve inside the plate: 160 x 32, the last 40 s sampled every 0.25 s. */
const CURVE = { x: 708, y: 24, w: 160, h: 32, samples: 160, everyMs: 250 } as const;
const PAPER = 0xf4efe4;

interface Plate {
  readonly g: Phaser.GameObjects.Graphics;
  readonly name: Phaser.GameObjects.Text;
  readonly stage: Phaser.GameObjects.Text;
  readonly residue: Phaser.GameObjects.Text;
  readonly history: number[];
  lastSample: number;
  shown: string;
}

/** Overlay at scale 1, separate from World so hit-stop and camera zoom never affect UI. */
export class HudScene extends Phaser.Scene {
  private controls!: Phaser.GameObjects.Text;
  private prompt!: Phaser.GameObjects.Text;
  private clock!: Phaser.GameObjects.Text;
  private hearts!: Phaser.GameObjects.Graphics;
  private gauge!: Phaser.GameObjects.Graphics;
  private plate: Plate | undefined;
  private shownHalves = -1;
  private shownGauge = '';
  private shownTime = '';
  /** Message keys already on screen, and where the next notice stacks up from. */
  private readonly noticed = new Set<string>();
  private noticeBottom = 0;

  constructor() {
    super('Hud');
  }

  create(): void {
    // The scene object is reused when the game goes back to the title and into a new run.
    this.plate = undefined;
    this.shownHalves = -1;
    this.shownGauge = '';
    this.shownTime = '';
    this.noticed.clear();
    this.noticeBottom = this.scale.height - 12;
    this.hearts = this.add.graphics();
    this.gauge = this.add.graphics();
    // The HUD sits over the north wall (art direction 7.2), so light text needs its own plate to
    // stay readable over pale walls and wall props.
    const plate = { backgroundColor: 'rgba(12, 45, 94, 0.82)', padding: { x: 6, y: 2 } } as const;
    this.controls = addText(this, 12, GAUGE_Y + GAUGE_H + 12, str('hud.controls'), { role: 'print', weight: 700, size: 16, color: '#e8edf5', ...plate });
    this.clock = addText(this, 12, this.controls.y + this.controls.displayHeight + 2, '', {
      role: 'print', weight: 400, size: 16, color: '#e8edf5', ...plate,
    });
    this.prompt = addText(this, this.scale.width / 2, this.scale.height - 72, str('hud.interact'), {
      role: 'print', weight: 700, size: 20, color: '#e8edf5', ...plate,
    }).setOrigin(0.5, 1).setVisible(false);
    this.saveNotices((this.registry.get('save-issues') as readonly SaveIssue[] | undefined) ?? []);
    const onNote = (n: WorldNote) => this.note(n);
    const onIssues = (issues: readonly SaveIssue[]) => this.saveNotices(issues);
    this.game.events.on('world-note', onNote);
    this.game.events.on('save-issues', onIssues);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('world-note', onNote);
      this.game.events.off('save-issues', onIssues);
    });
  }

  /** One line per distinct message, bottom left, kept on screen: lost progress must not go unnoticed. */
  private saveNotices(issues: readonly SaveIssue[]): void {
    const keys = [...new Set(issues.map(issueMessage).filter((k): k is string => k !== undefined))].filter((k) => !this.noticed.has(k));
    // Stacked upward from the bottom by measured height, so wrapped or scaled text never overlaps.
    for (const key of keys.reverse()) {
      this.noticed.add(key);
      const text = addText(this, 12, this.noticeBottom, str(key), {
        role: 'print', weight: 700, size: 16, color: '#2b2b2b', backgroundColor: '#f2c94c', padding: { x: 8, y: 3 },
      }).setOrigin(0, 1);
      this.noticeBottom -= text.displayHeight + 4;
    }
  }

  /** Gray memo above the object (art direction 9.2), converted from world to screen once. */
  private note(n: WorldNote): void {
    const cam = this.scene.get('World').cameras.main;
    const sx = (n.worldX - cam.worldView.x) * cam.zoom;
    const sy = (n.worldY - cam.worldView.y) * cam.zoom;
    // Handwritten role: notes are the operator's sticky memos (art direction 8.2).
    const text = addText(this, sx, sy, n.text, {
      role: 'hand', weight: 400, size: 22, color: '#2b2b2b', backgroundColor: '#d9d6cf', padding: { x: 8, y: 4 },
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

  private drawGauge(value: number, max: number, lit: boolean): void {
    const g = this.gauge.clear();
    g.fillStyle(INK, 0.82).fillRect(GAUGE_X, GAUGE_Y, GAUGE_W + 4, GAUGE_H + 4);
    g.fillStyle(lit ? 0xffffff : STAMP_RED).fillRect(GAUGE_X + 2, GAUGE_Y + 2, Math.round((GAUGE_W * value) / max), GAUGE_H);
    g.fillStyle(0xe8edf5).fillRect(GAUGE_X + 2 + GAUGE_W / 2, GAUGE_Y + 2, 1, GAUGE_H);
  }

  /** Nameplate of the room's boss; made on first sight, since the Hud can start before World. */
  private renderBoss(state: GameState, time: number): void {
    const boss = selectBoss(state);
    if (!boss) {
      if (this.plate) this.clearPlate();
      return;
    }
    if (!this.plate) {
      const g = this.add.graphics();
      const name = addText(this, PLATE.x + 16, PLATE.y + 6, str(`boss.${boss.type}.name`), { role: 'hand', weight: 700, size: 22, color: '#0c2d5e' });
      const stage = addText(this, name.x + name.displayWidth + 48, PLATE.y + 12, '', { role: 'print', weight: 700, size: 14, color: '#0c2d5e' });
      const residue = addText(this, CURVE.x, CURVE.y + CURVE.h + 2, '', { role: 'print', weight: 400, size: 12, color: '#0c2d5e' });
      this.plate = { g, name, stage, residue, history: [], lastSample: -Infinity, shown: '' };
      // The control hint line sits under the plate's left edge, so it moves below the plate.
      this.controls.setY(PLATE.y + PLATE.h + 12);
      this.clock.setY(this.controls.y + this.controls.displayHeight + 2);
    }
    const p = this.plate;
    if (time - p.lastSample >= CURVE.everyMs) {
      p.lastSample = time;
      p.history.push(boss.residue);
      if (p.history.length > CURVE.samples) p.history.shift();
    }
    const key = `${boss.budget}/${boss.stage}/${p.history.length}/${p.lastSample}/${boss.defeated}`;
    if (key === p.shown) return;
    p.shown = key;
    this.drawPlate(p, boss);
  }

  /** Leaving the boss room takes the nameplate with it; the control hint goes back up. */
  private clearPlate(): void {
    const p = this.plate;
    if (!p) return;
    p.g.destroy();
    p.name.destroy();
    p.stage.destroy();
    p.residue.destroy();
    this.plate = undefined;
    this.controls.setY(GAUGE_Y + GAUGE_H + 12);
    this.clock.setY(this.controls.y + this.controls.displayHeight + 2);
  }

  private drawPlate(p: Plate, boss: BossSummary): void {
    const g = p.g.clear();
    g.fillStyle(INK, 0.35).fillRect(PLATE.x + 4, PLATE.y + 4, PLATE.w, PLATE.h);
    g.fillStyle(INK).fillRect(PLATE.x - 2, PLATE.y - 2, PLATE.w + 4, PLATE.h + 4);
    g.fillStyle(PAPER).fillRect(PLATE.x + 1, PLATE.y + 1, PLATE.w - 2, PLATE.h - 2);
    // Stage dots: filled up to the current stage.
    const dx = p.name.x + p.name.displayWidth + 12;
    for (let i = 0; i < 3; i++) {
      g.lineStyle(2, INK, 1).strokeCircle(dx + i * 12, PLATE.y + 22, 4);
      if (i < boss.stage) g.fillStyle(INK).fillCircle(dx + i * 12, PLATE.y + 22, 4);
    }
    updateText(p.stage, str(`boss.stage.${boss.stage}`));
    // Annual budget bar, in ink: red belongs to warnings and the stamp (art direction 3.2).
    const bw = CURVE.x - 24 - (PLATE.x + 16);
    g.fillStyle(INK).fillRect(PLATE.x + 16, PLATE.y + 48, bw, 14);
    g.fillStyle(PAPER).fillRect(PLATE.x + 18, PLATE.y + 50, bw - 4, 10);
    g.fillStyle(INK).fillRect(PLATE.x + 18, PLATE.y + 50, Math.round(((bw - 4) * boss.budget) / boss.maxBudget), 10);

    // Residue curve with the boost threshold dashed across it.
    const top = Math.max(200, ...p.history);
    const yOf = (v: number) => CURVE.y + CURVE.h - (v / top) * CURVE.h;
    g.lineStyle(1, INK, 0.5).strokeRect(CURVE.x, CURVE.y, CURVE.w, CURVE.h);
    const ty = Math.round(yOf(boss.boostMin));
    for (let x = CURVE.x; x < CURVE.x + CURVE.w; x += 6) g.fillStyle(INK, 0.6).fillRect(x, ty, 3, 1);
    g.lineStyle(2, INK, 1).beginPath();
    p.history.forEach((v, i) => {
      const x = CURVE.x + CURVE.w - (p.history.length - 1 - i) * (CURVE.w / CURVE.samples);
      if (i === 0) g.moveTo(x, yOf(v));
      else g.lineTo(x, yOf(v));
    });
    g.strokePath();
    updateText(p.residue, str('boss.residue').replace('{residue}', String(Math.round(boss.residue))));
  }

  override update(time: number): void {
    const loop = this.registry.get('loop') as FixedStepLoop<ChapterState, GameEvent> | undefined;
    if (!loop) return;
    const game = loop.state.game;
    const { halves, maxHalves } = selectHearts(game);
    if (halves !== this.shownHalves) {
      this.shownHalves = halves;
      this.drawHearts(halves, maxHalves);
    }
    const { value, max } = selectGauge(game);
    const lit = value >= max && time % FULL_PULSE_MS < 120;
    const gaugeKey = `${value}/${lit}`;
    if (gaugeKey !== this.shownGauge) {
      this.shownGauge = gaugeKey;
      this.drawGauge(value, max, lit);
    }
    this.renderBoss(game, time);
    this.prompt.setVisible(selectInteractable(game) !== undefined);
    const seconds = (selectTick(game) / TICK_HZ).toFixed(1);
    const clock = selectClock(game);
    const minute = clock.minute % MINUTES_PER_DAY;
    const hhmm = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    const shown = `${seconds} ${hhmm}`;
    if (shown !== this.shownTime) {
      this.shownTime = shown;
      updateText(this.clock, str('hud.rule_time').replace('{seconds}', seconds).replace('{clock}', hhmm));
    }
  }
}
