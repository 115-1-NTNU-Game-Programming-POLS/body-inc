import { centeredBox, type Box } from '../collision/boxes.ts';
import { FOLDER } from './frames.ts';
import type { Vec } from './movement.ts';
import type { OperatorAction, OperatorState } from './operator.ts';

const cosOf = (halfAngleDeg: number): number => Math.cos((halfAngleDeg * Math.PI) / 180);

/** Where a swing lands: a box in front of the operator on the ground plane, along the aim. */
export function swingBox(op: Pick<OperatorState, 'x' | 'y' | 'aim'>): Box {
  return centeredBox(
    op.x + op.aim.x * FOLDER.swingReachPx,
    op.y - 8 + op.aim.y * FOLDER.swingReachPx * 0.8,
    FOLDER.swingHalfW,
    FOLDER.swingHalfH,
  );
}

/**
 * Whether a guard facing `aim` covers an attack that comes from `from`, a vector pointing from
 * the guard towards the attacker (for a shot, against its velocity). The operator's guard covers
 * 120 degrees around the aim; a manager's shield is the same cone. The limit itself is covered.
 */
export function guardCovers(aim: Vec, from: Vec, halfAngleDeg: number = FOLDER.guardHalfAngleDeg): boolean {
  const len = Math.hypot(from.x, from.y);
  if (len === 0) return true;
  return (from.x * aim.x + from.y * aim.y) / len >= cosOf(halfAngleDeg) - 1e-9;
}

/** The guard's frame counts from 1 on the tick it is raised; frames up to FOLDER.parryFrames parry. */
export const parryOpen = (a: OperatorAction): a is Extract<OperatorAction, { kind: 'guard' }> =>
  a.kind === 'guard' && a.frame <= FOLDER.parryFrames;

export const guarding = (a: OperatorAction): a is Extract<OperatorAction, { kind: 'guard' }> => a.kind === 'guard';
