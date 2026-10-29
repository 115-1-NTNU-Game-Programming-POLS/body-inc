import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOSSES, DIALOGUES, ENEMIES, FEEDBACK, HANDBOOK, PARAMS, STRINGS, TAGS } from '../../src/app/content.ts';
import { feedbackProblems, noteFields } from '../../src/app/feedback.ts';
import {
  amount, CHEERS, createGame, EMPTY_TAGS, FOLDER, GAUGE, loadEnemyTable, NO_INPUT, onRefusal, onToast, parseRoom, REFUSAL, startChapter,
  startClock, stateHash, step, stepChapter, TILE,
  type ChapterContent, type DomainEvent, type EnteredRoom, type GameEvent, type GameState, type TagState, type TickInput, type TiledMap,
} from '../../src/core/index.ts';

const TABLE = loadEnemyTable(JSON.parse(readFileSync('content/enemies.json', 'utf8')));
const START = { x: 320, y: 192 };

/** Open 20 x 12 room with a one-tile border; PlayerStart at (320, 192), a cheers kid three tiles to the right. */
function room(kids: { x: number; y: number }[] = [{ x: START.x + 3 * TILE, y: START.y }]): EnteredRoom {
  const cols = 20;
  const rows = 12;
  const solid = Array.from({ length: cols * rows }, (_, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    return c === 0 || r === 0 || c === cols - 1 || r === rows - 1;
  });
  return {
    id: 'test', grid: { cols, rows, solid }, props: {}, variants: [], active: [],
    objects: [
      { id: 1, kind: 'PlayerStart', name: '', ...START, width: 0, height: 0, props: {}, conditions: {} },
      ...kids.map((k, i) => ({
        id: 10 + i, kind: 'Spawn', name: '', x: k.x, y: k.y, width: 0, height: 0, conditions: {},
        props: { enemyType: 'cheers', count: 1, respawnSeconds: 0, when: '' },
      })),
    ],
  };
}

const game = (tool: 'stapler' | 'folder' = 'folder', kids?: Parameters<typeof room>[0]): GameState =>
  createGame(room(kids), 1, TABLE, { tool });
const press = (extra: Partial<TickInput> = {}): TickInput => ({ ...NO_INPUT, ...extra });

interface Run { state: GameState; events: DomainEvent[][] }
function run(state: GameState, ticks: number, input: (t: number, s: GameState) => TickInput = () => NO_INPUT): Run {
  const events: DomainEvent[][] = [];
  let s = state;
  for (let t = 0; t < ticks; t++) {
    const r = step(s, input(t, s));
    s = r.state;
    events.push([...r.events]);
  }
  return { state: s, events };
}
const ofType = <T extends DomainEvent['type']>(r: Run, type: T) =>
  r.events.flat().filter((e): e is Extract<DomainEvent, { type: T }> => e.type === type);
const firstTick = (r: Run, type: DomainEvent['type']) => r.events.findIndex((es) => es.some((e) => e.type === type));
const kid = (s: GameState) => s.enemies[0]!;
const distance = (s: GameState) => Math.hypot(kid(s).x - s.operator.x, kid(s).y - s.operator.y);
/** The tick the first wave reaches an operator who does nothing. */
const arrival = (g: GameState) => firstTick(run(g, 400), 'toasted');

/**
 * Runs to `raisedAt` doing nothing, then raises the guard there (frame 1 on that tick) facing the
 * kid, and holds it to the end. No swing comes first, so nothing but the guard meets the wave.
 */
function guardFrom(g: GameState, raisedAt: number, ticks: number, kidIndex = 0): Run {
  const before = run(g, raisedAt);
  const s = before.state;
  const k = s.enemies[kidIndex]!;
  const len = Math.hypot(k.x - s.operator.x, k.y - s.operator.y);
  const aim = { x: (k.x - s.operator.x) / len, y: (k.y - s.operator.y) / len };
  const up = { ...s, operator: { ...s.operator, aim, action: { kind: 'guard' as const, frame: 0 }, held: FOLDER.holdTicks } };
  const after = run(up, ticks - raisedAt, () => press({ attack: true }));
  return { state: after.state, events: [...before.events, ...after.events] };
}

describe('the cheers kid (design doc 7.7)', () => {
  it('walks round the operator on the ring instead of coming close or keeping away', () => {
    const r = run(game(), CHEERS.circleTicks - 1);
    expect(ofType(r, 'telegraph')).toEqual([]);
    expect(distance(r.state)).toBeGreaterThanOrEqual(CHEERS.nearPx);
    expect(distance(r.state)).toBeLessThanOrEqual(CHEERS.farPx);
    // Round, not along: he has moved a good way while the distance hardly changed.
    const moved = Math.hypot(kid(r.state).x - kid(game()).x, kid(r.state).y - kid(game()).y);
    expect(moved).toBeGreaterThan(TILE);
    expect(Math.abs(distance(r.state) - 3 * TILE)).toBeLessThan(TILE / 2);
  });

  it('closes in from beyond the ring and backs away from inside it', () => {
    const far = run(game('folder', [{ x: START.x + 8 * TILE, y: START.y }]), 20);
    expect(kid(far.state).x).toBeLessThan(START.x + 8 * TILE);
    const near = run(game('folder', [{ x: START.x + TILE, y: START.y }]), 20);
    expect(kid(near.state).x).toBeGreaterThan(START.x + TILE);
  });

  it('raises the cup for a tier-1 telegraph, then sends a toast wave that costs no heart', () => {
    const r = run(game(), CHEERS.circleTicks + CHEERS.windupTicks + 2);
    expect(firstTick(r, 'telegraph')).toBe(CHEERS.circleTicks - 1);
    expect(ofType(r, 'telegraph')).toEqual([{ type: 'telegraph', source: 1, tier: 1 }]);
    expect(r.state.shots).toHaveLength(1);
    expect(r.state.shots[0]).toMatchObject({ kind: 'toast', owner: 1, halves: 0, cups: CHEERS.cupsPerWave });
  });

  it('a wave that lands adds a cup and takes nothing else: no heart, no knockback, no freeze', () => {
    const g = game();
    const h = arrival(g);
    expect(h).toBeGreaterThan(CHEERS.circleTicks);
    const r = run(g, h + 1);
    expect(ofType(r, 'toasted')).toEqual([{ type: 'toasted', source: 1, cups: 1 }]);
    expect(ofType(r, 'heartLost')).toEqual([]);
    expect(ofType(r, 'freeze')).toEqual([]);
    expect(r.state.operator.halves).toBe(g.operator.halves);
    expect(r.state.operator.action.kind).toBe('free');
    expect(r.state.shots).toEqual([]);
  });

  it('dodge i-frames let a wave through: it flies on spent and adds nothing', () => {
    const g = game();
    const h = arrival(g);
    // In place, so it is the i-frames that meet the wave and not a step out of its way.
    const before = run(g, h).state;
    const dodging = { ...before, operator: { ...before.operator, action: { kind: 'dodge' as const, frame: 3, dir: { x: 0, y: 0 }, perfect: false } } };
    const r = run(dodging, 1);
    expect(ofType(r, 'toasted')).toEqual([]);
    expect(r.state.shots).toHaveLength(1);
    expect(r.state.shots[0]!.spent).toBe(true);
    expect(ofType(run(r.state, 10), 'toasted')).toEqual([]);
  });

  it('while hurt-invincible a wave passes on unspent, and lands once the invincibility is over', () => {
    const g = game();
    const h = arrival(g);
    const before = run(g, h).state;
    const r = run({ ...before, operator: { ...before.operator, invulnUntil: before.tick + 1 } }, 1);
    expect(ofType(r, 'toasted')).toEqual([]);
    expect(r.state.shots).toHaveLength(1);
    expect(r.state.shots[0]!.spent).toBe(false);
    expect(ofType(run(r.state, 1), 'toasted')).toHaveLength(1);
  });

  it('the guard after its parry window refuses a wave: no cup, no gauge, nothing sent back, one refusal counted', () => {
    const g = game();
    const h = arrival(g);
    const r = guardFrom(g, h - FOLDER.parryFrames, h + 1);
    expect(ofType(r, 'toasted')).toEqual([]);
    expect(ofType(r, 'refused')).toEqual([{ type: 'refused', source: 1, parry: false }]);
    expect(ofType(r, 'blocked')).toEqual([]);
    expect(r.state.operator.gauge).toBe(0);
    expect(r.state.projectiles).toEqual([]);
    expect(kid(r.state).hp).toBe(2);
  });

  it('inside the parry window a refusal also charges 15 x P, and still sends nothing back', () => {
    const g = game();
    const h = arrival(g);
    const r = guardFrom(g, h - 4, h + 1);
    expect(ofType(r, 'refused')).toEqual([{ type: 'refused', source: 1, parry: true }]);
    expect(ofType(r, 'parry')).toEqual([]);
    expect(r.state.operator.gauge).toBeCloseTo(GAUGE.parry, 10);
    expect(r.state.projectiles).toEqual([]);
  });

  it('a guard turned away does not refuse', () => {
    const g = game();
    const h = arrival(g);
    const before = run(g, h - 4);
    const s = before.state;
    const away = { ...s, operator: { ...s.operator, aim: { x: -1, y: 0 }, action: { kind: 'guard' as const, frame: 0 }, held: FOLDER.holdTicks } };
    const r = run(away, 5, () => press({ attack: true }));
    expect(ofType(r, 'refused')).toEqual([]);
    expect(ofType(r, 'toasted')).toHaveLength(1);
  });

  it('a refused wave from anyone but a cheers kid leaves the thrower alone', () => {
    // The toast boss of design doc 7.7 will throw waves too; refusing them must not count down his budget.
    const g = createGame({ ...room([]), objects: [...room([]).objects, {
      id: 11, kind: 'Spawn', name: '', x: START.x + 4 * TILE, y: START.y, width: 0, height: 0, conditions: {},
      props: { enemyType: 'salesman', count: 1, respawnSeconds: 0, when: '' },
    }] }, 1, TABLE, { tool: 'folder' });
    const wave = { id: 99, owner: g.enemies[0]!.id, kind: 'toast', x: START.x + 12, y: START.y - 4, vx: -4, vy: 0, ticksLeft: 20, halves: 0, cups: 1, half: 4, spent: false };
    const up = { ...g, shots: [wave], operator: { ...g.operator, aim: { x: 1, y: 0 }, action: { kind: 'guard' as const, frame: 20 }, held: FOLDER.holdTicks } };
    const r = run(up, 3, () => press({ attack: true }));
    expect(ofType(r, 'refused')).toHaveLength(1);
    expect(r.state.enemies[0]!.hp).toBe(g.enemies[0]!.hp);
  });

  it('three refusals send him off, which closes his case', () => {
    let s = game();
    const refused: number[] = [];
    let closedAt = -1;
    for (let t = 0; t < 900 && closedAt < 0; t++) {
      // Hold the guard facing him the whole time; every wave meets it.
      const k = kid(s);
      const len = Math.hypot(k.x - s.operator.x, k.y - s.operator.y) || 1;
      if (s.operator.action.kind !== 'guard') {
        s = { ...s, operator: { ...s.operator, action: { kind: 'guard', frame: 0 }, held: FOLDER.holdTicks } };
      }
      s = { ...s, operator: { ...s.operator, aim: { x: (k.x - s.operator.x) / len, y: (k.y - s.operator.y) / len } } };
      const r = step(s, press({ attack: true }));
      s = r.state;
      for (const e of r.events) {
        if (e.type === 'refused') refused.push(t);
        if (e.type === 'caseClosed') closedAt = t;
        expect(e.type).not.toBe('toasted');
      }
    }
    expect(refused).toHaveLength(3);
    expect(closedAt).toBe(refused[2]);
    expect(kid(s).phase).toBe('closed');
  });

  /** The stapler held on the kid, the operator turned to face him before every tick. */
  function holdFire(g: GameState, ticks: number): Run {
    const events: DomainEvent[][] = [];
    let s = g;
    for (let t = 0; t < ticks; t++) {
      const k = kid(s);
      const len = Math.hypot(k.x - s.operator.x, k.y - s.operator.y) || 1;
      s = { ...s, operator: { ...s.operator, aim: { x: (k.x - s.operator.x) / len, y: (k.y - s.operator.y) / len } } };
      const r = step(s, press({ attack: true, attackPressed: t === 0 }));
      s = r.state;
      events.push([...r.events]);
    }
    return { state: s, events };
  }

  it('weapons only make him back off: no damage, no gauge, and he gains distance', () => {
    const g = game('stapler');
    const r = holdFire(g, 20);
    expect(ofType(r, 'backedOff')).toHaveLength(1);
    expect(ofType(r, 'hit')).toEqual([]);
    expect(kid(r.state).hp).toBe(3);
    expect(r.state.operator.gauge).toBe(0);
    expect(kid(r.state).phase).toBe('recover');
    expect(distance(r.state)).toBeGreaterThan(distance(g));
  });

  it('a staple during his wind-up does not lower the cup: the wave still comes', () => {
    const before = run(game('stapler'), CHEERS.circleTicks).state;
    expect(kid(before).phase).toBe('windup');
    // A staple takes about 13 ticks to cross the three tiles; his wind-up lasts 30.
    const r = holdFire(before, CHEERS.windupTicks + 2);
    expect(ofType(r, 'backedOff')).toEqual([]);
    expect(r.state.shots.filter((s) => s.kind === 'toast')).toHaveLength(1);
  });

  it('backs off only for a while: held stapler fire neither keeps him back nor stops a raised cup', () => {
    // Once between two toasts: the staples after the first change nothing until he has toasted.
    const r = holdFire(game('stapler'), 900);
    const toasts = r.events.flatMap((es, t) => (es.some((e) => e.type === 'telegraph') ? [t] : []));
    const backs = r.events.flatMap((es, t) => (es.some((e) => e.type === 'backedOff') ? [t] : []));
    expect(backs.length).toBeGreaterThan(1);
    expect(toasts.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < backs.length; i++) expect(toasts.some((t) => t > backs[i - 1]! && t < backs[i]!)).toBe(true);
    // Every cup he raised was thrown and landed, staples or not; the last may still be in the air.
    expect(ofType(r, 'toasted').length).toBeGreaterThanOrEqual(toasts.length - 1);
  });

  it('a swing and the stamp only make him back off too', () => {
    const near = game('folder', [{ x: START.x + 20, y: START.y }]);
    const aimed = { ...near, operator: { ...near.operator, aim: { x: 1, y: 0 } } };
    const swing = run(aimed, 4, (t) => press({ attack: t === 0, attackPressed: t === 0 }));
    expect(ofType(swing, 'backedOff')).toHaveLength(1);
    expect(ofType(swing, 'hit')).toEqual([]);
    expect(swing.state.operator.gauge).toBe(0);
    const full = { ...aimed, operator: { ...aimed.operator, gauge: 100 } };
    const stamp = run(full, 30, (t) => press({ stampPressed: t === 0 }));
    expect(ofType(stamp, 'stampLanded')).toHaveLength(1);
    expect(ofType(stamp, 'backedOff')).toHaveLength(1);
    expect(kid(stamp.state).hp).toBe(3);
  });

  it('a forced leave brings him back with every refusal undone', () => {
    const g = game();
    const h = arrival(g);
    const r = guardFrom(g, h - 4, h + 1);
    expect(kid(r.state).hp).toBe(2);
    const dying = { ...r.state, operator: { ...r.state.operator, halves: 0 } };
    const after = run(dying, 1);
    expect(kid(after.state).hp).toBe(3);
  });

  it('replays to the same hash', () => {
    const g = game();
    const h = arrival(g);
    const hash = () => stateHash(guardFrom(g, h - 4, h + 200).state);
    expect(hash()).toBe(hash());
  });
});

describe('what a toast and a refusal do in the chapter', () => {
  const clock = startClock(1, 20);
  const refuseN = (n: number, tags: TagState = EMPTY_TAGS) => {
    const events: { type: string; line?: number; id?: string }[] = [];
    let t = tags;
    for (let i = 0; i < n; i++) {
      const out = onRefusal(TAGS, t, clock, 'cheers', PARAMS);
      t = out.tags;
      events.push(...out.events);
    }
    return { tags: t, events };
  };

  it('a wave that lands is a cup in receiving, logged as the toast', () => {
    const out = onToast(TAGS, EMPTY_TAGS, clock, { type: 'toasted', source: 1, cups: 1 }, 'cheers', PARAMS);
    expect(amount(out.tags, TAGS, 'alcohol')).toBe(1);
    expect(out.tags.log.nodes.map((n) => [n.kind, n.key])).toContainEqual(['event', 'cheers.toast']);
  });

  it('each refusal is counted and logged as a choice, and the operator says the lines in turn', () => {
    const { tags, events } = refuseN(REFUSAL.lines + 1);
    expect(amount(tags, TAGS, 'refusals')).toBe(REFUSAL.lines + 1);
    expect(tags.log.nodes.filter((n) => n.kind === 'choice' && n.key === 'refuse.cheers')).toHaveLength(REFUSAL.lines + 1);
    expect(events.filter((e) => e.type === 'refusalSaid').map((e) => e.line)).toEqual([...Array.from({ length: REFUSAL.lines }, (_, i) => i + 1), 1]);
  });

  it('the tenth refusal hands over the handbook page, once', () => {
    const nine = refuseN(CHEERS.refusalsForPage - 1);
    expect(nine.events.filter((e) => e.type === 'handbookUnlocked')).toEqual([]);
    const more = refuseN(3, nine.tags);
    expect(more.events.filter((e) => e.type === 'handbookUnlocked')).toEqual([{ type: 'handbookUnlocked', id: REFUSAL.page }]);
    expect(more.events[1]).toEqual({ type: 'handbookUnlocked', id: REFUSAL.page });
  });

  it('the page and every line it hands out exist', () => {
    const page = HANDBOOK.pages.find((p) => p.id === REFUSAL.page);
    expect(page).toBeDefined();
    for (const key of [`handbook.${REFUSAL.page}.title`, ...page!.body]) expect(STRINGS.strings[key]).toBeDefined();
    const fields = noteFields(ENEMIES);
    expect(feedbackProblems(FEEDBACK, STRINGS, fields)).toEqual([]);
    const { [`refusal.line.${REFUSAL.lines}`]: _, ...rest } = STRINGS.strings;
    expect(feedbackProblems(FEEDBACK, { ...STRINGS, strings: rest }, fields)).toEqual([
      `refusalSaid: note "refusal.line.${REFUSAL.lines}" is not in content/strings`,
    ]);
  });

  it('in a chapter a wave that lands raises alcohol and a refusal raises the count', () => {
    const p = (name: string, value: string | number | boolean) => ({ name, value });
    const map = {
      width: 20, height: 12, tilewidth: 32, tileheight: 32,
      properties: [p('organ', 'liver'), p('role', 'combat'), p('estSeconds', 10)],
      layers: [
        { type: 'tilelayer', name: 'walls', data: new Array(240).fill(0) },
        {
          type: 'objectgroup', name: 'objects', objects: [
            { id: 1, type: 'PlayerStart', x: START.x, y: START.y },
            { id: 2, type: 'Spawn', x: START.x + 3 * TILE, y: START.y, properties: [p('enemyType', 'cheers')] },
          ],
        },
      ],
    } as unknown as TiledMap;
    const ctx: ChapterContent = {
      chapter: { version: 1, id: 'lab', start: 'lab/a', links: [] },
      rooms: new Map([['lab/a', parseRoom('lab/a', map, TAGS)]]),
      dialogues: DIALOGUES, dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS,
    };
    let s = startChapter(ctx);
    const seen: GameEvent[] = [];
    for (let t = 0; t < 400 && !seen.some((e) => e.type === 'toasted'); t++) {
      const r = stepChapter(ctx, s, NO_INPUT);
      s = r.state;
      seen.push(...r.events);
    }
    expect(seen.some((e) => e.type === 'toasted')).toBe(true);
    expect(amount(s.run.tags, TAGS, 'alcohol')).toBe(1);
    // The liver's line works the cup off as the clock runs, so a refused wave shows as no rise.
    const alcohol = amount(s.run.tags, TAGS, 'alcohol');

    // The next wave meets a raised guard; the chapter starts with the stapler in hand.
    for (let t = 0; t < 400 && !seen.some((e) => e.type === 'refusalSaid'); t++) {
      const g = s.game;
      const k = g.enemies[0]!;
      const len = Math.hypot(k.x - g.operator.x, k.y - g.operator.y) || 1;
      const op = { ...g.operator, tool: 'folder' as const, aim: { x: (k.x - g.operator.x) / len, y: (k.y - g.operator.y) / len } };
      s = { ...s, game: { ...g, operator: g.operator.action.kind === 'guard' ? op : { ...op, action: { kind: 'guard', frame: 0 }, held: FOLDER.holdTicks } } };
      const r = stepChapter(ctx, s, press({ attack: true }));
      s = r.state;
      seen.push(...r.events);
    }
    expect(seen).toContainEqual({ type: 'refusalSaid', line: 1 });
    expect(amount(s.run.tags, TAGS, 'refusals')).toBe(1);
    expect(amount(s.run.tags, TAGS, 'alcohol')).toBeLessThanOrEqual(alcohol);
    expect(seen.filter((e) => e.type === 'toasted')).toHaveLength(1);
  });
});
