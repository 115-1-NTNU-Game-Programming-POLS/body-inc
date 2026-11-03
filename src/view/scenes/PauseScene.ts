import Phaser from 'phaser';
import { str } from '../../app/content.ts';
import { choicesOf, percent, stepSetting, toggleSetting, type ChoiceKey } from '../../app/pause.ts';
import type { SaveStore } from '../../app/storage.ts';
import { SETTINGS, type AssistFlag, type Settings } from '../../core/index.ts';
import { addText } from '../text/fonts.ts';

const INK = 0x0c2d5e;
const PAPER = 0xf4efe4;
const HIGHLIGHT = 0xdfe6f2;
const PANEL = { w: 680, top: 24 };

type Page = 'main' | 'assist';

type Row =
  | { readonly kind: 'action'; readonly label: string; readonly run: () => void }
  | { readonly kind: 'choice'; readonly key: ChoiceKey; readonly label: string; readonly note?: string }
  | { readonly kind: 'flag'; readonly flag: AssistFlag; readonly label: string; readonly note: string };

/** Spacing, text size and top of the rows at 100% text size; the scene stretches them with the text size so the rows do not overlap. */
const LAYOUT = { main: { step: 56, size: 26, top: 96, heading: 36 }, assist: { step: 46, size: 24, top: 88, heading: 32 } } as const;

/**
 * The Esc menu over the paused room (design doc 5.7): resume, the handbook, the text size, the
 * "flexible hours" page of assists, and the way back to the title. A choice is saved as soon as it
 * changes, so a presenter can slow the game down in the middle of a run.
 */
export class PauseScene extends Phaser.Scene {
  private page: Page = 'main';
  private cursor = 0;
  /** The way back to the title costs the progress since the last time clock, so it asks twice. */
  private confirming = false;
  /** The row a pointer press began on, -1 when none. */
  private pressed = -1;
  private rows: readonly Row[] = [];

  constructor() {
    super('Pause');
  }

  create(): void {
    this.go('main', 0);
    const kb = this.input.keyboard!;
    const press = (fn: () => void) => (e: KeyboardEvent) => {
      e.preventDefault();
      if (!e.repeat) fn();
    };
    for (const k of ['W', 'UP']) kb.on(`keydown-${k}`, press(() => this.select(this.cursor - 1)));
    for (const k of ['S', 'DOWN']) kb.on(`keydown-${k}`, press(() => this.select(this.cursor + 1)));
    for (const k of ['A', 'LEFT']) kb.on(`keydown-${k}`, press(() => this.change(-1)));
    for (const k of ['D', 'RIGHT']) kb.on(`keydown-${k}`, press(() => this.change(1)));
    for (const k of ['ENTER', 'J', 'E', 'SPACE']) kb.on(`keydown-${k}`, press(() => this.activate(this.cursor)));
    kb.on('keydown-ESC', press(() => (this.page === 'assist' ? this.go('main', ASSIST_ROW) : this.close())));
  }

  private settings(): Settings {
    return this.registry.get('settings') as Settings;
  }

  private rowsFor(page: Page): readonly Row[] {
    if (page === 'main') {
      return [
        { kind: 'action', label: 'pause.resume', run: () => this.close() },
        { kind: 'action', label: 'pause.handbook', run: () => this.openHandbook() },
        { kind: 'choice', key: 'textScale', label: 'pause.text_size' },
        { kind: 'action', label: 'pause.assist_menu', run: () => this.go('assist', 0) },
        { kind: 'action', label: 'pause.title', run: () => this.leave() },
      ];
    }
    return [
      { kind: 'choice', key: 'gameSpeed', label: 'assist.speed', note: 'assist.speed.note' },
      ...(['halfDamage', 'neverEmpty', 'autoPerfect', 'toggleAttack', 'noShake', 'lessFlash'] as const)
        .map((flag): Row => ({ kind: 'flag', flag, label: `assist.${flag}`, note: `assist.${flag}.note` })),
      { kind: 'action', label: 'assist.back', run: () => this.go('main', ASSIST_ROW) },
    ];
  }

  private go(page: Page, cursor: number): void {
    this.page = page;
    this.cursor = cursor;
    this.pressed = -1;
    this.confirming = false;
    this.rows = this.rowsFor(page);
    this.rebuild();
  }

  private select(to: number): void {
    const next = (to + this.rows.length) % this.rows.length;
    if (next === this.cursor) return;
    this.cursor = next;
    this.confirming = false;
    this.rebuild();
  }

  /** Enter or a click: an action runs, a choice moves to its next value and a flag flips. */
  private activate(i: number): void {
    const row = this.rows[i];
    if (!row) return;
    this.cursor = i;
    if (row.kind === 'action') row.run();
    else this.change(1);
  }

  private change(by: 1 | -1): void {
    const row = this.rows[this.cursor];
    if (!row || row.kind === 'action') return;
    this.save(row.kind === 'choice' ? stepSetting(this.settings(), row.key, by) : toggleSetting(this.settings(), row.flag));
  }

  private save(next: Settings): void {
    this.registry.set('settings', next);
    const issues = (this.registry.get('saves') as SaveStore).save(SETTINGS, next);
    if (issues.length > 0) this.game.events.emit('save-issues', issues);
    this.rebuild();
  }

  /** Drawn again after the current input event: a click that changes the text size replaces the object that was clicked. */
  private rebuild(): void {
    this.time.delayedCall(0, () => this.render());
  }

  private close(): void {
    this.scene.resume('World');
    this.scene.stop();
  }

  /** The handbook takes over the paused room and gives it back when it closes. */
  private openHandbook(): void {
    this.scene.stop();
    this.scene.launch('Handbook');
  }

  /** The run ends here; the story slot already holds the latest time clock, which "continue" on the title reads. */
  private leave(): void {
    if (!this.confirming) {
      this.confirming = true;
      return this.rebuild();
    }
    this.scene.stop('Hud');
    this.scene.stop('World');
    this.scene.start('Title');
  }

  private render(): void {
    this.children.removeAll(true);
    const settings = this.settings();
    const scale = settings.textScale;
    const lay = LAYOUT[this.page];
    const w = this.scale.width;
    const left = (w - PANEL.w) / 2;
    const x = left + 40;
    // Depth -2 and -1: the dimmer under the panel, the panel under the text (the panel is sized last).
    this.add.rectangle(0, 0, w, this.scale.height, INK, 0.85).setOrigin(0, 0).setDepth(-2);
    const heading = addText(this, x, PANEL.top + 16, str(this.page === 'main' ? 'pause.heading' : 'pause.assist_menu'), {
      role: 'hand', weight: 700, size: lay.heading * scale, color: '#0c2d5e',
    });
    let bottom = heading.y + heading.height;

    const step = lay.step * scale;
    this.rows.forEach((row, i) => {
      const y = PANEL.top + lay.top * scale + i * step;
      const on = i === this.cursor;
      const bar = this.add.rectangle(left + 16, y - 6, PANEL.w - 32, step - 6, HIGHLIGHT, on ? 1 : 0).setOrigin(0, 0);
      bar.setInteractive({ useHandCursor: true });
      bar.on('pointerover', () => this.select(i));
      // A click is a press and a release on the same row: the attack button held from the room and let go over a row is not one.
      bar.on('pointerdown', () => { this.pressed = i; });
      bar.on('pointerup', () => {
        if (this.pressed !== i) return;
        this.pressed = -1;
        this.activate(i);
      });
      const line = addText(this, x, y, this.label(row, on, settings), { role: 'print', weight: on ? 700 : 400, size: lay.size * scale, color: '#0c2d5e' });
      bottom = Math.max(bottom, line.y + line.height);
    });

    let noteY = PANEL.top + lay.top * scale + this.rows.length * step + 4;
    const note = (key: string, color: string, weight: 400 | 700 = 400): void => {
      const t = addText(this, x, noteY, str(key), { role: 'print', weight, size: 18 * scale, color, maxWidth: PANEL.w - 80 });
      noteY = t.y + t.height + 6 * scale;
      bottom = Math.max(bottom, t.y + t.height);
    };
    const row = this.rows[this.cursor];
    if (this.page === 'assist') {
      if (row && row.kind !== 'action' && row.note) note(row.note, '#0c2d5e');
      note('pause.assist', '#5a6170');
    }
    if (this.confirming) note('pause.title.warning', '#a3201a', 700);

    // Behind everything above: the panel is sized from the text it holds, which is known only now.
    this.add.rectangle(left, PANEL.top, PANEL.w, bottom + 24 - PANEL.top, PAPER).setOrigin(0, 0).setStrokeStyle(3, INK).setDepth(-1);
    addText(this, w - 24, this.scale.height - 16, str(this.page === 'main' ? 'pause.hint' : 'assist.hint'), {
      role: 'print', weight: 400, size: 18 * scale, color: '#e8edf5',
    }).setOrigin(1, 1);
  }

  private label(row: Row, on: boolean, settings: Settings): string {
    if (row.kind === 'action') return row.label === 'pause.title' && on && this.confirming ? str('pause.title.confirm') : str(row.label);
    if (row.kind === 'flag') {
      const state = settings[row.flag];
      return `${str(row.label)}　${state ? `${str('assist.off')}　[${str('assist.on')}]` : `[${str('assist.off')}]　${str('assist.on')}`}`;
    }
    const now = settings[row.key];
    return `${str(row.label)}　${choicesOf(row.key).map((c) => (c === now ? `[${percent(c)}]` : percent(c))).join('　')}`;
  }
}

/** The row of the main page that opens the assists, where the cursor comes back to. */
const ASSIST_ROW = 3;
