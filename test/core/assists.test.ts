import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  chip, createGame, loadEnemyTable, NO_ASSISTS, NO_INPUT, SALESMAN, stateHash, step,
  type Assists, type DomainEvent, type EnteredRoom, type GameState, type TickInput,
} from '../../src/core/index.ts';

const TABLE = loadEnemyTable(JSON.parse(readFileSync('content/enemies.json', 'utf8')));

/** Open 20 x 12 room with a one-tile border; PlayerStart at (160, 192). */
function room(spawns: { type: string; x: number; y: number }[]): EnteredRoom {
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
      { id: 1, kind: 'PlayerStart', name: '', x: 160, y: 192, width: 0, height: 0, props: {}, conditions: {} },
      ...spawns.map((s, i) => ({
        id: 10 + i, kind: 'Spawn', name: '', x: s.x, y: s.y, width: 0, height: 0, conditions: {},
        props: { enemyType: s.type, count: 1, respawnSeconds: 0, when: '' },
      })),
    ],
  };
}

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

const duel = (): GameState => createGame(room([{ type: 'salesman', x: 190, y: 192 }]), 1, TABLE);
const withAssists = (a: Partial<Assists>, extra: Partial<TickInput> = {}): TickInput => ({ ...NO_INPUT, ...extra, assists: { ...NO_ASSISTS, ...a } });
const losses = (r: Run): number[] => r.events.flat().flatMap((e) => (e.type === 'heartLost' ? [e.halves] : []));
const firstTick = (r: Run, type: DomainEvent['type']) => r.events.findIndex((es) => es.some((e) => e.type === type));

describe('what a hit costs under the halved-damage assist (design doc 5.7)', () => {
  it('counts quarter hearts: a half-heart hit costs nothing and is owed, the next one pays it', () => {
    const off = { ...NO_ASSISTS };
    const on = { ...NO_ASSISTS, halfDamage: true };
    expect(chip(1, 0, off)).toEqual({ cost: 1, owed: 0 });
    expect(chip(2, 0, off)).toEqual({ cost: 2, owed: 0 });
    expect(chip(1, 0, on)).toEqual({ cost: 0, owed: 1 });
    expect(chip(1, 1, on)).toEqual({ cost: 1, owed: 0 });
    expect(chip(2, 0, on)).toEqual({ cost: 1, owed: 0 });
    expect(chip(2, 1, on)).toEqual({ cost: 1, owed: 1 });
    // A hit that costs no heart (a toast cup lands for none) neither pays nor takes anything.
    expect(chip(0, 1, on)).toEqual({ cost: 0, owed: 1 });
    // Over any run of hits, a half of the damage is paid: 7 half-heart hits cost 3 and owe the 4th half.
    let owed: 0 | 1 = 0;
    let paid = 0;
    for (let i = 0; i < 7; i++) {
      const c = chip(1, owed, on);
      paid += c.cost;
      owed = c.owed;
    }
    expect([paid, owed]).toEqual([3, 1]);
  });

  /** Walks at the nearest enemy, so a salesman that would only whiff at a standing operator lands every strike. */
  const chase = (a: Partial<Assists>) => (_t: number, s: GameState): TickInput => {
    const e = s.enemies[0]!;
    const dx = e.x - s.operator.x;
    const dy = e.y - s.operator.y;
    return { ...NO_INPUT, move: { x: Math.abs(dx) > 14 ? Math.sign(dx) : 0, y: Math.abs(dy) > 8 ? Math.sign(dy) : 0 }, assists: { ...NO_ASSISTS, ...a } };
  };

  it('a salesman that keeps hitting costs half the hearts, and the control costs all of them', () => {
    const control = run(duel(), 900, chase({}));
    const assisted = run(duel(), 900, chase({ halfDamage: true }));
    const hits = losses(control).length;
    expect(hits).toBeGreaterThanOrEqual(6);
    expect(losses(control).every((h) => h === 1)).toBe(true);
    expect(control.state.operator.halves).toBe(12 - hits);
    // The same strikes land: the assist changes the price of a hit, not whether it lands.
    expect(losses(assisted)).toHaveLength(hits);
    expect(losses(assisted).slice(0, 4)).toEqual([0, 1, 0, 1]);
    expect(assisted.state.operator.halves).toBe(12 - Math.floor(hits / 2));
  });

  it('a hit that costs nothing still knocks back, freezes the fight and gives the invulnerability window', () => {
    const r = run(duel(), 90, () => withAssists({ halfDamage: true }));
    const hit = firstTick(r, 'heartLost');
    expect(hit).toBeGreaterThan(0);
    expect(r.events[hit]).toContainEqual({ type: 'freeze', frames: 4 });
    expect(r.state.operator.halves).toBe(12);
    const after = run(duel(), hit + 1, () => withAssists({ halfDamage: true })).state;
    expect(after.operator.action.kind).toBe('hurt');
    // The window is what stops the next strike from landing at once, so a free hit must open it as a paid one does.
    const before = run(duel(), hit, () => withAssists({ halfDamage: true })).state;
    expect(before.operator.invulnUntil).toBeLessThanOrEqual(before.tick);
    expect(after.operator.invulnUntil).toBeGreaterThan(after.tick);
  });

  it('with the assist off the state carries no debt, so a plain run is unchanged', () => {
    const plain = run(duel(), 200);
    const explicitOff = run(duel(), 200, () => ({ ...NO_INPUT, assists: NO_ASSISTS }));
    expect(plain.state.operator).not.toHaveProperty('halfCarry');
    expect(stateHash(explicitOff.state)).toBe(stateHash(plain.state));
  });
});

describe('hearts that never run out (design doc 5.7)', () => {
  /** Walks at the nearest enemy, so every strike lands. */
  const chase = (a: Partial<Assists>) => (_t: number, s: GameState): TickInput => {
    const e = s.enemies[0]!;
    const dx = e.x - s.operator.x;
    const dy = e.y - s.operator.y;
    return { ...NO_INPUT, move: { x: Math.abs(dx) > 14 ? Math.sign(dx) : 0, y: Math.abs(dy) > 8 ? Math.sign(dy) : 0 }, assists: { ...NO_ASSISTS, ...a } };
  };

  const lastHalf = (): GameState => {
    const g = duel();
    return { ...g, operator: { ...g.operator, halves: 1 } };
  };

  it('without the assist the last half heart ends in a forced leave', () => {
    expect(run(lastHalf(), 90).events.flat().map((e) => e.type)).toContain('forcedLeave');
  });

  it('with it the hit lands, hurts and freezes, and the operator stays on the last half heart', () => {
    const r = run(lastHalf(), 90, () => withAssists({ neverEmpty: true }));
    const types = r.events.flat().map((e) => e.type);
    expect(types).not.toContain('forcedLeave');
    expect(types).toContain('heartLost');
    expect(types).toContain('freeze');
    expect(r.state.operator.halves).toBe(1);
  });

  it('keeps standing through hit after hit', () => {
    const g = duel();
    const r = run({ ...g, operator: { ...g.operator, halves: 1 } }, 900, (t, s) => ({ ...chase({ neverEmpty: true })(t, s) }));
    expect(losses(r).length).toBeGreaterThanOrEqual(3);
    expect(r.events.flat().map((e) => e.type)).not.toContain('forcedLeave');
    expect(r.state.operator.halves).toBe(1);
  });

  it('together with halved damage the half heart is never spent, and the debt still counts', () => {
    const r = run(lastHalf(), 900, chase({ neverEmpty: true, halfDamage: true }));
    expect(losses(r).length).toBeGreaterThanOrEqual(6);
    expect(r.state.operator.halves).toBe(1);
    expect(r.events.flat().map((e) => e.type)).not.toContain('forcedLeave');
  });
});

describe('automatic perfect dodges (design doc 5.7)', () => {
  // Against the left wall the dodge cannot carry the operator out of the strike, so the strike meets
  // the i-frames wherever the dodge was pressed: a perfect dodge needs it within the first 6 of them.
  const walled = (): GameState => {
    const g = createGame(room([{ type: 'salesman', x: 54, y: 192 }]), 1, TABLE);
    return { ...g, operator: { ...g.operator, x: 24, y: 192 } };
  };
  const strikeAt = firstTick(run(walled(), 90), 'heartLost');
  /** A dodge pressed `early` ticks before the strike would land. */
  const dodgeEarly = (early: number, assists: Partial<Assists>): Run =>
    run(walled(), 90, (t) => ({ ...NO_INPUT, dodgePressed: t === strikeAt - early, move: { x: t === strikeAt - early ? -1 : 0, y: 0 }, assists: { ...NO_ASSISTS, ...assists } }));
  const perfect = (r: Run) => r.events.flat().filter((e) => e.type === 'perfectDodge').length;
  const hurt = (r: Run) => r.events.flat().some((e) => e.type === 'heartLost');

  it('a dodge that meets the strike in the last i-frames is absorbed but not perfect on its own', () => {
    for (const early of [7, 8, 9, 10]) {
      const control = dodgeEarly(early, {});
      expect([hurt(control), perfect(control)], `early ${early}`).toEqual([false, 0]);
    }
    for (const early of [1, 2, 3, 4, 5, 6]) expect(perfect(dodgeEarly(early, {})), `early ${early}`).toBe(1);
  });

  it('with the assist every dodge that absorbs the strike is perfect, and pays the gauge of one', () => {
    for (const early of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const r = dodgeEarly(early, { autoPerfect: true });
      expect([hurt(r), perfect(r)], `early ${early}`).toEqual([false, 1]);
      expect(r.state.operator.gauge, `early ${early}`).toBeGreaterThan(0);
    }
    expect(dodgeEarly(8, {}).state.operator.gauge).toBe(0);
  });

  it('marks the perfect dodges only the assist made perfect, and no others, so a patrol can leave them out of its records', () => {
    const marked = (r: Run) => r.events.flat().filter((e) => e.type === 'perfectDodge' && e.assisted === true).length;
    const first = (r: Run) => r.events.flat().find((e) => e.type === 'perfectDodge');
    for (const early of [1, 2, 3, 4, 5, 6]) {
      const r = dodgeEarly(early, { autoPerfect: true });
      expect([marked(r), perfect(r)], `timed, early ${early}`).toEqual([0, 1]);
      // The event of a timed dodge is the one a plain run makes, with no extra key.
      expect(first(r), `early ${early}`).not.toHaveProperty('assisted');
    }
    for (const early of [7, 8, 9, 10]) expect([marked(dodgeEarly(early, { autoPerfect: true })), perfect(dodgeEarly(early, { autoPerfect: true }))], `late, early ${early}`).toEqual([1, 1]);
    for (const early of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) expect(marked(dodgeEarly(early, {})), `no assist, early ${early}`).toBe(0);
  });

  it('does not dodge for the player: a dodge with no i-frame over the strike, or none at all, still takes the hit', () => {
    for (const early of [0, 11, 12]) expect(hurt(dodgeEarly(early, { autoPerfect: true })), `early ${early}`).toBe(true);
    const none = run(duel(), 90, () => withAssists({ autoPerfect: true }));
    expect(hurt(none)).toBe(true);
    expect(perfect(none)).toBe(0);
  });
});
describe('the assists are input, so a replay carries them', () => {
  it('the same inputs with the same assists give the same state hash, and the assists change it', () => {
    const inputs = (a: Partial<Assists>) => () => withAssists(a);
    const once = stateHash(run(duel(), 300, inputs({ halfDamage: true, neverEmpty: true })).state);
    expect(stateHash(run(duel(), 300, inputs({ halfDamage: true, neverEmpty: true })).state)).toBe(once);
    expect(stateHash(run(duel(), 300, inputs({})).state)).not.toBe(once);
  });

  it('switching an assist on in the middle of a run takes effect on that tick', () => {
    const first = firstTick(run(duel(), 90), 'heartLost');
    const r = run(duel(), 90, (t) => (t >= first ? withAssists({ halfDamage: true }) : NO_INPUT));
    expect(losses(r)).toEqual([0]);
    const early = run(duel(), 90, (t) => (t > first ? withAssists({ halfDamage: true }) : NO_INPUT));
    expect(losses(early)).toEqual([1]);
  });
});
