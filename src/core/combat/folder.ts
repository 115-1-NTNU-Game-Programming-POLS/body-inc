import { centeredBox, type Box } from '../collision/boxes.ts';
import { FOLDER } from './frames.ts';
import type { Vec } from './movement.ts';
import type { OperatorAction, OperatorState } from './operator.ts';

const COS_GUARD = Math.cos((FOLDER.guardHalfAngleDeg * Math.PI) / 180);

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
 * Whether the guard faces an attack that comes from `from`, a vector pointing from the operator
 * towards the attacker (for a shot, against its velocity). The guard covers 120 degrees around
 * the aim; the limit itself is covered.
 */
export function guardCovers(aim: Vec, from: Vec): boolean {
  const len = Math.hypot(from.x, from.y);
  if (len === 0) return true;
  return (from.x * aim.x + from.y * aim.y) / len >= COS_GUARD - 1e-9;
}

/** The guard's frame counts from 1 on the tick it is raised; frames up to FOLDER.parryFrames parry. */
export const parryOpen = (a: OperatorAction): a is Extract<OperatorAction, { kind: 'guard' }> =>
  a.kind === 'guard' && a.frame <= FOLDER.parryFrames;

export const guarding = (a: OperatorAction): a is Extract<OperatorAction, { kind: 'guard' }> => a.kind === 'guard';
