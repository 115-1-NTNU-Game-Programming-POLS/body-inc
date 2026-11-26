import { type Box } from '../collision/boxes.ts';
import { enemyCenter, enemyFrom, isHittable, stepEnemy, type EnemyState } from '../combat/actors.ts';
import { stepCaffeine } from '../combat/bosses/caffeine.ts';
import { stepSnack } from '../combat/bosses/snack.ts';
import { stepToast } from '../combat/bosses/toast.ts';
import { COURIER, STAPLER } from '../combat/frames.ts';
import { type Shot, type ShotSpec, type Zone, type ZoneSpec } from '../combat/hazards.ts';
import type { Vec } from '../combat/movement.ts';
import { unit, type OperatorState } from '../combat/operator.ts';
import { nearest, withBoxes } from '../rooms/boxes.ts';
import { isDelivery } from '../stomach/mixer.ts';
import { docksOf, mouthOf } from '../stomach/docks.ts';
import { isOrder, newOrder, orderSpot } from '../stomach/orders.ts';
import { objectBox } from '../rooms/interact.ts';
import { type RoomObject } from '../rooms/tiled.ts';
import { TILE } from '../time.ts';
import { occupantsOf } from '../tick/room.ts';
import { type Tick } from './tick.ts';
import type { Projectile } from '../game.ts';

const STAPLE_LIFE = Math.ceil(STAPLER.rangePx / STAPLER.speed);

/** Soft lock (design doc 5.2): the nearest defeatable target within 25 degrees of aim and 7 tiles. */
function aimFrom(op: OperatorState, origin: Vec, enemies: readonly EnemyState[]): Vec {
  const cos = Math.cos((STAPLER.lockHalfAngleDeg * Math.PI) / 180);
  let best: { e: EnemyState; d: number } | undefined;
  for (const e of enemies) {
    if (e.category !== 'defeatable' || !isHittable(e)) continue;
    const c = enemyCenter(e);
    const dx = c.x - origin.x;
    const dy = c.y - origin.y;
    const d = Math.hypot(dx, dy);
    if (d === 0 || d > STAPLER.lockRangePx) continue;
    if ((dx * op.aim.x + dy * op.aim.y) / d < cos) continue;
    if (!best || d < best.d) best = { e, d };
  }
  if (!best) return op.aim;
  const c = enemyCenter(best.e);
  return unit({ x: c.x - origin.x, y: c.y - origin.y });
}

const penCache = new WeakMap<readonly RoomObject[], readonly Box[]>();
/** The rest areas of a room, boxed once for as long as its object list lives: `step` asks every tick. */
const pensOf = (objects: readonly RoomObject[]): readonly Box[] => {
  let boxes = penCache.get(objects);
  if (boxes === undefined) {
    boxes = objects.filter((o) => o.kind === 'Pen').map(objectBox);
    penCache.set(objects, boxes);
  }
  return boxes;
};

/**
 * Phases P9 to P14 of docs/reviews/game-step.md: the staple fired this tick, the enemies' turn
 * (bosses first by id, then the rest), the couriers' orders landing, new areas, the rest area's
 * pen and the shots the enemies spawned. Staples aim at where the enemies were last tick, since
 * `state.enemies` is read before any of them moves.
 */
export function stepEnemies(t: Tick): void {
  const { state, events, stepped: s, senseRange, op, switches } = t;
  const room = state.room;
  let { nextId, rng, orderSerial, grid, boxes } = t;

  // Ids only ever grow, and every loop below runs in id order, so results never depend on
  // where an entity sits in its array.
  const projectiles: Projectile[] = [...state.projectiles];
  if (s.fired) {
    const origin = { x: op.x, y: op.y - 4 };
    const dir = aimFrom(op, origin, state.enemies);
    projectiles.push({ id: nextId++, x: origin.x, y: origin.y, vx: dir.x * STAPLER.speed, vy: dir.y * STAPLER.speed, ticksLeft: STAPLE_LIFE });
    events.push({ type: 'fire', weapon: 'stapler' });
  }

  // Zones age before new ones join, so a zone's first tick is its age 1.
  const zones = new Map<number, Zone>(state.zones.map((z) => [z.id, { ...z, age: z.age + 1 }]));
  const newShots: ShotSpec[] = [];
  const newZones: ZoneSpec[] = [];
  const throws: { readonly source: number; readonly x: number; readonly y: number }[] = [];
  const target = { x: op.x, y: op.y };
  const enemies = new Map<number, EnemyState>();
  const ordered = [...state.enemies].sort((a, b) => a.id - b.id);
  for (const e of ordered) {
    if (e.boss && e.phase !== 'closed') {
      const def = state.bosses[e.boss.def]!;
      if (def.behaviour === 'toast') {
        const r = stepToast(e, def, target);
        enemies.set(e.id, r.enemy);
        events.push(...r.events);
        newShots.push(...r.shots);
        continue;
      }
      if (def.behaviour === 'snack') {
        const mouth = mouthOf(room);
        // His boxes digest like an order and leave no parcel: one on its last tick went out in this tick's mixer step.
        // Only his own wake him; a courier's order is digested too but is not his overtime.
        const digested = (state.mixer?.batches ?? []).filter((b) => isDelivery(b) && b.left === 1).length;
        const r = stepSnack(e, def, docksOf(room), mouth ?? target, digested, state.paceScale ?? 1);
        enemies.set(e.id, r.enemy);
        events.push(...r.events);
        newShots.push(...r.shots);
        continue;
      }
      const summoned = ordered.filter((x) => x.summoner === e.id).length;
      const r = stepCaffeine(e, { grid, def, target, rng, summoned, summonScale: state.summonScale ?? 1 });
      rng = r.rng;
      enemies.set(e.id, r.enemy);
      events.push(...r.events);
      newShots.push(...r.shots);
      newZones.push(...r.zones);
      for (const at of r.summons) {
        const id = nextId++;
        enemies.set(id, enemyFrom(def.summon.enemy, id, at.x, at.y, 0, { summoner: e.id }));
      }
      if (r.powerCut) {
        // The adenosine at his feet piles onto him (design doc 7.4); what clings to the operator stays.
        for (const [id, z] of zones) if (z.owner === e.id) zones.delete(id);
        for (const x of ordered) {
          if (x.summoner === e.id && x.phase === 'idle') enemies.set(x.id, { ...x, phase: 'pinned', phaseTicks: 0, x: r.enemy.x, y: r.enemy.y });
        }
      }
      if (r.powerBack) {
        // They fall off as fluff and reform where they were summoned: the count never drops.
        for (const x of ordered) {
          if (x.summoner === e.id && x.phase === 'pinned') enemies.set(x.id, { ...x, phase: 'dispersed', phaseTicks: 0, x: x.homeX, y: x.homeY });
        }
      }
      continue;
    }
    if (enemies.has(e.id)) continue;
    // A courier throws at a belt, not at the operator, and only winds up while one will take the order.
    let aim: Vec = target;
    let ready = true;
    if (e.archetype === 'courier' && e.phase === 'idle') {
      const spot = orderSpot(room, boxes, occupantsOf(op, state.enemies), switches, e.x, e.y);
      ready = spot !== undefined && boxes.filter(isOrder).length < COURIER.maxOrders;
      if (spot) aim = { x: (spot.col + 0.5) * TILE, y: (spot.row + 0.5) * TILE };
    }
    const r = stepEnemy(grid, e, aim, senseRange, ready);
    enemies.set(e.id, r.enemy);
    newShots.push(...r.shots);
    if (r.order) throws.push({ source: e.id, x: r.enemy.x, y: r.enemy.y });
    if (r.telegraph) events.push({ type: 'telegraph', source: e.id, tier: 1 });
    if (r.reformed) events.push({ type: 'reformed', target: e.id, enemy: e.type });
    if (r.respawned) events.push({ type: 'respawned', target: e.id, enemy: e.type });
  }
  // Orders land once every enemy has moved, in id order. The cap and the head tile are judged on what
  // the floor and the bodies are now: a windup began on a floor that other couriers are filling in this
  // same tick, and a walker may have stepped onto the head after the courier's turn in the loop. An
  // order that finds no room is lost, as when the head was taken during the windup.
  if (throws.length > 0) {
    for (const t of throws) {
      if (boxes.filter(isOrder).length >= COURIER.maxOrders) break;
      const spot = orderSpot(room, boxes, occupantsOf(op, enemies.values()), switches, t.x, t.y);
      if (!spot) continue;
      const box = newOrder(orderSerial++, spot);
      boxes = [...boxes, box].sort((a, b) => a.id - b.id);
      events.push({ type: 'orderThrown', source: t.source, object: box.id, col: spot.col, row: spot.row });
    }
    grid = withBoxes(room.grid, boxes);
  }
  for (const z of newZones) zones.set(nextId, { ...z, id: nextId++, age: 1, spent: false });
  // The rest area locks what drifts into it: the answer to adenosine that cannot be beaten (design doc 8.5).
  const pens = pensOf(state.room.objects);
  if (pens.length > 0) {
    for (const e of enemies.values()) {
      if (!e.clings || e.phase !== 'idle' || e.frozen > 0) continue;
      const c = enemyCenter(e);
      if (!pens.some((b) => c.x >= b.left && c.x < b.right && c.y >= b.top && c.y < b.bottom)) continue;
      enemies.set(e.id, { ...e, phase: 'closed', phaseTicks: 0, respawnTicks: 0 });
      events.push({ type: 'caseClosed', target: e.id, enemy: e.type });
    }
  }
  let shots: Shot[] = [...state.shots, ...newShots.map((sh) => ({ ...sh, id: nextId++, spent: false }))];
  t.projectiles = projectiles;
  t.zones = zones;
  t.enemies = enemies;
  t.nextId = nextId;
  t.rng = rng;
  t.orderSerial = orderSerial;
  t.grid = grid;
  t.boxes = boxes;
  t.shots = shots;
}
