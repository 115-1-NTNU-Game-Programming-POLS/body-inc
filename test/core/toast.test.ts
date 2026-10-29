import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOSSES, DECKS, DIALOGUES, ENEMIES, PARAMS, RESCUES, STRINGS, TAGS } from '../../src/app/content.ts';
import { tagsFromQuery } from '../../src/app/session.ts';
import {
  amount, arrivalPoint, bossStringKeys, boxAt, BossTableError, createGame, FOLDER, holds, leaveNode, loadBossTable, NO_INPUT, openDialogue, parseRoom,
  readContent, roomsOf, selectBoss, selectDialogue, STAMP, STAMP_LAND, startChapter, stateHash, step, stepChapter, TELEGRAPH, TILE, workOrders,
  type CaffeineParams, type ChapterContent, type ChapterState, type DomainEvent, type EnemyState, type EnteredRoom, type GameEvent,
  type GameState, type Shot, type TickInput, type TiledMap, type ToastDef, type ToastState,
} from '../../src/core/index.ts';
import { OPERATOR_BODY, OPERATOR_HURT } from '../../src/core/combat/operator.ts';
import { compileCondition } from '../../src/core/tags/dictionary.ts';

const PARAMS_C = JSON.parse(readFileSync('content/params.json', 'utf8')).defaults as CaffeineParams;
const RAW = JSON.parse(readFileSync('content/bosses/toast.json', 'utf8'));
const CAFFEINE_RAW = JSON.parse(readFileSync('content/bosses/caffeine.json', 'utf8'));
const DEF = BOSSES.get('toast') as ToastDef;
const HOME = { x: 320, y: 168 };
/** Four tiles straight below him, so the aimed shot of each ring comes straight down. */
const NEAR = { x: HOME.x, y: HOME.y + 4 * TILE };

function arena(start: { x: number; y: number }, type = 'toast'): EnteredRoom {
  const cols = 20;
  const rows = 12;
  const solid = Array.from({ length: cols * rows }, (_, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    return c === 0 || r === 0 || c === cols - 1 || r === rows - 1;
  });
  return {
    id: 'venue', grid: { cols, rows, solid }, props: {}, variants: [], active: [],
    objects: [
      { id: 1, kind: 'PlayerStart', name: '', x: start.x, y: start.y, width: 0, height: 0, props: {}, conditions: {} },
      { id: 10, kind: 'Spawn', name: '', ...HOME, width: 0, height: 0, conditions: {}, props: { enemyType: type, count: 1, respawnSeconds: 0, when: '' } },
    ],
  };
}

const fight = (start = NEAR, tool: 'stapler' | 'folder' = 'folder', gauge = 0): GameState =>
  createGame(arena(start), 1, ENEMIES, { bosses: BOSSES, tool, gauge });
const boss = (s: GameState) => s.enemies.find((e) => e.boss)! as EnemyState & { readonly boss: ToastState };
const withBoss = (s: GameState, b: Partial<ToastState>, e: Partial<EnemyState> = {}): GameState =>
  ({ ...s, enemies: s.enemies.map((x) => (x.boss ? { ...x, ...e, boss: { ...(x.boss as ToastState), ...b } } : x)) });
const press = (extra: Partial<TickInput> = {}): TickInput => ({ ...NO_INPUT, ...extra });

interface Run { state: GameState; states: GameState[]; events: DomainEvent[][] }
function run(state: GameState, ticks: number, input: (t: number, s: GameState) => TickInput = () => NO_INPUT): Run {
  const events: DomainEvent[][] = [];
  const states: GameState[] = [];
  let s = state;
  for (let t = 0; t < ticks; t++) {
    const r = step(s, input(t, s));
    s = r.state;
    states.push(s);
    events.push([...r.events]);
  }
  return { state: s, states, events };
}
const ticksOf = (r: Run, type: DomainEvent['type']) => r.events.flatMap((es, t) => (es.some((e) => e.type === type) ? [t] : []));
const ofType = <T extends DomainEvent['type']>(r: Run, type: T) =>
  r.events.flat().filter((e): e is Extract<DomainEvent, { type: T }> => e.type === type);

/** A toast shot of `wave` sitting on the operator's hurtbox and moving gently down, so it comes from the north. */
function onOperator(s: GameState, id: number, wave: number): Shot {
  const hurt = boxAt(OPERATOR_HURT, s.operator.x, s.operator.y);
  const vy = 0.5;
  return {
    id, owner: boss(s).id, kind: 'toast', x: (hurt.left + hurt.right) / 2, y: (hurt.top + hurt.bottom) / 2 - vy, vx: 0, vy,
    ticksLeft: 60, halves: 0, cups: 1, wave, half: 4, spent: false,
  };
}
const guarding = (s: GameState): GameState =>
  ({ ...s, operator: { ...s.operator, tool: 'folder', aim: { x: 0, y: -1 }, action: { kind: 'guard', frame: 0 }, held: FOLDER.holdTicks } });

describe('the toast boss definition (design doc 7.7)', () => {
  const load = (edit: (raw: typeof RAW) => void, caffeine = CAFFEINE_RAW) => {
    const raw = structuredClone(RAW);
    edit(raw);
    return () => loadBossTable([caffeine, raw], ENEMIES, PARAMS_C);
  };

  it('loads the song in ticks: three rounds quickening, a 3 s breath, a ring of twelve', () => {
    expect(DEF.behaviour).toBe('toast');
    expect(DEF.budget).toBe(150);
    expect(DEF.wakeDistance).toBe(7 * TILE);
    expect(DEF.introTicks).toBe(90);
    expect(DEF.rounds).toEqual([{ lines: 4, beatTicks: 96 }, { lines: 5, beatTicks: 78 }, { lines: 6, beatTicks: 60 }]);
    expect(DEF.breathTicks).toBe(180);
    expect(DEF.breathDamageFactor).toBe(2);
    expect(DEF.ring).toEqual({ shots: 12, shotSpeed: 1.6, shotTicks: 180, cups: 1 });
    expect(DEF.workOrder).toEqual({ slowPerStack: 0.05, maxStacks: 3 });
    expect(DEF.concedeDialogue).toBe('liver.toast.concede');
  });

  it('refuses a beat that does not leave room for the whole tier-1 telegraph', () => {
    expect(load((r) => { r.song.rounds[1].beatSeconds = 0.5; })).toThrow(/round 2 beatSeconds must be longer than the 0\.5 s tier-1 telegraph/);
    expect(load((r) => { r.song.rounds[1].beatSeconds = 0.52; })).not.toThrow();
  });

  it('asks each behaviour for its own fields and refuses the other one\'s', () => {
    expect(load((r) => { delete r.song; })).toThrow(/a toast boss needs song/);
    expect(load((r) => { delete r.concedeDialogue; })).toThrow(/a toast boss needs concedeDialogue/);
    expect(load((r) => { r.drink = CAFFEINE_RAW.drink; })).toThrow(/drink belongs to another behaviour; a toast boss does not read it/);
    const caffeine = structuredClone(CAFFEINE_RAW);
    delete caffeine.summon;
    caffeine.workOrder = RAW.workOrder;
    const e = (() => { try { load(() => {}, caffeine)(); } catch (x) { return x as BossTableError; } return undefined; })();
    expect(e?.problems).toEqual([
      'boss "caffeine": a caffeine boss needs summon',
      'boss "caffeine": workOrder belongs to another behaviour; a caffeine boss does not read it',
    ]);
  });

  it('his intro offers the operator\'s reply of design doc 10.2, and both replies reach the tutorial line', () => {
    /** Spoken lines in order, taking reply `pick` (0-based) wherever replies are offered. */
    const walk = (id: string, pick: number): string[] => {
      const said: string[] = [];
      for (let s = openDialogue(DIALOGUES, id, () => true); s; s = leaveNode(DIALOGUES, s, () => true)) {
        if (s.options.length > 0) s = { ...s, cursor: pick };
        else said.push(DIALOGUES.get(id)!.lines[s.at]!.text);
      }
      return said;
    };
    const replies = (() => {
      const s = openDialogue(DIALOGUES, 'liver.toast.intro', () => true)!;
      return selectDialogue(DIALOGUES, leaveNode(DIALOGUES, s, () => true))!.options;
    })();
    expect(replies).toEqual(['我已經有家人了。', '我喝烏龍茶就好。']);
    for (const pick of [0, 1]) {
      const said = walk('liver.toast.intro', pick);
      expect(said[0]).toBe('乾了這杯，我們就是一家人！');
      expect(said).toHaveLength(3);
      expect(said[2]).toContain('婉拒');
    }
    expect(walk('liver.toast.intro', 0)[1]).not.toBe(walk('liver.toast.intro', 1)[1]);
    // Design doc 7.7's revised slogan, every clause, and rule 1 of section 11.2: he owns up to the reasonable use.
    const end = walk('liver.end', 0).join('');
    for (const clause of ['敬酒不勸酒', '說不要就是不要', '現場備有無酒精飲料', '未滿 18 歲不得供酒', '喝酒前先吃東西', '少量']) expect(end).toContain(clause);
    expect(walk('liver.end', 0).length).toBeLessThanOrEqual(3);
  });

  it('every nameplate string exists, and the concession is a real conversation that sets the tag the door waits on', () => {
    expect(bossStringKeys('toast', DEF)).toEqual(['boss.toast.name', 'boss.toast.stage.1', 'boss.toast.stage.2', 'boss.toast.stage.3', 'boss.toast.breath']);
    for (const k of bossStringKeys('toast', DEF)) expect(STRINGS.strings[k]).toBeDefined();
    for (const k of bossStringKeys('caffeine', BOSSES.get('caffeine')!)) expect(STRINGS.strings[k]).toBeDefined();
    const lines = DIALOGUES.get(DEF.concedeDialogue);
    expect(JSON.stringify(lines?.lines)).toContain('toast_conceded');
  });
});

describe('乾杯三巡: the song (design doc 7.7)', () => {
  it('telegraphs each line for the full tier-1 warning, then sends a ring with one shot aimed at the operator', () => {
    // Tick 0 wakes him (the operator starts close); the intro counts from tick 1.
    const r = run(fight(), DEF.introTicks + TELEGRAPH.tier1Ticks + 2);
    expect(ticksOf(r, 'telegraph')[0]).toBe(DEF.introTicks);
    expect(ofType(r, 'telegraph')[0]).toEqual({ type: 'telegraph', source: boss(r.state).id, tier: 1, move: 'toast' });
    const released = r.states.findIndex((s) => s.shots.length > 0);
    expect(released).toBe(DEF.introTicks + TELEGRAPH.tier1Ticks);
    const ring = r.states[released]!.shots;
    expect(ring).toHaveLength(12);
    expect(new Set(ring.map((s) => s.wave))).toEqual(new Set([1]));
    for (const s of ring) expect([s.kind, s.halves, s.cups, s.owner]).toEqual(['toast', 0, 1, boss(r.state).id]);
    const angles = ring.map((s) => Math.atan2(s.vy, s.vx)).sort((a, b) => a - b);
    for (let i = 1; i < angles.length; i++) expect(angles[i]! - angles[i - 1]!).toBeCloseTo((2 * Math.PI) / 12);
    // The operator is straight below him: the first shot of the ring comes straight down.
    expect(ring[0]!.vx).toBeCloseTo(0);
    expect(ring[0]!.vy).toBeCloseTo(DEF.ring.shotSpeed);
  });

  it('waits, silent, until the operator comes within the wake distance, then starts the intro', () => {
    // Exactly at the wake distance wakes him; a pixel further does not, however long the operator stands there.
    const at = { x: HOME.x - DEF.wakeDistance, y: HOME.y };
    const far = run(fight({ x: at.x - 1, y: at.y }), 600);
    expect(boss(far.state).boss.part).toBe('wait');
    expect(far.events.flat()).toEqual([]);
    expect(far.state.shots).toEqual([]);
    const near = run(fight(at), 2);
    expect(near.states.map((s) => [boss(s).boss.part, boss(s).boss.ticks])).toEqual([['intro', 0], ['intro', 1]]);
    // Walking in from far: the intro starts on the tick the operator crosses the distance.
    const walk = run(fight({ x: at.x - 20, y: at.y }), 120, () => press({ move: { x: 1, y: 0 } }));
    const woke = walk.states.findIndex((s) => boss(s).boss.part !== 'wait');
    expect(woke).toBeGreaterThan(0);
    expect(walk.states[woke]!.operator.x).toBeGreaterThanOrEqual(at.x);
    expect(walk.states[woke - 1]!.operator.x).toBeLessThan(at.x);
  });

  it('sings round by round at a quicker beat, breathes after each, and repeats the last round', () => {
    const lines: number[] = [];
    const breaths: number[] = [];
    let t = DEF.introTicks;
    for (const round of [0, 1, 2, 2]) {
      for (let i = 0; i < DEF.rounds[round]!.lines; i++) { lines.push(t); t += DEF.rounds[round]!.beatTicks; }
      breaths.push(t);
      t += DEF.breathTicks;
    }
    // Up in the north-west, inside the wake distance but off the line of the aimed shots' fall.
    const r = run(fight({ x: HOME.x - 6 * TILE, y: 2 * TILE }), t);
    expect(ticksOf(r, 'telegraph')).toEqual(lines);
    expect(ticksOf(r, 'bossBreath')).toEqual(breaths);
    expect(ofType(r, 'bossRound').map((e) => e.round)).toEqual([2, 3]);
    expect(ofType(r, 'bossBreath')[0]!.seconds).toBe(3);
    // Fifteen lines then a repeat of the six-line third round: 21 rings, one wave id each.
    expect(lines).toHaveLength(21);
    expect(boss(r.state).boss.waves).toBe(21);
    const waves = new Set(r.states.flatMap((s) => s.shots.map((sh) => sh.wave)));
    expect([...waves].sort((a, b) => a! - b!)).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
    expect(boss(r.state).boss.stage).toBe(3);
    expect(selectBoss(withBoss(r.state, { part: 'breath' }))!.breathing).toBe(true);
    expect(selectBoss(r.state)!.caffeine).toBeUndefined();
  });

  it('a landed wave costs no heart and no freeze, only a cup', () => {
    const r = run(fight(), 400);
    const landed = ticksOf(r, 'toasted');
    expect(landed.length).toBeGreaterThan(0);
    expect(ofType(r, 'toasted')[0]).toEqual({ type: 'toasted', source: boss(r.state).id, cups: 1 });
    expect(ofType(r, 'heartLost')).toEqual([]);
    expect(ofType(r, 'freeze')).toEqual([]);
    expect(r.state.operator.halves).toBe(fight().operator.halves);
  });

  it('a ring lands at most one cup, however many of its shots touch the operator; another wave lands its own', () => {
    const g = fight();
    const s = { ...g, shots: [onOperator(g, 100, 7), onOperator(g, 101, 7), onOperator(g, 102, 8)] };
    const r = run(s, 1);
    expect(ofType(r, 'toasted')).toHaveLength(2);
    // The second shot of wave 7 is spent and flies on harmlessly.
    expect(r.state.shots.map((x) => [x.id, x.spent])).toEqual([[101, true]]);
    expect(ofType(run(r.state, 1), 'toasted')).toEqual([]);
  });

  it('a raised guard refuses the wave, once per ring, and a refusal does not touch his budget', () => {
    const g = guarding(fight());
    const s = { ...g, shots: [onOperator(g, 100, 7), onOperator(g, 101, 7), onOperator(g, 102, 8)] };
    const r = run(s, 1, () => press({ attack: true }));
    expect(ofType(r, 'refused').map((e) => e.source)).toEqual([boss(g).id, boss(g).id]);
    expect(ofType(r, 'toasted')).toEqual([]);
    expect(r.state.shots.map((x) => [x.id, x.spent])).toEqual([[101, true]]);
    expect(boss(r.state).hp).toBe(DEF.budget);
  });
});

describe('his weak point and his concession (design doc 7.7)', () => {
  /** First staple hit from the operator four tiles below, firing up. */
  const firstHit = (g: GameState) => {
    const r = run({ ...g, operator: { ...g.operator, aim: { x: 0, y: -1 } } }, 120, () => press({ attack: true, move: { x: 0, y: 0 } }));
    return ofType(r, 'hit')[0];
  };

  it('a staple counts once while he sings and twice while he breathes', () => {
    const singing = withBoss(fight(NEAR, 'stapler'), { part: 'sing', ticks: 0, line: 0, move: null });
    expect(firstHit(singing)?.hpLeft).toBe(DEF.budget - 1);
    const breathing = withBoss(fight(NEAR, 'stapler'), { part: 'breath', ticks: 0, move: null });
    expect(firstHit(breathing)?.hpLeft).toBe(DEF.budget - 2);
  });

  it('the stamp also counts double in the breath and opens no review: he has no proposal to reject', () => {
    const g = withBoss(fight({ x: HOME.x, y: HOME.y + TILE }, 'stapler', STAMP.gaugeMax), { part: 'breath', ticks: 0, move: null });
    const r = run(g, STAMP_LAND + 2, (t) => press({ stampPressed: t === 0 }));
    expect(ofType(r, 'hit')[0]?.hpLeft).toBe(DEF.budget - 2 * 40);
    expect(ofType(r, 'proposalRejected')).toEqual([]);
  });

  it('at zero he gives up instead of being closed: no close-out, his waves vanish, the song stops', () => {
    const g0 = withBoss(fight(NEAR, 'stapler'), { part: 'sing', ticks: 0, line: 0, move: null }, { hp: 1 });
    const far: Shot = { ...onOperator(g0, 100, 9), x: 40, y: 40, vx: 0.1, vy: 0 };
    const g = { ...g0, operator: { ...g0.operator, aim: { x: 0, y: -1 } }, shots: [far] };
    const r = run(g, 120, () => press({ attack: true }));
    expect(ofType(r, 'bossConceded')).toEqual([{ type: 'bossConceded', target: boss(g).id, enemy: 'toast' }]);
    expect(ofType(r, 'bossDefeated')).toEqual([]);
    expect(ofType(r, 'caseClosed')).toEqual([]);
    const at = ticksOf(r, 'bossConceded')[0]!;
    expect(r.states[at]!.shots).toEqual([]);
    expect(boss(r.state).phase).toBe('closed');
    expect(ticksOf(run(r.state, 400), 'telegraph')).toEqual([]);
    expect(selectBoss(r.state)!.breathing).toBe(false);
  });

  it('replays to the same hash', () => {
    const go = () => stateHash(run(fight(NEAR, 'stapler'), 900, (t) => press({ attack: t % 200 < 120 })).state);
    expect(go()).toBe(go());
  });
});

describe('alcohol work orders (design doc 7.7)', () => {
  it('one per waiting cup once he is awake, at most three, five percent each; his breath does not lift them', () => {
    expect(workOrders(withBoss(fight(), { part: 'breath' }), 2)).toEqual({ stacks: 2, slow: 0.1 });
    expect(workOrders(fight(), 2)).toEqual({ stacks: 0, slow: 0 });
    const g = run(fight(), 1).state;
    expect(boss(g).boss.part).toBe('intro');
    expect(workOrders(g, 0)).toEqual({ stacks: 0, slow: 0 });
    expect(workOrders(g, 2)).toEqual({ stacks: 2, slow: 0.1 });
    expect(workOrders(g, 3)).toEqual({ stacks: 3, slow: 0.15 });
    expect(workOrders(g, 7)).toEqual({ stacks: 3, slow: 0.15 });
    expect(workOrders(withBoss(g, {}, { phase: 'closed' }), 2)).toEqual({ stacks: 0, slow: 0 });
    const caffeine = createGame(arena(NEAR, 'caffeine'), 1, ENEMIES, { bosses: BOSSES });
    expect(workOrders(caffeine, 2)).toEqual({ stacks: 0, slow: 0 });
  });
});

describe('the venue in the liver chapter', () => {
  const CHAPTER = readContent('chapter', JSON.parse(readFileSync('content/chapters/liver.json', 'utf8')));
  const loadMap = (path: string) => JSON.parse(readFileSync(`public/assets/maps/${path}.tmj`, 'utf8')) as TiledMap;
  const liver: ChapterContent = {
    chapter: CHAPTER,
    rooms: new Map(roomsOf(CHAPTER).map((p) => [p, parseRoom(p, loadMap(p), TAGS)])),
    dialogues: DIALOGUES, dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS, rescues: RESCUES, deck: DECKS.get('liver')!,
  };
  const ROOFTOP = 'liver/rooftop';
  const tags = (q: string) => tagsFromQuery(`?tags=${q}`, TAGS);
  function at(q = ''): ChapterState {
    const { pending: _, ...s } = startChapter(liver, { room: ROOFTOP, ...(q ? { tags: tags(q) } : {}) });
    return s;
  }
  const NONE: TickInput = { move: { x: 0, y: 0 } };
  /** The room as entered, then the tags set; the chapter start fills the glucose meter, so a low meter is set afterwards. */
  const later = (q: string): ChapterState => { const s = at(); return { ...s, run: { ...s.run, tags: tags(q) } }; };
  function go(s: ChapterState, input: TickInput, n: number): { state: ChapterState; events: GameEvent[] } {
    const events: GameEvent[] = [];
    for (let i = 0; i < n; i++) {
      const r = stepChapter(liver, s, input);
      s = r.state;
      events.push(...r.events);
    }
    return { state: s, events };
  }
  /** Talks through an open conversation with the interact key. */
  function talkThrough(s: ChapterState): { state: ChapterState; events: GameEvent[] } {
    const events: GameEvent[] = [];
    for (let i = 0; i < 40 && s.dialogue; i++) {
      const r = stepChapter(liver, s, { ...NONE, interactPressed: i % 2 === 0 });
      s = r.state;
      events.push(...r.events);
    }
    return { state: s, events };
  }
  const conceded = (s: ChapterState): ChapterState => ({
    ...s, game: { ...s.game, enemies: s.game.enemies.map((e) => (e.boss ? { ...e, hp: 0, phase: 'closed' as const } : e)) },
  });
  /** Wakes him as if the operator had come in, without walking through the intro trigger. */
  const singing = (s: ChapterState): ChapterState => ({ ...s, game: withBoss(s.game, { part: 'sing' }) });
  const eastDoor = liver.rooms.get(ROOFTOP)!.objects.find((o) => o.kind === 'Door' && o.props['socket'] === 'E')!;

  it('sits between the factory and the classmate, with the way on shut until he gives up', () => {
    expect(CHAPTER.links).toContainEqual({ a: 'liver/factory#door-e', b: 'liver/rooftop#door-w' });
    expect(CHAPTER.links).toContainEqual({ a: 'liver/rooftop#door-e', b: 'liver/corner#door-w' });
    expect([eastDoor.props['lock'], eastDoor.props['lockParam']]).toEqual(['resource', 'toast_conceded']);
    expect(at().game.enemies.map((e) => e.type)).toEqual(['toast']);
    expect(at('toast_conceded').game.enemies).toEqual([]);
  });

  it('his intro conversation opens before he wakes, whichever row the operator walks in on', () => {
    const room = liver.rooms.get(ROOFTOP)!;
    const westDoor = room.objects.find((o) => o.kind === 'Door' && o.props['socket'] === 'W')!;
    const arrival = arrivalPoint(westDoor, OPERATOR_BODY);
    // From the top floor row to the bottom one.
    for (const dy of [-3 * TILE, -TILE, 0, TILE, 3 * TILE]) {
      const s0 = at();
      let s: ChapterState = { ...s0, game: { ...s0.game, operator: { ...s0.game.operator, x: arrival.x, y: arrival.y + dy } } };
      for (let i = 0; i < 200 && !s.dialogue; i++) s = stepChapter(liver, s, { move: { x: 1, y: 0 } }).state;
      expect([dy, s.dialogue?.id]).toEqual([dy, 'liver.toast.intro']);
      expect(boss(s.game).boss.part).toBe('wait');
    }
  });

  it('his cups and the refusals of them are logged under his name, and a refusal counts like any other', () => {
    const withShot = (s: ChapterState, guard: boolean): ChapterState => {
      const g = guard ? guarding(s.game) : s.game;
      return { ...s, game: { ...g, shots: [onOperator(g, g.nextId, 1)], nextId: g.nextId + 1 } };
    };
    const keys = (s: ChapterState) => s.run.tags.log.nodes.map((n) => `${n.kind}:${n.key}`);
    const landed = go(withShot(singing(at()), false), NONE, 1).state;
    expect(keys(landed)).toContain('event:toast.toast');
    expect(keys(landed)).not.toContain('event:cheers.toast');
    expect(amount(landed.run.tags, TAGS, 'alcohol')).toBe(1);
    const refused = go(withShot(singing(at()), true), { ...NONE, attack: true }, 1);
    expect(keys(refused.state)).toContain('choice:refuse.toast');
    expect(keys(refused.state)).not.toContain('choice:refuse.cheers');
    expect(amount(refused.state.run.tags, TAGS, 'refusals')).toBe(1);
    expect(refused.events).toContainEqual({ type: 'refusalSaid', line: 1 });
  });

  it('cups waiting in receiving slow the operator once he is awake, under the 15% cap with dizziness', () => {
    // At the west door he still waits for the operator to come in: no work orders yet.
    expect(go(at('alcohol:2'), NONE, 1).state.game.operator.bodySlow).toBeUndefined();
    expect(go(singing(at('alcohol:2')), NONE, 1).state.game.operator.bodySlow).toBeCloseTo(0.1);
    expect(go(singing(at()), NONE, 1).state.game.operator.bodySlow).toBeUndefined();
    const both = go(singing(later('alcohol:5,glucose:30,fasting')), NONE, 1).state.game.operator.bodySlow;
    expect(both).toBeCloseTo(0.15 + 0.15);
    const walk = (q: string) => {
      // Down, away from the intro trigger by the west door, which would stop the room.
      const s = go(singing(later(q)), { move: { x: 0, y: 1 } }, 30).state;
      return s.game.operator.y;
    };
    // The cap of design doc 5.1 holds over the sum: dizzy with one work order and with three walk alike.
    expect(walk('alcohol:5,glucose:30,fasting')).toBeCloseTo(walk('alcohol:1,glucose:30,fasting'));
    expect(walk('alcohol:2')).toBeLessThan(walk('alcohol:1'));
    expect(walk('alcohol:1')).toBeLessThan(walk(''));
  });

  it('his concession opens the conversation that sets toast_conceded and opens the east door', () => {
    const first = go(conceded(at()), NONE, 1);
    expect(first.state.dialogue).not.toBeNull();
    expect(first.events).toContainEqual({ type: 'dialogueOpened', dialogueId: 'liver.toast.concede' });
    const talked = talkThrough(first.state);
    expect(holds(talked.state.run.tags, TAGS, compileCondition(TAGS, 'toast_conceded'))).toBe(true);
    const after = go(talked.state, NONE, 1).state;
    expect(after.game.unlocked).toContain(eastDoor.id);
    // Owed only once: a second tick with him still standing there opens nothing.
    expect(go(after, NONE, 5).state.dialogue).toBeNull();
  });

  it('a conversation already opening that tick does not lose the concession; it opens on the next', () => {
    const s = conceded(at());
    const talked = { ...s, run: { ...s.run, fired: [...s.run.fired, `${ROOFTOP}#concession`] } };
    expect(go(talked, NONE, 1).state.dialogue).toBeNull();
    // The key is what marks it shown; without it, it is still owed.
    expect(go(s, NONE, 1).state.dialogue).not.toBeNull();
  });

  it('a return to a checkpoint from before the concession brings him and his concession back', () => {
    const s0 = at();
    const cp = {
      chapter: 'liver', roomId: ROOFTOP, x: 64, y: 224, tags: s0.run.tags, clock: s0.game.clock,
      fired: [], switches: [], boxes: [], tools: s0.run.tools,
    };
    const talked = talkThrough(go(conceded(s0), NONE, 1).state).state;
    expect(talked.run.fired).toContain(`${ROOFTOP}#concession`);
    // Lose the last heart to a stray shot: the forced leave returns to the punch.
    const hurt = boxAt(OPERATOR_HURT, talked.game.operator.x, talked.game.operator.y);
    const shot: Shot = { id: 999, owner: 0, kind: 'cup', x: (hurt.left + hurt.right) / 2, y: (hurt.top + hurt.bottom) / 2, vx: 0, vy: 0.01, ticksLeft: 5, halves: 1, half: 4, spent: false };
    const dying: ChapterState = {
      ...talked,
      run: { ...talked.run, checkpoint: cp },
      game: { ...talked.game, shots: [shot], operator: { ...talked.game.operator, halves: 1 } },
    };
    const back = go(dying, NONE, 1);
    expect(back.events).toContainEqual(expect.objectContaining({ type: 'returnedToCheckpoint' }));
    expect(back.state.run.fired).not.toContain(`${ROOFTOP}#concession`);
    expect(holds(back.state.run.tags, TAGS, compileCondition(TAGS, 'toast_conceded'))).toBe(false);
    expect(back.state.game.enemies.map((e) => [e.type, e.phase])).toEqual([['toast', 'idle']]);
    expect(amount(back.state.run.tags, TAGS, 'alcohol')).toBe(0);
  });
});
