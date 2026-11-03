import type { Cue, Settings, Voice } from '../core/index.ts';
import { clampSemitones, gapPassed, levelOf, MUSIC_LEVEL, semitoneRatio, trimOf, type AudioTable } from './audio.ts';

/** What the synthesis needs of an audio context, so a test can stand in for the browser's. */
export interface SynthContext {
  readonly currentTime: number;
  readonly sampleRate: number;
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
  createBiquadFilter(): BiquadFilterNode;
  createBufferSource(): AudioBufferSourceNode;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer;
}

/** The ramp up of every voice, in seconds: fast enough to be a click, slow enough not to pop. */
const ATTACK = 0.006;
/** The floor an exponential ramp stops at; it cannot reach zero. */
const FLOOR = 0.0001;
const NOISE_SECONDS = 1;

/** A second of white noise from a fixed generator, so a cue sounds the same every time it is played. */
export function whiteNoise(ctx: SynthContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * NOISE_SECONDS), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let s = 0x2f6e2b1;
  for (let i = 0; i < data.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    data[i] = s / 0x80000000 - 1;
  }
  return buffer;
}

/** Gain that rises to `peak` and falls away over `dur`, from `t0`. */
function envelope(ctx: SynthContext, voice: Voice, t0: number, scale: number): GainNode {
  const g = ctx.createGain();
  const peak = Math.max(FLOOR * 2, voice.gain * scale);
  g.gain.setValueAtTime(FLOOR, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(ATTACK, voice.dur / 2));
  g.gain.exponentialRampToValueAtTime(FLOOR, t0 + voice.dur);
  return g;
}

/**
 * Starts every voice of a cue on `out`, `at` seconds from now on the context's clock. `ratio`
 * shifts every pitch and filter; `scale` multiplies every voice's level.
 */
export function synthesize(ctx: SynthContext, out: AudioNode, cue: Cue, noise: AudioBuffer, at: number, ratio = 1, scale = 1): void {
  for (const v of cue.voices) {
    const t0 = at + (v.at ?? 0);
    const g = envelope(ctx, v, t0, scale);
    g.connect(out);
    if (v.kind === 'tone') {
      const osc = ctx.createOscillator();
      osc.type = v.wave ?? 'sine';
      osc.frequency.setValueAtTime(v.freq! * ratio, t0);
      if (v.to !== undefined) osc.frequency.exponentialRampToValueAtTime(v.to * ratio, t0 + v.dur);
      osc.connect(g);
      osc.start(t0);
      osc.stop(t0 + v.dur + 0.02);
    } else {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = v.filter ?? 'lowpass';
      f.frequency.setValueAtTime(v.cutoff! * ratio, t0);
      if (v.cutoffTo !== undefined) f.frequency.exponentialRampToValueAtTime(v.cutoffTo * ratio, t0 + v.dur);
      if (v.q !== undefined) f.Q.setValueAtTime(v.q, t0);
      src.connect(f).connect(g);
      src.start(t0);
      src.stop(t0 + v.dur + 0.02);
    }
  }
}

/** What a played music file does, so the player can be driven without a browser. */
export interface TrackPlayer {
  volume: number;
  loop: boolean;
  readonly paused: boolean;
  src: string;
  play(): Promise<void>;
  pause(): void;
}

/** The context of the speakers: what the synthesis needs, and the master it is connected to. */
export interface SoundContext extends SynthContext {
  readonly destination: AudioNode;
  readonly state: string;
  resume(): Promise<void>;
  createDynamicsCompressor(): DynamicsCompressorNode;
}

export interface SoundDeps {
  readonly settings: () => Settings | undefined;
  /** A new audio context, or undefined where the browser has none. */
  readonly makeContext: () => SoundContext | undefined;
  readonly makePlayer: () => TrackPlayer;
  readonly now: () => number;
  /** Where the music files are, with a trailing slash. */
  readonly musicBase: string;
}

/** Seconds a track takes to fade out when another starts, and to fade in. */
const FADE_SECONDS = 0.8;
const FADE_STEP_MS = 50;

interface Playing {
  readonly id: string;
  readonly player: TrackPlayer;
  /** 0 to 1: how far the fade has brought it. */
  fade: number;
  /** Where the fade is going: 1 while it is the track, 0 once another has taken over. */
  goal: 0 | 1;
}

/**
 * The speakers of the game: effects synthesized from the cues of content/audio.json and the music
 * of its tracks. It only plays; nothing here can change an outcome. The browser starts audio only
 * after a gesture, so everything asked for before `unlock` waits for it (the music) or is dropped
 * (an effect that is already over by then).
 */
export class Sound {
  private readonly audio: AudioTable;
  private readonly deps: SoundDeps;
  private ctx: SoundContext | undefined;
  private bus: GainNode | undefined;
  private noise: AudioBuffer | undefined;
  private readonly lastAt = new Map<string, number>();
  private wanted: string | undefined;
  private readonly playing: Playing[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private unlocked = false;
  /** The page is hidden: nothing new starts until it is shown. */
  private away = false;

  constructor(audio: AudioTable, deps: SoundDeps) {
    this.audio = audio;
    this.deps = deps;
  }

  /** The first gesture of the page: the context can be made and the music can start. */
  unlock(): void {
    // Every gesture of the page calls this; once the context runs there is nothing more to do.
    if (this.unlocked && (!this.ctx || this.ctx.state === 'running')) return;
    if (!this.unlocked) {
      this.unlocked = true;
      this.build();
    }
    void this.ctx?.resume();
    this.apply();
    this.music(this.wanted);
  }

  /**
   * Makes the context and the effects bus. A browser that refuses a context (too many open, or a
   * policy) leaves the game without effects but still with music, which an Audio element plays
   * without a context; nothing is kept unless all of it was made.
   */
  private build(): void {
    try {
      const ctx = this.deps.makeContext();
      if (!ctx) return;
      // A limiter on the master so cues that overlap (a swing, a hit and a heart at once) do not clip.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -2;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.1;
      const bus = ctx.createGain();
      bus.connect(limiter).connect(ctx.destination);
      this.noise = whiteNoise(ctx);
      this.bus = bus;
      this.ctx = ctx;
    } catch {
      this.ctx = undefined;
      this.bus = undefined;
      this.noise = undefined;
    }
  }

  /** The level of the effects bus under the player's own volume. */
  private sfxLevel(): number {
    return levelOf(this.deps.settings()?.sfxVolume ?? 1);
  }

  /** Plays a cue by id; false when nothing started (unknown, rate limited, muted or not unlocked yet). */
  cue(id: string, semitones = 0): boolean {
    const cue = this.audio.cues[id];
    if (!cue || !this.ctx || !this.bus || !this.noise || this.ctx.state === 'suspended') return false;
    const level = this.sfxLevel();
    if (level === 0) return false;
    const now = this.deps.now();
    if (!gapPassed(this.lastAt.get(id), now, cue.minGapMs ?? 30)) return false;
    this.lastAt.set(id, now);
    this.bus.gain.value = level;
    synthesize(this.ctx, this.bus, cue, this.noise, this.ctx.currentTime, semitoneRatio(clampSemitones(semitones)), trimOf(cue));
    return true;
  }

  /** The level music files play at, from the settings. */
  private musicLevel(): number {
    return MUSIC_LEVEL * levelOf(this.deps.settings()?.musicVolume ?? 1);
  }

  /** Brings the volumes of what is playing in line with the settings; called when they change. */
  apply(): void {
    if (this.bus) this.bus.gain.value = this.sfxLevel();
    for (const p of this.playing) p.player.volume = this.musicLevel() * p.fade;
  }

  /** The track that should be playing; undefined leaves the music as it is. The same track again does nothing. */
  music(id: string | undefined): void {
    if (id === undefined) return;
    this.wanted = id;
    if (!this.unlocked || this.away) return;
    const current = this.playing.find((p) => p.goal === 1);
    if (current?.id === id) {
      if (current.player.paused) void current.player.play().catch(() => undefined);
      return;
    }
    const track = this.audio.music.tracks[id];
    // An unknown track (the content check refuses one) must not take the current music down with it.
    if (!track) return;
    for (const p of this.playing) p.goal = 0;
    const player = this.deps.makePlayer();
    player.src = `${this.deps.musicBase}${track.file}`;
    player.loop = true;
    player.volume = 0;
    this.playing.push({ id, player, fade: 0, goal: 1 });
    void player.play().catch(() => undefined);
    this.startFading();
  }

  /** Stops the music with a fade, as the title does when the run ends; the next `music` call starts one again. */
  silence(): void {
    this.wanted = undefined;
    for (const p of this.playing) p.goal = 0;
    this.startFading();
  }

  /**
   * The page is hidden or shown: music is not left running behind a tab, and a scene that asks for
   * a track while the page is hidden does not start it. Shown again, the track asked for last plays.
   */
  hidden(hidden: boolean): void {
    this.away = hidden;
    if (hidden) {
      for (const p of this.playing) p.player.pause();
      return;
    }
    this.music(this.wanted);
  }

  private startFading(): void {
    this.timer ??= setInterval(() => this.fadeStep(), FADE_STEP_MS);
  }

  private fadeStep(): void {
    const step = FADE_STEP_MS / 1000 / FADE_SECONDS;
    for (const p of [...this.playing]) {
      p.fade = p.goal === 1 ? Math.min(1, p.fade + step) : Math.max(0, p.fade - step);
      p.player.volume = this.musicLevel() * p.fade;
      if (p.goal === 0 && p.fade === 0) {
        p.player.pause();
        p.player.src = '';
        this.playing.splice(this.playing.indexOf(p), 1);
      }
    }
    if (this.playing.every((p) => p.goal === 1 && p.fade === 1) && this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
