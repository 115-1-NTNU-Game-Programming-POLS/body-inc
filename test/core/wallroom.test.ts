import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHAPTERS, DIALOGUES, ENEMIES, BOSSES, PARAMS, TAGS } from '../../src/app/content.ts';
import { wallContent } from '../../src/app/wall.ts';
import {
  buildWall, DAY_SLOTS, LIVER_SLOTS, parseRoom, pinWall, readContent, roomsOf, runSemester, selectOperator, semesterReports, startChapter, stepChapter, WALL_DAYS,
  type ChapterContent, type ChapterState, type GameEvent, type ReportDocument, type ReportFile, type StringsFile, type TickInput, type TiledMap,
} from '../../src/core/index.ts';
import { readRoom } from '../../src/core/rooms/tiled.ts';
import { ARCHETYPES } from '../../sim/semester/archetypes.ts';
import { bingeTwice, bingeWeek, contextFor, crunchWeek } from '../../sim/semester/scenario.ts';

const readJson = (f: string): unknown => JSON.parse(readFileSync(`content/${f}`, 'utf8').replace(/^﻿/, ''));
const CFG: ReportFile = readContent('report', readJson('report.json'));
const STRINGS: StringsFile = readContent('strings', readJson('strings/zh-TW.json'));
const text = (k: string): string => {
  const s = STRINGS.strings[k];
  if (!s) throw new Error(`no string ${k}`);
  return s.text;
};

const MAP = JSON.parse(readFileSync('public/assets/maps/wall/hall.tmj', 'utf8')) as TiledMap;
const CHAPTER = CHAPTERS.get('wall')!;
const base: ChapterContent = {
  chapter: CHAPTER,
  rooms: new Map(roomsOf(CHAPTER).map((p) => [p, parseRoom(p, MAP, TAGS)])),
  dialogues: DIALOGUES, dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS,
};
const room = base.rooms.get('wall/hall')!;

const NONE: TickInput = { move: { x: 0, y: 0 } };
const line = (key: string, day: number, at: number, t: string) => ({ key, form: 'single' as const, text: t, firstDay: day, lastDay: day, at, generic: false });
const doc = (struck: string[], incident = [line('choice:drink', 4, 1, 'x')]): ReportDocument =>
  ({ kind: 'bankruptcy', number: '0702', lines: [], incident, unlock: 'alcohol_metabolism', theme: 'alcohol', generic: 0, struck });

describe('the wall room (art direction 7.6)', () => {
  it('is a 40 x 12 story room with the slots the game fills, and passes the room parser', () => {
    expect(room.grid.cols).toBe(40);
    expect(room.props['storyOnly']).toBe(true);
    const slots = room.objects.filter((o) => o.kind === 'EvidenceSlot');
    expect(slots).toHaveLength(WALL_DAYS * 2 * DAY_SLOTS + LIVER_SLOTS);
    expect(readRoom('wall/hall', MAP, TAGS).problems).toEqual([]);
  });

  const withObjects = (change: (objects: { id: number; properties?: { name: string; value: unknown }[] }[]) => void): string[] => {
    const m = JSON.parse(JSON.stringify(MAP)) as { layers: { name: string; objects?: never[] }[] };
    change(m.layers.find((l) => l.name === 'objects')!.objects as never);
    return readRoom('t', m as unknown as TiledMap, TAGS).problems.map((p) => `${p.code}${p.args?.['cell'] ? `:${p.args['cell']}` : ''}`);
  };

  it('reports a day track that lost a slot, and the liver board that lost one', () => {
    const lost = (name: string) => withObjects((o) => { o.splice(o.findIndex((x) => (x as unknown as { name: string }).name === name), 1); });
    expect(lost('slot-upper-3-2')).toEqual(['slot-count:upper/3']);
    expect(lost('slot-liver-8')).toEqual(['slot-count:liver']);
    // The last day is a cell like the others.
    expect(lost('slot-lower-10-3')).toEqual(['slot-count:lower/10']);
    expect(lost('slot-upper-1-1')).toEqual(['slot-count:upper/1']);
  });

  it('reports a slot numbered past the end of its track, even when the count is right', () => {
    const renumbered = withObjects((objs) => {
      const o = objs.find((x) => (x as unknown as { name: string }).name === 'slot-lower-4-3') as unknown as { properties: { name: string; value: unknown }[] };
      o.properties.find((p) => p.name === 'order')!.value = 4;
    });
    expect(renumbered).toEqual(['slot-count:lower/4']);
  });

  it('reports two slots with the same place, and a slot too many', () => {
    const copy = (name: string, set: (o: { id: number; properties: { name: string; value: unknown }[] }) => void) => withObjects((objs) => {
      const src = JSON.parse(JSON.stringify(objs.find((x) => (x as unknown as { name: string }).name === name))) as { id: number; properties: { name: string; value: unknown }[] };
      src.id = 900;
      set(src);
      objs.push(src as never);
    });
    expect(copy('slot-lower-5-1', () => undefined).sort()).toEqual(['slot-count:lower/5', 'slot-duplicate:lower/5']);
    // A fourth slot, numbered 4: no clash, but the day holds three.
    expect(copy('slot-upper-2-1', (o) => { o.properties.find((p) => p.name === 'order')!.value = 4; })).toEqual(['slot-count:upper/2']);
  });

  it('refuses a slot with no track', () => {
    const codes = withObjects((o) => { (o[0] as unknown as { properties: unknown[] }).properties = []; (o[0] as unknown as { class: string; type: string }).type = 'EvidenceSlot'; });
    expect(codes).toContain('required');
  });
});

describe('the liver board', () => {
  const orders = [2, 3, 4];
  const board = (d: ReportDocument, o = orders) => buildWall(d, CFG, text, o).nodes.filter((n) => n.lane === 'liver');

  it('holds one work order per day it came in, then the smiley note, on places 1 to n', () => {
    const nodes = board(doc(['liver']));
    expect(nodes.map((n) => [n.kind, n.slot, n.day])).toEqual([['order', 1, 2], ['order', 2, 3], ['order', 3, 4], ['smile', 4, 4]]);
    expect(nodes[0]!.text).toBe('第 2 天，一張工單送進肝臟部門');
  });

  it('is left off when the liver did not strike or sent no orders, and ignores orders after the emergency room', () => {
    expect(board(doc(['stomach']))).toEqual([]);
    expect(board(doc(['liver']), [])).toEqual([]);
    expect(board(doc(['liver']), [5, 8, 9]).filter((n) => n.kind === 'order').map((n) => n.day)).toEqual([5]);
  });

  it(`folds the earliest orders when there are more than ${LIVER_SLOTS - 1}, keeping the note on place ${LIVER_SLOTS}`, () => {
    const many = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const nodes = buildWall({ ...doc(['liver']), number: '1002' }, CFG, text, many).nodes.filter((n) => n.lane === 'liver');
    expect(nodes).toHaveLength(LIVER_SLOTS);
    expect(nodes.map((n) => n.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(nodes.at(-1)!.kind).toBe('smile');
    expect(nodes[6]!.folded).toBe(3);
    expect(nodes[6]!.text).toContain('第 7 天');
    expect(nodes[6]!.text).toContain('第 9 天');
  });

  it('joins the orders by red lines in time order, and the note to nothing', () => {
    const wall = buildWall(doc(['liver']), CFG, text, orders);
    const ids = wall.nodes.filter((n) => n.lane === 'liver').map((n) => n.id);
    expect(wall.links.filter(([a]) => ids.includes(a))).toEqual([[ids[0], ids[1]], [ids[1], ids[2]]]);
    expect(wall.links.some(([, b]) => b === ids[3])).toBe(false);
  });
});

describe('hanging a report on the room', () => {
  const docs: { name: string; doc: ReportDocument; orders: readonly number[] }[] = [];
  for (const [name, scenario] of [['binge week', bingeWeek(1)], ['twice', bingeTwice(1)], ['crunch', crunchWeek(1)]] as const) {
    const ctx = contextFor(0.5, 1, { scenario });
    for (const [who, strategy] of Object.entries(ARCHETYPES)) {
      for (const seed of [1, 2, 3]) {
        const end = runSemester(ctx, strategy, seed);
        for (const d of semesterReports(end, ctx, { cfg: CFG, text, seed })) docs.push({ name: `${name}/${who}/${seed}`, doc: d, orders: end.liverOrders });
      }
    }
  }

  it('finds a slot for every node of every report a semester can write, no two on one slot', () => {
    expect(docs.length).toBeGreaterThan(20);
    for (const { name, doc: d, orders } of docs) {
      const pinned = pinWall(buildWall(d, CFG, text, orders), room.objects);
      expect(new Set(pinned.map((p) => p.slot.id)).size, name).toBe(pinned.length);
      for (const p of pinned) {
        expect(p.slot.props['lane'], name).toBe(p.node.lane);
        if (p.node.lane !== 'liver') expect(p.slot.props['day'], name).toBe(p.node.day);
      }
    }
  });

  it('puts the track rows on the north wall face, one tile each, so the operator reads them from the floor', () => {
    for (const o of room.objects.filter((x) => x.kind === 'EvidenceSlot' && x.props['lane'] !== 'liver')) {
      expect([o.width, o.height]).toEqual([32, 32]);
      expect(o.y).toBe(o.props['lane'] === 'upper' ? 32 : 64);
    }
  });

  it('refuses a node whose day has no slot', () => {
    const wall = buildWall(doc(['liver']), CFG, text);
    const bad = { ...wall, nodes: [{ ...wall.nodes[0]!, day: 11 }] };
    expect(() => pinWall(bad, room.objects)).toThrow(/day 11/);
  });
});

describe('walking the wall chapter', () => {
  const content = wallContent(base, 'alcohol_metabolism');
  const run = (s: ChapterState, input: TickInput, n: number): { state: ChapterState; events: GameEvent[] } => {
    const events: GameEvent[] = [];
    for (let i = 0; i < n; i++) {
      const r = stepChapter(content, s, input);
      s = r.state;
      events.push(...r.events);
    }
    return { state: s, events };
  };

  it('puts the report\'s page on the desk, and nowhere else', () => {
    const picks = [...content.rooms.get('wall/hall')!.objects, ...base.rooms.get('wall/hall')!.objects].filter((o) => o.kind === 'Pickup');
    expect(picks.map((o) => o.props['itemId'])).toEqual(['alcohol_metabolism', 'sleep_debt']);
    expect(() => wallContent({ ...base, rooms: new Map() }, 'x')).toThrow(/exactly one/);
  });

  it('lets the operator walk from the entrance to the desk and take the page there, which unlocks it', () => {
    let s = startChapter(content);
    const start = selectOperator(s.game);
    expect(start.x).toBeLessThan(100);
    const desk = room.objects.find((o) => o.kind === 'Pickup')!;
    // Walks right along the floor until level with the desk; the east wall is 90 px further, so the walk has to stop on purpose.
    let ticks = 0;
    while (selectOperator(s.game).x < desk.x && ticks++ < 1000) s = run(s, { move: { x: 1, y: 0 } }, 1).state;
    expect(selectOperator(s.game).x).toBeGreaterThanOrEqual(desk.x);
    expect(selectOperator(s.game).x).toBeLessThan(desk.x + 20);
    const r = run(s, { ...NONE, interactPressed: true }, 2);
    expect(r.events).toContainEqual({ type: 'handbookUnlocked', id: 'alcohol_metabolism' });
  });

  it('keeps the operator out of the liver board and the desk, which stand on the floor', () => {
    let s = startChapter(content);
    s = { ...s, game: { ...s.game, operator: { ...s.game.operator, x: 31 * 32, y: 7 * 32 } } };
    const r = run(s, { move: { x: 0, y: -1 } }, 200);
    // Rows 4 and 5 are the board: the operator stops below row 6's top edge.
    expect(selectOperator(r.state.game).y).toBeGreaterThan(6 * 32);
  });

  it('does not end by itself: there is no door and no end trigger, so only the scene closes the wall', () => {
    expect(room.objects.filter((o) => o.kind === 'Door' || o.kind === 'Trigger')).toEqual([]);
    const r = run(startChapter(content), NONE, 300);
    expect(r.events.filter((e) => e.type === 'chapterEnded' || e.type === 'roomChanged')).toEqual([]);
  });
});
