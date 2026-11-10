import type { DomainEvent } from '../../game.ts';
import type { EnemyState } from '../actors.ts';
import { TELEGRAPH } from '../frames.ts';
import type { ShotSpec } from '../hazards.ts';
import type { Vec } from '../movement.ts';
import type { SnackDef, SnackDelivery, SnackState } from './boss.ts';
import type { Portion } from '../../stomach/mixer.ts';

/**
 * The snack boss, boss.snack.name in the strings (design doc 7.5, 午夜外送). He stands still and calls
 * the docks of the room one after another, in id order: a tier-1 telegraph, then a food box leaves
 * the dock and flies straight at the mixer's hopper. A box nobody stops lands and is digested
 * (game.ts); the folder's parry sends it back at him, which is how he is worn down. He hurts no one
 * himself: a box that meets the operator is an ordinary tier-1 shot. Stage 2 (加大份量) starts when his
 * budget has fallen to the stage's budget: the boxes are large portions from then on, which the mixer
 * counts as two places each, so the player has to pick which ones to return.
 */
export interface SnackTick {
  readonly enemy: EnemyState;
  readonly shots: readonly ShotSpec[];
  readonly events: readonly DomainEvent[];
}

/** Half the side of a delivery's box, in pixels; the large portion is a bigger box. */
export const DELIVERY_HALF: Readonly<Record<Portion, number>> = { small: 6, normal: 6, large: 9 };

/** The delivery numbers of the stage he is in. */
export const deliveryOfStage = (def: SnackDef, stage: number): SnackDelivery => (stage >= 2 ? def.stage2 : def);

/** A delivery from `dock` to `mouth`: it flies until `ticksLeft` runs out, which is when it reaches the hopper. */
export function deliveryFrom(e: EnemyState, def: SnackDelivery, dock: Vec, mouth: Vec): ShotSpec {
  const dx = mouth.x - dock.x;
  const dy = mouth.y - dock.y;
  const dist = Math.hypot(dx, dy);
  const flight = dist === 0 ? 1 : Math.ceil(dist / def.speed);
  return {
    owner: e.id, kind: 'delivery', x: dock.x, y: dock.y,
    vx: dist === 0 ? 0 : (dx / dist) * def.speed, vy: dist === 0 ? 0 : (dy / dist) * def.speed,
    ticksLeft: flight, halves: def.halves, half: DELIVERY_HALF[def.portion], delivery: def.portion, returnDamage: def.returnDamage,
  };
}

export function stepSnack(e: EnemyState, def: SnackDef, docks: readonly Vec[], mouth: Vec): SnackTick {
  let b = e.boss as SnackState;
  const shots: ShotSpec[] = [];
  const events: DomainEvent[] = [];
  const done = (): SnackTick => ({ enemy: { ...e, boss: b }, shots, events });
  // The map check requires docks; a room without one leaves him standing.
  if (docks.length === 0) return done();

  // A telegraph already under way is finished first, so a box is thrown in the stage it was announced in
  // and the pause of the new stage starts after it.
  if (b.stage === 1 && !b.move && e.hp <= def.stage2.budget) {
    b = { ...b, stage: 2, ticks: 0, stageThrown: 0 };
    events.push({ type: 'snackStage', target: e.id, stage: 2 });
    return done();
  }
  const d = deliveryOfStage(def, b.stage);

  if (b.move) {
    const frame = b.move.frame + 1;
    if (frame > TELEGRAPH.tier1Ticks) {
      shots.push(deliveryFrom(e, d, docks[b.dock % docks.length]!, mouth));
      events.push({ type: 'deliveryThrown', source: e.id, dock: b.dock % docks.length });
      b = { ...b, ticks: 0, dock: (b.dock + 1) % docks.length, thrown: b.thrown + 1, stageThrown: b.stageThrown + 1, move: null };
    } else b = { ...b, move: { id: 'deliver', frame } };
    return done();
  }

  const t = b.ticks + 1;
  // The wait is measured to the start of the telegraph, so the whole rhythm is `everyTicks` per box.
  const wait = b.stageThrown === 0 ? d.startTicks : d.everyTicks - TELEGRAPH.tier1Ticks;
  if (t >= wait) {
    b = { ...b, ticks: 0, move: { id: 'deliver', frame: 1 } };
    events.push({ type: 'telegraph', source: e.id, tier: 1, move: 'deliver' });
  } else b = { ...b, ticks: t };
  return done();
}
