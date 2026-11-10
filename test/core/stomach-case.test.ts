import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOSSES, CHAPTERS, DIALOGUES, ENEMIES, HANDBOOK, PARAMS, RESCUES, TAGS } from '../../src/app/content.ts';
import {
  holds, parseRoom, roomsOf, startChapter, stepChapter,
  type ChapterContent, type ChapterFile, type ChapterState, type GameEvent, type TickInput, type TiledMap,
} from '../../src/core/index.ts';
import { compileCondition } from '../../src/core/tags/dictionary.ts';

/**
 * The sugar salesman's closed case in the stomach chapter (design doc 7.5): once his case is
 * closed he stays out of the room on later visits, and the handbook page 〈糖分與疲倦〉 comes with
 * the closing, whichever way the staple that closed it was fired.
 */

const NONE: TickInput = { move: { x: 0, y: 0 } };
const CHAPTER = CHAPTERS.get('stomach')!;
const ROOM = 'stomach/mixer-lab';
const loadMap = (path: string) => JSON.parse(readFileSync(`public/assets/maps/${path}.tmj`, 'utf8')) as TiledMap;
const content = (chapter: ChapterFile): ChapterContent => ({
  chapter,
  rooms: new Map(roomsOf(chapter).map((p) => [p, parseRoom(p, loadMap(p), TAGS)])),
  dialogues: DIALOGUES, dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS, rescues: RESCUES,
});
const STOMACH = content(CHAPTER);

const seller = (s: ChapterState) => s.game.enemies.find((e) => e.type === 'sugar_seller');
const closed = (s: ChapterState) => holds(s.run.tags, TAGS, compileCondition(TAGS, 'sugar_seller_closed'));

/** A fresh visit to the mixer lab, with the salesman one staple from closing and in front of an operator aiming at him. */
function nearlyClosed(c: ChapterContent = STOMACH): ChapterState {
  const { pending: _, ...s } = startChapter(c, { room: ROOM });
  const at = seller(s)!;
  const enemies = s.game.enemies.map((e) => (e.id === at.id ? { ...e, x: 400, y: 288, hp: 1 } : e));
  return { ...s, game: { ...s.game, enemies, operator: { ...s.game.operator, x: 360, y: 288, aim: { x: 1, y: 0 } } } };
}

function fire(c: ChapterContent, s: ChapterState, ticks = 60): { state: ChapterState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    const r = stepChapter(c, s, { ...NONE, attack: true, attackPressed: i === 0 });
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

describe('the sugar salesman\'s closed case (design doc 7.5)', () => {
  it('is wired in the chapter file: his flag is a chapter boolean and his page is in the handbook', () => {
    expect(CHAPTER.closedCases).toEqual({ sugar_seller: 'sugar_seller_closed' });
    expect(CHAPTER.caseDrops).toEqual({ sugar_seller: 'sugar_fatigue' });
    expect(HANDBOOK.pages.map((p) => p.id)).toContain('sugar_fatigue');
    expect(TAGS.tags.get('sugar_seller_closed')?.sources).toEqual(['chapter']);
  });

  it('closing his case hands over the page once and sets the flag, both logged under the case', () => {
    const r = fire(STOMACH, nearlyClosed());
    expect(r.events.map((e) => e.type)).toContain('caseClosed');
    expect(r.events.filter((e) => e.type === 'handbookUnlocked')).toEqual([{ type: 'handbookUnlocked', id: 'sugar_fatigue' }]);
    expect(closed(r.state)).toBe(true);
    const keys = r.state.run.tags.log.nodes.map((n) => `${n.kind}:${n.key}`);
    expect(keys).toContain('event:case.sugar_seller');
    expect(keys).toContain('effect:unlock.sugar_fatigue');
  });

  it('keeps him out of the room on every later visit', () => {
    const after = fire(STOMACH, nearlyClosed()).state;
    const { pending: _, ...again } = startChapter(STOMACH, { room: ROOM, tags: after.run.tags });
    expect(seller(again)).toBeUndefined();
    expect(seller(startChapter(STOMACH, { room: ROOM }) as ChapterState)).toBeDefined();
  });

  it('a chapter file with only the drop gives the page and no flag, and one with neither gives neither', () => {
    const { closedCases: _a, ...onlyDrop } = CHAPTER;
    const dropped = fire(content(onlyDrop), nearlyClosed(content(onlyDrop)));
    expect(dropped.events.filter((e) => e.type === 'handbookUnlocked')).toHaveLength(1);
    expect(closed(dropped.state)).toBe(false);

    const { closedCases: _b, caseDrops: _c, ...plain } = CHAPTER;
    const nothing = fire(content(plain), nearlyClosed(content(plain)));
    expect(nothing.events.map((e) => e.type)).toContain('caseClosed');
    expect(nothing.events.map((e) => e.type)).not.toContain('handbookUnlocked');
    expect(closed(nothing.state)).toBe(false);
  });

  it('an enemy the chapter does not list drops nothing', () => {
    const s = nearlyClosed();
    const only = { ...CHAPTER, caseDrops: { energy_seller: 'sugar_fatigue' } };
    const r = fire(content(only), s);
    expect(r.events.map((e) => e.type)).toContain('caseClosed');
    expect(r.events.map((e) => e.type)).not.toContain('handbookUnlocked');
  });
});
