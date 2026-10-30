import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOSSES, CHAPTERS, DECKS, DIALOGUES, ENEMIES, EXAMS, PARAMS, RESCUES, TAGS } from '../../src/app/content.ts';
import { tagsFromQuery } from '../../src/app/session.ts';
import {
  amount, arrivalPoint, carriedTags, holds, LOCK_TICKS, loadBossTable, parseRoom, readContent, roomsOf, selectDialogue, startChapter, stepChapter, storyAtEnd, TILE,
  type CaffeineParams, type ChapterContent, type ChapterState, type GameEvent, type TickInput, type TiledMap,
} from '../../src/core/index.ts';
import { OPERATOR_BODY } from '../../src/core/combat/operator.ts';
import { compileCondition } from '../../src/core/tags/dictionary.ts';

const NONE: TickInput = { move: { x: 0, y: 0 } };
const CAFFEINE_RAW = JSON.parse(readFileSync('content/bosses/caffeine.json', 'utf8'));
const TOAST_RAW = JSON.parse(readFileSync('content/bosses/toast.json', 'utf8'));
const PARAMS_C = JSON.parse(readFileSync('content/params.json', 'utf8')).defaults as CaffeineParams;

const CHAPTER = readContent('chapter', JSON.parse(readFileSync('content/chapters/brain.json', 'utf8')));
const loadMap = (path: string) => JSON.parse(readFileSync(`public/assets/maps/${path}.tmj`, 'utf8')) as TiledMap;
const brain: ChapterContent = {
  chapter: CHAPTER,
  rooms: new Map(roomsOf(CHAPTER).map((p) => [p, parseRoom(p, loadMap(p), TAGS)])),
  dialogues: DIALOGUES, dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS, rescues: RESCUES, deck: DECKS.get('brain')!,
};
const tags = (q: string) => tagsFromQuery(`?tags=${q}`, TAGS);

function at(room: string, q = '', place?: { x: number; y: number }, minute?: number): ChapterState {
  const { pending: _, ...s } = startChapter(brain, { room, ...(q ? { tags: tags(q) } : {}) });
  return {
    ...s,
    game: {
      ...s.game,
      ...(place ? { operator: { ...s.game.operator, x: place.x, y: place.y } } : {}),
      ...(minute !== undefined ? { clock: { ...s.game.clock, minute } } : {}),
    },
  };
}
const door = (room: string, socket: string) => brain.rooms.get(room)!.objects.find((o) => o.kind === 'Door' && o.props['socket'] === socket)!;

function go(s: ChapterState, input: TickInput, n: number): { state: ChapterState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    const r = stepChapter(brain, s, input);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

/** Talks through the open conversation; at the n-th choice it picks `picks[n]` (1-based), at the first reply by default. */
function talk(s: ChapterState, picks: readonly number[] = []): { state: ChapterState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  let choice = -1;
  let seenAt = -1;
  for (let i = 0; i < 600 && s.dialogue; i++) {
    const offered = (selectDialogue(DIALOGUES, s.dialogue)?.options.length ?? 0) > 0;
    // A press is ignored for a few ticks after a line appears, so the pick is repeated until the line changes.
    if (offered && s.dialogue.at !== seenAt) { choice++; seenAt = s.dialogue.at; }
    const pick = offered ? picks[choice] ?? 1 : 0;
    const r = stepChapter(brain, s, { ...NONE, interactPressed: !offered && i % 2 === 0, ...(offered && i % 2 === 0 ? { pick } : {}) });
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

describe('the brain chapter (design doc 7.4)', () => {
  it('follows the prologue and leads into the midterm, with the folder to be fetched and no stamp of its own', () => {
    expect(CHAPTERS.get('prologue')!.next).toBe('brain');
    expect(CHAPTER.next).toBe('midterm');
    expect(CHAPTER.tools).toEqual([]);
    expect(DIALOGUES.has(CHAPTER.intro!)).toBe(true);
    // The midterm reads these two readiness tags; the rooms set them and the chapter carries them over, with no closing card.
    expect(CHAPTER.carry).toEqual(['exam_practice', 'exam_archived']);
    expect(DECKS.get('brain')!.closing).toEqual([]);
  });

  it('opens the morning machine from 08:00 to 10:00 and the afternoon one from 17:00 to 19:00, never both', () => {
    const north = door('brain/lobby', 'N');
    const west = door('brain/lobby', 'W');
    const open = (minute: number) => go(at('brain/lobby', '', undefined, minute), NONE, 1).state.game.unlocked;
    expect(open(8 * 60)).toContain(north.id);
    expect(open(8 * 60)).not.toContain(west.id);
    expect(open(10 * 60)).not.toContain(north.id);
    expect(open(12 * 60)).toEqual([]);
    expect(open(17 * 60 + 30)).toContain(west.id);
    expect(open(17 * 60 + 30)).not.toContain(north.id);
    expect(open(19 * 60)).not.toContain(west.id);
  });

  it('the clerk hands over the folder, which the chapter does not hold at the start', () => {
    expect(at('brain/lobby').run.tools).toEqual([]);
    const s = at('brain/general-affairs', '', { x: 320 - 20, y: 200 });
    const opened = go(s, { ...NONE, interactPressed: true }, 1);
    expect(opened.events).toContainEqual({ type: 'dialogueOpened', dialogueId: 'brain.clerk' });
    expect(talk(opened.state).state.run.tools).toContain('folder');
  });

  it('puts adenosine in the office and two more vents of it only from sleep_debt 2', () => {
    const adenosine = (q: string) => at('brain/open-office', q).game.enemies.filter((e) => e.type === 'adenosine').length;
    expect(adenosine('')).toBe(2);
    expect(adenosine('sleep_debt:1')).toBe(2);
    expect(adenosine('sleep_debt:2')).toBe(4);
    expect(adenosine('sleep_debt:4')).toBe(4);
  });

  it('ends the chapter at the sleep door while the caffeine residue is below 50, and not at 50', () => {
    const bed = brain.rooms.get('brain/rooftop')!.objects.find((o) => o.kind === 'Bed')!;
    expect(bed.props['requires']).toBe('caffeine<50');
    const bedPlace = { x: bed.x + bed.width / 2, y: bed.y + bed.height / 2 };
    const sleep = (q: string) => go(at('brain/rooftop', q, bedPlace), { ...NONE, interactPressed: true }, 1);
    expect(sleep('caffeine:50').events.map((e) => e.type)).not.toContain('chapterEnded');
    expect(sleep('caffeine:49').events.map((e) => e.type)).toContain('chapterEnded');
    expect(sleep('caffeine:10').events.map((e) => e.type)).toContain('chapterEnded');
  });
});

describe('the memory files (design doc 7.4, 7.6)', () => {
  const files = [...brain.rooms.values()].flatMap((r) => r.objects.filter((o) => o.kind === 'Pickup' && o.props['itemType'] === 'memory'));
  const bed = brain.rooms.get('brain/rooftop')!.objects.find((o) => o.kind === 'Bed')!;
  const bedPlace = { x: bed.x + bed.width / 2, y: bed.y + bed.height / 2 };
  /** Goes to bed on the roof with the given tags; the chapter's state after that tick. */
  const sleep = (q: string, content: ChapterContent = brain) => {
    const s = at('brain/rooftop', q, bedPlace);
    return stepChapter(content, s, { ...NONE, interactPressed: true });
  };
  const archived = (q: string) => amount(sleep(q).state.run.tags, TAGS, 'exam_archived');

  it('the chapter lists as many files as its rooms hold, all in the hippocampus', () => {
    expect(files).toHaveLength(CHAPTER.archive!.total);
    expect(files).toHaveLength(6);
    expect([...brain.rooms].filter(([, r]) => r.objects.some((o) => files.includes(o))).map(([p]) => p)).toEqual(['brain/hippocampus']);
  });

  const takeAt = (q: string, o: (typeof files)[number], content: ChapterContent = brain) =>
    stepChapter(content, at('brain/hippocampus', q, { x: o.x, y: o.y }), { ...NONE, interactPressed: true });

  it('taking a file puts it in the hands, tells the operator, and files nothing yet', () => {
    const taken = takeAt('', files[0]!);
    expect(taken.events).toContainEqual(expect.objectContaining({ type: 'pickedUp', itemType: 'memory' }));
    expect(amount(taken.state.run.tags, TAGS, 'memory_held')).toBe(1);
    expect(amount(taken.state.run.tags, TAGS, 'exam_archived')).toBe(0);
  });

  it('puts a fourth file back on the floor: three in the hands at most', () => {
    const o = files[3]!;
    const full = takeAt('memory_held:3', o);
    expect(full.events).toContainEqual({ type: 'handsFull' });
    expect(full.events.map((e) => e.type)).not.toContain('pickedUp');
    expect(amount(full.state.run.tags, TAGS, 'memory_held')).toBe(3);
    // It is still there to take, and the room remembers nothing of it.
    expect(full.state.game.taken).not.toContain(o.id);
    expect(full.state.run.fired).not.toContain(`brain/hippocampus#${o.id}`);
    const room = takeAt('memory_held:2', o);
    expect(amount(room.state.run.tags, TAGS, 'memory_held')).toBe(3);
    expect(room.state.game.taken).toContain(o.id);
  });

  it('the staging desk takes what is held, 100 a file, and a second visit with empty hands takes nothing', () => {
    const desk = brain.rooms.get('brain/hippocampus')!.objects.find((o) => o.kind === 'NPC')!;
    expect(desk.props['dialogueId']).toBe('brain.desk');
    const visit = (q: string) => {
      const opened = go(at('brain/hippocampus', q, { x: desk.x + 20, y: desk.y }), { ...NONE, interactPressed: true }, 1);
      expect(opened.events).toContainEqual({ type: 'dialogueOpened', dialogueId: 'brain.desk' });
      return talk(opened.state).state.run.tags;
    };
    const after = visit('memory_held:3,memory_desk:100');
    expect(amount(after, TAGS, 'memory_held')).toBe(0);
    expect(amount(after, TAGS, 'memory_desk')).toBe(400);
    const empty = visit('memory_desk:100');
    expect(amount(empty, TAGS, 'memory_desk')).toBe(100);
  });

  it('the desk fades 5% an hour while the operator is awake, and files in the hands do not fade', () => {
    const later = (q: string, minutes: number) => {
      const s = at('brain/hippocampus', q);
      return go({ ...s, game: { ...s.game, clock: { ...s.game.clock, minute: s.game.clock.minute } } }, NONE, minutes * 55 + 1).state.run.tags;
    };
    const desk = amount(later('memory_desk:600,memory_held:3', 120), TAGS, 'memory_desk');
    expect(desk).toBeCloseTo(600 * 0.95 ** 2, 0);
    expect(amount(later('memory_desk:600,memory_held:3', 120), TAGS, 'memory_held')).toBe(3);
  });

  it('sleep files the share of files on the desk, and the night crew shrinks with the caffeine still in the body', () => {
    expect(archived('memory_desk:600')).toBe(100);
    expect(archived('memory_desk:300')).toBe(50);
    expect(archived('memory_desk:0')).toBe(0);
    // Files still in the hands are not on the desk, so they are not filed.
    expect(archived('memory_held:3,memory_desk:300')).toBe(50);
    // Under the dead zone the crew is whole; 33 leaves about 87% of it (design doc 7.4).
    expect(archived('memory_desk:600,caffeine:14')).toBe(100);
    expect(archived('memory_desk:600,caffeine:33')).toBe(87);
    expect(archived('memory_desk:300,caffeine:33')).toBe(43);
    // The door will not open at 50, so nothing is filed that night.
    const shut = sleep('memory_desk:600,caffeine:50');
    expect(shut.events.map((e) => e.type)).not.toContain('chapterEnded');
    expect(amount(shut.state.run.tags, TAGS, 'exam_archived')).toBe(0);
  });

  it('the extra cup at the climax files only half of it', () => {
    expect(archived('memory_desk:600,one_more_cup')).toBe(50);
    expect(archived('memory_desk:300,one_more_cup,caffeine:33')).toBe(22);
  });

  it('a chapter without an archive leaves the tag alone, and a file in it is only removed', () => {
    const { archive: _, ...rest } = CHAPTER;
    const plain: ChapterContent = { ...brain, chapter: rest };
    const done = sleep('memory_desk:600', plain);
    expect(done.events.map((e) => e.type)).toContain('chapterEnded');
    expect(amount(done.state.run.tags, TAGS, 'exam_archived')).toBe(0);
    const taken = takeAt('', files[0]!, plain);
    expect(taken.events).toContainEqual(expect.objectContaining({ type: 'pickedUp', itemType: 'memory' }));
    expect(amount(taken.state.run.tags, TAGS, 'memory_held')).toBe(0);
  });

  it('the day boundary keeps the two readiness tags and nothing else', () => {
    const ended = sleep('memory_desk:600,exam_practice:95,caffeine:20,sleep_debt:2,phones_off:3').state;
    const carried = carriedTags(CHAPTER, ended.run.tags, TAGS);
    expect(Object.keys(carried.values).sort()).toEqual(['exam_archived', 'exam_practice']);
    expect(amount(carried, TAGS, 'exam_practice')).toBe(95);
    expect(amount(carried, TAGS, 'exam_archived')).toBe(Math.round(100 * (1 - 0.4 * 0.2)));
    // A fresh log with one entry, so the next chapter does not see this one's cards as answered.
    expect(carried.log.nodes.filter((n) => n.kind !== 'tag').map((n) => n.key)).toEqual(['carry']);
    expect(carriedTags(CHAPTER, sleep('caffeine:20').state.run.tags, TAGS).values).toEqual({});
    expect(storyAtEnd(ended.run, 'midterm', carried).entry).toEqual({ chapter: 'midterm', tags: carried, tools: ended.run.tools });
    expect(storyAtEnd(ended.run, 'midterm').entry?.tags.values).toEqual({});
  });

  it('the group chat sets the practice readiness, and the midterm bars read what the chapter carried', () => {
    const chat = DECKS.get('brain')!.events.get('group_chat')!;
    const practice = (id: string) => JSON.stringify(chat.options.find((o) => o.id === id)!.effects);
    expect(practice('rewrite')).toMatch(/exam_practice[^}]*95/);
    expect(practice('office_hour')).toMatch(/exam_practice[^}]*60/);
    const exam = EXAMS.get('midterm')!;
    expect(exam.segments.map((s) => s.readinessTag)).toEqual(CHAPTER.carry);
  });
});

describe('the nap sofa (design doc 7.4)', () => {
  const sofa = brain.rooms.get('brain/open-office')!.objects.find((o) => o.kind === 'Bed')!;
  const lie = (s: ChapterState) => go(s, { ...NONE, interactPressed: true }, 1);

  it('hands over 〈短暫午睡〉 only when the sofa is used, and once', () => {
    const s = at('brain/open-office', '', { x: sofa.x + sofa.width / 2, y: sofa.y + sofa.height / 2 });
    expect(sofa.props['unlocks']).toBe('short_nap');
    const first = lie(s);
    expect(first.events).toContainEqual({ type: 'napped', minutes: 20 });
    expect(first.events).toContainEqual({ type: 'handbookUnlocked', id: 'short_nap' });
    // The sofa is once per chapter, so a second lie-down gives nothing.
    const again = lie(go(first.state, NONE, 20).state);
    expect(again.events.map((e) => e.type)).not.toContain('handbookUnlocked');
    // Walking past it, or being refused, gives nothing either.
    expect(go(s, NONE, 5).events.map((e) => e.type)).not.toContain('handbookUnlocked');
  });
});

describe('the chairman\'s pie in the chapter (design doc 7.4)', () => {
  const press = (s: ChapterState) => go(s, { ...NONE, partnerPressed: true }, 1);

  it('every room of the chapter starts with it ready, and L raises it', () => {
    expect(CHAPTER.partner).toBe('chairman');
    for (const room of roomsOf(CHAPTER)) expect(at(room).game.pie).toEqual({ ticksLeft: 0, cooldown: 0, radiusPx: 0 });
    const raised = press(at('brain/tutorial'));
    expect(raised.events).toContainEqual(expect.objectContaining({ type: 'pieRaised', sleepy: false }));
    expect(raised.state.game.pie?.ticksLeft).toBeGreaterThan(0);
  });

  it('is smaller and shorter after a short night, by the night\'s S', () => {
    const slept = (q: string) => press(at('brain/tutorial', q)).state.game.pie!;
    const full = slept('');
    const tired = slept('sleep_debt:4');
    // S = max(0.3, 1 - 0.07 x debt) = 0.72 at 4 hours.
    expect(tired.radiusPx / full.radiusPx).toBeCloseTo(0.72, 5);
    expect(press(at('brain/tutorial', 'sleep_debt:4')).events).toContainEqual(expect.objectContaining({ type: 'pieRaised', sleepy: true }));
  });

  it('is the chapter\'s doing: a chapter without a partner has none and L does nothing', () => {
    const { partner: _, ...rest } = CHAPTER;
    const plain: ChapterContent = { ...brain, chapter: rest };
    const { pending: __, ...s } = startChapter(plain, { room: 'brain/tutorial' });
    expect(s.game.pie).toBeUndefined();
    expect(stepChapter(plain, s, { ...NONE, partnerPressed: true }).events.map((e) => e.type)).not.toContain('pieRaised');
  });

  it('is taught on the tutorial sign, with the key', () => {
    const sign = DIALOGUES.get('brain.tutorial.sign')!.lines.map((l) => l.text).join('');
    expect(sign).toContain('L');
    expect(sign).toContain('大餅');
  });
});

describe('the energy-drink salesman (design doc 7.4)', () => {
  const TUTORIAL = 'brain/tutorial';
  const seller = (s: ChapterState) => s.game.enemies.find((e) => e.type === 'energy_seller');
  /** A can already on the operator, thrown by the salesman: it lands on the next tick. */
  const canOn = (q: string): ChapterState => {
    const s = at(TUTORIAL, q, { x: 200, y: 200 });
    const can = { id: 900, owner: seller(s)!.id, kind: 'can', can: true as const, x: 200, y: 196, vx: 0, vy: 0, ticksLeft: 5, halves: 0, half: 3, spent: false };
    return { ...s, game: { ...s.game, shots: [can] } };
  };
  const drink = (q: string) => go(canOn(q), NONE, 1);
  /** The salesman one staple from closing, in front of an operator aiming at him. */
  const nearlyClosed = (): ChapterState => {
    const s = at(TUTORIAL, '', { x: 400, y: 288 });
    const enemies = s.game.enemies.map((e) => (e.type === 'energy_seller' ? { ...e, x: 440, y: 288, hp: 1 } : e));
    return { ...s, game: { ...s.game, enemies, operator: { ...s.game.operator, aim: { x: 1, y: 0 } } } };
  };

  it('a can adds 150 to the residual and starts the heartbeat, with no heart lost', () => {
    const r = drink('');
    expect(r.events).toContainEqual({ type: 'canTaken', source: seller(r.state)!.id });
    expect(r.events).toContainEqual({ type: 'palpitation' });
    expect(r.events.map((e) => e.type)).not.toContain('heartLost');
    expect(amount(r.state.run.tags, TAGS, 'caffeine')).toBe(PARAMS.energyDrink);
    expect(PARAMS.energyDrink).toBe(150);
  });

  it('says the Disco line only once the residual is past 300, from the salesman', () => {
    const disco = (q: string) => drink(q).events.map((e) => e.type);
    expect(disco('caffeine:149')).toContain('palpitation');
    expect(disco('caffeine:149')).not.toContain('canDisco');
    // Exactly 300 is the limit, not past it.
    expect(disco('caffeine:150')).toContain('palpitation');
    expect(disco('caffeine:150')).not.toContain('canDisco');
    const over = drink('caffeine:151');
    expect(over.events).toContainEqual({ type: 'canDisco', target: seller(over.state)!.id });
    expect(over.events.map((e) => e.type)).not.toContain('palpitation');
  });

  it('is logged as one event the report can cite', () => {
    const nodes = drink('').state.run.tags.log.nodes;
    expect(nodes.some((n) => n.kind === 'event' && n.key === 'energy_can')).toBe(true);
  });

  it('once his case is closed he is not in the room on any later visit', () => {
    expect(CHAPTER.closedCases).toEqual({ energy_seller: 'seller_closed' });
    const weak = nearlyClosed();
    const shot = go(weak, { ...NONE, attack: true, attackPressed: true }, 60);
    expect(shot.events.map((e) => e.type)).toContain('caseClosed');
    expect(holds(shot.state.run.tags, TAGS, compileCondition(TAGS, 'seller_closed'))).toBe(true);
    // Back in the room afterwards, built from the tags he left behind.
    expect(seller(at(TUTORIAL, 'seller_closed'))).toBeUndefined();
    expect(seller(at(TUTORIAL))).toBeDefined();
  });

  it('a chapter that remembers no closed cases leaves the flag alone', () => {
    const { closedCases: _, ...rest } = CHAPTER;
    const plain: ChapterContent = { ...brain, chapter: rest };
    const weak = nearlyClosed();
    let s = weak;
    for (let i = 0; i < 60; i++) s = stepChapter(plain, s, { ...NONE, attack: true, attackPressed: i === 0 }).state;
    expect(s.game.enemies.find((e) => e.type === 'energy_seller')?.phase).toBe('closed');
    expect(holds(s.run.tags, TAGS, compileCondition(TAGS, 'seller_closed'))).toBe(false);
  });
});

describe('the phone spirits (design doc 7.4)', () => {
  /** The third spirit's trigger, with `others` of the other two already switched off. */
  const third = (others: number) => at('brain/hippocampus', `phones_off:${others}`, { x: 15 * TILE, y: 5 * TILE });

  it('cost half an hour per "one more", and the handbook page comes only once all three are off', () => {
    const minutes = (s: ChapterState) => s.game.clock.minute;
    const opened = go(third(2), NONE, 1);
    expect(opened.events).toContainEqual({ type: 'dialogueOpened', dialogueId: 'brain.phone' });
    // Switch off at once: free, and the third one opens the page.
    const off = talk(opened.state, [2]);
    expect(amount(off.state.run.tags, TAGS, 'phones_off')).toBe(3);
    expect(off.events).toContainEqual({ type: 'handbookUnlocked', id: 'screens' });
    expect(minutes(off.state)).toBe(minutes(opened.state));
    // Two rounds of "one more" cost an hour, and the spirit is switched off all the same.
    const late = talk(opened.state, [1, 1]);
    expect(minutes(late.state) - minutes(opened.state)).toBe(60);
    expect(amount(late.state.run.tags, TAGS, 'phones_off')).toBe(3);
    expect(late.events).toContainEqual({ type: 'handbookUnlocked', id: 'screens' });
    // With only the first one off, switching this one off is not enough.
    const early = talk(go(third(1), NONE, 1).state, [2]);
    expect(amount(early.state.run.tags, TAGS, 'phones_off')).toBe(2);
    expect(early.events.map((e) => e.type)).not.toContain('handbookUnlocked');
  });

  it('are three once-triggers, so a spirit switched off does not come back on the way out', () => {
    const triggers = brain.rooms.get('brain/hippocampus')!.objects.filter((o) => o.kind === 'Trigger' && o.props['eventId'] === 'brain.phone');
    expect(triggers).toHaveLength(3);
  });
});

describe('the climax choice (design doc 7.4)', () => {
  const EAST = { x: 18 * TILE + 16, y: 5 * TILE };
  const asked = () => go(at('brain/hippocampus', '', EAST), NONE, 1);
  const choose = (pick: number) => go(go(asked().state, NONE, LOCK_TICKS).state, { ...NONE, pick }, 1);
  const cup = (s: ChapterState) => holds(s.run.tags, TAGS, compileCondition(TAGS, 'one_more_cup'));

  it('is asked once, by the strip before the arena door, and nothing happens until it is answered', () => {
    expect(asked().events).toContainEqual({ type: 'cardOpened', card: 'climax' });
    expect(cup(asked().state)).toBe(false);
    const done = choose(2).state;
    expect(done.card).toBeNull();
    const back = go(go(done, { move: { x: -1, y: 0 } }, 20).state, { move: { x: 1, y: 0 } }, 40);
    expect(back.events.map((e) => e.type)).not.toContain('cardOpened');
  });

  it('the extra cup sets one_more_cup, and sleeping first leaves it off', () => {
    expect(cup(choose(1).state)).toBe(true);
    expect(cup(choose(2).state)).toBe(false);
  });

  it('puts the chapter\'s summon scale on the arena room only while the cup is on', () => {
    expect(CHAPTER.climax).toEqual({ flag: 'one_more_cup', summonFactor: 2, archiveFactor: 0.5 });
    expect(go(at('brain/arena', 'one_more_cup'), NONE, 1).state.game.summonScale).toBe(2);
    expect(go(at('brain/arena'), NONE, 1).state.game.summonScale).toBeUndefined();
    const on = go(at('brain/arena', 'one_more_cup'), NONE, 1).state;
    const off = go({ ...on, run: { ...on.run, tags: at('brain/arena').run.tags } }, NONE, 1).state;
    expect(off.game.summonScale).toBeUndefined();
  });

  it('a chapter without a climax never scales', () => {
    const { climax: _, ...rest } = CHAPTER;
    const plain: ChapterContent = { ...brain, chapter: rest };
    const s = at('brain/arena', 'one_more_cup');
    expect(stepChapter(plain, s, NONE).state.game.summonScale).toBeUndefined();
  });
});

describe('the caffeine boss closes with a negotiation (design doc 7.4)', () => {
  const ARENA = 'brain/arena';
  const eastDoor = door(ARENA, 'E');
  const closed = (s: ChapterState): ChapterState => ({
    ...s, game: { ...s.game, enemies: s.game.enemies.map((e) => (e.boss ? { ...e, hp: 0, phase: 'closed' as const } : e)) },
  });
  const settled = (s: ChapterState) => holds(s.run.tags, TAGS, compileCondition(TAGS, 'caffeine_settled'));

  it('keeps the way up shut until he has settled, and does not bring him back afterwards', () => {
    expect([eastDoor.props['lock'], eastDoor.props['lockParam']]).toEqual(['resource', 'caffeine_settled']);
    expect(at(ARENA).game.enemies.map((e) => e.type)).toEqual(['caffeine']);
    expect(at(ARENA, 'caffeine_settled').game.enemies).toEqual([]);
    expect(go(at(ARENA), NONE, 1).state.game.unlocked).not.toContain(eastDoor.id);
  });

  it('opens the renewal talk when his case is closed, whichever reply is stamped, and then opens the door', () => {
    for (const picks of [[1, 1], [2, 2], [1, 2]]) {
      const first = go(closed(at(ARENA, '', { x: 6 * TILE, y: 7 * TILE })), NONE, 1);
      expect(first.events).toContainEqual({ type: 'dialogueOpened', dialogueId: 'brain.caffeine.negotiation' });
      const done = talk(first.state, picks);
      expect(settled(done.state)).toBe(true);
      expect(go(done.state, NONE, 1).state.game.unlocked).toContain(eastDoor.id);
      // Owed once: the closed boss still stands there and opens nothing more.
      expect(go(done.state, NONE, 5).state.dialogue).toBeNull();
    }
  });

  it('greets the operator who walks in through the west door, from any row, before the first cup is thrown', () => {
    const west = door(ARENA, 'W');
    const arrival = arrivalPoint(west, OPERATOR_BODY);
    for (const dy of [-3 * TILE, 0, 3 * TILE]) {
      const s0 = at(ARENA, '', { x: arrival.x, y: arrival.y + dy });
      let s: ChapterState = s0;
      let shots = 0;
      for (let i = 0; i < 200 && !s.dialogue; i++) {
        s = stepChapter(brain, s, { move: { x: 1, y: 0 } }).state;
        shots += s.game.shots.length;
      }
      expect([dy, s.dialogue?.id, shots]).toEqual([dy, 'brain.caffeine.intro', 0]);
    }
  });

  it('states the corrected clauses with their facts, and every stamped reply cites one', () => {
    const lines = DIALOGUES.get('brain.caffeine.negotiation')!.lines;
    const text = lines.map((l) => l.text).join('');
    for (const clause of ['300 毫克', '下午三點', '紅黃綠']) expect(text).toContain(clause);
    const replies = lines.filter((l) => l.speaker === 'operator');
    expect(replies).toHaveLength(4);
    expect(replies.every((l) => l.fact !== '')).toBe(true);
  });
});

describe('the caffeine boss file with a conversation to open', () => {
  const load = (edit: (c: typeof CAFFEINE_RAW) => void) => () => {
    const c = structuredClone(CAFFEINE_RAW);
    edit(c);
    return loadBossTable([c, TOAST_RAW], ENEMIES, PARAMS_C);
  };

  it('reads concedeDialogue as optional on the caffeine boss and still requires it on the toast boss', () => {
    expect(BOSSES.get('caffeine')!.concedeDialogue).toBe('brain.caffeine.negotiation');
    expect(load((c) => { delete c.concedeDialogue; })).not.toThrow();
    const noToastTalk = () => {
      const t = structuredClone(TOAST_RAW);
      delete t.concedeDialogue;
      return loadBossTable([CAFFEINE_RAW, t], ENEMIES, PARAMS_C);
    };
    expect(noToastTalk).toThrow(/a toast boss needs concedeDialogue/);
  });

  it('still refuses the toast boss\'s own fields on the caffeine boss', () => {
    expect(load((c) => { c.song = TOAST_RAW.song; })).toThrow(/song belongs to another behaviour; a caffeine boss does not read it/);
    expect(load((c) => { c.workOrder = TOAST_RAW.workOrder; })).toThrow(/workOrder belongs to another behaviour/);
  });
});
