import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOSSES, CHAPTERS, DECKS, DIALOGUES, ENEMIES, PARAMS, RESCUES, TAGS } from '../../src/app/content.ts';
import { tagsFromQuery } from '../../src/app/session.ts';
import {
  amount, arrivalPoint, holds, loadBossTable, parseRoom, readContent, roomsOf, selectDialogue, startChapter, stepChapter, TILE,
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
    // The midterm reads these two readiness tags, which the closing card of this chapter sets.
    const study = DECKS.get('brain')!.closing.find((c) => c.id === 'study_week')!;
    expect(JSON.stringify(study.options.map((o) => o.effects))).toMatch(/exam_practice[\s\S]*exam_archived/);
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

  it('ends the chapter at the sleep door only once the caffeine residue is below 15', () => {
    const bed = brain.rooms.get('brain/rooftop')!.objects.find((o) => o.kind === 'Bed')!;
    expect(bed.props['requires']).toBe('caffeine<15');
    const bedPlace = { x: bed.x + bed.width / 2, y: bed.y + bed.height / 2 };
    const sleep = (q: string) => go(at('brain/rooftop', q, bedPlace), { ...NONE, interactPressed: true }, 1);
    expect(sleep('caffeine:50').events.map((e) => e.type)).not.toContain('chapterEnded');
    expect(sleep('caffeine:10').events.map((e) => e.type)).toContain('chapterEnded');
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
