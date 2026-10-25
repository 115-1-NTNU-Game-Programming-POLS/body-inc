import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOSSES, DIALOGUES, ENEMIES, PARAMS, TAGS } from '../../src/app/content.ts';
import { tagsFromQuery } from '../../src/app/session.ts';
import { bodyOverlapsSolid } from '../../src/core/collision/grid.ts';
import {
  advance, ChapterError, decode, encode, EMPTY_TAGS, NAP, OPERATOR_BODY, parseRoom, readContent, resumeChapter, selectInteractable,
  startChapter, startClock, stateHash, stepChapter, storyOf, STORY, touchedObjects, wholeMinutes,
  type ChapterContent, type ChapterState, type GameEvent, type TickInput, type TiledMap,
} from '../../src/core/index.ts';

const CHAPTER = readContent('chapter', JSON.parse(readFileSync('content/chapters/greybox.json', 'utf8')));
const GREY = 'greybox/greybox-room';
const REST = 'greybox/rest-room';
const CORRIDOR = 'greybox/brain-corridor';
const ARENA = 'greybox/caffeine-arena';

const load = (path: string) => parseRoom(path, JSON.parse(readFileSync(`public/assets/maps/${path}.tmj`, 'utf8')) as TiledMap, TAGS);
const ctx: ChapterContent = {
  chapter: CHAPTER,
  rooms: new Map([GREY, REST, CORRIDOR, ARENA].map((p) => [p, load(p)])),
  dialogues: DIALOGUES, dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS,
};

const tags = (q: string) => tagsFromQuery(`?tags=${q}`, TAGS);
const NONE: TickInput = { move: { x: 0, y: 0 } };
const types = (events: readonly GameEvent[]) => events.map((e) => e.type);

/** Puts the operator somewhere without telling the room it was already standing there. */
function place(s: ChapterState, x: number, y: number): ChapterState {
  return { ...s, game: { ...s.game, touching: [], operator: { ...s.game.operator, x, y } } };
}

/** One step, or `n` steps of the same input, collecting every event. */
function advanceBy(c: ChapterContent, s: ChapterState, input: TickInput, n = 1): { state: ChapterState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    const r = stepChapter(c, s, input);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

/** Walks straight at a point (the rooms used are open floor), stopping early when `until` holds. */
function walkTo(c: ChapterContent, s: ChapterState, x: number, y: number, until: (e: GameEvent) => boolean = () => false) {
  const events: GameEvent[] = [];
  for (let i = 0; i < 900; i++) {
    const dx = x - s.game.operator.x;
    const dy = y - s.game.operator.y;
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return { state: s, events };
    const r = stepChapter(c, s, { move: { x: Math.abs(dx) < 4 ? 0 : Math.sign(dx), y: Math.abs(dy) < 4 ? 0 : Math.sign(dy) } });
    s = r.state;
    events.push(...r.events);
    if (r.events.some(until)) return { state: s, events };
  }
  throw new Error(`did not reach (${x}, ${y}); stopped at (${s.game.operator.x}, ${s.game.operator.y})`);
}
const changed = (e: GameEvent) => e.type === 'roomChanged';

/** Reads the open conversation to its end, confirming on every other tick (each press needs a fresh edge). */
function finishTalk(c: ChapterContent, s: ChapterState): ChapterState {
  for (let i = 0; s.dialogue; i++) {
    if (i > 2000) throw new Error('the conversation did not end');
    s = stepChapter(c, s, i % 2 === 0 ? { move: { x: 0, y: 0 }, interactPressed: true } : NONE).state;
  }
  return s;
}

/** A bare open room of the given Tiled objects, for rules the greybox rooms do not exercise. */
function labRoom(path: string, objects: object[]) {
  const map = {
    width: 20, height: 12, tilewidth: 32, tileheight: 32,
    properties: [{ name: 'organ', value: 'lobby' }, { name: 'role', value: 'rest' }, { name: 'estSeconds', value: 10 }],
    layers: [
      { type: 'tilelayer', name: 'walls', data: new Array(240).fill(0) },
      { type: 'objectgroup', name: 'objects', objects: [{ id: 1, type: 'PlayerStart', x: 100, y: 100 }, ...objects] },
    ],
  } as unknown as TiledMap;
  return parseRoom(path, map, TAGS);
}
function lab(objects: object[], extra: Partial<ChapterContent> = {}): ChapterContent {
  return {
    ...ctx, chapter: { version: 1, id: 'lab', start: 'lab/room', links: [] }, rooms: new Map([['lab/room', labRoom('lab/room', objects)]]), ...extra,
  };
}
const p = (name: string, value: string | number | boolean) => ({ name, value });
const southDoor = { id: 2, type: 'Door', name: 'door-s', x: 288, y: 352, width: 64, height: 32, properties: [p('socket', 'S')] };
const northDoor = { id: 2, type: 'Door', name: 'door-n', x: 288, y: 0, width: 64, height: 96, properties: [p('socket', 'N')] };

/** Two rooms joined south of `a` to north of `b`, with `inA` standing beside the south door. */
function pair(inA: object[]): ChapterContent {
  return {
    ...ctx,
    chapter: { version: 1, id: 'lab', start: 'lab/a', links: [{ a: 'lab/a#door-s', b: 'lab/b#door-n' }] },
    rooms: new Map([['lab/a', labRoom('lab/a', [southDoor, ...inA])], ['lab/b', labRoom('lab/b', [northDoor])]]),
  };
}

describe('walking through doors', () => {
  it('opens in the start room at its PlayerStart', () => {
    const s = startChapter(ctx);
    expect(s.run.roomId).toBe(GREY);
    expect(s.game.operator).toMatchObject({ x: 320, y: 256 });
  });

  it('a door leads to the room the chapter file names, and the arrival is not inside a wall', () => {
    const { state, events } = walkTo(ctx, startChapter(ctx), 320, 366, changed);
    expect(types(events)).toContain('doorEntered');
    expect(events).toContainEqual({ type: 'roomChanged', from: GREY, to: REST });
    expect(state.run.roomId).toBe(REST);
    expect(state.game.room.id).toBe(REST);
    expect(bodyOverlapsSolid(state.game.room.grid, OPERATOR_BODY, state.game.operator.x, state.game.operator.y)).toBe(false);
    // Through the south door of one room, in at the north door of the next.
    expect(state.game.operator.y).toBeGreaterThan(96);
    // Arriving clear of the door box, so the way back is a deliberate step and not an instant bounce.
    expect(state.game.touching).toEqual([]);
    expect(types(advanceBy(ctx, state, NONE, 30).events)).toEqual([]);
  });

  it('the way back leads to where you came from', () => {
    const there = walkTo(ctx, startChapter(ctx), 320, 366, changed).state;
    const back = walkTo(ctx, there, 320, 10, changed).state;
    expect(back.run.roomId).toBe(GREY);
    expect(back.game.operator.y).toBeLessThan(352);
  });

  it('every door in the greybox chapter lands somewhere walkable', () => {
    for (const link of CHAPTER.links) {
      for (const [from, to] of [[link.a, link.b], [link.b, link.a]] as const) {
        const [room, door] = from.split('#') as [string, string];
        const o = ctx.rooms.get(room)!.objects.find((x) => x.name === door)!;
        const start = place({ ...startChapter(ctx, { room }) }, o.x + o.width / 2, o.y + o.height / 2);
        const { state } = advanceBy(ctx, start, NONE);
        expect(state.run.roomId, `${from} -> ${to}`).toBe(to.split('#')[0]);
        expect(bodyOverlapsSolid(state.game.room.grid, OPERATOR_BODY, state.game.operator.x, state.game.operator.y)).toBe(false);
      }
    }
  });

  it('hearts, the rejection gauge, the clock and the clinging stacks all go through', () => {
    let s = startChapter(ctx, { gauge: 40, halves: 7 });
    const adenosine = s.game.enemies.find((e) => e.type === 'adenosine')!;
    s = {
      ...s,
      game: {
        ...s.game, clock: advance(s.game.clock, 95),
        enemies: s.game.enemies.map((e) => (e.id === adenosine.id ? { ...e, phase: 'attached' as const } : e)),
        operator: { ...s.game.operator, stacks: 1 },
      },
    };
    const clock = s.game.clock;
    const next = walkTo(ctx, s, 320, 366, changed).state;
    expect(next.game.operator).toMatchObject({ halves: 7, gauge: 40, stacks: 1 });
    expect(next.game.carried).toBe(1);
    expect(next.game.enemies.filter((e) => e.phase === 'attached')).toEqual([]);
    expect(next.game.clock).toEqual(clock);
  });

  it('a door is not a way to shake off adenosine: only a nap in the next room does', () => {
    const rest = startChapter(ctx, { room: REST });
    const carrying: ChapterState = { ...rest, game: { ...rest.game, carried: 2, operator: { ...rest.game.operator, stacks: 2 } } };
    const bed = ctx.rooms.get(REST)!.objects.find((o) => o.kind === 'Bed' && o.props['bedType'] === 'nap')!;
    const out = walkTo(ctx, place(carrying, 320, 140), 625, 224, changed).state;
    expect(out.run.roomId).toBe(CORRIDOR);
    expect(out.game.operator.stacks).toBe(2);
    const back = walkTo(ctx, out, 10, 224, changed).state;
    expect(back.run.roomId).toBe(REST);
    expect(back.game.operator.stacks).toBe(2);
    const slept = advanceBy(ctx, place(back, bed.x + bed.width / 2, bed.y + bed.height + 8), { move: { x: 0, y: 0 }, interactPressed: true });
    expect(types(slept.events)).toContain('napped');
    expect(slept.state.game.operator.stacks).toBe(0);
  });

  it('a locked door does not open, and says so once per touch', () => {
    const s = place(startChapter(ctx), 100, 224);
    const { state, events } = advanceBy(ctx, s, { move: { x: -1, y: 0 } }, 90);
    expect(state.run.roomId).toBe(GREY);
    expect(events.filter((e) => e.type === 'doorLocked')).toEqual([{ type: 'doorLocked', object: 4, lock: 'key' }]);
  });

  it('an unlocked door the chapter file does not link is a bug the map check should have caught', () => {
    const unlinked = { ...ctx, chapter: { ...CHAPTER, links: [] } };
    expect(() => walkTo(unlinked, startChapter(unlinked), 320, 366, changed)).toThrow(ChapterError);
  });
});

describe('triggers', () => {
  const trigger = (id: number, event: string, eventId: string, more: object[] = []) =>
    ({ id, type: 'Trigger', x: 200, y: 150, width: 64, height: 64, properties: [p('event', event), p('eventId', eventId), ...more] });

  it('fires when stepped onto, once, and a clock_advance moves the clock', () => {
    const c = lab([trigger(2, 'clock_advance', '30')]);
    const s0 = startChapter(c);
    const first = advanceBy(c, place(s0, 220, 190), NONE);
    expect(first.events).toContainEqual({ type: 'clockAdvanced', minutes: 30 });
    expect(first.state.game.clock.minute).toBe(s0.game.clock.minute + 30);
    expect(first.state.run.fired).toEqual(['lab/room#2']);
    // Standing there does nothing more; stepping off and on again is blocked by `once`.
    expect(types(advanceBy(c, first.state, NONE, 30).events)).toEqual([]);
    const again = advanceBy(c, place(first.state, 220, 190), NONE);
    expect(types(again.events)).not.toContain('clockAdvanced');
    expect(again.state.game.clock.minute).toBe(first.state.game.clock.minute);
  });

  it('a trigger that is not once fires on every visit', () => {
    const c = lab([trigger(2, 'clock_advance', '10', [p('once', false)])]);
    let s = startChapter(c);
    for (let i = 0; i < 3; i++) s = advanceBy(c, place(s, 220, 190), NONE).state;
    expect(s.game.clock.minute).toBe(startChapter(c).game.clock.minute + 30);
  });

  it('respects its own when condition', () => {
    const c = lab([trigger(2, 'clock_advance', '30', [p('when', 'caffeine>=25')])]);
    const none = advanceBy(c, place(startChapter(c), 220, 190), NONE);
    expect(types(none.events)).not.toContain('clockAdvanced');
    const high = advanceBy(c, place(startChapter(c, { tags: tags('caffeine:50') }), 220, 190), NONE);
    expect(types(high.events)).toContain('clockAdvanced');
  });

  it('a bad clock_advance amount is a content bug, not a silent zero', () => {
    for (const bad of ['soon', '', ' ', '1e1', '0x10', '-5', '1.5', '12345']) {
      const c = lab([trigger(2, 'clock_advance', bad)]);
      expect(() => advanceBy(c, place(startChapter(c), 220, 190), NONE), `"${bad}"`).toThrow(/whole minutes/);
    }
  });

  it('only plain whole minutes are minutes', () => {
    expect(['0', '20', '480', '9999'].map(wholeMinutes)).toEqual([0, 20, 480, 9999]);
    expect(['', ' ', '1e1', '0x10', '+5', '2 0', 'twenty'].map(wholeMinutes)).toEqual(new Array(7).fill(undefined));
  });

  it('dialogue triggers open the dialogue, and card and cutscene triggers are handed to the outer layer', () => {
    const c = lab([trigger(2, 'dialogue', 'greybox.liver.hello'), trigger(3, 'card', 'sleep_time', [p('once', false)])]);
    const r = advanceBy(c, place(startChapter(c), 220, 190), NONE);
    expect(r.events).toContainEqual({ type: 'dialogueOpened', dialogueId: 'greybox.liver.hello' });
    expect(r.events).toContainEqual({ type: 'outerRequested', kind: 'card', eventId: 'sleep_time' });
  });
});

describe('beds', () => {
  const nap = { id: 2, type: 'Bed', x: 200, y: 150, width: 64, height: 32, properties: [p('bedType', 'nap')] };
  const sleep = (requires: string) => ({ id: 3, type: 'Bed', x: 400, y: 150, width: 64, height: 32, properties: [p('bedType', 'sleep'), p('requires', requires)] });
  const PRESS: TickInput = { move: { x: 0, y: 0 }, interactPressed: true };

  it('a nap takes 20 minutes, sends the clinging stacks home, and works once per bed', () => {
    const c = lab([nap, { id: 5, type: 'Spawn', x: 300, y: 300, properties: [p('enemyType', 'adenosine')] }]);
    let s = startChapter(c);
    const a = s.game.enemies.find((e) => e.type === 'adenosine')!;
    s = {
      ...place(s, 230, 175),
      game: {
        ...place(s, 230, 175).game,
        enemies: s.game.enemies.map((e) => (e.id === a.id ? { ...e, x: 230, y: 175, phase: 'attached' as const } : e)),
      },
    };
    s = { ...s, game: { ...s.game, operator: { ...s.game.operator, stacks: 1 } } };
    const start = s.game.clock.minute;
    const first = advanceBy(c, s, PRESS);
    expect(first.events).toContainEqual({ type: 'napped', minutes: NAP.minutes });
    expect(first.state.game.clock.minute).toBe(start + NAP.minutes);
    expect(first.state.game.operator.stacks).toBe(0);
    expect(first.state.game.enemies.find((e) => e.id === a.id)).toMatchObject({ phase: 'dispersed', x: a.homeX, y: a.homeY });
    const second = advanceBy(c, first.state, PRESS);
    expect(second.events).toContainEqual({ type: 'bedRefused', object: 2, bedType: 'nap' });
    expect(second.state.game.clock.minute).toBe(first.state.game.clock.minute);
  });

  it('a sleep bed ends the chapter only when its requirement holds', () => {
    const c = lab([sleep('caffeine<15')]);
    const near = (s: ChapterState) => place(s, 430, 175);
    const wired = advanceBy(c, near(startChapter(c, { tags: tags('caffeine:50') })), PRESS);
    expect(wired.events).toContainEqual({ type: 'bedRefused', object: 3, bedType: 'sleep' });
    expect(types(wired.events)).not.toContain('chapterEnded');
    const rested = advanceBy(c, near(startChapter(c, { tags: tags('caffeine:10') })), PRESS);
    expect(types(rested.events)).toContain('chapterEnded');
    expect(types(advanceBy(c, near(startChapter(c)), PRESS).events)).toContain('chapterEnded');
  });

  it('nothing happens out of reach, and the prompt selector agrees with the key', () => {
    const c = lab([nap]);
    const far = place(startChapter(c), 400, 300);
    expect(selectInteractable(far.game)).toBeUndefined();
    expect(types(advanceBy(c, far, PRESS).events)).toEqual([]);
    const close = place(startChapter(c), 230, 175);
    expect(selectInteractable(close.game)).toEqual({ object: 2, kind: 'Bed' });
    expect(types(advanceBy(c, close, PRESS).events)).toContain('napped');
  });

  it('the key is ignored in the middle of a dodge', () => {
    const c = lab([nap]);
    const s = place(startChapter(c), 230, 175);
    const dodging = { ...s, game: { ...s.game, operator: { ...s.game.operator, action: { kind: 'dodge' as const, frame: 3, dir: { x: 1, y: 0 }, perfect: false } } } };
    expect(types(advanceBy(c, dodging, PRESS).events)).not.toContain('napped');
  });
});

describe('talking', () => {
  it('an NPC in reach opens its dialogue when the key is pressed', () => {
    const s = place(startChapter(ctx, { room: REST }), 320, 240);
    expect(selectInteractable(s.game)).toEqual({ object: 7, kind: 'NPC' });
    const r = advanceBy(ctx, s, { move: { x: 0, y: 0 }, interactPressed: true });
    expect(r.events).toContainEqual({ type: 'talk', object: 7, npc: 'liver', dialogueId: 'greybox.liver.hello' });
    expect(r.events).toContainEqual({ type: 'dialogueOpened', dialogueId: 'greybox.liver.hello' });
  });

  it('is silent when the key is not pressed or the NPC is too far', () => {
    expect(types(advanceBy(ctx, place(startChapter(ctx, { room: REST }), 320, 240), NONE).events)).toEqual([]);
    expect(types(advanceBy(ctx, place(startChapter(ctx, { room: REST }), 320, 300), { move: { x: 0, y: 0 }, interactPressed: true }).events)).toEqual([]);
  });
});

describe('checkpoints and forced leave', () => {
  const clock = (s: ChapterState) => place(s, 128, 230);

  it('the time clock saves where it is, restores the hearts, and can be punched again', () => {
    let s = startChapter(ctx, { room: REST, halves: 3 });
    const r = advanceBy(ctx, clock(s), NONE);
    expect(r.events).toContainEqual({ type: 'checkpointSaved', room: REST });
    expect(r.state.run.checkpoint).toMatchObject({ roomId: REST, x: 128, y: 230, chapter: 'greybox' });
    expect(r.state.game.operator.halves).toBe(r.state.game.operator.maxHalves);
    s = place(r.state, 130, 300);
    const later = advanceBy(ctx, { ...place(s, 140, 240), game: { ...s.game, touching: [], operator: { ...s.game.operator, x: 140, y: 240 } } }, NONE);
    expect(later.state.run.checkpoint).toMatchObject({ x: 140, y: 240 });
  });

  it('a forced leave goes back to the checkpoint: its room, place, tags and clock, with hearts full and fired kept', () => {
    const saved = advanceBy(ctx, clock(startChapter(ctx, { room: REST, tags: tags('sleep_debt:1') })), NONE).state;
    // Leave the room, then spend a one-time thing and change the outer state, then get knocked out.
    let s = walkTo(ctx, place(saved, 600, 224), 624, 224, changed).state;
    expect(s.run.roomId).toBe(CORRIDOR);
    s = {
      ...s,
      run: { ...s.run, tags: tags('sleep_debt:6'), fired: [...s.run.fired, 'greybox/brain-corridor#99'] },
      game: { ...s.game, clock: advance(s.game.clock, 240), operator: { ...s.game.operator, halves: 0, gauge: 55 } },
    };
    const r = advanceBy(ctx, s, NONE);
    expect(r.events).toContainEqual({ type: 'returnedToCheckpoint', room: REST });
    expect(r.state.run.roomId).toBe(REST);
    expect(r.state.game.operator).toMatchObject({ x: 128, y: 230, halves: 12, gauge: 55 });
    expect(r.state.game.clock).toEqual(saved.run.checkpoint!.clock);
    expect(r.state.run.tags).toEqual(saved.run.checkpoint!.tags);
    expect(r.state.run.fired).toContain('greybox/brain-corridor#99');
    // Coming back onto the time clock is not punching it again.
    expect(types(advanceBy(ctx, r.state, NONE, 5).events)).toEqual([]);
  });

  it('without a checkpoint the room simply restarts', () => {
    const s0 = startChapter(ctx);
    const s = { ...s0, game: { ...s0.game, operator: { ...s0.game.operator, x: 80, y: 80, halves: 0 } } };
    const r = advanceBy(ctx, s, NONE);
    expect(types(r.events)).toContain('forcedLeave');
    expect(r.state.run.roomId).toBe(GREY);
    expect(r.state.game.operator).toMatchObject({ x: 320, y: 256, halves: 12 });
  });

  it('a saved checkpoint survives the story slot and resumes with full hearts', () => {
    const saved = advanceBy(ctx, clock(startChapter(ctx, { room: REST, tags: tags('sleep_debt:3,caffeine:20,breakfast') })), NONE).state;
    const stored = encode(STORY, storyOf(saved.run));
    const back = decode(STORY, stored);
    expect(back.kind).toBe('ok');
    expect(back.data).toEqual(storyOf(saved.run));
    const resumed = resumeChapter(ctx, back.data.checkpoint!);
    expect(resumed.run.roomId).toBe(REST);
    expect(resumed.game.operator).toMatchObject({ x: 128, y: 230, halves: 12, gauge: 0 });
    expect(resumed.run.tags).toEqual(saved.run.checkpoint!.tags);
    expect(resumed.game.clock).toEqual(saved.run.checkpoint!.clock);
  });

  it('a story slot with a broken checkpoint falls back to no checkpoint', () => {
    const bad = JSON.stringify({ schema: 1, data: { checkpoint: { chapter: 'greybox', roomId: REST, x: 'left', y: 0, tags: { values: {}, log: { nodes: [] } }, clock: { day: 1, minute: 0 }, fired: [] } } });
    expect(decode(STORY, bad).kind).toBe('invalid');
    expect(decode(STORY, bad).data).toEqual({ checkpoint: null });
  });

  it('refuses a checkpoint from another chapter', () => {
    const saved = advanceBy(ctx, clock(startChapter(ctx, { room: REST })), NONE).state.run.checkpoint!;
    expect(() => resumeChapter(ctx, { ...saved, chapter: 'brain' })).toThrow(ChapterError);
  });
});

describe('retries and events on the same tick', () => {
  const PRESS: TickInput = { move: { x: 0, y: 0 }, interactPressed: true };
  const punch = (room = REST) => advanceBy(ctx, place(startChapter(ctx, { room }), 128, 230), NONE).state;
  const dying = (s: ChapterState): ChapterState => ({ ...s, game: { ...s.game, operator: { ...s.game.operator, halves: 0 } } });
  const napBed = ctx.rooms.get(REST)!.objects.find((o) => o.kind === 'Bed' && o.props['bedType'] === 'nap')!;
  const bedKey = `${REST}#${napBed.id}`;
  const onBed = (s: ChapterState) => place(s, 128, 310);

  it('dying on the tick a door is touched is a forced leave, not a trip through the door', () => {
    const door = ctx.rooms.get(REST)!.objects.find((o) => o.name === 'door-n')!;
    const r = advanceBy(ctx, dying(place(punch(), door.x + door.width / 2, door.y + door.height / 2)), NONE);
    expect(types(r.events)).toEqual(expect.arrayContaining(['forcedLeave', 'returnedToCheckpoint']));
    expect(types(r.events)).not.toContain('doorEntered');
    expect(types(r.events)).not.toContain('roomChanged');
    expect(r.state.run.roomId).toBe(REST);
    expect(r.state.game.operator).toMatchObject({ x: 128, y: 230, halves: 12 });
  });

  it('dying on the tick the time clock is touched does not save the spot the operator was reset to', () => {
    const r = advanceBy(ctx, dying(place(startChapter(ctx, { room: REST }), 128, 230)), NONE);
    expect(types(r.events)).toContain('forcedLeave');
    expect(types(r.events)).not.toContain('checkpointSaved');
    expect(r.state.run.checkpoint).toBeNull();
  });

  it('a trigger or the time clock touched on the same tick as a door still counts in the room being left', () => {
    const beside = (event: string, eventId: string) => ({ id: 3, type: 'Trigger', x: 288, y: 336, width: 64, height: 40, properties: [p('event', event), p('eventId', eventId)] });
    const advancing = pair([beside('clock_advance', '30')]);
    const s0 = startChapter(advancing);
    const a = advanceBy(advancing, place(s0, 320, 368), NONE);
    expect(types(a.events)).toEqual(expect.arrayContaining(['doorEntered', 'clockAdvanced', 'roomChanged']));
    expect(a.state.run.roomId).toBe('lab/b');
    expect(a.state.game.clock.minute).toBe(s0.game.clock.minute + 30);
    expect(a.state.run.fired).toEqual(['lab/a#3']);
    const punching = pair([beside('checkpoint', '')]);
    const b = advanceBy(punching, place(startChapter(punching), 320, 368), NONE);
    expect(b.state.run.roomId).toBe('lab/b');
    expect(b.state.run.checkpoint).toMatchObject({ roomId: 'lab/a', x: 320, y: 368 });
  });

  it('a retry from the time clock brings the adenosine back with the operator, and sleep clears it', () => {
    const cp = punch().run.checkpoint!;
    const s0 = startChapter(ctx);
    const adenosine = s0.game.enemies.find((e) => e.type === 'adenosine')!;
    const clinging: ChapterState = {
      ...s0,
      run: { ...s0.run, checkpoint: cp },
      game: {
        ...s0.game,
        enemies: s0.game.enemies.map((e) => (e.id === adenosine.id ? { ...e, phase: 'attached' as const } : e)),
        operator: { ...s0.game.operator, stacks: 1, halves: 0 },
      },
    };
    const back = advanceBy(ctx, clinging, NONE);
    expect(back.events).toContainEqual({ type: 'returnedToCheckpoint', room: REST });
    expect(back.state.game.operator.stacks).toBe(1);
    expect(back.state.game.carried).toBe(1);
    const slept = advanceBy(ctx, onBed(back.state), PRESS);
    expect(types(slept.events)).toContain('napped');
    expect(slept.state.game.operator.stacks).toBe(0);
    expect(slept.state.game.carried).toBe(0);
  });

  it('a nap taken after the punch is undone with the clock, so its bed can be used again', () => {
    const punched = punch();
    const napped = advanceBy(ctx, onBed(punched), PRESS).state;
    expect(napped.game.clock.minute).toBe(punched.game.clock.minute + NAP.minutes);
    expect(napped.run.fired).toEqual([bedKey]);
    const back = advanceBy(ctx, dying(napped), NONE).state;
    expect(back.game.clock).toEqual(punched.run.checkpoint!.clock);
    expect(back.run.fired).toEqual([]);
    expect(types(advanceBy(ctx, onBed(back), PRESS).events)).toContain('napped');
  });

  it('a nap taken before the punch stays spent, and so does a switch thrown after it', () => {
    const napped = advanceBy(ctx, onBed(startChapter(ctx, { room: REST })), PRESS).state;
    const punched = advanceBy(ctx, place(napped, 128, 230), NONE).state;
    const thrown = { ...punched, run: { ...punched.run, fired: [...punched.run.fired, 'greybox/brain-corridor#99'] } };
    const back = advanceBy(ctx, dying(thrown), NONE).state;
    expect(back.run.fired).toEqual([bedKey, 'greybox/brain-corridor#99']);
    expect(types(advanceBy(ctx, onBed(back), PRESS).events)).toContain('bedRefused');
  });

  it('door and trigger lookups follow the room, not a remembered one', () => {
    const trigger = { id: 2, type: 'Trigger', x: 200, y: 150, width: 64, height: 64, properties: [p('event', 'dialogue'), p('eventId', 'x')] };
    const withIt = labRoom('lab/a', [trigger]);
    const without = labRoom('lab/b', []);
    const box = { left: 220, right: 240, top: 170, bottom: 190 };
    expect(touchedObjects(without, box)).toEqual([]);
    for (let i = 0; i < 3; i++) expect(touchedObjects(withIt, box).map((o) => o.id)).toEqual([2]);
    expect(touchedObjects(without, box)).toEqual([]);
  });
});

describe('a whole walk through the chapter replays exactly', () => {
  const PRESS: TickInput = { move: { x: 0, y: 0 }, interactPressed: true };

  /**
   * Grey room to rest room, punch in, nap, talk, then on into the corridor. A room restarts the
   * tick counter, so what a walk leaves behind is the run: the checkpoint, the clock, what was used.
   */
  function walk(napToo = true): ChapterState {
    let s = startChapter(ctx, { tags: EMPTY_TAGS });
    s = walkTo(ctx, s, 320, 366, changed).state;
    s = walkTo(ctx, s, 128, 230).state;
    s = advanceBy(ctx, s, NONE, 5).state;
    if (napToo) {
      s = walkTo(ctx, s, 128, 330).state;
      s = advanceBy(ctx, s, PRESS).state;
    }
    s = walkTo(ctx, s, 320, 232).state;
    s = advanceBy(ctx, s, PRESS).state;
    s = finishTalk(ctx, s);
    return walkTo(ctx, s, 625, 224, changed).state;
  }

  it('visits the rest room, the corridor and, if walked on, the arena', () => {
    const s = walk();
    expect(s.run.roomId).toBe(CORRIDOR);
    expect(s.run.checkpoint?.roomId).toBe(REST);
    expect(s.run.fired).toHaveLength(1);
    const arena = walkTo(ctx, s, 625, 224, changed).state;
    expect(arena.run.roomId).toBe(ARENA);
  });

  it('the same walk gives the same hash, and a different one a different hash', () => {
    expect(stateHash(walk())).toBe(stateHash(walk()));
    expect(stateHash(walk(false))).not.toBe(stateHash(walk()));
  });

  it('the hash covers the run as well as the room', () => {
    const s = walk();
    expect(stateHash({ ...s, run: { ...s.run, fired: [] } })).not.toBe(stateHash(s));
  });
});

describe('startClock helper is the default', () => {
  it('a new game starts at 08:00 on day 1', () => {
    expect(startChapter(ctx).game.clock).toEqual(startClock(1, 8));
  });
});
