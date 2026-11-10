import type { DomainEvent } from '../../game.ts';
import type { EnemyState } from '../actors.ts';
import { TELEGRAPH } from '../frames.ts';
import type { ShotSpec } from '../hazards.ts';
import type { Vec } from '../movement.ts';
import type { SnackDef, SnackState } from './boss.ts';

/**
 * The snack boss, boss.snack.name in the strings (design doc 7.5, 午夜外送). He stands still and calls
 * the docks of the room one after another, in id order: a tier-1 telegraph, then a food box leaves
 * the dock and flies straight at the mixer's hopper. A box nobody stops lands and is digested
 * (game.ts); the folder's parry sends it back at him, which is how he is worn down. He hurts no one
 * himself: a box that meets the operator is an ordinary tier-1 shot.
 */
export interface SnackTick {
  readonly enemy: EnemyState;
  readonly shots: readonly ShotSpec[];
  readonly events: readonly DomainEvent[];
}

/** Half the side of a delivery's box, in pixels. */
export const DELIVERY_HALF = 6;

/** A delivery from `dock` to `mouth`: it flies until `ticksLeft` runs out, which is when it reaches the hopper. */
export function deliveryFrom(e: EnemyState, def: SnackDef, dock: Vec, mouth: Vec): ShotSpec {
  const dx = mouth.x - dock.x;
  const dy = mouth.y - dock.y;
  const dist = Math.hypot(dx, dy);
  const flight = dist === 0 ? 1 : Math.ceil(dist / def.speed);
  return {
    owner: e.id, kind: 'delivery', x: dock.x, y: dock.y,
    vx: dist === 0 ? 0 : (dx / dist) * def.speed, vy: dist === 0 ? 0 : (dy / dist) * def.speed,
    ticksLeft: flight, halves: def.halves, half: DELIVERY_HALF, delivery: def.portion, returnDamage: def.returnDamage,
  };
}

export function stepSnack(e: EnemyState, def: SnackDef, docks: readonly Vec[], mouth: Vec): SnackTick {
  let b = e.boss as SnackState;
  const shots: ShotSpec[] = [];
  const events: DomainEvent[] = [];
  const done = (): SnackTick => ({ enemy: { ...e, boss: b }, shots, events });
  // The map check requires docks; a room without one leaves him standing.
  if (docks.length === 0) return done();

  if (b.move) {
    const frame = b.move.frame + 1;
    if (frame > TELEGRAPH.tier1Ticks) {
      shots.push(deliveryFrom(e, def, docks[b.dock % docks.length]!, mouth));
      events.push({ type: 'deliveryThrown', source: e.id, dock: b.dock % docks.length });
      b = { ...b, ticks: 0, dock: (b.dock + 1) % docks.length, thrown: b.thrown + 1, move: null };
    } else b = { ...b, move: { id: 'deliver', frame } };
    return done();
  }

  const t = b.ticks + 1;
  // The wait is measured to the start of the telegraph, so the whole rhythm is `everyTicks` per box.
  const wait = b.thrown === 0 ? def.startTicks : def.everyTicks - TELEGRAPH.tier1Ticks;
  if (t >= wait) {
    b = { ...b, ticks: 0, move: { id: 'deliver', frame: 1 } };
    events.push({ type: 'telegraph', source: e.id, tier: 1, move: 'deliver' });
  } else b = { ...b, ticks: t };
  return done();
}
