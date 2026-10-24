import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createGame, FLYER, loadEnemyTable, NO_INPUT, step, TELEGRAPH, TILE,
  type DomainEvent, type EnteredRoom, type GameState, type TickInput,
} from '../../src/core/index.ts';

const TABLE = loadEnemyTable(JSON.parse(readFileSync('content/enemies.json', 'utf8')));
const START = { x: 160, y: 192 };

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
      { id: 1, kind: 'PlayerStart', ...START, width: 0, height: 0, props: {}, conditions: {} },
      ...spawns.map((s, i) => ({
        id: 10 + i, kind: 'Spawn', x: s.x, y: s.y, width: 0, height: 0, conditions: {},
        props: { enemyType: s.type, count: 1, respawnSeconds: 0, when: '' },
      })),
    ],
  };
}

const game = (x: number) => createGame(room([{ type: 'flyer', x, y: START.y }]), 1, TABLE);
const press = (extra: Partial<TickInput> = {}): TickInput => ({ ...NO_INPUT, ...extra });

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
const firstTick = (r: Run, type: DomainEvent['type']) => r.events.findIndex((es) => es.some((e) => e.type === type));
const ofType = <T extends DomainEvent['type']>(r: Run, type: T) =>
  r.events.flat().filter((e): e is Extract<DomainEvent, { type: T }> => e.type === type);

describe('flyer archetype (design doc 5.3)', () => {
  it('telegraphs tier 1 for 0.5 s, then throws one sheet that costs a standing operator half a heart', () => {
    const r = run(game(START.x + 4 * TILE), 120);
    const t = firstTick(r, 'telegraph');
    expect(ofType(r, 'telegraph')[0]).toEqual({ type: 'telegraph', source: 1, tier: 1 });
    const thrown = run(game(START.x + 4 * TILE), t + TELEGRAPH.tier1Ticks + 1).state;
    expect(run(game(START.x + 4 * TILE), t + TELEGRAPH.tier1Ticks).state.shots).toEqual([]);
    expect(thrown.shots).toHaveLength(1);
    expect(ofType(r, 'heartLost')).toEqual([{ type: 'heartLost', halves: FLYER.damageHalves, cause: 'flyer' }]);
  });

  it('a sideways dodge as the sheet arrives leaves hearts unchanged', () => {
    const h = firstTick(run(game(START.x + 4 * TILE), 120), 'heartLost');
    const r = run(game(START.x + 4 * TILE), 120, (k) => press({ dodgePressed: k === h - 1, move: { x: 0, y: k === h - 1 ? 1 : 0 } }));
    expect(h).toBeGreaterThan(0);
    expect(ofType(r, 'heartLost')).toEqual([]);
  });

  it('backs away inside 3 tiles and closes in beyond 6', () => {
    const near = run(game(START.x + 2 * TILE), 20).state.enemies[0]!;
    const far = run(game(START.x + 9 * TILE), 20).state.enemies[0]!;
    expect(near.x).toBeGreaterThan(START.x + 2 * TILE);
    expect(far.x).toBeLessThan(START.x + 9 * TILE);
  });

  it('its throwing pose has no melee box: standing on the operator mid-throw does not hurt', () => {
    const g = game(START.x + 4 * TILE);
    const t = firstTick(run(g, 120), 'telegraph');
    const mid = run(g, t + TELEGRAPH.tier1Ticks + 1).state;
    const onTop = { ...mid, shots: [], enemies: mid.enemies.map((e) => ({ ...e, x: START.x + 10, y: START.y })) };
    expect(onTop.enemies[0]!.phase).toBe('strike');
    expect(ofType(run(onTop, FLYER.throwTicks), 'heartLost')).toEqual([]);
  });
});
