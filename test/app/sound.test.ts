import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MUSIC_LEVEL, type AudioTable } from '../../src/app/audio.ts';
import { Sound, synthesize, whiteNoise, type SoundContext, type SoundDeps, type TrackPlayer } from '../../src/app/sound.ts';
import { SETTINGS, type Settings } from '../../src/core/index.ts';

class Param {
  value = 0;
  readonly calls: { readonly op: string; readonly v: number; readonly t: number }[] = [];
  setValueAtTime(v: number, t: number): this {
    this.calls.push({ op: 'set', v, t });
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number): this {
    this.calls.push({ op: 'ramp', v, t });
    return this;
  }
  /** The highest value any call set or ramped to. */
  get peak(): number {
    return Math.max(...this.calls.map((c) => c.v));
  }
}

class Node {
  readonly gain = new Param();
  readonly frequency = new Param();
  readonly Q = new Param();
  readonly threshold = new Param();
  readonly knee = new Param();
  readonly ratio = new Param();
  readonly attack = new Param();
  readonly release = new Param();
  type = '';
  loop = false;
  buffer: unknown;
  started?: number;
  stopped?: number;
  readonly to: unknown[] = [];
  connect(next: unknown): unknown {
    this.to.push(next);
    return next;
  }
  start(t: number): void {
    this.started = t;
  }
  stop(t: number): void {
    this.stopped = t;
  }
}

class FakeContext {
  currentTime = 1;
  sampleRate = 8000;
  state = 'running';
  readonly destination = new Node();
  readonly oscillators: Node[] = [];
  readonly sources: Node[] = [];
  readonly filters: Node[] = [];
  readonly gains: Node[] = [];
  resumed = 0;
  createOscillator(): Node {
    const n = new Node();
    this.oscillators.push(n);
    return n;
  }
  createBufferSource(): Node {
    const n = new Node();
    this.sources.push(n);
    return n;
  }
  createBiquadFilter(): Node {
    const n = new Node();
    this.filters.push(n);
    return n;
  }
  createGain(): Node {
    const n = new Node();
    this.gains.push(n);
    return n;
  }
  createDynamicsCompressor(): Node {
    return new Node();
  }
  createBuffer(_channels: number, length: number): { getChannelData: () => Float32Array } {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  resume(): Promise<void> {
    this.resumed++;
    return Promise.resolve();
  }
}

class FakePlayer implements TrackPlayer {
  volume = 1;
  loop = false;
  paused = true;
  src = '';
  plays = 0;
  play(): Promise<void> {
    this.paused = false;
    this.plays++;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
}

const AUDIO = {
  music: {
    tracks: {
      a: { file: 'a.mp3', title: 'A', artist: 'x', sourceUrl: 'u' },
      b: { file: 'b.mp3', title: 'B', artist: 'x', sourceUrl: 'u' },
    },
    scenes: {}, chapters: {}, boss: 'a',
  },
  cues: {
    ping: { voices: [{ kind: 'tone', freq: 440, to: 220, dur: 0.1, gain: 0.3 }] },
    hiss: { minGapMs: 100, voices: [{ kind: 'noise', cutoff: 1000, cutoffTo: 500, filter: 'bandpass', q: 2, at: 0.05, dur: 0.1, gain: 0.2 }] },
    quiet: { trimDb: -6, voices: [{ kind: 'tone', freq: 440, dur: 0.1, gain: 0.4 }] },
  },
} as unknown as AudioTable;

interface Rig {
  readonly sound: Sound;
  readonly ctx: FakeContext;
  readonly players: FakePlayer[];
  settings: Settings;
  clock: number;
  made: number;
}

function rig(over: Partial<Settings> = {}): Rig {
  const r: Rig = {
    ctx: new FakeContext(), players: [], settings: { ...SETTINGS.defaults(), ...over }, clock: 1000, made: 0, sound: undefined as unknown as Sound,
  };
  const deps: SoundDeps = {
    settings: () => r.settings,
    makeContext: () => {
      r.made++;
      return r.ctx as unknown as SoundContext;
    },
    makePlayer: () => {
      const p = new FakePlayer();
      r.players.push(p);
      return p;
    },
    now: () => r.clock,
    musicBase: 'music/',
  };
  return Object.assign(r, { sound: new Sound(AUDIO, deps) });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('white noise', () => {
  it('is the same every time and stays within -1 and 1', () => {
    const a = whiteNoise(new FakeContext() as unknown as SoundContext).getChannelData(0);
    const b = whiteNoise(new FakeContext() as unknown as SoundContext).getChannelData(0);
    expect(Array.from(a.slice(0, 50))).toEqual(Array.from(b.slice(0, 50)));
    expect(Math.min(...a)).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...a)).toBeLessThan(1);
    expect(new Set(a).size).toBeGreaterThan(a.length / 2);
  });
});

describe('synthesizing a cue', () => {
  it('starts a tone at its pitch and glides to the end pitch over its length, shifted by the ratio', () => {
    const ctx = new FakeContext();
    const out = new Node();
    synthesize(ctx as unknown as SoundContext, out as unknown as AudioNode, AUDIO.cues.ping!, whiteNoise(ctx as unknown as SoundContext), 2, 2);
    const osc = ctx.oscillators[0]!;
    expect(osc.frequency.calls).toEqual([{ op: 'set', v: 880, t: 2 }, { op: 'ramp', v: 440, t: 2.1 }]);
    expect(osc.started).toBe(2);
    expect(osc.stopped).toBeGreaterThan(2.1);
  });

  it('starts a noise through a filter of its kind, delayed by its start, and loops the shared buffer', () => {
    const ctx = new FakeContext();
    const noise = whiteNoise(ctx as unknown as SoundContext);
    synthesize(ctx as unknown as SoundContext, new Node() as unknown as AudioNode, AUDIO.cues.hiss!, noise, 2);
    const src = ctx.sources[0]!;
    const f = ctx.filters[0]!;
    expect(src.started).toBeCloseTo(2.05, 10);
    expect(src.loop).toBe(true);
    expect(src.buffer).toBe(noise);
    expect(f.type).toBe('bandpass');
    expect(f.frequency.calls[0]).toEqual({ op: 'set', v: 1000, t: 2.05 });
    expect(f.Q.calls[0]!.v).toBe(2);
  });

  it('scales the level of every voice, and each ends at the floor so it never stops with a click', () => {
    const ctx = new FakeContext();
    synthesize(ctx as unknown as SoundContext, new Node() as unknown as AudioNode, AUDIO.cues.ping!, whiteNoise(ctx as unknown as SoundContext), 0, 1, 0.5);
    const g = ctx.gains[0]!;
    expect(g.gain.peak).toBeCloseTo(0.15, 10);
    expect(g.gain.calls.at(-1)!.v).toBeLessThan(0.001);
    expect(g.gain.calls.every((c) => c.v > 0)).toBe(true);
  });
});

describe('effects', () => {
  it('say nothing before the first gesture and sound after it', () => {
    const r = rig();
    expect(r.sound.cue('ping')).toBe(false);
    r.sound.unlock();
    expect(r.sound.cue('ping')).toBe(true);
    expect(r.ctx.oscillators).toHaveLength(1);
  });

  it('make the context once, however many gestures follow', () => {
    const r = rig();
    for (let i = 0; i < 5; i++) r.sound.unlock();
    expect(r.made).toBe(1);
    expect(r.ctx.resumed).toBe(1);
  });

  it('try to resume a context that is still suspended on the next gesture, and stop once it runs', () => {
    const r = rig();
    r.ctx.state = 'suspended';
    r.sound.unlock();
    expect(r.sound.cue('ping')).toBe(false);
    r.sound.unlock();
    expect(r.ctx.resumed).toBe(2);
    r.ctx.state = 'running';
    r.sound.unlock();
    expect(r.ctx.resumed).toBe(2);
    expect(r.sound.cue('ping')).toBe(true);
  });

  it('play a semitone higher for each step', () => {
    const r = rig();
    r.sound.unlock();
    r.sound.cue('ping', 12);
    expect(r.ctx.oscillators[0]!.frequency.calls[0]!.v).toBeCloseTo(880, 6);
  });

  it('ask for a cue that is not there and get false', () => {
    const r = rig();
    r.sound.unlock();
    expect(r.sound.cue('nothing')).toBe(false);
  });

  it('go through the effects volume, squared, and not at all at zero', () => {
    const r = rig({ sfxVolume: 0.5 });
    r.sound.unlock();
    r.sound.cue('ping');
    expect(r.ctx.gains[0]!.gain.value).toBeCloseTo(0.25, 10);
    r.settings = { ...r.settings, sfxVolume: 0 };
    r.clock += 1000;
    const before = r.ctx.oscillators.length;
    expect(r.sound.cue('ping')).toBe(false);
    expect(r.ctx.oscillators).toHaveLength(before);
  });

  it('follow a change of the volume without a new cue', () => {
    const r = rig();
    r.sound.unlock();
    r.settings = { ...r.settings, sfxVolume: 0.25 };
    r.sound.apply();
    expect(r.ctx.gains[0]!.gain.value).toBeCloseTo(0.0625, 10);
  });

  it('read the volume as they start, so a change that was not announced is still heard', () => {
    const r = rig();
    r.sound.unlock();
    r.settings = { ...r.settings, sfxVolume: 0.5 };
    r.sound.cue('ping');
    expect(r.ctx.gains[0]!.gain.value).toBeCloseTo(0.25, 10);
  });

  it('let a cue with no gap of its own start again after 30 ms and not before', () => {
    const r = rig();
    r.sound.unlock();
    expect(r.sound.cue('ping')).toBe(true);
    r.clock += 29;
    expect(r.sound.cue('ping')).toBe(false);
    r.clock += 1;
    expect(r.sound.cue('ping')).toBe(true);
  });

  it('apply the trim of the cue to its level', () => {
    const r = rig();
    r.sound.unlock();
    r.sound.cue('quiet');
    const voice = r.ctx.gains.at(-1)!;
    expect(voice.gain.peak).toBeCloseTo(0.4 * 10 ** (-6 / 20), 6);
  });

  it('let the same cue start again only after its gap, and another cue at once', () => {
    const r = rig();
    r.sound.unlock();
    expect(r.sound.cue('hiss')).toBe(true);
    r.clock += 99;
    expect(r.sound.cue('hiss')).toBe(false);
    expect(r.sound.cue('ping')).toBe(true);
    r.clock += 1;
    expect(r.sound.cue('hiss')).toBe(true);
  });

  it('are not rate limited by a rejected try, so the gap runs from the last sound', () => {
    const r = rig();
    r.sound.unlock();
    r.sound.cue('hiss');
    r.clock += 60;
    r.sound.cue('hiss');
    r.clock += 60;
    expect(r.sound.cue('hiss')).toBe(true);
  });

  it('are dropped, not queued, where the browser has no audio', () => {
    const deps: SoundDeps = { settings: () => undefined, makeContext: () => undefined, makePlayer: () => new FakePlayer(), now: () => 0, musicBase: '' };
    const s = new Sound(AUDIO, deps);
    s.unlock();
    expect(s.cue('ping')).toBe(false);
  });
});

describe('music', () => {
  it('waits for the first gesture and then starts the track that was asked for last', () => {
    const r = rig();
    r.sound.music('a');
    r.sound.music('b');
    expect(r.players).toHaveLength(0);
    r.sound.unlock();
    expect(r.players).toHaveLength(1);
    expect(r.players[0]!.src).toBe('music/b.mp3');
    expect(r.players[0]!.loop).toBe(true);
    expect(r.players[0]!.plays).toBe(1);
  });

  it('fades in to the music level under the volume setting', () => {
    const r = rig({ musicVolume: 0.5 });
    r.sound.unlock();
    r.sound.music('a');
    expect(r.players[0]!.volume).toBe(0);
    vi.advanceTimersByTime(2000);
    expect(r.players[0]!.volume).toBeCloseTo(MUSIC_LEVEL * 0.25, 10);
  });

  it('asked for again, keeps playing the same track and does not start another', () => {
    const r = rig();
    r.sound.unlock();
    r.sound.music('a');
    vi.advanceTimersByTime(2000);
    r.sound.music('a');
    r.sound.music('a');
    expect(r.players).toHaveLength(1);
    expect(r.players[0]!.plays).toBe(1);
  });

  it('crosses over to another track, and the old one ends stopped and let go', () => {
    const r = rig();
    r.sound.unlock();
    r.sound.music('a');
    vi.advanceTimersByTime(2000);
    r.sound.music('b');
    vi.advanceTimersByTime(400);
    expect(r.players).toHaveLength(2);
    expect(r.players[0]!.volume).toBeGreaterThan(0);
    expect(r.players[0]!.volume).toBeLessThan(MUSIC_LEVEL);
    expect(r.players[1]!.volume).toBeGreaterThan(0);
    vi.advanceTimersByTime(2000);
    expect(r.players[0]!.paused).toBe(true);
    expect(r.players[0]!.src).toBe('');
    expect(r.players[1]!.volume).toBeCloseTo(MUSIC_LEVEL, 10);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps one fade timer however often the track changes mid-fade, and none once everything has settled', () => {
    const r = rig();
    r.sound.unlock();
    r.sound.music('a');
    vi.advanceTimersByTime(200);
    r.sound.music('b');
    vi.advanceTimersByTime(200);
    r.sound.music('a');
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(5000);
    expect(vi.getTimerCount()).toBe(0);
    expect(r.players.filter((p) => !p.paused)).toHaveLength(1);
  });

  it('leaves the music alone when no track is named, or the track is not known', () => {
    const r = rig();
    r.sound.unlock();
    r.sound.music('a');
    r.sound.music(undefined);
    expect(r.players).toHaveLength(1);
    vi.advanceTimersByTime(2000);
    expect(r.players[0]!.volume).toBeCloseTo(MUSIC_LEVEL, 10);
    r.sound.music('nothing');
    vi.advanceTimersByTime(2000);
    expect(r.players).toHaveLength(1);
    expect(r.players[0]!.paused).toBe(false);
    expect(r.players[0]!.volume).toBeCloseTo(MUSIC_LEVEL, 10);
    // And the track that is playing is still the one a repeated request finds.
    r.sound.music('a');
    expect(r.players).toHaveLength(1);
  });

  it('follows the volume setting while it plays, and is silent at zero', () => {
    const r = rig();
    r.sound.unlock();
    r.sound.music('a');
    vi.advanceTimersByTime(2000);
    r.settings = { ...r.settings, musicVolume: 0.75 };
    r.sound.apply();
    expect(r.players[0]!.volume).toBeCloseTo(MUSIC_LEVEL * 0.5625, 10);
    r.settings = { ...r.settings, musicVolume: 0 };
    r.sound.apply();
    expect(r.players[0]!.volume).toBe(0);
  });

  it('stops while the page is hidden and goes on when it is shown, but not a track that is on its way out', () => {
    const r = rig();
    r.sound.unlock();
    r.sound.music('a');
    vi.advanceTimersByTime(2000);
    r.sound.hidden(true);
    expect(r.players[0]!.paused).toBe(true);
    r.sound.hidden(false);
    expect(r.players[0]!.paused).toBe(false);
    r.sound.music('b');
    r.sound.hidden(true);
    r.sound.hidden(false);
    expect(r.players[0]!.paused).toBe(true);
    expect(r.players[1]!.paused).toBe(false);
  });

  it('is silenced with a fade and starts again at the next request', () => {
    const r = rig();
    r.sound.unlock();
    r.sound.music('a');
    vi.advanceTimersByTime(2000);
    r.sound.silence();
    vi.advanceTimersByTime(2000);
    expect(r.players[0]!.paused).toBe(true);
    r.sound.music('a');
    expect(r.players).toHaveLength(2);
  });
});
