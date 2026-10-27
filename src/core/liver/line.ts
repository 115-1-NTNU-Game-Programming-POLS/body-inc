import { record } from '../tags/causal.ts';
import type { TagDictionary } from '../tags/dictionary.ts';
import { addAmount, amount, lowerAmount, type TagState } from '../tags/store.ts';

/**
 * The liver's first production line (design doc 7.7): every cup drunk is a crate of alcohol in
 * the receiving area (the `alcohol` tag, in cups), and the line turns them into acetaldehyde
 * crates (the `acetaldehyde` tag, in crates) at one fixed speed on the chapter clock. Minutes are
 * the only input: no item, skill, perk, assist or tag reaches this function, which is how design
 * doc 5.1's "alcohol only goes through the line" stays a rule and not a number someone tunes.
 * The rules for authors are in docs/authoring/rooms-and-dialogue.md.
 */

export interface LineParams {
  /** Cups the first line processes per game hour (design doc 7.7, fact 29). */
  readonly liverRate: number;
}

const LINE_KEY = 'liver.line';

/** Crates still waiting in receiving: the one being processed counts until it is done. */
export const waitingCrates = (tags: TagState, dict: TagDictionary): number =>
  dict.tags.has('alcohol') ? Math.ceil(amount(tags, dict, 'alcohol') - 1e-9) : 0;

/** Acetaldehyde crates out of the first line and not yet taken in by the second. */
export const acetaldehydeCrates = (tags: TagState, dict: TagDictionary): number =>
  dict.tags.has('acetaldehyde') ? Math.round(amount(tags, dict, 'acetaldehyde')) : 0;

/** How far the crate on the line is processed, 0 to 1; 0 when none is waiting. */
export function lineProgress(tags: TagState, dict: TagDictionary): number {
  const left = dict.tags.has('alcohol') ? amount(tags, dict, 'alcohol') : 0;
  if (left <= 0) return 0;
  const part = left - Math.floor(left - 1e-9);
  return Math.round((1 - part) * 1e6) / 1e6;
}

export interface LineStep {
  readonly tags: TagState;
  /** Crates that left the first line as acetaldehyde in these minutes. */
  readonly converted: number;
}

/**
 * `minutes` of the first line. A crate becomes acetaldehyde the minute it is fully processed, and
 * every conversion is caused by one `rule` entry for the line, found or made once, so the log does
 * not grow with the hours the line runs.
 */
export function runLine(tags: TagState, dict: TagDictionary, minutes: number, k: LineParams, at: number): LineStep {
  if (minutes <= 0 || !dict.tags.has('alcohol') || amount(tags, dict, 'alcohol') <= 0) return { tags, converted: 0 };
  const before = waitingCrates(tags, dict);
  let out = lowerAmount(tags, dict, 'alcohol', (k.liverRate * minutes) / 60);
  const converted = before - waitingCrates(out, dict);
  if (converted === 0 || !dict.tags.has('acetaldehyde')) return { tags: out, converted };
  const seen = out.log.nodes.findIndex((n) => n.kind === 'rule' && n.key === LINE_KEY);
  const [log, cause] = seen >= 0 ? [out.log, seen] : record(out.log, { kind: 'rule', key: LINE_KEY, at });
  out = addAmount({ ...out, log }, dict, 'acetaldehyde', converted, cause, at);
  return { tags: out, converted };
}

/** The second line took a crate in: acetaldehyde becomes acetic acid and leaves the body's books. */
export const intakeCrate = (tags: TagState, dict: TagDictionary): TagState =>
  dict.tags.has('acetaldehyde') ? lowerAmount(tags, dict, 'acetaldehyde', 1) : tags;
