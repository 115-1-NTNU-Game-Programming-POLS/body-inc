import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BUFFER_TICKS, createGame, DODGE, HURT, isInvincible, loadEnemyTable, MOVE, NO_INPUT, SALESMAN, stateHash, step, STAPLER,
  TILE, type DomainEvent, type EnemyState, type EnteredRoom, type GameState, type TickInput,
} from '../../src/core/index.ts';

const TABLE = loadEnemyTable(JSON.parse(readFileSync('content/enemies.json', 'utf8')));

/** Open 20 x 12 room with a one-tile border; PlayerStart at (160, 192). */
function room(spawns: { type: string; x: number; y: number; respawnSeconds?: number; count?: number }[] = []): EnteredRoom {
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
        props: { enemyType: s.type, count: s.count ?? 1, respawnSeconds: s.respawnSeconds ?? 0, when: '' },
      })),
    ],
  };
}

interface Run { state: GameState; events: DomainEvent[][] }

/** Steps with a per-tick input function and keeps every tick's events. */
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

const press = (extra: Partial<TickInput> = {}): TickInput => ({ ...NO_INPUT, ...extra });
const types = (r: Run) => r.events.flat().map((e) => e.type);
const firstTick = (r: Run, type: DomainEvent['type']) => r.events.findIndex((es) => es.some((e) => e.type === type));

describe('stapler (design doc 5.3, 6.1)', () => {
  it('the first staple exists within 6 frames of the press (frame 3)', () => {
    const r = run(createGame(room(), 1, TABLE), 6, (t) => press({ attackPressed: t === 0 }));
    const frame = firstTick(r, 'fire') + 1;
    expect(frame).toBe(STAPLER.startupFrame);
    expect(frame).toBeLessThanOrEqual(6);
  });

  it('holding fires every 10 frames; releasing stops the volley', () => {
    const r = run(createGame(room(), 1, TABLE), 60, (t) => press({ attack: t < 25, attackPressed: t === 0 }));
    const shots = r.events.flatMap((es, t) => (es.some((e) => e.type === 'fire') ? [t] : []));
    expect(shots).toEqual([2, 12, 22]);
  });

  it('a press during the interval is buffered and fires as soon as the stapler is ready', () => {
    const r = run(createGame(room(), 1, TABLE), 20, (t) => press({ attackPressed: t === 0 || t === 4 }));
    const shots = r.events.flatMap((es, t) => (es.some((e) => e.type === 'fire') ? [t] : []));
    expect(shots).toEqual([2, 12]);
  });

  it('holding fire moves at 70%, applied after the 15% slow cap', () => {
    const speed = (slows: number[], attack: boolean) => {
      const g = createGame(room(), 1, TABLE);
      const s = { ...g, operator: { ...g.operator, slows } };
      const r = run(s, 20, () => press({ move: { x: 1, y: 0 }, attack }));
      return Math.hypot(r.state.operator.vx, r.state.operator.vy);
    };
    expect(speed([], false)).toBeCloseTo(MOVE.maxSpeed, 10);
    expect(speed([], true)).toBeCloseTo(MOVE.maxSpeed * 0.7, 10);
    expect(speed([0.1, 0.1, 0.1], true)).toBeCloseTo(MOVE.maxSpeed * 0.85 * 0.7, 10);
  });

  it('staples fly 14 tiles per second and vanish at 7 tiles', () => {
    const r = run(createGame(room(), 1, TABLE), 3, (t) => press({ attackPressed: t === 0, move: { x: 1, y: 0 } }));
    expect(Math.hypot(r.state.projectiles[0]!.vx, r.state.projectiles[0]!.vy) * 60 / TILE).toBeCloseTo(14, 10);
    // Fired right from x=160: the east wall is 448 px away, so only the range can end it.
    const g = createGame(room(), 1, TABLE);
    const aimed = { ...g, operator: { ...g.operator, aim: { x: 1, y: 0 } } };
    const r30 = run(aimed, 2 + 30, (t) => press({ attackPressed: t === 0 }));
    expect(r30.state.projectiles).toHaveLength(1);
    expect(run(r30.state, 2).state.projectiles).toEqual([]);
    expect(r30.state.projectiles[0]!.x - 160).toBeLessThanOrEqual(STAPLER.rangePx);
  });

  it('soft lock bends the shot toward a suit within 25 degrees, not toward an immune barrel', () => {
    const g = createGame(room([{ type: 'salesman', x: 300, y: 240 }]), 1, TABLE);
    const s = { ...g, operator: { ...g.operator, aim: { x: 1, y: 0 } } };
    const r = run(s, 3, (t) => press({ attackPressed: t === 0 }));
    expect(r.state.projectiles[0]!.vy).toBeGreaterThan(0);
    const g2 = createGame(room([{ type: 'alcohol_barrel', x: 300, y: 240 }]), 1, TABLE);
    const s2 = { ...g2, operator: { ...g2.operator, aim: { x: 1, y: 0 } } };
    expect(run(s2, 3, (t) => press({ attackPressed: t === 0 })).state.projectiles[0]!.vy).toBe(0);
  });
});

describe('dodge (design doc 5.3)', () => {
  const dodgeRun = (ticks: number) => run(createGame(room(), 1, TABLE), ticks, (t) => press({ dodgePressed: t === 0, move: { x: 1, y: 0 } }));

  it('covers 2.5 tiles in 13 frames', () => {
    const start = createGame(room(), 1, TABLE).operator.x;
    expect(dodgeRun(13).state.operator.x - start).toBeCloseTo(2.5 * TILE, 6);
    expect(dodgeRun(19).state.operator.x - start).toBeCloseTo(2.5 * TILE, 6);
  });

  it('is invincible on frames 2 to 11 and on no other frame', () => {
    const inv: number[] = [];
    let s = createGame(room(), 1, TABLE);
    for (let frame = 1; frame <= 19; frame++) {
      s = step(s, press({ dodgePressed: frame === 1, move: { x: 1, y: 0 } })).state;
      if (isInvincible(s.operator, s.tick - 1)) inv.push(frame);
    }
    expect(inv).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('a press during recovery or cooldown is buffered for 0.35 s, not dropped', () => {
    const ready = DODGE.ticks + DODGE.recoveryTicks + DODGE.cooldownTicks;
    const dodgesWith = (pressAt: number) => {
      const r = run(createGame(room(), 1, TABLE), ready + 5, (t) => press({ dodgePressed: t === 0 || t === pressAt }));
      return types(r).filter((x) => x === 'dodge').length;
    };
    expect(BUFFER_TICKS).toBe(21);
    expect(dodgesWith(ready - BUFFER_TICKS)).toBe(2);
    expect(dodgesWith(ready - BUFFER_TICKS - 1)).toBe(1);
  });

  it('cancels a staple that is still in startup', () => {
    const r = run(createGame(room(), 1, TABLE), 6, (t) => press({ attackPressed: t === 0, dodgePressed: t === 1 }));
    expect(types(r)).toEqual(['dodge']);
  });
});

/** A salesman placed just right of the operator starts its windup on the first tick. */
function duel(): GameState {
  return createGame(room([{ type: 'salesman', x: 190, y: 192 }]), 1, TABLE);
}

describe('taking a hit (design doc 5.3)', () => {
  it('the salesman telegraphs for 0.5 s, then a hit costs half a heart and freezes the fight 4 frames', () => {
    const r = run(duel(), 60);
    const tele = firstTick(r, 'telegraph');
    const hit = firstTick(r, 'heartLost');
    expect(hit - tele).toBe(SALESMAN.windupTicks);
    expect(r.events[hit]).toContainEqual({ type: 'freeze', frames: HURT.freezeTicks });
    expect(r.state.operator.halves).toBe(11);
  });

  it('during the freeze nothing moves, and the knockback then pushes one tile away', () => {
    const r = run(duel(), 60);
    const hit = firstTick(r, 'heartLost');
    const at = run(duel(), hit + 1).state;
    const frozen = run(at, HURT.freezeTicks, () => press({ move: { x: -1, y: 0 } })).state;
    expect(frozen.operator.x).toBe(at.operator.x);
    expect(frozen.enemies).toEqual(at.enemies);
    const knocked = run(frozen, HURT.knockbackTicks).state;
    expect(at.operator.x - knocked.operator.x).toBeCloseTo(TILE, 6);
  });

  // Dodging through the strike, not away from it: a perfect dodge needs the hit to overlap i-frames.
  it('a dodge pressed when the telegraph ends leaves hearts unchanged and can be perfect', () => {
    const tele = firstTick(run(duel(), 60), 'telegraph');
    const at = tele + SALESMAN.windupTicks - 2;
    const r = run(duel(), 90, (t) => press({ dodgePressed: t === at, move: { x: t === at ? 1 : 0, y: 0 } }));
    expect(r.state.operator.halves).toBe(12);
    expect(types(r)).toContain('perfectDodge');
  });

  it('a second strike inside the invulnerability window does not land', () => {
    const g = createGame(room([{ type: 'salesman', x: 190, y: 192 }, { type: 'salesman', x: 130, y: 192 }]), 1, TABLE);
    const r = run(g, 60);
    expect(types(r).filter((x) => x === 'heartLost')).toHaveLength(1);
    expect(r.state.operator.halves).toBe(11);
  });

  it('hurt invulnerability lasts one second after the knockback', () => {
    const hit = firstTick(run(duel(), 60), 'heartLost');
    const s = run(duel(), hit + 1).state;
    expect(s.operator.invulnUntil - s.tick).toBe(HURT.freezeTicks + HURT.knockbackTicks + HURT.invulnTicks);
  });

  it('losing every half heart is a forced leave back to the start with full hearts', () => {
    const g = duel();
    const s = { ...g, operator: { ...g.operator, halves: 1 } };
    const r = run(s, 60);
    expect(types(r)).toContain('forcedLeave');
    expect(r.state.operator).toMatchObject({ halves: 12, x: 160, y: 192 });
  });

  it('the hit that causes a forced leave announces no freeze, because none happens', () => {
    const g = duel();
    const r = run({ ...g, operator: { ...g.operator, halves: 1 } }, 60);
    const leave = firstTick(r, 'forcedLeave');
    expect(r.events[leave]!.map((e) => e.type)).not.toContain('freeze');
    expect(types(r)).not.toContain('freeze');
  });
});

describe('spawning', () => {
  it('every enemy gets its own id however many copies a Spawn has', () => {
    const g = createGame(room([{ type: 'salesman', x: 300, y: 100, count: 17 }, { type: 'salesman', x: 300, y: 250 }]), 1, TABLE);
    const ids = g.enemies.map((e) => e.id);
    expect(ids).toHaveLength(18);
    expect(new Set(ids).size).toBe(18);
    expect(g.nextId).toBeGreaterThan(Math.max(...ids));
  });
});

describe('enemy categories (design doc 5.5)', () => {
  const shootAt = (type: string, ticks: number) => {
    const g = createGame(room([{ type, x: 260, y: 192 }]), 1, TABLE);
    return run({ ...g, operator: { ...g.operator, aim: { x: 1, y: 0 } } }, ticks, (t) => press({ attackPressed: t === 0 }));
  };

  it('a suit takes damage and closes its case at 0 performance', () => {
    const g = createGame(room([{ type: 'salesman', x: 400, y: 192 }]), 1, TABLE);
    const r = run({ ...g, operator: { ...g.operator, aim: { x: 1, y: 0 } } }, 90, (t) => press({ attack: t < 50 }));
    expect(types(r).filter((x) => x === 'hit')).toHaveLength(3);
    expect(types(r)).toContain('caseClosed');
  });

  it('adenosine disperses on a hit and reforms 6 s later; its count never drops', () => {
    const r = shootAt('adenosine', 400);
    const d = firstTick(r, 'dispersed');
    expect(firstTick(r, 'reformed') - d).toBe(360);
    expect(r.state.enemies).toHaveLength(1);
  });

  it('an alcohol barrel bounces the staple with its solution and never freezes or takes damage', () => {
    const r = shootAt('alcohol_barrel', 30);
    expect(r.events.flat()).toContainEqual({ type: 'immuneBounce', target: 1, enemy: 'alcohol_barrel', solution: 'conveyor' });
    expect(types(r)).not.toContain('freeze');
    expect(r.state.enemies[0]!.frozen).toBe(0);
  });

  it('a closed case respawns after respawnSeconds', () => {
    const g = createGame(room([{ type: 'salesman', x: 400, y: 192, respawnSeconds: 1 }]), 1, TABLE);
    const r = run({ ...g, operator: { ...g.operator, aim: { x: 1, y: 0 } } }, 200, (t) => press({ attack: t < 50 }));
    expect(firstTick(r, 'respawned') - firstTick(r, 'caseClosed')).toBe(60);
  });
});

describe('order independence (build plan S8b)', () => {
  it('overlap results do not depend on the order of enemies in state', () => {
    const g = createGame(room([
      { type: 'salesman', x: 260, y: 192 }, { type: 'adenosine', x: 262, y: 192 }, { type: 'alcohol_barrel', x: 264, y: 192 },
    ]), 1, TABLE);
    const base = { ...g, operator: { ...g.operator, aim: { x: 1, y: 0 } } };
    const reversed = { ...base, enemies: [...base.enemies].reverse() as EnemyState[] };
    const a = run(base, 120, (t) => press({ attack: t < 80 }));
    const b = run(reversed, 120, (t) => press({ attack: t < 80 }));
    expect(b.events).toEqual(a.events);
    expect(stateHash(b.state)).toBe(stateHash(a.state));
  });
});
