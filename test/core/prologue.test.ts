import { describe, expect, it } from 'vitest';
import { BOSSES, DIALOGUES, ENEMIES, PARAMS, TAGS } from '../../src/app/content.ts';
import {
  answeredCards, bedAfter, decode, EMPTY_TAGS, encode, GLUCOSE, glucoseOf, loadDialogueTable, openingFor, OuterError, parseRoom, playCards,
  PUSH, readDeck, resumeChapter, selectPort, setAmount, setFlag, STAMP, startChapter, stepChapter, stepGlucose, STORY, toolsAtStart,
  record, type ChapterContent, type ChapterFile, type ChapterState, type Checkpoint, type DialogueTable, type GameEvent, type TagState, type TickInput, type TiledMap,
} from '../../src/core/index.ts';

/**
 * Package 4: the mechanisms the prologue needs (design doc 7.3). Rooms are bare 20 x 12 floors
 * built from Tiled objects, as in boxes.test.ts.
 */

const p = (name: string, value: string | number | boolean) => ({ name, value });
const NONE: TickInput = { move: { x: 0, y: 0 } };
const RIGHT: TickInput = { move: { x: 1, y: 0 } };
const LEFT: TickInput = { move: { x: -1, y: 0 } };
const types = (events: readonly GameEvent[]) => events.map((e) => e.type);

/** Tags with one change made, logged under a test source as the store demands. */
function tagged(tags: TagState, change: (t: TagState, cause: number) => TagState): TagState {
  const [log, cause] = record(tags.log, { kind: 'rule', key: 'test', at: 0 });
  return change({ ...tags, log }, cause);
}

const mapOf = (objects: object[]) => ({
  width: 20, height: 12, tilewidth: 32, tileheight: 32,
  properties: [p('organ', 'lobby'), p('role', 'puzzle'), p('estSeconds', 10)],
  layers: [
    { type: 'tilelayer', name: 'walls', data: new Array(240).fill(0) },
    { type: 'objectgroup', name: 'objects', objects: [{ id: 1, type: 'PlayerStart', x: 64, y: 360 }, ...objects] },
  ],
}) as unknown as TiledMap;

const box = (id: number, col: number, row: number) => ({ id, type: 'Box', x: col * 32 + 16, y: row * 32 + 16, properties: [] });
const port = (id: number, col: number, row: number, need: number, target: number, dialogueId = '') => ({
  id, type: 'Port', x: col * 32, y: row * 32, width: 32, height: 32,
  properties: [p('need', need), p('target', target), ...(dialogueId ? [p('dialogueId', dialogueId)] : [])],
});
const switchDoor = { id: 2, type: 'Door', name: 'door-s', x: 288, y: 352, width: 64, height: 32, properties: [p('socket', 'S'), p('lock', 'switch')] };
const northDoor = { id: 2, type: 'Door', name: 'door-n', x: 288, y: 0, width: 64, height: 96, properties: [p('socket', 'N')] };
const timeClock = { id: 9, type: 'Trigger', x: 32, y: 96, width: 32, height: 32, properties: [p('event', 'checkpoint')] };
const trigger = (id: number, event: string, extra: object[] = []) =>
  ({ id, type: 'Trigger', x: 448, y: 192, width: 32, height: 64, properties: [p('event', event), ...extra] });

const TALK = loadDialogueTable([{
  file: 'lab.csv',
  text: [
    'dialogueId,order,speaker,expression,text,condition,effect,next,fact',
    'lab.port,1,liver,memo,已處理。,,,,',
    'lab.grant,1,brain,normal,這個借你。,,grant:stamp,,',
    'lab.hello,1,brain,normal,早。,,,,',
  ].join('\n') + '\n',
}], TAGS);

function chapter(objects: object[], extra: Partial<ChapterFile> = {}, dialogues: DialogueTable = TALK): ChapterContent {
  return {
    chapter: { version: 1, id: 'lab', start: 'lab/a', links: [{ a: 'lab/a#door-s', b: 'lab/b#door-n' }], ...extra },
    rooms: new Map([['lab/a', parseRoom('lab/a', mapOf(objects), TAGS)], ['lab/b', parseRoom('lab/b', mapOf([northDoor]), TAGS)]]),
    dialogues, dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS,
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
  ({ ...s, game: { ...s.game, touching: [], operator: { ...s.game.operator, x, y, vx: 0, vy: 0 } } });
/** Feet in row 6, just left of tile column 10. */
const leftOf10 = (s: ChapterState) => place(s, 300, 215);

/** Pushes the box at (10, 6) one tile east and lets it come to rest. */
function pushEast(c: ChapterContent, s: ChapterState): { state: ChapterState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  s = leftOf10(s);
  for (let n = 0; n < 200 && !events.some((e) => e.type === 'boxMoved'); n++) {
    const r = stepChapter(c, s, RIGHT);
    s = r.state;
    events.push(...r.events);
  }
  const rested = run(c, s, NONE, PUSH.slideTicks + 2);
  return { state: rested.state, events: [...events, ...rested.events] };
}

describe('the dispatch port', () => {
  it('takes in a box that comes to rest on it, and once it holds its need it opens the door it aims at', () => {
    const c = chapter([switchDoor, box(3, 10, 6), port(4, 11, 6, 1, 2)]);
    const s0 = startChapter(c);
    expect(s0.game.doorsOpen).not.toContain(2);
    const { state, events } = pushEast(c, s0);
    expect(events).toContainEqual({ type: 'boxDelivered', object: 3, port: 4, count: 1, need: 1 });
    expect(events).toContainEqual({ type: 'portFilled', object: 4 });
    expect(state.game.boxes).toEqual([]);
    expect(state.game.switches).toContain(4);
    expect(state.game.doorsOpen).toContain(2);
    expect(selectPort(state.game)).toEqual({ object: 4, count: 1, need: 1 });
    // Spent like a pickup, and no longer a box the room has to place.
    expect(state.run.fired).toContain('lab/a#3');
    expect(state.run.boxes.map((b) => b.key)).not.toContain('lab/a#3');
  });

  it('takes a box in only once it has come to rest, not while it is still sliding onto the port', () => {
    const c = chapter([switchDoor, box(3, 10, 6), port(4, 11, 6, 1, 2)]);
    let s = leftOf10(startChapter(c));
    while (!types(stepChapter(c, s, RIGHT).events).includes('boxMoved')) s = stepChapter(c, s, RIGHT).state;
    s = stepChapter(c, s, RIGHT).state;
    const sliding = run(c, s, NONE, PUSH.slideTicks - 2);
    expect(types(sliding.events)).not.toContain('boxDelivered');
    expect(sliding.state.game.boxes.map((b) => b.id)).toEqual([3]);
    expect(types(run(c, sliding.state, NONE, 4).events)).toContain('boxDelivered');
  });

  it('is not filled until the last box it needs arrives', () => {
    const c = chapter([switchDoor, box(3, 10, 6), box(5, 4, 9), port(4, 11, 6, 2, 2)]);
    const { state, events } = pushEast(c, startChapter(c));
    expect(types(events)).toContain('boxDelivered');
    expect(types(events)).not.toContain('portFilled');
    expect(state.game.doorsOpen).not.toContain(2);
    expect(state.game.boxes.map((b) => b.id)).toEqual([5]);
  });

  it('a delivery outlives the room: on a later entry the box stays gone and the door open', () => {
    const c = chapter([switchDoor, box(3, 10, 6), port(4, 11, 6, 1, 2), timeClock]);
    const s0 = startChapter(c);
    const cp: Checkpoint = {
      chapter: 'lab', roomId: 'lab/a', x: 320, y: 200, tags: s0.run.tags, clock: s0.game.clock, fired: ['lab/a#3'], switches: [], boxes: [], tools: ['stamp'],
    };
    const back = resumeChapter(c, cp);
    expect(back.game.boxes).toEqual([]);
    expect(back.game.delivered).toEqual([3]);
    expect(back.game.doorsOpen).toContain(2);
    // The control: without the delivery the box is home and the door shut.
    const fresh = resumeChapter(c, { ...cp, fired: [] });
    expect(fresh.game.boxes.map((b) => b.id)).toEqual([3]);
    expect(fresh.game.doorsOpen).not.toContain(2);
  });

  it('opens its conversation once it fills, and only then', () => {
    const c = chapter([switchDoor, box(3, 10, 6), box(5, 4, 9), port(4, 11, 6, 1, 2, 'lab.port')]);
    const { state, events } = pushEast(c, startChapter(c));
    expect(events).toContainEqual({ type: 'dialogueOpened', dialogueId: 'lab.port' });
    expect(state.dialogue?.id).toBe('lab.port');
    const none = chapter([switchDoor, box(3, 10, 6), port(4, 11, 6, 1, 2)]);
    expect(pushEast(none, startChapter(none)).state.dialogue).toBeNull();
  });
});

describe('blood glucose (design doc 7.3)', () => {
  const sugary = () => chapter([], { glucose: true });

  it('a chapter with the meter opens at the morning value, logged as its premise; one without has none', () => {
    const s = startChapter(sugary());
    expect(glucoseOf(s.run.tags)).toBe(GLUCOSE.start);
    expect(s.run.tags.log.nodes.map((n) => n.key)).toContain('glucose.morning');
    expect(glucoseOf(startChapter(chapter([])).run.tags)).toBeUndefined();
  });

  it('drains one point per 3 seconds of walking, and nothing while standing still', () => {
    const c = sugary();
    const s0 = place(startChapter(c), 320, 220);
    expect(glucoseOf(run(c, s0, NONE, 10 * 60).state.run.tags)).toBe(GLUCOSE.start);
    // Back and forth across the floor, so the operator never stops against a wall.
    let s = s0;
    for (let i = 0; i < 4; i++) s = run(c, run(c, s, RIGHT, 60).state, LEFT, 60).state;
    expect(glucoseOf(s.run.tags)).toBe(GLUCOSE.start - 2);
  });

  it('below the band the liver tops it up to 45, logged as its doing', () => {
    let tags = tagged(EMPTY_TAGS, (t, c) => setAmount(t, TAGS, 'glucose', 40, c, 0));
    const r = stepGlucose(TAGS, tags, GLUCOSE.drainTicks - 1, true, 480);
    expect(glucoseOf(r.tags)).toBe(45);
    expect(r.events).toEqual([{ type: 'glucoseRefilled', from: 39, to: 45 }]);
    expect(r.tags.log.nodes.at(-1)?.key).toBe('liver.refill');
    // Standing still, the same tick costs nothing.
    tags = r.tags;
    expect(stepGlucose(TAGS, tags, 0, false, 480).tags).toBe(tags);
  });

  it('never drops below 35, however long the walk', () => {
    let tags = tagged(EMPTY_TAGS, (t, c) => setAmount(t, TAGS, 'glucose', GLUCOSE.start, c, 0));
    let walked = 0;
    let low = Infinity;
    for (let t = 0; t < 60 * 60 * 60; t++) {
      const r = stepGlucose(TAGS, tags, walked, true, 0);
      ({ tags, walked } = r);
      low = Math.min(low, glucoseOf(tags)!);
    }
    expect(low).toBeGreaterThanOrEqual(35);
    // The step that would take it to 39 refills it in the same tick, so the meter never shows less than 40.
    expect(low).toBe(GLUCOSE.refillBelow);
  });
});

describe('the stamp is handed over (design doc 7.3)', () => {
  const full = (s: ChapterState): ChapterState => ({ ...s, game: { ...s.game, operator: { ...s.game.operator, gauge: STAMP.gaugeMax } } });
  const STAMP_KEY: TickInput = { move: { x: 0, y: 0 }, stampPressed: true };

  it('a chapter that lists no tools starts with the stamp locked: a full pad and the key do nothing', () => {
    const locked = chapter([], { tools: [] });
    const s = full(startChapter(locked));
    expect(s.run.tools).toEqual([]);
    expect(s.game.stampLocked).toBe(true);
    expect(types(run(locked, s, STAMP_KEY, 3).events)).not.toContain('stampRaised');
    // The control: every tool is the default.
    const open = chapter([]);
    expect(startChapter(open).run.tools).toEqual(['stamp']);
    expect(types(run(open, full(startChapter(open)), STAMP_KEY, 3).events)).toContain('stampRaised');
  });

  it('a grant: line hands it over charged, and from then on the key stamps', () => {
    const c = chapter([], { tools: [], intro: 'lab.grant' });
    const s0 = startChapter(c);
    expect(s0.pending).toBe('lab.grant');
    const opened = run(c, s0, NONE);
    expect(types(opened.events)).toEqual(['dialogueOpened', 'toolGranted']);
    expect(opened.state.run.tools).toEqual(['stamp']);
    expect(opened.state.game.stampLocked).toBeUndefined();
    expect(opened.state.game.operator.gauge).toBe(STAMP.gaugeMax);
    expect(opened.state.run.tags.log.nodes.map((n) => n.key)).toContain('grant.stamp');
    const closed = run(c, run(c, opened.state, NONE, 20).state, { move: { x: 0, y: 0 }, interactPressed: true }).state;
    expect(closed.dialogue).toBeNull();
    expect(types(run(c, closed, STAMP_KEY, 3).events)).toContain('stampRaised');
  });

  it('the time clock keeps the tools, so a continue before the handover is still locked', () => {
    const c = chapter([timeClock], { tools: [] });
    const punched = run(c, place(startChapter(c), 48, 120), NONE).state;
    expect(punched.run.checkpoint?.tools).toEqual([]);
    const saved = decode(STORY, encode(STORY, { checkpoint: punched.run.checkpoint, entry: null })).data.checkpoint!;
    expect(resumeChapter(c, saved).game.stampLocked).toBe(true);
    expect(resumeChapter(c, { ...saved, tools: ['stamp'] }).game.stampLocked).toBeUndefined();
  });

  it('tools carried in from an earlier chapter are kept, whatever the new chapter hands out', () => {
    const base: ChapterFile = { version: 1, id: 'x', start: 'x/a', links: [] };
    expect(toolsAtStart({ ...base, tools: [] })).toEqual([]);
    expect(toolsAtStart({ ...base, tools: [] }, ['stamp'])).toEqual(['stamp']);
    expect(toolsAtStart(base)).toEqual(['stamp']);
  });

  it('an event card may hand out a tool; an opening or closing card may not', () => {
    const deck = (section: string) => ({
      version: 1, chapter: 'lab', opening: [], events: [],
      [section]: [{ id: 'c', options: [{ id: 'a', effect: 'grant:stamp' }, { id: 'b', effect: '' }] }],
    });
    expect(readDeck(deck('events'), TAGS).problems).toEqual([]);
    expect(readDeck(deck('opening'), TAGS).problems.map((x) => x.effect)).toEqual(['tool']);
    expect(readDeck(deck('closing'), TAGS).problems.map((x) => [x.section, x.effect])).toEqual([['closing', 'tool']]);
  });
});

describe('the intro and the end of a chapter', () => {
  it('the intro opens before the room moves, and a continue does not replay it', () => {
    const c = chapter([timeClock], { intro: 'lab.hello' });
    const s0 = startChapter(c);
    const first = run(c, s0, RIGHT);
    expect(first.state.dialogue?.id).toBe('lab.hello');
    expect(first.state.game.operator.x).toBe(s0.game.operator.x);
    expect(first.state.pending).toBeUndefined();
    const cp: Checkpoint = {
      chapter: 'lab', roomId: 'lab/a', x: 320, y: 200, tags: s0.run.tags, clock: s0.game.clock, fired: [], switches: [], boxes: [], tools: ['stamp'],
    };
    expect(resumeChapter(c, cp).pending).toBeUndefined();
    // Nor does a start in another room, which only a dev build asks for.
    expect(startChapter(c, { room: 'lab/b' }).pending).toBeUndefined();
  });

  it('a Trigger whose event is end finishes the chapter, once its when holds', () => {
    const c = chapter([trigger(5, 'end', [p('when', 'deadline')])]);
    // Feet inside the trigger, with nothing touched yet, so this tick counts as stepping onto it.
    const at = place(startChapter(c), 464, 230);
    expect(types(run(c, at, NONE).events)).not.toContain('chapterEnded');
    const withTag = { ...at, run: { ...at.run, tags: tagged(at.run.tags, (t, c) => setFlag(t, TAGS, 'deadline', true, c, 0)) } };
    expect(types(run(c, withTag, NONE).events)).toContain('chapterEnded');
    const open = chapter([trigger(5, 'end')]);
    expect(types(run(open, place(startChapter(open), 464, 230), NONE).events)).toContain('chapterEnded');
  });

  it('the playable check counts an end trigger as a way out, as it does a sleep bed', () => {
    expect(bedAfter(chapter([trigger(5, 'end')]), EMPTY_TAGS)).toBe(0);
    expect(bedAfter(chapter([trigger(5, 'end', [p('when', 'deadline')])]), EMPTY_TAGS)).toBeUndefined();
    expect(bedAfter(chapter([trigger(5, 'dialogue', [p('eventId', 'lab.hello')])]), EMPTY_TAGS)).toBe('none');
  });
});

describe('closing cards and the next chapter', () => {
  const raw = {
    version: 1, chapter: 'lab',
    opening: [
      { id: 'bedtime', options: [{ id: 'at_23', effect: '' }, { id: 'at_01', effect: 'tag:sleep_debt=2' }] },
      { id: 'morning_coffee', options: [{ id: 'drink', effect: 'tag:caffeine=100' }, { id: 'skip', effect: '' }] },
    ],
    events: [],
    closing: [{ id: 'nightcap', options: [{ id: 'none', effect: '' }, { id: 'tea', effect: '' }] }],
  };

  it('a deck reads its closing cards, which share the id space with the rest', () => {
    const { deck, problems } = readDeck(raw, TAGS);
    expect(problems).toEqual([]);
    expect(deck!.closing.map((c) => c.id)).toEqual(['nightcap']);
    const clash = readDeck({ ...raw, closing: [{ id: 'bedtime', options: [{ id: 'x', effect: '' }, { id: 'y', effect: '' }] }] }, TAGS);
    expect(clash.problems).toEqual([{ code: 'card-duplicate', section: 'closing', card: 'bedtime' }]);
  });

  it('a card answered the night before is not asked again the next morning', () => {
    const deck = readDeck(raw, TAGS).deck!;
    const night = playCards('prologue', [deck.opening[0]!], TAGS, [1], startChapterClock(), PARAMS);
    expect([...answeredCards(night.tags)]).toEqual(['bedtime']);
    expect(openingFor(deck, night.tags).map((c) => c.id)).toEqual(['morning_coffee']);
    expect(openingFor(deck, EMPTY_TAGS).map((c) => c.id)).toEqual(['bedtime', 'morning_coffee']);
    // The morning's picks build on the night's tags.
    const morning = playCards('lab', openingFor(deck, night.tags), TAGS, [0], startChapterClock(), PARAMS, night.tags);
    expect(morning.tags.values['sleep_debt']?.value).toBe(2);
    expect(morning.tags.values['caffeine']?.value).toBe(100);
    expect(() => playCards('lab', deck.opening, TAGS, [0], startChapterClock(), PARAMS)).toThrow(OuterError);
  });
});

describe('story slot version 4', () => {
  const tags = { values: {}, log: { nodes: [] } };

  it('an older checkpoint gains the stamp, since every chapter started with it before, and no entry', () => {
    const v3 = JSON.stringify({ schema: 3, data: { checkpoint: {
      chapter: 'greybox', roomId: 'greybox/rest-room', x: 1, y: 2, tags, clock: { day: 1, minute: 480 }, fired: [], switches: [], boxes: [],
    } } });
    const d = decode(STORY, v3);
    expect(d.kind).toBe('migrated');
    expect(d.data.checkpoint?.tools).toEqual(['stamp']);
    expect(d.data.entry).toBeNull();
    expect(decode(STORY, JSON.stringify({ schema: 3, data: { checkpoint: null } })).data).toEqual({ checkpoint: null, entry: null });
  });

  it('keeps the next chapter\'s entry through save and load, and refuses a tool it does not know', () => {
    const story = { checkpoint: null, entry: { chapter: 'greybox', tags, tools: ['stamp'] as const } };
    expect(decode(STORY, encode(STORY, story)).data).toEqual(story);
    const bad = JSON.stringify({ schema: 4, data: { checkpoint: null, entry: { chapter: 'greybox', tags, tools: ['hammer'] } } });
    expect(decode(STORY, bad).data).toEqual({ checkpoint: null, entry: null });
  });
});

describe('the shipped prologue', () => {
  it('is the first chapter, leads into the greybox chapter, starts without the stamp and with the meter', async () => {
    const { CHAPTERS, DECKS } = await import('../../src/app/content.ts');
    const prologue = [...CHAPTERS.values()][0]!;
    expect(prologue.id).toBe('prologue');
    expect(prologue.next).toBe('greybox');
    expect(prologue.tools).toEqual([]);
    expect(prologue.glucose).toBe(true);
    expect(DIALOGUES.has(prologue.intro!)).toBe(true);
    // Its closing card asks the greybox chapter's first opening question, so the morning skips it.
    const closing = DECKS.get('prologue')!.closing.map((c) => c.id);
    expect(closing).toEqual(['bedtime']);
    expect(DECKS.get('greybox')!.opening.map((c) => c.id)).toContain('bedtime');
  });
});

function startChapterClock() {
  return { day: 1, minute: 8 * 60 };
}
