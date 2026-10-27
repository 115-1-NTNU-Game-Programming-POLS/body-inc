import { describe, expect, it } from 'vitest';
import { DIALOGUES, HANDBOOK, STRINGS, TAGS } from '../../src/app/content.ts';
import { handbookProblems, keepPage, missingPages, titleKey } from '../../src/app/handbook.ts';
import { SaveStore, type KeyValueStore } from '../../src/app/storage.ts';
import { decode, DEFAULT_HOST, encode, fillHost, HOST_WORST, loadDialogueTable, parseRoom, PROGRESS, withPage, type ProgressData, type TiledMap } from '../../src/core/index.ts';
import { modelMeasure } from '../../src/view/text/measure.ts';
import { HANDBOOK as LAYOUT, TEXT_SCALES } from '../../src/view/text/styles.ts';
import { wrapCJK } from '../../src/view/text/wrap.ts';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
}

describe('progress slot', () => {
  it('a new page is added once, in the order found', () => {
    const a = withPage({ handbook: [], hostName: DEFAULT_HOST }, 'caffeine')!;
    expect(a.handbook).toEqual(['caffeine']);
    expect(withPage(a, 'caffeine')).toBeUndefined();
    expect(withPage(a, 'sleep_debt')!.handbook).toEqual(['caffeine', 'sleep_debt']);
  });

  it('round-trips, and a list with a page twice is not a valid slot', () => {
    expect(decode(PROGRESS, encode(PROGRESS, { handbook: ['caffeine'], hostName: DEFAULT_HOST }))).toMatchObject({ kind: 'ok', data: { handbook: ['caffeine'] } });
    expect(decode(PROGRESS, null)).toMatchObject({ kind: 'empty', data: { handbook: [] } });
    const twice = JSON.stringify({ schema: 1, data: { handbook: ['caffeine', 'caffeine'] } });
    expect(decode(PROGRESS, twice).kind).toBe('invalid');
  });

  it('keepPage writes a new page at once and leaves a known page alone', () => {
    const store = memoryStore();
    const saves = new SaveStore(store);
    const first = keepPage(saves, { handbook: [], hostName: DEFAULT_HOST }, 'caffeine');
    expect(first).toEqual({ progress: { handbook: ['caffeine'], hostName: DEFAULT_HOST }, isNew: true, issues: [] });
    const written = decode(PROGRESS, store.data.get('hbc.v1.progress') ?? null);
    expect(written).toMatchObject({ kind: 'ok', data: { handbook: ['caffeine'] } });
    store.data.clear();
    const again = keepPage(saves, first.progress, 'caffeine');
    expect(again.isNew).toBe(false);
    expect(store.data.size).toBe(0);
  });

  it('a failed write still gives back the page to show, with the issue', () => {
    const blocked: KeyValueStore = { getItem: () => null, removeItem: () => {}, setItem: () => { throw new DOMException('no', 'SecurityError'); } };
    const kept = keepPage(new SaveStore(blocked), { handbook: [], hostName: DEFAULT_HOST } satisfies ProgressData, 'caffeine');
    expect(kept.progress.handbook).toEqual(['caffeine']);
    expect(kept.issues).toEqual([{ kind: 'write-failed', slot: 'progress', reason: 'blocked' }]);
  });
});

describe('handbook content', () => {
  it('the bundled handbook has no problems', () => {
    expect(handbookProblems(HANDBOOK, [{ file: 'zh-TW', value: STRINGS }])).toEqual([]);
    expect(HANDBOOK.pages.length).toBeGreaterThan(0);
  });

  it('a page id used twice and a paragraph with no string are said', () => {
    const file = { version: 1 as const, pages: [{ id: 'caffeine', body: ['handbook.caffeine.1'] }, { id: 'caffeine', body: ['handbook.caffeine.9'] }] };
    expect(handbookProblems(file, [{ file: 'zh-TW', value: STRINGS }])).toEqual([
      '手冊頁 id「caffeine」重複',
      '手冊頁「caffeine」用到的文字「handbook.caffeine.9」不在 zh-TW',
    ]);
    const noTitle = { version: 1 as const, pages: [{ id: 'nowhere', body: ['handbook.caffeine.1'] }] };
    expect(handbookProblems(noTitle, [{ file: 'zh-TW', value: STRINGS }])).toEqual([`手冊頁「nowhere」用到的文字「${titleKey('nowhere')}」不在 zh-TW`]);
  });

  it('pages a room or a conversation unlocks must exist', () => {
    const p = (name: string, value: string | number) => ({ name, value });
    const map = {
      width: 20, height: 12, tilewidth: 32, tileheight: 32,
      properties: [p('organ', 'lobby'), p('role', 'puzzle'), p('estSeconds', 10)],
      layers: [
        { type: 'tilelayer', name: 'walls', data: new Array(240).fill(0) },
        { type: 'objectgroup', name: 'objects', objects: [
          { id: 1, type: 'PlayerStart', x: 320, y: 200 },
          { id: 2, type: 'Pickup', x: 100, y: 100, properties: [p('itemType', 'handbook'), p('itemId', 'caffeine')] },
          { id: 3, type: 'Pickup', x: 100, y: 100, properties: [p('itemType', 'handbook'), p('itemId', 'nope')] },
          { id: 4, type: 'Pickup', x: 100, y: 100, properties: [p('itemType', 'file'), p('itemId', 'nope')] },
        ] },
      ],
    } as unknown as TiledMap;
    const rooms = new Map([['lab/a', parseRoom('lab/a', map, TAGS)]]);
    expect(missingPages(rooms, DIALOGUES, HANDBOOK)).toEqual(['lab/a #3: handbook page "nope"']);
    const talk = loadDialogueTable([{
      file: 'x.csv',
      text: 'dialogueId,order,speaker,expression,text,condition,effect,next,fact\nx,1,brain,normal,好,,unlock:missing_page,,\n',
    }], TAGS);
    expect(missingPages(new Map(), talk, HANDBOOK)).toEqual(['dialogue x: handbook page "missing_page"']);
  });

  it('a card option that unlocks a page the handbook lacks stops the game, opening, event or closing card alike', () => {
    const card = (id: string, page: string) => ({ id, options: [{ id: 'yes', effects: [{ kind: 'unlock' as const, id: page }] }] });
    const deck = {
      chapter: 'lab', opening: [card('o', 'caffeine'), card('p', 'nope_a')], events: new Map([['e', card('e', 'nope_b')]]), closing: [card('c', 'nope_c')],
    };
    expect(missingPages(new Map(), new Map(), HANDBOOK, deck)).toEqual([
      'card p/yes: handbook page "nope_a"', 'card e/yes: handbook page "nope_b"', 'card c/yes: handbook page "nope_c"',
    ]);
  });

  /** Pages whose body is taller than the page at a text size, `{host}` measured as the widest name allowed. */
  const overflowing = (texts: readonly (readonly string[])[]): string[] => TEXT_SCALES.flatMap((scale) => {
    const size = LAYOUT.body.fontSize * scale;
    return texts.flatMap((body, i) => {
      const height = body.reduce((h, text) => {
        const lines = wrapCJK(fillHost(text, HOST_WORST), LAYOUT.pageWidth, modelMeasure(size)).length;
        return h + lines * size * LAYOUT.body.lineHeight + LAYOUT.paragraphGap;
      }, 0);
      return height > LAYOUT.bodyHeight ? [`page ${i} at ${scale * 100}%`] : [];
    });
  });

  it('every page fits its body area at both text sizes, with the widest host name', () => {
    expect(overflowing(HANDBOOK.pages.map((p) => p.body.map((key) => STRINGS.strings[key]!.text)))).toEqual([]);
  });

  it('the fit measures {host} as the widest name, so a page that fits only 小晨 is caught', () => {
    // Full lines of the page at the larger size, the last one ending with the host's name.
    const size = LAYOUT.body.fontSize * 1.25;
    const perLine = Math.floor(LAYOUT.pageWidth / size);
    const lines = Math.floor((LAYOUT.bodyHeight - LAYOUT.paragraphGap) / (size * LAYOUT.body.lineHeight));
    const fill = '一'.repeat(perLine * lines - 2);
    expect(overflowing([[fill + '小晨']])).toEqual([]);
    expect(overflowing([[fill + '{host}']])).toEqual(['page 0 at 125%']);
  });
});
