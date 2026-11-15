import { advance, type RuleClock } from '../clock.ts';
import type { Effect } from '../dialogue/lines.ts';
import { passBody, type BodyParams } from '../outer/body.ts';
import { record, type SourceNodeKind } from '../tags/causal.ts';
import type { TagDictionary } from '../tags/dictionary.ts';
import { addAmount, amount, setAmount, setFlag, type TagState } from '../tags/store.ts';
import type { Tool } from '../tools.ts';
import { STAMP } from '../combat/frames.ts';

/** What applying effects reports; a subset of the chapter's events. */
export type EffectEvent =
  | { readonly type: 'clockAdvanced'; readonly minutes: number }
  /** A handbook page was unlocked; the app keeps it in the progress slot. */
  | { readonly type: 'handbookUnlocked'; readonly id: string }
  /** A tool was handed over; the chapter keeps it on the run. */
  | { readonly type: 'toolGranted'; readonly tool: Tool }
  /** The rejection gauge was raised; the chapter adds it to the operator, the opening scene to the start. */
  | { readonly type: 'gaugeRaised'; readonly points: number };

/** The gauge after the `gaugeRaised` events among `events`, never past its maximum. */
export function raisedGauge(gauge: number, events: readonly EffectEvent[]): number {
  const add = events.reduce((n, e) => n + (e.type === 'gaugeRaised' ? e.points : 0), 0);
  return Math.min(STAMP.gaugeMax, gauge + add);
}

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
 * effect lets the body catch up at that point (caffeine decays, the liver's line runs), so a tag
 * set after it is not decayed.
 */
export function applyEffects(
  dict: TagDictionary, tags0: TagState, clock0: RuleClock, effects: readonly Effect[], source: EffectSource, k: BodyParams,
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
      case 'move': {
        const held = amount(tags, dict, e.from);
        if (held > 0) {
          tags = addAmount(tags, dict, e.to, held * e.factor, cause, clock.minute);
          tags = setAmount(tags, dict, e.from, 0, cause, clock.minute);
        }
        break;
      }
      case 'clock':
        clock = advance(clock, e.minutes);
        tags = passBody(tags, dict, e.minutes, k, clock.minute);
        events.push({ type: 'clockAdvanced', minutes: e.minutes });
        break;
      case 'unlock':
        [log] = record(tags.log, { kind: 'effect', key: `unlock.${e.id}`, at: clock.minute, causes: [cause] });
        tags = { ...tags, log };
        events.push({ type: 'handbookUnlocked', id: e.id });
        break;
      case 'grant':
        [log] = record(tags.log, { kind: 'effect', key: `grant.${e.tool}`, at: clock.minute, causes: [cause] });
        tags = { ...tags, log };
        events.push({ type: 'toolGranted', tool: e.tool });
        break;
      case 'gauge':
        [log] = record(tags.log, { kind: 'effect', key: `gauge.${e.points}`, at: clock.minute, causes: [cause] });
        tags = { ...tags, log };
        events.push({ type: 'gaugeRaised', points: e.points });
        break;
    }
  }
  return { tags, clock, events };
}
