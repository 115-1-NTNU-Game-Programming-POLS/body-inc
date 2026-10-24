import { moveAndCollide, type Body, type SolidGrid } from '../collision/grid.ts';
import { BUFFER_TICKS, DODGE, HURT, STAPLER } from './frames.ts';
import { approach, desiredVelocity, facingFor, type Facing, type Vec } from './movement.ts';

/**
 * Player intent for one tick, produced by the input adapter (keys never reach core).
 * `attack` is the held state; the *Pressed fields are true when the key went down since the
 * previous tick, so a tap shorter than a tick is not lost.
 */
export interface TickInput {
  readonly move: Vec;
  readonly attack?: boolean;
  readonly attackPressed?: boolean;
  readonly dodgePressed?: boolean;
}

export const NO_INPUT: TickInput = { move: { x: 0, y: 0 } };

/**
 * Dodge frames 1-13 move, 14-19 are recovery. Hurt frames 1-12 are knockback, after the freeze\n * (frame 0 means not started). rame is the frame executed on the latest tick (frames.ts).
 */
export type OperatorAction =
  | { readonly kind: 'free' }
  | { readonly kind: 'dodge'; readonly frame: number; readonly dir: Vec; readonly perfect: boolean }
  | { readonly kind: 'hurt'; readonly frame: number; readonly dir: Vec };

export interface OperatorState {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly facing: Facing;
  /** Unit vector of the last stick direction; staples fly along it unless soft lock applies. */
  readonly aim: Vec;
  /** Visible slow sources (adenosine stacks, syrup floor); capped in movement. */
  readonly slows: readonly number[];
  readonly halves: number;
  readonly maxHalves: number;
  readonly action: OperatorAction;
  readonly dodgeReadyAt: number;
  /** Hurt invulnerability lasts while tick < invulnUntil. Dodge i-frames are separate. */
  readonly invulnUntil: number;
  readonly shotReadyAt: number;
  /** Tick on which the next staple spawns; null when not firing. */
  readonly nextShotAt: number | null;
  /** Tick a press was buffered on; null when nothing is waiting (design doc 5.3, 0.35 s). */
  readonly bufferedAttack: number | null;
  readonly bufferedDodge: number | null;
}

/** Operator feet box: narrower than the 32 px frame so doorways two tiles wide feel roomy. */
export const OPERATOR_BODY: Body = { halfW: 7, height: 10 };
/** Where enemy attacks land on the ground plane; a little smaller than the body. */
export const OPERATOR_HURT: Body = { halfW: 6, height: 9 };

const DODGE_STEP = DODGE.distancePx / DODGE.ticks;
const DODGE_LAST = DODGE.ticks + DODGE.recoveryTicks;
const KNOCK_STEP = HURT.knockbackPx / HURT.knockbackTicks;

export function newOperator(x: number, y: number, maxHalves: number): OperatorState {
  return {
    x, y, vx: 0, vy: 0, facing: 'down', aim: { x: 0, y: 1 }, slows: [], halves: maxHalves, maxHalves,
    action: { kind: 'free' }, dodgeReadyAt: 0, invulnUntil: 0, shotReadyAt: 0, nextShotAt: null,
    bufferedAttack: null, bufferedDodge: null,
  };
}

const live = (at: number | null, now: number): boolean => at !== null && now - at <= BUFFER_TICKS;

export function unit(v: Vec): Vec {
  const len = Math.hypot(v.x, v.y);
  return len === 0 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
}

/** Records presses; used every tick, including frozen ones, so input during hit-stop counts. */
export function bufferInput(op: OperatorState, input: TickInput, now: number): OperatorState {
  if (!input.attackPressed && !input.dodgePressed) return op;
  return {
    ...op,
    bufferedAttack: input.attackPressed ? now : op.bufferedAttack,
    bufferedDodge: input.dodgePressed ? now : op.bufferedDodge,
  };
}

export function isInvincible(op: OperatorState, now: number): boolean {
  const a = op.action;
  if (a.kind === 'dodge' && a.frame >= DODGE.iframeFirst && a.frame <= DODGE.iframeLast) return true;
  return now < op.invulnUntil;
}

export interface OperatorStep {
  readonly op: OperatorState;
  /** True when a staple leaves the stapler this tick. */
  readonly fired: boolean;
  readonly dodged: boolean;
  readonly blockedX: boolean;
  readonly blockedY: boolean;
}

/** Advances the operator one unfrozen tick. `now` is the tick being simulated. */
export function stepOperator(grid: SolidGrid, op0: OperatorState, input: TickInput, now: number): OperatorStep {
  let op = bufferInput(op0, input, now);
  const a = op.action;

  // An action that ran its last frame on the previous tick ends here, and this tick is free.
  if (a.kind === 'hurt' && a.frame < HURT.knockbackTicks) {
    const m = moveAndCollide(grid, OPERATOR_BODY, op.x, op.y, a.dir.x * KNOCK_STEP, a.dir.y * KNOCK_STEP);
    return {
      op: { ...op, x: m.x, y: m.y, vx: 0, vy: 0, action: { ...a, frame: a.frame + 1 } },
      fired: false, dodged: false, blockedX: false, blockedY: false,
    };
  }
  if (a.kind === 'dodge' && a.frame < DODGE_LAST) {
    return { ...stepDodge(grid, op, a, a.frame + 1, now), fired: false, dodged: false };
  }
  if (a.kind !== 'free') op = { ...op, action: { kind: 'free' } };

  // Free: a dodge takes priority over firing and cancels a pending staple (recovery is cancelable).
  if (live(op.bufferedDodge, now) && now >= op.dodgeReadyAt) {
    const stick = unit(input.move);
    const dir = stick.x === 0 && stick.y === 0 ? op.aim : stick;
    const started: OperatorState = {
      ...op, bufferedDodge: null, nextShotAt: null, aim: dir, facing: facingFor(dir, op.facing),
    };
    return { ...stepDodge(grid, started, { kind: 'dodge', frame: 0, dir, perfect: false }, 1, now), fired: false, dodged: true };
  }

  // A shot is scheduled only once its startup fits before shotReadyAt, so releasing the key
  // mid-volley stops the volley instead of leaving a shot queued for the next cycle.
  let { nextShotAt, shotReadyAt, bufferedAttack } = op;
  const lead = STAPLER.startupFrame - 1;
  const wants = input.attack === true || live(bufferedAttack, now);
  if (nextShotAt === null && wants && now + lead >= shotReadyAt) {
    nextShotAt = now + lead;
    bufferedAttack = null;
  }
  let fired = false;
  if (nextShotAt !== null && now >= nextShotAt) {
    fired = true;
    shotReadyAt = now + STAPLER.intervalTicks;
    nextShotAt = null;
  }

  const stick = unit(input.move);
  const aim = stick.x === 0 && stick.y === 0 ? op.aim : stick;
  const factor = input.attack === true ? STAPLER.holdSpeedFactor : 1;
  const want = desiredVelocity(input.move, op.slows);
  const v = approach({ x: op.vx, y: op.vy }, { x: want.x * factor, y: want.y * factor });
  const m = moveAndCollide(grid, OPERATOR_BODY, op.x, op.y, v.x, v.y);
  return {
    op: {
      ...op, x: m.x, y: m.y, vx: m.blockedX ? 0 : v.x, vy: m.blockedY ? 0 : v.y,
      facing: facingFor(input.move, op.facing), aim, nextShotAt, shotReadyAt, bufferedAttack,
    },
    fired,
    dodged: false,
    blockedX: m.blockedX && v.x !== 0,
    blockedY: m.blockedY && v.y !== 0,
  };
}

/** Runs dodge frame `frame`; the stored action records it so hit checks this tick see it. */
function stepDodge(grid: SolidGrid, op: OperatorState, a: Extract<OperatorAction, { kind: 'dodge' }>, frame: number, now: number) {
  const moving = frame <= DODGE.ticks;
  const m = moving
    ? moveAndCollide(grid, OPERATOR_BODY, op.x, op.y, a.dir.x * DODGE_STEP, a.dir.y * DODGE_STEP)
    : { x: op.x, y: op.y, blockedX: false, blockedY: false };
  const done = frame >= DODGE_LAST;
  const next: OperatorState = {
    ...op,
    x: m.x, y: m.y,
    vx: moving ? a.dir.x * DODGE_STEP : 0,
    vy: moving ? a.dir.y * DODGE_STEP : 0,
    action: { ...a, frame },
    dodgeReadyAt: done ? now + 1 + DODGE.cooldownTicks : op.dodgeReadyAt,
  };
  return { op: next, blockedX: false, blockedY: false };
}

/** Applies a hit that `isInvincible` let through. Knockback points away from the attacker. */
export function hurtOperator(op: OperatorState, halves: number, from: Vec, now: number): OperatorState {
  const away = unit({ x: op.x - from.x, y: op.y - from.y });
  const dir = away.x === 0 && away.y === 0 ? { x: 0, y: 1 } : away;
  return {
    ...op,
    halves: Math.max(0, op.halves - halves),
    action: { kind: 'hurt', frame: 0, dir },
    invulnUntil: now + 1 + HURT.freezeTicks + HURT.knockbackTicks + HURT.invulnTicks,
    nextShotAt: null,
    vx: 0,
    vy: 0,
  };
}
