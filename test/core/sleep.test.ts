import { describe, expect, it } from 'vitest';
import { BOSSES, DIALOGUES, ENEMIES, PARAMS, TAGS } from '../../src/app/content.ts';
import {
  ALARM_TICKS, lieDown, parseRoom, selectInteractable, selectMixer, selectSleep, startChapter, stepChapter, stepSleep, TICK_HZ,
  type ChapterContent, type ChapterState, type GameEvent, type TickInput, type TiledMap,
} from '../../src/core/index.ts';
import { readRoom } from '../../src/core/rooms/tiled.ts';

/**
 * The sleep bar of core/rooms/sleep.ts (design doc 7.5). Rooms are bare 20 x 12 floors as in
 * mixer.test.ts, with a sleep bed just right of where the operator starts, so the interact key
 * reaches it without a step, and a mixer whose hopper covers tiles (10, 6) and (11, 6).
 */

const p = (name: string, value: string | number | boolean) => ({ name, value });
const NONE: TickInput = { move: { x: 0, y: 0 } };
const USE: TickInput = { move: { x: 0, y: 0 }, interactPressed: true };
const RIGHT: TickInput = { move: { x: 1, y: 0 } };
const types = (events: readonly GameEvent[]) => events.map((e) => e.type);

const mapOf = (objects: object[]) => ({
  width: 20, height: 12, tilewidth: 32, tileheight: 32,
  properties: [p('organ', 'stomach'), p('role', 'puzzle'), p('estSeconds', 10)],
  layers: [
    { type: 'tilelayer', name: 'walls', data: new Array(240).fill(0) },
    { type: 'objectgroup', name: 'objects', objects: [{ id: 1, type: 'PlayerStart', x: 64, y: 360 }, ...objects] },
  ],
}) as unknown as TiledMap;

const BED_ID = 2;
const SECONDS = 30;
const bed = (props: object[] = [p('bedType', 'sleep'), p('sleepSeconds', SECONDS)]) =>
  ({ id: BED_ID, type: 'Bed', x: 84, y: 330, width: 64, height: 32, properties: props });
const mixer = { id: 20, type: 'Mixer', x: 320, y: 192, width: 64, height: 32, properties: [p('outlet', 'S')] };
const food = (id: number, portion: string, col = 4) => ({ id, type: 'Box', x: col * 32 + 16, y: 2 * 32 + 16, properties: [p('boxType', 'food'), p('portion', portion)] });

function chapter(objects: object[]): ChapterContent {
  return {
    chapter: { version: 1, id: 'lab', start: 'lab/a', links: [] },
    rooms: new Map([['lab/a', parseRoom('lab/a', mapOf(objects), TAGS)]]),
    dialogues: DIALOGUES, dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS,
  };
}

function run(c: ChapterContent, s: ChapterState, n: number, input: TickInput = NONE): { state: ChapterState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    const r = stepChapter(c, s, input);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

/** Puts food box `id` on the hopper, as if it had just slid there; the mixer takes it on the next tick. */
const feed = (s: ChapterState, id: number): ChapterState =>
  ({ ...s, game: { ...s.game, boxes: s.game.boxes.map((b) => (b.id === id ? { ...b, col: 10, row: 6, left: 0, ticks: 0 } : b)) } });

const NEED = SECONDS * TICK_HZ;

describe('the sleep bar', () => {
  it('starts when the operator lies down, keeps them still, and ends the chapter only once it is full', () => {
    const c = chapter([bed()]);
    const lay = run(c, startChapter(c), 1, USE);
    expect(lay.events).toContainEqual({ type: 'fellAsleep', object: BED_ID, slept: 0, need: NEED });
    expect(types(lay.events)).not.toContain('chapterEnded');
    expect(selectSleep(lay.state.game)).toEqual({ bed: BED_ID, share: 0, awake: false, wakes: 0 });
    expect(selectInteractable(lay.state.game)).toBeUndefined();
    const at = { x: lay.state.game.operator.x, y: lay.state.game.operator.y };
    const before = run(c, lay.state, NEED - 1, RIGHT);
    expect(types(before.events)).not.toContain('sleptThrough');
    expect(types(before.events)).not.toContain('chapterEnded');
    // The keys do nothing in bed: the operator has not moved.
    expect({ x: before.state.game.operator.x, y: before.state.game.operator.y }).toEqual(at);
    expect(selectSleep(before.state.game)!.share).toBeCloseTo((NEED - 1) / NEED, 6);
    const last = run(c, before.state, 1);
    expect(last.events).toContainEqual({ type: 'sleptThrough', object: BED_ID, wakes: 0 });
    expect(types(last.events)).toContain('chapterEnded');
  });

  it('still ends the chapter at once on a sleep bed without a bar', () => {
    const c = chapter([bed([p('bedType', 'sleep')])]);
    const r = run(c, startChapter(c), 1, USE);
    expect(types(r.events)).toContain('chapterEnded');
    expect(types(r.events)).not.toContain('fellAsleep');
    expect(r.state.game.sleep).toBeUndefined();
  });

  it('is refused like any bed whose condition fails', () => {
    const c = chapter([bed([p('bedType', 'sleep'), p('sleepSeconds', SECONDS), p('requires', 'caffeine>=50')])]);
    const r = run(c, startChapter(c), 1, USE);
    expect(r.events).toContainEqual({ type: 'bedRefused', object: BED_ID, bedType: 'sleep' });
    expect(r.state.game.sleep).toBeUndefined();
  });
});

describe('the mixer alarm', () => {
  it('wakes the operator after twenty seconds of running, and the bar stands still until they lie down again', () => {
    const c = chapter([bed(), mixer, food(3, 'large')]);
    let s = run(c, feed(startChapter(c), 3), 1).state;
    expect(selectMixer(s.game)!.batches).toHaveLength(1);
    s = run(c, s, 1, USE).state;
    const quiet = run(c, s, ALARM_TICKS - 1);
    expect(types(quiet.events)).not.toContain('sleepInterrupted');
    const woke = run(c, quiet.state, 1);
    expect(woke.events).toContainEqual({ type: 'sleepInterrupted', object: BED_ID, cause: 'mixer', wakes: 1 });
    const share = selectSleep(woke.state.game)!.share;
    expect(share).toBeCloseTo(ALARM_TICKS / NEED, 6);
    expect(selectSleep(woke.state.game)!.awake).toBe(true);
    // Awake, the bar does not move and the operator can walk off.
    const up = run(c, woke.state, 30, RIGHT);
    expect(selectSleep(up.state.game)!.share).toBe(share);
    expect(up.state.game.operator.x).toBeGreaterThan(woke.state.game.operator.x);
    // Back in bed, the bar goes on from where it stopped and the alarm counts from zero again.
    const back = run(c, run(c, up.state, 30, { move: { x: -1, y: 0 } }).state, 1, USE);
    expect(back.events).toContainEqual({ type: 'fellAsleep', object: BED_ID, slept: ALARM_TICKS, need: NEED });
    expect(selectMixer(back.state.game)!.batches).toHaveLength(1);
    const again = run(c, back.state, ALARM_TICKS - 1);
    expect(types(again.events)).not.toContain('sleepInterrupted');
  });

  it('stays quiet while the mixer is empty, and its count starts over once the mixer empties', () => {
    // A small portion is out in 15 seconds, before the alarm's 20.
    // Two of them one after the other run 30 seconds in all, but never 20 without a break.
    const c = chapter([bed(), mixer, food(3, 'small'), food(4, 'small', 6)]);
    let s = run(c, startChapter(c), 1, USE).state;
    s = run(c, feed(s, 3), 1).state;
    expect(selectMixer(s.game)!.batches).toHaveLength(1);
    const first = run(c, s, 15 * TICK_HZ);
    expect(types(first.events)).toContain('parcelOut');
    expect(selectMixer(first.state.game)!.batches).toEqual([]);
    s = run(c, feed(first.state, 4), 1).state;
    expect(selectMixer(s.game)!.batches).toHaveLength(1);
    const r = run(c, s, NEED);
    expect(types([...first.events, ...r.events])).not.toContain('sleepInterrupted');
    expect(r.events).toContainEqual({ type: 'sleptThrough', object: BED_ID, wakes: 0 });
  });

  it('is dropped with the bar by a forced leave, so the next try starts the bar over', () => {
    const c = chapter([bed(), mixer, food(3, 'large')]);
    const s = run(c, startChapter(c), 1, USE).state;
    expect(s.game.sleep).toBeDefined();
    const hit = { ...s, game: { ...s.game, operator: { ...s.game.operator, halves: 0 } } };
    const r = run(c, hit, 1);
    expect(types(r.events)).toContain('forcedLeave');
    expect(r.state.game.sleep).toBeUndefined();
  });
});

describe('stepSleep', () => {
  const asleep = lieDown(undefined, BED_ID, SECONDS);

  it('is woken by a hit, which wins over the alarm on the same tick', () => {
    const r = stepSleep({ ...asleep, alarm: ALARM_TICKS - 1 }, true, true);
    expect(r.events).toEqual([{ type: 'sleepInterrupted', object: BED_ID, cause: 'hurt', wakes: 1 }]);
    expect(r.sleep).toMatchObject({ awake: true, slept: 1, alarm: 0, wakes: 1 });
  });

  it('fills on the tick an alarm would ring: the full bar wins', () => {
    const r = stepSleep({ ...asleep, slept: NEED - 1, alarm: ALARM_TICKS - 1 }, true, false);
    expect(r.events).toEqual([{ type: 'sleptThrough', object: BED_ID, wakes: 0 }]);
  });

  it('does nothing once awake or full', () => {
    const awake = { ...asleep, awake: true };
    expect(stepSleep(awake, true, true)).toEqual({ sleep: awake, events: [] });
    const full = { ...asleep, slept: NEED };
    expect(stepSleep(full, true, true)).toEqual({ sleep: full, events: [] });
  });

  it('keeps the bar when lying down again, on any sleep bed', () => {
    const woken = { ...asleep, slept: 100, awake: true, alarm: 7, wakes: 2 };
    expect(lieDown(woken, 9, SECONDS)).toEqual({ bed: 9, slept: 100, need: NEED, awake: false, alarm: 0, wakes: 2 });
  });
});

describe('the map check', () => {
  const codes = (objects: object[]) => readRoom('lab/a', mapOf(objects), TAGS).problems.map((x) => x.code);

  it('reports a nap bed with sleep seconds, which only a sleep bed reads', () => {
    expect(codes([bed([p('bedType', 'nap'), p('sleepSeconds', 10)])])).toEqual(['bed-seconds']);
    expect(codes([bed([p('bedType', 'nap')])])).toEqual([]);
    expect(codes([bed()])).toEqual([]);
  });
});
