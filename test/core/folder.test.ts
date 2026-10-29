import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENEMIES, BOSSES, DIALOGUES, PARAMS, TAGS } from '../../src/app/content.ts';
import {
  createGame, FOLDER, GAUGE, guardCovers, loadEnemyTable, loadDialogueTable, NO_INPUT, parseRoom, startChapter, stateHash, step, stepChapter,
  STAPLER, TILE,
  type ChapterContent, type ChapterFile, type DomainEvent, type EnteredRoom, type GameEvent, type GameState, type TickInput, type TiledMap,
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

const RIGHT = { x: 1, y: 0 };
/** The folder in hand, aimed right. */
function folderGame(spawns: Parameters<typeof room>[0] = [], p = 1): GameState {
  const g = createGame(room(spawns), 1, TABLE, { tool: 'folder', p });
  return { ...g, operator: { ...g.operator, aim: RIGHT } };
}
const press = (extra: Partial<TickInput> = {}): TickInput => ({ ...NO_INPUT, ...extra });
/** The attack key pressed on `from` and held through `to`; the presses of a tap are `tap`. */
const held = (from: number, to = Infinity) => (t: number): TickInput => press({ attack: t >= from && t <= to, attackPressed: t === from });
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

describe('swapping tools (design doc 6.1)', () => {
  const stapler = () => createGame(room(), 1, TABLE);

  it('F puts the folder in hand and again the stapler, each time with an event', () => {
    const r = run(stapler(), 3, (t) => press({ swapPressed: t === 0 || t === 2 }));
    expect(ofType(r, 'toolSwapped').map((e) => e.tool)).toEqual(['folder', 'stapler']);
    expect(r.state.operator.tool).toBe('stapler');
    expect(run(stapler(), 1, () => press({ swapPressed: true })).state.operator.tool).toBe('folder');
  });

  it('does nothing while the folder is locked, and a locked folder is never in hand at the start', () => {
    const locked = createGame(room(), 1, TABLE, { folderLocked: true });
    const r = run(locked, 3, () => press({ swapPressed: true }));
    expect(ofType(r, 'toolSwapped')).toEqual([]);
    expect(r.state.operator.tool).toBe('stapler');
    expect(createGame(room(), 1, TABLE, { folderLocked: true, tool: 'folder' }).operator.tool).toBe('stapler');
  });

  it('keeps attacks waiting for 0.15 s but not a dodge', () => {
    const swing = run(stapler(), 20, (t) => press({ swapPressed: t === 0, attack: true, attackPressed: t === 0 }));
    expect(firstTick(swing, 'swing')).toBe(FOLDER.swapTicks);
    const dodge = run(stapler(), 6, (t) => press({ swapPressed: t === 0, dodgePressed: t === 3 }));
    expect(firstTick(dodge, 'dodge')).toBe(3);
  });

  it('the folder fires no staples, and the stapler never raises a guard', () => {
    expect(ofType(run(folderGame(), 30, held(0)), 'fire')).toEqual([]);
    const r = run(stapler(), 30, held(0));
    expect(ofType(r, 'fire').length).toBeGreaterThan(0);
    expect(ofType(r, 'guardRaised')).toEqual([]);
  });

  it('an attack pressed before F is done with the tool in hand, and only then the swap', () => {
    // Pressed on tick 0 the staple leaves on tick 2, so the swap pressed on tick 1 waits for it.
    const staple = run(stapler(), 40, (t) => press({ attackPressed: t === 0, swapPressed: t === 1 || t === 20 }));
    expect(ofType(staple, 'fire')).toHaveLength(1);
    expect(ofType(staple, 'toolSwapped').map((e) => e.tool)).toEqual(['folder', 'stapler']);
    expect(firstTick(staple, 'fire')).toBeLessThan(firstTick(staple, 'toolSwapped'));
    // Pressed during a hit-stop, both wait for it to end and keep their order.
    const frozen = run({ ...stapler(), freeze: 4 }, 40, (t) => press({ attackPressed: t === 0, swapPressed: t === 1 }));
    expect(ofType(frozen, 'fire')).toHaveLength(1);
    expect(firstTick(frozen, 'fire')).toBeLessThan(firstTick(frozen, 'toolSwapped'));
    // The next blow of a combo pressed during the swing, then F: the blow lands before the folder goes.
    const combo = run(folderGame(), 40, (t) => press({ attack: t === 0 || t === 5, attackPressed: t === 0 || t === 5, swapPressed: t === 6 }));
    expect(ofType(combo, 'swing').map((e) => e.combo)).toEqual([0, 1]);
    const second = combo.events.findIndex((es, t) => t > 0 && es.some((e) => e.type === 'swing'));
    expect(firstTick(combo, 'toolSwapped')).toBeGreaterThan(second);
    expect(combo.state.operator.tool).toBe('stapler');
  });

  it('F during a dodge swaps at once, with no drawer left to wait for when the dodge ends', () => {
    // F two ticks before the dodge ends, attack pressed from then on: the first swing comes as soon
    // as the dodge allows, exactly as if the folder had been in hand all along.
    const late = 17;
    const attacks = (t: number) => t >= late ? { attack: true, attackPressed: true } : {};
    const baseline = run(folderGame(), 40, (t) => press({ dodgePressed: t === 0, ...attacks(t) }));
    const midDodge = run(stapler(), 40, (t) => press({ dodgePressed: t === 0, swapPressed: t === late, ...attacks(t) }));
    expect(firstTick(midDodge, 'toolSwapped')).toBe(late);
    expect(firstTick(baseline, 'swing')).toBeLessThan(late + FOLDER.swapTicks);
    expect(firstTick(midDodge, 'swing')).toBe(firstTick(baseline, 'swing'));
  });
  it('a press during a swing or hit-stop is kept until the operator is free, not eaten', () => {
    // The swing runs ticks 0 to FOLDER.swingTicks - 1; the swap waits for the tick after.
    const swing = run(folderGame(), 20, (t) => press({ attack: t === 0, attackPressed: t === 0, swapPressed: t === 2 }));
    expect(ofType(swing, 'toolSwapped').map((e) => e.tool)).toEqual(['stapler']);
    expect(firstTick(swing, 'toolSwapped')).toBe(FOLDER.swingTicks);
    const frozen = run({ ...stapler(), freeze: 3 }, 6, (t) => press({ swapPressed: t === 0 }));
    expect(firstTick(frozen, 'toolSwapped')).toBe(3);
  });

  it('a second press before the swap happens takes it back', () => {
    const r = run(folderGame(), 20, (t) => press({ attack: t === 0, attackPressed: t === 0, swapPressed: t === 2 || t === 4 }));
    expect(ofType(r, 'toolSwapped')).toEqual([]);
    expect(r.state.operator.tool).toBe('folder');
  });

  it('a forced leave keeps the tool in hand', () => {
    const g = folderGame();
    const dying = { ...g, operator: { ...g.operator, halves: 0 } };
    const r = run(dying, 1);
    expect(ofType(r, 'forcedLeave')).toHaveLength(1);
    expect(r.state.operator.tool).toBe('folder');
  });
});

describe('the swing (design doc 6.1)', () => {
  /** A target in front of the default aim, with a pool big enough to read each blow. */
  const dummy = (hp = 40): GameState => {
    const g = folderGame([{ type: 'dummy', x: START.x + 20, y: START.y }]);
    return { ...g, enemies: g.enemies.map((e) => ({ ...e, hp, maxHp: hp })) };
  };

  it('hits on frame 3 and not before', () => {
    const r = run(dummy(), 12, tap(0));
    expect(firstTick(r, 'swing')).toBe(0);
    expect(firstTick(r, 'hit')).toBe(FOLDER.hitFrame - 1);
    expect(ofType(r, 'hit')).toHaveLength(1);
  });

  it('a string of three does 2, 2 and 4, each swing starting as the last one ends', () => {
    const r = run(dummy(), 40, tap(0, 5, 15));
    expect(ofType(r, 'swing').map((e) => e.combo)).toEqual([0, 1, 2]);
    expect(ofType(r, 'hit').map((e) => e.hpLeft)).toEqual([38, 36, 32]);
    expect(r.events.map((es, t) => (es.some((e) => e.type === 'swing') ? t : -1)).filter((t) => t >= 0))
      .toEqual([0, FOLDER.swingTicks, 2 * FOLDER.swingTicks]);
  });

  it('a swing that comes too late starts the string over, and the string wraps after three', () => {
    const late = FOLDER.swingTicks + FOLDER.comboGapTicks + 2;
    expect(ofType(run(dummy(), 60, tap(0, late)), 'swing').map((e) => e.combo)).toEqual([0, 0]);
    const just = FOLDER.swingTicks + FOLDER.comboGapTicks;
    expect(ofType(run(dummy(), 60, tap(0, just)), 'swing').map((e) => e.combo)).toEqual([0, 1]);
    const four = run(dummy(), 70, tap(0, 10, 20, 30));
    expect(ofType(four, 'swing').map((e) => e.combo)).toEqual([0, 1, 2, 0]);
  });

  it('a swing a few ticks after the last one ended still continues the string', () => {
    // Placeholder gap (0.3 s): a masher who is a little slow keeps the string, which 0 would break.
    expect(ofType(run(dummy(), 40, tap(0, FOLDER.swingTicks + 4)), 'swing').map((e) => e.combo)).toEqual([0, 1]);
  });
  it('freezes the enemy for 3 ticks, and 6 on the finisher', () => {
    const r = run(dummy(), 40, tap(0, 5, 15));
    const frozen = r.events.flatMap((es, t) => (es.some((e) => e.type === 'hit') ? [t] : []));
    expect(frozen).toHaveLength(3);
    const at = (t: number) => run(dummy(), t + 1, tap(0, 5, 15)).state.enemies[0]!.frozen;
    expect(frozen.map(at)).toEqual([3, 3, 6]);
  });

  it('charges 1.5 x P of gauge for a hit', () => {
    expect(run(dummy(), 6, tap(0)).state.operator.gauge).toBeCloseTo(GAUGE.folder, 10);
    const tired = folderGame([{ type: 'dummy', x: START.x + 20, y: START.y }], 0.72);
    expect(run(tired, 6, tap(0)).state.operator.gauge).toBeCloseTo(GAUGE.folder * 0.72, 10);
  });

  it('stands the operator still for the swing', () => {
    const r = run(dummy(), 8, (t) => press({ move: RIGHT, attack: t === 0, attackPressed: t === 0 }));
    expect(r.state.operator.x).toBe(START.x);
  });

  it('a dodge cancels the recovery after the hit, but not the startup before it (design doc 5.3)', () => {
    // Pressed on tick 1, the dodge waits for the hit on tick 2 and starts on tick 3.
    const early = run(dummy(), 12, (t) => press({ attack: t === 0, attackPressed: t === 0, dodgePressed: t === 1 }));
    expect(firstTick(early, 'hit')).toBe(FOLDER.hitFrame - 1);
    expect(firstTick(early, 'dodge')).toBe(FOLDER.hitFrame);
    const late = run(dummy(), 12, (t) => press({ attack: t === 0, attackPressed: t === 0, dodgePressed: t === 5 }));
    expect(firstTick(late, 'dodge')).toBe(5);
    expect(late.state.operator.action.kind).toBe('dodge');
  });

  it('a dodge still cooling down cancels nothing: the swing plays out', () => {
    const cooling = (g: GameState): GameState => ({ ...g, operator: { ...g.operator, dodgeReadyAt: 1000 } });
    const input = (t: number) => press({ attack: t === 0, attackPressed: t === 0, dodgePressed: t === 5 });
    const r = run(cooling(dummy()), 6, input);
    expect(ofType(r, 'dodge')).toEqual([]);
    expect(r.state.operator.action).toMatchObject({ kind: 'swing', frame: 6 });
    // Control: the same tick's press cancels the swing once the dodge is ready.
    expect(run(dummy(), 6, input).state.operator.action.kind).toBe('dodge');
  });

  it('misses an enemy behind it', () => {
    const g = folderGame([{ type: 'dummy', x: START.x - 20, y: START.y }]);
    expect(ofType(run(g, 10, tap(0)), 'hit')).toEqual([]);
  });

  it('an immune object only bounces it and a reforming one scatters, as under a staple', () => {
    const barrel = folderGame([{ type: 'alcohol_barrel', x: START.x + 20, y: START.y }]);
    const b = run(barrel, 6, tap(0));
    expect(ofType(b, 'immuneBounce')).toHaveLength(1);
    expect(ofType(b, 'hit')).toEqual([]);
    expect(b.state.operator.gauge).toBe(0);
    const fluff = run(folderGame([{ type: 'adenosine', x: START.x + 20, y: START.y }]), 6, tap(0));
    expect(ofType(fluff, 'dispersed')).toHaveLength(1);
    expect(fluff.state.operator.gauge).toBeCloseTo(GAUGE.folder, 10);
  });
});

describe('the guard and the parry (design doc 6.1)', () => {
  const flyer = () => folderGame([{ type: 'flyer', x: START.x + 4 * TILE, y: START.y }]);
  // Close enough that its first wind-up can reach: a salesman that walks up to 36 px or more whiffs at a standing operator.
  const salesman = () => folderGame([{ type: 'salesman', x: START.x + 30, y: START.y }]);
  /** The tick the first attack lands on an operator who does nothing. */
  const arrival = (g: GameState) => firstTick(run(g, 200), 'heartLost');
  /** The key pressed so that the guard's frame 1 falls on `raisedAt`: it rises FOLDER.holdTicks - 1 ticks after the press. */
  const guardFrom = (raisedAt: number) => held(raisedAt - (FOLDER.holdTicks - 1));
  /**
   * The guard already up so that its frame is rame on tick t, with no swing on the way: a swing
   * hits a salesman close enough to strike and its hit-stop would delay the strike being tested.
   */
  function guardedAt(g: GameState, at: number, frame: number, ticks: number): Run {
    const from = at - frame + 1;
    const before = run(g, from);
    const up = { ...before.state, operator: { ...before.state.operator, action: { kind: 'guard' as const, frame: 0 }, held: FOLDER.holdTicks } };
    const after = run(up, ticks - from, () => press({ attack: true }));
    return { state: after.state, events: [...before.events, ...after.events] };
  }

  it('rises while the key is held, FOLDER.holdTicks after the press, and drops on release', () => {
    const r = run(folderGame(), 30, held(0, 20));
    expect(firstTick(r, 'guardRaised')).toBe(FOLDER.holdTicks - 1);
    expect(ofType(r, 'guardRaised')).toHaveLength(1);
    expect(r.state.operator.action.kind).toBe('free');
    const mid = run(folderGame(), 15, held(0));
    expect(mid.state.operator.action).toEqual({ kind: 'guard', frame: 15 - (FOLDER.holdTicks - 1) });
  });

  it('a string of taps never raises it', () => {
    expect(ofType(run(folderGame(), 80, tap(0, 4, 8, 12, 16, 20, 24)), 'guardRaised')).toEqual([]);
  });

  it('slows walking to 40% without touching the 15% cap', () => {
    const walk = (input: (t: number) => TickInput) => run(folderGame(), 40, input).state.operator.vx;
    const free = walk(() => press({ move: RIGHT }));
    const guarded = walk((t) => press({ move: RIGHT, attack: true, attackPressed: t === 0 }));
    expect(guarded / free).toBeCloseTo(FOLDER.guardSpeedFactor, 5);
  });

  it('a sheet that arrives inside the parry window goes back at the flyer for twice a staple', () => {
    const h = arrival(flyer());
    expect(h).toBeGreaterThan(20);
    const r = run(flyer(), h + 90, guardFrom(h - 4));
    expect(ofType(r, 'heartLost')).toEqual([]);
    expect(ofType(r, 'blocked')).toEqual([]);
    expect(ofType(r, 'parry')).toEqual([{ type: 'parry', source: 1, kind: 'shot' }]);
    expect(r.events[h]!.map((e) => e.type)).toContain('parry');
    expect(r.state.operator.gauge).toBeCloseTo(GAUGE.parry, 10);
    const sent = run(flyer(), h + 1, guardFrom(h - 4)).state.projectiles;
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ reflected: true, damage: FOLDER.reflectDamage });
    expect(sent[0]!.vx).toBeGreaterThan(0);
    // It reaches the thrower: 3 performance, 2 damage.
    expect(ofType(r, 'hit')).toEqual([{ type: 'hit', target: 1, enemy: 'flyer', hpLeft: 3 - FOLDER.reflectDamage }]);
    // The parry already paid the gauge: the returned sheet adds none.
    expect(r.state.operator.gauge).toBeCloseTo(GAUGE.parry, 10);
  });

  it('charges the parry times P', () => {
    const tired = folderGame([{ type: 'flyer', x: START.x + 4 * TILE, y: START.y }], 0.72);
    const h = arrival(tired);
    expect(run(tired, h + 1, guardFrom(h - 4)).state.operator.gauge).toBeCloseTo(GAUGE.parry * 0.72, 10);
  });

  it('the window is 9 frames: frame 9 parries, frame 10 only blocks', () => {
    const h = arrival(flyer());
    const at = (frame: number) => run(flyer(), h + 1, guardFrom(h - frame + 1));
    expect(ofType(at(FOLDER.parryFrames), 'parry')).toHaveLength(1);
    const late = at(FOLDER.parryFrames + 1);
    expect(ofType(late, 'parry')).toEqual([]);
    expect(ofType(late, 'blocked')).toEqual([{ type: 'blocked', source: 1, kind: 'shot' }]);
    expect(late.state.operator.gauge).toBe(0);
    expect(late.state.projectiles).toEqual([]);
    expect(ofType(late, 'heartLost')).toEqual([]);
  });

  it('a guard raised after the sheet arrived is too late', () => {
    const h = arrival(flyer());
    expect(ofType(run(flyer(), h + 1, guardFrom(h + 1)), 'heartLost')).toHaveLength(1);
  });

  it('does not cover an attack from behind', () => {
    const g = flyer();
    const turned = { ...g, operator: { ...g.operator, aim: { x: -1, y: 0 } } };
    const h = arrival(turned);
    const r = run(turned, h + 1, guardFrom(h - 4));
    expect(ofType(r, 'heartLost')).toHaveLength(1);
    expect(ofType(r, 'parry')).toEqual([]);
    expect(ofType(r, 'blocked')).toEqual([]);
  });

  it('a parried strike stuns the salesman for 1.2 s and charges the gauge', () => {
    const h = arrival(salesman());
    expect(h).toBeGreaterThan(20);
    const r = guardedAt(salesman(), h, 5, h + 1);
    expect(ofType(r, 'heartLost')).toEqual([]);
    expect(ofType(r, 'parry')).toEqual([{ type: 'parry', source: 1, kind: 'strike' }]);
    expect(r.events[h]!.map((e) => e.type)).toContain('parry');
    expect(r.state.operator.gauge).toBeCloseTo(GAUGE.parry, 10);
    expect(r.state.enemies[0]).toMatchObject({ frozen: FOLDER.parryStunTicks, phase: 'recover' });
  });

  it('the stun is the whole pause: a blocked salesman winds up again within a second, a parried one only after 1.2 s', () => {
    const h = arrival(salesman());
    const windUp = (frame: number) => guardedAt(salesman(), h, frame, h + 160).events.findIndex((es, t) => t > h && es.some((e) => e.type === 'telegraph'));
    expect(windUp(FOLDER.parryFrames + 1)).toBeLessThan(h + FOLDER.parryStunTicks);
    expect(windUp(FOLDER.parryFrames)).toBeGreaterThanOrEqual(h + FOLDER.parryStunTicks);
    // And no longer than that: the stun replaces the recovery instead of coming on top of it.
    expect(windUp(FOLDER.parryFrames)).toBeLessThanOrEqual(h + FOLDER.parryStunTicks + 3);
  });

  it('a swing at a stunned salesman does not cut the stun short to its own hit-stop', () => {
    const h = arrival(salesman());
    const parried = guardedAt(salesman(), h, 5, h + 1).state;
    // Release on tick 0 drops the guard; a tap on tick 1 lands on tick 3.
    const after = (swing: boolean) => run(parried, 6, (t) => press({ attack: swing && t === 1, attackPressed: swing && t === 1 }));
    const hit = after(true);
    expect(ofType(hit, 'hit')).toHaveLength(1);
    expect(hit.state.enemies[0]!.frozen).toBeGreaterThan(FOLDER.hitFreeze[2]);
    expect(hit.state.enemies[0]!.frozen).toBe(after(false).state.enemies[0]!.frozen);
  });

  it('a strike met after the window is blocked: no damage and no stun, but nothing charged', () => {
    const h = arrival(salesman());
    const r = guardedAt(salesman(), h, FOLDER.parryFrames + 1, h + 1);
    expect(ofType(r, 'heartLost')).toEqual([]);
    expect(ofType(r, 'blocked')).toEqual([{ type: 'blocked', source: 1, kind: 'strike' }]);
    expect(ofType(r, 'parry')).toEqual([]);
    expect(r.state.operator.gauge).toBe(0);
    expect(r.state.enemies[0]!.frozen).toBe(0);
  });

  it('a strike from behind is not caught', () => {
    const g = salesman();
    const turned = { ...g, operator: { ...g.operator, aim: { x: -1, y: 0 } } };
    const h = arrival(turned);
    const r = guardedAt(turned, h, 5, h + 1);
    expect(ofType(r, 'heartLost')).toHaveLength(1);
    expect(ofType(r, 'parry')).toEqual([]);
  });

  it('pressing the key beside a salesman swings first: the hit-stop delays its strike, then the guard still parries', () => {
    const h = arrival(salesman());
    // The swing lands on frame 3 and freezes the salesman for 3 ticks, so its strike comes 3 ticks late.
    const r = run(salesman(), h + 12, guardFrom(h - 4));
    expect(ofType(r, 'hit')).toHaveLength(1);
    expect(ofType(r, 'heartLost')).toEqual([]);
    expect(r.events.findIndex((es) => es.some((e) => e.type === 'parry'))).toBe(h + 3);
  });
  it('a sheet sent back throws no lever on its way, as a staple would', () => {
    const base = room([{ type: 'flyer', x: START.x + 4 * TILE, y: START.y }]);
    const lever = { id: 20, kind: 'Switch', name: '', x: START.x + 2 * TILE, y: START.y - 6, width: 0, height: 0, props: { mode: 'toggle', target: 0 }, conditions: {} };
    const g0 = createGame({ ...base, objects: [...base.objects, lever] }, 1, TABLE, { tool: 'folder' });
    const g = { ...g0, operator: { ...g0.operator, aim: RIGHT } };
    const h = arrival(g);
    const r = run(g, h + 90, guardFrom(h - 4));
    expect(ofType(r, 'parry')).toHaveLength(1);
    expect(ofType(r, 'hit')).toHaveLength(1);
    expect(ofType(r, 'switchChanged')).toEqual([]);
    // The control: the lever is where a staple would meet it.
    const stapler = createGame({ ...base, objects: [...base.objects, lever] }, 1, TABLE);
    const staple = run({ ...stapler, operator: { ...stapler.operator, aim: RIGHT } }, 12, held(0));
    expect(ofType(staple, 'switchChanged')).toHaveLength(1);
  });
  it('never catches an area: a live zone hurts through the guard', () => {
    const g = folderGame();
    const zone = {
      id: 99, owner: 777, move: 'test', tier: 2 as const, x: START.x, y: START.y, radius: 40,
      telegraphTicks: 1, activeTicks: 5, halves: 1, age: 1, spent: false,
    };
    const guarding = { ...g, zones: [zone], operator: { ...g.operator, action: { kind: 'guard' as const, frame: 1 }, held: 10 } };
    const r = run(guarding, 3, () => press({ attack: true }));
    expect(ofType(r, 'heartLost')).toEqual([{ type: 'heartLost', halves: 1, cause: 'unknown' }]);
    expect(ofType(r, 'parry')).toEqual([]);
    expect(ofType(r, 'blocked')).toEqual([]);
  });

  it('a dodge cancels the guard and is invincible as ever', () => {
    const g = folderGame();
    const r = run(g, 12, (t) => press({ attack: t < 8, attackPressed: t === 0, dodgePressed: t === 8 }));
    expect(firstTick(r, 'dodge')).toBe(8);
    expect(r.state.operator.action.kind).toBe('dodge');
  });

  it('a parry never breaks the replay: the same fight hashes the same twice', () => {
    const h = arrival(flyer());
    const hash = () => stateHash(run(flyer(), h + 90, guardFrom(h - 4)).state);
    expect(hash()).toBe(hash());
  });
});

describe('guardCovers', () => {
  const at = (deg: number) => ({ x: Math.cos((deg * Math.PI) / 180), y: Math.sin((deg * Math.PI) / 180) });

  it('covers 60 degrees either side of the aim and not a hair beyond', () => {
    expect(guardCovers(RIGHT, at(0))).toBe(true);
    expect(guardCovers(RIGHT, at(60))).toBe(true);
    expect(guardCovers(RIGHT, at(-60))).toBe(true);
    expect(guardCovers(RIGHT, at(60.5))).toBe(false);
    expect(guardCovers(RIGHT, at(-61))).toBe(false);
    expect(guardCovers(RIGHT, at(180))).toBe(false);
  });

  it('follows the aim and takes a diagonal aim', () => {
    const diagonal = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
    expect(guardCovers(diagonal, at(45))).toBe(true);
    expect(guardCovers(diagonal, at(-30))).toBe(false);
    expect(guardCovers({ x: 0, y: 1 }, at(90))).toBe(true);
  });

  it('an attacker on the operator itself is covered', () => {
    expect(guardCovers(RIGHT, { x: 0, y: 0 })).toBe(true);
  });
});

describe('the folder in a chapter', () => {
  const p = (name: string, value: string | number | boolean) => ({ name, value });
  const mapOf = (objects: object[]) => ({
    width: 20, height: 12, tilewidth: 32, tileheight: 32,
    properties: [p('organ', 'lobby'), p('role', 'puzzle'), p('estSeconds', 10)],
    layers: [
      { type: 'tilelayer', name: 'walls', data: new Array(240).fill(0) },
      { type: 'objectgroup', name: 'objects', objects: [{ id: 1, type: 'PlayerStart', x: 64, y: 360 }, ...objects] },
    ],
  }) as unknown as TiledMap;
  const southDoor = { id: 2, type: 'Door', name: 'door-s', x: 288, y: 352, width: 64, height: 32, properties: [p('socket', 'S')] };
  const northDoor = { id: 2, type: 'Door', name: 'door-n', x: 288, y: 0, width: 64, height: 96, properties: [p('socket', 'N')] };
  const talk = (text: string) => loadDialogueTable([{
    file: 'lab.csv',
    text: ['dialogueId,order,speaker,expression,text,condition,effect,next,fact', `lab.hello,1,brain,normal,借你。,,${text},,`].join('\n') + '\n',
  }], TAGS);

  function chapter(extra: Partial<ChapterFile> = {}, effect = ''): ChapterContent {
    return {
      chapter: { version: 1, id: 'lab', start: 'lab/a', links: [{ a: 'lab/a#door-s', b: 'lab/b#door-n' }], ...extra },
      rooms: new Map([['lab/a', parseRoom('lab/a', mapOf([southDoor]), TAGS)], ['lab/b', parseRoom('lab/b', mapOf([northDoor]), TAGS)]]),
      dialogues: effect ? talk(effect) : DIALOGUES, dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS,
    };
  }
  const types = (events: readonly GameEvent[]) => events.map((e) => e.type);

  it('is locked in a chapter that lists no tools, and the swap key does nothing', () => {
    const c = chapter({ tools: [] });
    const s = startChapter(c);
    expect(s.game.folderLocked).toBe(true);
    const r = stepChapter(c, s, press({ swapPressed: true }));
    expect(types(r.events)).not.toContain('toolSwapped');
    expect(r.state.game.operator.tool).toBe('stapler');
  });

  it('a grant:folder line hands it over, and it waits in the pocket until F takes it out', () => {
    const c = chapter({ tools: [], intro: 'lab.hello' }, 'grant:folder');
    const advance = (state: ReturnType<typeof startChapter>, input: TickInput, n: number) => {
      const events: GameEvent[] = [];
      for (let i = 0; i < n; i++) {
        const r = stepChapter(c, state, input);
        state = r.state;
        events.push(...r.events);
      }
      return { state, events };
    };
    const opened = advance(startChapter(c), NO_INPUT, 1);
    expect(types(opened.events)).toContain('toolGranted');
    // The conversation freezes the room until it is closed; presses are ignored for its first ticks.
    let s = advance(advance(opened.state, NO_INPUT, 20).state, press({ interactPressed: true }), 1).state;
    expect(s.dialogue).toBeNull();
    expect(s.run.tools).toEqual(['folder']);
    expect(s.game.folderLocked).toBeUndefined();
    expect(s.game.operator.tool).toBe('stapler');
    expect(stepChapter(c, s, press({ swapPressed: true })).state.game.operator.tool).toBe('folder');
  });

  it('stays in hand through a door', () => {
    const c = chapter();
    let s = startChapter(c);
    s = stepChapter(c, s, press({ swapPressed: true })).state;
    expect(s.game.operator.tool).toBe('folder');
    s = { ...s, game: { ...s.game, touching: [], operator: { ...s.game.operator, x: 320, y: 330, vx: 0, vy: 0 } } };
    let entered = false;
    for (let i = 0; i < 40 && !entered; i++) {
      const r = stepChapter(c, s, press({ move: { x: 0, y: 1 } }));
      s = r.state;
      entered = types(r.events).includes('roomChanged');
    }
    expect(entered).toBe(true);
    expect(s.run.roomId).toBe('lab/b');
    expect(s.game.operator.tool).toBe('folder');
  });
});

describe('what the folder shares with the stapler', () => {
  it('a staple is still 1 damage and a returned sheet is twice that', () => {
    expect(FOLDER.reflectDamage).toBe(2 * STAPLER.damage);
  });

  it('holds the numbers design doc 6.1 and 5.3 fix, which the tests above read symbolically', () => {
    expect(FOLDER.damage).toEqual([2, 2, 4]);
    expect(FOLDER.hitFreeze[2]).toBe(6);
    expect(FOLDER.guardHalfAngleDeg * 2).toBe(120);
    expect(FOLDER.guardSpeedFactor).toBe(0.4);
    expect(FOLDER.parryFrames).toBe(9);
    expect(FOLDER.parryStunTicks).toBe(72);
    expect(FOLDER.swapTicks).toBe(9);
    expect(GAUGE.parry).toBe(15);
    expect(GAUGE.folder).toBe(1.5);
  });
  it('the swing takes no more startup than a light attack may (design doc 5.3)', () => {
    expect(FOLDER.hitFrame).toBeLessThanOrEqual(6);
    expect(FOLDER.hitFrame).toBeLessThan(FOLDER.swingTicks);
    expect(FOLDER.holdTicks).toBeLessThanOrEqual(FOLDER.swingTicks);
  });

});
