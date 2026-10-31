import { playDay } from './semester.ts';
import type { DayView, FloorChoice, MorningPlan, NightPlan, SemesterContext, SemesterState, Strategy } from './types.ts';

/**
 * A question the day puts to the player, in the order `playDay` asks a strategy. `view` is the same
 * DayView a strategy gets, so a screen built on it sees lights and clues and never a floor load.
 */
export type Ask =
  | { readonly kind: 'plan'; readonly view: DayView }
  | { readonly kind: 'event'; readonly view: DayView; readonly id: string; readonly options: readonly string[] }
  | { readonly kind: 'floor'; readonly view: DayView }
  | { readonly kind: 'night'; readonly view: DayView };

export type Answer =
  | { readonly kind: 'plan'; readonly plan: MorningPlan }
  | { readonly kind: 'event'; readonly option: string }
  | { readonly kind: 'floor'; readonly choice: FloorChoice }
  | { readonly kind: 'night'; readonly plan: NightPlan };

export type DayStep =
  | { readonly done: false; readonly ask: Ask }
  | { readonly done: true; readonly state: SemesterState };

/** Thrown from inside the day to stop it at the first question the answers so far do not cover. */
class Unanswered extends Error {
  readonly ask: Ask;

  constructor(ask: Ask) {
    super(`the day is waiting for an answer to "${ask.kind}"`);
    this.ask = ask;
  }
}

/**
 * Plays one day with the answers given so far. `playDay` is a pure function of the state, so a day
 * that is not finished is simply played again from its start with one more answer, which keeps the
 * rules in one place: a person at the elevator and a strategy in `sim/` run the same code. Answers
 * must follow the questions in order; one of the wrong kind, an option the event does not have, or
 * one left over after the day ended throws, since each would mean the screen and the rules disagree.
 */
export function advanceDay(s: SemesterState, ctx: SemesterContext, answers: readonly Answer[]): DayStep {
  let next = 0;
  const take = <K extends Answer['kind']>(ask: Ask & { kind: K }): Extract<Answer, { kind: K }> => {
    const a = answers[next];
    if (a === undefined) throw new Unanswered(ask);
    if (a.kind !== ask.kind) throw new RangeError(`answer ${next} is a "${a.kind}" but the day asked for "${ask.kind}"`);
    next += 1;
    return a as Extract<Answer, { kind: K }>;
  };
  const strategy: Strategy = {
    plan: (view) => take({ kind: 'plan', view }).plan,
    choose: (id, options, view) => {
      const { option } = take({ kind: 'event', view, id, options });
      if (!options.includes(option)) throw new RangeError(`"${option}" is not an option of event "${id}" (${options.join(', ')})`);
      return option;
    },
    floor: (view) => take({ kind: 'floor', view }).choice,
    night: (view) => take({ kind: 'night', view }).plan,
  };
  let state: SemesterState;
  try {
    state = playDay(s, ctx, strategy);
  } catch (e) {
    if (e instanceof Unanswered) return { done: false, ask: e.ask };
    throw e;
  }
  if (next < answers.length) throw new RangeError(`the day ended after ${next} answers but ${answers.length} were given`);
  return { done: true, state };
}
