import { describe, expect, it } from 'vitest';
import { BOSSES, DIALOGUES, ENEMIES, PARAMS, TAGS } from '../../src/app/content.ts';
import { tagsFromQuery } from '../../src/app/session.ts';
import {
  caffeineOf, decode, encode, mayOpen, parseRoom, resumeChapter, selectDoorLocks, selectInteractable, selectPickups,
  startChapter, stateHash, stepChapter, STORY,
  type ChapterContent, type ChapterState, type GameEvent, type TickInput, type TiledMap,
} from '../../src/core/index.ts';
import { readRoom } from '../../src/core/rooms/tiled.ts';

/**
 * Pickups and the key lock (package 2 of the content-team plan). Rooms are bare 20 x 12 floors
 * built from Tiled objects, as in locks.test.ts.
 */

const p = (name: string, value: string | number | boolean) => ({ name, value });
const NONE: TickInput = { move: { x: 0, y: 0 } };
const INTERACT: TickInput = { move: { x: 0, y: 0 }, interactPressed: true };
const types = (events: readonly GameEvent[]) => events.map((e) => e.type);

const mapOf = (objects: object[], variants: object[] = []) => ({
  width: 20, height: 12, tilewidth: 32, tileheight: 32,
  properties: [p('organ', 'lobby'), p('role', 'puzzle'), p('estSeconds', 10)],
  layers: [
    { type: 'tilelayer', name: 'walls', data: new Array(240).fill(0) },
    { type: 'objectgroup', name: 'objects', objects: [{ id: 1, type: 'PlayerStart', x: 320, y: 200 }, ...objects] },
    ...variants,
  ],
}) as unknown as TiledMap;

const room = (path: string, objects: object[]) => parseRoom(path, mapOf(objects), TAGS);

const item = (id: number, itemType: string, itemId: string, x: number, y: number, when = '') => ({
  id, type: 'Pickup', x, y, properties: [p('itemType', itemType), ...(itemId ? [p('itemId', itemId)] : []), ...(when ? [p('when', when)] : [])],
});
const southDoor = (lock: string, param = '') => ({
  id: 2, type: 'Door', name: 'door-s', x: 288, y: 352, width: 64, height: 32,
  properties: [p('socket', 'S'), p('lock', lock), ...(param ? [p('lockParam', param)] : [])],
});
const northDoor = { id: 2, type: 'Door', name: 'door-n', x: 288, y: 0, width: 64, height: 96, properties: [p('socket', 'N')] };
const timeClock = { id: 9, type: 'Trigger', x: 96, y: 96, width: 32, height: 32, properties: [p('event', 'checkpoint')] };

function chapter(objects: object[], door: object = southDoor('none')): ChapterContent {
  return {
    chapter: { version: 1, id: 'lab', start: 'lab/a', links: [{ a: 'lab/a#door-s', b: 'lab/b#door-n' }] },
    rooms: new Map([['lab/a', room('lab/a', [door, ...objects])], ['lab/b', room('lab/b', [northDoor])]]),
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
const pushSouth = (c: ChapterContent, s: ChapterState, n = 20) => run(c, place(s, 320, 340), { move: { x: 0, y: 1 } }, n);
/** Interact while standing just below the item at (200, 200). */
const take = (c: ChapterContent, s: ChapterState) => run(c, place(s, 200, 220), INTERACT);
const caffeine = (s: ChapterState) => caffeineOf(s.run.tags, TAGS);

describe('taking an item', () => {
  it('the interact key takes it: it leaves the room, is remembered by the run and cannot be taken twice', () => {
    const c = chapter([item(3, 'file', 'memo', 200, 200)]);
    const s0 = startChapter(c);
    expect(selectInteractable(place(s0, 200, 220).game)).toEqual({ object: 3, kind: 'Pickup' });
    const taken = take(c, s0);
    expect(taken.events).toEqual([{ type: 'pickedUp', object: 3, itemType: 'file', itemId: 'memo' }]);
    expect(taken.state.run.fired).toEqual(['lab/a#3']);
    expect(selectPickups(taken.state.game)).toEqual([{ object: 3, itemType: 'file', present: false }]);
    expect(selectInteractable(taken.state.game)).toBeUndefined();
    const again = run(c, run(c, taken.state, NONE).state, INTERACT);
    expect(types(again.events)).not.toContain('pickedUp');
  });

  it('an item with no rule of its own changes no tag and logs nothing', () => {
    const c = chapter([item(3, 'thanks_card', '', 200, 200)]);
    const s0 = startChapter(c);
    const taken = take(c, s0).state;
    expect(taken.run.tags).toEqual(s0.run.tags);
  });

  it('coffee adds a cup of residual, logged as its own cause, and the cloak is on from the next tick', () => {
    const c = chapter([item(3, 'coffee', '', 200, 200)]);
    const s0 = startChapter(c);
    expect(s0.game.senseCapPx).toBeUndefined();
    const drunk = take(c, s0);
    expect(caffeine(drunk.state)).toBe(PARAMS.cup);
    expect(drunk.state.run.tags.log.nodes.some((n) => n.kind === 'activity' && n.key === 'pickup.coffee')).toBe(true);
    // A full cloak: adenosine cannot see the operator at all (design doc 7.4).
    expect(run(c, drunk.state, NONE).state.game.senseCapPx).toBe(0);
  });

  it('coffee adds to the residual already there', () => {
    const c = chapter([item(3, 'coffee', '', 200, 200)]);
    const s0 = startChapter(c, { tags: tagsFromQuery('?tags=caffeine:30', TAGS) });
    expect(caffeine(take(c, s0).state)).toBe(30 + PARAMS.cup);
  });

  it('a handbook page is unlocked, and nothing else changes but the log', () => {
    const c = chapter([item(3, 'handbook', 'caffeine', 200, 200)]);
    const s0 = startChapter(c);
    const read = take(c, s0);
    expect(read.events).toContainEqual({ type: 'handbookUnlocked', id: 'caffeine' });
    expect(read.state.run.tags.values).toEqual(s0.run.tags.values);
    expect(read.state.run.tags.log.nodes.map((n) => n.key)).toEqual(['pickup.handbook', 'unlock.caffeine']);
  });

  it('an item taken on the tick the hearts run out is still taken, like a lever thrown then', () => {
    const c = chapter([item(3, 'file', 'memo', 200, 200)]);
    const near = place(startChapter(c), 200, 220);
    const dying: ChapterState = { ...near, game: { ...near.game, operator: { ...near.game.operator, halves: 0 } } };
    const r = run(c, dying, INTERACT);
    expect(types(r.events)).toEqual(expect.arrayContaining(['pickedUp', 'forcedLeave']));
    expect(r.state.game.taken).toEqual([3]);
  });

  it('a room keeps only its own pickups as taken, though the run hands it every spent object', () => {
    const once = { id: 4, type: 'Trigger', x: 96, y: 96, width: 32, height: 32, properties: [p('event', 'cutscene'), p('eventId', 'x')] };
    const c = chapter([item(3, 'file', 'memo', 200, 200), once]);
    const s0 = startChapter(c);
    const spent: ChapterState = { ...s0, run: { ...s0.run, fired: ['lab/a#4', 'lab/a#3', 'lab/a#77', 'lab/b#3'] } };
    const inB = pushSouth(c, spent).state;
    const back = run(c, place(inB, 320, 110), { move: { x: 0, y: -1 } }, 20).state;
    expect(back.run.roomId).toBe('lab/a');
    expect(back.game.taken).toEqual([3]);
  });

  it('an item taken stays gone after leaving the room and coming back', () => {
    const c = chapter([item(3, 'file', 'memo', 200, 200)]);
    const taken = take(c, startChapter(c)).state;
    const inB = pushSouth(c, taken).state;
    expect(inB.run.roomId).toBe('lab/b');
    const back = run(c, place(inB, 320, 110), { move: { x: 0, y: -1 } }, 20).state;
    expect(back.run.roomId).toBe('lab/a');
    expect(selectPickups(back.game)).toEqual([{ object: 3, itemType: 'file', present: false }]);
  });
});

describe('the time clock and items', () => {
  it('coffee drunk after the punch is undone by a forced leave: the cup is back and the residual is the punch\'s', () => {
    const c = chapter([item(3, 'coffee', '', 200, 200), timeClock]);
    const punched = run(c, place(startChapter(c), 112, 120), NONE).state;
    const drunk = take(c, punched).state;
    expect(caffeine(drunk)).toBe(PARAMS.cup);
    const dying: ChapterState = { ...drunk, game: { ...drunk.game, operator: { ...drunk.game.operator, halves: 0 } } };
    const back = run(c, dying, NONE);
    expect(types(back.events)).toContain('returnedToCheckpoint');
    expect(caffeine(back.state)).toBe(0);
    expect(back.state.run.fired).toEqual([]);
    expect(selectPickups(back.state.game)[0]!.present).toBe(true);
  });

  it('a handbook page taken after the punch stays taken through a forced leave, since the page stays in the handbook', () => {
    const c = chapter([item(3, 'handbook', 'caffeine', 200, 200), item(4, 'file', 'memo', 280, 200), timeClock]);
    const punched = run(c, place(startChapter(c), 112, 120), NONE).state;
    const read = take(c, punched).state;
    const both = run(c, place(read, 280, 220), INTERACT).state;
    const dying: ChapterState = { ...both, game: { ...both.game, operator: { ...both.game.operator, halves: 0 } } };
    const back = run(c, dying, NONE);
    expect(types(back.events)).toContain('returnedToCheckpoint');
    expect(back.state.run.fired).toEqual(['lab/a#3']);
    expect(selectPickups(back.state.game)).toEqual([
      { object: 3, itemType: 'handbook', present: false },
      { object: 4, itemType: 'file', present: true },
    ]);
  });

  it('an item taken before the punch stays taken through a forced leave, and through save and continue', () => {
    const c = chapter([item(3, 'coffee', '', 200, 200), timeClock]);
    const drunk = take(c, startChapter(c)).state;
    const punched = run(c, place(drunk, 112, 120), NONE).state;
    expect(punched.run.checkpoint?.fired).toEqual(['lab/a#3']);
    const dying: ChapterState = { ...punched, game: { ...punched.game, operator: { ...punched.game.operator, halves: 0 } } };
    const back = run(c, dying, NONE).state;
    expect(selectPickups(back.game)[0]!.present).toBe(false);
    expect(caffeine(back)).toBe(PARAMS.cup);
    const saved = decode(STORY, encode(STORY, { checkpoint: punched.run.checkpoint, entry: null }));
    expect(selectPickups(resumeChapter(c, saved.data.checkpoint!).game)[0]!.present).toBe(false);
  });
});

describe('key locks', () => {
  it('a key door stays shut until the item named by its lockParam is taken, then opens at once', () => {
    const c = chapter([item(3, 'file', 'archive-key', 200, 200)], southDoor('key', 'archive-key'));
    const s0 = startChapter(c);
    expect(pushSouth(c, s0).events).toContainEqual({ type: 'doorLocked', object: 2, lock: 'key' });
    const taken = take(c, s0).state;
    expect(selectDoorLocks(taken.game)).toEqual([{ object: 2, lock: 'key', open: true }]);
    expect(pushSouth(c, taken).events).toContainEqual({ type: 'roomChanged', from: 'lab/a', to: 'lab/b' });
  });

  it('a key lying in the doorway opens the door on the very tick it is taken', () => {
    const c = chapter([item(3, 'file', 'k', 320, 368)], southDoor('key', 'k'));
    const pressed = pushSouth(c, startChapter(c), 10);
    expect(types(pressed.events)).toEqual(['doorLocked']);
    const r = run(c, pressed.state, { move: { x: 0, y: 1 }, interactPressed: true });
    expect(types(r.events)).toEqual(expect.arrayContaining(['pickedUp', 'roomChanged']));
  });

  it('a sealed key door is not opened by an item without an itemId', () => {
    const c = chapter([item(3, 'coffee', '', 200, 200)], southDoor('key'));
    const drunk = take(c, startChapter(c)).state;
    expect(drunk.game.taken).toEqual([3]);
    expect(selectDoorLocks(drunk.game)[0]!.open).toBe(false);
  });

  it('item names are read without the spaces around them, on the door and on the item', () => {
    const c = chapter([item(3, 'file', ' k ', 200, 200)], southDoor('key', 'k'));
    const taken = take(c, startChapter(c));
    expect(taken.events).toEqual([{ type: 'pickedUp', object: 3, itemType: 'file', itemId: 'k' }]);
    expect(selectDoorLocks(taken.state.game)[0]!.open).toBe(true);
  });

  it('another item does not open it', () => {
    const c = chapter([item(3, 'file', 'archive-key', 200, 200), item(4, 'file', 'other', 440, 200)], southDoor('key', 'archive-key'));
    const wrong = run(c, place(startChapter(c), 440, 220), INTERACT).state;
    expect(wrong.game.taken).toEqual([4]);
    expect(types(pushSouth(c, wrong).events)).toContain('doorLocked');
  });

  it('the key is remembered: back in the room, the door is still open', () => {
    const c = chapter([item(3, 'file', 'archive-key', 200, 200)], southDoor('key', 'archive-key'));
    const inB = pushSouth(c, take(c, startChapter(c)).state).state;
    const back = run(c, place(inB, 320, 110), { move: { x: 0, y: -1 } }, 20).state;
    expect(back.run.roomId).toBe('lab/a');
    expect(selectDoorLocks(back.game)[0]!.open).toBe(true);
  });

  it('a key lock with no lockParam is sealed: it never opens and needs no link', () => {
    const sealed = room('lab/s', [southDoor('key')]).objects.find((o) => o.kind === 'Door')!;
    expect(mayOpen(sealed)).toBe(false);
    const keyed = room('lab/k', [southDoor('key', 'k'), item(3, 'file', 'k', 200, 200)]).objects.find((o) => o.kind === 'Door')!;
    expect(mayOpen(keyed)).toBe(true);
  });

  it('the parser wants the key in the room, unconditional and in the base layer', () => {
    const codes = (objects: object[], variants: object[] = []) => readRoom('t', mapOf(objects, variants), TAGS).problems.map((x) => [x.code, x.object]);
    expect(codes([southDoor('key', 'k')])).toEqual([['key-missing', 2]]);
    expect(codes([southDoor('key', 'k'), item(3, 'file', 'k', 200, 200, 'breakfast')])).toEqual([['key-conditional', 3]]);
    const variant = { type: 'objectgroup', name: 'variant:busy', properties: [p('when', 'deadline')], objects: [item(4, 'file', 'k', 200, 200)] };
    expect(codes([southDoor('key', 'k')], [variant])).toEqual([['key-conditional', 4]]);
    expect(codes([southDoor('key', 'k'), item(3, 'coffee', 'k', 200, 200)])).toEqual([]);
    expect(codes([southDoor('key')])).toEqual([]);
  });
});

describe('replay', () => {
  it('a walk that takes the key and goes through replays to the same hash', () => {
    const c = chapter([item(3, 'file', 'k', 200, 200)], southDoor('key', 'k'));
    const script: TickInput[] = [
      ...Array.from({ length: 40 }, () => ({ move: { x: -1, y: 0 } })),
      INTERACT, NONE,
      ...Array.from({ length: 40 }, () => ({ move: { x: 1, y: 0 } })),
      ...Array.from({ length: 120 }, () => ({ move: { x: 0, y: 1 } })),
    ];
    const play = () => script.reduce((s, input) => stepChapter(c, s, input).state, startChapter(c));
    const end = play();
    // The walk must really take the key, or the hash would only show that walking replays.
    expect(end.run.roomId).toBe('lab/b');
    expect(end.run.fired).toEqual(['lab/a#3']);
    expect(stateHash(end)).toBe(stateHash(play()));
  });
});
