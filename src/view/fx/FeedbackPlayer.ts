import Phaser from 'phaser';
import { bearing, captionsOn, captionTicks, soundFor, type AudioTable, type Caption, type WorldCaption } from '../../app/audio.ts';
import { noteText, type FeedbackTable, type StringTable } from '../../app/feedback.ts';
import { TICK_HZ, type GameEvent, type Settings } from '../../core/index.ts';
import type { OperatorView } from '../actors/OperatorView.ts';
import { soundIn } from '../audio/installSound.ts';
import { comfortIn } from './comfortIn.ts';

/** Closer than this a source needs no arrow: it is on top of the operator. */
const ARROW_MIN_PX = 24;

/** What feedback can do to an enemy or boss sprite. */
export interface ActorFx {
  readonly sprite: Phaser.GameObjects.Sprite;
  /** How far above the feet effects and notes appear; 12 when absent. */
  readonly effectLift?: number;
  flash(ticks: number, now: number): void;
  bounce(): void;
  closeOut(): void;
}

export interface FeedbackTargets {
  enemy(id: number): ActorFx | undefined;
  readonly operator: OperatorView;
  /** Shows a note at a world position; the Hud draws it at full resolution. */
  note(text: string, worldX: number, worldY: number): void;
}

/**
 * Turns domain events into presentation through content/feedback.json. It only reads events;
 * nothing here can change an outcome. Particle randomness is cosmetic and never touches core RNG.
 */
export class FeedbackPlayer {
  private readonly scene: Phaser.Scene;
  private readonly table: FeedbackTable;
  private readonly audio: AudioTable;
  private readonly strings: StringTable;
  private readonly targets: FeedbackTargets;
  private readonly emitters = new Map<string, Phaser.GameObjects.Particles.ParticleEmitter>();
  private beating?: Phaser.Tweens.Tween;
  private zoom0?: number;

  constructor(scene: Phaser.Scene, table: FeedbackTable, audio: AudioTable, strings: StringTable, targets: FeedbackTargets) {
    this.scene = scene;
    this.table = table;
    this.audio = audio;
    this.strings = strings;
    this.targets = targets;
  }

  /** Shows a caption when the assist is on; `from` is the world position of the sound, for the arrow. */
  private caption(c: Caption, from?: { readonly x: number; readonly y: number }): void {
    if (!captionsOn(this.scene.registry.get('settings') as Settings | undefined)) return;
    const text = this.strings.strings[c.key]?.text;
    if (!text) return;
    const angle = from ? bearing(this.targets.operator.position, from, ARROW_MIN_PX) : undefined;
    this.scene.game.events.emit('world-caption', { text, seconds: c.ticks / TICK_HZ, ...(angle === undefined ? {} : { angle }) } satisfies WorldCaption);
  }

  /** What an event sounds like and says: the cue, and its caption with an arrow towards the one who made it. */
  sound(event: GameEvent): void {
    const s = soundFor(this.table, this.audio, event);
    if (!s) return;
    soundIn(this.scene)?.cue(s.cue, s.semitones);
    if (!s.caption) return;
    const source = 'source' in event ? event.source : 'target' in event ? event.target : undefined;
    const sprite = source === undefined ? undefined : this.targets.enemy(source)?.sprite;
    this.caption(s.caption, sprite ? { x: sprite.x, y: sprite.y } : undefined);
  }

  /** A cue played on its own, with its caption: the ticking clock of the last heart. */
  cue(id: string): void {
    soundIn(this.scene)?.cue(id);
    const key = this.audio.cues[id]?.caption;
    if (key) this.caption({ key, ticks: captionTicks() });
  }

  private emitter(preset: string): Phaser.GameObjects.Particles.ParticleEmitter | undefined {
    const p = this.table.presets[preset];
    if (!p) return undefined;
    let e = this.emitters.get(preset);
    if (!e) {
      e = this.scene.add.particles(0, 0, p.texture, {
        speed: { min: p.speed[0]!, max: p.speed[1]! }, angle: { min: 0, max: 360 },
        lifespan: p.life * 1000, alpha: { start: 1, end: 0 }, emitting: false, maxAliveParticles: 200,
      }).setDepth(1e5);
      this.emitters.set(preset, e);
    }
    return e;
  }

  /** A heartbeat on the camera. A second can before the first has settled restarts from the zoom the scene had. */
  private pulse(p: { readonly amount: number; readonly beats: number; readonly seconds: number }): void {
    const cam = this.scene.cameras.main;
    this.beating?.stop();
    cam.setZoom(this.zoom0 ??= cam.zoom);
    const base = this.zoom0;
    this.beating = this.scene.tweens.add({
      targets: cam, zoom: base * (1 + p.amount), duration: (p.seconds * 1000) / p.beats / 2, yoyo: true, repeat: p.beats - 1,
      onComplete: () => cam.setZoom(base),
    });
  }

  play(event: GameEvent, tick: number): void {
    this.sound(event);
    const fb = this.table.events[event.type];
    if (!fb) return;
    const enemy = 'target' in event ? this.targets.enemy(event.target) : undefined;
    const at = enemy
      ? { x: enemy.sprite.x, y: enemy.sprite.y - (enemy.effectLift ?? 12) }
      : { x: this.targets.operator.position.x, y: this.targets.operator.position.y - 20 };

    if (fb.flashTarget && enemy) enemy.flash(fb.flashTarget, tick);
    if (fb.flashOperator) this.targets.operator.flash(fb.flashOperator, tick);
    if (fb.bounce) enemy?.bounce();
    if (fb.closeOut) enemy?.closeOut();
    const comfort = comfortIn(this.scene);
    if (fb.shake && !comfort.noShake) {
      const cam = this.scene.cameras.main;
      cam.shake(fb.shake.seconds * 1000, fb.shake.px / cam.width);
    }
    if (fb.pulse && !comfort.lessFlash) this.pulse(fb.pulse);
    for (const p of fb.particles ?? []) this.emitter(p.preset)?.explode(p.count, at.x, at.y);
    if (fb.note) {
      const text = noteText(fb.note, event, this.strings);
      if (text) this.targets.note(text, at.x, at.y - 16);
    }
  }
}
