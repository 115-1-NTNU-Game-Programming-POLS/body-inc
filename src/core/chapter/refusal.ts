import { CHEERS } from '../combat/frames.ts';
import type { Effect } from '../dialogue/lines.ts';
import type { DomainEvent } from '../game.ts';
import { amount, type TagState } from '../tags/store.ts';
import type { RuleClock } from '../clock.ts';
import type { TagDictionary } from '../tags/dictionary.ts';
import type { BodyParams } from '../outer/body.ts';
import { applyEffects, type EffectEvent } from './effects.ts';

/**
 * The chapter's side of the cheers kid (design doc 7.7). A toast wave that lands is a cup for the
 * liver's receiving; a refusal is counted in the `refusals` tag, the operator says one of the
 * practical lines of the handbook page, and the refusal that reaches CHEERS.refusalsForPage hands
 * the page over. Each is one entry in the causal log, so a report can cite them.
 */
export const REFUSAL = {
  /** Lines `refusal.line.1` to `refusal.line.<lines>` in content/strings, said in turn. */
  lines: 4,
  page: 'refusing_drinks',
} as const;

export type RefusalEvent = { readonly type: 'refusalSaid'; readonly line: number };

interface Outcome {
  readonly tags: TagState;
  readonly events: readonly (EffectEvent | RefusalEvent)[];
}

/**
 * `from` is the enemy type of the wave's thrower (`cheers` for the kid, `toast` for the boss), so
 * the log entry says who poured the cup or had it refused: `<from>.toast` and `refuse.<from>`.
 * Every refusal counts the same towards the lines and the page, whoever offered the drink.
 */
export function onToast(dict: TagDictionary, tags: TagState, clock: RuleClock, e: Extract<DomainEvent, { type: 'toasted' }>, from: string, k: BodyParams): Outcome {
  const effects: Effect[] = [{ kind: 'amount', name: 'alcohol', mode: 'add', value: e.cups }];
  return applyEffects(dict, tags, clock, effects, { kind: 'event', key: `${from}.toast` }, k);
}

export function onRefusal(dict: TagDictionary, tags: TagState, clock: RuleClock, from: string, k: BodyParams): Outcome {
  const before = amount(tags, dict, 'refusals');
  const after = before + 1;
  const effects: Effect[] = [
    { kind: 'amount', name: 'refusals', mode: 'add', value: 1 },
    ...(before < CHEERS.refusalsForPage && after >= CHEERS.refusalsForPage ? [{ kind: 'unlock', id: REFUSAL.page } as const] : []),
  ];
  const out = applyEffects(dict, tags, clock, effects, { kind: 'choice', key: `refuse.${from}` }, k);
  return { tags: out.tags, events: [{ type: 'refusalSaid', line: ((after - 1) % REFUSAL.lines) + 1 }, ...out.events] };
}
