import type { DomainEvent } from '../game.ts';
import type { RuleClock } from '../clock.ts';
import type { BodyParams } from '../outer/body.ts';
import type { TagDictionary } from '../tags/dictionary.ts';
import { amount, type TagState } from '../tags/store.ts';
import { applyEffects, type EffectEvent } from './effects.ts';

/**
 * The chapter's side of the energy-drink salesman (design doc 7.4). A can that lands adds
 * `energyDrink` to the caffeine residual and starts the palpitation, which is only a show: it
 * locks no input and gives nothing. Once the residual is past the Ministry of Health's 300 mg a
 * day (fact 9) the salesman says the Disco line instead of the heartbeat one.
 */
export const CAN = { discoAbove: 300 } as const;

export type CanEvent =
  | { readonly type: 'palpitation' }
  /** The thrower says it; `target` is his enemy id so the note appears over him. */
  | { readonly type: 'canDisco'; readonly target: number };

interface Outcome {
  readonly tags: TagState;
  readonly events: readonly (EffectEvent | CanEvent)[];
}

export function onCan(
  dict: TagDictionary, tags: TagState, clock: RuleClock, e: Extract<DomainEvent, { type: 'canTaken' }>, k: BodyParams & { readonly energyDrink: number },
): Outcome {
  const out = applyEffects(dict, tags, clock, [{ kind: 'amount', name: 'caffeine', mode: 'add', value: k.energyDrink }], { kind: 'event', key: 'energy_can' }, k);
  const said: CanEvent = amount(out.tags, dict, 'caffeine') > CAN.discoAbove ? { type: 'canDisco', target: e.source } : { type: 'palpitation' };
  return { tags: out.tags, events: [said, ...out.events] };
}
