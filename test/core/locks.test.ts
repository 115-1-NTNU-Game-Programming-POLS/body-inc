import { describe, expect, it } from 'vitest';
import { BOSSES, DIALOGUES, ENEMIES, PARAMS, TAGS } from '../../src/app/content.ts';
import { tagsFromQuery } from '../../src/app/session.ts';
import {
  advance, decode, encode, inWindow, parseClockWindow, parseRoom, resumeChapter, selectDoorLocks, selectInteractable, selectSwitches,
  startChapter, startClock, stateHash, stepChapter, STORY,
  type ChapterContent, type ChapterState, type GameEvent, type TickInput, type TiledMap,
} from '../../src/core/index.ts';

/**
 * Door locks and switches (build plan, after P1). Rooms here are bare 20 x 12 floors with no
 * walls, built from Tiled objects, so each rule is exercised alone.
 */

const p = (name: string, value: string | number | boolean) => ({ name, value });
const NONE: TickInput = { move: { x: 0, y: 0 } };
const INTERACT: TickInput = { move: { x: 0, y: 0 }, interactPressed: true };
const types = (events: readonly GameEvent[]) => events.map((e) => e.type);

function room(path: string, objects: object[]) {
  const map = {
    width: 20, height: 12, tilewidth: 32, tileheight: 32,
    properties: [p('organ', 'lobby'), p('role', 'puzzle'), p('estSeconds', 10)],
    layers: [
      { type: 'tilelayer', name: 'walls', data: new Array(240).fill(0) },
      { type: 'objectgroup', name: 'objects', objects: [{ id: 1, type: 'PlayerStart', x: 320, y: 200 }, ...objects] },
    ],
  } as unknown as TiledMap;
  return parseRoom(path, map, TAGS);
}

const southDoor = (lock: string, param = '') => ({
  id: 2, type: 'Door', name: 'door-s', x: 288, y: 352, width: 64, height: 32,
  properties: [p('socket', 'S'), p('lock', lock), ...(param ? [p('lockParam', param)] : [])],
});
const northDoor = { id: 2, type: 'Door', name: 'door-n', x: 288, y: 0, width: 64, height: 96, properties: [p('socket', 'N')] };
/** A lever at (x, y), one tile square around the point. */
const lever = (id: number, x: number, y: number, target = 2) => ({ id, type: 'Switch', x, y, properties: [p('target', target)] });
const plate = (id: number, x: number, y: number, target = 2) => ({ id, type: 'Switch', x, y, properties: [p('target', target), p('mode', 'hold')] });

/** Room a, whose south door has the lock under test, joined to a plain room b. */
function chapter(lockedDoor: object, more: object[] = [], extraRooms: [string, object[]][] = []): ChapterContent {
  return {
    chapter: { version: 1, id: 'lab', start: 'lab/a', links: [{ a: 'lab/a#door-s', b: 'lab/b#door-n' }] },
    rooms: new Map([['lab/a', room('lab/a', [lockedDoor, ...more])], ['lab/b', room('lab/b', [northDoor])], ...extraRooms.map(([k, o]) => [k, room(k, o)] as const)]),
    dialogues: DIALOGUES, dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS,
  };
}

function run(c: ChapterContent, s: ChapterState, input: TickInput, n = 1): { state: ChapterState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    const r = stepChapter(c, s, input);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

const place = (s: ChapterState, x: number, y: number): ChapterState =>
  ({ ...s, game: { ...s.game, touching: [], operator: { ...s.game.operator, x, y } } });

/** Stands just above the south door and pushes into it for `n` ticks. */
const pushSouth = (c: ChapterContent, s: ChapterState, n = 20) => run(c, place(s, 320, 340), { move: { x: 0, y: 1 } }, n);

describe('clock windows', () => {
  it('reads HH:MM-HH:MM, with 24:00 as an end and windows past midnight', () => {
    expect(parseClockWindow('08:00-10:00')).toEqual({ from: 480, to: 600 });
    expect(parseClockWindow('17:00-24:00')).toEqual({ from: 1020, to: 1440 });
    expect(parseClockWindow('22:00-02:00')).toEqual({ from: 1320, to: 120 });
    expect(parseClockWindow('10:00-08:00')).toEqual({ from: 600, to: 480 });
    expect(parseClockWindow('08:00-08:00')).toBeUndefined();
  });

  it('includes the start and excludes the end, on any day', () => {
    const w = parseClockWindow('08:00-10:00')!;
    expect(inWindow(w, startClock(1, 7, 59))).toBe(false);
    expect(inWindow(w, startClock(1, 8))).toBe(true);
    expect(inWindow(w, startClock(1, 9, 59))).toBe(true);
    expect(inWindow(w, startClock(1, 10))).toBe(false);
    expect(inWindow(w, startClock(3, 8, 30))).toBe(true);
    const night = parseClockWindow('22:00-02:00')!;
    expect([21, 22, 23, 0, 1, 2].map((h) => inWindow(night, startClock(2, h)))).toEqual([false, true, true, true, true, false]);
  });
});

describe('switch locks', () => {
  it('a door stays shut until its lever is thrown with the interact key, then lets the operator through', () => {
    const c = chapter(southDoor('switch'), [lever(3, 200, 200)]);
    const s0 = startChapter(c);
    const shut = pushSouth(c, s0);
    expect(shut.events).toContainEqual({ type: 'doorLocked', object: 2, lock: 'switch' });
    expect(shut.state.run.roomId).toBe('lab/a');

    const atLever = place(s0, 200, 220);
    expect(selectInteractable(atLever.game)).toEqual({ object: 3, kind: 'Switch' });
    const thrown = run(c, atLever, INTERACT);
    // Only the switch: the interact key used on a lever is not also a talk or a bed.
    expect(thrown.events).toEqual([{ type: 'switchChanged', object: 3, on: true, mode: 'toggle', by: 'interact' }]);
    expect(thrown.state.run.switches).toEqual(['lab/a#3']);
    expect(selectDoorLocks(thrown.state.game)).toEqual([{ object: 2, lock: 'switch', open: true }]);

    const through = pushSouth(c, thrown.state);
    expect(through.events).toContainEqual({ type: 'roomChanged', from: 'lab/a', to: 'lab/b' });
  });

  it('the interact key throws a lever back off, and the door locks again', () => {
    const c = chapter(southDoor('switch'), [lever(3, 200, 200)]);
    const on = run(c, place(startChapter(c), 200, 220), INTERACT).state;
    const off = run(c, run(c, on, NONE).state, INTERACT);
    expect(off.events).toContainEqual({ type: 'switchChanged', object: 3, on: false, mode: 'toggle', by: 'interact' });
    expect(off.state.run.switches).toEqual([]);
    expect(types(pushSouth(c, off.state).events)).toContain('doorLocked');
  });

  it('a staple pins a lever on from across the room, but never turns it off', () => {
    // The lever sits on the north wall line, straight above the operator.
    const c = chapter(southDoor('switch'), [lever(3, 320, 64)]);
    const fire: TickInput = { move: { x: 0, y: -1 }, attack: true, attackPressed: true };
    const aimUp = run(c, startChapter(c), { move: { x: 0, y: -1 } }).state;
    const shot = run(c, aimUp, fire, 60);
    const changes = shot.events.filter((e) => e.type === 'switchChanged');
    // Held fire keeps hitting it, yet it changes once.
    expect(changes).toEqual([{ type: 'switchChanged', object: 3, on: true, mode: 'toggle', by: 'staple' }]);
    expect(shot.state.run.switches).toEqual(['lab/a#3']);
    expect(types(pushSouth(c, shot.state).events)).toContain('roomChanged');
  });

  it('a staple reaches a lever mounted on a wall before the wall stops it', () => {
    const map = {
      width: 20, height: 12, tilewidth: 32, tileheight: 32,
      properties: [p('organ', 'lobby'), p('role', 'puzzle'), p('estSeconds', 10)],
      // North wall rows 0-2, as in every real room; the lever is on its lowest row.
      layers: [
        { type: 'tilelayer', name: 'walls', data: Array.from({ length: 240 }, (_, i) => (i < 60 ? 1 : 0)) },
        { type: 'objectgroup', name: 'objects', objects: [{ id: 1, type: 'PlayerStart', x: 320, y: 200 }, southDoor('switch'), lever(3, 320, 80)] },
      ],
    } as unknown as TiledMap;
    const base = chapter(southDoor('switch'), [lever(3, 200, 200)]);
    const c: ChapterContent = { ...base, rooms: new Map([...base.rooms, ['lab/a', parseRoom('lab/a', map, TAGS)]]) };
    const aimUp = run(c, startChapter(c), { move: { x: 0, y: -1 } }).state;
    const shot = run(c, aimUp, { move: { x: 0, y: -1 }, attack: true, attackPressed: true }, 40);
    expect(shot.events.filter((e) => e.type === 'switchChanged')).toHaveLength(1);
  });

  it('a lever pinned by a staple while the operator is pressed against its door lets them through on the next tick', () => {
    // The lever sits in the doorway, so a staple fired into the door pins it.
    const c = chapter(southDoor('switch'), [lever(3, 320, 368)]);
    const pressed = pushSouth(c, startChapter(c), 10);
    expect(types(pressed.events)).toEqual(['doorLocked']);
    const fired = run(c, pressed.state, { move: { x: 0, y: 1 }, attack: true, attackPressed: true }, 8);
    expect(types(fired.events)).toContain('switchChanged');
    expect(types(fired.events)).toContain('roomChanged');
  });

  it('a door with two switches opens only when both are on', () => {
    const c = chapter(southDoor('switch'), [lever(3, 200, 200), lever(4, 440, 200)]);
    const one = run(c, place(startChapter(c), 200, 220), INTERACT).state;
    expect(types(pushSouth(c, one).events)).toContain('doorLocked');
    const both = run(c, place(one, 440, 220), INTERACT).state;
    expect(both.run.switches).toEqual(['lab/a#3', 'lab/a#4']);
    expect(types(pushSouth(c, both).events)).toContain('roomChanged');
  });

  it('a plate holds the door open only while stood on, and is not remembered', () => {
    // The plate lies in front of the door, so standing on it and pushing into the door is one move.
    const c = chapter(southDoor('switch'), [plate(3, 320, 336)]);
    const s0 = startChapter(c);
    const down = run(c, place(s0, 320, 330), NONE);
    expect(down.events).toContainEqual({ type: 'switchChanged', object: 3, on: true, mode: 'hold', by: 'step' });
    expect(down.state.run.switches).toEqual([]);
    expect(selectSwitches(down.state.game)).toEqual([{ object: 3, mode: 'hold', on: true }]);
    const up = run(c, place(down.state, 320, 200), NONE);
    expect(up.events).toContainEqual({ type: 'switchChanged', object: 3, on: false, mode: 'hold', by: 'step' });
    expect(selectDoorLocks(up.state.game)[0]!.open).toBe(false);
    // A plate is not something the interact key reaches.
    expect(selectInteractable(place(s0, 320, 330).game)).toBeUndefined();
    expect(types(pushSouth(c, s0).events)).toContain('roomChanged');
  });

  it('a forced leave before any time clock lets a plate up, since nobody stands on it any more', () => {
    const c = chapter(southDoor('switch'), [plate(3, 320, 336)]);
    const down = run(c, place(startChapter(c), 320, 330), NONE).state;
    expect(down.game.switches).toEqual([3]);
    const dying: ChapterState = { ...down, game: { ...down.game, operator: { ...down.game.operator, halves: 0 } } };
    const after = run(c, dying, NONE);
    expect(types(after.events)).toContain('forcedLeave');
    expect(after.state.game.operator).toMatchObject({ x: 320, y: 200 });
    expect(after.state.game.switches).toEqual([]);
    expect(selectDoorLocks(after.state.game)[0]!.open).toBe(false);
  });

  it('a thrown lever stays thrown after leaving the room and coming back', () => {
    const c = chapter(southDoor('switch'), [lever(3, 200, 200)]);
    const thrown = run(c, place(startChapter(c), 200, 220), INTERACT).state;
    const inB = pushSouth(c, thrown).state;
    expect(inB.run.roomId).toBe('lab/b');
    const back = run(c, place(inB, 320, 110), { move: { x: 0, y: -1 } }, 20).state;
    expect(back.run.roomId).toBe('lab/a');
    expect(back.game.switches).toEqual([3]);
    expect(selectSwitches(back.game)).toEqual([{ object: 3, mode: 'toggle', on: true }]);
  });

  it('a lever thrown after the time clock stays thrown through a forced leave, as a solved puzzle stays solved', () => {
    const clockTrigger = { id: 4, type: 'Trigger', x: 96, y: 96, width: 32, height: 32, properties: [p('event', 'checkpoint')] };
    const c = chapter(southDoor('switch'), [lever(3, 200, 200), clockTrigger]);
    const punched = run(c, place(startChapter(c), 112, 120), NONE).state;
    expect(punched.run.checkpoint?.switches).toEqual([]);
    const thrown = run(c, place(punched, 200, 220), INTERACT).state;
    const dying: ChapterState = { ...thrown, game: { ...thrown.game, operator: { ...thrown.game.operator, halves: 0 } } };
    // Hearts at zero are noticed on the next step, which is a forced leave.
    const back = run(c, dying, NONE);
    expect(types(back.events)).toContain('returnedToCheckpoint');
    expect(back.state.run.switches).toEqual(['lab/a#3']);
    expect(back.state.game.switches).toEqual([3]);
  });

  it('the time clock saves the levers, and continuing from it restores them', () => {
    const clockTrigger = { id: 4, type: 'Trigger', x: 96, y: 96, width: 32, height: 32, properties: [p('event', 'checkpoint')] };
    const c = chapter(southDoor('switch'), [lever(3, 200, 200), clockTrigger]);
    const thrown = run(c, place(startChapter(c), 200, 220), INTERACT).state;
    const punched = run(c, place(thrown, 112, 120), NONE).state;
    expect(punched.run.checkpoint?.switches).toEqual(['lab/a#3']);
    const saved = decode(STORY, encode(STORY, { checkpoint: punched.run.checkpoint }));
    expect(saved.kind).toBe('ok');
    const resumed = resumeChapter(c, saved.data.checkpoint!);
    expect(resumed.game.switches).toEqual([3]);
    expect(types(pushSouth(c, resumed).events)).toContain('roomChanged');
  });

  it('a lever in a variant that is not active is absent, so a door that only it opens stays shut', () => {
    const map = {
      width: 20, height: 12, tilewidth: 32, tileheight: 32,
      properties: [p('organ', 'lobby'), p('role', 'puzzle'), p('estSeconds', 10)],
      layers: [
        { type: 'tilelayer', name: 'walls', data: new Array(240).fill(0) },
        { type: 'objectgroup', name: 'objects', objects: [{ id: 1, type: 'PlayerStart', x: 320, y: 200 }, southDoor('switch')] },
        { type: 'objectgroup', name: 'variant:deadline', properties: [p('when', 'deadline')], objects: [lever(3, 200, 200)] },
      ],
    } as unknown as TiledMap;
    const base = chapter(southDoor('switch'), [lever(9, 200, 200)]);
    const c: ChapterContent = { ...base, rooms: new Map([...base.rooms, ['lab/a', parseRoom('lab/a', map, TAGS)]]) };
    const quiet = startChapter(c);
    expect(selectSwitches(quiet.game)).toEqual([]);
    expect(selectInteractable(place(quiet, 200, 220).game)).toBeUndefined();
    // No switch present is not the same as every switch on.
    const shut = types(pushSouth(c, quiet).events);
    expect(shut).toContain('doorLocked');
    expect(shut).not.toContain('roomChanged');
    const busy = startChapter(c, { tags: tagsFromQuery('?tags=deadline', TAGS) });
    const thrown = run(c, place(busy, 200, 220), INTERACT).state;
    expect(types(pushSouth(c, thrown).events)).toContain('roomChanged');
  });
});

describe('clock and resource locks', () => {
  it('a clock lock opens and closes with the chapter clock', () => {
    const c = chapter(southDoor('clock', '08:30-09:00'));
    const early = startChapter(c);
    expect(early.game.clock).toEqual(startClock(1, 8));
    expect(pushSouth(c, early).events).toContainEqual({ type: 'doorLocked', object: 2, lock: 'clock' });
    const open = startChapter(c, { clock: startClock(1, 8, 30) });
    expect(types(pushSouth(c, open).events)).toContain('roomChanged');
    const late = startChapter(c, { clock: startClock(1, 9) });
    expect(types(pushSouth(c, late).events)).toContain('doorLocked');
  });

  it('an operator waiting against a door goes through the moment its window opens', () => {
    const c = chapter(southDoor('clock', '08:01-09:00'));
    const waiting = pushSouth(c, startChapter(c), 10);
    expect(types(waiting.events)).toEqual(['doorLocked']);
    // One chapter minute later the window opens; the operator has not stepped off.
    const minute = Math.round((PARAMS.exploreSecondsPerHour * 60) / 60);
    const later = run(c, waiting.state, { move: { x: 0, y: 1 } }, minute + 2);
    expect(types(later.events)).toContain('roomChanged');
  });

  it('a resource lock follows the tags, judged every tick', () => {
    const c = chapter(southDoor('resource', 'caffeine<50'));
    expect(types(pushSouth(c, startChapter(c)).events)).toContain('roomChanged');
    const jittery = startChapter(c, { tags: tagsFromQuery('?tags=caffeine:100', TAGS) });
    expect(pushSouth(c, jittery).events).toContainEqual({ type: 'doorLocked', object: 2, lock: 'resource' });
    // The residual decays as the clock moves; at 49 the same door opens.
    const calmer: ChapterState = { ...jittery, run: { ...jittery.run, tags: tagsFromQuery('?tags=caffeine:49', TAGS) } };
    expect(types(pushSouth(c, calmer).events)).toContain('roomChanged');
  });

  it('the view and the rule agree on which doors are open', () => {
    const c = chapter(southDoor('clock', '08:00-09:00'));
    const s = startChapter(c);
    expect(selectDoorLocks(s.game)).toEqual([{ object: 2, lock: 'clock', open: true }]);
    const after = { ...s, game: { ...s.game, clock: advance(s.game.clock, 60) } };
    const stepped = run(c, after, NONE).state;
    expect(selectDoorLocks(stepped.game)).toEqual([{ object: 2, lock: 'clock', open: false }]);
  });
});

describe('replay', () => {
  it('a walk that throws a lever and goes through replays to the same hash', () => {
    const c = chapter(southDoor('switch'), [lever(3, 200, 200)]);
    const script: TickInput[] = [
      ...Array.from({ length: 40 }, () => ({ move: { x: -1, y: 0 } })),
      INTERACT, NONE,
      ...Array.from({ length: 40 }, () => ({ move: { x: 1, y: 0 } })),
      ...Array.from({ length: 120 }, () => ({ move: { x: 0, y: 1 } })),
    ];
    const play = () => script.reduce((s, input) => stepChapter(c, s, input).state, startChapter(c));
    const end = play();
    // The walk must really use the lever, or the hash would only show that walking replays.
    expect(end.run.roomId).toBe('lab/b');
    expect(end.run.switches).toEqual(['lab/a#3']);
    expect(stateHash(end)).toBe(stateHash(play()));
  });
});

describe('story save', () => {
  it('a version-1 checkpoint gains an empty switch list', () => {
    const v1 = JSON.stringify({
      schema: 1,
      data: { checkpoint: { chapter: 'greybox', roomId: 'greybox/rest-room', x: 1, y: 2, tags: { values: {}, log: { nodes: [] } }, clock: { day: 1, minute: 540 }, fired: ['a#1'] } },
    });
    const d = decode(STORY, v1);
    expect(d.kind).toBe('migrated');
    expect(d.data.checkpoint).toMatchObject({ fired: ['a#1'], switches: [] });
    expect(decode(STORY, JSON.stringify({ schema: 1, data: { checkpoint: null } })).data).toEqual({ checkpoint: null });
  });

  it('a checkpoint naming a switch that is gone continues without it', () => {
    const c = chapter(southDoor('switch'), [lever(3, 200, 200)]);
    const s = startChapter(c);
    const resumed = resumeChapter(c, {
      chapter: 'lab', roomId: 'lab/a', x: 320, y: 200, tags: s.run.tags, clock: s.game.clock, fired: [], switches: ['lab/a#3', 'lab/a#77', 'lab/a#2'],
    });
    expect(resumed.game.switches).toEqual([3]);
  });
});
