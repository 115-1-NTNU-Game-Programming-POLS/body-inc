import { TELEGRAPH, TICK_HZ, type AudioFile, type Cue, type GameEvent, type Settings } from '../core/index.ts';
import { fillKey, noteKeys, type FeedbackTable, type NoteFields, type StringTable } from './feedback.ts';

/**
 * Sound has no rules of its own: content/feedback.json names the cue an event plays, content/audio.json
 * holds the cues (a recipe of tones and noise, no files) and the music, and this file decides what a
 * given event, scene or setting means. The Web Audio side is in sound.ts.
 */
export type AudioTable = AudioFile;

/** The cues scenes play by name, apart from the events: the menus and handbook, and the ticking clock of the last heart. */
export const UI = { move: 'move', confirm: 'choose', cancel: 'back', page: 'page', lowHeart: 'tick' } as const;

/** What a volume setting does to the level. A square, so the middle step sounds like a middle and not like 90%. */
export const levelOf = (volume: number): number => volume * volume;

/** The level every music file is played at, under the player's own volume: files are at -18 LUFS and the effects sit above them. */
export const MUSIC_LEVEL = 0.5;

/** One semitone up is a factor of 2^(1/12). */
export const semitoneRatio = (semitones: number): number => 2 ** (semitones / 12);

/** The effect's trim in dB as a linear factor. */
export const trimOf = (cue: Cue): number => 10 ** ((cue.trimDb ?? 0) / 20);

/** True when the same cue may start again: the gap has passed since it last did, or it never has. */
export const gapPassed = (lastAt: number | undefined, now: number, minGapMs: number): boolean => lastAt === undefined || now - lastAt >= minGapMs;

/** The cue a feedback entry names for this event, "{field}" filled from the event. */
export const cueOf = (sound: string, event: GameEvent): string => fillKey(sound, event);

/** A caption on screen: its string key and how many ticks it stays. */
export interface Caption {
  readonly key: string;
  readonly ticks: number;
}

/** A caption for the Hud: its text, how long it stays, and the direction of its source in radians when it has one. */
export interface WorldCaption {
  readonly text: string;
  readonly seconds: number;
  readonly angle?: number;
}

/** What a played event asks of the speakers and of the captions. */
export interface Sounding {
  readonly cue: string;
  /** How far up the cue is played, in semitones (a stationery sound rises with the combo). */
  readonly semitones: number;
  readonly caption?: Caption;
}

/**
 * A warning's caption stays as long as its telegraph (design doc 5.3, art direction 10); tier 3 runs
 * 1.2 to 1.5 s by move, so it takes the middle. Any other caption is a moment.
 */
export function captionTicks(event?: GameEvent): number {
  if (event?.type === 'telegraph') {
    return event.tier === 1 ? TELEGRAPH.tier1Ticks : event.tier === 2 ? TELEGRAPH.tier2Ticks : Math.round((TELEGRAPH.tier3MinTicks + TELEGRAPH.tier3MaxTicks) / 2);
  }
  return TICK_HZ;
}

/** The cue an event plays and its caption, or undefined when the event is silent or names a cue that does not exist. */
export function soundFor(table: FeedbackTable, audio: AudioTable, event: GameEvent): Sounding | undefined {
  const sound = table.events[event.type]?.sound;
  if (!sound) return undefined;
  const cue = cueOf(sound, event);
  const def = audio.cues[cue];
  if (!def) return undefined;
  const by = def.semitoneBy === undefined ? undefined : (event as unknown as Record<string, unknown>)[def.semitoneBy];
  return {
    cue,
    semitones: typeof by === 'number' ? by : 0,
    ...(def.caption === undefined ? {} : { caption: { key: def.caption, ticks: captionTicks(event) } }),
  };
}

/** Where the music is being asked for: a scene's key, or the rooms of a chapter, with a boss fight over them. */
export interface MusicWhere {
  readonly scene?: string;
  readonly chapter?: string;
  readonly boss?: boolean;
}

/** The track id for a place, or undefined to leave the music as it is (a scene the music is not tied to). */
export function musicFor(audio: AudioTable, where: MusicWhere): string | undefined {
  if (where.boss) return audio.music.boss;
  if (where.chapter !== undefined) return audio.music.chapters[where.chapter];
  return where.scene === undefined ? undefined : audio.music.scenes[where.scene];
}

/** The ticking clock of the last heart (design doc 5.8): once a second while one heart or less is left, and never at none. */
export const lowHeartTick = (halves: number, tick: number): boolean => halves > 0 && halves <= 2 && tick % TICK_HZ === 0;

/** Direction from `from` to `to` in radians, or undefined when they are so close that an arrow would say nothing. */
export function bearing(from: { readonly x: number; readonly y: number }, to: { readonly x: number; readonly y: number }, minDist: number): number | undefined {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.hypot(dx, dy) < minDist ? undefined : Math.atan2(dy, dx);
}

/** Whether captions are on, for a settings object that may not be loaded yet. */
export const captionsOn = (settings: Settings | undefined): boolean => settings?.captions === true;

/**
 * The most the voices of a cue add up to at one moment, which must stay under 1 so a cue never clips by itself.
 * The sum only grows when a voice starts, so each start is the moment to try; a voice that ended by then is not counted.
 */
export function peakSum(cue: Cue): number {
  return Math.max(...cue.voices.map((v) => {
    const t = v.at ?? 0;
    return cue.voices.filter((o) => (o.at ?? 0) <= t && t < (o.at ?? 0) + o.dur).reduce((s, o) => s + o.gain, 0);
  }));
}

/** Per event, the values the placeholders of a sound can take, on top of those of its note. */
export const SOUND_FIELDS: NoteFields = { telegraph: { tier: ['1', '2', '3'] } };

/**
 * Problems in content/audio.json and in the sounds content/feedback.json names, in English like the
 * feedback check. `used` lists the cues scenes play by name, which no event names.
 */
export function audioProblems(
  audio: AudioTable, feedback: FeedbackTable, strings: StringTable, fields: NoteFields, used: readonly string[], chapters: readonly string[],
): string[] {
  const out: string[] = [];
  const named = new Set<string>(used);
  for (const [type, fb] of Object.entries(feedback.events)) {
    if (!fb?.sound) continue;
    const { keys, unknown } = noteKeys(fb.sound, { ...(fields[type as GameEvent['type']] ?? {}), ...(SOUND_FIELDS[type as GameEvent['type']] ?? {}) });
    for (const f of unknown) out.push(`${type}: sound "${fb.sound}" uses unknown placeholder "{${f}}"`);
    if (unknown.length > 0) continue;
    for (const k of keys) {
      named.add(k);
      if (!audio.cues[k]) out.push(`${type}: sound "${k}" is not a cue of content/audio.json`);
    }
  }
  for (const [id, cue] of Object.entries(audio.cues)) {
    if (!named.has(id)) out.push(`cue "${id}" is played by no event and no scene`);
    if (cue.caption !== undefined && !strings.strings[cue.caption]) out.push(`cue "${id}": caption "${cue.caption}" is not in content/strings`);
    cue.voices.forEach((v, i) => {
      const at = `cue "${id}", voice ${i + 1}`;
      if (v.kind === 'tone' && v.freq === undefined) out.push(`${at}: a tone needs freq`);
      if (v.kind === 'noise' && v.cutoff === undefined) out.push(`${at}: a noise needs cutoff`);
      if (v.kind === 'tone' && (v.cutoff !== undefined || v.cutoffTo !== undefined || v.filter !== undefined || v.q !== undefined)) out.push(`${at}: a tone has no filter`);
      if (v.kind === 'noise' && (v.freq !== undefined || v.to !== undefined || v.wave !== undefined)) out.push(`${at}: a noise has no pitch or wave`);
      if ((v.at ?? 0) + v.dur > 3) out.push(`${at}: ends after 3 s`);
    });
    if (peakSum(cue) > 1) out.push(`cue "${id}": voices at one moment add up to ${peakSum(cue).toFixed(2)}, over 1`);
  }
  const tracks = new Set(Object.keys(audio.music.tracks));
  const wanted = [['boss', audio.music.boss], ...Object.entries(audio.music.scenes), ...Object.entries(audio.music.chapters)] as const;
  for (const [where, track] of wanted) if (!tracks.has(track)) out.push(`music for "${where}" names track "${track}", which is not in tracks`);
  for (const id of Object.keys(audio.music.chapters)) if (!chapters.includes(id)) out.push(`music names chapter "${id}", which is not a chapter file`);
  const usedTracks = new Set<string>([audio.music.boss, ...Object.values(audio.music.scenes), ...Object.values(audio.music.chapters)]);
  for (const id of tracks) if (!usedTracks.has(id)) out.push(`track "${id}" is played nowhere`);
  return out;
}
