import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOSSES, CHAPTERS, ENEMIES, TAGS } from '../../src/app/content.ts';
import {
  BossTableError, createGame, enterRoom, FOLDER, loadBossTable, NO_INPUT, parseRoom, selectBoss, selectMixer, STAMP, step, stateHash, TELEGRAPH, TICK_HZ, TILE,
  type CaffeineParams, type DomainEvent, type EnemyState, type GameState, type Shot, type TickInput, type TiledMap,
} from '../../src/core/index.ts';
import { EMPTY_TAGS } from '../../src/core/tags/store.ts';
import { readRoom } from '../../src/core/rooms/tiled.ts';
import { docksOf, mouthOf } from '../../src/core/stomach/docks.ts';
import { takeDelivery, EMPTY_MIXER, portionTicks, slotsUsed, stepMixer, DELIVERY_SLOTS } from '../../src/core/stomach/mixer.ts';
import { STAPLER } from '../../src/core/combat/frames.ts';
import { DELIVERY_HALF, stepSnack } from '../../src/core/combat/bosses/snack.ts';
import { bossStringKeys, type SnackDef, type SnackState } from '../../src/core/combat/bosses/boss.ts';

/**
 * The stomach's boss (design doc 7.5, core/combat/bosses/snack.ts): he calls four docks one after
 * another and a food box flies from each at the mixer's hopper. A box nobody stops is digested;
 * the folder's parry sends it back at him; a box over the mixer's capacity makes it protest.
 */

const PARAMS_C = JSON.parse(readFileSync('content/params.json', 'utf8')).defaults as CaffeineParams;
const RAW = JSON.parse(readFileSync('content/bosses/snack.json', 'utf8'));
const CAFFEINE_RAW = JSON.parse(readFileSync('content/bosses/caffeine.json', 'utf8'));
const TOAST_RAW = JSON.parse(readFileSync('content/bosses/toast.json', 'utf8'));
const DEF = BOSSES.get('snack') as SnackDef;
const loadMap = (path: string) => JSON.parse(readFileSync(`public/assets/maps/${path}.tmj`, 'utf8')) as TiledMap;
const ARENA = enterRoom(parseRoom('stomach/boss-arena', loadMap('stomach/boss-arena'), TAGS), EMPTY_TAGS, TAGS);

const WINDUP = TELEGRAPH.tier1Ticks;
/** Ticks from the first telegraph's start to the first throw, and from one throw to the next. */
const FIRST_THROW = DEF.startTicks + WINDUP;
/**
 * Stage 2 opens on its own tick, so its first throw comes one tick later than the same wait in stage 1:
 * counted in run ticks from a fight that starts at a budget of 60.
 */
const FIRST_THROW_2 = 1 + DEF.stage2.startTicks + WINDUP - 1;
const idle: TickInput = { ...NO_INPUT };

const fight = (over: { tool?: 'stapler' | 'folder'; gauge?: number } = {}): GameState =>
  createGame(ARENA, 1, ENEMIES, { bosses: BOSSES, tool: over.tool ?? 'folder', ...(over.gauge !== undefined ? { gauge: over.gauge } : {}) });
const boss = (s: GameState) => s.enemies.find((e) => e.boss)! as EnemyState & { readonly boss: SnackState };
const withBoss = (s: GameState, b: Partial<SnackState>, e: Partial<EnemyState> = {}): GameState =>
  ({ ...s, enemies: s.enemies.map((x) => (x.boss ? { ...x, ...e, boss: { ...(x.boss as SnackState), ...b } } : x)) });
/** The operator parked far from every dock line, out of the way. */
const away = (s: GameState, x = 90, y = 330): GameState => ({ ...s, operator: { ...s.operator, x, y } });

interface Run { state: GameState; states: GameState[]; events: DomainEvent[][] }
function run(state: GameState, ticks: number, input: (t: number, s: GameState) => TickInput = () => idle): Run {
  const events: DomainEvent[][] = [];
  const states: GameState[] = [];
  let s = state;
  for (let t = 0; t < ticks; t++) {
    const r = step(s, input(t, s));
    s = r.state;
    states.push(s);
    events.push([...r.events]);
  }
  return { state: s, states, events };
}
const ticksOf = (r: Run, type: DomainEvent['type']) => r.events.flatMap((es, t) => (es.some((e) => e.type === type) ? [t] : []));
const ofType = <T extends DomainEvent['type']>(r: Run, type: T) =>
  r.events.flat().filter((e): e is Extract<DomainEvent, { type: T }> => e.type === type);
const deliveries = (s: GameState) => s.shots.filter((x) => x.kind === 'delivery');

describe('the snack boss definition (design doc 7.5)', () => {
  const load = (edit: (raw: typeof RAW) => void) => {
    const raw = structuredClone(RAW);
    edit(raw);
    return () => loadBossTable([CAFFEINE_RAW, TOAST_RAW, raw], ENEMIES, PARAMS_C);
  };

  it('loads in ticks and pixels: a box every 4 s after a 3 s start, flying 5 tiles a second', () => {
    expect(DEF).toMatchObject({
      behaviour: 'snack', id: 'snack', budget: 100, startTicks: 180, everyTicks: 240, portion: 'normal', halves: 1, returnDamage: 20,
      stage2: { budget: 60, startTicks: 180, everyTicks: 360, portion: 'large', halves: 1, returnDamage: 20 },
      protest: { telegraphTicks: 84, activeTicks: 8, radius: 3 * TILE, halves: 2 },
    });
    expect(DEF.speed).toBeCloseTo((5 * TILE) / TICK_HZ, 9);
    expect(DEF.stage2.speed).toBeCloseTo((5 * TILE) / TICK_HZ, 9);
  });

  it('names his stages for the nameplate: the boss and the two stages he has', () => {
    expect(bossStringKeys('snack', DEF)).toEqual(['boss.snack.name', 'boss.snack.stage.1', 'boss.snack.stage.2']);
  });

  it('is the enemy snack, a defeatable boss with no archetype', () => {
    expect(ENEMIES.enemies.get('snack')).toEqual({ id: 'snack', category: 'defeatable', boss: 'snack' });
  });

  it('asks for its own fields and refuses the other behaviours\'', () => {
    expect(load((r) => { delete r.deliveries; })).toThrow(/a snack boss needs deliveries/);
    expect(load((r) => { delete r.protest; })).toThrow(/a snack boss needs protest/);
    expect(load((r) => { delete r.stage2; })).toThrow(/a snack boss needs stage2/);
    expect(load((r) => { r.song = TOAST_RAW.song; })).toThrow(/song belongs to another behaviour; a snack boss does not read it/);
    expect(load((r) => { r.summon = CAFFEINE_RAW.summon; })).toThrow(/summon belongs to another behaviour; a snack boss does not read it/);
  });

  it('keeps the other behaviours from carrying his fields', () => {
    const caffeine = structuredClone(CAFFEINE_RAW);
    caffeine.protest = RAW.protest;
    expect(() => loadBossTable([caffeine, TOAST_RAW, RAW], ENEMIES, PARAMS_C)).toThrow(/protest belongs to another behaviour; a caffeine boss does not read it/);
    const toast = structuredClone(TOAST_RAW);
    toast.stage2 = RAW.stage2;
    expect(() => loadBossTable([CAFFEINE_RAW, toast, RAW], ENEMIES, PARAMS_C)).toThrow(/stage2 belongs to another behaviour; a toast boss does not read it/);
  });

  it('holds the protest to the fairness rules: a tier-3 telegraph, live no longer than the i-frames, a whole heart', () => {
    expect(load((r) => { r.protest.telegraphSeconds = 0.8; })).toThrow(/protest\.telegraphSeconds is a tier-3 telegraph of 1\.2 to 1\.5 s/);
    expect(load((r) => { r.protest.telegraphSeconds = 1.6; })).toThrow(/tier-3 telegraph/);
    expect(load((r) => { r.protest.telegraphSeconds = 1.2; })).not.toThrow();
    expect(load((r) => { r.protest.activeTicks = 11; })).toThrow(/protest\.activeTicks 11 is longer than the 10 dodge i-frames/);
    expect(load((r) => { r.protest.activeTicks = 10; })).not.toThrow();
    expect(load((r) => { r.protest.halves = 1; })).toThrow(/signature move and costs a whole heart/);
  });

  it('holds a delivery to a tier-1 hit and leaves room for its telegraph in the rhythm', () => {
    expect(load((r) => { r.deliveries.halves = 2; })).toThrow(/a delivery is a tier-1 hit and costs half a heart/);
    expect(load((r) => { r.deliveries.everySeconds = 0.5; })).toThrow(/everySeconds must be longer than the 0\.5 s tier-1 telegraph/);
    expect(load((r) => { r.deliveries.everySeconds = 0.52; })).not.toThrow();
  });

  it('holds stage 2 to the same rules as stage 1 and starts it below his full budget', () => {
    expect(load((r) => { r.stage2.budget = 100; })).toThrow(/stage2\.budget must be below budget/);
    expect(load((r) => { r.stage2.budget = 99; })).not.toThrow();
    expect(load((r) => { r.stage2.deliveries.halves = 2; })).toThrow(/stage2\.deliveries\.halves: a delivery is a tier-1 hit/);
    expect(load((r) => { r.stage2.deliveries.everySeconds = 0.5; })).toThrow(/stage2\.deliveries\.everySeconds must be longer than the 0\.5 s tier-1 telegraph/);
    expect(load((r) => { r.stage2.deliveries.everySeconds = 0.52; })).not.toThrow();
    expect(load((r) => { r.stage2.budget = 0; })).toThrow(/stage2/);
  });

  it('reports every problem of a file at once', () => {
    const e = (() => { try { load((r) => { r.protest.halves = 1; r.deliveries.halves = 3; })(); } catch (x) { return x as BossTableError; } return undefined; })();
    expect(e?.problems).toHaveLength(2);
  });
});

describe('the arena as data', () => {
  it('has four docks in the corners, called in the order the room draws them, and the mixer of capacity 4 between them', () => {
    expect(docksOf(ARENA)).toEqual([
      { x: 2 * TILE + 16, y: 4 * TILE + 16 }, { x: 17 * TILE + 16, y: 4 * TILE + 16 },
      { x: 17 * TILE + 16, y: 9 * TILE + 16 }, { x: 2 * TILE + 16, y: 9 * TILE + 16 },
    ]);
    expect(mouthOf(ARENA)).toEqual({ x: 10 * TILE, y: 7 * TILE + 16 });
    expect(selectMixer(fight())).toMatchObject({ capacity: 4, batches: [] });
  });

  it('spawns the boss with his full budget standing at the north and nothing in the air', () => {
    const g = fight();
    expect(boss(g)).toMatchObject({ type: 'snack', hp: 100, maxHp: 100, boss: { behaviour: 'snack', stage: 1, ticks: 0, dock: 0, stageThrown: 0, move: null } });
    expect(g.shots).toEqual([]);
    expect(selectBoss(g)).toMatchObject({ type: 'snack', budget: 100, maxBudget: 100, stage: 1, defeated: false });
  });
});

describe('the rhythm: a telegraph, then a box from the next dock', () => {
  it('waits 3 s, flashes a tier-1 telegraph for 0.5 s, then throws the first box from the north-west dock', () => {
    const r = run(away(fight()), FIRST_THROW + 2);
    const telegraphs = r.events.flatMap((es, t) => es.filter((e) => e.type === 'telegraph').map(() => t));
    expect(telegraphs).toEqual([DEF.startTicks - 1]);
    expect(ofType(r, 'telegraph')[0]).toMatchObject({ tier: 1, move: 'deliver' });
    expect(ticksOf(r, 'deliveryThrown')).toEqual([FIRST_THROW - 1]);
    expect(ofType(r, 'deliveryThrown')).toMatchObject([{ dock: 0 }]);
    const sh = deliveries(r.state)[0]!;
    expect(sh).toMatchObject({ kind: 'delivery', delivery: 'normal', halves: 1, returnDamage: 20, owner: boss(r.state).id, spent: false });
  });

  it('throws every 4 s from then on, round the four docks in order and back to the first', () => {
    const r = run(away(fight()), FIRST_THROW + 5 * DEF.everyTicks);
    expect(ticksOf(r, 'deliveryThrown')).toEqual([0, 1, 2, 3, 4, 5].map((i) => FIRST_THROW - 1 + i * DEF.everyTicks));
    expect(ofType(r, 'deliveryThrown').map((e) => e.dock)).toEqual([0, 1, 2, 3, 0, 1]);
    expect(ofType(r, 'deliveryThrown')).toHaveLength(6);
  });

  it('shows the telegraph for exactly the tier-1 length, on the dock about to be used', () => {
    const r = run(away(fight()), DEF.startTicks + WINDUP);
    const moves = r.states.map((s) => boss(s).boss.move);
    expect(moves.filter((m) => m !== null)).toHaveLength(WINDUP);
    expect(moves[DEF.startTicks - 1]).toEqual({ id: 'deliver', frame: 1 });
    expect(moves[DEF.startTicks + WINDUP - 1]).toBeNull();
    expect(boss(r.states[DEF.startTicks]!).boss.dock).toBe(0);
  });

  it('stands still and hurts no one himself', () => {
    const g = away(fight());
    const r = run(g, 2 * DEF.everyTicks);
    expect(boss(r.state).x).toBe(boss(g).x);
    expect(boss(r.state).y).toBe(boss(g).y);
    expect(r.events.flat().filter((e) => e.type === 'heartLost')).toEqual([]);
  });

  it('leaves a room with no dock standing instead of throwing from nowhere', () => {
    const e = boss(fight());
    const r = stepSnack({ ...e, boss: { ...e.boss, ticks: 10_000 } }, DEF, [], { x: 0, y: 0 });
    expect(r.shots).toEqual([]);
    expect(r.events).toEqual([]);
  });
});

describe('a box in the air', () => {
  /** The state a tick after the first box has left the north-west dock. */
  const flying = (): Run => run(away(fight()), FIRST_THROW);

  it('flies in a straight line from the dock to the centre of the hopper, at his speed', () => {
    const r = flying();
    const sh = deliveries(r.state)[0]!;
    const dock = docksOf(ARENA)[0]!;
    const mouth = mouthOf(ARENA)!;
    // The tick it leaves is also its first tick of flight.
    expect(sh.x).toBeCloseTo(dock.x + sh.vx, 9);
    expect(sh.y).toBeCloseTo(dock.y + sh.vy, 9);
    expect(Math.hypot(sh.vx, sh.vy)).toBeCloseTo(DEF.speed, 9);
    expect(sh.vx / sh.vy).toBeCloseTo((mouth.x - dock.x) / (mouth.y - dock.y), 9);
    expect(sh.ticksLeft).toBe(Math.ceil(Math.hypot(mouth.x - dock.x, mouth.y - dock.y) / DEF.speed) - 1);
    // After its whole flight it is within one step of the centre of the hopper.
    expect(Math.hypot(sh.x + sh.vx * sh.ticksLeft - mouth.x, sh.y + sh.vy * sh.ticksLeft - mouth.y)).toBeLessThan(DEF.speed);
  });

  it('lands in the hopper after its whole flight and is taken in by the mixer for 20 s', () => {
    const start = flying();
    const flight = deliveries(start.state)[0]!.ticksLeft;
    const r = run(start.state, flight + 1);
    expect(deliveries(r.state)).toEqual([]);
    expect(ofType(r, 'mixerFed')).toMatchObject([{ portion: 'normal', count: 1, capacity: 4 }]);
    expect(r.state.mixer!.batches).toHaveLength(1);
    expect(r.state.mixer!.batches[0]).toMatchObject({ portion: 'normal', order: true });
    expect(r.state.mixer!.batches[0]!.left).toBeGreaterThan(portionTicks('normal') - 3);
    // It is taken in on the tick after its last move: one tick earlier it is still in the air.
    const early = run(start.state, flight);
    expect(deliveries(early.state)).toHaveLength(1);
    expect(early.state.mixer!.batches).toHaveLength(0);
  });

  it('leaves nothing behind when it is digested: a delivery makes no parcel', () => {
    // The boss waits for good after this one, so only the first box is on the mixer.
    const start = withBoss(flying().state, { ticks: -1_000_000 });
    const r = run(start, deliveries(start)[0]!.ticksLeft + 1 + portionTicks('normal') + 5);
    expect(ofType(r, 'mixerFed')).toHaveLength(1);
    expect(r.state.mixer!.batches).toEqual([]);
    expect(r.state.boxes.filter((b) => b.boxType === 'parcel')).toEqual([]);
    expect(ofType(r, 'parcelOut')).toEqual([]);
  });

  it('is dodged through and still lands, spent so that it cannot hurt twice', () => {
    const start = flying();
    const sh = deliveries(start.state)[0]!;
    // Put the operator on its path with the dodge i-frames running.
    const dodging: GameState = {
      ...start.state, operator: { ...start.state.operator, x: sh.x + sh.vx * 5, y: sh.y + sh.vy * 5 + 8, action: { kind: 'dodge', frame: 4, dir: { x: 0, y: 0 }, perfect: false } as never },
    };
    const r = run(dodging, sh.ticksLeft + 1);
    expect(r.events.flat().filter((e) => e.type === 'heartLost')).toEqual([]);
    expect(ofType(r, 'mixerFed')).toHaveLength(1);
  });

  it('costs half a heart when it hits an operator standing in its way with no guard up', () => {
    const start = flying();
    const sh = deliveries(start.state)[0]!;
    const standing: GameState = { ...start.state, operator: { ...start.state.operator, x: sh.x + sh.vx * 10, y: sh.y + sh.vy * 10 + 8 } };
    const before = standing.operator.halves;
    const r = run(standing, 30);
    expect(ofType(r, 'heartLost')).toMatchObject([{ halves: 1, cause: 'snack' }]);
    expect(r.state.operator.halves).toBe(before - 1);
    expect(deliveries(r.state)).toEqual([]);
    expect(r.state.mixer!.batches).toEqual([]);
  });

  it('is lost when something solid stands in its way, and never reaches the mixer', () => {
    const start = flying();
    const sh = deliveries(start.state)[0]!;
    const col = Math.floor((sh.x + sh.vx * 20) / TILE);
    const row = Math.floor((sh.y + sh.vy * 20) / TILE);
    const solid = ARENA.grid.solid.map((v, i) => v || i === row * ARENA.grid.cols + col);
    const walled: GameState = { ...start.state, room: { ...start.state.room, grid: { ...start.state.room.grid, solid } } };
    const r = run(walled, sh.ticksLeft + 3);
    expect(deliveries(r.state)).toEqual([]);
    expect(ofType(r, 'mixerFed')).toEqual([]);
  });

  it('goes with him when he is beaten: a box still in the air vanishes', () => {
    const start = flying();
    const dead: GameState = { ...start.state, enemies: start.state.enemies.map((e) => (e.boss ? { ...e, hp: 0, phase: 'closed' as const } : e)) };
    const r = run(dead, 3);
    expect(deliveries(r.state)).toEqual([]);
  });
});

describe('the folder\'s parry sends a box back at him', () => {
  /** The guard is held by keeping the attack key down, as the player does. */
  const hold: TickInput = { ...NO_INPUT, attack: true };
  /** The operator guarding, facing the dock, in the path of the first box, which reaches them within the parry window. */
  function parried(dock = 0): { start: GameState; shot: Shot } {
    const start = run(away(withBoss(fight(), { dock })), FIRST_THROW).state;
    const sh = deliveries(start)[0]!;
    // Stand where the box will be in 4 ticks, aiming back up its path (toward the dock).
    const at = { x: sh.x + sh.vx * 4, y: sh.y + sh.vy * 4 };
    const toDock = { x: -sh.vx / Math.hypot(sh.vx, sh.vy), y: -sh.vy / Math.hypot(sh.vx, sh.vy) };
    return {
      shot: sh,
      start: { ...start, operator: { ...start.operator, x: at.x, y: at.y + 8, tool: 'folder', aim: toDock, action: { kind: 'guard', frame: 0 }, held: FOLDER.holdTicks } },
    };
  }

  it('turns it round at the boss, with the return damage of his file instead of the folder\'s own', () => {
    const { start } = parried();
    const r = run(start, 12, () => hold);
    expect(ofType(r, 'parry')).toMatchObject([{ kind: 'shot' }]);
    expect(r.state.projectiles).toHaveLength(1);
    const back = r.state.projectiles[0]!;
    expect(back).toMatchObject({ reflected: true, damage: 20, boxHalf: 6 });
    const b = boss(r.state);
    // It heads for the boss (a little above his feet), not back up the way it came.
    const toBoss = { x: b.x - back.x, y: b.y - 8 - back.y };
    expect(back.vx * toBoss.x + back.vy * toBoss.y).toBeGreaterThan(0);
    expect(deliveries(r.state)).toEqual([]);
    expect(r.state.mixer!.batches).toEqual([]);
  });

  it('reaches him from every dock, the far ones in the south too', () => {
    for (const dock of [0, 1, 2, 3]) {
      const r = run(parried(dock).start, 12 + 200, () => hold);
      expect(boss(r.state).hp, `a parry at dock ${dock}`).toBe(80);
    }
  });

  it('stretches only a box of his: a shot of anyone else sent back keeps the staple range', () => {
    const { start } = parried(2);
    const plain = start.shots.map((x) => (x.kind === 'delivery'
      ? { id: x.id, owner: x.owner, kind: 'sheet', x: x.x, y: x.y, vx: x.vx, vy: x.vy, ticksLeft: x.ticksLeft, halves: x.halves, half: x.half, spent: false } : x));
    const other = run({ ...start, shots: plain }, 12, () => hold).state.projectiles[0]!;
    expect(other).toMatchObject({ reflected: true, damage: FOLDER.reflectDamage });
    expect(other.ticksLeft).toBeLessThanOrEqual(Math.ceil(STAPLER.rangePx / Math.hypot(other.vx, other.vy)));
    const mine = run(start, 12, () => hold).state.projectiles[0]!;
    expect(mine.ticksLeft).toBeGreaterThan(Math.ceil(STAPLER.rangePx / Math.hypot(mine.vx, mine.vy)));
  });

  it('takes 20 off his budget when it lands, five returns to close the fight', () => {
    const { start } = parried();
    const r = run(start, 12 + 120, () => hold);
    expect(boss(r.state).hp).toBe(80);
    expect(ofType(r, 'hit')).toMatchObject([{ enemy: 'snack', hpLeft: 80 }]);
  });

  it('stops a box with a plain block too, but sends nothing back', () => {
    const { start } = parried();
    const blocked: GameState = { ...start, operator: { ...start.operator, action: { kind: 'guard', frame: FOLDER.parryFrames + 5 } } };
    const r = run(blocked, 12, () => hold);
    expect(ofType(r, 'blocked')).toMatchObject([{ kind: 'shot' }]);
    expect(r.state.projectiles).toEqual([]);
    expect(deliveries(r.state)).toEqual([]);
    expect(r.state.mixer!.batches).toEqual([]);
  });

  it('does not stop a box the guard faces away from, which then hits', () => {
    const { start } = parried();
    const turned: GameState = { ...start, operator: { ...start.operator, aim: { x: -start.operator.aim.x, y: -start.operator.aim.y } } };
    const r = run(turned, 12, () => hold);
    expect(ofType(r, 'parry')).toEqual([]);
    expect(ofType(r, 'heartLost')).toHaveLength(1);
  });
});

describe('the mixer takes in a delivery and protests at one too many', () => {
  const full = (n: number): GameState => {
    const g = away(fight());
    return { ...g, mixer: { batches: Array.from({ length: n }, (_, i) => ({ box: -1_000_001 - i, portion: 'normal' as const, left: 600, order: true as const })) } };
  };
  /** A box about to land: one tick from its last move. */
  const landing = (s: GameState, owner = boss(s).id): GameState => ({
    ...s, shots: [{ id: 900, owner, kind: 'delivery', x: 320, y: 240, vx: 0, vy: 0, ticksLeft: 0, halves: 1, half: 6, delivery: 'normal', returnDamage: 20, spent: false }], nextId: 901,
  });

  it('takes it in while there is room, up to the capacity of 4', () => {
    const r = run(landing(full(3)), 1);
    expect(ofType(r, 'mixerFed')).toMatchObject([{ count: 4, capacity: 4 }]);
    expect(ofType(r, 'mixerProtest')).toEqual([]);
    expect(r.state.mixer!.batches).toHaveLength(4);
    expect(r.state.zones).toEqual([]);
  });

  it('protests at the fifth: the mixer empties and a tier-3 area opens round the hopper', () => {
    const r = run(landing(full(4)), 1);
    expect(ofType(r, 'mixerFed')).toEqual([]);
    expect(ofType(r, 'mixerProtest')).toMatchObject([{ x: 320, y: 240 }]);
    expect(ofType(r, 'telegraph')).toMatchObject([{ tier: 2, move: 'protest', source: boss(r.state).id }]);
    expect(r.state.mixer!.batches).toEqual([]);
    expect(r.state.zones).toHaveLength(1);
    expect(r.state.zones[0]).toMatchObject({ move: 'protest', tier: 3, x: 320, y: 240, radius: 3 * TILE, telegraphTicks: 84, activeTicks: 8, halves: 2, owner: boss(r.state).id, age: 1, spent: false });
  });

  it('warns for 84 ticks counting the one it opens on, hurts for 8, and a dodge on the last warning tick avoids it', () => {
    const g = run(landing(full(4)), 1).state;
    const at = { ...g, operator: { ...g.operator, x: 320, y: 240 + 16 } };
    const hurtAt = run(at, 84 + 8 + 1);
    expect(ofType(hurtAt, 'heartLost')).toMatchObject([{ halves: 2, cause: 'snack' }]);
    // The zone opened at age 1 on the landing tick, so it is live from age 85: the 83rd tick after it.
    expect(hurtAt.events.findIndex((es) => es.some((e) => e.type === 'heartLost'))).toBe(83);
    const warned = run(at, 82);
    expect(warned.events.flat().filter((e) => e.type === 'heartLost')).toEqual([]);
    // Pressed on the last warning tick (age 84), the dodge is invincible for the whole live window.
    const safe = run(warned.state, 20, (t) => (t === 0 ? { ...NO_INPUT, dodgePressed: true } : idle));
    expect(safe.events.flat().filter((e) => e.type === 'heartLost')).toEqual([]);
    expect(safe.events.flat().filter((e) => e.type === 'dodge')).toHaveLength(1);
  });

  it('does not touch an operator who stays out of its radius', () => {
    const g = run(landing(full(4)), 1).state;
    const clear = { ...g, operator: { ...g.operator, x: 320 + 3 * TILE + 24, y: 240 } };
    const r = run(clear, 84 + 12);
    expect(r.events.flat().filter((e) => e.type === 'heartLost')).toEqual([]);
  });

  it('takeDelivery fills to the capacity and empties on the box after it', () => {
    let m = EMPTY_MIXER;
    for (let i = 0; i < 4; i++) {
      const t = takeDelivery(m, 4, -1_000_001 - i, 'normal');
      expect(t.jammed).toBe(false);
      expect(t.count).toBe(i + 1);
      m = t.mixer;
    }
    const fifth = takeDelivery(m, 4, -1_000_005, 'small');
    expect(fifth).toMatchObject({ jammed: true, count: 5, mixer: { batches: [] } });
    expect(takeDelivery(m, 5, -1_000_005, 'small').jammed).toBe(false);
  });

  it('counts a large portion as two places: two fit in 4, and one next to three normal boxes jams', () => {
    expect(DELIVERY_SLOTS).toEqual({ small: 1, normal: 1, large: 2 });
    const one = takeDelivery(EMPTY_MIXER, 4, -1_000_001, 'large');
    expect(one).toMatchObject({ jammed: false, count: 2 });
    expect(one.mixer.batches[0]).toMatchObject({ portion: 'large', slots: 2, order: true });
    expect(slotsUsed(one.mixer)).toBe(2);
    const two = takeDelivery(one.mixer, 4, -1_000_002, 'large');
    expect(two).toMatchObject({ jammed: false, count: 4 });
    expect(takeDelivery(two.mixer, 4, -1_000_003, 'small')).toMatchObject({ jammed: true, count: 5, mixer: { batches: [] } });
    expect(takeDelivery(two.mixer, 4, -1_000_003, 'large')).toMatchObject({ jammed: true, count: 6 });
    let three = EMPTY_MIXER;
    for (let i = 0; i < 3; i++) three = takeDelivery(three, 4, -1_000_001 - i, 'normal').mixer;
    expect(takeDelivery(three, 4, -1_000_009, 'large')).toMatchObject({ jammed: true, count: 5 });
    expect(takeDelivery(three, 4, -1_000_009, 'normal')).toMatchObject({ jammed: false, count: 4 });
  });

  it('keeps the places when a box is fed by hand beside a large delivery: 2 and 1 leave one place, 2 and 2 leave none', () => {
    const batch = (box: number, slots: number) => ({ box, portion: 'large' as const, left: 600, order: true as const, slots });
    const food = [{ id: 50, col: 10, row: 7, left: 0, ticks: 0, boxType: 'food' }];
    const fits = stepMixer(ARENA, { batches: [batch(-1_000_001, 2), batch(-1_000_002, 1)] }, food, { bodies: [] });
    expect(fits.events.find((e) => e.type === 'mixerFed')).toMatchObject({ count: 4, capacity: 4 });
    const jams = stepMixer(ARENA, { batches: [batch(-1_000_001, 2), batch(-1_000_002, 2)] }, food, { bodies: [] });
    expect(jams.events.map((e) => e.type)).toContain('mixerJammed');
  });

  it('numbers each delivery as an order of its own, below the base, so no map box can clash', () => {
    const start = run(away(fight()), FIRST_THROW).state;
    const r = run(start, deliveries(start)[0]!.ticksLeft + 1);
    expect(ofType(r, 'mixerFed')[0]!.object).toBeLessThanOrEqual(-1_000_000);
    expect(r.state.orderSerial).toBe(1);
  });
});

describe('the fight as a whole', () => {
  it('protests by itself when nobody stops a box: five deliveries and the fifth lands on a full mixer', () => {
    // 20 s a box and a box every 4 s: the fifth lands 16 s after the first, before the first is digested.
    const r = run(away(fight()), FIRST_THROW + 4 * DEF.everyTicks + 200);
    expect(ofType(r, 'mixerFed').map((e) => e.count)).toEqual([1, 2, 3, 4]);
    expect(ofType(r, 'mixerProtest')).toHaveLength(1);
  });

  it('replays: the same inputs give the same state hash', () => {
    const script = (t: number): TickInput => ({ ...NO_INPUT, move: { x: t % 90 < 45 ? 1 : -1, y: 0 } });
    const a = run(fight(), 700, script).state;
    const b = run(fight(), 700, script).state;
    expect(stateHash(a)).toBe(stateHash(b));
  });

  it('closes the case when his budget runs out, and removes his zones with him', () => {
    const g = away(withBoss(fight(), { stage: 2 }, { hp: 20 }));
    const start = run(g, FIRST_THROW).state;
    const sh = deliveries(start)[0]!;
    // A protest still warning when the case closes; its warning is long so it cannot run out by itself on the way.
    const protest = { id: 900, owner: boss(start).id, move: 'protest', tier: 3 as const, x: 320, y: 240, radius: 3 * TILE, telegraphTicks: 400, activeTicks: 8, halves: 2, age: 1, spent: false };
    const guard: GameState = {
      ...start,
      zones: [protest],
      operator: {
        ...start.operator, x: sh.x + sh.vx * 4, y: sh.y + sh.vy * 4 + 8, tool: 'folder',
        aim: { x: -sh.vx / Math.hypot(sh.vx, sh.vy), y: -sh.vy / Math.hypot(sh.vx, sh.vy) }, action: { kind: 'guard', frame: 0 }, held: FOLDER.holdTicks,
      },
    };
    const r = run(guard, 200, () => ({ ...NO_INPUT, attack: true }));
    expect(ofType(r, 'bossDefeated')).toMatchObject([{ enemy: 'snack' }]);
    expect(boss(r.state)).toMatchObject({ hp: 0, phase: 'closed' });
    expect(r.states[0]!.zones).toHaveLength(1);
    expect(r.state.zones).toEqual([]);
    expect(selectBoss(r.state)).toMatchObject({ defeated: true });
  });

  it('puts him back with a full budget and a fresh rhythm after a forced leave', () => {
    const g = away(withBoss(fight(), { stage: 2, ticks: 100, dock: 2, stageThrown: 2 }, { hp: 40 }));
    const dead: GameState = { ...g, operator: { ...g.operator, halves: 0 } };
    const r = run(dead, 1);
    expect(ofType(r, 'forcedLeave')).toHaveLength(1);
    expect(boss(r.state)).toMatchObject({ hp: 100, boss: { stage: 1, ticks: 0, dock: 0, stageThrown: 0, move: null } });
  });

  it('takes nothing from a held stapler: only a box sent back hurts him', () => {
    const g = away(fight({ tool: 'stapler' }), 320, 272);
    const r = run({ ...g, operator: { ...g.operator, aim: { x: 0, y: -1 } } }, 200, () => ({ ...NO_INPUT, attack: true }));
    expect(ofType(r, 'snackShrugged').length).toBeGreaterThan(10);
    expect(ofType(r, 'hit')).toEqual([]);
    expect(boss(r.state).hp).toBe(100);
  });

  it('takes nothing from a swing of the folder either', () => {
    const g = away(fight(), 320, 168);
    const r = run({ ...g, operator: { ...g.operator, aim: { x: 0, y: -1 } } }, 60, (t) => ({ ...NO_INPUT, attack: t % 20 === 0, attackPressed: t % 20 === 0 }));
    expect(ofType(r, 'snackShrugged').length).toBeGreaterThan(0);
    expect(boss(r.state).hp).toBe(100);
  });

  it('is not hurt by the stamp more than any boss: 40 of his 100', () => {
    const g = away(fight({ gauge: STAMP.gaugeMax }), 320, 168 + 16);
    const r = run(g, STAMP.startupTicks + 3, (t) => ({ ...NO_INPUT, stampPressed: t === 0 }));
    expect(boss(r.state).hp).toBe(60);
  });
});

describe('stage 2: 加大份量', () => {
  /** A fight that starts with his budget at the start of the stage, with the operator out of the way. */
  const atSixty = (): GameState => away(withBoss(fight(), {}, { hp: 60 }));
  const hold: TickInput = { ...NO_INPUT, attack: true };

  it('starts on the first tick his budget is at most 60, once, and tells the nameplate', () => {
    const r = run(atSixty(), 600);
    expect(ofType(r, 'snackStage')).toEqual([{ type: 'snackStage', target: boss(r.state).id, stage: 2 }]);
    expect(ticksOf(r, 'snackStage')).toEqual([0]);
    // The caffeine boss's line is not his.
    expect(ofType(r, 'bossStage')).toEqual([]);
    expect(boss(r.state).boss.stage).toBe(2);
    expect(selectBoss(r.state)).toMatchObject({ stage: 2, budget: 60 });
  });

  it('does not start at 61, and starts the tick after a hit takes him to 60', () => {
    const g = away(withBoss(fight(), {}, { hp: 61 }));
    const r = run(g, 600);
    expect(ofType(r, 'snackStage')).toEqual([]);
    expect(boss(r.state).boss.stage).toBe(1);
    const hit = run(withBoss(r.state, {}, { hp: 60 }), 1);
    expect(ofType(hit, 'snackStage')).toHaveLength(1);
  });

  it('resets his rhythm: a pause of 3 s from the start of the stage, then the first large box', () => {
    const g = withBoss(atSixty(), { ticks: 200, stageThrown: 4 });
    const r = run(g, FIRST_THROW_2 + 1);
    expect(ticksOf(r, 'telegraph')).toEqual([DEF.stage2.startTicks]);
    expect(ticksOf(r, 'deliveryThrown')).toEqual([FIRST_THROW_2]);
    expect(boss(r.state).boss).toMatchObject({ stage: 2, stageThrown: 1 });
  });

  it('throws a large box every 6 s from then on, round the docks from where stage 1 left them', () => {
    const g = withBoss(atSixty(), { dock: 2 });
    const r = run(g, FIRST_THROW_2 + 2 * DEF.stage2.everyTicks + 1);
    expect(ticksOf(r, 'deliveryThrown')).toEqual([0, 1, 2].map((i) => FIRST_THROW_2 + i * DEF.stage2.everyTicks));
    expect(ofType(r, 'deliveryThrown').map((e) => e.dock)).toEqual([2, 3, 0]);
  });

  it('finishes a telegraph already under way as the box it announced, then starts the stage', () => {
    const g = withBoss(atSixty(), { move: { id: 'deliver', frame: 5 } });
    const r = run(g, 40);
    expect(ofType(r, 'snackStage')).toHaveLength(1);
    expect(ticksOf(r, 'snackStage')[0]).toBeGreaterThan(ticksOf(r, 'deliveryThrown')[0]!);
    const first = r.states[ticksOf(r, 'deliveryThrown')[0]!]!;
    expect(deliveries(first)).toMatchObject([{ delivery: 'normal', half: DELIVERY_HALF.normal, returnDamage: 20 }]);
    expect(boss(r.state).boss).toMatchObject({ stage: 2, stageThrown: 0 });
  });

  it('throws large boxes: bigger than the normal ones, with the stage\'s own return damage', () => {
    const r = run(atSixty(), FIRST_THROW_2 + 1);
    expect(DELIVERY_HALF.large).toBeGreaterThan(DELIVERY_HALF.normal);
    expect(deliveries(r.state)).toMatchObject([{ kind: 'delivery', delivery: 'large', half: DELIVERY_HALF.large, halves: 1, returnDamage: 20, spent: false }]);
  });

  it('is taken in for 40 s as two places of the four, and the nameplate sees both', () => {
    const start = run(atSixty(), FIRST_THROW_2 + 1);
    const flight = deliveries(start.state)[0]!.ticksLeft;
    const r = run(withBoss(start.state, { ticks: -1_000_000 }), flight + 1);
    expect(ofType(r, 'mixerFed')).toMatchObject([{ portion: 'large', count: 2, capacity: 4 }]);
    expect(r.state.mixer!.batches[0]).toMatchObject({ portion: 'large', slots: 2, order: true });
    expect(r.state.mixer!.batches[0]!.left).toBeGreaterThan(portionTicks('large') - 3);
    expect(portionTicks('large')).toBe(2 * portionTicks('normal'));
    expect(selectMixer(r.state)!.batches[0]).toMatchObject({ portion: 'large', slots: 2 });
  });

  it('protests by itself when nobody stops one: two large boxes fill the mixer and the third lands on it', () => {
    const r = run(atSixty(), FIRST_THROW_2 + 2 * DEF.stage2.everyTicks + 100);
    expect(ofType(r, 'mixerFed').map((e) => e.count)).toEqual([2, 4]);
    expect(ofType(r, 'mixerProtest')).toHaveLength(1);
    expect(ticksOf(r, 'mixerProtest')[0]).toBeGreaterThan(ticksOf(r, 'deliveryThrown')[2]!);
    expect(r.state.mixer!.batches).toEqual([]);
  });

  it('is kept within the capacity by returning one box in three: the parry sends a large box back for 20', () => {
    const start = run(atSixty(), FIRST_THROW_2 + 1).state;
    const sh = deliveries(start)[0]!;
    const toDock = { x: -sh.vx / Math.hypot(sh.vx, sh.vy), y: -sh.vy / Math.hypot(sh.vx, sh.vy) };
    const guard: GameState = {
      ...start,
      operator: {
        ...start.operator, x: sh.x + sh.vx * 4, y: sh.y + sh.vy * 4 + 8, tool: 'folder', aim: toDock, action: { kind: 'guard', frame: 0 }, held: FOLDER.holdTicks,
      },
    };
    const r = run(guard, 12 + 140, () => hold);
    expect(ofType(r, 'parry')).toMatchObject([{ kind: 'shot' }]);
    expect(ofType(r, 'mixerFed')).toEqual([]);
    expect(boss(r.state).hp).toBe(40);
    expect(ofType(r, 'hit')).toMatchObject([{ enemy: 'snack', hpLeft: 40 }]);
  });
});

describe('the map check (Dock)', () => {
  const p = (name: string, value: string | number | boolean) => ({ name, value });
  const walls = (extra: readonly (readonly [number, number])[] = []) => Array.from({ length: 240 }, (_, i) => {
    const c = i % 20;
    const r = Math.floor(i / 20);
    return c === 0 || r === 0 || c === 19 || r === 11 || extra.some(([wc, wr]) => wc === c && wr === r) ? 1 : 0;
  });
  const mapOf = (objects: object[], extra: readonly (readonly [number, number])[] = [], layers: object[] = []) => ({
    width: 20, height: 12, tilewidth: 32, tileheight: 32,
    properties: [p('organ', 'stomach'), p('role', 'combat'), p('estSeconds', 10)],
    layers: [
      { type: 'tilelayer', name: 'walls', data: walls(extra) },
      { type: 'objectgroup', name: 'objects', objects: [{ id: 1, type: 'PlayerStart', x: 64, y: 360 }, ...objects] },
      ...layers,
    ],
  }) as unknown as TiledMap;
  const codes = (map: TiledMap) => readRoom('lab/a', map, TAGS).problems.map((x) => x.code);
  const boss = { id: 2, type: 'Spawn', x: 320, y: 144, properties: [p('enemyType', 'snack')] };
  const mixer = { id: 3, type: 'Mixer', x: 288, y: 224, width: 64, height: 32, properties: [p('capacity', 4)] };
  const dock = (id: number, col: number, row: number) => ({ id, type: 'Dock', x: col * 32, y: row * 32, width: 32, height: 32 });

  it('accepts a boss with a dock and a mixer and a clear line between them', () => {
    expect(codes(mapOf([boss, mixer, dock(4, 2, 4)]))).toEqual([]);
  });

  it('reports a boss with no dock, and one whose only dock is in a variant layer', () => {
    expect(codes(mapOf([boss, mixer]))).toEqual(['snack-dock']);
    const variant = { type: 'group', name: 'variant:late', properties: [p('when', 'late_snack')], layers: [{ type: 'objectgroup', name: 'docks', objects: [dock(4, 2, 4)] }] };
    expect(codes(mapOf([boss, mixer], [], [variant]))).toEqual(['snack-dock', 'dock-variant']);
  });

  it('reports a mixer that cannot hold a large portion, only in a boss room', () => {
    const small = (capacity: number) => ({ ...mixer, properties: [p('capacity', capacity)] });
    expect(codes(mapOf([boss, small(1), dock(4, 2, 4)]))).toEqual(['mixer-capacity']);
    expect(readRoom('lab/a', mapOf([boss, small(1), dock(4, 2, 4)]), TAGS).problems[0]).toMatchObject({ object: 3, args: { capacity: 1, need: 2 } });
    expect(codes(mapOf([boss, small(2), dock(4, 2, 4)]))).toEqual([]);
    expect(codes(mapOf([small(1), dock(4, 2, 4)]))).toEqual([]);
  });

  it('reports a boss with no mixer', () => {
    expect(codes(mapOf([boss, dock(4, 2, 4)]))).toEqual(['snack-mixer']);
  });

  it('says nothing of a room with docks and no boss', () => {
    expect(codes(mapOf([mixer, dock(4, 2, 4)]))).toEqual([]);
    expect(codes(mapOf([dock(4, 2, 4)]))).toEqual([]);
  });

  it('reports a dock in a wall', () => {
    expect(codes(mapOf([boss, mixer, dock(4, 0, 4)]))).toEqual(['dock-wall']);
    expect(codes(mapOf([boss, mixer, dock(4, 1, 4)]))).toEqual([]);
  });

  it('reports a wall on the line from a dock to the hopper, and only for that dock', () => {
    const wall: readonly (readonly [number, number])[] = [[6, 5]];
    const result = codes(mapOf([boss, mixer, dock(4, 2, 4), dock(5, 17, 4)], wall));
    expect(result).toEqual(['dock-path']);
    expect(readRoom('lab/a', mapOf([boss, mixer, dock(4, 2, 4), dock(5, 17, 4)], wall), TAGS).problems[0]!.object).toBe(4);
  });

  it('reports a pushable Box on the line from a dock to the hopper', () => {
    const crate = (x: number, y: number) => ({ id: 6, type: 'Box', x, y, properties: [p('boxType', 'glucose')] });
    expect(codes(mapOf([boss, mixer, dock(4, 2, 4), crate(208, 200)]))).toEqual(['dock-box']);
    expect(codes(mapOf([boss, mixer, dock(4, 2, 4), crate(208, 104)]))).toEqual([]);
  });

  it('reports a dock none of whose flight line can see the boss, and accepts a pillar that hides only part of it', () => {
    const ring: (readonly [number, number])[] = [];
    for (let col = 9; col <= 11; col++) for (let row = 3; row <= 5; row++) if (col !== 10 || row !== 4) ring.push([col, row]);
    expect(codes(mapOf([boss, mixer, dock(4, 2, 4)], ring))).toEqual(['dock-return']);
    expect(codes(mapOf([boss, mixer, dock(4, 2, 4)], [[9, 4]]))).toEqual([]);
  });

  it('sees a wall corner the line only clips: a box flying 5 tiles a second would be lost on it', () => {
    // The line from the dock in tile (1, 1) to the hopper cuts a few pixels off the corner of tile (5, 3).
    expect(codes(mapOf([boss, mixer, dock(4, 1, 1)], [[5, 3]]))).toEqual(['dock-path']);
    expect(codes(mapOf([boss, mixer, dock(4, 1, 1)], [[5, 5]]))).toEqual([]);
  });

  it('is part of the chapter: the arena is joined to the night lab and passes the map check as built', () => {
    const chapter = CHAPTERS.get('stomach')!;
    expect(chapter.links).toContainEqual({ a: 'stomach/night-lab#door-e', b: 'stomach/boss-arena#door-w' });
    expect(readRoom('stomach/boss-arena', loadMap('stomach/boss-arena'), TAGS).problems).toEqual([]);
  });
});

