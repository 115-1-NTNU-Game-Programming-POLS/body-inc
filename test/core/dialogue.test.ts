import { describe, expect, it } from 'vitest';
import { BOSSES, ENEMIES, PARAMS, TAGS } from '../../src/app/content.ts';
import {
  DIALOGUE_COLUMNS, DialogueTableError, LOCK_TICKS, OPERATOR_SPEAKER, arrivalEffects, loadDialogueTable, moveCursor, openDialogue,
  parseEffects, parseRoom, pickReply, readDialogues, resumeChapter, selectDialogue, startChapter, stateHash, stepChapter, trace, leaveNode,
  type ChapterContent, type ChapterState, type DialogueProblem, type DialogueTable, type GameEvent, type TickInput, type TiledMap,
} from '../../src/core/index.ts';

const HEADER = DIALOGUE_COLUMNS.join(',');
const cell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v));
interface Extra { expression?: string; condition?: string; effect?: string; next?: number | 'end'; fact?: string }
/** One CSV row; replies (operator) have no expression. */
const row = (id: string, order: number, speaker: string, text: string, e: Extra = {}) =>
  [id, order, speaker, e.expression ?? (speaker === OPERATOR_SPEAKER ? '' : 'normal'), text, e.condition ?? '', e.effect ?? '', e.next ?? '', e.fact ?? ''].map(cell).join(',');
const csv = (...rows: string[]) => ({ file: 'x.csv', text: [HEADER, ...rows].join('\n') });
const read = (...rows: string[]) => readDialogues([csv(...rows)], TAGS);
const codes = (ps: readonly DialogueProblem[]) => ps.map((p) => p.code);
const table = (...rows: string[]): DialogueTable => loadDialogueTable([csv(...rows)], TAGS);
const yes = () => true;
const no = () => false;

describe('reading a dialogue file', () => {
  it('reads lines in order whatever the row order, and keeps gaps between orders', () => {
    const t = table(row('a', 30, 'brain', 'third'), row('a', 1, 'brain', 'first'), row('a', 10, 'liver', 'second'));
    expect(t.get('a')!.lines.map((l) => [l.order, l.text])).toEqual([[1, 'first'], [10, 'second'], [30, 'third']]);
  });

  it('keeps the CSV row of each line for messages, counting the header as row 1', () => {
    const t = table(row('a', 1, 'brain', 'x'), row('b', 1, 'brain', 'y'));
    expect([t.get('a')!.lines[0]!.row, t.get('b')!.lines[0]!.row]).toEqual([2, 3]);
  });

  it('strips a byte order mark and reads quoted cells with commas', () => {
    const r = readDialogues([{ file: 'x.csv', text: `\uFEFF${HEADER}\n${row('a', 1, 'brain', '好，真的好')}` }], TAGS);
    expect(r.problems).toEqual([]);
    expect(r.table.get('a')!.lines[0]!.text).toBe('好，真的好');
  });

  it('a wrong header stops the file', () => {
    const r = readDialogues([{ file: 'x.csv', text: 'dialogueId,order\na,1' }], TAGS);
    expect(codes(r.problems)).toEqual(['header']);
    expect(r.table.size).toBe(0);
  });

  it.each([
    ['a row with the wrong number of cells', 'a,1,brain,normal,hi', 'columns'],
    ['an empty dialogueId', row('', 1, 'brain', 'hi'), 'id-empty'],
    ['an order of zero', row('a', 0, 'brain', 'hi'), 'order'],
    ['a fractional order', 'a,1.5,brain,normal,hi,,,,', 'order'],
    ['an empty speaker', 'a,1,,normal,hi,,,,', 'speaker-empty'],
    ['a spoken line without an expression', 'a,1,brain,,hi,,,,', 'expression-empty'],
    ['an empty text', row('a', 1, 'brain', ''), 'text-empty'],
    ['a next that is not a number or end', row('a', 1, 'brain', 'hi', { next: 'later' as unknown as number }), 'next'],
    ['a fact that is not an entry of the fact-check table', row('a', 1, 'brain', 'hi', { fact: 'maybe' }), 'fact'],
  ])('reports %s', (_, bad, code) => {
    const r = read(bad);
    expect(codes(r.problems)).toEqual([code]);
    expect(r.table.size).toBe(0);
  });

  it('accepts the fact-check forms: empty, a number, pending:n and general', () => {
    for (const fact of ['', '21', 'pending:4', 'general']) expect(read(row('a', 1, 'brain', 'hi', { fact })).problems, fact).toEqual([]);
  });

  it('a reply needs no expression, since the operator has no portrait', () => {
    expect(read(row('a', 1, 'brain', 'q'), row('a', 2, 'operator', 'x'), row('a', 3, 'operator', 'y')).problems).toEqual([]);
  });

  it('two lines of one conversation cannot share an order', () => {
    expect(codes(read(row('a', 1, 'brain', 'x'), row('a', 1, 'brain', 'y')).problems)).toEqual(['order-duplicate']);
  });

  it('a bad row leaves its whole conversation out and the others in, so half of one is never played', () => {
    const r = read(row('good', 1, 'brain', 'ok'), row('bad', 1, 'brain', 'ok'), row('bad', 2, 'brain', ''));
    expect(codes(r.problems)).toEqual(['text-empty']);
    expect([...r.table.keys()]).toEqual(['good']);
  });

  it('one dialogueId in two files is a problem, also when the first copy is broken', () => {
    const one = { file: 'one.csv', text: `${HEADER}\n${row('a', 1, 'brain', 'x')}` };
    const two = { file: 'two.csv', text: `${HEADER}\n${row('a', 1, 'brain', 'y')}` };
    expect(readDialogues([one, two], TAGS).problems).toMatchObject([{ code: 'duplicate-dialogue', file: 'two.csv', dialogueId: 'a', detail: 'one.csv' }]);
    const broken = { file: 'one.csv', text: `${HEADER}\n${row('a', 1, 'brain', '')}` };
    expect(codes(readDialogues([broken, two], TAGS).problems)).toEqual(['text-empty', 'duplicate-dialogue']);
  });

  it('a blank line still counts in the row a message names, as a spreadsheet numbers rows', () => {
    const text = `${HEADER}\n${row('a', 1, 'brain', 'x')}\n\n\n${row('b', 1, 'brain', '')}\n`;
    expect(readDialogues([{ file: 'x.csv', text }], TAGS).problems).toMatchObject([{ code: 'text-empty', row: 5 }]);
    const crlf = text.replaceAll('\n', '\r\n');
    expect(readDialogues([{ file: 'x.csv', text: crlf }], TAGS).problems).toMatchObject([{ code: 'text-empty', row: 5 }]);
  });

  it('a cell with a line break inside is still one row', () => {
    const text = `${HEADER}\n${row('a', 1, 'brain', '第一行\n第二行')}\n${row('b', 1, 'brain', '')}`;
    const r = readDialogues([{ file: 'x.csv', text }], TAGS);
    expect(r.table.get('a')!.lines[0]!.text).toBe('第一行\n第二行');
    expect(r.problems).toMatchObject([{ code: 'text-empty', row: 3 }]);
  });

  it('a row with the wrong number of cells leaves its conversation out whole, with no follow-on problems', () => {
    // Row 10 is the target of order 1's next; without it the rest would be reported as missing and unreachable.
    const r = read(row('a', 1, 'brain', 'x', { next: 10 }), 'a,10,brain,normal,hi', row('a', 20, 'brain', 'y'), row('b', 1, 'brain', 'ok'));
    expect(codes(r.problems)).toEqual(['columns']);
    expect([...r.table.keys()]).toEqual(['b']);
  });

  it('a conversation broken by a short row, or by two equal orders, still holds its id against another file', () => {
    const two = { file: 'two.csv', text: `${HEADER}\n${row('a', 1, 'brain', 'y')}` };
    const short = { file: 'one.csv', text: `${HEADER}\na,10,brain,normal,hi` };
    expect(codes(readDialogues([short, two], TAGS).problems)).toEqual(['columns', 'duplicate-dialogue']);
    const twice = { file: 'one.csv', text: `${HEADER}\n${row('a', 1, 'brain', 'x')}\n${row('a', 1, 'brain', 'z')}` };
    const r = readDialogues([twice, two], TAGS);
    expect(codes(r.problems)).toEqual(['order-duplicate', 'duplicate-dialogue']);
    expect(r.table.size).toBe(0);
  });

  it('the game load refuses a file with any problem and names them all', () => {
    const load = () => loadDialogueTable([csv(row('a', 1, 'brain', ''), row('b', 0, 'brain', 'x'))], TAGS);
    expect(load).toThrow(DialogueTableError);
    const error = (() => { try { load(); } catch (e) { return e as DialogueTableError; } return undefined; })();
    expect(error?.problems).toHaveLength(2);
  });
});

describe('conditions on lines', () => {
  it('parse against the tag dictionary like a map condition', () => {
    const r = read(row('a', 1, 'brain', 'x', { condition: 'deadline,sleep_debt>=2' }));
    expect(r.problems).toEqual([]);
    expect(r.table.get('a')!.lines[0]!.when?.terms).toHaveLength(2);
  });

  it.each([
    ['an unknown tag', 'no_such_tag', 'unknown-tag'],
    ['a number tag used as a flag', 'sleep_debt', 'not-boolean'],
    ['a comparison on a flag', 'deadline>=1', 'not-number'],
    ['a negated comparison', '!sleep_debt>=2', 'negated-compare'],
    ['an empty term', 'deadline,', 'empty-term'],
  ])('reports %s', (_, condition, code) => {
    const r = read(row('a', 1, 'brain', 'x', { condition }));
    expect(r.problems).toMatchObject([{ code: 'condition', condition: { code } }]);
  });
});

describe('effects of a line', () => {
  const parse = (text: string) => parseEffects(text, TAGS);

  it('reads each form, several to a cell', () => {
    expect(parse('tag:deadline').effects).toEqual([{ kind: 'flag', name: 'deadline' }]);
    expect(parse('tag:sleep_debt+1.5').effects).toEqual([{ kind: 'amount', name: 'sleep_debt', mode: 'add', value: 1.5 }]);
    expect(parse('tag:alcohol=0').effects).toEqual([{ kind: 'amount', name: 'alcohol', mode: 'set', value: 0 }]);
    expect(parse('clock:10').effects).toEqual([{ kind: 'clock', minutes: 10 }]);
    expect(parse('unlock:caffeine').effects).toEqual([{ kind: 'unlock', id: 'caffeine' }]);
    expect(parse('tag:deadline; clock:5 ;unlock:sleep_debt').effects).toHaveLength(3);
    expect(parse('').effects).toEqual([]);
  });

  it('reads a move of one number tag into another, with a factor', () => {
    expect(parse('move:memory_held>memory_desk*100').effects).toEqual([{ kind: 'move', from: 'memory_held', to: 'memory_desk', factor: 100 }]);
    expect(parse('move:memory_held>memory_desk*0.5').effects).toEqual([{ kind: 'move', from: 'memory_held', to: 'memory_desk', factor: 0.5 }]);
  });

  it.each([
    ['an unknown effect', 'give:coffee', 'syntax'],
    ['a move from a tag that is not in the dictionary', 'move:no_such_tag>memory_desk*1', 'unknown-tag'],
    ['a move into a tag only rules may set', 'move:memory_held>exam_archived*1', 'tag-source'],
    ['a move of a boolean tag', 'move:memory_held>deadline*1', 'tag-form'],
    ['a move into itself', 'move:memory_held>memory_held*1', 'tag-form'],
    ['a move that reaches the alcohol rule', 'move:memory_held>alcohol*1', 'tag-form'],
    ['a move out of the caffeine residual', 'move:caffeine>memory_desk*1', 'tag-form'],
    ['a move with no factor', 'move:memory_held>memory_desk', 'syntax'],
    ['an empty part', 'clock:5;', 'syntax'],
    ['a modifier, which is a condition and not a tag', 'tag:mod.caffeine_cloak', 'alias'],
    ['a modifier name that is not in the dictionary', 'tag:mod.no_such_modifier', 'unknown-tag'],
    ['a dotted name that is not a modifier', 'tag:caffeine.x', 'syntax'],
    ['a tag that is not in the dictionary', 'tag:no_such_tag', 'unknown-tag'],
    ['a tag only cards may set', 'tag:breakfast', 'tag-source'],
    ['a tag only rules may set', 'tag:fever', 'tag-source'],
    ['a boolean tag with an amount', 'tag:deadline=1', 'tag-form'],
    ['a number tag with no amount', 'tag:alcohol', 'tag-form'],
    ['minutes that are not whole', 'clock:1e1', 'minutes'],
    ['no minutes', 'clock:', 'minutes'],
  ])('reports %s', (_, text, code) => {
    expect(parse(text).problems).toMatchObject([{ code }]);
    expect(read(row('a', 1, 'brain', 'x', { effect: text })).problems).toMatchObject([{ code: 'effect', effect: code }]);
  });
});

describe('how a conversation is joined up', () => {
  const options = (extra: Extra[]) => extra.map((e, i) => row('a', 2 + i, 'operator', `r${i}`, e));

  it('a run of replies is a choice of two or three', () => {
    for (const n of [2, 3]) expect(read(row('a', 1, 'brain', 'q'), ...options(new Array<Extra>(n).fill({}))).problems, `${n}`).toEqual([]);
    for (const n of [1, 4]) {
      expect(read(row('a', 1, 'brain', 'q'), ...options(new Array<Extra>(n).fill({}))).problems, `${n}`).toMatchObject([{ code: 'options-count', detail: String(n) }]);
    }
  });

  it('next must name a later line of the same conversation', () => {
    const q = row('a', 1, 'brain', 'q', { next: 5 });
    expect(codes(read(q, row('a', 2, 'brain', 'x')).problems)).toContain('next-missing');
    expect(codes(read(row('a', 1, 'brain', 'x'), row('a', 2, 'brain', 'y', { next: 1 })).problems)).toEqual(['next-backward']);
    expect(codes(read(row('a', 1, 'brain', 'x'), row('a', 2, 'brain', 'y', { next: 2 })).problems)).toEqual(['next-backward']);
    expect(read(row('a', 1, 'brain', 'x', { next: 'end' }), row('a', 2, 'brain', 'y')).problems).toMatchObject([{ code: 'unreachable', order: 2 }]);
  });

  it('next cannot land in the middle of a run of replies', () => {
    const r = read(row('a', 1, 'brain', 'q', { next: 3 }), row('a', 2, 'operator', 'x'), row('a', 3, 'operator', 'y'));
    expect(codes(r.problems)).toEqual(['next-into-options']);
    expect(read(row('a', 1, 'brain', 'q', { next: 2 }), row('a', 2, 'operator', 'x'), row('a', 3, 'operator', 'y')).problems).toEqual([]);
  });

  it('a line nothing leads to is reported, so a mistyped next is found', () => {
    const r = read(
      row('a', 1, 'brain', 'q'), row('a', 2, 'operator', 'x', { next: 10 }), row('a', 3, 'operator', 'y', { next: 10 }),
      row('a', 10, 'brain', 'both lead here', { next: 'end' }), row('a', 11, 'brain', 'only a typo would lead here'),
    );
    expect(r.problems).toMatchObject([{ code: 'unreachable', order: 11, row: 6 }]);
  });

  it('a line a condition can skip hands over to the row after it, so that row is reachable', () => {
    const skipped = read(row('a', 1, 'brain', 'x', { next: 3, condition: 'deadline' }), row('a', 2, 'brain', 'after the skip'), row('a', 3, 'brain', 'y'));
    expect(skipped.problems).toEqual([]);
    const plain = read(row('a', 1, 'brain', 'x', { next: 3 }), row('a', 2, 'brain', 'never'), row('a', 3, 'brain', 'y'));
    expect(plain.problems).toMatchObject([{ code: 'unreachable', order: 2 }]);
  });

  it('the row after a choice is reachable through the choice only when every reply could be hidden', () => {
    const open = (c1: string, c2: string) => read(
      row('a', 1, 'brain', 'q'), row('a', 2, 'operator', 'x', { next: 10, condition: c1 }), row('a', 3, 'operator', 'y', { next: 10, condition: c2 }),
      row('a', 4, 'brain', 'after the choice', { next: 'end' }), row('a', 10, 'brain', 'the branch'),
    );
    expect(open('deadline', 'cold').problems).toEqual([]);
    expect(open('deadline', '').problems).toMatchObject([{ code: 'unreachable', order: 4 }]);
  });

  it('flow problems of one conversation do not hide those of another', () => {
    const r = read(row('a', 1, 'brain', 'x', { next: 9 }), row('b', 1, 'brain', 'x'), row('b', 2, 'brain', 'y', { next: 1 }));
    expect(r.problems.map((p) => [p.dialogueId, p.code])).toEqual([['a', 'next-missing'], ['b', 'next-backward']]);
  });
});

describe('walking a conversation', () => {
  const t = table(
    row('t', 1, 'brain', 'q'),
    row('t', 2, 'operator', 'yes', { next: 10, effect: 'tag:deadline' }),
    row('t', 3, 'operator', 'no', { next: 20 }),
    row('t', 4, 'operator', 'hidden', { condition: 'cold', next: 20 }),
    row('t', 10, 'liver', 'glad', { next: 30 }),
    row('t', 20, 'brain', 'ok', { next: 30 }),
    row('t', 30, 'brain', 'bye', { effect: 'clock:5' }),
  );

  /** The choice that follows the opening question, when every condition holds or when `ok` says. */
  const choiceUnder = (ok: (c: { text: string }) => boolean = yes) => leaveNode(t, openDialogue(t, 't', ok)!, ok)!;

  it('opens on the first line and reads it from the state alone', () => {
    const s = openDialogue(t, 't', yes)!;
    expect(selectDialogue(t, s)).toMatchObject({ id: 't', line: { speaker: 'brain', expression: 'normal', text: 'q' }, options: [], cursor: 0, at: 0 });
    expect(selectDialogue(t, null)).toBeUndefined();
  });

  it('opens on the first line that shows, and on nothing when no line does', () => {
    const c = table(row('c', 1, 'brain', 'a', { condition: 'cold' }), row('c', 2, 'brain', 'b', { condition: 'fever' }), row('c', 3, 'brain', 'c'));
    expect(selectDialogue(c, openDialogue(c, 'c', no))!.line!.text).toBe('c');
    const none = table(row('n', 1, 'brain', 'a', { condition: 'cold' }));
    expect(openDialogue(none, 'n', no)).toBeUndefined();
    expect(() => openDialogue(t, 'nope', yes)).toThrow(RangeError);
  });

  it('offers only the replies whose condition holds, and keeps the question on screen', () => {
    const shown = choiceUnder((c) => c.text !== 'cold');
    expect(selectDialogue(t, shown)!.options).toEqual(['yes', 'no']);
    expect(selectDialogue(t, shown)!.line!.text).toBe('q');
    expect(selectDialogue(t, choiceUnder())!.options).toEqual(['yes', 'no', 'hidden']);
  });

  it('a spoken line carries no effect until it appears, and a reply none until it is chosen', () => {
    const choice = choiceUnder();
    expect(arrivalEffects(t, openDialogue(t, 't', yes)!)).toEqual([]);
    expect(arrivalEffects(t, choice)).toEqual([]);
    const bye = leaveNode(t, leaveNode(t, pickReply(choice, 1)!, yes)!, yes)!;
    expect(selectDialogue(t, bye)!.line!.text).toBe('bye');
    expect(arrivalEffects(t, bye)).toEqual([{ kind: 'clock', minutes: 5 }]);
  });

  it('follows the chosen reply to its next line and from there to the end', () => {
    const choice = choiceUnder();
    const glad = leaveNode(t, pickReply(choice, 1)!, yes)!;
    expect(selectDialogue(t, glad)!.line).toMatchObject({ speaker: 'liver', text: 'glad' });
    const ok = leaveNode(t, pickReply(choice, 2)!, yes)!;
    expect(selectDialogue(t, ok)!.line!.text).toBe('ok');
    expect(leaveNode(t, leaveNode(t, ok, yes)!, yes)).toBeUndefined();
  });

  it('a reply without a next goes on to the row after the whole choice', () => {
    const f = table(
      row('f', 1, 'brain', 'q'), row('f', 2, 'operator', 'x'), row('f', 3, 'operator', 'y'), row('f', 4, 'brain', 'after'),
    );
    const choice = leaveNode(f, openDialogue(f, 'f', yes)!, yes)!;
    for (const pick of [1, 2]) {
      const after = leaveNode(f, pickReply(choice, pick)!, yes)!;
      expect(selectDialogue(f, after)!.line!.text, `reply ${pick}`).toBe('after');
    }
  });

  it('a choice that hides every reply is skipped', () => {
    const f = table(
      row('f', 1, 'brain', 'q'), row('f', 2, 'operator', 'x', { condition: 'cold' }), row('f', 3, 'operator', 'y', { condition: 'fever' }), row('f', 4, 'brain', 'after'),
    );
    expect(selectDialogue(f, leaveNode(f, openDialogue(f, 'f', no)!, no)!)!.line!.text).toBe('after');
  });

  it('a conversation can open on its replies, with nothing said yet', () => {
    const f = table(row('f', 1, 'operator', 'x'), row('f', 2, 'operator', 'y'), row('f', 3, 'brain', 'after'));
    const s = openDialogue(f, 'f', yes)!;
    expect(selectDialogue(f, s)).toMatchObject({ line: undefined, options: ['x', 'y'] });
  });

  it('the cursor wraps, and a pick must name a reply on offer', () => {
    const choice = choiceUnder();
    expect(moveCursor(choice, -1).cursor).toBe(2);
    expect(moveCursor(moveCursor(choice, 1), 2).cursor).toBe(0);
    expect(pickReply(choice, 3)!.cursor).toBe(2);
    expect([0, 4, -1, 1.5].map((n) => pickReply(choice, n))).toEqual([undefined, undefined, undefined, undefined]);
    const spoken = leaveNode(t, pickReply(choice, 2)!, yes)!;
    expect(moveCursor(spoken, 1)).toBe(spoken);
  });

  it('a skipped line does not run its next: the flow goes to the row after it', () => {
    const f = table(row('f', 1, 'brain', 'skipped', { condition: 'cold', next: 3 }), row('f', 2, 'brain', 'shown first'), row('f', 3, 'brain', 'last'));
    expect(selectDialogue(f, openDialogue(f, 'f', no))!.line!.text).toBe('shown first');
  });
});

describe('a conversation inside a chapter', () => {
  const p = (name: string, value: string | number | boolean) => ({ name, value });
  const NONE: TickInput = { move: { x: 0, y: 0 } };
  const PRESS: TickInput = { ...NONE, interactPressed: true };

  function labRoom(path: string, objects: object[]) {
    const map = {
      width: 20, height: 12, tilewidth: 32, tileheight: 32,
      properties: [{ name: 'organ', value: 'lobby' }, { name: 'role', value: 'rest' }, { name: 'estSeconds', value: 10 }],
      layers: [
        { type: 'tilelayer', name: 'walls', data: new Array(240).fill(0) },
        { type: 'objectgroup', name: 'objects', objects: [{ id: 1, type: 'PlayerStart', x: 100, y: 100 }, ...objects] },
      ],
    } as unknown as TiledMap;
    return parseRoom(path, map, TAGS);
  }
  const npc = (dialogueId: string) => ({ id: 2, type: 'NPC', x: 320, y: 200, properties: [p('npcId', 'brain'), p('dialogueId', dialogueId)] });
  const trigger = (id: number, dialogueId: string, x = 200, y = 150, height = 64) => ({
    id, type: 'Trigger', x, y, width: 64, height, properties: [p('event', 'dialogue'), p('eventId', dialogueId)],
  });
  const southDoor = { id: 5, type: 'Door', name: 'door-s', x: 288, y: 352, width: 64, height: 32, properties: [p('socket', 'S')] };
  const northDoor = { id: 2, type: 'Door', name: 'door-n', x: 288, y: 0, width: 64, height: 96, properties: [p('socket', 'N')] };

  function chapter(rows: string[], objects: object[]): ChapterContent {
    return {
      chapter: { version: 1, id: 'lab', start: 'lab/room', links: [] },
      rooms: new Map([['lab/room', labRoom('lab/room', objects)]]),
      dialogues: table(...rows), dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS,
    };
  }
  const place = (s: ChapterState, x: number, y: number): ChapterState => ({ ...s, game: { ...s.game, touching: [], operator: { ...s.game.operator, x, y } } });
  const step = (c: ChapterContent, s: ChapterState, input: TickInput = NONE, n = 1) => {
    const events: GameEvent[] = [];
    for (let i = 0; i < n; i++) {
      const r = stepChapter(c, s, input);
      s = r.state;
      events.push(...r.events);
    }
    return { state: s, events };
  };
  const types = (events: readonly GameEvent[]) => events.map((e) => e.type);
  /** Waits out the input lock, then presses once. */
  function press(c: ChapterContent, s: ChapterState, input: TickInput = PRESS) {
    const waited = step(c, s, NONE, LOCK_TICKS);
    const pressed = step(c, waited.state, input);
    return { state: pressed.state, events: [...waited.events, ...pressed.events] };
  }

  const ROWS = [
    row('t', 1, 'brain', 'q'),
    row('t', 2, 'operator', 'yes', { next: 10, effect: 'tag:deadline;clock:10' }),
    row('t', 3, 'operator', 'no', { next: 20, effect: 'tag:stress+1' }),
    row('t', 10, 'brain', 'glad', { next: 30, effect: 'tag:sleep_debt+2' }),
    row('t', 20, 'brain', 'ok', { next: 30 }),
    row('t', 30, 'brain', 'bye', { condition: 'deadline', effect: 'unlock:sleep_debt' }),
    row('t', 31, 'brain', 'bye for good', { condition: '!deadline' }),
  ];
  const talking = () => {
    const c = chapter(ROWS, [npc('t')]);
    return { c, s: place(startChapter(c), 320, 240) };
  };

  it('pressing the key beside an NPC opens its conversation and freezes the room', () => {
    const { c, s } = talking();
    const r = step(c, s, PRESS);
    expect(r.events).toContainEqual({ type: 'dialogueOpened', dialogueId: 't' });
    expect(r.state.dialogue).toMatchObject({ id: 't', age: 0 });
    const tick = r.state.game.tick;
    const walked = step(c, r.state, { move: { x: 1, y: 0 } }, 30);
    expect(walked.state.game.tick).toBe(tick);
    expect(walked.state.game.operator.x).toBe(r.state.game.operator.x);
  });

  it('a dialogue the map names that is not in the table stops with a clear error', () => {
    const c = chapter(ROWS, [npc('missing')]);
    expect(() => step(c, place(startChapter(c), 320, 240), PRESS)).toThrow(/dialogue "missing" does not exist/);
  });

  it('ignores presses until the lock has run out, then takes the first one', () => {
    const { c, s } = talking();
    let cur = step(c, s, PRESS).state;
    for (let i = 0; i < LOCK_TICKS; i++) {
      cur = step(c, cur, PRESS).state;
      expect(cur.dialogue?.at, `tick ${i}`).toBe(0);
    }
    // The lock has run out: this press is the first one taken, and it moves on to the choice.
    const taken = step(c, cur, PRESS).state;
    expect(taken.dialogue?.options.length).toBeGreaterThan(0);
    const moved = step(c, { ...taken, dialogue: { ...taken.dialogue!, age: LOCK_TICKS } }, { ...NONE, menuStep: 1 });
    expect(moved.state.dialogue?.cursor).toBe(1);
  });

  it('J, a click and the dodge key confirm as well as the interact key', () => {
    for (const input of [{ attackPressed: true }, { dodgePressed: true }, { interactPressed: true }] as const) {
      const c = chapter([row('t', 1, 'brain', 'one'), row('t', 2, 'brain', 'two')], [npc('t')]);
      const opened = step(c, place(startChapter(c), 320, 240), PRESS).state;
      const r = press(c, opened, { ...NONE, ...input });
      expect(r.state.dialogue?.at, JSON.stringify(input)).toBe(1);
    }
  });

  it('confirming a spoken line goes on, and the last line closes the conversation and frees the room', () => {
    const c = chapter([row('t', 1, 'brain', 'one'), row('t', 2, 'brain', 'two')], [npc('t')]);
    let s = step(c, place(startChapter(c), 320, 240), PRESS).state;
    s = press(c, s).state;
    expect(s.dialogue).toMatchObject({ at: 1 });
    const end = press(c, s);
    expect(end.state.dialogue).toBeNull();
    expect(end.events).toContainEqual({ type: 'dialogueClosed', dialogueId: 't' });
    const tick = end.state.game.tick;
    expect(step(c, end.state, NONE, 3).state.game.tick).toBe(tick + 3);
  });

  it('the key that closes a conversation does not open it again', () => {
    const c = chapter([row('t', 1, 'brain', 'only')], [npc('t')]);
    let s = step(c, place(startChapter(c), 320, 240), PRESS).state;
    const closed = press(c, s);
    expect(closed.state.dialogue).toBeNull();
    s = closed.state;
    expect(types(step(c, s, NONE, 5).events)).toEqual([]);
  });

  it('choosing a reply applies its effects with the choice as their cause, then follows its next', () => {
    const { c, s } = talking();
    let cur = step(c, s, PRESS).state;
    const clock0 = cur.game.clock.minute;
    const r = press(c, cur);
    cur = r.state;
    expect(selectDialogue(c.dialogues, cur.dialogue)!.options).toEqual(['yes', 'no']);
    const chosen = press(c, cur);
    expect(chosen.events).toContainEqual({ type: 'clockAdvanced', minutes: 10 });
    cur = chosen.state;
    expect(cur.game.clock.minute).toBe(clock0 + 10);
    expect(cur.run.tags.values['deadline']).toBeDefined();
    expect(cur.run.tags.values['stress']).toBeUndefined();
    expect(trace(cur.run.tags.log, cur.run.tags.values['deadline']!.node).map((n) => `${n.kind}:${n.key}`)).toEqual(['choice:dialogue.t.2', 'tag:deadline']);
    // The reply's next line appears, and its own effect applies as it does, caused by that line.
    expect(selectDialogue(c.dialogues, cur.dialogue)!.line!.text).toBe('glad');
    expect(cur.run.tags.values['sleep_debt']).toMatchObject({ value: 2 });
    expect(trace(cur.run.tags.log, cur.run.tags.values['sleep_debt']!.node).map((n) => `${n.kind}:${n.key}`)).toEqual(['event:dialogue.t.10', 'tag:sleep_debt']);
  });

  it('the down key and a number key move or pick, and each reply leads somewhere else', () => {
    const { c, s } = talking();
    const q = press(c, step(c, s, PRESS).state).state;
    const moved = press(c, q, { ...NONE, menuStep: 1 }).state;
    expect(moved.dialogue?.cursor).toBe(1);
    expect(moved.dialogue?.options).toEqual(q.dialogue?.options);
    const declined = press(c, moved);
    expect(declined.state.run.tags.values['stress']).toMatchObject({ value: 1 });
    expect(selectDialogue(c.dialogues, declined.state.dialogue)!.line!.text).toBe('ok');
    const picked = press(c, q, { ...NONE, pick: 2 });
    expect(selectDialogue(c.dialogues, picked.state.dialogue)!.line!.text).toBe('ok');
    const outOfRange = press(c, q, { ...NONE, pick: 3 });
    expect(outOfRange.state.dialogue).toEqual({ ...q.dialogue!, age: LOCK_TICKS });
  });

  it('the age of a line stops at the lock, however long the player waits', () => {
    const { c, s } = talking();
    const q = press(c, step(c, s, PRESS).state).state;
    const waited = step(c, q, NONE, 500).state;
    expect(waited.dialogue?.age).toBe(LOCK_TICKS);
    expect(step(c, waited, { ...NONE, menuStep: 1 }).state.dialogue?.age).toBe(LOCK_TICKS);
  });

  it('a line is shown or skipped by the tags the conversation itself has just set', () => {
    const { c, s } = talking();
    const q = press(c, step(c, s, PRESS).state).state;
    const yesPath = finish(c, press(c, q).state);
    expect(yesPath.events.filter((e) => e.type === 'handbookUnlocked')).toEqual([{ type: 'handbookUnlocked', id: 'sleep_debt' }]);
    expect(yesPath.lines).toEqual(['glad', 'bye']);
    const noPath = finish(c, press(c, press(c, q, { ...NONE, menuStep: 1 }).state).state);
    expect(noPath.lines).toEqual(['ok', 'bye for good']);
    expect(noPath.events.filter((e) => e.type === 'handbookUnlocked')).toEqual([]);
  });

  /** Confirms through to the end, noting each line shown on the way. */
  function finish(c: ChapterContent, s: ChapterState) {
    const lines: string[] = [];
    const events: GameEvent[] = [];
    for (let i = 0; i < 20 && s.dialogue; i++) {
      const line = selectDialogue(c.dialogues, s.dialogue)!.line!.text;
      if (s.dialogue.options.length === 0) lines.push(line);
      const r = press(c, s);
      s = r.state;
      events.push(...r.events);
    }
    return { state: s, lines, events };
  }

  it('unlocking a page is recorded as an effect caused by the line that unlocked it', () => {
    const { c, s } = talking();
    const q = press(c, step(c, s, PRESS).state).state;
    const end = finish(c, press(c, q).state).state;
    const unlock = end.run.tags.log.nodes.find((n) => n.key === 'unlock.sleep_debt')!;
    expect(unlock.kind).toBe('effect');
    expect(end.run.tags.log.nodes[unlock.causes[0]!.node]!.key).toBe('dialogue.t.30');
  });

  it('a trigger opens its conversation once, and a conversation whose lines are all skipped opens nothing', () => {
    const c = chapter([row('t', 1, 'brain', 'hello'), row('c', 1, 'brain', 'never', { condition: 'cold' })], [trigger(2, 't'), trigger(3, 'c', 400, 150)]);
    const r = step(c, place(startChapter(c), 232, 182), NONE);
    expect(r.events).toContainEqual({ type: 'dialogueOpened', dialogueId: 't' });
    expect(r.state.dialogue?.id).toBe('t');
    const done = finishTalk(c, r.state);
    const again = step(c, place(done, 20, 20), NONE);
    expect(types(step(c, place(again.state, 232, 182), NONE).events)).not.toContain('dialogueOpened');
    const hidden = step(c, place(startChapter(c), 432, 182), NONE);
    expect(hidden.state.dialogue).toBeNull();
    expect(types(hidden.events)).not.toContain('dialogueOpened');
  });

  function finishTalk(c: ChapterContent, s: ChapterState): ChapterState {
    for (let i = 0; s.dialogue; i++) {
      if (i > 500) throw new Error('did not end');
      s = stepChapter(c, s, i % 2 === 0 ? PRESS : NONE).state;
    }
    return s;
  }

  it('a door crossed on the tick a conversation opens waits for the conversation to end', () => {
    const rooms = new Map([
      ['lab/a', labRoom('lab/a', [southDoor, trigger(6, 't', 288, 352, 32)])],
      ['lab/b', labRoom('lab/b', [northDoor])],
    ]);
    const c: ChapterContent = {
      chapter: { version: 1, id: 'lab', start: 'lab/a', links: [{ a: 'lab/a#door-s', b: 'lab/b#door-n' }] },
      rooms, dialogues: table(row('t', 1, 'brain', 'wait')), dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS,
    };
    const r = step(c, place(startChapter(c), 320, 368), NONE);
    expect(types(r.events)).toContain('doorEntered');
    expect(types(r.events)).not.toContain('roomChanged');
    expect(r.state.run.roomId).toBe('lab/a');
    expect(r.state.dialogue?.id).toBe('t');
    const after = step(c, finishTalk(c, r.state), NONE);
    expect(after.events).toContainEqual({ type: 'roomChanged', from: 'lab/a', to: 'lab/b' });
  });

  it('a second conversation asked for on the same tick is dropped, the first one wins', () => {
    const c = chapter([row('one', 1, 'brain', 'a'), row('two', 1, 'brain', 'b')], [trigger(2, 'one'), trigger(3, 'two', 232, 182)]);
    const r = step(c, place(startChapter(c), 240, 190), NONE);
    expect(r.state.dialogue?.id).toBe('one');
    expect(r.events.filter((e) => e.type === 'dialogueOpened')).toHaveLength(1);
  });

  it('a once trigger whose conversation was dropped on the same tick is given back, and fires after a step off and on', () => {
    const c = chapter([row('one', 1, 'brain', 'a'), row('two', 1, 'brain', 'b')], [trigger(2, 'one'), trigger(3, 'two', 232, 182)]);
    const r = step(c, place(startChapter(c), 240, 190), NONE);
    expect(r.state.dialogue?.id).toBe('one');
    expect(r.state.run.fired).toEqual(['lab/room#2']);
    const away = step(c, place(finishTalk(c, r.state), 20, 20), NONE).state;
    const back = step(c, place(away, 240, 190), NONE);
    expect(back.state.dialogue?.id).toBe('two');
    expect(back.state.run.fired).toEqual(['lab/room#2', 'lab/room#3']);
  });

  it('a once trigger whose lines are all skipped is not used up', () => {
    const c = chapter([row('c', 1, 'brain', 'never', { condition: 'cold' })], [trigger(2, 'c')]);
    const r = step(c, place(startChapter(c), 232, 182), NONE);
    expect(r.state.dialogue).toBeNull();
    expect(r.state.run.fired).toEqual([]);
  });

  it('a checkpoint punched on the same tick does not keep a skipped once trigger used up', () => {
    const punch = { id: 3, type: 'Trigger', x: 200, y: 150, width: 64, height: 64, properties: [p('event', 'checkpoint')] };
    const c = chapter([row('c', 1, 'brain', 'never', { condition: 'cold' })], [trigger(2, 'c'), punch]);
    const r = step(c, place(startChapter(c), 232, 182), NONE);
    expect(r.events).toContainEqual({ type: 'checkpointSaved', room: 'lab/room' });
    expect(r.state.dialogue).toBeNull();
    expect(r.state.run.checkpoint?.fired).toEqual([]);
    expect(resumeChapter(c, r.state.run.checkpoint!).run.fired).toEqual([]);
  });

  it('an NPC pressed on the tick a trigger fires loses to the trigger: the first request of a tick wins', () => {
    const c = chapter([row('one', 1, 'brain', 'a'), row('two', 1, 'brain', 'b')], [trigger(3, 'one', 288, 200), npc('two')]);
    const r = step(c, place(startChapter(c), 320, 232), PRESS);
    expect(r.state.dialogue?.id).toBe('one');
    expect(r.events.filter((e) => e.type === 'dialogueOpened')).toEqual([{ type: 'dialogueOpened', dialogueId: 'one' }]);
  });

  it('a line after a reply is judged by the tags the reply has just set', () => {
    const c = chapter([
      row('c', 1, 'brain', 'q'),
      row('c', 2, 'operator', 'yes', { effect: 'tag:deadline', next: 10 }),
      row('c', 3, 'operator', 'no', { next: 10 }),
      row('c', 10, 'brain', 'only with the deadline', { condition: 'deadline', next: 'end' }),
      row('c', 11, 'brain', 'otherwise'),
    ], [npc('c')]);
    const choice = press(c, step(c, place(startChapter(c), 320, 240), PRESS).state).state;
    expect(selectDialogue(c.dialogues, press(c, choice).state.dialogue)!.line!.text).toBe('only with the deadline');
    expect(selectDialogue(c.dialogues, press(c, press(c, choice, { ...NONE, menuStep: 1 }).state).state.dialogue)!.line!.text).toBe('otherwise');
  });

  it('the same inputs replay to the same state, and another choice to another', () => {
    const play = (menu: -1 | 0 | 1) => {
      const { c, s } = talking();
      let cur = step(c, s, PRESS).state;
      cur = press(c, cur).state;
      cur = press(c, cur, { ...NONE, menuStep: menu }).state;
      return stateHash(finish(c, press(c, cur).state).state);
    };
    expect(play(1)).toBe(play(1));
    expect(play(1)).not.toBe(play(0));
  });

  it('the state hash covers the open conversation', () => {
    const { c, s } = talking();
    const open = step(c, s, PRESS).state;
    expect(stateHash(open)).not.toBe(stateHash({ ...open, dialogue: null }));
    expect(stateHash(open)).not.toBe(stateHash({ ...open, dialogue: { ...open.dialogue!, age: open.dialogue!.age + 1 } }));
  });
});
