import { describe, expect, it } from 'vitest';
import { BOSSES, DIALOGUES, ENEMIES, PARAMS, TAGS } from '../../src/app/content.ts';
import { readFileSync } from 'node:fs';
import {
  amount, createGame, loadEnemyTable, MOVE, NO_INPUT, parseRoom, selectFatigue, startChapter, step, stepChapter, SUGAR_FOG, TICK_HZ,
  type ChapterContent, type ChapterState, type DomainEvent, type EnteredRoom, type GameEvent, type GameState, type TickInput, type TiledMap,
} from '../../src/core/index.ts';
import type { Shot } from '../../src/core/combat/hazards.ts';

/**
 * The sugar salesman's fatigue fog (design doc 7.5): his tea costs no heart, and drinking it slows
 * the operator by 15% for 45 seconds. The shrunk view is the view's business and not tested here.
 */

const START = { x: 160, y: 192 };

/** Open 20 x 12 room with a one-tile border, as in folder.test.ts; PlayerStart at (160, 192). */
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

interface Run { state: GameState; events: DomainEvent[][] }
function run(state: GameState, ticks: number, input: (t: number) => TickInput = () => NO_INPUT): Run {
  const events: DomainEvent[][] = [];
  let s = state;
  for (let t = 0; t < ticks; t++) {
    const r = step(s, input(t));
    s = r.state;
    events.push([...r.events]);
  }
  return { state: s, events };
}
const ofType = <T extends DomainEvent['type']>(r: Run, type: T) =>
  r.events.flat().filter((e): e is Extract<DomainEvent, { type: T }> => e.type === type);
const firstTick = (r: Run, type: DomainEvent['type']) => r.events.findIndex((es) => es.some((e) => e.type === type));

const seller = (tool: 'stapler' | 'folder' = 'stapler') => {
  const g = createGame(room([{ type: 'sugar_seller', x: START.x + 4 * 32, y: START.y }]), 1, ENEMIES, { tool });
  return { ...g, operator: { ...g.operator, aim: { x: 1, y: 0 } } };
};
const bare = (fatigue?: number) => createGame(room(), 1, ENEMIES, fatigue === undefined ? {} : { fatigue });
/** A tea flying left at `x`, level with the operator, from a thrower that is not in the room. */
const tea = (x: number, y: number, extra: Partial<Shot> = {}): Shot =>
  ({ id: 900, owner: 99, kind: 'tea', x, y, vx: -2, vy: 0, ticksLeft: 60, halves: 0, drink: 'tea', half: 3, spent: false, ...extra });
const withShot = (g: GameState, sh: Shot): GameState => ({ ...g, shots: [...g.shots, sh] });

describe('the sugar salesman\'s tea', () => {
  it('is drunk, not taken as a hit: no heart, no knockback, no freeze, and the fog at its full 45 seconds', () => {
    const r = run(seller(), 200);
    const h = firstTick(r, 'teaTaken');
    expect(h).toBeGreaterThan(20);
    expect(ofType(r, 'teaTaken')[0]).toEqual({ type: 'teaTaken', source: 1 });
    expect(ofType(r, 'heartLost')).toEqual([]);
    expect(ofType(r, 'freeze')).toEqual([]);
    expect(ofType(r, 'canTaken')).toEqual([]);
    expect(r.state.operator.x).toBe(START.x);
    expect(r.state.operator.halves).toBe(r.state.operator.maxHalves);
    expect(run(seller(), h + 1).state.operator.fatigue).toBe(SUGAR_FOG.ticks);
    const flying = run(seller(), h - 4).state.shots.find((s) => s.drink === 'tea');
    expect(flying).toMatchObject({ kind: 'tea', halves: 0 });
    expect(run(seller(), h - 4).state.operator.fatigue).toBeUndefined();
  });

  it('runs out after 45 seconds as if never drunk, and another tea starts it over', () => {
    const near = run(bare(SUGAR_FOG.ticks), SUGAR_FOG.ticks - 1).state;
    expect(near.operator.fatigue).toBe(1);
    const out = run(near, 1).state;
    expect('fatigue' in out.operator).toBe(false);
    const half = run(bare(SUGAR_FOG.ticks), 600).state;
    expect(half.operator.fatigue).toBe(SUGAR_FOG.ticks - 600);
    const again = run(withShot(half, tea(half.operator.x, half.operator.y)), 1);
    expect(ofType(again, 'teaTaken')).toHaveLength(1);
    expect(again.state.operator.fatigue).toBe(SUGAR_FOG.ticks);
  });

  it('flies on past an operator still invincible from a hit, and is drunk once that ends', () => {
    const g = bare();
    const guarded = withShot({ ...g, operator: { ...g.operator, invulnUntil: g.tick + 30 } }, tea(START.x, START.y, { vx: 0, ticksLeft: 100 }));
    const first = run(guarded, 1);
    expect(ofType(first, 'teaTaken')).toEqual([]);
    expect(first.state.shots.find((s) => s.id === 900)).toMatchObject({ spent: false });
    const later = run(guarded, 40);
    expect(firstTick(later, 'teaTaken')).toBe(30);
    expect(ofType(later, 'teaTaken')).toHaveLength(1);
  });

  it('is the only drink that brings the fog: a can does not', () => {
    const r = run(withShot(bare(), tea(START.x, START.y, { kind: 'can', drink: 'can' })), 1);
    expect(ofType(r, 'canTaken')).toHaveLength(1);
    expect(r.state.operator.fatigue).toBeUndefined();
  });

  it('shows on the HUD in whole seconds, rounded up', () => {
    const at = (fatigue?: number) => selectFatigue(bare(fatigue));
    expect(at()).toBeUndefined();
    expect(at(SUGAR_FOG.ticks)).toBe(45);
    expect(at(TICK_HZ + 1)).toBe(2);
    expect(at(TICK_HZ)).toBe(1);
    expect(at(1)).toBe(1);
  });

  it('slows the operator by 15%, under the shared cap of design doc 5.1, and only while it lasts', () => {
    const right = () => ({ ...NO_INPUT, move: { x: 1, y: 0 } });
    const top = (g: GameState) => run(g, 20, right).state.operator.vx;
    expect(top(bare())).toBeCloseTo(MOVE.maxSpeed, 9);
    expect(top(bare(SUGAR_FOG.ticks))).toBeCloseTo(MOVE.maxSpeed * (1 - SUGAR_FOG.slow), 9);
    // With another slow source on top the sum is still capped.
    const dizzy = (g: GameState): GameState => ({ ...g, operator: { ...g.operator, bodySlow: 0.1 } });
    expect(top(dizzy(bare(SUGAR_FOG.ticks)))).toBeCloseTo(MOVE.maxSpeed * (1 - MOVE.slowCap), 9);
    expect(top(dizzy(bare()))).toBeCloseTo(MOVE.maxSpeed * 0.9, 9);
    // The last tick of the fog still slows; the tick after it does not.
    const last = run(bare(20), 19, right).state;
    expect(last.operator.vx).toBeCloseTo(MOVE.maxSpeed * (1 - SUGAR_FOG.slow), 9);
    expect(run(last, 2, right).state.operator.vx).toBeCloseTo(MOVE.maxSpeed, 9);
  });

  it('is refused by a dodge, and one dodged through is spent', () => {
    const g = withShot(bare(), tea(bare().operator.x + 30, bare().operator.y));
    // Dodging into it, so it passes through the operator during the invincible frames; walking into it drinks it.
    const right = { ...NO_INPUT, move: { x: 1, y: 0 } };
    expect(ofType(run(g, 30, () => right), 'teaTaken')).toHaveLength(1);
    const dodged = run(g, 30, (t) => ({ ...right, dodgePressed: t === 0 }));
    expect(ofType(dodged, 'perfectDodge')).toHaveLength(1);
    expect(dodged.state.shots.find((s) => s.id === 900)?.spent ?? true).toBe(true);
    expect(ofType(dodged, 'teaTaken')).toEqual([]);
    expect(dodged.state.operator.fatigue).toBeUndefined();
    const spent = run(withShot(bare(), tea(START.x, START.y, { spent: true })), 10);
    expect(ofType(spent, 'teaTaken')).toEqual([]);
  });

  it('is sent back by the folder\'s parry and stopped by its block, and neither drinks it', () => {
    const h = firstTick(run(seller('folder'), 200), 'teaTaken');
    // The guard is held from `raisedAt` on, as in folder.test.ts.
    const guardFrom = (raisedAt: number) => (t: number): TickInput => ({ ...NO_INPUT, attack: t >= raisedAt, attackPressed: t === raisedAt });
    const parried = run(seller('folder'), h + 60, guardFrom(h - 12));
    expect(ofType(parried, 'parry')).toEqual([{ type: 'parry', source: 1, kind: 'shot' }]);
    expect(ofType(parried, 'teaTaken')).toEqual([]);
    expect(parried.state.operator.fatigue).toBeUndefined();
    const blocked = run(seller('folder'), h + 1, guardFrom(h - 40));
    expect(ofType(blocked, 'blocked')).toEqual([{ type: 'blocked', source: 1, kind: 'shot' }]);
    expect(ofType(blocked, 'teaTaken')).toEqual([]);
  });

  it('is a defeatable flyer\'s, with the numbers design doc 7.5 fixes', () => {
    const raw = JSON.parse(readFileSync('content/enemies.json', 'utf8'));
    raw.enemies.find((e: { id: string }) => e.id === 'salesman').throws = 'tea';
    expect(() => loadEnemyTable(raw)).toThrow(/only a flyer throws/);
    expect(ENEMIES.enemies.get('sugar_seller')).toMatchObject({ category: 'defeatable', archetype: 'flyer', throws: 'tea' });
    expect(SUGAR_FOG.ticks).toBe(45 * TICK_HZ);
    expect(SUGAR_FOG.slow).toBe(0.15);
  });
});

const p = (name: string, value: string | number | boolean) => ({ name, value });
const NONE: TickInput = { move: { x: 0, y: 0 } };
const types = (events: readonly GameEvent[]) => events.map((e) => e.type);
const mapOf = (objects: object[]) => ({
  width: 20, height: 12, tilewidth: 32, tileheight: 32,
  properties: [p('organ', 'stomach'), p('role', 'puzzle'), p('estSeconds', 10)],
  layers: [
    { type: 'tilelayer', name: 'walls', data: new Array(240).fill(0) },
    { type: 'objectgroup', name: 'objects', objects: [{ id: 1, type: 'PlayerStart', x: 64, y: 360 }, ...objects] },
  ],
}) as unknown as TiledMap;
const southDoor = { id: 2, type: 'Door', name: 'door-s', x: 288, y: 352, width: 64, height: 32, properties: [p('socket', 'S')] };
const northDoor = { id: 2, type: 'Door', name: 'door-n', x: 288, y: 0, width: 64, height: 96, properties: [p('socket', 'N')] };

function chapter(objects: object[]): ChapterContent {
  return {
    chapter: { version: 1, id: 'lab', start: 'lab/a', links: [{ a: 'lab/a#door-s', b: 'lab/b#door-n' }] },
    rooms: new Map([['lab/a', parseRoom('lab/a', mapOf([southDoor, ...objects]), TAGS)], ['lab/b', parseRoom('lab/b', mapOf([northDoor]), TAGS)]]),
    dialogues: DIALOGUES, dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS,
  };
}
function runChapter(c: ChapterContent, s: ChapterState, n: number, input: TickInput = NONE): { state: ChapterState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    const r = stepChapter(c, s, input);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}
function until(c: ChapterContent, s: ChapterState, input: TickInput, type: GameEvent['type']): ChapterState {
  for (let n = 0; n < 300; n++) {
    const r = stepChapter(c, s, input);
    s = r.state;
    if (r.events.some((e) => e.type === type)) return s;
  }
  throw new Error(`no ${type}`);
}
const patch = (s: ChapterState, op: Partial<GameState['operator']>): ChapterState =>
  ({ ...s, game: { ...s.game, touching: [], operator: { ...s.game.operator, ...op } } });

describe('the fog across rooms', () => {
  it('goes through a door with the operator, still counting down', () => {
    const c = chapter([]);
    const foggy = patch(startChapter(c), { x: 320, y: 340, vx: 0, vy: 0, fatigue: 1000 });
    let away = foggy;
    let ticks = 0;
    while (away.run.roomId === 'lab/a' && ticks < 300) {
      away = stepChapter(c, away, { move: { x: 0, y: 1 } }).state;
      ticks++;
    }
    expect(away.run.roomId).toBe('lab/b');
    // Every tick before the door counted, the door tick too, and none was lost or added on the way through.
    const left = away.game.operator.fatigue!;
    expect(left).toBe(1000 - ticks);
    expect(runChapter(c, away, 10).state.game.operator.fatigue).toBe(left - 10);
    // One that ran out on the way leaves nothing behind.
    const thin = until(c, patch(startChapter(c), { x: 320, y: 340, vx: 0, vy: 0, fatigue: 1 }), { move: { x: 0, y: 1 } }, 'roomChanged');
    expect('fatigue' in thin.game.operator).toBe(false);
  });

  it('is gone after a forced leave and after a return to a time clock, which start the operator afresh', () => {
    const c = chapter([]);
    const dying = patch(startChapter(c), { fatigue: 1000, halves: 0 });
    const left = runChapter(c, dying, 1);
    expect(types(left.events)).toContain('forcedLeave');
    expect(left.state.game.operator.fatigue).toBeUndefined();
    const clock = { id: 9, type: 'Trigger', x: 32, y: 96, width: 32, height: 32, properties: [p('event', 'checkpoint')] };
    const cc = chapter([clock]);
    // Punching in restores the hearts but not the operator's head: the fog stays.
    const punchedFoggy = until(cc, patch(startChapter(cc), { x: 48, y: 120, vx: 0, vy: 0, fatigue: 1000 }), NONE, 'checkpointSaved');
    expect(punchedFoggy.game.operator.fatigue).toBeGreaterThan(900);
    const punched = until(cc, patch(startChapter(cc), { x: 48, y: 120, vx: 0, vy: 0 }), NONE, 'checkpointSaved');
    const back = runChapter(cc, patch(punched, { fatigue: 1000, halves: 0 }), 1);
    expect(types(back.events)).toContain('returnedToCheckpoint');
    expect(back.state.game.operator.fatigue).toBeUndefined();
  });

  it('adds no caffeine and starts no heartbeat, unlike the can', () => {
    const c = chapter([]);
    const s = startChapter(c);
    const before = amount(s.run.tags, TAGS, 'caffeine');
    const r = runChapter(c, { ...s, game: withShot(s.game, tea(s.game.operator.x, s.game.operator.y)) }, 1);
    expect(types(r.events)).toContain('teaTaken');
    expect(types(r.events)).not.toContain('palpitation');
    expect(amount(r.state.run.tags, TAGS, 'caffeine')).toBe(before);
    // The same shot as a can does both, so the check above can fail.
    const can = runChapter(c, { ...s, game: withShot(s.game, tea(s.game.operator.x, s.game.operator.y, { kind: 'can', drink: 'can' })) }, 1);
    expect(types(can.events)).toContain('palpitation');
    expect(amount(can.state.run.tags, TAGS, 'caffeine')).toBeGreaterThan(before);
  });

  it('wakes a sleeper, like anything else that lands on them', () => {
    const bed = { id: 3, type: 'Bed', x: 84, y: 330, width: 64, height: 32, properties: [p('bedType', 'sleep'), p('sleepSeconds', 30)] };
    const c = chapter([bed]);
    const lay = runChapter(c, startChapter(c), 1, { ...NONE, interactPressed: true }).state;
    expect(lay.game.sleep?.awake).toBe(false);
    const { x, y } = lay.game.operator;
    const r = runChapter(c, { ...lay, game: withShot(lay.game, tea(x, y)) }, 1);
    expect(types(r.events)).toContain('teaTaken');
    expect(types(r.events)).toContain('sleepInterrupted');
    expect(r.state.game.sleep?.awake).toBe(true);
  });
});
