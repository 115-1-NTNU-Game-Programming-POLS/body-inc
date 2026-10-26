import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOSSES, DECKS, DIALOGUES, ENEMIES, PARAMS, TAGS } from '../../src/app/content.ts';
import { missingCards } from '../../src/app/decks.ts';
import { tagsFromQuery } from '../../src/app/session.ts';
import {
  amount, BED_SEARCH_MINUTES, caffeineOf, CHAPTER_OPENS, CLOAK, comboReports, LOCK_TICKS, metabolise, openingCombos, optionPressure, OuterError, parseRoom,
  playOpening, readContent, readDeck, roomsOf, senseCap, sightOver, spreadEnds, startChapter, stepChapter, ticksPerMinute, TILE, worstSpread,
  type ChapterContent, type ChapterState, type Deck, type GameEvent, type TickInput, type TiledMap,
} from '../../src/core/index.ts';

const CHAPTER = readContent('chapter', JSON.parse(readFileSync('content/chapters/greybox.json', 'utf8')));
const GREY = 'greybox/greybox-room';
const REST = 'greybox/rest-room';
const CORRIDOR = 'greybox/brain-corridor';
const ARENA = 'greybox/caffeine-arena';
const DECK = DECKS.get('greybox')!;
const DECK_JSON = JSON.parse(readFileSync('content/decks/greybox.json', 'utf8')) as { opening: { id: string; options: { id: string; effect: string }[] }[]; events: { id: string; options: { id: string; effect: string }[] }[] };

const raw = (path: string) => JSON.parse(readFileSync(`public/assets/maps/${path}.tmj`, 'utf8')) as TiledMap;
const load = (path: string, map = raw(path)) => parseRoom(path, map, TAGS);
const rooms = new Map(roomsOf(CHAPTER).map((p) => [p, load(p)]));
const ctx: ChapterContent = { chapter: CHAPTER, rooms, dialogues: DIALOGUES, dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS, deck: DECK };

const tags = (q: string) => tagsFromQuery(`?tags=${q}`, TAGS);
const NONE: TickInput = { move: { x: 0, y: 0 } };
const types = (events: readonly GameEvent[]) => events.map((e) => e.type);
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

type LooseObject = { name: string; properties?: { name: string; value: unknown }[] };
/** The editable object list of a raw Tiled map. */
const objectsOf = (map: TiledMap): LooseObject[] => (map.layers as unknown as { name: string; objects?: LooseObject[] }[]).find((l) => l.name === 'objects')!.objects!;

function run(s: ChapterState, input: TickInput, n = 1): { state: ChapterState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    const r = stepChapter(ctx, s, input);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

/** The corridor with the group chat card open and its input lock already over. */
function atCard(t = tags('')): ChapterState {
  const s = startChapter(ctx, { room: CORRIDOR, tags: t });
  const open = run({ ...s, game: { ...s.game, touching: [], operator: { ...s.game.operator, x: 520, y: 224 } } }, NONE);
  expect(open.events).toContainEqual({ type: 'cardOpened', card: 'group_chat' });
  return run(open.state, NONE, LOCK_TICKS).state;
}

describe('deck file (build plan P1)', () => {
  it('reads the greybox deck: opening cards in order, event cards by id', () => {
    expect(DECK.opening.map((c) => c.id)).toEqual(['bedtime', 'morning_coffee']);
    expect([...DECK.events.keys()]).toEqual(['group_chat']);
    expect(DECK.opening[0]!.options[0]!.effects).toEqual([]);
  });

  it('a card id used twice, across opening and events, is refused', () => {
    const j = copy(DECK_JSON);
    j.events[0]!.id = 'bedtime';
    const r = readDeck(j, TAGS);
    expect(r.deck).toBeUndefined();
    expect(r.problems).toEqual([expect.objectContaining({ code: 'card-duplicate', section: 'events', card: 'bedtime' })]);
  });

  it('an option id used twice on one card is refused', () => {
    const j = copy(DECK_JSON);
    j.opening[1]!.options[1]!.id = 'drink';
    expect(readDeck(j, TAGS).problems).toEqual([expect.objectContaining({ code: 'option-duplicate', card: 'morning_coffee', option: 'drink' })]);
  });

  it('an opening card may only set card tags, an event card only event tags', () => {
    const j = copy(DECK_JSON);
    j.opening[0]!.options[0]!.effect = 'tag:deadline';
    j.events[0]!.options[1]!.effect = 'tag:caffeine=5';
    expect(readDeck(j, TAGS).problems).toEqual([
      expect.objectContaining({ code: 'effect', section: 'opening', card: 'bedtime', effect: 'tag-source' }),
      expect.objectContaining({ code: 'effect', section: 'events', card: 'group_chat', effect: 'tag-source' }),
    ]);
  });

  it('a file that breaks the schema reports schema problems and no deck', () => {
    const j = copy(DECK_JSON);
    j.opening[0]!.options = j.opening[0]!.options.slice(0, 1);
    const r = readDeck(j, TAGS);
    expect(r.deck).toBeUndefined();
    expect(r.problems.every((p) => p.code === 'schema')).toBe(true);
    expect(r.problems.length).toBeGreaterThan(0);
  });

  it('a Trigger naming a card the deck lacks is found before the chapter runs', () => {
    expect(missingCards(rooms, DECK)).toEqual([]);
    const other: Deck = { ...DECK, events: new Map() };
    expect(missingCards(rooms, other)).toEqual([expect.stringMatching(/^greybox\/brain-corridor: .*"group_chat".*content\/decks\/greybox\.json/)]);
    expect(missingCards(rooms, undefined)).toEqual([expect.stringMatching(/no deck defines/)]);
  });
});

describe('opening cards', () => {
  it('every combination is listed once: 3 bedtimes x 2 coffees', () => {
    const combos = openingCombos(DECK);
    expect(combos).toHaveLength(6);
    expect(new Set(combos.map((c) => c.join()))).toHaveProperty('size', 6);
  });

  it('logs each pick as a card node, also a pick that changes nothing, and the tag under it', () => {
    const o = playOpening(DECK, TAGS, [2, 1], CHAPTER_OPENS, PARAMS);
    expect(amount(o.tags, TAGS, 'sleep_debt')).toBe(4);
    expect(o.tags.log.nodes.map((n) => `${n.kind}:${n.key}`)).toEqual(['card:card.bedtime.at_03', 'tag:sleep_debt', 'card:card.morning_coffee.skip']);
    expect(o.tags.log.nodes[1]!.causes).toEqual([{ node: 0, at: CHAPTER_OPENS.minute }]);
  });

  it('a wrong number of picks or an option that is not there is an error, not a silent default', () => {
    expect(() => playOpening(DECK, TAGS, [0], CHAPTER_OPENS, PARAMS)).toThrow(OuterError);
    expect(() => playOpening(DECK, TAGS, [0, 2], CHAPTER_OPENS, PARAMS)).toThrow(OuterError);
  });
});

describe('event card inside a chapter', () => {
  it('opens on its Trigger, freezes the room and the clock, and ignores presses during the lock', () => {
    const s = startChapter(ctx, { room: CORRIDOR });
    const open = run({ ...s, game: { ...s.game, touching: [], operator: { ...s.game.operator, x: 520, y: 224 } } }, NONE).state;
    expect(open.card).toEqual({ id: 'group_chat', cursor: 0, age: 0 });
    const early = run(open, { ...NONE, pick: 1 }, LOCK_TICKS - 1).state;
    expect(early.card?.id).toBe('group_chat');
    const held = run(early, { move: { x: 1, y: 0 } }, 200).state;
    expect(held.card).not.toBeNull();
    expect(held.game.operator.x).toBe(open.game.operator.x);
    expect(held.game.clock).toEqual(open.game.clock);
  });

  it('W and S move the highlight and wrap; a confirm key takes it', () => {
    const s = atCard();
    const down = run(s, { ...NONE, menuStep: 1 }).state;
    expect(down.card?.cursor).toBe(1);
    expect(run(down, { ...NONE, menuStep: 1 }).state.card?.cursor).toBe(0);
    expect(run(s, { ...NONE, menuStep: -1 }).state.card?.cursor).toBe(1);
    const r = run(down, { ...NONE, interactPressed: true });
    expect(r.events).toContainEqual({ type: 'cardChosen', card: 'group_chat', option: 'office_hour' });
    expect(r.state.card).toBeNull();
    expect(amount(r.state.run.tags, TAGS, 'stress')).toBe(10);
  });

  it('a number picks directly and the choice is logged as a story event with its effects under it', () => {
    const r = run(atCard(), { ...NONE, pick: 1 });
    expect(r.events).toContainEqual({ type: 'cardChosen', card: 'group_chat', option: 'rewrite' });
    const nodes = r.state.run.tags.log.nodes;
    const ev = nodes.find((n) => n.key === 'event.group_chat.rewrite');
    expect(ev?.kind).toBe('event');
    expect(nodes.find((n) => n.key === 'deadline')?.causes.map((c) => c.node)).toEqual([ev!.id]);
    expect(r.state.game.clock.minute).toBe(atCard().game.clock.minute + 60);
  });

  it('a pick beyond the options is ignored', () => {
    expect(run(atCard(), { ...NONE, pick: 3 }).state.card?.id).toBe('group_chat');
  });

  it('fires once: walking back over the Trigger does not open it again', () => {
    const chosen = run(atCard(), { ...NONE, pick: 2 }).state;
    const away = run(chosen, { move: { x: -1, y: 0 } }, 30).state;
    // Fully off the 32 px strip at x 512, so walking back is a fresh step onto it.
    expect(away.game.operator.x).toBeLessThan(512 - 32);
    const back = run(away, { move: { x: 1, y: 0 } }, 40);
    expect(back.state.game.operator.x).toBeGreaterThan(512);
    expect(types(back.events)).not.toContain('cardOpened');
  });
});

describe('chapter clock while exploring', () => {
  it(`moves one minute every ${ticksPerMinute(PARAMS)} ticks (55 s an hour)`, () => {
    expect(ticksPerMinute(PARAMS)).toBe(55);
    const s = startChapter(ctx);
    expect(run(s, NONE, 54).state.game.clock.minute).toBe(s.game.clock.minute);
    expect(run(s, NONE, 55).state.game.clock.minute).toBe(s.game.clock.minute + 1);
    expect(run(s, NONE, 110).state.game.clock.minute).toBe(s.game.clock.minute + 2);
  });

  it('keeps the part of a minute walked before a door', () => {
    const s0 = startChapter(ctx);
    let s: ChapterState = { ...s0, run: { ...s0.run, explored: 50 }, game: { ...s0.game, touching: [], operator: { ...s0.game.operator, x: 320, y: 340 } } };
    let walked = 0;
    for (; s.run.roomId === GREY; walked++) {
      if (walked > 200) throw new Error('did not reach the south door');
      s = stepChapter(ctx, s, { move: { x: 0, y: 1 } }).state;
    }
    expect(s.run.roomId).toBe(REST);
    expect(s.run.explored).toBe((50 + walked) % 55);
    expect(s.game.clock.minute).toBe(s0.game.clock.minute + Math.floor((50 + walked) / 55));
  });
});

describe('caffeine residual (design doc 7.4)', () => {
  it('halves every halfLife hours and goes away below the floor', () => {
    const t = tags('caffeine:100');
    expect(amount(metabolise(t, TAGS, PARAMS.halfLife * 60, PARAMS), TAGS, 'caffeine')).toBeCloseTo(50, 5);
    expect(amount(metabolise(t, TAGS, 60, PARAMS), TAGS, 'caffeine')).toBeCloseTo(100 * 0.5 ** (1 / PARAMS.halfLife), 5);
    expect(metabolise(t, TAGS, 0, PARAMS)).toBe(t);
    expect(metabolise(t, TAGS, 60 * 24 * 10, PARAMS).values['caffeine']).toBeUndefined();
  });

  it('decays by however the clock moved, here an event card that takes an hour', () => {
    const r = run(atCard(tags('caffeine:100')), { ...NONE, pick: 1 }).state;
    expect(caffeineOf(r.run.tags, TAGS)).toBeCloseTo(100 * 0.5 ** (1 / PARAMS.halfLife), 4);
  });

  it('decays where the clock moves inside an effect, so the order of effects matters as written', () => {
    const deckOf = (effect: string) => readDeck({ version: 1, chapter: 'greybox', opening: [{ id: 'c', options: [{ id: 'a', effect }, { id: 'b', effect: '' }] }], events: [] }, TAGS).deck!;
    const drankThenWaited = playOpening(deckOf('tag:caffeine=100;clock:120'), TAGS, [0], CHAPTER_OPENS, PARAMS);
    expect(caffeineOf(drankThenWaited.tags, TAGS)).toBeCloseTo(100 * 0.5 ** (2 / PARAMS.halfLife), 4);
    expect(drankThenWaited.clock.minute).toBe(CHAPTER_OPENS.minute + 120);
    const waitedThenDrank = playOpening(deckOf('clock:120;tag:caffeine=100'), TAGS, [0], CHAPTER_OPENS, PARAMS);
    expect(caffeineOf(waitedThenDrank.tags, TAGS)).toBe(100);
  });

  it('decays during a nap', () => {
    const s0 = startChapter(ctx, { room: REST, tags: tags('caffeine:100') });
    const r = run({ ...s0, game: { ...s0.game, touching: [], operator: { ...s0.game.operator, x: 128, y: 330 } } }, { ...NONE, interactPressed: true });
    expect(types(r.events)).toContain('napped');
    expect(caffeineOf(r.state.run.tags, TAGS)).toBeCloseTo(100 * 0.5 ** (20 / 60 / PARAMS.halfLife), 4);
  });

  it('a return to the checkpoint takes the clock back and restores the residual, never inflates it', () => {
    const s0 = startChapter(ctx, { room: REST, tags: tags('caffeine:80') });
    const saved = run({ ...s0, game: { ...s0.game, touching: [], operator: { ...s0.game.operator, x: 128, y: 230 } } }, NONE).state;
    const later = run(saved, NONE, 55 * 30).state;
    const r = run({ ...later, game: { ...later.game, operator: { ...later.game.operator, halves: 0 } } }, NONE);
    expect(types(r.events)).toContain('returnedToCheckpoint');
    expect(r.state.run.tags).toEqual(saved.run.checkpoint!.tags);
  });

  it('the cloak: blind from 50, sees 2 tiles from 25, normal below', () => {
    expect(senseCap(100)).toBe(0);
    expect(senseCap(CLOAK.blindAt)).toBe(0);
    expect(senseCap(CLOAK.blindAt - 0.1)).toBe(2 * TILE);
    expect(senseCap(CLOAK.nearAt)).toBe(2 * TILE);
    expect(senseCap(CLOAK.nearAt - 0.1)).toBeUndefined();
  });

  /** The greybox room's adenosine and the operator `gap` px to its right, run for `n` ticks. */
  function nearAdenosine(t: string, gap: number, n: number) {
    const s = startChapter(ctx, { tags: tags(t) });
    const e = s.game.enemies.find((x) => x.type === 'adenosine')!;
    const placed: ChapterState = { ...s, game: { ...s.game, touching: [], operator: { ...s.game.operator, x: e.x + gap, y: e.y } } };
    const after = run(placed, NONE, n).state;
    const moved = after.game.enemies.find((x) => x.id === e.id)!;
    return { dx: moved.x - e.x, stacks: after.game.operator.stacks };
  }

  it('blind adenosine neither drifts toward the operator nor clings to it', () => {
    expect(nearAdenosine('', 3 * TILE, 60).dx).toBeGreaterThan(0);
    expect(nearAdenosine('caffeine:100', 3 * TILE, 60).dx).toBe(0);
    expect(nearAdenosine('', 0, 60).stacks).toBeGreaterThan(0);
    expect(nearAdenosine('caffeine:100', 0, 60).stacks).toBe(0);
  });

  it('half-cloaked adenosine only notices within 2 tiles', () => {
    expect(nearAdenosine('caffeine:30', 3 * TILE, 60).dx).toBe(0);
    expect(nearAdenosine('caffeine:30', 1.5 * TILE, 30).dx).toBeGreaterThan(0);
  });
});

describe('every opening combination gives a playable chapter (build plan P1 done-when)', () => {
  it('the greybox deck: all rooms enter and a sleep bed accepts within a day, also after each event option', () => {
    const reports = comboReports(ctx, DECK, CHAPTER_OPENS);
    expect(reports).toHaveLength(6);
    for (const r of reports) expect(r.problems, r.picks.map((p) => p.option).join('+')).toEqual([]);
    expect(reports.filter((r) => r.picks[1]!.option === 'drink').every((r) => r.bedAfter! > 0)).toBe(true);
    expect(reports.filter((r) => r.picks[1]!.option === 'skip').every((r) => r.bedAfter === 0)).toBe(true);
    expect(worstSpread(reports)).toBeGreaterThan(0);
  });

  it('weighs clinging enemies by how much of the day the cloak lets them see the operator', () => {
    const reports = comboReports(ctx, DECK, CHAPTER_OPENS);
    const of = (bed: string, coffee: string) => reports.find((r) => r.picks[0]!.option === bed && r.picks[1]!.option === coffee)!;
    // 08:00 to 23:00 with a cup at 08:00: blind for 5 h, 2 of 5 tiles for the next 5 h, then the full range.
    expect(of('at_23', 'drink').sight).toBeCloseTo((0 * 300 + 0.4 * 300 + 1 * 300) / 900, 2);
    expect(of('at_23', 'skip').sight).toBe(1);
    expect(of('at_01', 'skip')).toMatchObject({ enemies: 8, clinging: 4 });
    const drink = of('at_01', 'drink');
    expect(drink.pressure).toBeCloseTo((drink.enemies - drink.clinging + drink.clinging * drink.sight) / drink.p, 9);
    for (const bed of ['at_23', 'at_01', 'at_03']) expect(of(bed, 'drink').pressure).toBeLessThan(of(bed, 'skip').pressure);
  });

  it('only enemies that cling are hidden by the cloak, not every reforming one', () => {
    const map = new Map(ENEMIES.enemies);
    const { clings: _, ...adenosine } = map.get('adenosine')!;
    map.set('adenosine', adenosine);
    const reports = comboReports({ ...ctx, enemies: { ...ENEMIES, enemies: map } }, DECK, CHAPTER_OPENS);
    for (const r of reports) expect(r.clinging).toBe(0);
    const at23 = reports.filter((r) => r.picks[0]!.option === 'at_23');
    expect(at23[0]!.pressure).toBe(at23[1]!.pressure);
  });

  it('a cloak that starts after 23:00 is weighed at the moment the chapter opens', () => {
    const late = { day: 1, minute: 23 * 60 + 30 };
    expect(sightOver(ctx, tags('caffeine:100'), late)).toBe(0);
    expect(sightOver(ctx, tags('caffeine:30'), late)).toBeCloseTo(0.4, 9);
    expect(sightOver(ctx, tags(''), late)).toBe(1);
    // Past midnight is still the same logical day, not the start of a fresh one.
    expect(sightOver(ctx, tags('caffeine:30'), { day: 1, minute: 24 * 60 + 30 })).toBeCloseTo(0.4, 9);
    expect(sightOver(ctx, tags('caffeine:30'), { day: 2, minute: 24 * 60 + 22 * 60 + 59 })).toBeCloseTo(0.4, 9);
  });

  it('names the same easiest combination the spread is measured against, skipping one with no pressure', () => {
    const reports = comboReports(ctx, DECK, CHAPTER_OPENS);
    const empty = { ...reports[0]!, enemies: 0, clinging: 0, pressure: 0 };
    const withEmpty = [empty, ...reports];
    const ends = spreadEnds(withEmpty)!;
    expect(ends.easiest.pressure).toBeGreaterThan(0);
    expect(worstSpread(withEmpty)).toBeCloseTo(ends.hardest.pressure / ends.easiest.pressure - 1, 9);
    expect(worstSpread(withEmpty)).toBe(worstSpread(reports));
    expect(spreadEnds([empty])).toBeUndefined();
  });

  it('lists each opening option by the mean pressure of the combinations that include it', () => {
    const reports = comboReports(ctx, DECK, CHAPTER_OPENS);
    const rows = optionPressure(DECK, reports);
    expect(rows.map((r) => `${r.card}.${r.option}`)).toEqual(['bedtime.at_23', 'bedtime.at_01', 'bedtime.at_03', 'morning_coffee.drink', 'morning_coffee.skip']);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(rows[0]!.pressure).toBeCloseTo(mean(reports.filter((r) => r.picks[0]!.option === 'at_23').map((r) => r.pressure)), 9);
    expect(optionPressure(DECK, reports.map((r) => ({ ...r, problems: [{ code: 'no-bed' as const }] })))[0]!.pressure).toBeNaN();
  });

  it('a bed that never accepts is reported, as is a chapter with no sleep bed', () => {
    const map = raw(REST);
    const objects = objectsOf(map);
    const bed = objects.find((o) => o.name === 'bedtime')!;
    bed.properties = bed.properties!.map((p) => (p.name === 'requires' ? { ...p, value: 'caffeine<0' } : p));
    const never = comboReports({ ...ctx, rooms: new Map([...rooms, [REST, load(REST, map)]]) }, DECK, CHAPTER_OPENS);
    // One problem per combination: the event options are not retried on top of a bed that never opens.
    for (const r of never) expect(r.problems).toEqual([{ code: 'bed-never' }]);

    objects.splice(objects.indexOf(bed), 1);
    const none = comboReports({ ...ctx, rooms: new Map([...rooms, [REST, load(REST, map)]]) }, DECK, CHAPTER_OPENS);
    expect(none.every((r) => r.problems.some((p) => p.code === 'no-bed'))).toBe(true);
  });

  it('an event option that locks the bed for good is caught on top of every combination', () => {
    const j = copy(DECK_JSON);
    // Sleep debt beyond a day of waiting cannot help; only caffeine gates the greybox bed, so a
    // bed gated on stress stands in for an option that locks it.
    j.events[0]!.options[1]!.effect = 'tag:stress=99';
    const deck = readDeck(j, TAGS).deck!;
    const map = raw(REST);
    const objects = objectsOf(map);
    const bed = objects.find((o) => o.name === 'bedtime')!;
    bed.properties = bed.properties!.map((p) => (p.name === 'requires' ? { ...p, value: 'stress<50' } : p));
    const reports = comboReports({ ...ctx, deck, rooms: new Map([...rooms, [REST, load(REST, map)]]) }, deck, CHAPTER_OPENS);
    for (const r of reports) expect(r.problems).toEqual([{ code: 'bed-never', event: { card: 'group_chat', option: 'office_hour' } }]);
    expect(BED_SEARCH_MINUTES).toBe(1440);
  });
});
