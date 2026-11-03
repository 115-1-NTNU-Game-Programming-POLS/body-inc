import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chapterContent, chapterLoop } from '../../src/app/chapters.ts';
import { CHAPTERS } from '../../src/app/content.ts';
import { assistsOf, mayOpenOverlay, panelOpen, percent, speedOf, stepSetting, toggleSetting, togglesAttack, withAssists, type OverlayGate } from '../../src/app/pause.ts';
import {
  ASSIST_FLAGS, decode, encode, GAME_SPEEDS, NO_ASSISTS, NO_INPUT, roomsOf, SETTINGS, startChapter, TEXT_SCALES, TICK_MS, VOLUMES, type ChapterState, type Settings, type TiledMap,
} from '../../src/core/index.ts';

const NORMAL: Settings = SETTINGS.defaults();

describe('the settings the Esc menu steps through (design doc 5.7)', () => {
  it('visits every choice of a setting once and comes back, forwards and backwards', () => {
    for (const [key, list] of [['textScale', TEXT_SCALES], ['gameSpeed', GAME_SPEEDS], ['musicVolume', VOLUMES], ['sfxVolume', VOLUMES]] as const) {
      const forward: number[] = [];
      // From the first choice, whatever the default of the setting is (the volumes start at the last).
      const first = { ...NORMAL, [key]: list[0] } as Settings;
      let s = first;
      for (let i = 0; i < list.length; i++) {
        forward.push(s[key]);
        s = stepSetting(s, key, 1);
      }
      expect(forward).toEqual([...list]);
      expect(s[key]).toBe(list[0]);
      expect(stepSetting(first, key, -1)[key]).toBe(list[list.length - 1]);
    }
  });

  it('changes only the setting asked for, and every step is a value the settings slot accepts', () => {
    const slow = stepSetting(NORMAL, 'gameSpeed', 1);
    expect(slow).toEqual({ ...NORMAL, gameSpeed: 0.8 });
    expect(stepSetting(slow, 'textScale', 1)).toEqual({ ...NORMAL, textScale: 1.25, gameSpeed: 0.8 });
    // The two volumes are set apart: stepping one leaves the other where it was.
    expect(stepSetting(NORMAL, 'musicVolume', -1)).toEqual({ ...NORMAL, musicVolume: 0.75 });
    expect(stepSetting(NORMAL, 'musicVolume', 1)).toEqual({ ...NORMAL, musicVolume: 0 });
    expect(stepSetting(stepSetting(NORMAL, 'sfxVolume', 1), 'musicVolume', -1)).toEqual({ ...NORMAL, sfxVolume: 0, musicVolume: 0.75 });
    for (const key of ['textScale', 'gameSpeed', 'musicVolume', 'sfxVolume'] as const) {
      let s = NORMAL;
      for (let i = 0; i < 6; i++) {
        s = stepSetting(s, key, 1);
        expect(decode(SETTINGS, encode(SETTINGS, s)).kind).toBe('ok');
      }
    }
  });

  it('writes 80% and 70% the way the menu prints them', () => {
    expect([...GAME_SPEEDS, ...TEXT_SCALES].map(percent)).toEqual(['100%', '80%', '70%', '100%', '125%']);
    expect(VOLUMES.map(percent)).toEqual(['0%', '25%', '50%', '75%', '100%']);
    // 0.29 x 100 is 28.999999999999996, which must still read 29.
    expect(percent(0.29)).toBe('29%');
  });

  it('treats a value outside the choices as the first one, so a bad setting steps to a real choice', () => {
    const odd = { ...NORMAL, textScale: 2 } as unknown as Settings;
    expect(stepSetting(odd, 'textScale', 1).textScale).toBe(TEXT_SCALES[1]);
  });
});

describe('the game speed reaches the loop and not the rules', () => {
  it('runs 480 ticks in ten seconds at 80% and 420 at 70%, where the rules see the same ticks', () => {
    const chapter = CHAPTERS.get('greybox')!;
    const maps = new Map(roomsOf(chapter).map((p) => [p, JSON.parse(readFileSync(`public/assets/maps/${p}.tmj`, 'utf8')) as TiledMap]));
    const ctx = chapterContent(chapter, maps);
    const ticksIn = (speed: number): number => {
      const loop = chapterLoop(ctx, startChapter(ctx));
      loop.speed = speed;
      // Frames of a 60 Hz display, ten seconds of them.
      for (let i = 0; i < 600; i++) loop.advance(TICK_MS);
      return loop.state.game.tick;
    };
    const ticks = GAME_SPEEDS.map((v) => ticksIn(speedOf({ ...NORMAL, gameSpeed: v })));
    // One tick of slack: 600 x 0.7 lands on a whole number that floating point may sit just under.
    expect(ticks.map((t, i) => Math.abs(t - 600 * GAME_SPEEDS[i]!) <= 1)).toEqual([true, true, true]);
    expect(ticks[0]).toBeGreaterThan(ticks[1]!);
    expect(ticks[1]).toBeGreaterThan(ticks[2]!);
  });

  it('runs at full speed before any settings are loaded', () => {
    expect(speedOf(undefined)).toBe(1);
    expect(speedOf({ ...NORMAL, textScale: 1.25, gameSpeed: 0.7 })).toBe(0.7);
  });
});

describe('what keeps the Esc menu shut', () => {
  const chapter = CHAPTERS.get('greybox')!;
  const maps = new Map(roomsOf(chapter).map((p) => [p, JSON.parse(readFileSync(`public/assets/maps/${p}.tmj`, 'utf8')) as TiledMap]));
  const state = startChapter(chapterContent(chapter, maps));
  const open = { dialogue: { id: 'x' }, card: { id: 'x' }, rescue: { id: 'x' }, exam: { id: 'x' } };

  it('is open in a plain room and shut under each of the four panels', () => {
    expect(panelOpen(state)).toBe(false);
    for (const [key, panel] of Object.entries(open)) expect(panelOpen({ ...state, [key]: panel } as unknown as ChapterState)).toBe(true);
  });

  it('opens with nothing in the way, and each thing in the way keeps it shut on its own', () => {
    const clear: OverlayGate = { repeat: false, leaving: false, asked: false, panel: false, shown: false };
    expect(mayOpenOverlay(clear)).toBe(true);
    // `asked` is the Tab and Esc in one frame: the first launch is queued, so the second key must not open another.
    for (const key of ['repeat', 'leaving', 'asked', 'panel', 'shown'] as const) expect(mayOpenOverlay({ ...clear, [key]: true }), key).toBe(false);
  });
});

describe('when the attack key toggles', () => {
  const chapter = CHAPTERS.get('greybox')!;
  const maps = new Map(roomsOf(chapter).map((p) => [p, JSON.parse(readFileSync(`public/assets/maps/${p}.tmj`, 'utf8')) as TiledMap]));
  const state = startChapter(chapterContent(chapter, maps));
  const on = toggleSetting(NORMAL, 'toggleAttack');
  const withTool = (s: ChapterState, tool: 'stapler' | 'folder'): ChapterState => ({ ...s, game: { ...s.game, operator: { ...s.game.operator, tool } } });

  it('does with the stapler in hand in a plain room, when the setting is on', () => {
    expect(state.game.operator.tool).toBe('stapler');
    expect(togglesAttack(on, state)).toBe(true);
  });

  it('does not with the setting off, or before any settings are loaded', () => {
    expect(togglesAttack(NORMAL, state)).toBe(false);
    expect(togglesAttack(undefined, state)).toBe(false);
  });

  it('does not with the folder in hand, which guards while held and would be locked into it', () => {
    expect(togglesAttack(on, withTool(state, 'folder'))).toBe(false);
    expect(togglesAttack(on, withTool(withTool(state, 'folder'), 'stapler'))).toBe(true);
  });

  it('does not under a panel, which owns the keys', () => {
    for (const key of ['dialogue', 'card', 'rescue', 'exam']) expect(togglesAttack(on, { ...state, [key]: { id: 'x' } } as unknown as ChapterState), key).toBe(false);
  });
});


describe('the assist flags', () => {
  it('a flag flips on its own and flips back, in a form the settings slot accepts', () => {
    for (const flag of ASSIST_FLAGS) {
      const on = toggleSetting(NORMAL, flag);
      expect(on).toEqual({ ...NORMAL, [flag]: true });
      expect(decode(SETTINGS, encode(SETTINGS, on)).kind).toBe('ok');
      expect(toggleSetting(on, flag)).toEqual(NORMAL);
    }
  });

  it('hands the fight only the three that change a rule, each from its own flag', () => {
    expect(assistsOf(NORMAL)).toEqual(NO_ASSISTS);
    expect(assistsOf(undefined)).toEqual(NO_ASSISTS);
    expect(assistsOf(toggleSetting(NORMAL, 'halfDamage'))).toEqual({ ...NO_ASSISTS, halfDamage: true });
    expect(assistsOf(toggleSetting(NORMAL, 'neverEmpty'))).toEqual({ ...NO_ASSISTS, neverEmpty: true });
    expect(assistsOf(toggleSetting(NORMAL, 'autoPerfect'))).toEqual({ ...NO_ASSISTS, autoPerfect: true });
    for (const flag of ['toggleAttack', 'noShake', 'lessFlash', 'captions'] as const) expect(assistsOf(toggleSetting(NORMAL, flag)), flag).toEqual(NO_ASSISTS);
  });

  it('puts the assists on a tick only when one is on, so a plain run records plain inputs', () => {
    expect(withAssists(NO_INPUT, NO_ASSISTS)).toBe(NO_INPUT);
    for (const flag of ['halfDamage', 'neverEmpty', 'autoPerfect'] as const) {
      const only = { ...NO_ASSISTS, [flag]: true };
      expect(withAssists(NO_INPUT, only), flag).toEqual({ ...NO_INPUT, assists: only });
    }
  });
});
