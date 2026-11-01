import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOSSES, DECKS, DIALOGUES, ENEMIES, PARAMS, TAGS } from '../../src/app/content.ts';
import {
  parseRoom, readContent, startChapter, stepChapter, type ChapterContent, type ChapterState, type GameEvent, type TickInput, type TiledMap,
} from '../../src/core/index.ts';

const CHAPTER = readContent('chapter', JSON.parse(readFileSync('content/chapters/greybox.json', 'utf8')));
const p = (name: string, value: string | number | boolean) => ({ name, value });
const NONE: TickInput = { move: { x: 0, y: 0 } };

/** A bare room with an adenosine at (200, 200), the operator at `startX`, and a rest area when `pen` is given as [x, y, w, h]. */
function room(startX: number, pen?: readonly [number, number, number, number]): ChapterContent {
  const objects: object[] = [
    { id: 1, type: 'PlayerStart', x: startX, y: 200 },
    { id: 2, type: 'Spawn', x: 200, y: 200, properties: [p('enemyType', 'adenosine')] },
    ...(pen ? [{ id: 3, type: 'Pen', x: pen[0], y: pen[1], width: pen[2], height: pen[3] }] : []),
  ];
  const map = {
    width: 20, height: 12, tilewidth: 32, tileheight: 32,
    properties: [{ name: 'organ', value: 'lobby' }, { name: 'role', value: 'rest' }, { name: 'estSeconds', value: 10 }],
    layers: [{ type: 'tilelayer', name: 'walls', data: new Array(240).fill(0) }, { type: 'objectgroup', name: 'objects', objects }],
  } as unknown as TiledMap;
  return {
    chapter: { ...CHAPTER, id: 'lab', start: 'lab/room', links: [] },
    rooms: new Map([['lab/room', parseRoom('lab/room', map, TAGS)]]),
    dialogues: DIALOGUES, dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS, deck: DECKS.get('greybox')!,
  };
}

function run(ctx: ChapterContent, ticks: number): { state: ChapterState; events: GameEvent[] } {
  let state = startChapter(ctx);
  const events: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    const r = stepChapter(ctx, state, NONE);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

const adenosine = (s: ChapterState) => s.game.enemies.find((e) => e.type === 'adenosine')!;

describe('the rest area of the brain patrol (design doc 8.5)', () => {
  it('locks an adenosine that stands in it, once and for good', () => {
    const { state, events } = run(room(480, [160, 160, 96, 96]), 300);
    expect(adenosine(state).phase).toBe('closed');
    expect(events.filter((e) => e.type === 'caseClosed')).toHaveLength(1);
    expect(state.game.operator.stacks).toBe(0);
  });

  it('leaves it be without the area: it drifts to the operator and clings', () => {
    const { state, events } = run(room(260), 300);
    expect(events.some((e) => e.type === 'caseClosed')).toBe(false);
    expect(adenosine(state).phase).not.toBe('closed');
    expect(events.some((e) => e.type === 'clung')).toBe(true);
  });

  it('locks one that drifts in on its way to the operator, before it can reach them', () => {
    // The area sits between the adenosine (x 200) and the operator (x 330) and spans the whole height of the way.
    const { state, events } = run(room(330, [232, 150, 40, 120]), 400);
    expect(adenosine(state).phase).toBe('closed');
    expect(events.some((e) => e.type === 'clung')).toBe(false);
  });
});
