import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createGame, loadEnemyTable, NO_INPUT, step, TILE, type EnteredRoom, type GameState, type TickInput } from '../../src/core/index.ts';
import { ENEMY_HIT_FREEZE, FLYER, SALESMAN, STAMP } from '../../src/core/combat/frames.ts';

const TABLE = loadEnemyTable(JSON.parse(readFileSync('content/enemies.json', 'utf8')));
const START = { x: 160, y: 192 };
const RIGHT = { x: 1, y: 0 };

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
      { id: 1, kind: 'PlayerStart', name: '', ...START, width: 0, height: 0, props: {}, conditions: {} },
      ...spawns.map((s, i) => ({
        id: 10 + i, kind: 'Spawn', name: '', x: s.x, y: s.y, width: 0, height: 0, conditions: {},
        props: { enemyType: s.type, count: 1, respawnSeconds: 0, when: '' },
      })),
    ],
  };
}

const fire: TickInput = { ...NO_INPUT, attack: true, attackPressed: true };
/** Two staples, a cooldown apart: one short of the three hits in a row that bind. */
const TWO_STAPLES: readonly number[] = [0, 10];

/** One enemy of `type` `dx` pixels in front of the muzzle, with performance to spare so it outlives the fight. */
function target(type: string, dx: number): GameState {
  const g = createGame(room([{ type, x: START.x + dx, y: START.y }]), 1, TABLE);
  return { ...g, operator: { ...g.operator, aim: RIGHT }, enemies: g.enemies.map((e) => ({ ...e, hp: 40, maxHp: 40 })) };
}

/** Ticks the first telegraph of the enemy lasts, from the tick it begins to the tick the attack comes out, and the hits it took. */
function telegraph(start: GameState, presses: readonly number[]): { ticks: number; hits: number; froze: boolean } {
  let s = start;
  let began = -1;
  let hits = 0;
  let froze = false;
  for (let t = 0; t < 200; t++) {
    const r = step(s, presses.includes(t) ? fire : NO_INPUT);
    s = r.state;
    const e = s.enemies[0]!;
    if (began >= 0 && e.phase === 'windup') {
      hits += r.events.filter((ev) => ev.type === 'hit').length;
      froze ||= e.frozen > 0;
    }
    if (began < 0 && e.phase === 'windup') began = t;
    else if (began >= 0 && e.phase !== 'windup') return { ticks: t - began, hits, froze };
  }
  throw new Error('the enemy never finished its telegraph');
}

describe('hit-stop and the telegraph (design doc 5.3, issue 59)', () => {
  const cases = [
    { name: 'a salesman', type: 'salesman', dx: 30, windup: SALESMAN.windupTicks },
    { name: 'a flyer', type: 'flyer', dx: 3.5 * TILE, windup: FLYER.windupTicks },
  ];

  for (const c of cases) {
    it(`leaves the telegraph of ${c.name} as long as it is when no staple lands`, () => {
      expect(telegraph(target(c.type, c.dx), []).ticks).toBe(c.windup);
    });

    it(`does not stretch the telegraph of ${c.name} when staples land during it`, () => {
      const r = telegraph(target(c.type, c.dx), TWO_STAPLES);
      // The fight below must have hit the enemy in its windup, or it proves nothing.
      expect(r.hits).toBeGreaterThanOrEqual(2);
      expect(r.froze).toBe(true);
      expect(r.ticks).toBe(c.windup);
    });
  }

  it('does not stretch a telegraph that the 10-tick freeze of the stamp lands in', () => {
    const g = target('salesman', 30);
    const stamped = { ...g, enemies: g.enemies.map((e) => ({ ...e, phase: 'windup' as const, phaseTicks: 4, frozen: STAMP.hitFreeze, strikeDir: RIGHT })) };
    let s: GameState = stamped;
    let steps = 0;
    while (s.enemies[0]!.phase === 'windup' && steps < 200) {
      s = step(s, NO_INPUT).state;
      steps++;
    }
    expect(steps).toBe(SALESMAN.windupTicks - 4);
  });

  it('drops what is left of the freeze when the attack comes out, so the attack is not held back by it', () => {
    const g = target('salesman', 30);
    const frozen = { ...g, enemies: g.enemies.map((e) => ({ ...e, phase: 'windup' as const, phaseTicks: SALESMAN.windupTicks - 1, frozen: ENEMY_HIT_FREEZE + 5, strikeDir: RIGHT })) };
    const r = step(frozen, NO_INPUT).state.enemies[0]!;
    expect(r.phase).toBe('strike');
    expect(r.frozen).toBe(0);
  });

  it('still holds the windup of an enemy that a binding pin holds', () => {
    const g = target('salesman', 30);
    const windup = { phase: 'windup' as const, phaseTicks: 5, frozen: 50, strikeDir: RIGHT };
    const pinned = { ...g, enemies: g.enemies.map((e) => ({ ...e, ...windup, boundUntil: 50 })) };
    const free = { ...g, enemies: g.enemies.map((e) => ({ ...e, ...windup })) };
    let a: GameState = pinned;
    let b: GameState = free;
    for (let t = 0; t < SALESMAN.windupTicks; t++) {
      a = step(a, NO_INPUT).state;
      b = step(b, NO_INPUT).state;
    }
    expect(a.enemies[0]!.phase, 'pinned: the telegraph waits for the pin').toBe('windup');
    expect(a.enemies[0]!.phaseTicks).toBe(5);
    expect(b.enemies[0]!.phase, 'hit-stop only: the telegraph has run out by now').not.toBe('windup');
  });
});
