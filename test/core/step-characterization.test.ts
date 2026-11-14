import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOSSES, DECKS, DIALOGUES, ENEMIES, EXAMS, PARAMS, RESCUES, TAGS } from '../../src/app/content.ts';
import { tagsFromQuery } from '../../src/app/session.ts';
import {
  BASE_PERKS, createGame, LOCK_TICKS, parseRoom, proposalOpen, readContent, roomsOf, selectGauge, startChapter, stateHash, step, stepChapter, TILE,
  type Assists, type ChapterContent, type ChapterState, type EnteredRoom, type GameState, type Perks, type TickInput, type TiledMap,
} from '../../src/core/index.ts';

/**
 * Characterization of `step` (issue #75): the exact behaviour of the current code, recorded so that
 * restructuring `step` can be shown to change nothing. Each scenario sets up a room through the
 * chapter layer, then drives `step` alone, tick by tick, with a scripted player (a seeded bot, below).
 * Every tick's state and events are hashed into a running chain, and the chain is stored every
 * `EVERY` ticks in step-characterization.json.
 *
 * These are not rule tests. They say nothing about what is right, only that the output did not move.
 * A refactor must leave the JSON byte for byte as it is. When a rule changes on purpose, regenerate it:
 *
 *     UPDATE_STEP_CHARACTERIZATION=1 npx vitest run test/core/step-characterization.test.ts
 *
 * and say in the pull request which scenarios moved and why; a refactor never regenerates it.
 */

const FIXTURE = 'test/core/step-characterization.json';
const EVERY = 30;
const UPDATE = process.env['UPDATE_STEP_CHARACTERIZATION'] === '1';

// ---------------------------------------------------------------------------------------------
// Content

const loadMap = (path: string) => JSON.parse(readFileSync(`public/assets/maps/${path}.tmj`, 'utf8')) as TiledMap;

/** A chapter's content, with `extra` rooms added for greybox rooms that no chapter links. */
function chapterContent(id: string, extra: readonly string[] = []): ChapterContent {
  const chapter = readContent('chapter', JSON.parse(readFileSync(`content/chapters/${id}.json`, 'utf8')));
  const paths = [...new Set([...roomsOf(chapter), ...extra])];
  const deck = DECKS.get(id);
  return {
    chapter, rooms: new Map(paths.map((p) => [p, parseRoom(p, loadMap(p), TAGS)])),
    dialogues: DIALOGUES, dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS, rescues: RESCUES, exams: EXAMS,
    ...(deck ? { deck } : {}),
  };
}

interface Opening {
  readonly chapter: string;
  readonly room: string;
  readonly tags?: string;
  readonly gauge?: number;
  readonly perks?: Perks;
  readonly seed?: number;
  /** Where to put the operator's feet, in tiles; the room's start when absent. */
  readonly at?: readonly [number, number];
}

/** The room as the chapter opens it, with the intro and any pending panel dropped. */
function open(o: Opening): GameState {
  const ctx = chapterContent(o.chapter, [o.room]);
  const { pending: _, ...s } = startChapter(ctx, {
    room: o.room, seed: o.seed ?? 1,
    ...(o.tags ? { tags: tagsFromQuery(`?tags=${o.tags}`, TAGS) } : {}),
    ...(o.gauge !== undefined ? { gauge: o.gauge } : {}),
    ...(o.perks ? { perks: o.perks } : {}),
  });
  const game = s.game;
  if (!o.at) return game;
  return { ...game, touching: [], operator: { ...game.operator, x: (o.at[0] + 0.5) * TILE, y: (o.at[1] + 0.5) * TILE } };
}

/** The midterm with the forecast read and closed, so the first question is open: the exam fight runs inside `step`. */
function seatedExam(): GameState {
  const ctx = chapterContent('midterm');
  const { pending: _, ...start } = startChapter(ctx, { room: 'midterm/exam-room', seed: 1 });
  let s: ChapterState = { ...start, game: { ...start.game, touching: [], operator: { ...start.game.operator, x: 4 * TILE + 16, y: 7 * TILE } } };
  const none: TickInput = { move: { x: 0, y: 0 } };
  s = stepChapter(ctx, s, none).state;
  for (let i = 0; i < LOCK_TICKS; i++) s = stepChapter(ctx, s, none).state;
  s = stepChapter(ctx, s, { ...none, interactPressed: true }).state;
  if (!s.game.exam) throw new Error('the exam did not begin');
  return s.game;
}

/** An open 20 x 12 room with a one-tile border, the operator at (160, 192), and the given spawns. */
function bareRoom(spawns: readonly { readonly type: string; readonly x: number; readonly y: number }[], pen?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }): EnteredRoom {
  const cols = 20;
  const rows = 12;
  const solid = Array.from({ length: cols * rows }, (_, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    return c === 0 || r === 0 || c === cols - 1 || r === rows - 1;
  });
  return {
    id: 'bare', grid: { cols, rows, solid }, props: {}, variants: [], active: [],
    objects: [
      { id: 1, kind: 'PlayerStart', name: '', x: 160, y: 192, width: 0, height: 0, props: {}, conditions: {} },
      ...(pen ? [{ id: 2, kind: 'Pen', name: '', ...pen, props: {}, conditions: {} }] : []),
      ...spawns.map((sp, i) => ({
        id: 10 + i, kind: 'Spawn', name: '', x: sp.x, y: sp.y, width: 0, height: 0, conditions: {},
        props: { enemyType: sp.type, count: 1, respawnSeconds: 0, when: '' },
      })),
    ],
  };
}

/** Steps the chapter, not `step` alone, until `done`: for a setup that needs the chapter's own reactions (a bed, a fog). */
function chapterUntil(ctx: ChapterContent, s: ChapterState, input: TickInput, done: (s: ChapterState) => boolean): ChapterState {
  for (let i = 0; i < 600; i++) {
    if (done(s)) return s;
    s = stepChapter(ctx, s, input).state;
  }
  throw new Error('the setup never got there');
}

/** The night lab with the operator lying in its sleep bed, the bar running. */
function asleepInNightLab(): GameState {
  const ctx = chapterContent('stomach');
  const { pending: _, ...start } = startChapter(ctx, { room: 'stomach/night-lab', seed: 1 });
  const bed = start.game.room.objects.find((o) => o.kind === 'Bed')!;
  const s: ChapterState = { ...start, game: { ...start.game, touching: [], operator: { ...start.game.operator, x: bed.x + bed.width / 2, y: bed.y + bed.height + 8 } } };
  return chapterUntil(ctx, s, { move: { x: 0, y: -1 }, interactPressed: true }, (c) => c.game.sleep !== undefined).game;
}

/** The night lab with the operator a tile and a half left of a chunk, aiming at it, so the acid lands on it. */
function besideChunk(): GameState {
  const g = open({ chapter: 'stomach', room: 'stomach/night-lab' });
  const chunk = g.room.objects.find((o) => o.kind === 'Chunk')!;
  return { ...g, touching: [], operator: { ...g.operator, x: chunk.x - 1.5 * TILE, y: chunk.y + chunk.height / 2 + 6, aim: { x: 1, y: 0 } } };
}

/** The liver factory with an acetaldehyde crate on its way, the operator standing in its fog. */
function inFactoryFog(): GameState {
  const g = open({ chapter: 'liver', room: 'liver/factory', tags: 'acetaldehyde:1' });
  const crate = g.boxes.find((b) => b.id < 0)!;
  return { ...g, touching: [], operator: { ...g.operator, x: (crate.col + 0.5) * TILE, y: (crate.row + 1.6) * TILE } };
}

/** A room with its boss brought down to `hp`, so the fight reaches the end, and what a closed boss leaves behind. */
function bossAt(o: Opening, hp: number): GameState {
  const g = open(o);
  return { ...g, enemies: g.enemies.map((e) => (e.boss ? { ...e, hp } : e)) };
}

// ---------------------------------------------------------------------------------------------
// The scripted player

interface Style {
  readonly seed: number;
  /** Chance per tick of starting to hold fire, and of letting go. */
  readonly fire: number;
  readonly dodge: number;
  /** Chance per tick of dodging while something winds up within 5 tiles. */
  readonly react: number;
  /** Chance per tick, once the gauge is full, of pressing the stamp. */
  readonly stamp: number;
  readonly swap: number;
  readonly partner: number;
  readonly interact: number;
  readonly assists?: Assists;
  /** The plans the player may pick (see `bot`); all six when absent. */
  readonly modes?: readonly number[];
  /** The kinds of object plan 5 walks to; any object when absent. */
  readonly goals?: readonly string[];
  /** Tap the attack key every this many ticks instead of holding it in bursts: folder combos. */
  readonly tap?: number;
  /** Swap tools on the first tick: start with the folder. */
  readonly folderFirst?: boolean;
  /** Keep the stamp for a caffeine boss's open proposal: walk to him while it is open, and stamp in reach. */
  readonly stampProposals?: boolean;
  /** Keep the stamp for a boss with shots or areas of his in play: walk to him then, and stamp in reach. */
  readonly stampMidAttack?: boolean;
}

const STYLE: Style = { seed: 1, fire: 0.08, dodge: 0.015, react: 0.08, stamp: 0.05, swap: 0.004, partner: 0.01, interact: 0.02 };

/** A small LCG of the test's own: the bot must not draw from the game's RNG. */
function lcg(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

const unit = (x: number, y: number) => {
  const d = Math.hypot(x, y);
  return d === 0 ? { x: 0, y: 0 } : { x: x / d, y: y / d };
};

/**
 * A player who changes plan every 45 ticks: walk at the nearest live enemy, back away, circle it,
 * pick a direction, stand still, or walk to some object of the room (a door, a lever, a box, a bed).
 * It holds fire in bursts, dodges at random and more often when something winds up close by,
 * stamps when the gauge is full, and now and then swaps, calls the partner and presses interact.
 */
function bot(style: Style): (s: GameState, t: number) => TickInput {
  const rnd = lcg(style.seed);
  let mode = 0;
  let dir = { x: 1, y: 0 };
  let goal: { x: number; y: number } | undefined;
  let holding = false;
  return (s, t) => {
    const op = s.operator;
    const live = s.enemies.filter((e) => e.phase !== 'closed' && e.phase !== 'dispersed');
    const near = live.reduce<(typeof live)[number] | undefined>((a, e) =>
      a === undefined || Math.hypot(e.x - op.x, e.y - op.y) < Math.hypot(a.x - op.x, a.y - op.y) ? e : a, undefined);
    if (t % 45 === 0) {
      const modes = style.modes ?? [0, 1, 2, 3, 4, 5];
      mode = modes[Math.floor(rnd() * modes.length)]!;
      dir = unit(rnd() * 2 - 1, rnd() * 2 - 1);
      const objects = s.room.objects.filter((o) => o.kind !== 'PlayerStart' && (style.goals === undefined || style.goals.includes(o.kind)));
      const o = objects.length > 0 ? objects[Math.floor(rnd() * objects.length)] : undefined;
      goal = o ? { x: o.x + o.width / 2, y: o.y + o.height / 2 } : undefined;
    }
    let move = { x: 0, y: 0 };
    if (mode === 0 && near) move = unit(near.x - op.x, near.y - op.y);
    else if (mode === 1 && near) move = unit(op.x - near.x, op.y - near.y);
    else if (mode === 2 && near) move = unit(-(near.y - op.y), near.x - op.x);
    else if (mode === 3) move = dir;
    else if (mode === 5 && goal) move = Math.hypot(goal.x - op.x, goal.y - op.y) < 4 ? { x: 0, y: 0 } : unit(goal.x - op.x, goal.y - op.y);
    const was = holding;
    if (rnd() < (holding ? style.fire / 2 : style.fire)) holding = !holding;
    if (style.tap !== undefined) holding = t % style.tap === 0;
    const threat = live.some((e) => e.phase === 'windup' && Math.hypot(e.x - op.x, e.y - op.y) < 5 * TILE);
    const gauge = selectGauge(s);
    let stamp = gauge.value >= gauge.max && rnd() < style.stamp;
    if (style.stampProposals) {
      const boss = live.find((e) => e.boss?.behaviour === 'caffeine');
      const def = boss ? s.bosses[boss.boss!.def] : undefined;
      const openNow = boss !== undefined && def?.behaviour === 'caffeine' && boss.boss?.behaviour === 'caffeine' && proposalOpen(def, boss.boss);
      stamp = false;
      if (openNow && gauge.value >= gauge.max) {
        move = unit(boss.x - op.x, boss.y - op.y);
        stamp = Math.hypot(boss.x - op.x, boss.y - op.y) < 2.5 * TILE;
      }
    }
    if (style.stampMidAttack) {
      const boss = live.find((e) => e.boss !== undefined);
      const busy = boss !== undefined && (s.shots.some((sh) => sh.owner === boss.id) || s.zones.some((z) => z.owner === boss.id));
      stamp = false;
      if (busy && gauge.value >= gauge.max) {
        move = unit(boss.x - op.x, boss.y - op.y);
        stamp = Math.hypot(boss.x - op.x, boss.y - op.y) < 3 * TILE;
      }
    }
    return {
      move,
      attack: holding,
      ...(holding && (!was || style.tap !== undefined) ? { attackPressed: true } : {}),
      ...(rnd() < (threat ? style.react : style.dodge) ? { dodgePressed: true } : {}),
      ...(stamp ? { stampPressed: true } : {}),
      ...((style.folderFirst && t === 0) || rnd() < style.swap ? { swapPressed: true } : {}),
      ...(rnd() < style.partner ? { partnerPressed: true } : {}),
      ...(rnd() < style.interact ? { interactPressed: true } : {}),
      ...(style.assists ? { assists: style.assists } : {}),
    };
  };
}

// ---------------------------------------------------------------------------------------------
// Scenarios

interface Scenario {
  readonly name: string;
  readonly start: () => GameState;
  readonly ticks: number;
  readonly style?: Partial<Style>;
}

const ALL_PERKS: Perks = { ...BASE_PERKS, bindHits: 3, bindSplash: 1, parryBind: 2, parryBoost: true };

const SCENARIOS: readonly Scenario[] = [
  { name: 'greybox room: salesman, flyer, adenosine, barrel, belt, lever, bed', start: () => open({ chapter: 'greybox', room: 'greybox/greybox-room' }), ticks: 2400, style: { react: 0.01 } },
  { name: 'brain tutorial: flyers and the energy seller', start: () => open({ chapter: 'brain', room: 'brain/tutorial' }), ticks: 1800, style: { seed: 2 } },
  { name: 'brain open office: adenosine, clinging and a forced nap', start: () => open({ chapter: 'brain', room: 'brain/open-office' }), ticks: 2400, style: { seed: 3, fire: 0.04 } },
  { name: 'caffeine boss through its stages, gauge full', start: () => open({ chapter: 'greybox', room: 'greybox/caffeine-arena', gauge: 100 }), ticks: 5400, style: { seed: 4, fire: 0.2, stamp: 0.2 } },
  { name: 'caffeine boss in the brain arena, with the pie', start: () => open({ chapter: 'brain', room: 'brain/arena', gauge: 100 }), ticks: 3600, style: { seed: 5, fire: 0.15, partner: 0.03 } },
  { name: 'toast boss on the liver rooftop', start: () => open({ chapter: 'liver', room: 'liver/rooftop' }), ticks: 3600, style: { seed: 6, fire: 0.12, swap: 0.01 } },
  { name: 'cheers kids at the liver party', start: () => open({ chapter: 'liver', room: 'liver/party' }), ticks: 2400, style: { seed: 7, swap: 0.02 } },
  { name: 'liver factory: belt, lines, crates and the fog', start: () => open({ chapter: 'liver', room: 'liver/factory', tags: 'alcohol:3' }), ticks: 2400, style: { seed: 8, interact: 0.05 } },
  { name: 'patrol core: adenosine and the rest-area pen', start: () => open({ chapter: 'patrol-brain', room: 'patrol-brain/core' }), ticks: 2400, style: { seed: 9, fire: 0.05 } },
  { name: 'patrol desk with every welfare perk: binding, splash, parry boost', start: () => open({ chapter: 'patrol-brain', room: 'patrol-brain/desk', perks: ALL_PERKS }), ticks: 2400, style: { seed: 10, fire: 0.15, swap: 0.02 } },
  { name: 'patrol stock with the assists on', start: () => open({ chapter: 'patrol-liver', room: 'patrol-liver/stock' }), ticks: 2400, style: { seed: 11, react: 0.02, assists: { halfDamage: true, neverEmpty: true, autoPerfect: true } } },
  { name: 'prologue warehouse: boxes, belts and the port', start: () => open({ chapter: 'prologue', room: 'prologue/warehouse' }), ticks: 2400, style: { seed: 12, fire: 0.02, interact: 0.05 } },
  { name: 'loading dock: boxes, belts and levers', start: () => open({ chapter: 'greybox', room: 'greybox/loading-dock' }), ticks: 2400, style: { seed: 13, fire: 0.06 } },
  { name: 'stomach mixer lab: the manager, sugar sellers, orders and the mixer', start: () => open({ chapter: 'stomach', room: 'stomach/mixer-lab' }), ticks: 3000, style: { seed: 14, fire: 0.12, partner: 0.03 } },
  { name: 'stomach night lab: courier, chunks, cold store and the bed', start: () => open({ chapter: 'stomach', room: 'stomach/night-lab' }), ticks: 3000, style: { seed: 15, partner: 0.03, interact: 0.04 } },
  { name: 'stomach sorting lab: fork belts and lever cooldowns', start: () => open({ chapter: 'stomach', room: 'stomach/sorting-lab' }), ticks: 2400, style: { seed: 16, fire: 0.1, interact: 0.05 } },
  { name: 'midterm exam fight', start: seatedExam, ticks: 3600, style: { seed: 17, fire: 0.15 } },
  { name: 'prologue boardroom: the dummy and the stamp', start: () => open({ chapter: 'prologue', room: 'prologue/boardroom', gauge: 100 }), ticks: 1200, style: { seed: 18, stamp: 0.3 } },
  // Targeted: paths the wandering player rarely reaches on its own.
  {
    name: 'one stamp over a salesman, a barrel, adenosine, a cheers kid, a dummy and a flyer',
    start: () => createGame(bareRoom([
      { type: 'salesman', x: 200, y: 192 }, { type: 'alcohol_barrel', x: 130, y: 170 }, { type: 'adenosine', x: 160, y: 230 },
      { type: 'cheers', x: 120, y: 205 }, { type: 'dummy', x: 185, y: 160 }, { type: 'flyer', x: 230, y: 215 },
    ]), 1, ENEMIES, { gauge: 100 }),
    ticks: 900, style: { seed: 19, stamp: 1, fire: 0.1, swap: 0.01 },
  },
  {
    name: 'caffeine boss with its proposals stamped, hearts never empty',
    start: () => open({ chapter: 'greybox', room: 'greybox/caffeine-arena', gauge: 100 }),
    ticks: 9000, style: { seed: 20, fire: 0.25, stampProposals: true, assists: { halfDamage: false, neverEmpty: true, autoPerfect: false } },
  },
  {
    name: 'standing among adenosine until a forced nap',
    start: () => createGame(bareRoom([{ type: 'adenosine', x: 100, y: 160 }, { type: 'adenosine', x: 220, y: 160 }, { type: 'adenosine', x: 160, y: 260 }, { type: 'adenosine', x: 250, y: 250 }]), 1, ENEMIES),
    ticks: 1800, style: { seed: 21, fire: 0, dodge: 0, swap: 0, partner: 0, interact: 0, modes: [4] },
  },
  {
    name: 'walking through adenosine under a full caffeine cloak',
    start: () => ({ ...createGame(bareRoom([{ type: 'adenosine', x: 220, y: 192 }, { type: 'adenosine', x: 300, y: 200 }, { type: 'adenosine', x: 380, y: 190 }]), 1, ENEMIES), senseCapPx: 0 }),
    ticks: 1200, style: { seed: 32, fire: 0, dodge: 0, swap: 0, partner: 0, interact: 0, modes: [3, 0] },
  },
  {
    name: 'adenosine drifting through a rest-area pen',
    start: () => createGame(bareRoom([{ type: 'adenosine', x: 200, y: 192 }, { type: 'adenosine', x: 205, y: 230 }], { x: 240, y: 32, width: 64, height: 320 }), 1, ENEMIES, { start: { x: 340, y: 200 } }),
    ticks: 1800, style: { seed: 22, fire: 0, dodge: 0, swap: 0, partner: 0, interact: 0, modes: [4] },
  },
  { name: 'folder combos against the manager and the sugar sellers', start: () => open({ chapter: 'stomach', room: 'stomach/mixer-lab' }), ticks: 3000, style: { seed: 23, tap: 9, folderFirst: true, swap: 0, modes: [0, 0, 2], dodge: 0.01 } },
  { name: 'the acid on a night-lab chunk', start: besideChunk, ticks: 900, style: { seed: 24, partner: 0.05, fire: 0.02, modes: [4] } },
  { name: 'asleep in the night lab until something wakes the operator', start: asleepInNightLab, ticks: 2400, style: { seed: 25 } },
  { name: 'the factory fog of an acetaldehyde crate', start: inFactoryFog, ticks: 1200, style: { seed: 26, modes: [4], dodge: 0, fire: 0.05 } },
  {
    name: 'guarding with the folder against salesmen, flyers, a can seller and cheers kids, every perk on',
    start: () => createGame(bareRoom([
      { type: 'salesman', x: 230, y: 192 }, { type: 'salesman', x: 100, y: 230 }, { type: 'flyer', x: 400, y: 192 },
      { type: 'energy_seller', x: 420, y: 300 }, { type: 'cheers', x: 300, y: 120 }, { type: 'cheers', x: 380, y: 250 },
    ]), 3, ENEMIES, { perks: ALL_PERKS }),
    ticks: 4800, style: { seed: 29, fire: 0.3, folderFirst: true, swap: 0.003, modes: [0, 2, 4], dodge: 0.005, react: 0 },
  },
  {
    name: 'caffeine boss finished off, with cups and zones in the air',
    start: () => bossAt({ chapter: 'greybox', room: 'greybox/caffeine-arena', gauge: 100 }, 4),
    ticks: 2400, style: { seed: 30, fire: 0, react: 0.02, stampMidAttack: true, assists: { halfDamage: false, neverEmpty: true, autoPerfect: false } },
  },
  {
    name: 'toast boss finished off, with waves in the air',
    start: () => bossAt({ chapter: 'liver', room: 'liver/rooftop', gauge: 100 }, 12),
    ticks: 2400, style: { seed: 31, fire: 0, react: 0.02, stampMidAttack: true, assists: { halfDamage: false, neverEmpty: true, autoPerfect: false } },
  },
  { name: 'night lab with a full gauge: stamps among orders and crates', start: () => open({ chapter: 'stomach', room: 'stomach/night-lab', gauge: 100 }), ticks: 3000, style: { seed: 27, stamp: 0.02, fire: 0.1 } },
  { name: 'liver factory with a full gauge: stamps by the crates', start: () => open({ chapter: 'liver', room: 'liver/factory', tags: 'alcohol:3', gauge: 100 }), ticks: 1500, style: { seed: 28, stamp: 0.05, modes: [5], goals: ['Line', 'Conveyor'] } },
];

/** The chain of one scenario: the running hash of every tick's state and events, kept every EVERY ticks and at the end. */
function chain(sc: Scenario): string[] {
  const play = bot({ ...STYLE, ...sc.style });
  let s = sc.start();
  let h = stateHash(s);
  const out: string[] = [];
  for (let t = 0; t < sc.ticks; t++) {
    const r = step(s, play(s, t));
    s = r.state;
    h = stateHash([h, stateHash(s), stateHash(r.events)]);
    if ((t + 1) % EVERY === 0 || t + 1 === sc.ticks) out.push(h);
  }
  return out;
}

const recorded: Record<string, string[]> = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, string[]> : {};
const fresh: Record<string, string[]> = {};

describe('step, characterized (issue #75)', () => {
  it('has one recorded chain per scenario and no stale ones', () => {
    if (UPDATE) return;
    expect(Object.keys(recorded).sort()).toEqual(SCENARIOS.map((s) => s.name).sort());
  });

  for (const sc of SCENARIOS) {
    it(sc.name, () => {
      const got = chain(sc);
      fresh[sc.name] = got;
      if (UPDATE) {
        if (Object.keys(fresh).length === SCENARIOS.length) writeFileSync(FIXTURE, `${JSON.stringify(fresh, null, 1)}\n`);
        return;
      }
      const want = recorded[sc.name] ?? [];
      const at = got.findIndex((h, i) => h !== want[i]);
      // Name the window where the output first moved, so a failing refactor points at a tick range.
      const where = at < 0 ? 'nowhere' : `ticks ${at * EVERY + 1} to ${Math.min((at + 1) * EVERY, sc.ticks)}`;
      expect({ diverges: where, length: got.length }).toEqual({ diverges: 'nowhere', length: want.length });
    });
  }
});
