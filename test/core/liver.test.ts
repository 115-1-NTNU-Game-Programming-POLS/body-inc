import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOSSES, DECKS, DIALOGUES, ENEMIES, PARAMS, RESCUES, TAGS } from '../../src/app/content.ts';
import { tagsFromQuery } from '../../src/app/session.ts';
import {
  acetaldehydeCrates, amount, crateTiles, dockTiles, EMPTY_TAGS, GLUCOSE, holds, isDizzy, LOCK_TICKS, lineProgress, linesOf, loadRescues,
  MIST, offered, openRescue, outletTile, parseEffects, parseRoom, readContent, roomsOf, runLine, selectFactory, spiritAtEntry, startChapter,
  stepChapter, stepGlucose, TILE, waitingCrates,
  type ChapterContent, type ChapterState, type GameEvent, type TickInput, type TiledMap,
} from '../../src/core/index.ts';
import { applyEffects } from '../../src/core/chapter/effects.ts';
import { isSolid } from '../../src/core/collision/grid.ts';
import { OBJECT_CLASSES } from '../../src/core/rooms/classes.ts';
import { readRoom } from '../../src/core/rooms/tiled.ts';
import { compileCondition } from '../../src/core/tags/dictionary.ts';

const CHAPTER = readContent('chapter', JSON.parse(readFileSync('content/chapters/liver.json', 'utf8')));
const FACTORY = 'liver/factory';
const CORNER = 'liver/corner';
const loadMap = (path: string) => JSON.parse(readFileSync(`public/assets/maps/${path}.tmj`, 'utf8')) as TiledMap;
const liver: ChapterContent = {
  chapter: CHAPTER,
  rooms: new Map(roomsOf(CHAPTER).map((p) => [p, parseRoom(p, loadMap(p), TAGS)])),
  dialogues: DIALOGUES, dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS, rescues: RESCUES, deck: DECKS.get('liver')!,
};
const LINE = { liverRate: PARAMS.liverRate };

const tags = (q: string) => tagsFromQuery(`?tags=${q}`, TAGS);
const NONE: TickInput = { move: { x: 0, y: 0 } };

/** The chapter at a room with the intro skipped. */
function at(room: string, q = ''): ChapterState {
  const { pending: _, ...s } = startChapter(liver, { room, ...(q ? { tags: tags(q) } : {}) });
  return s;
}
const withTags = (s: ChapterState, q: string): ChapterState => ({ ...s, run: { ...s.run, tags: tags(q) } });
function place(s: ChapterState, x: number, y: number): ChapterState {
  return { ...s, game: { ...s.game, touching: [], operator: { ...s.game.operator, x, y } } };
}
function run(s: ChapterState, input: TickInput, n: number): { state: ChapterState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    const r = stepChapter(liver, s, input);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}
const spawned = (s: ChapterState) => s.game.boxes.filter((b) => b.id < 0);

describe('the first line (design doc 7.7)', () => {
  it('processes cups at the one fixed rate, and a crate leaves only once it is fully processed', () => {
    const t0 = tags('alcohol:2');
    const hour = runLine(t0, TAGS, 60, LINE, 0);
    expect(amount(hour.tags, TAGS, 'alcohol')).toBeCloseTo(2 - PARAMS.liverRate);
    expect(hour.converted).toBe(0);
    expect(waitingCrates(hour.tags, TAGS)).toBe(2);
    expect(lineProgress(hour.tags, TAGS)).toBeCloseTo(PARAMS.liverRate);
    const one = runLine(t0, TAGS, 60 / PARAMS.liverRate, LINE, 0);
    expect(one.converted).toBe(1);
    expect(waitingCrates(one.tags, TAGS)).toBe(1);
    expect(acetaldehydeCrates(one.tags, TAGS)).toBe(1);
    const all = runLine(t0, TAGS, 600, LINE, 0);
    expect(amount(all.tags, TAGS, 'alcohol')).toBe(0);
    expect(acetaldehydeCrates(all.tags, TAGS)).toBe(2);
  });

  it('nothing else the body carries changes the speed, and the log does not grow with the hours', () => {
    const base = runLine(tags('alcohol:3'), TAGS, 90, LINE, 0);
    for (const q of ['alcohol:3,caffeine:200', 'alcohol:3,sleep_debt:6', 'alcohol:3,fasting,roommate', 'alcohol:3,glucose:20,dizzy', 'alcohol:3,breakfast']) {
      expect(amount(runLine(tags(q), TAGS, 90, LINE, 0).tags, TAGS, 'alcohol'), q).toBe(amount(base.tags, TAGS, 'alcohol'));
    }
    let t = tags('alcohol:3');
    const lengths: number[] = [];
    for (let m = 0; m < 600; m += 7) {
      const r = runLine(t, TAGS, 7, LINE, m);
      t = r.tags;
      if (r.converted > 0) lengths.push(t.log.nodes.length);
    }
    expect(acetaldehydeCrates(t, TAGS)).toBe(3);
    expect(lengths).toHaveLength(3);
    expect(new Set(lengths).size).toBe(1);
  });

  it('time spent in the chapter runs the line: a clock effect turns cups into crates, and the room puts them out', () => {
    const s = at(FACTORY, 'alcohol:1');
    const out = applyEffects(TAGS, s.run.tags, s.game.clock, parseEffects('clock:120', TAGS).effects, { kind: 'event', key: 'test' }, PARAMS);
    expect(amount(out.tags, TAGS, 'alcohol')).toBe(0);
    expect(acetaldehydeCrates(out.tags, TAGS)).toBe(1);
    expect(spawned(s)).toEqual([]);
    expect(spawned(run({ ...s, run: { ...s.run, tags: out.tags } }, NONE, 1).state)).toHaveLength(1);
  });
});

describe('the factory room', () => {
  it('shows one alcohol crate per waiting cup on the dock, which is always solid', () => {
    const s = at(FACTORY, 'alcohol:2');
    const dock = dockTiles(s.game.room);
    expect(dock.length).toBeGreaterThanOrEqual(2);
    for (const t of dock) expect(isSolid(s.game.room.grid, t.col, t.row)).toBe(true);
    expect(selectFactory(s.game)?.crates).toEqual(crateTiles(s.game.room, 2));
    expect(selectFactory(s.game)?.crates).toHaveLength(2);
    // The count follows the tag every tick.
    expect(selectFactory(run(withTags(s, 'alcohol:1'), NONE, 1).state.game)?.crates).toHaveLength(1);
  });

  it('a staple on an alcohol crate only bounces, and the stamp is void next to one', () => {
    const s = at(FACTORY, 'alcohol:2');
    const [t] = crateTiles(s.game.room, 2);
    const below = place(s, (t!.col + 0.5) * TILE, (t!.row + 2.5) * TILE);
    const shot = run(run(below, { move: { x: 0, y: -1 } }, 1).state, { move: { x: 0, y: 0 }, attackPressed: true }, 30);
    expect(shot.events).toContainEqual(expect.objectContaining({ type: 'immuneBounce', enemy: 'alcohol_barrel' }));
    expect(shot.events.some((e) => e.type === 'hit')).toBe(false);
    expect(amount(shot.state.run.tags, TAGS, 'alcohol')).toBe(2);
    const empty = run(place(at(FACTORY), (t!.col + 0.5) * TILE, (t!.row + 2.5) * TILE), { move: { x: 0, y: -1 } }, 1).state;
    expect(run(empty, { move: { x: 0, y: 0 }, attackPressed: true }, 30).events.some((e) => e.type === 'immuneBounce')).toBe(false);
  });

  it('acetaldehyde crates come out at the outlet as boxes of their own type', () => {
    const s = at(FACTORY, 'acetaldehyde:2');
    const crates = spawned(s);
    expect(crates).toHaveLength(2);
    for (const b of crates) expect(b.boxType).toBe('acetaldehyde');
    const out = outletTile(s.game.room)!;
    for (const b of crates) expect(Math.abs(b.col - out.col) + Math.abs(b.row - out.row)).toBeLessThanOrEqual(2);
  });

  it('the fog costs half a heart for every 2 seconds without a break, and stepping out starts the count again', () => {
    const s = at(FACTORY, 'acetaldehyde:1');
    const [b] = spawned(s);
    const beside = place(s, (b!.col + 0.5) * TILE, (b!.row + 1.6) * TILE);
    expect(selectFactory(beside.game)?.inFog).toBe(true);
    const halves = beside.game.operator.halves;
    const almost = run(beside, NONE, MIST.intervalTicks - 1);
    expect(almost.state.game.operator.halves).toBe(halves);
    const hit = run(almost.state, NONE, 1);
    expect(hit.state.game.operator.halves).toBe(halves - MIST.halves);
    expect(hit.events).toContainEqual({ type: 'heartLost', halves: MIST.halves, cause: 'acetaldehyde' });
    // Out of the fog and back: the count starts again.
    const back = place(run(place(almost.state, 4 * TILE, 7.5 * TILE), NONE, 1).state, beside.game.operator.x, beside.game.operator.y);
    expect(run(back, NONE, MIST.intervalTicks - 1).state.game.operator.halves).toBe(halves);
  });

  it('a crate brought to rest on the second line is taken in and leaves the books', () => {
    const s = at(FACTORY, 'acetaldehyde:1');
    const intake = linesOf(s.game.room).intake!;
    const [b] = spawned(s);
    const col = Math.floor((intake.x + 1) / TILE);
    const row = Math.floor((intake.y + 1) / TILE);
    const moved = { ...s, game: { ...s.game, boxes: s.game.boxes.map((x) => (x.id === b!.id ? { ...x, col, row } : x)) } };
    const r = run(moved, NONE, 2);
    expect(r.events).toContainEqual({ type: 'crateTaken', object: b!.id, line: intake.id });
    expect(acetaldehydeCrates(r.state.run.tags, TAGS)).toBe(0);
    expect(spawned(r.state)).toEqual([]);
  });

  it('the east door waits for the line and nothing else', () => {
    const door = liver.rooms.get(FACTORY)!.objects.find((o) => o.kind === 'Door' && o.props['socket'] === 'E')!;
    expect(door.props['lock']).toBe('resource');
    const cond = compileCondition(TAGS, String(door.props['lockParam']));
    expect(holds(tags('alcohol:1'), TAGS, cond)).toBe(false);
    expect(holds(runLine(tags('alcohol:1'), TAGS, 600, LINE, 0).tags, TAGS, cond)).toBe(true);
  });

  it('the parser refuses a line room missing a stage, and an authored acetaldehyde box', () => {
    type Obj = { type: string; properties?: { name: string; value: unknown }[] };
    type Layer = { name: string; objects?: Obj[] };
    const map = loadMap(FACTORY);
    const layers = map.layers as unknown as Layer[];
    const objects = layers.find((l) => l.name === 'objects')!.objects!;
    const withObjects = (list: Obj[]) => ({ ...map, layers: layers.map((l) => (l.objects ? { ...l, objects: list } : l)) }) as unknown as TiledMap;
    const noIntake = withObjects(objects.filter((o) => !(o.type === 'Line' && o.properties?.some((p) => p.value === 'intake'))));
    expect(readRoom('factory', noIntake, TAGS).problems).toContainEqual(expect.objectContaining({ code: 'line-missing' }));
    const box = { id: 99, type: 'Box', x: 4 * TILE + 16, y: 8 * TILE + 16, width: 0, height: 0, point: true, properties: [{ name: 'boxType', value: 'acetaldehyde' }] };
    expect(readRoom('factory', withObjects([...objects, box]), TAGS).problems).toContainEqual(expect.objectContaining({ code: 'box-acetaldehyde' }));
    expect(readRoom('factory', map, TAGS).problems).toEqual([]);
  });
});

describe('the glycogen warehouse shut on an empty stomach (fact 31)', () => {
  const walk = (t: typeof EMPTY_TAGS, open: boolean, ticks: number) => {
    let walked = 0;
    const events: string[] = [];
    for (let i = 0; i < ticks; i++) {
      const r = stepGlucose(TAGS, t, walked, true, 0, open);
      t = r.tags;
      walked = r.walked;
      events.push(...r.events.map((e) => (e.type === 'dizzyChanged' ? `dizzy:${e.dizzy}` : e.type)));
    }
    return { t, events };
  };

  it('ships nothing, so the meter falls through the 35 line, sets dizzy once, and stops at its floor', () => {
    const r = walk(tags('glucose:40'), false, GLUCOSE.drainTicks * 30);
    expect(amount(r.t, TAGS, 'glucose')).toBe(GLUCOSE.shutFloor);
    expect(r.events).toEqual(['dizzy:true']);
    expect(isDizzy(r.t)).toBe(true);
    expect(holds(r.t, TAGS, compileCondition(TAGS, 'dizzy'))).toBe(true);
  });

  it('an open warehouse never lets it below the band, and reopening refills a dizzy meter at once', () => {
    expect(isDizzy(walk(tags('glucose:40'), true, GLUCOSE.drainTicks * 30).t)).toBe(false);
    const r = stepGlucose(TAGS, tags('glucose:31'), 0, false, 0, true);
    expect(amount(r.tags, TAGS, 'glucose')).toBe(GLUCOSE.refillTo);
    expect(r.events).toContainEqual({ type: 'dizzyChanged', dizzy: false });
  });

  it('in the chapter the warehouse shuts only for alcohol on an empty stomach, and dizziness slows the operator', () => {
    const fasting = withTags(at(FACTORY), 'alcohol:1,fasting,glucose:35');
    const walked = run(place(fasting, 4 * TILE, 7.5 * TILE), { move: { x: 1, y: 0 } }, GLUCOSE.drainTicks + 1).state;
    expect(isDizzy(walked.run.tags)).toBe(true);
    const next = run(walked, NONE, 1).state;
    expect(next.game.operator.slows).toEqual([GLUCOSE.dizzySlow]);
    const fed = withTags(at(FACTORY), 'alcohol:1,glucose:40');
    expect(isDizzy(run(place(fed, 4 * TILE, 7.5 * TILE), { move: { x: 1, y: 0 } }, GLUCOSE.drainTicks + 1).state.run.tags)).toBe(false);
  });
});

describe('the rescue cannot fail (design doc 7.7)', () => {
  const opened = (q = ''): ChapterState => {
    let s: ChapterState = { ...at(CORNER, q), rescue: openRescue(liver, 'akai') };
    for (let i = 0; i < LOCK_TICKS; i++) s = stepChapter(liver, s, NONE).state;
    return s;
  };
  const plan = RESCUES.get('akai')!;
  const INPUTS: TickInput[] = [
    NONE, { ...NONE, interactPressed: true }, { ...NONE, menuStep: 1 }, { ...NONE, menuStep: -1 },
    ...[1, 2, 3, 4, 5, 6, 7].map((pick) => ({ ...NONE, pick })),
  ];
  /** Picks the next correct step, then confirms: the way out from any state. */
  function solve(s: ChapterState): ChapterState {
    for (let i = 0; i < 10 && s.rescue; i++) {
      const r = s.rescue;
      const pick = r.done < plan.steps.length ? offered(plan, r.done).indexOf(plan.steps[r.done]!) + 1 : undefined;
      s = stepChapter(liver, s, pick ? { ...NONE, pick } : { ...NONE, interactPressed: true }).state;
    }
    return s;
  }

  it('from every state any input reaches, the panel stays open until all steps are done, and can still be finished', () => {
    const start = opened();
    const halves = start.game.operator.halves;
    const seen = new Map<string, ChapterState>();
    const keyOf = (s: ChapterState) => `${s.rescue?.done},${s.rescue?.cursor},${s.rescue?.reply?.kind},${s.run.tags.log.nodes.length}`;
    const queue = [start];
    seen.set(keyOf(start), start);
    while (queue.length > 0) {
      const s = queue.shift()!;
      for (const input of INPUTS) {
        const next = stepChapter(liver, s, input).state;
        expect(next.game.operator.halves).toBe(halves);
        expect(next.game.clock).toEqual(s.game.clock);
        if (!next.rescue) {
          expect(s.rescue!.done).toBe(plan.steps.length);
          expect(holds(next.run.tags, TAGS, compileCondition(TAGS, 'rescued'))).toBe(true);
          continue;
        }
        expect(next.rescue.done).toBeGreaterThanOrEqual(s.rescue!.done);
        const k = keyOf(next);
        if (!seen.has(k)) { seen.set(k, next); queue.push(next); }
      }
    }
    expect(seen.size).toBeGreaterThan(10);
    for (const s of seen.values()) expect(solve(s).rescue).toBeUndefined();
  });

  it('random presses never fail it either', () => {
    let seed = 7;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let n = 0; n < 40; n++) {
      let s = opened(n % 2 === 0 ? 'roommate' : '');
      for (let i = 0; i < 300 && s.rescue; i++) {
        const before = s.rescue;
        s = stepChapter(liver, s, INPUTS[Math.floor(rand() * INPUTS.length)]!).state;
        if (!s.rescue) expect(before.done).toBe(plan.steps.length);
      }
      expect(solve(s).rescue).toBeUndefined();
    }
  });

  it('a later step is answered with what comes first, a myth with why not, and neither counts', () => {
    const s = opened();
    const list = offered(plan, 0);
    const early = stepChapter(liver, s, { ...NONE, pick: list.indexOf('stay') + 1 }).state.rescue!;
    expect(early).toMatchObject({ done: 0, reply: { kind: 'early', action: 'stay', next: 'call_119' } });
    const myth = stepChapter(liver, s, { ...NONE, pick: list.indexOf('black_coffee') + 1 }).state.rescue!;
    expect(myth).toMatchObject({ done: 0, reply: { kind: 'myth', action: 'black_coffee' } });
  });

  it('the roommate stays with the classmate on their own once it is the next step', () => {
    let s = opened('roommate');
    for (const step of ['call_119', 'recovery_position']) s = stepChapter(liver, s, { ...NONE, pick: offered(plan, s.rescue!.done).indexOf(step) + 1 }).state;
    expect(s.rescue).toMatchObject({ done: 3, reply: { kind: 'step', action: 'recovery_position', helped: 'stay' } });
    let alone = opened();
    for (const step of ['call_119', 'recovery_position']) alone = stepChapter(liver, alone, { ...NONE, pick: offered(plan, alone.rescue!.done).indexOf(step) + 1 }).state;
    expect(alone.rescue).toMatchObject({ done: 2 });
  });

  it('finishing applies its effects as the rescue event, and the corner trigger opens it', () => {
    const done = solve(opened());
    expect(done.rescue).toBeUndefined();
    const node = done.run.tags.log.nodes.find((n) => n.key === 'rescue.akai');
    expect(node?.kind).toBe('event');
    const trigger = liver.rooms.get(CORNER)!.objects.find((o) => o.kind === 'Trigger' && o.props['event'] === 'rescue')!;
    const s = place(at(CORNER), trigger.x + trigger.width / 2, trigger.y + trigger.height / 2);
    const r = run(s, NONE, 2);
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'rescueOpened', rescue: 'akai' }));
    expect(r.state.rescue?.id).toBe('akai');
  });

  it('the loader refuses a helper whose step is not a step', () => {
    expect(() => loadRescues({ version: 1, rescues: [{ ...readContent('rescue', JSON.parse(readFileSync('content/rescue.json', 'utf8'))).rescues[0]!, helper: { when: 'roommate', step: 'black_coffee' } }] }, TAGS))
      .toThrow(/helper-step/);
  });
});

describe('alcohol is never a combat buff (design doc 5.1)', () => {
  it('more alcohol never raises spirit, hearts, gauge or speed on entry', () => {
    for (const base of ['', 'sleep_debt:2', 'caffeine:100', 'fasting']) {
      const sober = at(FACTORY, base);
      for (const cups of [1, 2, 5]) {
        const q = base ? `${base},alcohol:${cups}` : `alcohol:${cups}`;
        const drunk = at(FACTORY, q);
        expect(spiritAtEntry(tags(q), TAGS, PARAMS), q).toBeLessThanOrEqual(spiritAtEntry(tags(base), TAGS, PARAMS));
        expect(drunk.game.p, q).toBeLessThanOrEqual(sober.game.p);
        expect(drunk.game.operator.halves).toBe(sober.game.operator.halves);
        expect(drunk.game.operator.gauge).toBe(sober.game.operator.gauge);
        expect(drunk.game.operator.slows).toEqual(sober.game.operator.slows);
      }
    }
  });

  it('content cannot set alcohol, and a drink cannot come with a reward in the same effect', () => {
    const codes = (text: string, sources?: readonly string[]) => parseEffects(text, TAGS, sources).problems.map((p) => p.code);
    expect(codes('tag:alcohol=0')).toEqual(['alcohol-set']);
    expect(codes('tag:alcohol+1;grant:stamp')).toEqual(['alcohol-buff']);
    expect(codes('tag:alcohol+1;tag:caffeine+50', ['event', 'card'])).toContain('alcohol-buff');
    expect(codes('tag:alcohol+1;tag:sleep_debt=0', ['event', 'card'])).toContain('alcohol-buff');
    expect(codes('tag:alcohol+1;clock:10')).toEqual([]);
    expect(codes('tag:caffeine+50', ['event', 'card'])).toEqual([]);
  });

  it('there is no alcohol item to pick up', () => {
    const types = OBJECT_CLASSES['Pickup']!['itemType']!;
    expect(JSON.stringify(types)).toMatch(/handbook/);
    expect(JSON.stringify(types)).not.toMatch(/alcohol|beer|wine/);
  });
});
