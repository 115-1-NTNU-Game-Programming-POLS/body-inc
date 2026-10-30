import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  chairmanSpirit, createGame, loadEnemyTable, NO_INPUT, PIE, selectPie, step, TICK_HZ, TILE,
  type DomainEvent, type EnteredRoom, type GameState, type TickInput, type Zone,
} from '../../src/core/index.ts';

const TABLE = loadEnemyTable(JSON.parse(readFileSync('content/enemies.json', 'utf8')));
const START = { x: 160, y: 192 };

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

/** S = 1 is P = 1; the chairman's spirit follows S as P = 0.5 + 0.5 S. */
const game = (spawns: Parameters<typeof room>[0] = [], s = 1, pie = true): GameState => {
  const g = createGame(room(spawns), 1, TABLE, { p: chairmanSpirit(s), ...(pie ? { pie } : {}) });
  return { ...g, operator: { ...g.operator, aim: { x: 1, y: 0 } } };
};
const press = (extra: Partial<TickInput> = {}): TickInput => ({ ...NO_INPUT, ...extra });

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

describe('the chairman\'s pie shield (design doc 5.1, 7.4)', () => {
  const flyer = () => game([{ type: 'flyer', x: START.x + 4 * TILE, y: START.y }]);
  /** The tick the first sheet lands on an operator who does nothing. */
  const arrival = firstTick(run(flyer(), 200), 'heartLost');

  it('L raises it once, with its size and time from the base values', () => {
    const r = run(game(), 5, (t) => press({ partnerPressed: t === 0 }));
    expect(ofType(r, 'pieRaised')).toEqual([{ type: 'pieRaised', radiusPx: PIE.radiusPx, seconds: PIE.ticks / TICK_HZ, sleepy: false }]);
    expect(selectPie(r.state)).toEqual({ phase: 'up', seconds: Math.ceil((PIE.ticks - 4) / TICK_HZ), scale: 1 });
  });

  it('stops a thrown sheet that would cost a heart, and only while it is up', () => {
    expect(arrival).toBeGreaterThan(20);
    const up = run(flyer(), arrival + 60, (t) => press({ partnerPressed: t === arrival - 30 }));
    expect(ofType(up, 'heartLost')).toEqual([]);
    expect(ofType(up, 'pieBlocked')).toEqual([{ type: 'pieBlocked', source: 1 }]);
    // Raised too late: the sheet is already past the shield's edge, in the hurtbox.
    const late = run(flyer(), arrival + 20, (t) => press({ partnerPressed: t === arrival + 5 }));
    expect(ofType(late, 'heartLost')).toHaveLength(1);
    // Without a press nothing is stopped.
    expect(ofType(run(flyer(), arrival + 20), 'pieBlocked')).toEqual([]);
  });

  it('size and time are the base values times S, and a tired chairman says his line badly', () => {
    const tired = (s: number) => run(game([], s), 3, (t) => press({ partnerPressed: t === 0 }));
    const r = tired(0.72);
    const [raised] = ofType(r, 'pieRaised');
    expect(raised!.radiusPx).toBeCloseTo(PIE.radiusPx * 0.72, 6);
    expect(raised!.seconds * TICK_HZ).toBe(Math.round(PIE.ticks * 0.72));
    expect(raised!.sleepy).toBe(true);
    expect(selectPie(r.state)).toMatchObject({ scale: 0.72 });
    // Even the floor of S leaves a coin of a pie, never nothing.
    const [coin] = ofType(tired(0.3), 'pieRaised');
    expect(coin!.radiusPx).toBeCloseTo(PIE.radiusPx * 0.3, 6);
    expect(coin!.seconds).toBeGreaterThan(0);
  });

  it('cools down for 12 s from the raise and ignores L until then', () => {
    const everyTick = run(game(), PIE.cooldownTicks + 2, () => press({ partnerPressed: true }));
    expect(ofType(everyTick, 'pieRaised')).toHaveLength(2);
    expect(firstTick(everyTick, 'pieRaised')).toBe(0);
    expect(everyTick.events.findIndex((es, t) => t > 0 && es.some((e) => e.type === 'pieRaised'))).toBe(PIE.cooldownTicks);
    const mid = run(game(), 2 * TICK_HZ, (t) => press({ partnerPressed: t === 0 }));
    expect(selectPie(mid.state)?.phase).toBe('up');
    const after = run(game(), PIE.ticks + 5, (t) => press({ partnerPressed: t === 0 }));
    expect(selectPie(after.state)).toMatchObject({ phase: 'cooling' });
    expect(selectPie(after.state)!.seconds).toBe(Math.ceil((PIE.cooldownTicks - PIE.ticks - 5) / TICK_HZ));
    expect(selectPie(run(game(), PIE.cooldownTicks + 1, (t) => press({ partnerPressed: t === 0 })).state)?.phase).toBe('ready');
  });

  it('does nothing in a chapter without a partner, and an area still lands under it', () => {
    const none = run(game([], 1, false), 3, () => press({ partnerPressed: true }));
    expect(ofType(none, 'pieRaised')).toEqual([]);
    expect(none.state.pie).toBeUndefined();
    expect(selectPie(none.state)).toBeUndefined();

    const g = game();
    const zone: Zone = { id: 900, owner: 77, move: 'x', tier: 2, x: g.operator.x, y: g.operator.y, radius: 40, telegraphTicks: 0, activeTicks: 5, halves: 1, age: 1, spent: false };
    const area = run({ ...g, zones: [zone] }, 4, (t) => press({ partnerPressed: t === 0 }));
    expect(ofType(area, 'heartLost')).toHaveLength(1);
    expect(ofType(area, 'pieBlocked')).toEqual([]);
  });

  it('is not stopped by a shot already spent, and not by one beyond its edge', () => {
    const g = game();
    const shot = (x: number, spent: boolean) => ({
      id: 800, owner: 1, kind: 'sheet', x, y: g.operator.y - 8, vx: 0, vy: 0, ticksLeft: 30, halves: 1, half: 3, spent,
    });
    const raise = (t: number) => press({ partnerPressed: t === 0 });
    const inside = run({ ...g, shots: [shot(g.operator.x + 30, false)] }, 3, raise);
    expect(ofType(inside, 'pieBlocked')).toHaveLength(1);
    const spent = run({ ...g, shots: [shot(g.operator.x + 30, true)] }, 3, raise);
    expect(ofType(spent, 'pieBlocked')).toEqual([]);
    const outside = run({ ...g, shots: [shot(g.operator.x + PIE.radiusPx + 20, false)] }, 3, raise);
    expect(ofType(outside, 'pieBlocked')).toEqual([]);
  });
});
