import { EMPTY_LOG, EMPTY_TAGS, record, setAmount, setFlag, type TagDictionary, type TagState } from '../core/index.ts';

/**
 * Which room the game opens and the tags it is entered with. Until the outer layer (build plan
 * P1) produces tags from cards, dev builds take both from the URL so variants can be seen:
 *
 *   ?room=greybox/brain-corridor&tags=sleep_debt:2,breakfast
 *
 * Production ignores the URL and opens the default room with no tags.
 */
export const DEFAULT_ROOM = 'greybox/greybox-room';
const ROOM_PATH = /^[a-z0-9-]+\/[a-z0-9-]+$/;

export class QueryError extends Error {}

/** Map path under assets/maps, without the .tmj extension. */
export function roomFromQuery(search: string): string {
  const v = new URLSearchParams(search).get('room');
  if (v === null) return DEFAULT_ROOM;
  if (!ROOM_PATH.test(v)) throw new QueryError(`?room=${v}: expected <folder>/<map>, e.g. greybox/brain-corridor`);
  return v;
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
