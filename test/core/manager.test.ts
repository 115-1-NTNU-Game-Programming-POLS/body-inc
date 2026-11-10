import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENEMIES } from '../../src/app/content.ts';
import {
  createGame, FOLDER, GAUGE, MANAGER, NO_INPUT, parseRoom, shieldCovers, step, STAPLER, STAMP, TELEGRAPH, TICK_HZ,
  type DomainEvent, type EnteredRoom, type EnemyState, type GameState, type TickInput, type TiledMap,
} from '../../src/core/index.ts';
import { stepEnemy } from '../../src/core/combat/actors.ts';
import { TAGS } from '../../src/app/content.ts';

/**
 * The manager archetype (design doc 5.3), the large-portion salesman of the stomach chapter: a
 * shield over his front 120 degrees that staples and the folder's light swings cannot get through,
 * got round from behind, with a sent-back shot or with the folder's heavy hit.
 */

const START = { x: 160, y: 192 };
const WEST = { x: -1, y: 0 };
const EAST = { x: 1, y: 0 };

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
const held = (from: number) => (t: number): TickInput => press({ attack: t >= from, attackPressed: t === from });
const tap = (...ticks: number[]) => (t: number): TickInput => press({ attack: ticks.includes(t), attackPressed: ticks.includes(t) });

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

/**
 * A manager `dx` pixels east of the operator, resting in his pause so that he does not act for a
 * second, facing `facing`. The operator aims east with the tool in hand.
 */
function manager(facing: { x: number; y: number }, tool: 'stapler' | 'folder' = 'stapler', over: Partial<EnemyState> = {}, dx = 4 * 32, gauge?: number): GameState {
  const g = createGame(room([{ type: 'large_seller', x: START.x + dx, y: START.y }]), 1, ENEMIES, { tool, ...(gauge === undefined ? {} : { gauge }) });
  return {
    ...g,
    operator: { ...g.operator, aim: EAST },
    enemies: g.enemies.map((e) => ({ ...e, facing, phase: 'recover' as const, phaseTicks: 0, ...over })),
  };
}
const hp = (s: GameState) => s.enemies[0]!.hp;

describe('the large-portion salesman as data', () => {
  it('is a defeatable manager of performance 12, and a spawn in the stomach rooms starts him facing south', () => {
    expect(ENEMIES.enemies.get('large_seller')).toEqual({ id: 'large_seller', category: 'defeatable', archetype: 'manager', performance: 12 });
    const g = createGame(room([{ type: 'large_seller', x: 300, y: 192 }]), 1, ENEMIES);
    expect(g.enemies[0]).toMatchObject({ archetype: 'manager', hp: 12, maxHp: 12, facing: { x: 0, y: 1 } });
    expect(g.enemies[0]!.broken).toBeUndefined();
  });

  it('stands in the stomach mixer lab', () => {
    const tmj = JSON.parse(readFileSync('public/assets/maps/stomach/mixer-lab.tmj', 'utf8')) as TiledMap;
    const lab = parseRoom('stomach/mixer-lab', tmj, TAGS);
    expect(lab.objects.filter((o) => o.kind === 'Spawn' && o.props['enemyType'] === 'large_seller')).toHaveLength(1);
  });

  it('other archetypes never carry a facing or a broken shield', () => {
    const g = createGame(room([{ type: 'salesman', x: 300, y: 192 }, { type: 'flyer', x: 320, y: 192 }]), 1, ENEMIES);
    for (const e of g.enemies) {
      expect(e.facing).toBeUndefined();
      expect(shieldCovers(e, WEST)).toBe(false);
    }
  });
});

describe('what the shield covers', () => {
  const at = (deg: number) => ({ x: Math.cos((deg * Math.PI) / 180), y: Math.sin((deg * Math.PI) / 180) });
  const m = (facing = EAST) => createGame(room([{ type: 'large_seller', x: 300, y: 192 }]), 1, ENEMIES).enemies.map((e) => ({ ...e, facing }))[0]!;

  it('is the 120 degrees around his facing, the limit included', () => {
    expect(shieldCovers(m(), EAST)).toBe(true);
    expect(shieldCovers(m(), at(59))).toBe(true);
    expect(shieldCovers(m(), at(60))).toBe(true);
    expect(shieldCovers(m(), at(-60))).toBe(true);
    expect(shieldCovers(m(), at(61))).toBe(false);
    expect(shieldCovers(m(), at(-61))).toBe(false);
    expect(shieldCovers(m(), WEST)).toBe(false);
    expect(shieldCovers(m(WEST), WEST)).toBe(true);
  });

  it('is down while it is broken, and a broken counter that has run out is gone', () => {
    expect(shieldCovers({ ...m(), broken: 5 }, EAST)).toBe(false);
    expect(shieldCovers({ ...m(), broken: 0 }, EAST)).toBe(true);
  });
});

describe('staples', () => {
  it('are stopped from the front: no damage, no gauge, no hit-stop, and the staple is spent', () => {
    const r = run(manager(WEST), 40, held(0));
    expect(ofType(r, 'fire').length).toBeGreaterThan(2);
    expect(ofType(r, 'shieldBlocked').length).toBeGreaterThan(2);
    expect(ofType(r, 'shieldBlocked')[0]).toMatchObject({ type: 'shieldBlocked', target: 1, enemy: 'large_seller' });
    expect(ofType(r, 'hit')).toEqual([]);
    expect(hp(r.state)).toBe(12);
    expect(r.state.operator.gauge).toBe(0);
    expect(r.state.enemies[0]!.frozen).toBe(0);
    expect(r.state.projectiles.filter((p) => p.x > START.x + 4 * 32)).toEqual([]);
  });

  it('land from behind as on any enemy: damage and gauge, and he is not broken by it', () => {
    const r = run(manager(EAST), 40, held(0));
    expect(ofType(r, 'shieldBlocked')).toEqual([]);
    expect(ofType(r, 'hit').length).toBeGreaterThan(2);
    expect(hp(r.state)).toBeLessThan(12);
    expect(r.state.operator.gauge).toBeCloseTo(ofType(r, 'hit').length * GAUGE.staple, 6);
    expect(ofType(r, 'shieldBroken')).toEqual([]);
    expect(r.state.enemies[0]!.broken).toBeUndefined();
  });

  it('get by at 90 degrees off his facing', () => {
    // He faces north and the operator stands due west of him, so the shot gets by.
    const side = run(manager({ x: 0, y: -1 }), 40, held(0));
    expect(ofType(side, 'shieldBlocked')).toEqual([]);
    expect(ofType(side, 'hit').length).toBeGreaterThan(0);
  });

  it('are stopped at 50 degrees off his facing and get by at 70, the cone being 120 wide', () => {
    // The operator is due west of him; his facing is turned that far away from west. The staple's own path is a few
    // degrees off the level, so the exact edge is left to the shieldCovers cases above.
    const off = (deg: number) => ({ x: Math.cos(((180 - deg) * Math.PI) / 180), y: Math.sin(((180 - deg) * Math.PI) / 180) });
    const inside = run(manager(off(50)), 20, held(0));
    expect(ofType(inside, 'shieldBlocked').length).toBeGreaterThan(0);
    expect(ofType(inside, 'hit')).toEqual([]);
    const outside = run(manager(off(70)), 20, held(0));
    expect(ofType(outside, 'shieldBlocked')).toEqual([]);
    expect(ofType(outside, 'hit').length).toBeGreaterThan(0);
  });
});

describe('the folder', () => {
  const dx = 20;
  const string = (state: GameState) => run(state, 30, tap(0, 5, 15));

  it('is stopped by the shield on the two light swings and breaks it with the third, which lands for 4', () => {
    const r = string(manager(WEST, 'folder', {}, dx));
    expect(ofType(r, 'swing').map((e) => e.combo)).toEqual([0, 1, 2]);
    expect(ofType(r, 'shieldBlocked')).toHaveLength(2);
    expect(ofType(r, 'hit').map((e) => e.hpLeft)).toEqual([8]);
    expect(ofType(r, 'shieldBroken')).toEqual([{ type: 'shieldBroken', target: 1, enemy: 'large_seller', by: 'folder' }]);
    // The light swings come first, the heavy hit last.
    const blocked = r.events.flatMap((es, t) => (es.some((e) => e.type === 'shieldBlocked') ? [t] : []));
    expect(Math.max(...blocked)).toBeLessThan(firstTick(r, 'shieldBroken'));
    expect(hp(r.state)).toBe(12 - FOLDER.damage[FOLDER.finisher]!);
  });

  it('charges the gauge only for the hit that lands, not for the swings the shield stopped', () => {
    const r = string(manager(WEST, 'folder', {}, dx));
    expect(r.state.operator.gauge).toBeCloseTo(GAUGE.folder, 10);
  });

  it('gives a swing the shield stopped no hit-stop and no damage, and the next swing is stopped as well', () => {
    const state = manager(WEST, 'folder', {}, dx);
    const first = firstTick(string(state), 'shieldBlocked');
    const after = run(state, first + 1, tap(0, 5, 15)).state.enemies[0]!;
    expect(after.frozen).toBe(0);
    expect(after.hp).toBe(12);
    const second = run(state, 14, tap(0, 5));
    expect(ofType(second, 'shieldBlocked')).toHaveLength(2);
    expect(hp(second.state)).toBe(12);
  });

  it('judges each target of one swing on its own: stopped by the manager facing it, landing on the one whose back is turned', () => {
    const g = createGame(room([{ type: 'large_seller', x: START.x + 20, y: START.y - 3 }, { type: 'large_seller', x: START.x + 20, y: START.y + 3 }]), 1, ENEMIES, { tool: 'folder' });
    const both: GameState = {
      ...g,
      operator: { ...g.operator, aim: EAST },
      enemies: g.enemies.map((e, i) => ({ ...e, facing: i === 0 ? WEST : EAST, phase: 'recover' as const, phaseTicks: 0 })),
    };
    const [facing, away] = both.enemies as [EnemyState, EnemyState];
    const r = run(both, 12, tap(0));
    expect(ofType(r, 'shieldBlocked').map((e) => e.target)).toEqual([facing.id]);
    expect(ofType(r, 'hit').map((e) => e.target)).toEqual([away.id]);
    expect(r.state.enemies.find((e) => e.id === facing.id)!.hp).toBe(12);
    expect(r.state.enemies.find((e) => e.id === away.id)!.hp).toBeLessThan(12);
  });

  it('a blow that would kill is a kill, not a break: his case closes and no shield breaks', () => {
    const r = string(manager(WEST, 'folder', { hp: 2 }, dx));
    expect(ofType(r, 'shieldBroken')).toEqual([]);
    expect(ofType(r, 'caseClosed')).toEqual([{ type: 'caseClosed', target: 1, enemy: 'large_seller' }]);
    expect(r.state.enemies[0]).toMatchObject({ phase: 'closed' });
    expect(r.state.enemies[0]!.broken).toBeUndefined();
  });

  it('a broken manager is stunned for 1.2 s with his bash called off, and his shield is down for 3 s from the break', () => {
    const wound = manager(WEST, 'folder', { phase: 'windup', phaseTicks: 5, strikeSpent: false }, dx);
    const r = string(wound);
    const t = firstTick(r, 'shieldBroken');
    const at = run(wound, t + 1, tap(0, 5, 15)).state.enemies[0]!;
    expect(at).toMatchObject({ phase: 'recover', frozen: MANAGER.breakStunTicks, broken: MANAGER.breakTicks, strikeSpent: true });
    expect(at.frozen).toBeGreaterThan(FOLDER.hitFreeze[FOLDER.finisher]!);
    // The stun is 1.2 s to the tick, and the shield-down counter runs through it.
    const later = (n: number) => run(wound, t + 1 + n, tap(0, 5, 15)).state.enemies[0]!;
    expect(later(MANAGER.breakStunTicks - 1)).toMatchObject({ frozen: 1, broken: MANAGER.breakTicks - (MANAGER.breakStunTicks - 1) });
    // He wakes into the last tick of his pause: still resting when the stun ends, idle one tick later.
    expect(later(MANAGER.breakStunTicks)).toMatchObject({ frozen: 0, phase: 'recover' });
    expect(later(MANAGER.breakStunTicks + 1).phase).toBe('idle');
  });

  it('a light swing lands on him while the shield is down, and the shield comes back for the next string', () => {
    const broken = string(manager(WEST, 'folder', {}, dx)).state;
    const down = run(broken, 10, tap(0));
    expect(ofType(down, 'shieldBlocked')).toEqual([]);
    expect(ofType(down, 'hit').map((e) => e.hpLeft)).toEqual([6]);
    // Wait out the shield, pause cleared so that nothing else changes: the first swing is stopped again.
    const mended = { ...broken, enemies: broken.enemies.map((e) => ({ ...e, broken: 1, frozen: 0, phase: 'recover' as const, phaseTicks: 0 })) };
    const again = run(mended, 8, tap(0));
    expect(ofType(again, 'shieldBlocked')).toHaveLength(1);
    expect(ofType(again, 'hit')).toEqual([]);
  });

  it('swings from behind do their normal damage on every blow, with no break to speak of', () => {
    const r = string(manager(EAST, 'folder', {}, dx));
    expect(ofType(r, 'hit').map((e) => e.hpLeft)).toEqual([10, 8, 4]);
    expect(ofType(r, 'shieldBlocked')).toEqual([]);
    expect(ofType(r, 'shieldBroken')).toEqual([]);
  });
});

describe('a shot the folder sent back', () => {
  /** A sent-back shot level with him, flying east from the operator's side at his shield. */
  const reflected = (state: GameState): GameState => {
    const e = state.enemies[0]!;
    return {
      ...state,
      projectiles: [{ id: 900, x: e.x - 14, y: e.y - 8, vx: 4, vy: 0, ticksLeft: 30, damage: FOLDER.reflectDamage, reflected: true }],
    };
  };

  it('breaks the shield: its double damage lands, he is stunned and the bash he was winding up is off', () => {
    const wound = reflected(manager(WEST, 'stapler', { phase: 'windup', phaseTicks: 5, strikeSpent: false }));
    const r = run(wound, 4);
    expect(ofType(r, 'shieldBlocked')).toEqual([]);
    expect(ofType(r, 'shieldBroken')).toEqual([{ type: 'shieldBroken', target: 1, enemy: 'large_seller', by: 'reflect' }]);
    expect(hp(r.state)).toBe(12 - FOLDER.reflectDamage);
    expect(r.state.operator.gauge).toBe(0);
    const at = run(wound, firstTick(r, 'shieldBroken') + 1).state.enemies[0]!;
    expect(at).toMatchObject({ phase: 'recover', frozen: MANAGER.breakStunTicks, broken: MANAGER.breakTicks, strikeSpent: true });
  });

  it('does nothing to the shield when it comes from behind, where nothing needs breaking', () => {
    const r = run(reflected(manager(EAST)), 4);
    expect(ofType(r, 'shieldBroken')).toEqual([]);
    expect(hp(r.state)).toBe(12 - FOLDER.reflectDamage);
  });
});

describe('the stamp', () => {
  it('ignores the shield: a manager in its radius takes the full 25 and his case closes', () => {
    // Three tiles away, inside the stamp's 3.5.
    const full = manager(WEST, 'stapler', {}, 3 * 32, STAMP.gaugeMax);
    const r = run(full, STAMP.startupTicks + 4, (t) => press({ stampPressed: t === 0 }));
    expect(ofType(r, 'stampLanded')).toHaveLength(1);
    expect(ofType(r, 'shieldBlocked')).toEqual([]);
    expect(ofType(r, 'caseClosed')).toEqual([{ type: 'caseClosed', target: 1, enemy: 'large_seller' }]);
    expect(r.state.enemies[0]!.phase).toBe('closed');
  });
});

describe('what he does', () => {
  const open = () => room().grid;
  const spawn = (dx: number, facing = { x: 0, y: 1 }): GameState => {
    const g = createGame(room([{ type: 'large_seller', x: START.x + dx, y: START.y }]), 1, ENEMIES);
    return { ...g, enemies: g.enemies.map((e) => ({ ...e, facing })) };
  };
  const angle = (v: { x: number; y: number }) => Math.atan2(v.y, v.x);
  const between = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const d = Math.abs(angle(a) - angle(b));
    return d > Math.PI ? 2 * Math.PI - d : d;
  };

  it('walks at the operator at his own speed and turns his shield towards them at most a quarter turn a second', () => {
    let e = spawn(8 * 32, { x: 0, y: 1 }).enemies[0]!;
    const target = { x: START.x, y: START.y };
    let steps = 0;
    while (between(e.facing!, WEST) > 1e-9 && steps < 400) {
      const before = e;
      e = stepEnemy(open(), e, target).enemy;
      steps++;
      expect(between(before.facing!, e.facing!)).toBeLessThanOrEqual(MANAGER.turnPerTick + 1e-9);
      expect(before.x - e.x).toBeCloseTo(MANAGER.speed, 6);
    }
    // A quarter turn at 90 degrees a second is a second, to the tick.
    expect(steps).toBe(Math.ceil(Math.PI / 2 / MANAGER.turnPerTick));
    expect(e.facing).toEqual(WEST);
  });

  it('does not wind up in reach while his back is turned, and then only once he faces them to within 30 degrees', () => {
    const r = run(spawn(30, EAST), 200);
    const first = firstTick(r, 'telegraph');
    // From facing away (180 degrees round) to within 30 degrees is 150 degrees of turning.
    const turn = Math.ceil(((150 * Math.PI) / 180) / MANAGER.turnPerTick);
    expect(first).toBeGreaterThanOrEqual(turn - 2);
    expect(first).toBeLessThanOrEqual(turn);
    // He never moved: inside reach he only turns.
    const s = run(spawn(30, EAST), turn - 3).state.enemies[0]!;
    expect(s.x).toBe(START.x + 30);
    expect(s.phase).toBe('idle');
  });

  it('keeps his facing from the start of the windup to the end of his pause, whatever the operator does', () => {
    const start = spawn(30, WEST);
    const seen: { phase: string; facing: { x: number; y: number } | undefined }[] = [];
    let s = start;
    for (let t = 0; t < 160; t++) {
      // The operator walks north for a third of a second and stops: only the facing is watched.
      s = step(s, press({ move: { x: 0, y: t < 20 ? -1 : 0 } })).state;
      const e = s.enemies[0]!;
      seen.push({ phase: e.phase, facing: e.facing });
    }
    // One bash is a run of committed ticks; between two runs he is idle and may turn.
    const runs: { facing: { x: number; y: number } | undefined }[][] = [];
    let inBash = false;
    for (const p of seen) {
      const committed = p.phase === 'windup' || p.phase === 'strike' || p.phase === 'recover';
      if (committed && !inBash) runs.push([]);
      if (committed) runs[runs.length - 1]!.push(p);
      inBash = committed;
    }
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs[0]!.length).toBe(MANAGER.windupTicks + MANAGER.strikeTicks + MANAGER.recoverTicks);
    for (const bash of runs) for (const p of bash) expect(p.facing).toEqual(bash[0]!.facing);
  });

  it('turns again once the pause is over, at the same rate', () => {
    // From a run of committed ticks to the first tick he is idle: his facing has not moved yet, then it follows the operator.
    let s = spawn(30, WEST);
    const facings: { phase: string; facing: { x: number; y: number } }[] = [];
    for (let t = 0; t < 220; t++) {
      // The operator walks to the far side of him during the first pause.
      s = step(s, press({ move: { x: 0, y: -1 } })).state;
      facings.push({ phase: s.enemies[0]!.phase, facing: s.enemies[0]!.facing! });
    }
    const idleAfter = facings.findIndex((f, i) => i > MANAGER.windupTicks && f.phase === 'idle');
    expect(idleAfter).toBeGreaterThan(MANAGER.windupTicks);
    // The operator is a quarter turn or more away by now, so the first idle tick turns him the full step.
    expect(between(facings[idleAfter]!.facing, facings[idleAfter + 1]!.facing)).toBeCloseTo(MANAGER.turnPerTick, 9);
  });

  it('keeps the shield-down count running through the stun and the walk after it, and is clear on the last tick', () => {
    const stunned: EnemyState = { ...spawn(8 * 32, WEST).enemies[0]!, broken: MANAGER.breakTicks, frozen: MANAGER.breakStunTicks, phase: 'recover', phaseTicks: MANAGER.recoverTicks - 1, strikeSpent: true };
    const target = { x: START.x, y: START.y };
    let e = stunned;
    for (let n = 1; n < MANAGER.breakTicks; n++) e = stepEnemy(open(), e, target).enemy;
    expect(e.broken).toBe(1);
    expect(e.frozen).toBe(0);
    expect(stepEnemy(open(), e, target).enemy.broken).toBeUndefined();
  });

  it('winds up for exactly the tier-1 warning, and the strike costs half a heart', () => {
    expect(MANAGER.windupTicks).toBe(TELEGRAPH.tier1Ticks);
    const r = run(spawn(30, WEST), 120);
    const h = firstTick(r, 'telegraph');
    expect(h).toBe(0);
    const strikeAt = r.events.findIndex((_, t) => t > h && run(spawn(30, WEST), t + 1).state.enemies[0]!.phase === 'strike');
    expect(strikeAt - h).toBe(MANAGER.windupTicks);
    expect(ofType(r, 'heartLost')).toEqual([{ type: 'heartLost', halves: 1, cause: 'large_seller' }]);
  });

  it('can be dodged on the last tick of the warning', () => {
    const start = spawn(30, WEST);
    const warned = firstTick(run(start, 10), 'telegraph');
    const last = warned + MANAGER.windupTicks - 1;
    const dodged = run(start, 120, (t) => press({ dodgePressed: t === last, move: { x: 0, y: 0 } }));
    expect(ofType(dodged, 'heartLost')).toEqual([]);
    expect(ofType(dodged, 'dodge')).toHaveLength(1);
    // The control: the same bash with no dodge does cost the heart.
    expect(ofType(run(start, 120), 'heartLost')).toHaveLength(1);
  });

  it('a parry of his bash stuns him for 1.2 s as it does a salesman, from the manager\'s own pause', () => {
    const start = spawn(30, WEST);
    // The tick his bash lands when nobody guards, then the same bash met by a guard five frames up.
    const landing = firstTick(run(start, 120), 'heartLost');
    expect(landing).toBe(MANAGER.windupTicks);
    const frame = 5;
    const from = landing - frame + 1;
    const before = run(start, from);
    const up = { ...before.state, operator: { ...before.state.operator, tool: 'folder' as const, aim: EAST, action: { kind: 'guard' as const, frame: 0 }, held: FOLDER.holdTicks } };
    const after = run(up, landing + 1 - from, () => press({ attack: true }));
    const r = { state: after.state, events: [...before.events, ...after.events] };
    expect(ofType(r, 'heartLost')).toEqual([]);
    expect(ofType(r, 'parry')).toEqual([{ type: 'parry', source: 1, kind: 'strike' }]);
    expect(r.state.enemies[0]).toMatchObject({ frozen: FOLDER.parryStunTicks, phase: 'recover', phaseTicks: MANAGER.recoverTicks - 1 });
  });
});

describe('back at his post', () => {
  const open = () => room().grid;
  const target = { x: START.x, y: START.y };

  it('a respawn puts his shield up again, facing south, whatever state it was in when he fell', () => {
    const fallen: EnemyState = { ...manager(EAST, 'stapler', { broken: 50, phase: 'closed', phaseTicks: 59, respawnTicks: 60, hp: 0 }).enemies[0]! };
    const r = stepEnemy(open(), fallen, target);
    expect(r.respawned).toBe(true);
    expect(r.enemy).toMatchObject({ phase: 'idle', hp: 12, facing: { x: 0, y: 1 } });
    expect(r.enemy.broken).toBeUndefined();
  });

  it('a forced leave does the same: a broken shield and the way he faced do not carry into the retry', () => {
    const state = manager(EAST, 'stapler', { broken: 150, phase: 'recover', phaseTicks: 3, hp: 5 });
    const r = run({ ...state, operator: { ...state.operator, halves: 0 } }, 1);
    expect(ofType(r, 'forcedLeave')).toHaveLength(1);
    expect(r.state.enemies[0]).toMatchObject({ phase: 'idle', hp: 12, facing: { x: 0, y: 1 } });
    expect(r.state.enemies[0]!.broken).toBeUndefined();
  });
});

describe('his numbers', () => {
  it('pause long enough to walk round him, and a stun and a broken shield that outlast it', () => {
    expect(MANAGER.recoverTicks).toBeGreaterThanOrEqual(TICK_HZ);
    expect(MANAGER.breakTicks).toBeGreaterThan(MANAGER.breakStunTicks);
    expect(MANAGER.shieldHalfAngleDeg).toBe(FOLDER.guardHalfAngleDeg);
    expect(STAPLER.damage).toBe(1);
  });

  it('are the ones the design notes and the authoring guide state', () => {
    expect(MANAGER.shieldHalfAngleDeg * 2).toBe(120);
    expect(MANAGER.aimHalfAngleDeg).toBe(30);
    expect((MANAGER.turnPerTick * TICK_HZ * 180) / Math.PI).toBeCloseTo(90, 9);
    expect(MANAGER.breakTicks / TICK_HZ).toBe(3);
    expect(MANAGER.breakStunTicks / TICK_HZ).toBeCloseTo(1.2, 9);
    expect(FOLDER.damage[FOLDER.finisher]).toBe(4);
  });
});
