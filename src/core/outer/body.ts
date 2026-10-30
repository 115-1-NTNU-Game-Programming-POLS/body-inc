import { runLine, type LineParams } from '../liver/line.ts';
import type { TagDictionary } from '../tags/dictionary.ts';
import { decayAmount, type TagState } from '../tags/store.ts';
import { metabolise, type MetabolismParams } from './caffeine.ts';

/** What the body does with time: the caffeine residual decays and the liver's first line runs. */
export type BodyParams = MetabolismParams & Partial<LineParams>;

/** Number tags with a `fadePerHour` lose that share of what they hold for every game hour that passes. */
function fadeTags(tags: TagState, dict: TagDictionary, minutes: number): TagState {
  let out = tags;
  for (const d of dict.tags.values()) {
    if (d.fadePerHour !== undefined && out.values[d.name] !== undefined) out = decayAmount(out, dict, d.name, (1 - d.fadePerHour) ** (minutes / 60));
  }
  return out;
}

/**
 * The tags after `minutes` of the chapter clock, ending at minute `at`. Every forward move of the
 * clock comes through here, so neither caffeine nor alcohol can be skipped past by a nap, a
 * conversation or a clock trigger. Without `liverRate` (test parameters) the line does not run.
 */
export function passBody(tags: TagState, dict: TagDictionary, minutes: number, k: BodyParams, at: number): TagState {
  const decayed = fadeTags(metabolise(tags, dict, minutes, k), dict, minutes);
  return k.liverRate === undefined ? decayed : runLine(decayed, dict, minutes, { liverRate: k.liverRate }, at).tags;
}
