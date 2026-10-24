import { moveAndCollide, type Body } from './collision/grid.ts';
import { approach, desiredVelocity, facingFor, type Facing, type Vec } from './combat/movement.ts';
import { seedStreams, type RngStreams } from './rng.ts';
import { playerStart, type RoomModel } from './rooms/tiled.ts';

/** Player intent for one tick, produced by the input adapter (keys and bindings never reach core). */
export interface TickInput {
  readonly move: Vec;
}

export const NO_INPUT: TickInput = { move: { x: 0, y: 0 } };

export interface OperatorState {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly facing: Facing;
  /** Visible slow sources (adenosine stacks, syrup floor); capped in movement. */
  readonly slows: readonly number[];
}

export interface GameState {
  readonly tick: number;
  readonly rng: RngStreams;
  readonly room: RoomModel;
  readonly operator: OperatorState;
}

/** Something that happened this tick; the view maps these to feedback through content data. */
export type DomainEvent =
  | { readonly type: 'bumpWall'; readonly axis: 'x' | 'y' };

export interface StepResult {
  readonly state: GameState;
  readonly events: readonly DomainEvent[];
}

/** Operator feet box: narrower than the 32 px frame so doorways two tiles wide feel roomy. */
export const OPERATOR_BODY: Body = { halfW: 7, height: 10 };

export function createGame(room: RoomModel, seed: number): GameState {
  const start = playerStart(room);
  return {
    tick: 0,
    rng: seedStreams(seed),
    room,
    operator: { x: start.x, y: start.y, vx: 0, vy: 0, facing: 'down', slows: [] },
  };
}

export function step(state: GameState, input: TickInput): StepResult {
  const events: DomainEvent[] = [];
  const op = state.operator;
  const v = approach({ x: op.vx, y: op.vy }, desiredVelocity(input.move, op.slows));
  const moved = moveAndCollide(state.room.grid, OPERATOR_BODY, op.x, op.y, v.x, v.y);
  // Attempted velocity, not last tick's: a blocked move zeroes the stored velocity.
  if (moved.blockedX && v.x !== 0) events.push({ type: 'bumpWall', axis: 'x' });
  if (moved.blockedY && v.y !== 0) events.push({ type: 'bumpWall', axis: 'y' });
  const operator: OperatorState = {
    ...op,
    x: moved.x,
    y: moved.y,
    vx: moved.blockedX ? 0 : v.x,
    vy: moved.blockedY ? 0 : v.y,
    facing: facingFor(input.move, op.facing),
  };
  return { state: { ...state, tick: state.tick + 1, operator }, events };
}

export const selectOperator = (s: GameState): Readonly<OperatorState> => s.operator;
export const selectTick = (s: GameState): number => s.tick;
