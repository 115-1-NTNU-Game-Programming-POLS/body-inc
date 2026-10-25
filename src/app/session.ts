import { BASE_HALVES, EMPTY_LOG, EMPTY_TAGS, record, setAmount, setFlag, STAMP, type TagDictionary, type TagState } from '../core/index.ts';

/**
 * Which room a dev build opens and the tags it is entered with, skipping the title screen.
 * A new game takes its tags from the opening cards; dev builds can instead take them from the URL,
 * so any variant can be seen without playing the cards that lead to it:
 *
 *   ?room=greybox/brain-corridor&tags=sleep_debt:2,breakfast&gauge=100&halves=2
 *
 * Production ignores the URL and opens the title screen.
 */
const ROOM_PATH = /^[a-z0-9-]+\/[a-z0-9-]+$/;

export class QueryError extends Error {}

/** Map path under assets/maps without the .tmj extension, or undefined when the URL names none. */
export function roomFromQuery(search: string): string | undefined {
  const v = new URLSearchParams(search).get('room');
  if (v === null) return undefined;
  if (!ROOM_PATH.test(v)) throw new QueryError(`?room=${v}: expected <folder>/<map>, e.g. greybox/brain-corridor`);
  return v;
}

/** The chapter a room belongs to is its folder (docs/authoring/rooms-and-dialogue.md). */
export const chapterOfRoom = (room: string): string => room.split('/')[0]!;

/** `?halves=2` starts with that many half hearts, so a forced leave is one hit away. Undefined when absent. */
export function halvesFromQuery(search: string): number | undefined {
  const v = new URLSearchParams(search).get('halves');
  if (v === null) return undefined;
  const n = Number(v);
  if (v.trim() === '' || !Number.isInteger(n) || n < 1 || n > BASE_HALVES) throw new QueryError(`?halves=${v}: expected a whole number from 1 to ${BASE_HALVES}`);
  return n;
}

/**
 * `?gauge=100` starts with that much rejection gauge, so the stamp can be tried without first
 * landing 125 staples. Undefined when absent.
 */
export function gaugeFromQuery(search: string): number | undefined {
  const v = new URLSearchParams(search).get('gauge');
  if (v === null) return undefined;
  const n = Number(v);
  if (v.trim() === '' || !Number.isFinite(n) || n < 0 || n > STAMP.gaugeMax) throw new QueryError(`?gauge=${v}: expected a number from 0 to ${STAMP.gaugeMax}`);
  return n;
}

/** `name:value` sets a number tag, a bare `name` turns a boolean tag on; all share one dev source. */
export function tagsFromQuery(search: string, dict: TagDictionary): TagState {
  const v = new URLSearchParams(search).get('tags');
  if (v === null || v.trim() === '') return EMPTY_TAGS;
  const [log, source] = record(EMPTY_LOG, { kind: 'event', key: 'dev.query_tags', at: 0 });
  let tags: TagState = { values: {}, log };
  for (const part of v.split(',').map((s) => s.trim())) {
    const [name = '', value, extra] = part.split(':');
    const def = dict.tags.get(name);
    if (!def || extra !== undefined) throw new QueryError(`?tags: "${part}" is not <tag> or <tag>:<number> with a tag from content/tags.json`);
    if (def.type === 'number') {
      const n = Number(value);
      if (value === undefined || value.trim() === '' || !Number.isFinite(n)) throw new QueryError(`?tags: "${name}" is a number tag; write ${name}:<number>`);
      tags = setAmount(tags, dict, name, n, source, 0);
    } else {
      if (value !== undefined) throw new QueryError(`?tags: "${name}" is a boolean tag; write just ${name}`);
      tags = setFlag(tags, dict, name, true, source, 0);
    }
  }
  return tags;
}
