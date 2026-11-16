import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOSSES, DIALOGUES, ENEMIES, PARAMS, TAGS } from '../../src/app/content.ts';
import {
  circleCentre, createGame, FOLDER, GAUGE, HIGHLIGHTER, isMarked, loadEnemyTable, NO_INPUT, parseRoom, readContent, roomsOf, selectTool, startChapter,
  step, stepChapter, TICK_HZ, TILE,
  type ChapterContent, type DomainEvent, type EnteredRoom, type EnemyState, type GameState, type TickInput, type TiledMap,
} from '../../src/core/index.ts';
import { withTools } from '../../src/core/chapter/talk.ts';

const TABLE = loadEnemyTable(JSON.parse(readFileSync('content/enemies.json', 'utf8')));
const START = { x: 160, y: 192 };
const RIGHT = { x: 1, y: 0 };

/** Open 20 x 12 room with a one-tile border; PlayerStart at (160, 192). */
function room(spawns: { type: string; x: number; y: number }[] = []): EnteredRoom {
  const cols = 20;
  const rows = 12;
  const solid = Array.from({ length: cols * rows }, (_, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    return c === 0 || r === 0 || c === cols - 1 || r === rows - 1;
  });
  return {
    id: 'test', grid: { cols, rows, solid }, props: {}, variants: [], active: [],
    objects: [
      { id: 1, kind: 'PlayerStart', name: '', ...START, width: 0, height: 0, props: {}, conditions: {} },
      ...spawns.map((s, i) => ({
        id: 10 + i, kind: 'Spawn', name: '', x: s.x, y: s.y, width: 0, height: 0, conditions: {},
        props: { enemyType: s.type, count: 1, respawnSeconds: 0, when: '' },
      })),
    ],
  };
}

/** The highlighter handed over and in hand, aimed right. */
function penGame(spawns: Parameters<typeof room>[0] = [], p = 1): GameState {
  const g = createGame(room(spawns), 1, TABLE, { highlighter: true, tool: 'highlighter', p });
  return { ...g, operator: { ...g.operator, aim: RIGHT } };
}
const press = (extra: Partial<TickInput> = {}): TickInput => ({ ...NO_INPUT, ...extra });
const tap = (...ticks: number[]) => (t: number): TickInput => press({ attack: ticks.includes(t), attackPressed: ticks.includes(t) });
/** The attack key pressed on `from` and held through `to`. */
const held = (from: number, to = Infinity) => (t: number): TickInput => press({ attack: t >= from && t <= to, attackPressed: t === from });

interface Run { state: GameState; events: DomainEvent[][] }
function run(state: GameState, ticks: number, input: (t: number, s: GameState) => TickInput = () => NO_INPUT): Run {
  const events: DomainEvent[][] = [];
  let s = state;
  for (let t = 0; t < ticks; t++) {
    const r = step(s, input(t, s));
    s = r.state;
    events.push([...r.events]);
  }
  return { state: s, events };
}
const ofType = <T extends DomainEvent['type']>(r: Run, type: T) =>
  r.events.flat().filter((e): e is Extract<DomainEvent, { type: T }> => e.type === type);
const firstTick = (r: Run, type: DomainEvent['type']) => r.events.findIndex((es) => es.some((e) => e.type === type));
const enemy = (s: GameState, id = 1): EnemyState => s.enemies.find((e) => e.id === id)!;
/** A dummy (performance 6, stands still) `tiles` to the right of the operator's feet. */
const dummyAt = (tiles: number) => ({ type: 'dummy', x: START.x + tiles * TILE, y: START.y });
/** The game with enemy `id` marked until `until`. */
const marked = (g: GameState, until: number, id = 1): GameState =>
  ({ ...g, enemies: g.enemies.map((e) => (e.id === id ? { ...e, markedUntil: until } : e)) });

describe('swapping through three tools (issue #76, decision 2)', () => {
  const three = () => createGame(room(), 1, TABLE, { highlighter: true });

  it('F visits the stapler, the folder and the highlighter in turn', () => {
    const r = run(three(), 60, (t) => press({ swapPressed: t % 15 === 0 }));
    expect(ofType(r, 'toolSwapped').map((e) => e.tool)).toEqual(['folder', 'highlighter', 'stapler', 'folder']);
  });

  it('presses during a hit-stop each go one step on, and a press that comes round to the tool in hand takes it back', () => {
    const frozen = (n: number) => run({ ...three(), freeze: 6 }, 20, (t) => press({ swapPressed: t < n }));
    // Two presses: two steps, done in one swap once the hit-stop ends.
    expect(ofType(frozen(2), 'toolSwapped').map((e) => e.tool)).toEqual(['highlighter']);
    // Three presses come round to the stapler: nothing to swap.
    expect(ofType(frozen(3), 'toolSwapped')).toEqual([]);
    expect(frozen(3).state.operator.tool).toBe('stapler');
    // With two tools a second press still takes the first back, as before the highlighter.
    const two = run({ ...createGame(room(), 1, TABLE), freeze: 6 }, 20, (t) => press({ swapPressed: t < 2 }));
    expect(ofType(two, 'toolSwapped')).toEqual([]);
  });

  it('with the folder still locked, F goes between the stapler and the highlighter', () => {
    const g = createGame(room(), 1, TABLE, { highlighter: true, folderLocked: true });
    expect(selectTool(g).canSwap).toBe(true);
    const r = run(g, 30, (t) => press({ swapPressed: t % 10 === 0 }));
    expect(ofType(r, 'toolSwapped').map((e) => e.tool)).toEqual(['highlighter', 'stapler', 'highlighter']);
  });

  it('is never in hand before it is handed over', () => {
    expect(createGame(room(), 1, TABLE, { tool: 'highlighter' }).operator.tool).toBe('stapler');
    const r = run(createGame(room(), 1, TABLE), 30, (t) => press({ swapPressed: t % 10 === 0 }));
    expect(ofType(r, 'toolSwapped').map((e) => e.tool)).not.toContain('highlighter');
  });
});

describe('the line (design doc 6.1)', () => {
  it('lands on frame 4, within the light-attack cap of 6, for 1.5', () => {
    expect(HIGHLIGHTER.hitFrame).toBeLessThanOrEqual(6);
    const r = run(penGame([dummyAt(1.5)]), 20, tap(0));
    expect(firstTick(r, 'lineDrawn')).toBe(0);
    expect(firstTick(r, 'hit')).toBe(HIGHLIGHTER.hitFrame - 1);
    expect(ofType(r, 'hit').map((e) => e.hpLeft)).toEqual([6 - HIGHLIGHTER.damage]);
  });

  it('pierces: every enemy it crosses is hit, and none past its end', () => {
    const r = run(penGame([dummyAt(1), dummyAt(2.5), dummyAt(5)]), 20, tap(0));
    expect(ofType(r, 'hit').map((e) => e.target)).toEqual([1, 2]);
  });

  it('charges 1.5 a hit before P, and nothing on an immune bounce', () => {
    expect(GAUGE.highlighter).toBe(1.5);
    expect(run(penGame([dummyAt(1), dummyAt(2)], 0.5), 20, tap(0)).state.operator.gauge).toBeCloseTo(2 * 1.5 * 0.5, 6);
    const bounce = run(penGame([{ type: 'cold_virus', x: START.x + 1.5 * TILE, y: START.y }]), 20, tap(0));
    expect(ofType(bounce, 'immuneBounce')).toHaveLength(1);
    expect(ofType(bounce, 'hit')).toEqual([]);
    expect(bounce.state.operator.gauge).toBe(0);
  });

  it('scatters a reforming enemy, like a staple', () => {
    const r = run(penGame([{ type: 'adenosine', x: START.x + 1.5 * TILE, y: START.y }]), 20, tap(0));
    expect(ofType(r, 'dispersed')).toHaveLength(1);
  });

  it('stands still, and only its recovery gives way to a dodge', () => {
    const early = run(penGame(), 30, (t) => press({ attack: t === 0, attackPressed: t === 0, dodgePressed: t === 1 }));
    // Pressed on frame 2, the dodge waits until the frame after the line has landed, as after a swing.
    expect(firstTick(early, 'dodge')).toBe(HIGHLIGHTER.hitFrame);
    const g = run(penGame(), 10, (t) => press({ attack: t === 0, attackPressed: t === 0, move: RIGHT })).state;
    expect(g.operator.x).toBe(START.x);
  });

  it('is never doubled by a mark', () => {
    const r = run(marked(penGame([dummyAt(1.5)]), 1e6), 20, tap(0));
    expect(ofType(r, 'hit').map((e) => e.hpLeft)).toEqual([6 - HIGHLIGHTER.damage]);
  });
});

describe('the circle and the mark (issue #76, decisions 3 and 5)', () => {
  /** A dummy standing at the circle's centre. */
  const atCentre = () => {
    const c = circleCentre({ ...START, aim: RIGHT });
    return { type: 'dummy', x: c.x, y: c.y };
  };

  it('a hold draws one circle that marks a defeatable enemy for 8 seconds, without charging the gauge for it', () => {
    const r = run(penGame([atCentre()]), 200, held(0));
    expect(ofType(r, 'circleDrawn')).toHaveLength(1);
    expect(ofType(r, 'marked').map((e) => e.target)).toEqual([1]);
    const at = firstTick(r, 'marked');
    const e = enemy(r.state);
    expect(e.markedUntil).toBe(at + HIGHLIGHTER.markTicks);
    expect(HIGHLIGHTER.markTicks).toBe(8 * TICK_HZ);
    // The line of the same press hit it once; the circle added nothing to the gauge.
    expect(ofType(r, 'hit')).toHaveLength(1);
    expect(r.state.operator.gauge).toBeCloseTo(GAUGE.highlighter, 6);
  });

  it('a key kept down draws one circle, however long it stays down', () => {
    expect(ofType(run(penGame(), 3 * HIGHLIGHTER.circleCooldownTicks, held(0)), 'circleDrawn')).toHaveLength(1);
  });

  it('a tap draws no circle', () => {
    expect(ofType(run(penGame([atCentre()]), 60, tap(0)), 'circleDrawn')).toEqual([]);
  });

  it('cools down: a second hold within the cooldown draws nothing, one after it draws again', () => {
    const second = (at: number) => run(penGame([atCentre()]), at + 60, (t) => press({ attack: t <= 30 || t >= at, attackPressed: t === 0 || t === at }));
    expect(ofType(second(60), 'circleDrawn')).toHaveLength(1);
    expect(ofType(second(HIGHLIGHTER.circleCooldownTicks + 40), 'circleDrawn')).toHaveLength(2);
  });

  it('an immune enemy bounces it and a reforming one scatters, so neither carries a mark', () => {
    const c = circleCentre({ ...START, aim: RIGHT });
    // Far enough down that the line of the press misses them, but inside the circle.
    const below = (type: string) => ({ type, x: c.x, y: c.y + TILE });
    const r = run(penGame([below('cold_virus'), below('adenosine')]), 200, held(0));
    expect(ofType(r, 'marked')).toEqual([]);
    expect(ofType(r, 'immuneBounce').map((e) => e.target)).toEqual([1]);
    expect(ofType(r, 'dispersed').map((e) => e.target)).toEqual([2]);
    expect(r.state.enemies.every((e) => e.markedUntil === undefined)).toBe(true);
  });

  it('while marked, a staple counts double, and after the mark it is back to one', () => {
    const stapler = (until: number) => {
      const g = createGame(room([dummyAt(3)]), 1, TABLE);
      return run(marked({ ...g, operator: { ...g.operator, aim: RIGHT } }, until), 40, tap(0));
    };
    expect(ofType(stapler(1e6), 'hit').map((e) => e.hpLeft)).toEqual([6 - 2]);
    expect(ofType(stapler(0), 'hit').map((e) => e.hpLeft)).toEqual([6 - 1]);
  });

  it('while marked, a swing of the folder counts double', () => {
    const g = createGame(room([{ type: 'dummy', x: START.x + 20, y: START.y }]), 1, TABLE, { tool: 'folder' });
    const r = run(marked({ ...g, operator: { ...g.operator, aim: RIGHT } }, 1e6), 20, tap(0));
    expect(ofType(r, 'hit').map((e) => e.hpLeft)).toEqual([6 - 2 * FOLDER.damage[0]!]);
  });

  it('the mark ends on its tick', () => {
    expect(isMarked({ markedUntil: 100 }, 99)).toBe(true);
    expect(isMarked({ markedUntil: 100 }, 100)).toBe(false);
    expect(isMarked({}, 0)).toBe(false);
  });
});

describe('the highlighter in the story', () => {
  const content = (id: string): ChapterContent => {
    const chapter = readContent('chapter', JSON.parse(readFileSync(`content/chapters/${id}.json`, 'utf8')));
    const load = (p: string) => JSON.parse(readFileSync(`public/assets/maps/${p}.tmj`, 'utf8')) as TiledMap;
    return { chapter, rooms: new Map(roomsOf(chapter).map((p) => [p, parseRoom(p, load(p), TAGS)])), dialogues: DIALOGUES, dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS };
  };

  it('the liver chapter hands it over, and no chapter before it does', () => {
    const liver = startChapter(content('liver'));
    expect(liver.run.tools).toContain('highlighter');
    expect(liver.game.highlighter).toBe(true);
    for (const id of ['prologue', 'brain', 'stomach', 'midterm']) {
      const s = startChapter(content(id), { tools: ['stamp', 'folder'] });
      expect(s.run.tools, id).not.toContain('highlighter');
      expect(s.game.highlighter, id).toBeUndefined();
    }
  });

  it('a grant puts it in the pocket, and F takes it out', () => {
    const ctx = content('stomach');
    const s = startChapter(ctx);
    const granted = withTools({ run: s.run, game: s.game, events: [{ type: 'toolGranted', tool: 'highlighter' }] });
    expect(granted.run.tools).toContain('highlighter');
    expect(granted.game.highlighter).toBe(true);
    expect(granted.game.operator.tool).toBe('stapler');
    const { pending: _, ...open } = { ...s, run: granted.run, game: granted.game };
    let state = open;
    const tools: string[] = [];
    for (let t = 0; t < 40; t++) {
      state = stepChapter(ctx, state, press({ swapPressed: t % 15 === 0 })).state;
      tools.push(state.game.operator.tool);
    }
    expect([...new Set(tools)]).toEqual(['folder', 'highlighter', 'stapler']);
  });
});
