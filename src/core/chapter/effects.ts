import { advance, type RuleClock } from '../clock.ts';
import type { Effect } from '../dialogue/lines.ts';
import { metabolise, type MetabolismParams } from '../outer/caffeine.ts';
import { record, type SourceNodeKind } from '../tags/causal.ts';
import type { TagDictionary } from '../tags/dictionary.ts';
import { addAmount, setAmount, setFlag, type TagState } from '../tags/store.ts';

/** What applying effects reports; a subset of the chapter's events. */
export type EffectEvent =
  | { readonly type: 'clockAdvanced'; readonly minutes: number }
  /** A handbook page was unlocked; the app keeps it in the progress slot. */
  | { readonly type: 'handbookUnlocked'; readonly id: string };

export interface EffectSource {
  readonly kind: SourceNodeKind;
  /** Logical id the close-out report picks its sentence by, e.g. `dialogue.t.30` or `card.bedtime.at_01`. */
  readonly key: string;
}

export interface EffectOutcome {
  readonly tags: TagState;
  readonly clock: RuleClock;
  readonly events: readonly EffectEvent[];
}

/**
 * Applies effects in order. One log entry names the source, and every tag change it makes is
 * caused by that entry (design doc 13.5), whether the source is a line, a reply or a card. With
 * no effects nothing is logged, so a line that only talks leaves no trace in the report. A clock
 * effect lets the caffeine residual decay at that point, so a tag set after it is not decayed.
 */
export function applyEffects(
  dict: TagDictionary, tags0: TagState, clock0: RuleClock, effects: readonly Effect[], source: EffectSource, k: MetabolismParams,
): EffectOutcome {
  if (effects.length === 0) return { tags: tags0, clock: clock0, events: [] };
  let clock = clock0;
  let [log, cause] = record(tags0.log, { kind: source.kind, key: source.key, at: clock.minute });
  let tags: TagState = { ...tags0, log };
  const events: EffectEvent[] = [];
  for (const e of effects) {
    switch (e.kind) {
      case 'flag':
        tags = setFlag(tags, dict, e.name, true, cause, clock.minute);
        break;
      case 'amount':
        tags = e.mode === 'set'
          ? setAmount(tags, dict, e.name, e.value, cause, clock.minute)
          : addAmount(tags, dict, e.name, e.value, cause, clock.minute);
        break;
      case 'clock':
        clock = advance(clock, e.minutes);
        tags = metabolise(tags, dict, e.minutes, k);
        events.push({ type: 'clockAdvanced', minutes: e.minutes });
        break;
      case 'unlock':
        [log] = record(tags.log, { kind: 'effect', key: `unlock.${e.id}`, at: clock.minute, causes: [cause] });
        tags = { ...tags, log };
        events.push({ type: 'handbookUnlocked', id: e.id });
        break;
    }
  }
  return { tags, clock, events };
}
