import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  audioProblems, bearing, captionsOn, captionTicks, clampSemitones, levelOf, lowHeartBeat, MAX_SEMITONES, musicFor, peakSum, secondOf, semitoneRatio,
  SOUND_FIELDS, soundFor, trimOf, UI, type AudioTable,
} from '../../src/app/audio.ts';
import { AUDIO, ENEMIES, FEEDBACK, STRINGS } from '../../src/app/content.ts';
import { noteFields, type FeedbackTable } from '../../src/app/feedback.ts';
import { FixedStepLoop } from '../../src/app/loop.ts';
import { SETTINGS, TELEGRAPH, TICK_HZ, type Cue, type GameEvent } from '../../src/core/index.ts';

const FIELDS = noteFields(ENEMIES);
const CHAPTERS = ['prologue', 'brain', 'greybox', 'liver', 'midterm', 'wall', 'patrol-brain', 'patrol-liver'];

const problems = (audio: AudioTable = AUDIO, feedback: FeedbackTable = FEEDBACK): string[] =>
  audioProblems(audio, feedback, STRINGS, FIELDS, Object.values(UI), CHAPTERS);

const withCue = (id: string, cue: Cue): AudioTable => ({ ...AUDIO, cues: { ...AUDIO.cues, [id]: cue } });
const tone = (gain: number, at = 0, dur = 0.1): Cue['voices'][number] => ({ kind: 'tone', freq: 440, at, dur, gain });

describe('the audio content', () => {
  it('passes its own check against the feedback table and the strings', () => {
    expect(problems()).toEqual([]);
  });

  it('a cue with a caption is played only by the events its caption describes', () => {
    // A caption names what happened, so an event borrowing a captioned cue tells a deaf player something else.
    const captioned = Object.entries(FEEDBACK.events).flatMap(([type, e]) => {
      const sound = e.sound;
      if (!sound) return [];
      const cues = Object.keys(AUDIO.cues).filter((c) => c === sound || (sound.includes('{') && c.startsWith(sound.split('{')[0]!)));
      return cues.some((c) => AUDIO.cues[c]!.caption !== undefined) ? [type] : [];
    });
    expect(captioned.sort()).toEqual(['gaugeFull', 'parry', 'refused', 'shieldBroken', 'stampLanded', 'telegraph']);
  });

  it('the three telegraph tiers are three different cues with their own captions', () => {
    const ids = [1, 2, 3].map((tier) => soundFor(FEEDBACK, AUDIO, { type: 'telegraph', source: 1, tier: tier as 1 | 2 | 3 })!);
    expect(new Set(ids.map((s) => s.cue)).size).toBe(3);
    expect(new Set(ids.map((s) => s.caption?.key)).size).toBe(3);
    for (const s of ids) expect(STRINGS.strings[s.caption!.key]?.text).toMatch(/^【/);
  });

  it('every cue stays under 1 at its loudest moment', () => {
    for (const [id, cue] of Object.entries(AUDIO.cues)) expect(peakSum(cue), id).toBeLessThanOrEqual(1);
  });
});

describe('what an event sounds like', () => {
  it('a swing rises one semitone per combo step', () => {
    expect(soundFor(FEEDBACK, AUDIO, { type: 'swing', combo: 0 })).toMatchObject({ cue: 'swing', semitones: 0 });
    expect(soundFor(FEEDBACK, AUDIO, { type: 'swing', combo: 4 })).toMatchObject({ cue: 'swing', semitones: 4 });
  });

  it('a warning lasts as long as its telegraph', () => {
    const ticks = (tier: 1 | 2 | 3) => soundFor(FEEDBACK, AUDIO, { type: 'telegraph', source: 1, tier })!.caption!.ticks;
    expect(ticks(1)).toBe(TELEGRAPH.tier1Ticks);
    expect(ticks(2)).toBe(TELEGRAPH.tier2Ticks);
    expect(ticks(3)).toBe(Math.round((TELEGRAPH.tier3MinTicks + TELEGRAPH.tier3MaxTicks) / 2));
    expect(captionTicks()).toBe(TICK_HZ);
  });

  it('a warning that states its own length keeps its caption that long', () => {
    expect(soundFor(FEEDBACK, AUDIO, { type: 'telegraph', source: 1, tier: 2, move: 'protest', ticks: 84 })!.caption!.ticks).toBe(84);
  });

  it('an event with no sound, or one naming a cue that does not exist, is silent', () => {
    const table = { ...FEEDBACK, events: { swing: { sound: 'nothing-like-this' }, parry: {} } } as unknown as FeedbackTable;
    expect(soundFor(table, AUDIO, { type: 'swing', combo: 0 })).toBeUndefined();
    expect(soundFor(table, AUDIO, { type: 'parry', source: 1, kind: 'shot' })).toBeUndefined();
    expect(soundFor(table, AUDIO, { type: 'stampRaised' })).toBeUndefined();
  });

  it('a cue without a caption gives none', () => {
    expect(soundFor(FEEDBACK, AUDIO, { type: 'swing', combo: 0 })?.caption).toBeUndefined();
  });

  it('a pitch step that is not a number, or is far off, is held to what the synthesis can use', () => {
    const swing = (combo: number) => soundFor(FEEDBACK, AUDIO, { type: 'swing', combo })!.semitones;
    expect(swing(Number.NaN)).toBe(0);
    expect(swing(Infinity)).toBe(MAX_SEMITONES);
    expect(swing(-1e9)).toBe(-MAX_SEMITONES);
    expect(clampSemitones(7)).toBe(7);
  });

  it('what the rescue and the dizziness sound like depends on how they went', () => {
    const rescue = (outcome: 'step' | 'early' | 'myth') => soundFor(FEEDBACK, AUDIO, { type: 'rescueStep', rescue: 'akai', action: 'x', outcome, done: 1 })?.cue;
    expect(rescue('step')).not.toBe(rescue('early'));
    expect(rescue('step')).not.toBe(rescue('myth'));
    const dizzy = (on: boolean) => soundFor(FEEDBACK, AUDIO, { type: 'dizzyChanged', dizzy: on })?.cue;
    expect(dizzy(true)).toBeDefined();
    expect(dizzy(true)).not.toBe(dizzy(false));
  });
});

describe('the music', () => {
  it('a boss fight wins over the chapter, and a chapter over the scene it sits in', () => {
    expect(musicFor(AUDIO, { chapter: 'brain', boss: true })).toBe(AUDIO.music.boss);
    expect(musicFor(AUDIO, { chapter: 'brain' })).toBe(AUDIO.music.chapters.brain);
    expect(musicFor(AUDIO, { scene: 'Title' })).toBe(AUDIO.music.scenes.Title);
  });

  it('a scene or chapter the music is not tied to leaves it as it is', () => {
    expect(musicFor(AUDIO, { scene: 'NoSuchScene' })).toBeUndefined();
    expect(musicFor(AUDIO, { chapter: 'no-such-chapter' })).toBeUndefined();
    expect(musicFor(AUDIO, {})).toBeUndefined();
  });

  it('every scene with a track is the key of a scene the game has, and every chapter track names a real chapter', () => {
    // The scenes look their track up by this.scene.key, so a key that no scene registers is a track that never plays.
    const dir = fileURLToPath(new URL('../../src/view/scenes/', import.meta.url));
    const keys = new Set(readdirSync(dir).flatMap((f) => [...readFileSync(dir + f, 'utf8').matchAll(/super\('([A-Za-z]+)'\)/g)].map((m) => m[1]!)));
    expect(keys.size).toBeGreaterThan(10);
    for (const key of Object.keys(AUDIO.music.scenes)) expect(keys, key).toContain(key);
    for (const id of Object.keys(AUDIO.music.chapters)) expect(CHAPTERS).toContain(id);
  });
});

describe('volume and pitch', () => {
  it('a volume step is squared, so the middle sounds like a middle', () => {
    expect([0, 0.5, 1].map(levelOf)).toEqual([0, 0.25, 1]);
  });

  it('a semitone is a twelfth of an octave, and a trim is in dB', () => {
    expect(semitoneRatio(12)).toBeCloseTo(2, 10);
    expect(semitoneRatio(0)).toBe(1);
    expect(semitoneRatio(-12)).toBeCloseTo(0.5, 10);
    expect(trimOf({ voices: [tone(0.1)], trimDb: -6 })).toBeCloseTo(0.501, 3);
    expect(trimOf({ voices: [tone(0.1)] })).toBe(1);
  });
});

describe('the ticking clock of the last heart', () => {
  it('ticks when a second has gone by at one heart or less, and never at none', () => {
    expect(lowHeartBeat(1, 0, TICK_HZ)).toBe(true);
    expect(lowHeartBeat(2, 0, TICK_HZ)).toBe(true);
    expect(lowHeartBeat(1, 0, TICK_HZ - 1)).toBe(false);
    expect(lowHeartBeat(1, 0, 0)).toBe(false);
    expect(lowHeartBeat(3, 0, TICK_HZ)).toBe(false);
    expect(lowHeartBeat(0, 0, TICK_HZ)).toBe(false);
  });

  it('still ticks once when a frame jumps over more than one second, and not again in the same second', () => {
    expect(lowHeartBeat(1, 0, 3 * TICK_HZ + 7)).toBe(true);
    expect(lowHeartBeat(1, secondOf(3 * TICK_HZ + 7), 3 * TICK_HZ + 8)).toBe(false);
  });

  it('ticks once a second at any frame rate, whichever tick the run starts on', () => {
    // A frame that runs two ticks steps over a multiple of 60 half the time when the count is odd.
    const beats = (fps: number, seconds: number, startTick: number, halves: number): number => {
      const loop = new FixedStepLoop<number, never>(startTick, (tick) => ({ state: tick + 1, events: [] }));
      let last = secondOf(loop.state);
      let n = 0;
      for (let frame = 0; frame < fps * seconds; frame++) {
        loop.advance(1000 / fps);
        if (lowHeartBeat(halves, last, loop.state)) n++;
        last = secondOf(loop.state);
      }
      return n;
    };
    for (const fps of [20, 24, 30, 36, 45, 60, 75, 144]) {
      for (const start of [0, 1, 37]) expect(beats(fps, 20, start, 1), `${fps} fps from tick ${start}`).toBeGreaterThanOrEqual(19);
    }
    expect(beats(30, 20, 1, 3)).toBe(0);
  });
});

describe('the arrow of a caption', () => {
  it('points from the operator to the source, and is left out when they are on top of each other', () => {
    const o = { x: 100, y: 100 };
    expect(bearing(o, { x: 200, y: 100 }, 24)).toBe(0);
    expect(bearing(o, { x: 100, y: 200 }, 24)).toBeCloseTo(Math.PI / 2, 10);
    expect(bearing(o, { x: 0, y: 100 }, 24)).toBeCloseTo(Math.PI, 10);
    expect(bearing(o, { x: 110, y: 110 }, 24)).toBeUndefined();
  });

  it('captions are off until the assist is on, and while the settings are not loaded', () => {
    expect(captionsOn(undefined)).toBe(false);
    expect(captionsOn(SETTINGS.defaults())).toBe(false);
    expect(captionsOn({ ...SETTINGS.defaults(), captions: true })).toBe(true);
  });
});

describe('peak of a cue', () => {
  it('adds the voices that sound together and not the ones that follow each other', () => {
    expect(peakSum({ voices: [tone(0.3), tone(0.4)] })).toBeCloseTo(0.7, 10);
    expect(peakSum({ voices: [tone(0.3, 0, 0.1), tone(0.4, 0.1, 0.1), tone(0.5, 0.2, 0.1)] })).toBeCloseTo(0.5, 10);
    // A long voice with a run of short ones under it: the short ones never sound together.
    expect(peakSum({ voices: [tone(0.3, 0, 0.5), tone(0.4, 0, 0.06), tone(0.4, 0.22, 0.06), tone(0.4, 0.44, 0.06)] })).toBeCloseTo(0.7, 10);
  });
});

describe('what the check refuses', () => {
  it('a sound that names no cue', () => {
    const table = { ...FEEDBACK, events: { ...FEEDBACK.events, swing: { sound: 'nope-not-here' } } } as unknown as FeedbackTable;
    expect(problems(AUDIO, table).join('\n')).toMatch(/sound "nope-not-here" is not a cue/);
  });

  it('a placeholder the event does not have', () => {
    const table = { ...FEEDBACK, events: { ...FEEDBACK.events, swing: { sound: 'swing.{tier}' } } } as unknown as FeedbackTable;
    expect(problems(AUDIO, table).join('\n')).toMatch(/unknown placeholder "\{tier\}"/);
  });

  it('a cue a scene plays by name that content/audio.json does not have', () => {
    const run = (used: readonly string[]) => audioProblems(AUDIO, FEEDBACK, STRINGS, FIELDS, used, CHAPTERS).join('\n');
    expect(run([...Object.values(UI), 'ghost'])).toMatch(/scene cue "ghost" is not a cue of content\/audio.json/);
    expect(run(Object.values(UI))).toBe('');
  });

  it('a cue nothing plays', () => {
    expect(problems(withCue('lonely', { voices: [tone(0.1)] })).join('\n')).toMatch(/cue "lonely" is played by no event and no scene/);
  });

  it('a caption with no string', () => {
    expect(problems(withCue('move', { voices: [tone(0.1)], caption: 'caption.nothing' })).join('\n')).toMatch(/caption "caption.nothing" is not in content\/strings/);
  });

  it('voices that add up to more than 1, a tone with a filter and a noise with a pitch', () => {
    expect(problems(withCue('move', { voices: [tone(0.6), tone(0.6)] })).join('\n')).toMatch(/cue "move": voices at one moment add up to 1.20/);
    expect(problems(withCue('move', { voices: [{ ...tone(0.1), cutoff: 100 }] })).join('\n')).toMatch(/a tone has no filter/);
    expect(problems(withCue('move', { voices: [{ kind: 'noise', cutoff: 100, freq: 440, dur: 0.1, gain: 0.1 }] })).join('\n')).toMatch(/a noise has no pitch or wave/);
    expect(problems(withCue('move', { voices: [{ kind: 'tone', dur: 0.1, gain: 0.1 }] })).join('\n')).toMatch(/a tone needs freq/);
    expect(problems(withCue('move', { voices: [{ kind: 'noise', dur: 0.1, gain: 0.1 }] })).join('\n')).toMatch(/a noise needs cutoff/);
    expect(problems(withCue('move', { voices: [tone(0.1, 2.9, 0.2)] })).join('\n')).toMatch(/ends after 3 s/);
    expect(problems(withCue('move', { voices: [{ ...tone(0.1), attack: 0.06 }] })).join('\n')).toMatch(/attack 0.06 s is over half of dur 0.1 s/);
    expect(problems(withCue('move', { voices: [{ ...tone(0.1), attack: 0.05 }] }))).toEqual([]);
  });

  it('music naming a track that is not there, a chapter that is not a file, and a track nobody plays', () => {
    const music = { ...AUDIO.music, scenes: { ...AUDIO.music.scenes, Title: 'missing' } };
    expect(problems({ ...AUDIO, music }).join('\n')).toMatch(/music for "Title" names track "missing"/);
    const chapters = { ...AUDIO.music, chapters: { ...AUDIO.music.chapters, ghost: 'brain' } };
    expect(problems({ ...AUDIO, music: chapters }).join('\n')).toMatch(/names chapter "ghost"/);
    const tracks = { ...AUDIO.music, tracks: { ...AUDIO.music.tracks, extra: AUDIO.music.tracks.brain! } };
    expect(problems({ ...AUDIO, music: tracks }).join('\n')).toMatch(/track "extra" is played nowhere/);
  });

  it('SOUND_FIELDS lists the telegraph tiers the cue ids are built from', () => {
    expect(SOUND_FIELDS.telegraph?.tier).toEqual(['1', '2', '3']);
  });
});
