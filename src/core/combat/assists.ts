import type { OperatorState } from './operator.ts';

/**
 * The "flexible hours" assists that change a fight (design doc 5.7). They are input to a tick, not
 * state, so the player can switch one on or off at any moment and a replayed input log carries them.
 * None of them touches a physiological rule: hearts are the operator's working conditions, and the
 * body in the tags never sees them.
 */
export interface Assists {
  /** A hit costs half as much; the half of a half-heart that does not fit is owed to the next hit. */
  readonly halfDamage: boolean;
  /** Hearts stop at one half, so no hit ends a run in a forced leave. */
  readonly neverEmpty: boolean;
  /** A dodge that absorbs a hit is always a perfect dodge, however late in its i-frames. */
  readonly autoPerfect: boolean;
}

export const NO_ASSISTS: Assists = { halfDamage: false, neverEmpty: false, autoPerfect: false };

/**
 * What a hit of `halves` costs and what is still owed. Damage is counted in quarter hearts, that
 * is half-halves: a hit of one half is one unit, and every two units cost one half, so two
 * half-heart hits cost one half together and a whole-heart hit costs one half at once.
 */
export function chip(halves: number, owed: 0 | 1, assists: Assists): { readonly cost: number; readonly owed: 0 | 1 } {
  if (!assists.halfDamage) return { cost: halves, owed };
  const units = halves + owed;
  return { cost: Math.floor(units / 2), owed: (units % 2) as 0 | 1 };
}

/** The operator with `owed` recorded; at 0 the key is dropped, so a paid-off debt and a plain run are the same state. */
export function owing(op: OperatorState, owed: 0 | 1): OperatorState {
  const { halfCarry: _, ...rest } = op;
  return owed === 0 ? rest : { ...rest, halfCarry: owed };
}
