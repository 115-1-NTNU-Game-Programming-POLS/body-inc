import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOSSES, CHAPTERS, DIALOGUES, ENEMIES, PARAMS, RESCUES, TAGS } from '../../src/app/content.ts';
import {
  amount, COURIER, createGame, holds, isOrder, newOrder, NO_INPUT, ORDER_ID_BASE, parseRoom, roomsOf, selectBoxes, selectMixer, STAMP, startChapter, step,
  stepChapter, TELEGRAPH, TICK_HZ, TILE,
  type ChapterContent, type ChapterState, type DomainEvent, type EnteredRoom, type EnemyState, type GameEvent, type GameState, type TickInput, type TiledMap,
} from '../../src/core/index.ts';
import { stepEnemy } from '../../src/core/combat/actors.ts';
import { readRoom } from '../../src/core/rooms/tiled.ts';
import { stepMixer } from '../../src/core/stomach/mixer.ts';
import { compileCondition } from '../../src/core/tags/dictionary.ts';

/**
 * The late-night courier (design doc 7.5, core/stomach/orders.ts): he throws one food box, an
 * order, onto the nearest running belt every few seconds. Let go, the belt takes it to the mixer,
 * which digests it and works overtime; stamped, it is returned and the chapter counts one return.
 */

const START = { x: 480, y: 320 };
const COURIER_AT = { x: 3 * TILE + 16, y: 5 * TILE + 16 };

const border = (c: number, r: number) => c === 0 || r === 0 || c === 19 || r === 11;
const obj = (id: number, kind: string, col: number, row: number, cols: number, rows: number, props: Record<string, unknown>) =>
  ({ id, kind, name: '', x: col * TILE, y: row * TILE, width: cols * TILE, height: rows * TILE, props, conditions: {} });
const belt = (id: number, col: number, cols: number, row = 6, direction = 'E') => obj(id, 'Conveyor', col, row, cols, 1, { direction, speed: 'normal' });
const courier = (id = 10, at = COURIER_AT) => ({
  id, kind: 'Spawn', name: '', x: at.x, y: at.y, width: 0, height: 0, conditions: {}, props: { enemyType: 'courier', count: 1, respawnSeconds: 0, when: '' },
});

/** Open 20 x 12 room; `walls` adds solid tiles to the border. */
function room(objects: object[] = [], walls: readonly (readonly [number, number])[] = [], start = START): EnteredRoom {
  const solid = Array.from({ length: 240 }, (_, i) => {
    const c = i % 20;
    const r = Math.floor(i / 20);
    return border(c, r) || walls.some(([wc, wr]) => wc === c && wr === r);
  });
  return {
    id: 'test', grid: { cols: 20, rows: 12, solid }, props: {}, variants: [], active: [],
    objects: [{ id: 1, kind: 'PlayerStart', name: '', ...start, width: 0, height: 0, props: {}, conditions: {} }, ...objects],
  } as unknown as EnteredRoom;
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
const orders = (s: GameState) => s.boxes.filter(isOrder);
const game = (r: EnteredRoom, over: { gauge?: number } = {}) => createGame(r, 1, ENEMIES, over);

const WINDUP = TELEGRAPH.tier1Ticks;
const CYCLE = COURIER.intervalTicks + WINDUP + COURIER.throwTicks;

describe('the courier as data', () => {
  it('is a defeatable courier of performance 4, and a spawn creates him idle with his post as home', () => {
    expect(ENEMIES.enemies.get('courier')).toEqual({ id: 'courier', category: 'defeatable', archetype: 'courier', performance: 4 });
    const g = game(room([courier()]));
    expect(g.enemies[0]).toMatchObject({ type: 'courier', archetype: 'courier', hp: 4, phase: 'idle', homeX: COURIER_AT.x, homeY: COURIER_AT.y });
    expect(g.enemies[0]!.facing).toBeUndefined();
  });

  it('has literal pacing: an 8 second pause, the tier-1 telegraph, at most two orders afloat', () => {
    expect(COURIER.intervalTicks).toBe(8 * TICK_HZ);
    expect(COURIER.windupTicks).toBe(TELEGRAPH.tier1Ticks);
    expect(COURIER.maxOrders).toBe(2);
  });

  it('orders have ids of their own, below every Tiled and spawned-crate id the rooms use', () => {
    expect(isOrder({ id: ORDER_ID_BASE })).toBe(true);
    expect(isOrder({ id: ORDER_ID_BASE - 7 })).toBe(true);
    expect(isOrder({ id: ORDER_ID_BASE + 1 })).toBe(false);
    expect(isOrder({ id: -1 })).toBe(false);
    expect(isOrder({ id: 12 })).toBe(false);
    expect(newOrder(3, { col: 2, row: 6 })).toEqual({ id: ORDER_ID_BASE - 3, col: 2, row: 6, left: 0, ticks: 0, boxType: 'food' });
  });
});

describe('his schedule', () => {
  const open = room().grid;
  const aim = { x: 80, y: 208 };
  const post = (): EnemyState => game(room([courier()])).enemies[0]!;

  /** Steps him until `stop` says so; returns where he ended and every step's flags. */
  function walk(start: EnemyState, ready: boolean, limit: number, stop: (r: ReturnType<typeof stepEnemy>) => boolean) {
    let e = start;
    const seen: ReturnType<typeof stepEnemy>[] = [];
    for (let i = 0; i < limit; i++) {
      const r = stepEnemy(open, e, aim, undefined, ready);
      seen.push(r);
      e = r.enemy;
      if (stop(r)) break;
    }
    return { e, seen };
  }

  it('waits out the pause and then telegraphs once, facing the belt and not the operator', () => {
    const { e, seen } = walk(post(), true, 10 * TICK_HZ, (r) => r.telegraph);
    expect(seen).toHaveLength(COURIER.intervalTicks);
    expect(e).toMatchObject({ phase: 'windup', strikeDir: { x: -1, y: 0 }, x: COURIER_AT.x, y: COURIER_AT.y });
    expect(seen.filter((r) => r.telegraph)).toHaveLength(1);
  });

  it('lets go of the order when the tier-1 telegraph has run its full length, once, and is back at his post after the throw pose', () => {
    const windup = walk(post(), true, 10 * TICK_HZ, (r) => r.telegraph).e;
    const thrown = walk(windup, true, 60, (r) => r.order);
    expect(thrown.seen).toHaveLength(WINDUP);
    expect(thrown.e.phase).toBe('strike');
    expect(thrown.seen.filter((r) => r.order)).toHaveLength(1);
    const back = walk(thrown.e, true, 60, (r) => r.enemy.phase === 'idle');
    expect(back.seen).toHaveLength(COURIER.throwTicks);
    expect(back.seen.some((r) => r.order || r.telegraph)).toBe(false);
  });

  it('never starts a telegraph while nothing will take the order, however long he waits', () => {
    const { e, seen } = walk(post(), false, 5 * COURIER.intervalTicks, () => false);
    expect(seen.some((r) => r.telegraph || r.order)).toBe(false);
    expect(e.phase).toBe('idle');
    // The moment a belt is free again the telegraph starts at once: his pause is long spent.
    expect(stepEnemy(open, e, aim, undefined, true).telegraph).toBe(true);
  });

  it('keeps the schedule through hit-stop on the telegraph, and never walks', () => {
    const windup = walk(post(), true, 10 * TICK_HZ, (r) => r.telegraph).e;
    const hit = { ...windup, frozen: 3 };
    const r = walk(hit, true, 60, (x) => x.order);
    expect(r.seen).toHaveLength(WINDUP);
    expect(r.e).toMatchObject({ x: COURIER_AT.x, y: COURIER_AT.y });
  });
});

describe('throwing an order', () => {
  it('puts a food box on the head of the belt, one telegraph after the pause, and a second only a full cycle later', () => {
    const r = run(game(room([courier(), belt(20, 2, 8)])), 2 * CYCLE);
    const thrown = ofType(r, 'orderThrown');
    expect(thrown[0]).toEqual({ type: 'orderThrown', source: thrown[0]!.source, object: ORDER_ID_BASE, col: 2, row: 6 });
    expect(thrown[1]).toMatchObject({ object: ORDER_ID_BASE - 1, col: 2, row: 6 });
    // The telegraph comes before the throw by exactly the tier-1 warning.
    const warned = r.events.flatMap((es, t) => (es.some((e) => e.type === 'telegraph') ? [t] : []));
    const threw = r.events.flatMap((es, t) => (es.some((e) => e.type === 'orderThrown') ? [t] : []));
    expect(threw[0]! - warned[0]!).toBe(WINDUP);
    expect(warned[0]).toBe(COURIER.intervalTicks - 1);
    expect(threw[1]! - threw[0]!).toBe(CYCLE);
  });

  it('is a food box on the belt: it shows as food and the belt carries it east', () => {
    const r = run(game(room([courier(), belt(20, 2, 8)])), COURIER.intervalTicks + WINDUP + 90);
    const [order] = selectBoxes(r.state);
    expect(order).toMatchObject({ object: ORDER_ID_BASE, boxType: 'food' });
    expect(order!.x).toBeGreaterThan(2 * TILE);
  });

  it('goes to the head of the belt nearest him, not the first one in the file', () => {
    const r = run(game(room([courier(10, { x: 14 * TILE + 16, y: 5 * TILE + 16 }), belt(20, 2, 4, 6), belt(21, 13, 4, 6)])), CYCLE);
    expect(ofType(r, 'orderThrown')).toMatchObject([{ col: 13, row: 6 }]);
  });

  it('takes the head of a belt that runs west to be its east end', () => {
    const r = run(game(room([courier(10, { x: 8 * TILE + 16, y: 5 * TILE + 16 }), belt(20, 2, 8, 6, 'W')])), CYCLE);
    expect(ofType(r, 'orderThrown')).toMatchObject([{ col: 9, row: 6 }]);
  });

  it('faces the belt he throws onto, not the operator, while he raises the order', () => {
    // The operator is far to the south-east, so a throw at them would be drawn facing east.
    const r = run(game(room([courier(), belt(20, 2, 8)])), COURIER.intervalTicks + 1);
    expect(r.state.enemies[0]).toMatchObject({ phase: 'windup', strikeDir: { x: -1, y: 0 } });
  });

  it('does not throw onto a belt whose head is the mouth of the mixer: the order would be eaten at once', () => {
    const r = run(game(room([courier(), obj(21, 'Mixer', 10, 6, 2, 1, { capacity: 3, outlet: 'E' }), belt(20, 10, 4)])), 3 * CYCLE);
    expect(ofType(r, 'orderThrown')).toEqual([]);
    expect(ofType(r, 'telegraph')).toEqual([]);
  });

  it('throws only onto a belt that is running: one with its switch off waits, and runs again once it is on', () => {
    const lever = obj(40, 'Switch', 15, 9, 1, 1, { target: 20, mode: 'toggle' });
    const off = run(game(room([courier(), { ...belt(20, 2, 8) }, lever])), 3 * CYCLE);
    expect(ofType(off, 'orderThrown')).toEqual([]);
    expect(ofType(off, 'telegraph')).toEqual([]);
    const g = game(room([courier(), belt(20, 2, 8), lever]));
    const on = run({ ...g, switches: [40] }, CYCLE);
    expect(ofType(on, 'orderThrown')).toMatchObject([{ col: 2, row: 6 }]);
  });

  it('does nothing in a room with no belt', () => {
    const r = run(game(room([courier()])), 3 * CYCLE);
    expect(ofType(r, 'orderThrown')).toEqual([]);
    expect(ofType(r, 'telegraph')).toEqual([]);
  });

  it('stops at two orders afloat, though the head of the belt is free: a belt nobody clears is not flooded', () => {
    // A belt of three tiles that ends against a wall, so the orders pile up at its end.
    const r = run(game(room([courier(), belt(20, 2, 3)], [[5, 6]])), 4 * CYCLE);
    expect(ofType(r, 'orderThrown')).toHaveLength(COURIER.maxOrders);
    expect(orders(r.state).map((b) => [b.col, b.row])).toEqual([[3, 6], [4, 6]]);
    // He did not raise a third one either: no telegraph for an order that would not be thrown.
    expect(ofType(r, 'telegraph')).toHaveLength(COURIER.maxOrders);
    expect(r.state.enemies[0]!.phase).toBe('idle');
  });

  it('waits while the head of the belt is taken, below the cap, and no order is thrown on top of another', () => {
    const r = run(game(room([courier(), belt(20, 2, 1)], [[3, 6]])), 4 * CYCLE);
    expect(ofType(r, 'orderThrown')).toHaveLength(1);
    expect(orders(r.state)).toHaveLength(1);
    expect(ofType(r, 'telegraph')).toHaveLength(1);
  });

  it('numbers every order of the visit once, through a forced leave', () => {
    const first = run(game(room([courier(), belt(20, 2, 8)])), CYCLE + 5);
    expect(first.state.orderSerial).toBe(1);
    const dead = run({ ...first.state, operator: { ...first.state.operator, halves: 0 } }, 1);
    expect(ofType(dead, 'forcedLeave')).toHaveLength(1);
    // The map's boxes went home and the order is not one of them; the count goes on.
    expect(orders(dead.state)).toEqual([]);
    expect(dead.state.orderSerial).toBe(1);
    const next = run(dead.state, 2 * CYCLE);
    expect(ofType(next, 'orderThrown')[0]!.object).toBe(ORDER_ID_BASE - 1);
  });
});

describe('sending an order back with the stamp', () => {
  const near = { col: 6, row: 6 };
  const far = { col: 17, row: 6 };
  const food = obj(30, 'Box', 6, 8, 1, 1, { boxType: 'food', portion: 'normal' });
  const OP = { x: 160, y: 192 };
  const stamp = (t: number): TickInput => ({ ...NO_INPUT, stampPressed: t === 0 });
  const stamped = (): Run => {
    const g = game(room([food], [], OP), { gauge: STAMP.gaugeMax });
    const s: GameState = { ...g, boxes: [...g.boxes, newOrder(0, near), newOrder(1, far)].sort((a, b) => a.id - b.id) };
    return run(s, STAMP.startupTicks + 4, stamp);
  };

  it('takes an order within the stamp\'s radius out of the room, and no other box', () => {
    const r = stamped();
    expect(ofType(r, 'orderReturned')).toEqual([{ type: 'orderReturned', object: ORDER_ID_BASE, col: 6, row: 6 }]);
    expect(r.state.boxes.map((b) => b.id)).toEqual([ORDER_ID_BASE - 1, 30]);
  });

  it('leaves an order outside the radius where it is', () => {
    const r = stamped();
    const out = orders(r.state)[0]!;
    expect(Math.hypot((out.col + 0.5) * TILE - OP.x, (out.row + 0.5) * TILE - OP.y)).toBeGreaterThan(STAMP.radiusPx);
    expect(ofType(r, 'stampLanded')).toHaveLength(1);
    expect(r.state.operator.gauge).toBe(0);
  });

  it('counts the orders it takes: two in reach are two returns', () => {
    const g = game(room([], [], OP), { gauge: STAMP.gaugeMax });
    const s: GameState = { ...g, boxes: [newOrder(1, { col: 7, row: 6 }), newOrder(0, near)].sort((a, b) => a.id - b.id) };
    const r = run(s, STAMP.startupTicks + 4, stamp);
    expect(ofType(r, 'orderReturned').map((e) => e.object)).toEqual([ORDER_ID_BASE - 1, ORDER_ID_BASE]);
    expect(r.state.boxes).toEqual([]);
  });

  it('closes the courier\'s case with the same stamp when he stands in reach', () => {
    const g = game(room([courier(10, { x: 200, y: 192 })], [], OP), { gauge: STAMP.gaugeMax });
    const r = run({ ...g, boxes: [newOrder(0, near)] }, STAMP.startupTicks + 4, stamp);
    expect(ofType(r, 'orderReturned')).toHaveLength(1);
    expect(ofType(r, 'caseClosed')).toEqual([{ type: 'caseClosed', target: g.enemies[0]!.id, enemy: 'courier' }]);
  });
});

describe('letting an order go to the mixer', () => {
  const lab = (extra: object[] = []) => room([
    courier(), belt(20, 2, 8), obj(21, 'Mixer', 10, 6, 2, 1, { capacity: 3, outlet: 'E' }), ...extra,
  ]);

  it('rides the belt into the hopper, is digested for a normal portion, and leaves no parcel behind', () => {
    const fed = run(game(lab()), 30 * TICK_HZ);
    expect(ofType(fed, 'mixerFed')[0]).toMatchObject({ object: ORDER_ID_BASE, portion: 'normal', capacity: 3 });
    const tick = firstTick(fed, 'mixerFed');
    expect(tick).toBeGreaterThan(COURIER.intervalTicks + WINDUP);
    // The digest runs 20 seconds; nothing comes out of the mixer for an order, then or after.
    expect(ofType(fed, 'parcelOut')).toEqual([]);
    const done = run(game(lab()), tick + 1 + 20 * TICK_HZ);
    expect(selectMixer(done.state)!.batches.filter((b) => b.box === ORDER_ID_BASE)).toEqual([]);
    expect(done.state.boxes.filter((b) => b.boxType === 'parcel')).toEqual([]);
  });

  it('holds the mixer\'s capacity while it digests, so the mixer is working overtime', () => {
    const fed = run(game(lab()), 16 * TICK_HZ);
    expect(firstTick(fed, 'mixerFed')).toBeGreaterThanOrEqual(0);
    expect(fed.state.mixer!.batches).toHaveLength(1);
    expect(fed.state.mixer!.batches[0]).toMatchObject({ box: ORDER_ID_BASE, order: true });
    expect(selectMixer(fed.state)!.batches[0]!.done).toBeGreaterThan(0);
  });

  it('jams it like any box when it is the fourth, and an order is thrown back out as the food box it is', () => {
    const g = game(lab([obj(31, 'Box', 4, 3, 1, 1, { boxType: 'food', portion: 'small' }), obj(32, 'Box', 5, 3, 1, 1, { boxType: 'food', portion: 'small' })]));
    const hopper = { col: 10, row: 6, left: 0, ticks: 0 };
    const boxes = [newOrder(1, hopper), newOrder(0, hopper), { id: 31, ...hopper }, { id: 32, ...hopper }];
    const r = stepMixer(g.room, { batches: [] }, boxes.sort((a, b) => a.id - b.id), { bodies: [] });
    expect(r.events.map((e) => e.type)).toContain('mixerJammed');
    const back = r.boxes.filter(isOrder);
    expect(back).toHaveLength(2);
    expect(back.every((b) => b.boxType === 'food' && b.left === 0)).toBe(true);
    // The two the map placed are plain boxes again; their type comes from the map.
    expect(r.boxes.filter((b) => !isOrder(b)).every((b) => b.boxType === undefined)).toBe(true);
  });
});

describe('what an order is not', () => {
  const OP = { x: 480, y: 320 };
  it('is not taken by a port that takes any box, though the same food box would be', () => {
    // Each is tried on its own: two boxes cannot share a tile.
    const open = obj(30, 'Port', 14, 6, 1, 1, { need: 1, accepts: 'any' });
    const g = game(room([open], [], OP));
    const onPort = { col: 14, row: 6, left: 0, ticks: 0 };
    const order = run({ ...g, boxes: [{ ...newOrder(0, onPort) }] }, 5);
    expect(ofType(order, 'boxDelivered')).toEqual([]);
    expect(orders(order.state)).toHaveLength(1);
    const food = run({ ...g, boxes: [{ id: 99, ...onPort, boxType: 'food' }] }, 5);
    expect(ofType(food, 'boxDelivered')).toHaveLength(1);
  });

  it('is not chilled by a cold store, though the same food box would be', () => {
    const cold = obj(31, 'ColdStore', 14, 6, 2, 2, {});
    const g = game(room([cold], [], OP));
    const at = { col: 14, row: 6, left: 0, ticks: 0 };
    const order = run({ ...g, boxes: [newOrder(0, at)] }, 5);
    expect(ofType(order, 'boxChilled')).toEqual([]);
    expect(orders(order.state)).toHaveLength(1);
    const food = run({ ...g, boxes: [{ id: 99, ...at, boxType: 'food' }] }, 5);
    expect(ofType(food, 'boxChilled')).toHaveLength(1);
  });

  it('is not a push box the map placed: it has no home, so a forced leave does not put it back', () => {
    const g = game(room([obj(32, 'Box', 3, 3, 1, 1, { boxType: 'food', portion: 'normal' })], [], OP));
    const dead = run({ ...g, boxes: [...g.boxes, newOrder(0, { col: 8, row: 8 })].sort((a, b) => a.id - b.id), operator: { ...g.operator, halves: 0 } }, 1);
    expect(ofType(dead, 'forcedLeave')).toHaveLength(1);
    expect(dead.state.boxes.map((b) => b.id)).toEqual([32]);
  });
});

describe('the chapter counts a return and nothing else', () => {
  const CHAPTER = CHAPTERS.get('stomach')!;
  const loadMap = (path: string) => JSON.parse(readFileSync(`public/assets/maps/${path}.tmj`, 'utf8')) as TiledMap;
  const content: ChapterContent = {
    chapter: CHAPTER,
    rooms: new Map(roomsOf(CHAPTER).map((p) => [p, parseRoom(p, loadMap(p), TAGS)])),
    dialogues: DIALOGUES, dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS, rescues: RESCUES,
  };
  const NONE: TickInput = { move: { x: 0, y: 0 } };
  const courierOf = (s: ChapterState) => s.game.enemies.find((e) => e.type === 'courier');

  function play(s: ChapterState, ticks: number, input: (t: number) => TickInput = () => NONE) {
    const events: GameEvent[] = [];
    for (let t = 0; t < ticks; t++) {
      const r = stepChapter(content, s, input(t));
      s = r.state;
      events.push(...r.events);
    }
    return { state: s, events };
  }
  const night = (): ChapterState => {
    const { pending: _, ...s } = startChapter(content, { room: 'stomach/night-lab', gauge: STAMP.gaugeMax });
    return s;
  };
  const withOrders = (s: ChapterState, ...at: { col: number; row: number }[]): ChapterState =>
    ({ ...s, game: { ...s.game, boxes: [...s.game.boxes, ...at.map((t, i) => newOrder(i, t))].sort((a, b) => a.id - b.id) } });
  const stamp = (t: number): TickInput => ({ ...NONE, stampPressed: t === 0 });

  it('is wired: the courier stands in the night lab, his case flag is a chapter boolean and returns are an event count', () => {
    expect(CHAPTER.closedCases).toEqual({ sugar_seller: 'sugar_seller_closed', courier: 'courier_closed' });
    expect(TAGS.tags.get('courier_closed')?.sources).toEqual(['chapter']);
    expect(TAGS.tags.get('returned_orders')).toMatchObject({ sources: ['event'] });
    expect(courierOf(night())).toBeDefined();
  });

  it('throws his first order onto the in-belt of the night lab, the one beside him', () => {
    const r = play(night(), COURIER.intervalTicks + WINDUP + 2);
    expect(r.events.filter((e) => e.type === 'orderThrown')).toMatchObject([{ col: 2, row: 6 }]);
  });

  it('a stamp that returns an order is one logged return, and an order let go is no return at all', () => {
    const stamped = play(withOrders(night(), { col: 4, row: 8 }), STAMP.startupTicks + 4, stamp);
    expect(stamped.events.filter((e) => e.type === 'orderReturned')).toHaveLength(1);
    expect(amount(stamped.state.run.tags, TAGS, 'returned_orders')).toBe(1);
    expect(stamped.state.run.tags.log.nodes.map((n) => `${n.kind}:${n.key}`)).toContain('choice:return.courier');

    const letGo = play(night(), 20 * TICK_HZ);
    expect(letGo.events.filter((e) => e.type === 'mixerFed')).not.toHaveLength(0);
    expect(amount(letGo.state.run.tags, TAGS, 'returned_orders')).toBe(0);
  });

  it('keeps counting across orders, and an order is never remembered as a box the map placed', () => {
    const stamped = play(withOrders(night(), { col: 4, row: 8 }, { col: 5, row: 8 }), STAMP.startupTicks + 4, stamp);
    expect(amount(stamped.state.run.tags, TAGS, 'returned_orders')).toBe(2);
    expect(stamped.state.run.boxes.map((b) => b.key).filter((k) => /#-/.test(k))).toEqual([]);
  });

  it('an order in the mixer is work like any food: asleep beside it, the operator is woken after twenty seconds of it', () => {
    const s0 = night();
    // No courier of his own, so the only orders are the two put on the hopper here; the operator stands at the bed.
    const bedside: ChapterState = { ...s0, game: { ...s0.game, enemies: [], operator: { ...s0.game.operator, x: 470, y: 288 } } };
    const lay = play(bedside, 1, () => ({ ...NONE, interactPressed: true }));
    expect(lay.events.map((e) => e.type)).toContain('fellAsleep');
    const hopper = { col: 10, row: 6 };
    const put = (s: ChapterState, serial: number): ChapterState =>
      ({ ...s, game: { ...s.game, boxes: [...s.game.boxes, newOrder(serial, hopper)].sort((a, b) => a.id - b.id) } });
    const first = play(put(lay.state, 0), 10 * TICK_HZ);
    expect(first.events.filter((e) => e.type === 'sleepInterrupted')).toEqual([]);
    // The second order keeps the mixer busy past the first one's end, so the 20 seconds run on.
    const second = play(put(first.state, 1), 15 * TICK_HZ);
    expect(second.events).toContainEqual({ type: 'sleepInterrupted', object: 8, cause: 'mixer', wakes: 1 });
  });

  it('closing his case sets the flag, and he stays out of the night lab on every later visit', () => {
    const s = night();
    const at = courierOf(s)!;
    const nearly: ChapterState = {
      ...s,
      game: { ...s.game, enemies: s.game.enemies.map((e) => (e.id === at.id ? { ...e, hp: 1 } : e)), operator: { ...s.game.operator, x: at.x, y: at.y + 40, aim: { x: 0, y: -1 } } },
    };
    const r = play(nearly, 60, (t) => ({ ...NONE, attack: true, attackPressed: t === 0 }));
    expect(r.events.map((e) => e.type)).toContain('caseClosed');
    expect(holds(r.state.run.tags, TAGS, compileCondition(TAGS, 'courier_closed'))).toBe(true);
    const { pending: _, ...again } = startChapter(content, { room: 'stomach/night-lab', tags: r.state.run.tags });
    expect(courierOf(again)).toBeUndefined();
  });
});

describe('the map check', () => {
  const p = (name: string, value: string | number | boolean) => ({ name, value });
  const mapOf = (objects: object[], layers: object[] = []) => ({
    width: 20, height: 12, tilewidth: 32, tileheight: 32,
    properties: [p('organ', 'stomach'), p('role', 'puzzle'), p('estSeconds', 10)],
    layers: [
      { type: 'tilelayer', name: 'walls', data: Array.from({ length: 240 }, () => 0) },
      { type: 'objectgroup', name: 'objects', objects: [{ id: 1, type: 'PlayerStart', x: 64, y: 360 }, ...objects] },
      ...layers,
    ],
  }) as unknown as TiledMap;
  const codes = (map: TiledMap) => readRoom('lab/a', map, TAGS).problems.map((x) => x.code);
  const spawn = { id: 5, type: 'Spawn', x: 112, y: 176, properties: [p('enemyType', 'courier')] };
  const conveyor = { id: 6, type: 'Conveyor', x: 64, y: 192, width: 256, height: 32, properties: [p('direction', 'E')] };
  const line = (stage: string) => ({ id: 7, type: 'Line', x: 320, y: 64, width: 64, height: 32, properties: [p('stage', stage)] });

  it('accepts a courier beside a belt', () => {
    expect(codes(mapOf([spawn, conveyor]))).toEqual([]);
  });

  it('reports a courier with no belt in the room, and one whose only belt is in a variant layer', () => {
    expect(codes(mapOf([spawn]))).toEqual(['courier-belt']);
    const variant = { type: 'group', name: 'variant:late', properties: [p('when', 'late_snack')], layers: [{ type: 'objectgroup', name: 'belts', objects: [conveyor] }] };
    expect(codes(mapOf([spawn], [variant]))).toEqual(['courier-belt']);
  });

  it('says nothing of a room with a belt and no courier, or a courier of the other kinds of enemy', () => {
    expect(codes(mapOf([conveyor]))).toEqual([]);
    expect(codes(mapOf([{ ...spawn, properties: [p('enemyType', 'salesman')] }]))).toEqual([]);
  });

  it('reports a courier in a room with a factory line', () => {
    expect(codes(mapOf([spawn, conveyor, line('receiving')]))).toContain('courier-factory');
    expect(codes(mapOf([spawn, conveyor]))).not.toContain('courier-factory');
  });
});
