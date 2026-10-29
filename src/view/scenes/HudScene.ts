import Phaser from 'phaser';
import type { FixedStepLoop } from '../../app/loop.ts';
import {
  acetaldehydeCrates, GLUCOSE as METER, glucoseOf, isDizzy, MINUTES_PER_DAY, selectBoss, selectClock, selectFactory, selectGauge, selectHearts, selectInteractable,
  selectTick, selectTool, TICK_HZ, waitingCrates, workOrders,
  type BossSummary, type ChapterState, type GameEvent, type GameState,
} from '../../core/index.ts';
import { str, TAGS } from '../../app/content.ts';
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
/** Glucose meter, beside the stamp pad on the same row. Not in art direction 8.3, which predates the prologue rules. */
const GLUCOSE = { x: GAUGE_X + GAUGE_W + 20, w: 160 } as const;

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
  private glucose!: Phaser.GameObjects.Graphics;
  private glucoseLabel!: Phaser.GameObjects.Text;
  private shownGlucose = '';
  private plate: Plate | undefined;
  private shownHalves = -1;
  private shownGauge = '';
  private shownTime = '';
  private status!: Phaser.GameObjects.Text;
  /** Dims the room while the operator is dizzy (design doc 7.7: the screen darkens). */
  private haze!: Phaser.GameObjects.Rectangle;
  private shownStatus = '';
  /** Message keys already on screen, and where the next notice stacks up from. */
  private readonly noticed = new Set<string>();
  private noticeBottom = 0;
  /** World notes still on screen, oldest first. */
  private readonly notes: Phaser.GameObjects.Text[] = [];

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
    this.notes.length = 0;
    this.noticeBottom = this.scale.height - 12;
    // First, so every HUD element draws over it.
    this.haze = this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0x10131c, 0.32).setOrigin(0, 0).setVisible(false);
    this.hearts = this.add.graphics();
    this.gauge = this.add.graphics();
    this.glucose = this.add.graphics();
    this.shownGlucose = '';
    this.glucoseLabel = addText(this, GLUCOSE.x + GLUCOSE.w + 12, GAUGE_Y + GAUGE_H / 2 + 2, '', {
      role: 'print', weight: 700, size: 16, color: '#e8edf5', backgroundColor: 'rgba(12, 45, 94, 0.82)', padding: { x: 6, y: 2 },
    }).setOrigin(0, 0.5).setVisible(false);
    // The HUD sits over the north wall (art direction 7.2), so light text needs its own plate to
    // stay readable over pale walls and wall props.
    const plate = { backgroundColor: 'rgba(12, 45, 94, 0.82)', padding: { x: 6, y: 2 } } as const;
    this.controls = addText(this, 12, GAUGE_Y + GAUGE_H + 12, str('hud.controls'), { role: 'print', weight: 700, size: 16, color: '#e8edf5', ...plate });
    this.clock = addText(this, 12, this.controls.y + this.controls.displayHeight + 2, '', {
      role: 'print', weight: 400, size: 16, color: '#e8edf5', ...plate,
    });
    this.status = addText(this, 12, 0, '', { role: 'print', weight: 700, size: 16, color: '#f2c94c', ...plate }).setVisible(false);
    this.shownStatus = '';
    this.prompt = addText(this, this.scale.width / 2, this.scale.height - 72, str('hud.interact'), {
      role: 'print', weight: 700, size: 20, color: '#e8edf5', ...plate,
    }).setOrigin(0.5, 1).setVisible(false);
    this.saveNotices((this.registry.get('save-issues') as readonly SaveIssue[] | undefined) ?? []);
    const onNote = (n: WorldNote) => this.note(n);
    const onIssues = (issues: readonly SaveIssue[]) => this.saveNotices(issues);
    this.game.events.on('world-note', onNote);
    this.game.events.on('save-issues', onIssues);
    // Conversations and event cards draw over the HUD and live exactly as long as it does: one run, from title to title.
    if (!this.scene.isActive('Dialogue')) this.scene.launch('Dialogue');
    if (!this.scene.isActive('Card')) this.scene.launch('Card');
    if (!this.scene.isActive('Rescue')) this.scene.launch('Rescue');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('world-note', onNote);
      this.game.events.off('save-issues', onIssues);
      this.scene.stop('Dialogue');
      this.scene.stop('Card');
      this.scene.stop('Rescue');
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
    // Kept whole on screen and under the top-left HUD, whatever the object's place in the room.
    const floor = this.hudBottom();
    const half = text.displayWidth / 2;
    text.setPosition(Phaser.Math.Clamp(sx, half + 8, this.scale.width - half - 8), Math.min(Math.max(sy, floor + text.displayHeight), this.scale.height - 8));
    // Notes from one spot come in bursts (a toast landing, then a refusal line); older ones move up
    // out of the way instead of being covered, newest first. One with no room left under the HUD goes.
    const placed = [text.getBounds()];
    const overlaps = (a: Phaser.Geom.Rectangle, b: Phaser.Geom.Rectangle) =>
      a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
    for (const old of [...this.notes].reverse()) {
      let b = old.getBounds();
      for (let hit = placed.find((p) => overlaps(p, b)); hit; hit = placed.find((p) => overlaps(p, b))) {
        old.setY(hit.top - 2);
        b = old.getBounds();
      }
      if (b.top < floor) {
        this.notes.splice(this.notes.indexOf(old), 1);
        this.tweens.killTweensOf(old);
        old.destroy();
        continue;
      }
      placed.push(b);
    }
    this.notes.push(text);
    this.tweens.add({
      targets: text, alpha: 0, delay: (NOTE_SECONDS - 0.4) * 1000, duration: 400,
      onComplete: () => {
        const i = this.notes.indexOf(text);
        if (i >= 0) this.notes.splice(i, 1);
        text.destroy();
      },
    });
  }

  /** Lowest edge of what the HUD draws along the top of the screen. */
  private hudBottom(): number {
    const edges = [this.clock, this.status, this.glucoseLabel].filter((t) => t.visible).map((t) => t.getBounds().bottom);
    if (this.plate) edges.push(PLATE.y + PLATE.h + 4);
    return Math.max(GAUGE_Y + GAUGE_H + 4, ...edges) + 4;
  }

  /** Right of the glucose meter is where the boss plate goes, so while it is up the label sits under the meter. */
  private placeGlucoseLabel(): void {
    if (this.plate) this.glucoseLabel.setOrigin(0, 0).setPosition(GLUCOSE.x, GAUGE_Y + GAUGE_H + 8);
    else this.glucoseLabel.setOrigin(0, 0.5).setPosition(GLUCOSE.x + GLUCOSE.w + 12, GAUGE_Y + GAUGE_H / 2 + 2);
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

  /**
   * The prologue's blood glucose meter (design doc 7.3), right of the stamp pad: the normal band
   * shaded, the value as an ink bar. Absent in a chapter without the meter.
   */
  private renderGlucose(value: number | undefined): void {
    const key = value === undefined ? '' : String(Math.round(value));
    if (key === this.shownGlucose) return;
    this.shownGlucose = key;
    const g = this.glucose.clear();
    this.glucoseLabel.setVisible(value !== undefined);
    if (value === undefined) return;
    const x = GLUCOSE.x;
    const y = GAUGE_Y;
    const at = (v: number) => Math.round((GLUCOSE.w * v) / METER.max);
    g.fillStyle(INK, 0.82).fillRect(x, y, GLUCOSE.w + 4, GAUGE_H + 4);
    g.fillStyle(0x4f7a5a).fillRect(x + 2 + at(METER.band.low), y + 2, at(METER.band.high) - at(METER.band.low), GAUGE_H);
    g.fillStyle(PAPER).fillRect(x + 2, y + 2 + GAUGE_H / 2 - 2, at(Math.min(value, METER.max)), 4);
    updateText(this.glucoseLabel, str('hud.glucose').replace('{value}', key));
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
      this.placeGlucoseLabel();
    }
    const p = this.plate;
    if (boss.caffeine && time - p.lastSample >= CURVE.everyMs) {
      p.lastSample = time;
      p.history.push(boss.caffeine.residue);
      if (p.history.length > CURVE.samples) p.history.shift();
    }
    const key = `${boss.budget}/${boss.stage}/${p.history.length}/${p.lastSample}/${boss.defeated}/${boss.breathing}`;
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
    this.placeGlucoseLabel();
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
    updateText(p.stage, boss.breathing ? str(`boss.${boss.type}.breath`) : str(`boss.${boss.type}.stage.${boss.stage}`));
    // Annual budget bar, in ink: red belongs to warnings and the stamp (art direction 3.2).
    const bw = CURVE.x - 24 - (PLATE.x + 16);
    g.fillStyle(INK).fillRect(PLATE.x + 16, PLATE.y + 48, bw, 14);
    g.fillStyle(PAPER).fillRect(PLATE.x + 18, PLATE.y + 50, bw - 4, 10);
    g.fillStyle(INK).fillRect(PLATE.x + 18, PLATE.y + 50, Math.round(((bw - 4) * boss.budget) / boss.maxBudget), 10);

    // Residue curve with the boost threshold dashed across it; only caffeine has one.
    const caffeine = boss.caffeine;
    p.residue.setVisible(caffeine !== undefined);
    if (!caffeine) return;
    const top = Math.max(200, ...p.history);
    const yOf = (v: number) => CURVE.y + CURVE.h - (v / top) * CURVE.h;
    g.lineStyle(1, INK, 0.5).strokeRect(CURVE.x, CURVE.y, CURVE.w, CURVE.h);
    const ty = Math.round(yOf(caffeine.boostMin));
    for (let x = CURVE.x; x < CURVE.x + CURVE.w; x += 6) g.fillStyle(INK, 0.6).fillRect(x, ty, 3, 1);
    g.lineStyle(2, INK, 1).beginPath();
    p.history.forEach((v, i) => {
      const x = CURVE.x + CURVE.w - (p.history.length - 1 - i) * (CURVE.w / CURVE.samples);
      if (i === 0) g.moveTo(x, yOf(v));
      else g.lineTo(x, yOf(v));
    });
    g.strokePath();
    updateText(p.residue, str('boss.residue').replace('{residue}', String(Math.round(caffeine.residue))));
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
    // Before the stamp is handed over there is no pad to fill, so none is drawn.
    const locked = game.stampLocked === true;
    const gaugeKey = `${value}/${lit}/${locked}`;
    if (gaugeKey !== this.shownGauge) {
      this.shownGauge = gaugeKey;
      if (locked) this.gauge.clear();
      else this.drawGauge(value, max, lit);
    }
    this.renderGlucose(glucoseOf(loop.state.run.tags));
    this.renderBoss(game, time);
    this.renderStatus(loop.state);
    this.prompt.setVisible(loop.state.dialogue === null && loop.state.card === null && !loop.state.rescue && selectInteractable(game) !== undefined);
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

  /** Under the clock: the tool in hand once there is a second to swap to, the factory's crate counts in a factory room, and the dizzy warning (design doc 7.7). */
  private renderStatus(state: ChapterState): void {
    const lines: string[] = [];
    const { tool, canSwap } = selectTool(state.game);
    if (canSwap) lines.push(str(`hud.tool.${tool}`));
    if (selectFactory(state.game)) {
      lines.push(str('hud.line').replace('{n}', String(waitingCrates(state.run.tags, TAGS))).replace('{m}', String(acetaldehydeCrates(state.run.tags, TAGS))));
    }
    const orders = workOrders(state.game, waitingCrates(state.run.tags, TAGS)).stacks;
    if (orders > 0) lines.push(str('hud.work_orders').replace('{n}', String(orders)));
    const dizzy = glucoseOf(state.run.tags) !== undefined && isDizzy(state.run.tags);
    if (dizzy) lines.push(str('hud.dizzy'));
    this.haze.setVisible(dizzy);
    const text = lines.join('\n');
    this.status.setY(this.clock.y + this.clock.displayHeight + 2);
    if (text === this.shownStatus) return;
    this.shownStatus = text;
    this.status.setVisible(text !== '');
    if (text !== '') updateText(this.status, text);
  }
}
