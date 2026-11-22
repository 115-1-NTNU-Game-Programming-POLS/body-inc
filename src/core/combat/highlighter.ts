import type { Box } from '../collision/boxes.ts';
import type { EnemyState } from './actors.ts';
import { HIGHLIGHTER } from './frames.ts';
import type { Vec } from './movement.ts';
import type { OperatorState } from './operator.ts';

/** Where the line starts: the operator's hand, at the height a swing lands (folder.ts swingBox). */
const HAND_RISE = 8;
/** Points along the line are this far apart, under the narrowest hurtbox, so no enemy falls between two. */
const SAMPLE_PX = 4;

/** The line of the highlighter on the ground plane: from the hand along the aim, HIGHLIGHTER.lineLengthPx long. */
export function lineOf(op: Pick<OperatorState, 'x' | 'y' | 'aim'>): { readonly from: Vec; readonly to: Vec } {
  const from = { x: op.x, y: op.y - HAND_RISE };
  return { from, to: { x: from.x + op.aim.x * HIGHLIGHTER.lineLengthPx, y: from.y + op.aim.y * HIGHLIGHTER.lineLengthPx } };
}

/** Whether the line, HIGHLIGHTER.lineHalfW to each side, crosses `box`. It pierces, so every box it crosses counts. */
export function lineCrosses(op: Pick<OperatorState, 'x' | 'y' | 'aim'>, box: Box): boolean {
  const { from, to } = lineOf(op);
  const w = HIGHLIGHTER.lineHalfW;
  const steps = Math.ceil(HIGHLIGHTER.lineLengthPx / SAMPLE_PX);
  for (let i = 0; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    if (x >= box.left - w && x <= box.right + w && y >= box.top - w && y <= box.bottom + w) return true;
  }
  return false;
}

/** The centre of the circle on the ground plane, HIGHLIGHTER.circleReachPx ahead along the aim. */
export const circleCentre = (op: Pick<OperatorState, 'x' | 'y' | 'aim'>): Vec =>
  ({ x: op.x + op.aim.x * HIGHLIGHTER.circleReachPx, y: op.y + op.aim.y * HIGHLIGHTER.circleReachPx });

/** Whether an enemy stands in the circle: its feet within the radius of the centre, as the stamp judges. */
export const inCircle = (centre: Vec, e: Pick<EnemyState, 'x' | 'y'>): boolean =>
  Math.hypot(e.x - centre.x, e.y - centre.y) <= HIGHLIGHTER.circleRadiusPx;

/** Whether the highlighter's mark is on the enemy at tick `now`. */
export const isMarked = (e: Pick<EnemyState, 'markedUntil'>, now: number): boolean => e.markedUntil !== undefined && now < e.markedUntil;
