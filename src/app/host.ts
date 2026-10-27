import { PROGRESS, type NameProblem, type ProgressData } from '../core/index.ts';
import type { SaveIssue, SaveStore } from './storage.ts';

/** String key of the message for a refused name; `{n}` in the too-long one is the limit. */
export const NAME_PROBLEM: Readonly<Record<NameProblem | 'glyph', string>> = {
  empty: 'name.problem.empty',
  'too-long': 'name.problem.too_long',
  'bad-char': 'name.problem.bad_char',
  // No font slice has a character of the name, so it would draw in a fallback font.
  glyph: 'name.problem.glyph',
};

export interface KeptName {
  readonly progress: ProgressData;
  readonly issues: readonly SaveIssue[];
}

/**
 * Records the host's name in the progress slot at once, like a handbook page: it belongs to the
 * player, not to a checkpoint, so it must not wait for the next punch. The returned progress is
 * the one to use even when the write failed. The name must already have passed readHostName.
 */
export function keepHost(saves: Pick<SaveStore, 'save'>, progress: ProgressData, name: string): KeptName {
  if (progress.hostName === name) return { progress, issues: [] };
  const next = { ...progress, hostName: name };
  return { progress: next, issues: saves.save(PROGRESS, next) };
}
