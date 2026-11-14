import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOSSES, CHAPTERS, DIALOGUES, ENEMIES, HANDBOOK, PARAMS, RESCUES, TAGS } from '../../src/app/content.ts';
import { tagsFromQuery } from '../../src/app/session.ts';
import {
  amount, holds, parseRoom, roomsOf, selectDialogue, startChapter, stepChapter,
  type ChapterContent, type ChapterState, type GameEvent, type TickInput, type TiledMap,
} from '../../src/core/index.ts';
import { compileCondition } from '../../src/core/tags/dictionary.ts';

/**
 * The stomach chapter's story layer (design doc 7.5): the intro, the logistics chief who unlocks
 * 〈消化需要時間〉 once he has been asked how he is in all three labs, and the snack boss's
 * concession that rewrites his business hours and hands over 〈睡前進食與睡眠〉.
 */

const NONE: TickInput = { move: { x: 0, y: 0 } };
const CHAPTER = CHAPTERS.get('stomach')!;
const loadMap = (path: string) => JSON.parse(readFileSync(`public/assets/maps/${path}.tmj`, 'utf8')) as TiledMap;
const STOMACH: ChapterContent = {
  chapter: CHAPTER,
  rooms: new Map(roomsOf(CHAPTER).map((p) => [p, parseRoom(p, loadMap(p), TAGS)])),
  dialogues: DIALOGUES, dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS, rescues: RESCUES,
};
const tags = (q: string) => tagsFromQuery(`?tags=${q}`, TAGS);
const has = (s: ChapterState, cond: string) => holds(s.run.tags, TAGS, compileCondition(TAGS, cond));

function at(room: string, q = '', place?: { x: number; y: number }): ChapterState {
  const { pending: _, ...s } = startChapter(STOMACH, { room, ...(q ? { tags: tags(q) } : {}) });
  return place ? { ...s, game: { ...s.game, operator: { ...s.game.operator, x: place.x, y: place.y } } } : s;
}

function go(s: ChapterState, input: TickInput, n: number): { state: ChapterState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    const r = stepChapter(STOMACH, s, input);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

/** Talks through the open conversation; at the n-th choice it picks `picks[n]` (1-based), at the first reply by default. */
function talk(s: ChapterState, picks: readonly number[] = []): { state: ChapterState; events: GameEvent[]; said: string[] } {
  const events: GameEvent[] = [];
  const said: string[] = [];
  let choice = -1;
  let seenAt = -1;
  for (let i = 0; i < 600 && s.dialogue; i++) {
    const view = selectDialogue(DIALOGUES, s.dialogue);
    const offered = (view?.options.length ?? 0) > 0;
    if (view?.line && said.at(-1) !== view.line.text) said.push(view.line.text);
    if (offered && s.dialogue.at !== seenAt) { choice++; seenAt = s.dialogue.at; }
    const pick = offered ? picks[choice] ?? 1 : 0;
    const r = stepChapter(STOMACH, s, { ...NONE, interactPressed: !offered && i % 2 === 0, ...(offered && i % 2 === 0 ? { pick } : {}) });
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events, said };
}

const LABS = [
  ['stomach/mixer-lab', 'stomach.chief.mixer', 'chief_mixer'],
  ['stomach/sorting-lab', 'stomach.chief.sorting', 'chief_sorting'],
  ['stomach/night-lab', 'stomach.chief.night', 'chief_night'],
] as const;

/** Walks up to the chief in `room` with the tags `q` and opens his conversation. */
function visitChief(room: string, q = ''): { state: ChapterState; events: GameEvent[] } {
  const chief = STOMACH.rooms.get(room)!.objects.find((o) => o.kind === 'NPC')!;
  return go(at(room, q, { x: chief.x + 20, y: chief.y }), { ...NONE, interactPressed: true }, 1);
}
const unlockedPages = (events: readonly GameEvent[]) => events.flatMap((e) => (e.type === 'handbookUnlocked' ? [e.id] : []));

describe('the stomach chapter intro', () => {
  it('opens on the first tick of the chapter, in the mixer lab', () => {
    expect(CHAPTER.intro).toBe('stomach.intro');
    const s = startChapter(STOMACH, { room: CHAPTER.start });
    expect(s.pending).toBe('stomach.intro');
    const first = stepChapter(STOMACH, s, NONE);
    expect(first.events).toContainEqual({ type: 'dialogueOpened', dialogueId: 'stomach.intro' });
  });
});

describe('the logistics chief in the three labs', () => {
  it('stands in each lab with that lab\'s conversation', () => {
    for (const [room, id] of LABS) {
      const chiefs = STOMACH.rooms.get(room)!.objects.filter((o) => o.kind === 'NPC');
      expect([room, chiefs.map((o) => [o.props['npcId'], o.props['dialogueId']])]).toEqual([room, [['stomach', id]]]);
    }
  });

  it('asking how he is counts one talk and marks the lab; passing by sets nothing', () => {
    for (const [room, id, tag] of LABS) {
      const opened = visitChief(room);
      expect(opened.events).toContainEqual({ type: 'dialogueOpened', dialogueId: id });
      const asked = talk(opened.state, [1]).state;
      expect([room, has(asked, tag), amount(asked.run.tags, TAGS, 'chief_talks')]).toEqual([room, true, 1]);
      const passed = talk(visitChief(room).state, [2]).state;
      expect([room, has(passed, tag), amount(passed.run.tags, TAGS, 'chief_talks')]).toEqual([room, false, 0]);
    }
  });

  it('a lab already asked about gets one short line and counts nothing more', () => {
    for (const [room, , tag] of LABS) {
      const again = talk(visitChief(room, `${tag},chief_talks:1`).state);
      expect([room, again.said.length, amount(again.state.run.tags, TAGS, 'chief_talks')]).toEqual([room, 1, 1]);
      expect(unlockedPages(again.events)).toEqual([]);
    }
  });

  it('the third lab asked about, in any order, hands over 〈消化需要時間〉; the first two do not', () => {
    expect(HANDBOOK.pages.map((p) => p.id)).toContain('digestion');
    for (const [room, , tag] of LABS) {
      const others = LABS.filter(([, , t]) => t !== tag).map(([, , t]) => t);
      const third = talk(visitChief(room, `${others.join(',')},chief_talks:2`).state, [1]);
      expect([room, unlockedPages(third.events)]).toEqual([room, ['digestion']]);
      expect(amount(third.state.run.tags, TAGS, 'chief_talks')).toBe(3);
      const second = talk(visitChief(room, `${others[0]},chief_talks:1`).state, [1]);
      expect([room, unlockedPages(second.events)]).toEqual([room, []]);
    }
  });
});

describe('the snack boss gives up (design doc 7.5)', () => {
  const ARENA = 'stomach/boss-arena';
  const conceded = (s: ChapterState): ChapterState => ({
    ...s, game: { ...s.game, enemies: s.game.enemies.map((e) => (e.boss ? { ...e, hp: 0, phase: 'closed' as const } : e)) },
  });

  it('his closed case opens the concession once, which sets snack_settled and hands over 〈睡前進食與睡眠〉', () => {
    const s0 = at(ARENA);
    expect(s0.game.enemies.some((e) => e.boss?.behaviour === 'snack')).toBe(true);
    // Standing in front of him is not enough; the case has to be closed.
    expect(go(s0, NONE, 5).events.map((e) => e.type)).not.toContain('dialogueOpened');
    const first = go(conceded(s0), NONE, 1);
    expect(first.events).toContainEqual({ type: 'dialogueOpened', dialogueId: 'stomach.snack.concede' });
    const talked = talk(first.state);
    expect(has(talked.state, 'snack_settled')).toBe(true);
    expect(unlockedPages(talked.events)).toEqual(['eating_before_sleep']);
    expect(talked.said.at(-1)).toContain('室友聚會照常歡迎');
    expect(go(talked.state, NONE, 5).state.dialogue).toBeNull();
  });

  it('every way through his replies ends on the same contract', () => {
    for (const picks of [[1, 1, 1], [2, 2, 2], [1, 2, 1], [2, 1, 2]]) {
      const talked = talk(go(conceded(at(ARENA)), NONE, 1).state, picks);
      expect([picks, has(talked.state, 'snack_settled'), unlockedPages(talked.events)]).toEqual([picks, true, ['eating_before_sleep']]);
    }
  });
});
