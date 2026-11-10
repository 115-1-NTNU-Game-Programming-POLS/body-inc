import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOSSES, CHAPTERS, DIALOGUES, ENEMIES, PARAMS, RESCUES, TAGS } from '../../src/app/content.ts';
import { readRoom } from '../../src/core/rooms/tiled.ts';
import {
  CONVEYOR_TICKS, conveyorTiles, createGame, loadEnemyTable, NO_INPUT, parseRoom, PORTION_SECONDS, roomsOf, selectConveyors, selectCooling, selectDoorLocks, selectInteractable, selectPortions,
  startChapter, step, stepChapter, TICK_HZ,
  type ChapterContent, type ChapterState, type EnteredRoom, type GameEvent, type TickInput, type TiledMap,
} from '../../src/core/index.ts';

/**
 * The stomach's sorting center (design doc 7.5, 8.5, 8.8): a conveyor with an `altDirection` is a fork
 * that a lever turns, and a lever with `cooldownSeconds` takes no new throw for that long. Rooms are
 * bare 20 x 12 floors as in boxes.test.ts; the last block plays the real sorting lab.
 */

const p = (name: string, value: string | number | boolean) => ({ name, value });
const NONE: TickInput = { move: { x: 0, y: 0 } };
const INTERACT: TickInput = { move: { x: 0, y: 0 }, interactPressed: true };
const types = (events: readonly GameEvent[]) => events.map((e) => e.type);

const mapOf = (objects: object[]) => ({
  width: 20, height: 12, tilewidth: 32, tileheight: 32,
  properties: [p('organ', 'stomach'), p('role', 'puzzle'), p('estSeconds', 10)],
  layers: [
    { type: 'tilelayer', name: 'walls', data: new Array(240).fill(0) },
    { type: 'objectgroup', name: 'objects', objects: [{ id: 1, type: 'PlayerStart', x: 320, y: 200 }, ...objects] },
  ],
}) as unknown as TiledMap;

const southDoor = { id: 2, type: 'Door', name: 'door-s', x: 288, y: 352, width: 64, height: 32, properties: [p('socket', 'S')] };
const northDoor = { id: 2, type: 'Door', name: 'door-n', x: 288, y: 0, width: 64, height: 96, properties: [p('socket', 'N')] };

/** `checked` false reads the room the way the map check would still refuse, to see what the game does with it. */
function chapter(objects: object[], checked = true): ChapterContent {
  const a = checked ? parseRoom('lab/a', mapOf([southDoor, ...objects]), TAGS) : readRoom('lab/a', mapOf([southDoor, ...objects]), TAGS).room;
  return {
    chapter: { version: 1, id: 'lab', start: 'lab/a', links: [{ a: 'lab/a#door-s', b: 'lab/b#door-n' }] },
    rooms: new Map([['lab/a', a], ['lab/b', parseRoom('lab/b', mapOf([northDoor]), TAGS)]]),
    dialogues: DIALOGUES, dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS,
  };
}

function run(c: ChapterContent, s: ChapterState, input: TickInput | ((n: number) => TickInput), n = 1): { state: ChapterState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    const r = stepChapter(c, s, typeof input === 'function' ? input(i) : input);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

const place = (s: ChapterState, x: number, y: number): ChapterState =>
  ({ ...s, game: { ...s.game, touching: [], operator: { ...s.game.operator, x, y, vx: 0, vy: 0 } } });
const tiles = (s: ChapterState) => s.game.boxes.map((b) => [b.id, b.col, b.row]);

const food = (id: number, col: number, row: number) => ({ id, type: 'Box', x: col * 32 + 16, y: row * 32 + 16, properties: [p('boxType', 'food')] });
const belt = (id: number, col: number, row: number, cols: number, direction: string, speed = 'fast', rows = 1, extra: object[] = []) => ({
  id, type: 'Conveyor', x: col * 32, y: row * 32, width: cols * 32, height: rows * 32, properties: [p('direction', direction), p('speed', speed), ...extra],
});
/** A point lever at (x, y); the operator stands at (x, y + 20) to throw it. */
const lever = (id: number, x: number, y: number, target: number, extra: object[] = []) => ({
  id, type: 'Switch', x, y, properties: [p('target', target), p('mode', 'toggle'), ...extra],
});

const TRUNK = 3;
const FORK = 4;
const LEVER = 7;
/** A line along row 4 into a fork at (7, 4): east on to (10, 4), or south on to (7, 7), by the lever above it. */
const forkRoom = (more: object[] = [], forkExtra: object[] = [p('altDirection', 'S')]) => [
  belt(TRUNK, 4, 4, 3, 'E'),
  belt(FORK, 7, 4, 1, 'E', 'fast', 1, forkExtra),
  belt(5, 8, 4, 3, 'E'),
  belt(6, 7, 5, 1, 'S', 'fast', 3),
  ...more,
];
const at = (s: ChapterState) => place(s, 200, 220);

describe('a fork', () => {
  const room = [...forkRoom([food(8, 6, 4), lever(LEVER, 200, 200, FORK)])];

  it('carries a box on straight while its lever is off, and down its other branch while the lever is on', () => {
    const c = chapter(room);
    expect(tiles(run(c, startChapter(c), NONE, 200).state)).toEqual([[8, 11, 4]]);
    const on = run(c, at(startChapter(c)), INTERACT).state;
    expect(tiles(run(c, on, NONE, 200).state)).toEqual([[8, 7, 8]]);
    // Thrown back off before the box reaches it, it goes straight again.
    const back = run(c, run(c, on, NONE).state, INTERACT).state;
    expect(tiles(run(c, back, NONE, 200).state)).toEqual([[8, 11, 4]]);
  });

  it('always runs, and only the way it carries follows the lever', () => {
    const c = chapter(room);
    const fork = (s: ChapterState) => selectConveyors(s.game).find((x) => x.object === FORK);
    const off = startChapter(c);
    expect(fork(off)).toEqual({ object: FORK, direction: 'E', speed: 'fast', running: true });
    const on = run(c, at(off), INTERACT).state;
    expect(fork(on)).toEqual({ object: FORK, direction: 'S', speed: 'fast', running: true });
    // The branches and the line are ordinary conveyors, which the lever does not touch.
    expect(selectConveyors(on.game).filter((x) => x.object !== FORK).map((x) => [x.object, x.direction, x.running])).toEqual([[3, 'E', true], [5, 'E', true], [6, 'S', true]]);
  });

  it('keeps its direction when no switch is aimed at it, though the map check refuses such a fork', () => {
    const c = chapter(forkRoom([food(8, 6, 4)]), false);
    expect(selectConveyors(startChapter(c).game).find((x) => x.object === FORK)).toEqual({ object: FORK, direction: 'E', speed: 'fast', running: true });
    expect(tiles(run(c, startChapter(c), NONE, 200).state)).toEqual([[8, 11, 4]]);
  });

  it('carries the operator standing on it the way it points now', () => {
    // No box on the line: the one at (6, 4) would already own the fork's tile when the operator is put there.
    const c = chapter(forkRoom([lever(LEVER, 200, 200, FORK)]));
    const onFork = (s: ChapterState) => place(s, 7 * 32 + 16, 4 * 32 + 20);
    const east = run(c, onFork(startChapter(c)), NONE, 10).state.game.operator;
    expect(east.x).toBeGreaterThan(7 * 32 + 16 + 10);
    expect(east.y).toBe(4 * 32 + 20);
    const turned = run(c, at(startChapter(c)), INTERACT).state;
    const south = run(c, onFork(turned), NONE, 10).state.game.operator;
    expect(south.y).toBeGreaterThan(4 * 32 + 20 + 10);
    expect(south.x).toBe(7 * 32 + 16);
  });

  it('is an ordinary conveyor with altDirection none, which a lever aimed at it still starts and stops', () => {
    const c = chapter(forkRoom([food(8, 6, 4), lever(LEVER, 200, 200, FORK)], [p('altDirection', 'none')]));
    const s0 = startChapter(c);
    expect(selectConveyors(s0.game).find((x) => x.object === FORK)).toEqual({ object: FORK, direction: 'E', speed: 'fast', running: false });
    // The box waits at the foot of a conveyor that is not running.
    expect(tiles(run(c, s0, NONE, 200).state)).toEqual([[8, 7, 4]]);
    const on = run(c, at(s0), INTERACT).state;
    expect(selectConveyors(on.game).find((x) => x.object === FORK)).toEqual({ object: FORK, direction: 'E', speed: 'fast', running: true });
  });
});

describe("a lever's cooldown", () => {
  const BELT = 3;
  const cool = (seconds: number) => chapter([belt(BELT, 12, 8, 4, 'E', 'normal', 1), lever(5, 200, 200, BELT, seconds > 0 ? [p('cooldownSeconds', seconds)] : [])]);
  const thrown = (c: ChapterContent) => run(c, at(startChapter(c)), INTERACT);

  it('refuses a press until its whole time has passed, and says so', () => {
    const c = cool(5);
    const first = thrown(c);
    expect(first.events).toContainEqual({ type: 'switchChanged', object: 5, on: true, mode: 'toggle', by: 'interact' });
    // The first press was tick 0: a press on tick 299 is 4.98 s later and still refused, the one on tick 300 is taken.
    const waited = run(c, first.state, NONE, 298).state;
    const early = run(c, waited, INTERACT);
    expect(early.events).toEqual([{ type: 'switchCooling', object: 5, seconds: 1 / TICK_HZ }]);
    expect(early.state.game.switches).toEqual([5]);
    const late = run(c, early.state, INTERACT);
    expect(late.events).toContainEqual({ type: 'switchChanged', object: 5, on: false, mode: 'toggle', by: 'interact' });
    expect(late.state.game.switches).toEqual([]);
  });

  it('counts from the last change, so a lever thrown again restarts the time', () => {
    const c = cool(2);
    const on = thrown(c).state;
    const off = run(c, run(c, on, NONE, 2 * TICK_HZ).state, INTERACT).state;
    expect(off.game.switches).toEqual([]);
    // Pressed again one second after the second throw, it is still cooling for another second.
    const again = run(c, run(c, off, NONE, TICK_HZ - 1).state, INTERACT);
    expect(again.events).toEqual([{ type: 'switchCooling', object: 5, seconds: 1 }]);
  });

  it('is not there for a lever with none: two presses on consecutive ticks both throw it', () => {
    const c = cool(0);
    const r = run(c, at(startChapter(c)), INTERACT, 2);
    expect(r.events.filter((e) => e.type === 'switchChanged').map((e) => (e as { on: boolean }).on)).toEqual([true, false]);
    expect(types(r.events)).not.toContain('switchCooling');
    expect('cooling' in r.state.game).toBe(false);
  });

  it('is not offered as the interact prompt while it cools, and is again the tick it has cooled', () => {
    const c = cool(5);
    expect(selectInteractable(at(startChapter(c)).game)).toMatchObject({ object: 5, kind: 'Switch' });
    const on = thrown(c).state;
    expect(selectInteractable(on.game)).toBeUndefined();
    expect(selectInteractable(run(c, on, NONE, 5 * TICK_HZ - 1).state.game)).toBeUndefined();
    expect(selectInteractable(run(c, on, NONE, 5 * TICK_HZ).state.game)).toMatchObject({ object: 5, kind: 'Switch' });
  });

  it('is reported for the view as the share left, and is gone from the state once over', () => {
    const c = cool(5);
    const on = thrown(c).state;
    expect(selectCooling(on.game)).toEqual([{ object: 5, left: 1, seconds: 5 }]);
    const half = run(c, on, NONE, 150).state;
    expect(selectCooling(half.game)).toEqual([{ object: 5, left: 0.5, seconds: 2.5 }]);
    const over = run(c, on, NONE, 300).state;
    expect(selectCooling(over.game)).toEqual([]);
    expect('cooling' in over.game).toBe(false);
  });

  it('holds a staple off a lever that is cooling, and takes one after', () => {
    // The lever is on the north wall line, straight above the operator, as in locks.test.ts.
    const c = chapter([lever(3, 320, 64, 9, [p('cooldownSeconds', 5)]), belt(9, 12, 8, 4, 'E', 'normal', 1)]);
    const fire: TickInput = { move: { x: 0, y: 0 }, attack: true, attackPressed: true };
    // One tick of walking up turns the aim north; held fire then keeps to it without walking on.
    const aimed = (s: ChapterState) => run(c, place(s, 320, 200), { move: { x: 0, y: -1 } }).state;
    // The first staple turns it on and starts the time; the held fire after it meets a lever that is on.
    const shot = run(c, aimed(startChapter(c)), fire, 60);
    expect(shot.events.filter((e) => e.type === 'switchChanged')).toEqual([{ type: 'switchChanged', object: 3, on: true, mode: 'toggle', by: 'staple' }]);
    expect(selectCooling(shot.state.game)).toHaveLength(1);
    // Thrown off by hand once the time is up, it cools again, and a staple fired into that is held off.
    const free = run(c, shot.state, NONE, 300).state;
    const off = run(c, place(free, 320, 84), INTERACT).state;
    expect(off.game.switches).toEqual([]);
    const held = run(c, aimed(off), fire, 60);
    expect(held.events.filter((e) => e.type === 'switchChanged')).toEqual([]);
    expect(held.state.game.switches).toEqual([]);
    // When the time is up, the held fire turns it on again.
    const later = run(c, held.state, fire, 300);
    expect(later.events.filter((e) => e.type === 'switchChanged')).toEqual([{ type: 'switchChanged', object: 3, on: true, mode: 'toggle', by: 'staple' }]);
    expect(later.state.game.switches).toEqual([3]);
  });

  it("ends with the game's own forced leave, while the lever itself stays thrown", () => {
    // The game alone, without a chapter to rebuild it: a retry puts back what the visit changed and keeps what is solved.
    const objects = [
      { id: 1, kind: 'PlayerStart', name: '', x: 160, y: 192, width: 0, height: 0, props: {}, conditions: {} },
      { id: 3, kind: 'Conveyor', name: '', x: 384, y: 256, width: 128, height: 32, props: { direction: 'E', speed: 'normal', altDirection: 'none' }, conditions: {} },
      { id: 5, kind: 'Switch', name: '', x: 200, y: 200, width: 0, height: 0, props: { target: 3, mode: 'toggle', cooldownSeconds: 5 }, conditions: {} },
    ];
    const solid = Array.from({ length: 240 }, (_, i) => i % 20 === 0 || i % 20 === 19 || i < 20 || i >= 220);
    const entered: EnteredRoom = { id: 'test', grid: { cols: 20, rows: 12, solid }, props: {}, variants: [], active: [], objects };
    const g = createGame(entered, 1, loadEnemyTable(JSON.parse(readFileSync('content/enemies.json', 'utf8'))));
    const thrown = step({ ...g, operator: { ...g.operator, x: 200, y: 220 } }, { ...NO_INPUT, interactPressed: true }).state;
    expect(selectCooling(thrown)).toHaveLength(1);
    const back = step({ ...thrown, operator: { ...thrown.operator, halves: 0 } }, NO_INPUT).state;
    expect('cooling' in back).toBe(false);
    expect(back.switches).toEqual([5]);
  });

  it('ends with a forced leave in a chapter too, while the lever itself stays thrown', () => {
    const timeClock = { id: 4, type: 'Trigger', x: 96, y: 96, width: 32, height: 32, properties: [p('event', 'checkpoint')] };
    const c = chapter([belt(BELT, 12, 8, 4, 'E', 'normal', 1), lever(5, 200, 200, BELT, [p('cooldownSeconds', 5)]), timeClock]);
    const punched = run(c, place(startChapter(c), 112, 120), NONE).state;
    const on = run(c, place(punched, 200, 220), INTERACT).state;
    expect(selectCooling(on.game)).toHaveLength(1);
    const dying: ChapterState = { ...on, game: { ...on.game, operator: { ...on.game.operator, halves: 0 } } };
    const back = run(c, dying, NONE);
    expect(types(back.events)).toContain('returnedToCheckpoint');
    expect('cooling' in back.state.game).toBe(false);
    expect(back.state.game.switches).toEqual([5]);
    // Nothing holds the lever now: it is thrown at once.
    expect(run(c, place(back.state, 200, 220), INTERACT).events).toContainEqual({ type: 'switchChanged', object: 5, on: false, mode: 'toggle', by: 'interact' });
  });
});

describe("the stomach chapter's sorting lab", () => {
  const loadMap = (path: string) => JSON.parse(readFileSync(`public/assets/maps/${path}.tmj`, 'utf8')) as TiledMap;
  const file = CHAPTERS.get('stomach')!;
  const content: ChapterContent = {
    chapter: file,
    rooms: new Map(roomsOf(file).map((path) => [path, parseRoom(path, loadMap(path), TAGS)])),
    dialogues: DIALOGUES, dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS, rescues: RESCUES,
  };
  const START_LEVER = 7;
  const FORK_LEVER = 9;
  const DOOR = 14;
  const lab = () => { const { pending: _, ...s } = startChapter(content, { room: 'stomach/sorting-lab' }); return s; };
  const stand = (s: ChapterState, col: number): ChapterState => place(s, col * 32 + 16, 5 * 32 + 20);

  interface Play { readonly events: readonly { readonly t: number; readonly e: GameEvent }[]; readonly state: ChapterState }
  /** Throws the line's lever at each of `startAt` (seconds), then the fork's lever at each of `forkAt`; plays on for `seconds`. */
  function play(forkAt: readonly number[], seconds = 120, startAt: readonly number[] = [0]): Play {
    let s = stand(lab(), 5);
    const events: { t: number; e: GameEvent }[] = [];
    const ticks = forkAt.map((sec) => Math.round(sec * TICK_HZ));
    const starts = startAt.map((sec) => Math.round(sec * TICK_HZ));
    for (let t = 0; t < seconds * TICK_HZ; t++) {
      let input = NONE;
      if (starts.includes(t)) { s = stand(s, 5); input = INTERACT; }
      else if (ticks.includes(t)) { s = stand(s, 9); input = INTERACT; }
      const r = stepChapter(content, s, input);
      s = r.state;
      for (const e of r.events) events.push({ t: t / TICK_HZ, e });
    }
    return { events, state: s };
  }
  const first = (r: Play, type: GameEvent['type']) => r.events.find((x) => x.e.type === type)?.t;

  it('has a slow way round to the hopper that takes longer than the smallest portion', () => {
    const { room } = lab().game;
    const slow = room.objects.filter((o) => o.name.startsWith('slow-'));
    expect(slow.map((o) => o.props['speed'])).toEqual(new Array(5).fill('slow'));
    const seconds = slow.reduce((sum, o) => sum + (conveyorTiles(o).length * CONVEYOR_TICKS['slow']!) / TICK_HZ, 0);
    // A box sent that way reaches the hopper after the first box into the mixer has been digested, so its slot is free.
    expect(seconds).toBeGreaterThan(PORTION_SECONDS.small);
    // A fork with a lever aimed at it, which has a cooldown, and a line that waits for its own lever.
    const fork = room.objects.find((o) => o.name === 'fork')!;
    expect(fork.props).toMatchObject({ direction: 'E', altDirection: 'S' });
    expect(room.objects.find((o) => o.id === FORK_LEVER)!.props).toMatchObject({ target: fork.id, cooldownSeconds: 5 });
    expect(room.objects.find((o) => o.id === START_LEVER)!.props['target']).toBe(room.objects.find((o) => o.name === 'belt-in')!.id);
  });

  it('shows each food box its portion, which the player sorts by', () => {
    expect(selectPortions(lab().game)).toEqual([
      { object: 2, portion: 'large' }, { object: 3, portion: 'small' }, { object: 4, portion: 'normal' }, { object: 5, portion: 'small' },
    ]);
  });

  it('keeps the line still until its lever is thrown', () => {
    const s = lab();
    const still = run(content, s, NONE, 600).state;
    expect(tiles(still)).toEqual(tiles(s));
    expect(types(run(content, still, NONE, 600).events)).not.toContain('mixerFed');
  });

  it('refuses to pause the line with its own lever, so the fork cannot be skipped', () => {
    // Stopping the belt after three boxes and starting it again once the mixer had emptied would pass the room with the fork untouched.
    const r = play([], 120, [0, 6, 20]);
    expect(r.events.filter((x) => x.e.type === 'switchCooling').map((x) => x.t)).toEqual([6, 20]);
    expect(first(r, 'mixerJammed')).toBeCloseTo(7.5, 0);
    expect(first(r, 'portFilled')).toBeUndefined();
  });

  it('jams the mixer on the fourth box when the fork is never thrown', () => {
    const r = play([]);
    expect(r.events.filter((x) => x.e.type === 'mixerFed')).toHaveLength(3);
    expect(first(r, 'mixerJammed')).toBeCloseTo(7.5, 0);
    expect(first(r, 'portFilled')).toBeUndefined();
    expect(selectDoorLocks(r.state.game).find((d) => d.object === DOOR)!.open).toBe(false);
  });

  it('is solved by sending the last boxes the slow way once the first two have gone straight, and opens the door', () => {
    for (const sec of [3.5, 4.5, 6]) {
      const r = play([sec]);
      expect(first(r, 'mixerJammed'), `${sec}`).toBeUndefined();
      expect(first(r, 'portFilled'), `${sec}`).toBeGreaterThan(48);
      expect(selectDoorLocks(r.state.game).find((d) => d.object === DOOR)!.open).toBe(true);
    }
    // The large portion goes in first, the one sent round last: the last box is fed after the 15 s of a small one are over.
    const fed = play([4.5]).events.filter((x) => x.e.type === 'mixerFed');
    expect(fed.map((x) => (x.e as { object: number }).object)).toEqual([2, 3, 4, 5]);
    expect(fed[3]!.t).toBeGreaterThan(fed[1]!.t + PORTION_SECONDS.small);
  });

  it('jams all the same when the fork is thrown too early, so the small portion that frees a slot is sent round with the rest', () => {
    for (const sec of [0.5, 2]) {
      const r = play([sec]);
      expect(first(r, 'mixerJammed'), `${sec}`).toBeGreaterThan(20);
      expect(first(r, 'portFilled')).toBeUndefined();
    }
  });

  it('jams all the same when the fork is thrown too late, after the fourth box has gone by', () => {
    const r = play([7.5]);
    expect(first(r, 'mixerJammed')).toBeCloseTo(7.5, 0);
  });

  it('holds the fork lever for 5 seconds, so no one box can be sent round alone while the line runs close behind it', () => {
    // Thrown on at 0.5 s, before the large portion reaches the fork, and meant to be thrown back before the next: too soon.
    const r = play([0.5, 2.5]);
    const cooling = r.events.filter((x) => x.e.type === 'switchCooling');
    expect(cooling).toHaveLength(1);
    expect(cooling[0]!.t).toBeCloseTo(2.5, 1);
    expect(r.events.filter((x) => x.e.type === 'switchChanged' && (x.e as { object: number }).object === FORK_LEVER)).toHaveLength(1);
    // So all four go round, and the mixer is jammed by the last of them.
    expect(first(r, 'mixerJammed')).toBeGreaterThan(20);
  });
});
