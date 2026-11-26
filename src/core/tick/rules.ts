import { type Box } from '../collision/boxes.ts';
import { stepEnemy, type EnemyState } from '../combat/actors.ts';
import { type BossDef } from '../combat/bosses/boss.ts';
import { snackFloor } from '../combat/bosses/snack.ts';
import { breathing } from '../combat/bosses/toast.ts';
import { BOSS, STAMP } from '../combat/frames.ts';
import { circleTouchesBox } from '../combat/hazards.ts';
import type { Vec } from '../combat/movement.ts';
import { gaugeFull, type HeldTool, type OperatorState } from '../combat/operator.ts';
import { type BoxState } from '../rooms/boxes.ts';
import type { EnteredRoom } from '../rooms/entry.ts';
import { boxCentre, isSpawnedCrate, MIST } from '../liver/factory.ts';
import { type RoomObject } from '../rooms/tiled.ts';
import type { DomainEvent } from '../game.ts';

/** How a weapon reaches an enemy, for the shield of a manager: where it comes from, and what it can break. */
export interface Strike {
  /** A vector from the target towards the attacker; for a shot, against its velocity. */
  readonly from: Vec;
  readonly breaks: 'reflect' | 'folder' | undefined;
}

/** Reveal switches the highlighter has not lit yet (issue #76): their objects are not there for the player. */
export const unrevealed = (room: Pick<EnteredRoom, 'objects'>, switches: readonly number[]): RoomObject[] =>
  room.objects.filter((o) => o.kind === 'Switch' && o.props['mode'] === 'reveal' && !switches.includes(o.id));

/** A clinging stack goes back to where it spawned and reforms there; nothing is removed. */
export const stackHome = (e: EnemyState): EnemyState =>
  e.phase === 'attached' ? { ...e, phase: 'dispersed', phaseTicks: 0, x: e.homeX, y: e.homeY } : e;

export const stackCount = (enemies: Iterable<EnemyState>, carried: number): number =>
  carried + [...enemies].filter((e) => e.phase === 'attached').length;

export function withStacks(op: OperatorState, enemies: Iterable<EnemyState>, carried: number): OperatorState {
  const stacks = stackCount(enemies, carried);
  return op.stacks === stacks ? op : { ...op, stacks };
}

/** Adds charge times P; rounded so that 125 staples at P = 1 fill the gauge exactly. */
export function charge(op: OperatorState, amount: number, p: number, events: DomainEvent[]): OperatorState {
  if (gaugeFull(op)) return op;
  const gauge = Math.min(STAMP.gaugeMax, Math.round((op.gauge + amount * p) * 1e6) / 1e6);
  if (gauge >= STAMP.gaugeMax) events.push({ type: 'gaugeFull' });
  return { ...op, gauge };
}

/** How much a hit on a boss counts: 1.5 times under review (design doc 5.4), the toast boss's breath factor while he breathes (7.7). */
function bossFactor(e: EnemyState, bosses: Readonly<Record<string, BossDef>>): number {
  const b = e.boss;
  if (!b) return 1;
  if (b.behaviour === 'caffeine') return b.review > 0 ? BOSS.reviewDamageFactor : 1;
  if (b.behaviour !== 'toast') return 1;
  const def = bosses[b.def]!;
  return def.behaviour === 'toast' && breathing(b) ? def.breathDamageFactor : 1;
}

/**
 * Damage to a defeatable enemy. A boss has no hit-stop; the hit-stop of any other enemy does not
 * stretch its telegraph either (`stepEnemy`).
 * The toast boss is not beaten when his budget runs out: he gives up (design doc 7.7).
 */
export function damage(e: EnemyState, amount: number, freeze: number, events: DomainEvent[], bosses: Readonly<Record<string, BossDef>>): EnemyState {
  const def = e.boss ? bosses[e.boss.def] : undefined;
  // Before his lights out the stomach boss holds at its budget, so every fight reaches the stage the stamp ends.
  const floor = def?.behaviour === 'snack' && e.boss?.behaviour === 'snack' ? snackFloor(def, e.boss) : 0;
  const hp = Math.max(floor, Math.round((e.hp - amount * bossFactor(e, bosses)) * 1e6) / 1e6);
  // Already at the floor, waiting for a telegraph to finish before his next stage: the blow takes nothing, so it is no hit.
  if (floor > 0 && amount > 0 && hp >= e.hp) {
    events.push({ type: 'snackShrugged', target: e.id });
    return e;
  }
  if (hp <= 0) {
    if (e.boss?.behaviour === 'toast') {
      events.push({ type: 'bossConceded', target: e.id, enemy: e.type });
      return { ...e, hp: 0, phase: 'closed', phaseTicks: 0, frozen: 0, boss: { ...e.boss, move: null } };
    }
    if (e.boss) {
      events.push({ type: 'bossDefeated', target: e.id, enemy: e.type });
      return { ...e, hp: 0, phase: 'closed', phaseTicks: 0, frozen: 0, boss: { ...e.boss, move: null } };
    }
    events.push({ type: 'caseClosed', target: e.id, enemy: e.type });
    return { ...e, hp: 0, phase: 'closed', phaseTicks: 0, frozen: 0 };
  }
  events.push({ type: 'hit', target: e.id, enemy: e.type, hpLeft: hp });
  // A hit never cuts short a longer freeze already running, such as a parry's stun or the stamp's.
  return { ...e, hp, frozen: e.boss ? 0 : Math.max(e.frozen, freeze) };
}

/** Whether a hurtbox touches the fog of any acetaldehyde crate (design doc 7.7). */
export const inMist = (boxes: readonly BoxState[], hurt: Box): boolean =>
  boxes.some((b) => isSpawnedCrate(b) && circleTouchesBox(boxCentre(b).x, boxCentre(b).y, MIST.radiusPx, hurt));

/** The tools the swap key cycles through, in the order it visits them (issue #76, decision 2). */
export function handOf(s: { readonly folderLocked?: boolean | undefined; readonly highlighter?: boolean | undefined }): readonly HeldTool[] {
  if (s.highlighter) return s.folderLocked ? ['stapler', 'highlighter'] : ['stapler', 'folder', 'highlighter'];
  return s.folderLocked ? ['stapler'] : ['stapler', 'folder'];
}
