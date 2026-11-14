import type { DomainEvent } from '../../game.ts';
import type { EnemyState } from '../actors.ts';
import { TELEGRAPH } from '../frames.ts';
import type { ShotSpec } from '../hazards.ts';
import type { Vec } from '../movement.ts';
import type { SnackDef, SnackDelivery, SnackSleep, SnackState } from './boss.ts';
import type { MixerState, Portion } from '../../stomach/mixer.ts';

export interface SnackTick {
  readonly enemy: EnemyState;
  readonly shots: readonly ShotSpec[];
  readonly events: readonly DomainEvent[];
}

/** Half the side of a delivery's box, in pixels; the large portion is a bigger box. */
export const DELIVERY_HALF: Readonly<Record<Portion, number>> = { small: 6, normal: 6, large: 9 };

export const deliveryOfStage = (def: SnackDef, stage: number): SnackDelivery => (stage >= 3 ? def.stage3 : stage === 2 ? def.stage2 : def);

/** How far the stage-3 sleep bar has filled, 0 to 1. */
export const sleepShare = (def: SnackDef, sleep: SnackSleep): number => Math.min(1, sleep.slept / def.stage3.sleepTicks);

/**
 * His weak spot (design doc 7.5, 熄燈): in stage 3, with the sleep bar full and nothing in the mixer, he
 * is no longer kept up by the stomach's overtime and the stamp closes the case.
 */
export function snackExposed(def: SnackDef, b: SnackState, mixer: MixerState | undefined): boolean {
  return b.stage === 3 && b.sleep !== undefined && b.sleep.slept >= def.stage3.sleepTicks && (mixer?.batches.length ?? 0) === 0;
}

/** The lowest his budget may fall in his present stage: before the lights out, never past the start of it. */
export const snackFloor = (def: SnackDef, b: SnackState): number => (b.stage < 3 ? def.stage3.budget : 0);

/**
 * One tick of the stage-3 bar. An interruption wins over filling on the same tick, and a full bar stays
 * full: the doc only lets the stomach wake him, never undo the sleep (7.5).
 */
function stepSleepBar(def: SnackDef, sleep: SnackSleep, digested: number, e: EnemyState, events: DomainEvent[]): SnackSleep {
  const need = def.stage3.sleepTicks;
  if (sleep.slept >= need) return sleep;
  if (digested > 0) {
    const wakes = sleep.wakes + 1;
    events.push({ type: 'snackWoken', target: e.id, wakes });
    return { ...sleep, hold: def.stage3.interruptTicks, wakes };
  }
  if (sleep.hold > 0) return { ...sleep, hold: sleep.hold - 1 };
  const slept = sleep.slept + 1;
  if (slept >= need) events.push({ type: 'snackRested', target: e.id });
  return { ...sleep, slept };
}

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

/**
 * One tick of the stomach boss (design doc 7.5): he calls the docks one after another and a food box
 * flies from each at the mixer's hopper. `digested` is how many of his boxes the mixer finished this
 * tick, which interrupt the sleep bar of stage 3. The rules and the numbers are in
 * docs/authoring/rooms-and-dialogue.md.
 */
export function stepSnack(e: EnemyState, def: SnackDef, docks: readonly Vec[], mouth: Vec, digested = 0): SnackTick {
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
  if (b.stage === 2 && !b.move && e.hp <= def.stage3.budget) {
    b = { ...b, stage: 3, ticks: 0, stageThrown: 0, sleep: { slept: 0, hold: 0, wakes: 0 } };
    events.push({ type: 'snackStage', target: e.id, stage: 3 });
    return done();
  }
  if (b.sleep) b = { ...b, sleep: stepSleepBar(def, b.sleep, digested, e, events) };
  const d = deliveryOfStage(def, b.stage);

  if (b.move) {
    const frame = b.move.frame + 1;
    if (frame > TELEGRAPH.tier1Ticks) {
      shots.push(deliveryFrom(e, d, docks[b.dock % docks.length]!, mouth));
      events.push({ type: 'deliveryThrown', source: e.id, dock: b.dock % docks.length });
      b = { ...b, ticks: 0, dock: (b.dock + 1) % docks.length, stageThrown: b.stageThrown + 1, move: null };
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
