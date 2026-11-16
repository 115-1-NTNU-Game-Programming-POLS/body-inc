import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOSSES, DIALOGUES, ENEMIES, PARAMS, TAGS } from '../../src/app/content.ts';
import {
  NO_INPUT, overtimeHours, parseRoom, readContent, roomsOf, selectDoorLocks, selectSwitches, startChapter, stepChapter,
  type ChapterContent, type ChapterState, type GameEvent, type TickInput, type TiledMap, type Tool,
} from '../../src/core/index.ts';
import { record } from '../../src/core/tags/causal.ts';
import { addAmount, EMPTY_TAGS } from '../../src/core/tags/store.ts';

/**
 * The highlighter's health check in the liver chapter (issue #76), played on the real maps: the
 * audit room's east wall hides the way to the liver's office, and only the highlighter finds it.
 */

const load = (p: string) => JSON.parse(readFileSync(`public/assets/maps/${p}.tmj`, 'utf8')) as TiledMap;
const chapter = readContent('chapter', JSON.parse(readFileSync('content/chapters/liver.json', 'utf8')));
const LIVER: ChapterContent = {
  chapter, rooms: new Map(roomsOf(chapter).map((p) => [p, parseRoom(p, load(p), TAGS)])),
  dialogues: DIALOGUES, dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS,
};
const WITH: readonly Tool[] = ['stamp', 'folder', 'highlighter'];
const WITHOUT: readonly Tool[] = ['stamp', 'folder'];
const PASSAGE = 5;
const HIDDEN_DOOR = 4;

function run(s: ChapterState, input: TickInput, n = 1): { state: ChapterState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    const r = stepChapter(LIVER, s, input);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

/** Stands at (x, y) facing east, holding `tool` if the run has it. */
const place = (s: ChapterState, x: number, y: number, tool = s.game.operator.tool): ChapterState =>
  ({ ...s, game: { ...s.game, touching: [], operator: { ...s.game.operator, x, y, tool, aim: { x: 1, y: 0 } } } });

const inRoom = (room: string, tools: readonly Tool[]) => startChapter(LIVER, { room, tools });
/** Beside the audit room's east wall, where the doorway would be. */
const byWall = (s: ChapterState, tool = s.game.operator.tool) => place(s, 580, 230, tool);
const EAST: TickInput = { ...NO_INPUT, move: { x: 1, y: 0 } };
/** A tap of the attack key, then hands off until the line has landed. */
const tap = (s: ChapterState) => {
  const down = run(s, { ...NO_INPUT, attack: true, attackPressed: true });
  const rest = run(down.state, NO_INPUT, 20);
  return { state: rest.state, events: [...down.events, ...rest.events] };
};
const types = (es: readonly GameEvent[]) => es.map((e) => e.type);

describe('the health check in the liver chapter', () => {
  it('the main line never needs the highlighter, and only the general affairs counter hands it over', () => {
    const needs = (p: string) => String(LIVER.rooms.get(p)!.props['needs'] ?? '');
    for (const p of ['liver/party', 'liver/factory', 'liver/rooftop', 'liver/corner', 'liver/warehouse']) expect(needs(p), p).not.toContain('highlighter');
    expect(needs('liver/audit')).toContain('highlighter');
    expect(needs('liver/office')).toContain('highlighter');
    expect(startChapter(LIVER).run.tools).not.toContain('highlighter');
    const granted = [...DIALOGUES.values()].filter((d) => JSON.stringify(d).includes('highlighter')).map((d) => d.id);
    expect(granted).toEqual(['liver.clerk']);
  });

  it('talking to the counter puts the highlighter in the pocket', () => {
    let s = place(inRoom('liver/warehouse', WITHOUT), 560, 180);
    s = { ...s, game: { ...s.game, operator: { ...s.game.operator, aim: { x: 0, y: -1 } } } };
    s = run(s, { ...NO_INPUT, interactPressed: true }).state;
    expect(s.dialogue?.id).toBe('liver.clerk');
    for (let i = 0; i < 2000 && s.dialogue; i++) s = run(s, i % 2 === 0 ? { ...NO_INPUT, interactPressed: true } : NO_INPUT).state;
    expect(s.run.tools).toContain('highlighter');
    expect(s.game.highlighter).toBe(true);
  });

  it('without the highlighter the hidden passage is wall: walking into it says nothing, and nothing else opens it', () => {
    let s = byWall(inRoom('liver/audit', WITHOUT));
    expect(selectDoorLocks(s.game)).toEqual([]);
    expect(selectSwitches(s.game)).toEqual([{ object: PASSAGE, mode: 'reveal', on: false, figure: 'none' }]);
    const pushed = run(s, EAST, 40);
    expect(types(pushed.events)).not.toContain('doorLocked');
    expect(types(pushed.events)).not.toContain('roomChanged');
    expect(pushed.state.run.roomId).toBe('liver/audit');
    // The stapler and the folder reach the wall too, but only the health check finds what is behind it.
    for (const tool of ['stapler', 'folder'] as const) {
      s = byWall(pushed.state, tool);
      const hit = tap(s);
      expect(types(hit.events), tool).not.toContain('switchChanged');
      expect(run(hit.state, EAST, 40).state.run.roomId, tool).toBe('liver/audit');
    }
  });

  it('a line across the wall finds the passage for good, through the door and back and through a forced leave', () => {
    const s = byWall(inRoom('liver/audit', WITH), 'highlighter');
    const found = tap(s);
    expect(found.events).toContainEqual({ type: 'switchChanged', object: PASSAGE, on: true, mode: 'reveal', by: 'highlighter' });
    expect(found.state.run.switches).toEqual([`liver/audit#${PASSAGE}`]);
    expect(found.state.game.doorsOpen).toContain(HIDDEN_DOOR);
    // Lit once: a second line does not light it again.
    expect(types(tap(byWall(found.state)).events)).not.toContain('switchChanged');

    const through = run(found.state, EAST, 40);
    expect(through.state.run.roomId).toBe('liver/office');
    const back = run(place(through.state, 50, 224), { ...NO_INPUT, move: { x: -1, y: 0 } }, 40).state;
    expect(back.run.roomId).toBe('liver/audit');
    expect(back.game.switches).toContain(PASSAGE);
    expect(back.game.doorsOpen).toContain(HIDDEN_DOOR);

    const dying: ChapterState = { ...found.state, game: { ...found.state.game, operator: { ...found.state.game.operator, halves: 0 } } };
    const after = run(dying, NO_INPUT);
    expect(types(after.events)).toContain('forcedLeave');
    expect(after.state.run.switches).toContain(`liver/audit#${PASSAGE}`);
  });

  it('a circle finds it as well', () => {
    const s = byWall(inRoom('liver/audit', WITH), 'highlighter');
    const held = run(s, { ...NO_INPUT, attack: true, attackPressed: true });
    const circled = run(held.state, { ...NO_INPUT, attack: true }, 40);
    expect([...held.events, ...circled.events]).toContainEqual({ type: 'switchChanged', object: PASSAGE, on: true, mode: 'reveal', by: 'highlighter' });
  });

  it('in the office, the line at the liver finds his overtime and opens the sticky note once', () => {
    const s = place(inRoom('liver/office', WITH), 250, 176, 'highlighter');
    expect(selectSwitches(s.game)).toEqual([{ object: 4, mode: 'reveal', on: false, figure: 'liver_overtime' }]);
    const found = run(s, { ...NO_INPUT, attack: true, attackPressed: true }, 6);
    expect(types(found.events)).toContain('switchChanged');
    expect(found.state.dialogue?.id).toBe('liver.office.found');
    expect(found.state.run.fired).toContain('liver/office#4');
    let closed = found.state;
    for (let i = 0; i < 2000 && closed.dialogue; i++) closed = run(closed, i % 2 === 0 ? { ...NO_INPUT, interactPressed: true } : NO_INPUT).state;
    expect(closed.dialogue).toBeNull();
    const again = tap(place(closed, 250, 176));
    expect(again.state.dialogue).toBeNull();
  });

  it('his overtime is what the first line still has to work through, in game hours', () => {
    expect(overtimeHours(EMPTY_TAGS, TAGS, PARAMS)).toBe(0);
    const [log, cause] = record(EMPTY_TAGS.log, { kind: 'event', key: 'test', at: 0 });
    const two = addAmount({ ...EMPTY_TAGS, log }, TAGS, 'alcohol', 2, cause, 0);
    expect(overtimeHours(two, TAGS, PARAMS)).toBe(Math.round((2 / PARAMS.liverRate) * 10) / 10);
  });
});
