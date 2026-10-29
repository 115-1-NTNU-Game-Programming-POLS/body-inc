import { moveAndCollide, type Body, type SolidGrid } from '../collision/grid.ts';
import { BUFFER_TICKS, CLING, DODGE, FOLDER, HURT, STAMP, STAPLER } from './frames.ts';
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
  readonly stampPressed?: boolean;
  /** Swap the stapler and the folder; a press during an action waits for it to end (OperatorState.swapPending). */
  readonly swapPressed?: boolean;
  /** Talk to an NPC or use a bed; not buffered, since it is only meaningful while standing next to one. */
  readonly interactPressed?: boolean;
  /** A fresh press of up (-1) or down (1); only a conversation's choice reads it. */
  readonly menuStep?: -1 | 0 | 1;
  /** A reply picked by number key or click, counted from 1 (0 or absent: none); only a conversation's choice reads it. */
  readonly pick?: number;
}

export const NO_INPUT: TickInput = { move: { x: 0, y: 0 } };

/**
 * Dodge frames 1-13 move, 14-19 are recovery. Hurt frames 1-12 are knockback, after the freeze
 * (frame 0 means not started). Stamp frames 1 to STAMP.startupTicks raise it, and it lands on
 * the frame after (STAMP_LAND). A swing of the folder runs frames 1 to FOLDER.swingTicks and hits
 * on FOLDER.hitFrame; a guard runs while the attack key is held, frame 1 being the tick it was
 * raised. `frame` is the frame executed on the latest tick (frames.ts).
 */
export type OperatorAction =
  | { readonly kind: 'free' }
  | { readonly kind: 'dodge'; readonly frame: number; readonly dir: Vec; readonly perfect: boolean }
  | { readonly kind: 'hurt'; readonly frame: number; readonly dir: Vec }
  | { readonly kind: 'stamp'; readonly frame: number }
  | { readonly kind: 'swing'; readonly frame: number; readonly combo: number }
  | { readonly kind: 'guard'; readonly frame: number };

/** The tool in hand: the stapler, or the folder once the chapter has handed it over (design doc 6.1). */
export type HeldTool = 'stapler' | 'folder';

export interface OperatorState {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly facing: Facing;
  /** Unit vector of the last stick direction; staples fly along it unless soft lock applies. */
  readonly aim: Vec;
  /** Visible slow sources other than clinging (syrup floor, status icons); capped in movement. */
  readonly slows: readonly number[];
  /** A slow the chapter sets from the body's state each tick (dizziness, design doc 7.7); kept apart from `slows` so neither overwrites the other. */
  readonly bodySlow?: number;
  /** Clinging stacks riding on the operator, each one a CLING.slowPerStack slow source. */
  readonly stacks: number;
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
  readonly bufferedStamp: number | null;
  /** Rejection gauge, 0 to STAMP.gaugeMax (design doc 5.4). */
  readonly gauge: number;
  readonly tool: HeldTool;
  /** Ticks the attack key has been held without a break, counted from the press; the guard needs FOLDER.holdTicks. */
  readonly held: number;
  /** Which swing of the string the next one is (0 to 2), valid while the tick is at most `comboUntil`. */
  readonly combo: number;
  readonly comboUntil: number;
  /** Attacks and the guard wait until this tick after a swap. */
  readonly swapUntil: number;
  /**
   * A swap pressed during an action or hit-stop, done on the next free tick (design doc 5.3: input
   * is buffered, not eaten). It does not expire, since a swap is deliberate, and a second press
   * before then takes it back, so every press is one flip.
   */
  readonly swapPending: boolean;
  /** Tick of the press that made the swap pending, so an attack pressed before it goes first. */
  readonly swapAt: number;
}

/** Operator feet box: narrower than the 32 px frame so doorways two tiles wide feel roomy. */
export const OPERATOR_BODY: Body = { halfW: 7, height: 10 };
/** Where enemy attacks land on the ground plane; a little smaller than the body. */
export const OPERATOR_HURT: Body = { halfW: 6, height: 9 };

const DODGE_STEP = DODGE.distancePx / DODGE.ticks;
const DODGE_LAST = DODGE.ticks + DODGE.recoveryTicks;
const KNOCK_STEP = HURT.knockbackPx / HURT.knockbackTicks;
/** The stamp lands on the frame after its startup, so every startup frame is invincible. */
export const STAMP_LAND = STAMP.startupTicks + 1;

export function newOperator(x: number, y: number, maxHalves: number, gauge = 0): OperatorState {
  return {
    x, y, vx: 0, vy: 0, facing: 'down', aim: { x: 0, y: 1 }, slows: [], stacks: 0, halves: maxHalves, maxHalves,
    action: { kind: 'free' }, dodgeReadyAt: 0, invulnUntil: 0, shotReadyAt: 0, nextShotAt: null,
    bufferedAttack: null, bufferedDodge: null, bufferedStamp: null, gauge,
    tool: 'stapler', held: 0, combo: 0, comboUntil: 0, swapUntil: 0, swapPending: false, swapAt: 0,
  };
}

const live = (at: number | null, now: number): boolean => at !== null && now - at <= BUFFER_TICKS;

export function unit(v: Vec): Vec {
  const len = Math.hypot(v.x, v.y);
  return len === 0 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
}

/** Records presses; used every tick, including frozen ones, so input during hit-stop counts. */
export function bufferInput(op: OperatorState, input: TickInput, now: number): OperatorState {
  if (!input.attackPressed && !input.dodgePressed && !input.stampPressed && !input.swapPressed) return op;
  return {
    ...op,
    swapPending: input.swapPressed ? !op.swapPending : op.swapPending,
    swapAt: input.swapPressed && !op.swapPending ? now : op.swapAt,
    bufferedAttack: input.attackPressed ? now : op.bufferedAttack,
    bufferedDodge: input.dodgePressed ? now : op.bufferedDodge,
    // A press without a full gauge does nothing and is not kept, or it would fire by itself once
    // the gauge filled inside the buffer window.
    bufferedStamp: input.stampPressed && gaugeFull(op) ? now : op.bufferedStamp,
  };
}

/** The single definition of dodge i-frames; hit tests, perfect dodges and the view all use it. */
export function inDodgeIframes(a: OperatorAction): a is Extract<OperatorAction, { kind: 'dodge' }> {
  return a.kind === 'dodge' && a.frame >= DODGE.iframeFirst && a.frame <= DODGE.iframeLast;
}

export function isInvincible(op: OperatorState, now: number): boolean {
  return inDodgeIframes(op.action) || op.action.kind === 'stamp' || now < op.invulnUntil;
}

export const gaugeFull = (op: OperatorState): boolean => op.gauge >= STAMP.gaugeMax;

export interface OperatorStep {
  readonly op: OperatorState;
  /** True when a staple leaves the stapler this tick. */
  readonly fired: boolean;
  readonly dodged: boolean;
  /** The stamp was raised this tick (its frame 1). */
  readonly stampRaised?: boolean;
  /** The stamp comes down this tick; game.ts resolves what it covers. */
  readonly stampLanded?: boolean;
  /** A swing of the folder began this tick; the number is its place in the string, 0 to 2. */
  readonly swung?: number;
  /** The swing's box exists this tick (FOLDER.hitFrame); game.ts resolves what it covers. */
  readonly swingHit?: number;
  /** The guard was raised this tick (its frame 1). */
  readonly guardRaised?: boolean;
  /** The tool in hand after a swap this tick. */
  readonly swapped?: HeldTool;
  readonly blockedX: boolean;
  readonly blockedY: boolean;
}

/**
 * A key held since the press raises the guard instead of swinging again: from FOLDER.holdTicks on,
 * unless a fresh press is waiting in the buffer, which starts the next swing of the string.
 */
const wantsGuard = (op: OperatorState, input: TickInput, now: number): boolean =>
  op.tool === 'folder' && input.attack === true && op.held >= FOLDER.holdTicks && !live(op.bufferedAttack, now);

/**
 * A pending swap waits while an attack pressed before it is still to be done with the tool in
 * hand: a buffered press older than the swap, or a staple already on its way out.
 */
const attackFirst = (op: OperatorState, now: number): boolean =>
  (live(op.bufferedAttack, now) && op.bufferedAttack! < op.swapAt) || (op.tool === 'stapler' && op.nextShotAt !== null);

/**
 * Puts the other tool in hand. The drawer then keeps attacks and the guard waiting for
 * FOLDER.swapTicks, unless a dodge cancels it (design doc 6.1: 可被閃身取消).
 */
function swapTool(op: OperatorState, now: number, drawer: boolean): OperatorState {
  const tool: HeldTool = op.tool === 'folder' ? 'stapler' : 'folder';
  return { ...op, tool, swapPending: false, nextShotAt: null, swapUntil: drawer ? now + FOLDER.swapTicks : now };
}

/** Advances the operator one unfrozen tick. `now` is the tick being simulated. */
export function stepOperator(grid: SolidGrid, op0: OperatorState, input: TickInput, now: number): OperatorStep {
  let op = bufferInput(op0, input, now);
  const held = input.attack === true ? op.held + 1 : 0;
  if (held !== op.held) op = { ...op, held };
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
    // A swap pressed mid-dodge happens at once, the dodge having cancelled the drawer.
    const swap = op.swapPending && !attackFirst(op, now);
    if (swap) op = swapTool(op, now, false);
    return { ...stepDodge(grid, op, a, a.frame + 1, now), fired: false, dodged: false, ...(swap ? { swapped: op.tool } : {}) };
  }
  if (a.kind === 'stamp' && a.frame < STAMP_LAND) {
    const frame = a.frame + 1;
    return {
      op: { ...op, vx: 0, vy: 0, action: { kind: 'stamp', frame } },
      fired: false, dodged: false, stampLanded: frame === STAMP_LAND, blockedX: false, blockedY: false,
    };
  }
  // A swing stands still for its frames. Once its box has landed the rest is recovery: a dodge
  // cancels it (design doc 5.3), and a key held since the press turns it into the guard, so a
  // parry does not wait for the whole swing to play out.
  const cancelled = a.kind === 'swing' && a.frame >= FOLDER.hitFrame
    && ((live(op.bufferedDodge, now) && now >= op.dodgeReadyAt) || wantsGuard(op, input, now));
  if (a.kind === 'swing' && a.frame < FOLDER.swingTicks && !cancelled) {
    const frame = a.frame + 1;
    return {
      op: { ...op, vx: 0, vy: 0, action: { ...a, frame } },
      fired: false, dodged: false, ...(frame === FOLDER.hitFrame ? { swingHit: a.combo } : {}), blockedX: false, blockedY: false,
    };
  }
  const keepGuard = a.kind === 'guard' && op.tool === 'folder' && input.attack === true;
  if (a.kind !== 'free' && !keepGuard) op = { ...op, action: { kind: 'free' } };

  // Free: a dodge takes priority over firing and cancels a pending staple (recovery is cancelable).
  if (live(op.bufferedDodge, now) && now >= op.dodgeReadyAt) {
    const stick = unit(input.move);
    const dir = stick.x === 0 && stick.y === 0 ? op.aim : stick;
    // A drawer already flipping needs no cancelling here: the dodge outlasts it (DODGE vs FOLDER.swapTicks).
    const swap = op.swapPending && !attackFirst({ ...op, nextShotAt: null }, now);
    let started: OperatorState = {
      ...op, bufferedDodge: null, nextShotAt: null, aim: dir, facing: facingFor(dir, op.facing),
    };
    if (swap) started = swapTool(started, now, false);
    return {
      ...stepDodge(grid, started, { kind: 'dodge', frame: 0, dir, perfect: false }, 1, now), fired: false, dodged: true,
      ...(swap ? { swapped: started.tool } : {}),
    };
  }

  // The whole gauge is spent on the press, whatever the stamp later covers (design doc 5.4).
  if (live(op.bufferedStamp, now) && gaugeFull(op)) {
    return {
      op: { ...op, bufferedStamp: null, nextShotAt: null, gauge: 0, vx: 0, vy: 0, action: { kind: 'stamp', frame: 1 } },
      fired: false, dodged: false, stampRaised: true, blockedX: false, blockedY: false,
    };
  }

  // A swap puts the other tool in hand at once. It only keeps attacks and the guard waiting (the
  // drawer flips for 0.15 s), so walking and dodging go on.
  let swapped: HeldTool | undefined;
  if (op.swapPending && !attackFirst(op, now)) {
    op = { ...swapTool(op, now, true), action: { kind: 'free' } };
    swapped = op.tool;
  }
  const lockout = now < op.swapUntil;

  if (op.tool === 'folder' && !lockout && !keepGuard && live(op.bufferedAttack, now)) {
    const index = now <= op.comboUntil ? op.combo : 0;
    const stick = unit(input.move);
    const aim = stick.x === 0 && stick.y === 0 ? op.aim : stick;
    return {
      op: {
        ...op, bufferedAttack: null, vx: 0, vy: 0, aim, facing: facingFor(aim, op.facing),
        action: { kind: 'swing', frame: 1, combo: index },
        combo: (index + 1) % FOLDER.damage.length,
        comboUntil: now + FOLDER.swingTicks + FOLDER.comboGapTicks,
      },
      fired: false, dodged: false, swung: index, ...(swapped ? { swapped } : {}), blockedX: false, blockedY: false,
    };
  }
  const guard = swapped === undefined && op.tool === 'folder' && (keepGuard || (!lockout && wantsGuard(op, input, now)));

  // A shot is scheduled only once its startup fits before shotReadyAt, so releasing the key
  // mid-volley stops the volley instead of leaving a shot queued for the next cycle.
  let { nextShotAt, shotReadyAt, bufferedAttack } = op;
  let fired = false;
  if (op.tool === 'stapler' && !lockout) {
    const lead = STAPLER.startupFrame - 1;
    const wants = input.attack === true || live(bufferedAttack, now);
    if (nextShotAt === null && wants && now + lead >= shotReadyAt) {
      nextShotAt = now + lead;
      bufferedAttack = null;
    }
    if (nextShotAt !== null && now >= nextShotAt) {
      fired = true;
      shotReadyAt = now + STAPLER.intervalTicks;
      nextShotAt = null;
    }
  }

  const stick = unit(input.move);
  const aim = stick.x === 0 && stick.y === 0 ? op.aim : stick;
  const factor = guard ? FOLDER.guardSpeedFactor : op.tool === 'stapler' && input.attack === true ? STAPLER.holdSpeedFactor : 1;
  const want = desiredVelocity(input.move, [...op.slows, ...(op.bodySlow ? [op.bodySlow] : []), ...Array<number>(op.stacks).fill(CLING.slowPerStack)]);
  const v = approach({ x: op.vx, y: op.vy }, { x: want.x * factor, y: want.y * factor });
  const m = moveAndCollide(grid, OPERATOR_BODY, op.x, op.y, v.x, v.y);
  const guardFrame = a.kind === 'guard' && keepGuard ? a.frame + 1 : 1;
  return {
    op: {
      ...op, x: m.x, y: m.y, vx: m.blockedX ? 0 : v.x, vy: m.blockedY ? 0 : v.y,
      facing: facingFor(input.move, op.facing), aim, nextShotAt, shotReadyAt, bufferedAttack,
      action: guard ? { kind: 'guard', frame: guardFrame } : op.action,
    },
    fired,
    dodged: false,
    ...(guard && !keepGuard ? { guardRaised: true } : {}),
    ...(swapped ? { swapped } : {}),
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
