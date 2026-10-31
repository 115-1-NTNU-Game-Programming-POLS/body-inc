import Phaser from 'phaser';
import { fillStr as fill, str } from '../../app/content.ts';
import { sharedKeys, type KeyboardInput } from '../../app/input.ts';
import type { FixedStepLoop } from '../../app/loop.ts';
import type { ChapterState, ExamForecast, ExamPanel, ExamResult, GameEvent, Settings } from '../../core/index.ts';
import { addText } from '../text/fonts.ts';

const INK = 0x0c2d5e;
const PAPER = 0xfbfaf6;
const PANEL = { w: 680, padding: 28 } as const;

const pct = (x: number) => String(Math.round(x * 100));

/**
 * The exam's forecast before the fight and its result after (design doc 7.6), over the frozen
 * room. It only draws: the panel runs in core, and a confirm or a click reaches core on the next tick.
 */
export class ExamScene extends Phaser.Scene {
  private keys!: KeyboardInput;
  private layer!: Phaser.GameObjects.Container;
  private shown = '';

  constructor() {
    super('Exam');
  }

  create(): void {
    this.keys = sharedKeys(this.registry, window);
    this.layer = this.add.container(0, 0);
    this.shown = '';
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.clear());
  }

  override update(): void {
    const loop = this.registry.get('loop') as FixedStepLoop<ChapterState, GameEvent> | undefined;
    const panel = loop?.state.exam;
    if (!panel) {
      if (this.shown !== '') {
        this.clear();
        this.keys.ignoreMouse(false);
      }
      return;
    }
    const key = `${panel.id}|${panel.result ? 'result' : 'forecast'}`;
    if (key !== this.shown) this.show(panel, key);
  }

  private clear(): void {
    this.layer.removeAll(true);
    this.shown = '';
  }

  private show(p: ExamPanel, key: string): void {
    this.clear();
    this.shown = key;
    // Mouse0 is also attack; the panel's own zone turns a click into a pick.
    this.keys.ignoreMouse(true);
    const scale = (this.registry.get('settings') as Settings | undefined)?.textScale ?? 1;
    const inner = PANEL.w - 2 * PANEL.padding;
    const items: Phaser.GameObjects.GameObject[] = [];
    let y = PANEL.padding;
    const text = (t: string, size: number, color = '#2b3448', weight: 400 | 700 = 400) => {
      const o = addText(this, PANEL.padding, y, t, { role: 'print', weight, size: size * scale, color, maxWidth: inner, lineHeight: 1.5 });
      items.push(o);
      y += o.displayHeight + 10;
    };
    const segment = (kind: string) => str(`exam.${p.id}.segment.${kind}`);

    if (p.forecast) this.forecast(p.forecast, text, segment);
    else if (p.result) this.result(p.id, p.result, text, segment);
    text(str(p.result ? 'exam.panel.continue' : 'exam.panel.start'), 15, '#5a6478');

    const h = y + PANEL.padding - 10;
    const left = (this.scale.width - PANEL.w) / 2;
    const top = Math.max(24, (this.scale.height - h) / 2);
    const g = this.add.graphics();
    g.fillStyle(INK, 0.2).fillRoundedRect(6, 6, PANEL.w, h, 12);
    g.fillStyle(PAPER).fillRoundedRect(0, 0, PANEL.w, h, 12).lineStyle(2, INK, 1).strokeRoundedRect(1, 1, PANEL.w - 2, h - 2, 12);
    const zone = this.add.zone(0, 0, PANEL.w, h).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    zone.on('pointerdown', () => this.keys.queuePick(1));
    this.layer.add(this.add.rectangle(0, 0, this.scale.width, this.scale.height, INK, 0.72).setOrigin(0, 0));
    this.layer.add(this.add.container(left, top, [g, ...items, zone]));
  }

  private forecast(f: ExamForecast, text: (t: string, size: number, color?: string, weight?: 400 | 700) => void, segment: (k: string) => string): void {
    text(str('exam.forecast.title'), 22, '#0c2d5e', 700);
    for (const b of f.bars) text(fill('exam.forecast.ready', { label: segment(b.kind), value: b.readiness }), 18, '#0c2d5e', 700);
    text(fill('exam.forecast.state', { n: f.adenosine, seconds: f.cloakSeconds }), 18);
    text(fill('exam.forecast.s', { value: f.s.toFixed(2) }), 18);
    text(str(`exam.forecast.breakfast.${f.breakfast}`), 18);
    text(str('exam.forecast.rules'), 15, '#5a6478');
  }

  private result(id: string, r: ExamResult, text: (t: string, size: number, color?: string, weight?: 400 | 700) => void, segment: (k: string) => string): void {
    text(fill('exam.result.title', { label: str(`exam.${id}.name`) }), 22, '#0c2d5e', 700);
    for (const s of r.segments) {
      text(fill('exam.result.segment', { label: segment(s.kind), total: Math.round(s.score.examPercent) }), 18, '#0c2d5e', 700);
      const factor = s.score.kind === 'fever-makeup' ? 1 : s.score.factor;
      text(fill(s.noBonus ? 'exam.result.detail.no_bonus' : 'exam.result.detail', { r: s.readiness, n: pct(s.answerRate), h: pct(s.hitScore), g: pct(s.bonusRate), value: factor.toFixed(2) }), 15);
    }
    text(fill('exam.result.s', { value: r.s.toFixed(2) }), 15);
    text(fill('exam.result.total', { total: r.total }), 22, '#c8372d', 700);
    if (r.practiceOnly) text(str('exam.result.practice_only'), 16, '#8a2a22', 700);
  }
}
