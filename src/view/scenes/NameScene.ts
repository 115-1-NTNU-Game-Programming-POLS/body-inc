import Phaser from 'phaser';
import { str } from '../../app/content.ts';
import { keepHost, NAME_EMPTY, NAME_PROBLEM } from '../../app/host.ts';
import { sharedKeys } from '../../app/input.ts';
import type { SaveStore } from '../../app/storage.ts';
import { DEFAULT_HOST, HOST_MAX, readHostName, type ChapterContent, type NameRead, type ProgressData } from '../../core/index.ts';
import { addText, admitText, setHostName, updateText } from '../text/fonts.ts';
import { FONT } from '../text/styles.ts';
import { startNewGame } from './run.ts';

const PAPER = '#f4efe4';
const INK = '#0c2d5e';
const DIM = '#6b7a94';
const WARN = '#ffb4a8';
/** Far above any name the rules allow; only keeps a paste from filling the box with pages of text. */
const INPUT_LIMIT = 32;

/** `new`: asked before a new game, which starts on confirm. `rename`: from the title, back to it either way. */
export type NameData = { readonly mode: 'new'; readonly chapter: string } | { readonly mode: 'rename' };

/**
 * The host's name (issue #8), asked on the title screen only, never during a chapter. Phaser has
 * no text input, so this is a DOM <input> over the canvas, which is what lets the system IME
 * (Zhuyin and the rest) type Chinese. The name is saved on confirm, not at the next punch.
 */
export class NameScene extends Phaser.Scene {
  private data_!: NameData;
  private field!: HTMLInputElement;
  private message!: Phaser.GameObjects.Text;
  private confirmText!: Phaser.GameObjects.Text;
  private busy = false;
  private leaving = false;

  constructor() {
    super('Name');
  }

  create(data: NameData): void {
    this.data_ = data;
    this.busy = false;
    this.leaving = false;
    const w = this.scale.width;
    const progress = this.registry.get('progress') as ProgressData;

    addText(this, w / 2, 200, str('name.title'), { role: 'hand', weight: 700, size: 44, color: PAPER }).setOrigin(0.5);
    addText(this, w / 2, 268, str('name.note'), { role: 'print', weight: 400, size: 20, color: DIM, maxWidth: 1000 }).setOrigin(0.5);

    const field = document.createElement('input');
    field.type = 'text';
    // Prefilled with the name in use: 小晨 the first time, the last name chosen after that.
    field.value = progress.hostName;
    field.placeholder = DEFAULT_HOST;
    field.maxLength = INPUT_LIMIT;
    field.autocomplete = 'off';
    field.spellcheck = false;
    field.setAttribute('enterkeyhint', 'done');
    field.setAttribute('aria-label', str('name.title'));
    Object.assign(field.style, {
      width: '400px', boxSizing: 'border-box', padding: '10px 16px', border: `3px solid ${PAPER}`, borderRadius: '6px', outline: 'none',
      background: PAPER, color: INK, textAlign: 'center', font: `700 36px "${FONT.print}", sans-serif`,
    });
    this.field = field;
    const dom = this.add.dom(w / 2, 370, field);

    this.message = addText(this, w / 2, 442, '', { role: 'print', weight: 400, size: 20, color: WARN }).setOrigin(0.5);
    const plate = { role: 'print', weight: 700, size: 30, color: PAPER, padding: { x: 20, y: 8 } } as const;
    this.confirmText = addText(this, w / 2, 530, str('name.confirm'), { ...plate, color: INK, backgroundColor: PAPER }).setOrigin(0.5);
    this.confirmText.setInteractive({ useHandCursor: true }).on('pointerup', () => void this.confirm());
    addText(this, w / 2, this.scale.height - 56, str('name.hint'), { role: 'print', weight: 400, size: 18, color: DIM }).setOrigin(0.5);

    // The game's key listeners are on window (app/input.ts and Phaser's keyboard), so a key stopped
    // here never reaches them: W, S or Space type into the box and move nothing. Key-ups are let
    // through, so the tracker never keeps a key it saw go down as held.
    const onFieldKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      // Enter also commits a Zhuyin composition; only an Enter outside one confirms.
      if (e.isComposing || e.keyCode === 229) return;
      this.onKey(e);
    };
    const stop = (e: Event) => e.stopPropagation();
    field.addEventListener('keydown', onFieldKey);
    field.addEventListener('keypress', stop);
    field.addEventListener('input', () => this.validate());
    // With the box unfocused, keys reach the scene instead.
    const onSceneKey = (e: KeyboardEvent) => this.onKey(e);
    this.input.keyboard?.on('keydown', onSceneKey);
    this.input.on('pointerdown', () => field.focus());

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown', onSceneKey);
      field.removeEventListener('keydown', onFieldKey);
      dom.destroy();
      // A key still down from the box must not act in the next scene.
      sharedKeys(this.registry, window).ignoreHeld();
    });

    this.validate();
    field.focus();
    field.select();
  }

  private onKey(e: KeyboardEvent): void {
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat) {
      e.preventDefault();
      void this.confirm();
    } else if (e.code === 'Escape') {
      e.preventDefault();
      this.leave(() => this.scene.start('Title'));
    }
  }

  /**
   * Shows why the typed name is refused, live, and dims confirm until it is not. An empty box is
   * not refused: it confirms as the default name. It is not refilled at once, since a player who
   * clears the box usually means to type a new name.
   */
  private validate(): NameRead {
    const read = readHostName(this.field.value);
    if (!read.ok && read.problem === 'empty') {
      updateText(this.message, str(NAME_EMPTY).replace('{text}', DEFAULT_HOST));
      this.message.setColor(DIM);
      this.confirmText.setColor(INK);
      return { ok: true, name: DEFAULT_HOST };
    }
    updateText(this.message, read.ok || read.problem === 'empty' ? '' : str(NAME_PROBLEM[read.problem]).replace('{n}', String(HOST_MAX)));
    this.message.setColor(WARN);
    this.confirmText.setColor(read.ok ? INK : DIM);
    return read;
  }

  private async confirm(): Promise<void> {
    if (this.busy || this.leaving) return;
    const read = this.validate();
    if (!read.ok) return;
    this.busy = true;
    // A character in no font slice (an emoji, say) is refused here rather than drawn in a fallback font.
    const missing = await admitText(read.name);
    this.busy = false;
    if (!this.scene.isActive() || this.leaving) return;
    if (missing.length > 0) {
      updateText(this.message, str(NAME_PROBLEM.glyph));
      return;
    }
    const kept = keepHost(this.registry.get('saves') as SaveStore, this.registry.get('progress') as ProgressData, read.name);
    this.registry.set('progress', kept.progress);
    if (kept.issues.length > 0) this.game.events.emit('save-issues', kept.issues);
    setHostName(read.name);
    const data = this.data_;
    if (data.mode === 'rename') return this.leave(() => this.scene.start('Title'));
    const chapters = this.registry.get('chapters') as ReadonlyMap<string, ChapterContent>;
    const ctx = chapters.get(data.chapter);
    if (!ctx) throw new Error(`name: chapter "${data.chapter}" is not bundled`);
    this.leave(() => startNewGame(this, ctx));
  }

  private leave(go: () => void): void {
    if (this.leaving) return;
    this.leaving = true;
    this.field.blur();
    // Deferred so the key that confirmed reaches the tracker before the next scene starts.
    window.setTimeout(go, 0);
  }
}
