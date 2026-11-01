import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BIND, createGame, FOLDER, loadBossTable, loadEnemyTable, NO_INPUT, PARRY_BOOST, step, TILE,
  type CaffeineParams, type DomainEvent, type EnteredRoom, type GameState, type TickInput,
} from '../../src/core/index.ts';
import { BASE_PERKS, type Perks } from '../../src/core/combat/perks.ts';

const TABLE = loadEnemyTable(JSON.parse(readFileSync('content/enemies.json', 'utf8')));
const PARAMS = JSON.parse(readFileSync('content/params.json', 'utf8')).defaults as CaffeineParams;
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

const press = (extra: Partial<TickInput> = {}): TickInput => ({ ...NO_INPUT, ...extra });
const fire = (): TickInput => press({ attack: true, attackPressed: true });

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

/** Dummies with 40 performance, so the fights below can run as long as they like; the first is straight ahead of the muzzle. */
function dummies(offsets: readonly { dx: number; dy: number }[], perks?: Partial<Perks>): GameState {
  const g = createGame(room(offsets.map((o) => ({ type: 'dummy', x: START.x + o.dx, y: START.y + o.dy }))), 1, TABLE, perks ? { perks: { ...BASE_PERKS, ...perks } } : {});
  return { ...g, operator: { ...g.operator, aim: RIGHT }, enemies: g.enemies.map((e) => ({ ...e, hp: 40, maxHp: 40 })) };
}
const ONE = [{ dx: 4 * TILE, dy: 0 }];

describe('binding (裝訂, design doc 8.8)', () => {
  it('pins an enemy for 1.5 s on the third staple hit in a row, and not before', () => {
    const r = run(dummies(ONE), 120, fire);
    const bound = firstTick(r, 'bound');
    expect(bound).toBeGreaterThan(0);
    const hitsBefore = r.events.slice(0, bound + 1).flat().filter((e) => e.type === 'hit').length;
    expect(hitsBefore).toBe(BIND.hits);
    expect(ofType(r, 'bound')[0]).toEqual({ type: 'bound', target: 1, enemy: 'dummy' });
    const at = run(dummies(ONE), bound + 1, fire).state.enemies[0]!;
    expect(at.frozen).toBeGreaterThanOrEqual(BIND.pinTicks - 1);
    expect(at.boundUntil).toBe(bound + BIND.pinTicks);
  });

  it('starts the count again after a pin: every third hit binds', () => {
    const r = run(dummies(ONE), 400, fire);
    const hits = r.events.flat().filter((e) => e.type === 'hit').length;
    expect(hits).toBeGreaterThanOrEqual(9);
    expect(ofType(r, 'bound')).toHaveLength(Math.floor(hits / BIND.hits));
  });

  it('keeps the enemy still for the pin: a pinned salesman does not wind up', () => {
    const g = createGame(room([{ type: 'salesman', x: START.x + 30, y: START.y }]), 1, TABLE);
    const pinned = { ...g, operator: { ...g.operator, aim: RIGHT }, enemies: g.enemies.map((e) => ({ ...e, hp: 40, maxHp: 40 })) };
    const free = run(pinned, 160, () => NO_INPUT);
    expect(ofType(free, 'telegraph').length).toBeGreaterThan(0);
    const still = run({ ...pinned, enemies: pinned.enemies.map((e) => ({ ...e, frozen: 100 })) }, 90, () => NO_INPUT);
    expect(ofType(still, 'telegraph')).toEqual([]);
  });

  it('does not count a hit on another enemy, or one after the run lapsed', () => {
    const g = dummies(ONE);
    // Two hits already counted on the dummy: the next staple makes the third.
    const ready = run({ ...g, bind: { target: 1, hits: BIND.hits - 1, at: 0 } }, 20, fire);
    expect(ofType(ready, 'bound')).toHaveLength(1);
    expect(ofType(ready, 'hit')).toHaveLength(1);
    // The same two hits on somebody else, or too long ago, count for nothing here.
    for (const bind of [{ target: 2, hits: BIND.hits - 1, at: 0 }, { target: 1, hits: BIND.hits - 1, at: -BIND.windowTicks - 2 }]) {
      const r = run({ ...g, tick: 0, bind }, 20, fire);
      expect(ofType(r, 'hit').length, JSON.stringify(bind)).toBeGreaterThan(0);
      expect(ofType(r, 'bound'), JSON.stringify(bind)).toEqual([]);
    }
  });

  it('counts staples only: a folder blow, even on a run already two deep, does not bind', () => {
    const g = createGame(room([{ type: 'dummy', x: START.x + 20, y: START.y }]), 1, TABLE, { tool: 'folder' });
    const folder = { ...g, operator: { ...g.operator, aim: RIGHT }, enemies: g.enemies.map((e) => ({ ...e, hp: 40, maxHp: 40 })), bind: { target: 1, hits: BIND.hits - 1, at: 0 } };
    const r = run(folder, 60, (t) => press({ attack: t === 0, attackPressed: t === 0 }));
    expect(ofType(r, 'hit').length).toBeGreaterThan(0);
    expect(ofType(r, 'bound')).toEqual([]);
  });

  it('never binds what a staple only bounces off or scatters', () => {
    for (const type of ['cold_virus', 'adenosine']) {
      const g = createGame(room([{ type, x: START.x + 4 * TILE, y: START.y }]), 1, TABLE);
      const r = run({ ...g, operator: { ...g.operator, aim: RIGHT } }, 120, fire);
      expect(ofType(r, 'immuneBounce').length + ofType(r, 'dispersed').length, type).toBeGreaterThan(0);
      expect(ofType(r, 'bound'), type).toEqual([]);
    }
  });

  it('never pins a boss: his hit-stop is none, and the run goes on without a pin', () => {
    const bosses = loadBossTable([JSON.parse(readFileSync('content/bosses/caffeine.json', 'utf8')), JSON.parse(readFileSync('content/bosses/toast.json', 'utf8'))], TABLE, PARAMS);
    const home = { x: 320, y: 168 };
    const g = createGame(room([{ type: 'caffeine', ...home }]), 1, TABLE, { bosses });
    const arena = { ...g, operator: { ...g.operator, x: home.x, y: home.y + 4 * TILE, aim: { x: 0, y: -1 } } };
    const r = run(arena, 120, fire);
    expect(ofType(r, 'hit').filter((e) => e.target === 1).length).toBeGreaterThanOrEqual(BIND.hits);
    expect(ofType(r, 'bound')).toEqual([]);
    expect(r.state.enemies.find((e) => e.boss)!.boundUntil).toBeUndefined();
  });

  it('takes fewer hits with 快速裝訂 (bindHits 2)', () => {
    const r = run(dummies(ONE, { bindHits: 2 }), 120, fire);
    const hitsBefore = r.events.slice(0, firstTick(r, 'bound') + 1).flat().filter((e) => e.type === 'hit').length;
    expect(hitsBefore).toBe(2);
  });
});

describe('裝訂大師: a hit on a bound enemy chips the ones beside it', () => {
  // The second dummy is 24 px below the first (inside 1.5 tiles) and off the staples' line; the third is 60 px below (outside).
  const crowd = (perks?: Partial<Perks>) => dummies([{ dx: 4 * TILE, dy: 0 }, { dx: 4 * TILE, dy: 24 }, { dx: 4 * TILE, dy: 60 }], perks);
  const hp = (r: Run) => r.state.enemies.map((e) => e.hp);

  it('does nothing without the card', () => {
    expect(hp(run(crowd(), 200, fire))).toEqual([expect.any(Number), 40, 40]);
  });

  it('splashes 1 on each enemy within 1.5 tiles, but only from the hit after the pin', () => {
    const g = crowd({ bindSplash: 1 });
    const bound = firstTick(run(g, 120, fire), 'bound');
    // Up to and including the pinning hit nothing splashes.
    expect(hp(run(g, bound + 1, fire))).toEqual([40 - BIND.hits, 40, 40]);
    // The next staple lands on the pinned dummy and chips the one beside it, not the far one.
    const all = run(g, 120, fire);
    const next = all.events.findIndex((es, t) => t > bound && es.some((e) => e.type === 'hit'));
    const after = run(g, next + 1, fire);
    expect(hp(after)).toEqual([40 - BIND.hits - 1, 39, 40]);
  });

  it('spares what a weapon does not harm: an immune or a reforming enemy beside the pin is left as it was', () => {
    const g = createGame(room([
      { type: 'dummy', x: START.x + 4 * TILE, y: START.y },
      { type: 'cold_virus', x: START.x + 4 * TILE, y: START.y + 24 },
      { type: 'opportunist_bacteria', x: START.x + 4 * TILE, y: START.y - 24 },
      { type: 'dummy', x: START.x + 4 * TILE + 20, y: START.y + 12 },
    ]), 1, TABLE, { perks: { ...BASE_PERKS, bindSplash: 1 } });
    // The last dummy is a closed case already, which a splash must not close a second time.
    const enemies = g.enemies.map((e) => (e.id === 1 ? { ...e, hp: 40, maxHp: 40 } : e.id === 4 ? { ...e, hp: 0, phase: 'closed' as const } : e));
    const r = run({ ...g, operator: { ...g.operator, aim: RIGHT }, enemies }, 200, fire);
    expect(ofType(r, 'bound').length).toBeGreaterThan(1);
    expect(ofType(r, 'caseClosed')).toEqual([]);
    expect(ofType(r, 'dispersed')).toEqual([]);
    expect(ofType(r, 'immuneBounce')).toEqual([]);
    expect(r.state.enemies.filter((e) => e.id > 1).map((e) => e.phase)).toEqual(['idle', 'idle', 'closed']);
  });

  it('is not set off by the splash itself: the neighbour is not bound and nothing chains', () => {
    const r = run(crowd({ bindSplash: 1 }), 400, fire);
    expect(ofType(r, 'bound').every((e) => e.target === 1)).toBe(true);
    expect(r.state.enemies[1]!.boundUntil).toBeUndefined();
  });
});

describe('公文回收: a parried sheet that lands binds the flyer', () => {
  const flyer = (perks?: Partial<Perks>) => {
    const g = createGame(room([{ type: 'flyer', x: START.x + 4 * TILE, y: START.y }]), 1, TABLE, { tool: 'folder', ...(perks ? { perks: { ...BASE_PERKS, ...perks } } : {}) });
    return { ...g, operator: { ...g.operator, aim: RIGHT } };
  };
  const held = (from: number) => (t: number): TickInput => press({ attack: t >= from, attackPressed: t === from });
  const arrival = (g: GameState) => firstTick(run(g, 200), 'heartLost');

  it('binds with two binding counts for the reflected sheet, and not with the base rules', () => {
    const h = arrival(flyer());
    const guard = held(h - 4 - (FOLDER.holdTicks - 1));
    const base = run(flyer(), h + 90, guard);
    expect(ofType(base, 'parry')).toHaveLength(1);
    expect(ofType(base, 'hit')).toHaveLength(1);
    expect(ofType(base, 'bound')).toEqual([]);
    const card = run(flyer({ bindHits: 2, parryBind: 2 }), h + 90, guard);
    expect(ofType(card, 'hit')).toHaveLength(1);
    expect(ofType(card, 'bound')).toEqual([{ type: 'bound', target: 1, enemy: 'flyer' }]);
  });
});

describe('退件加速: a parry makes the operator 20% faster for 2 s', () => {
  const flyer = (perks?: Partial<Perks>) => {
    const g = createGame(room([{ type: 'flyer', x: START.x + 4 * TILE, y: START.y }]), 1, TABLE, { tool: 'folder', ...(perks ? { perks: { ...BASE_PERKS, ...perks } } : {}) });
    return { ...g, operator: { ...g.operator, aim: RIGHT } };
  };
  const held = (from: number) => (t: number): TickInput => press({ attack: t >= from, attackPressed: t === from });
  /** Walking right through an empty room, so nothing hurts the operator and the pace is the whole story. */
  const speed = (boostUntil: number | undefined, ticks: number) => {
    const g = createGame(room(), 1, TABLE, { tool: 'folder' });
    return run({ ...g, ...(boostUntil === undefined ? {} : { boostUntil }) }, ticks, () => press({ move: RIGHT })).state.operator.vx;
  };

  it('starts at the parry and lasts PARRY_BOOST.ticks', () => {
    const g = flyer({ parryBoost: true });
    const h = firstTick(run(g, 200), 'heartLost');
    const r = run(g, h + 1, held(h - 4 - (FOLDER.holdTicks - 1)));
    expect(firstTick(r, 'parry')).toBe(h);
    expect(r.state.boostUntil).toBe(h + PARRY_BOOST.ticks);
    const without = run(flyer(), h + 1, held(h - 4 - (FOLDER.holdTicks - 1)));
    expect(without.state.boostUntil).toBeUndefined();
  });

  it('walks PARRY_BOOST.factor faster while it lasts and at the old pace after', () => {
    const plain = speed(undefined, 40);
    expect(plain).toBeGreaterThan(0);
    expect(speed(100, 40) / plain).toBeCloseTo(PARRY_BOOST.factor, 5);
    // It ended on tick 20; by tick 40 the operator has settled back at the plain pace.
    expect(speed(20, 40)).toBeCloseTo(plain, 5);
  });
});
