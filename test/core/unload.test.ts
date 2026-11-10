import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOSSES, CHAPTERS, DIALOGUES, ENEMIES, PARAMS, RESCUES, TAGS } from '../../src/app/content.ts';
import {
  createGame, loadBossTable, loadEnemyTable, NO_INPUT, parseRoom, roomsOf, selectUnload, startChapter, step, stepChapter, TICK_HZ, TILE, UNLOAD, unloadBox,
  type ChapterContent, type ChapterFile, type DomainEvent, type EnteredRoom, type GameState, type TickInput, type TiledMap,
} from '../../src/core/index.ts';
import { shieldCovers } from '../../src/core/combat/actors.ts';
import { cardinalOf, stepUnload, UNLOAD_READY } from '../../src/core/combat/unload.ts';

const TABLE = loadEnemyTable(JSON.parse(readFileSync('content/enemies.json', 'utf8')));
const START = { x: 160, y: 192 };

/** Open 20 x 12 room with a one-tile border; PlayerStart at (160, 192). */
function room(spawns: { type: string; x: number; y: number }[] = [], start = START): EnteredRoom {
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
      { id: 1, kind: 'PlayerStart', name: '', ...start, width: 0, height: 0, props: {}, conditions: {} },
      ...spawns.map((s, i) => ({
        id: 10 + i, kind: 'Spawn', name: '', x: s.x, y: s.y, width: 0, height: 0, conditions: {},
        props: { enemyType: s.type, count: 1, respawnSeconds: 0, when: '' },
      })),
    ],
  };
}

const AIM = { right: { x: 1, y: 0 }, left: { x: -1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 } } as const;
const game = (spawns: Parameters<typeof room>[0] = [], aim: { x: number; y: number } = AIM.right, unload = true, start = START): GameState => {
  const g = createGame(room(spawns, start), 1, TABLE, unload ? { unload } : {});
  return { ...g, operator: { ...g.operator, aim } };
};
const press = (extra: Partial<TickInput> = {}): TickInput => ({ ...NO_INPUT, ...extra });
const raiseAtStart = (t: number) => press({ partnerPressed: t === 0 });

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
const ticksOf = (r: Run, type: DomainEvent['type']) => r.events.flatMap((es, t) => (es.some((e) => e.type === type) ? [t] : []));
const enemy = (s: GameState, type: string) => s.enemies.find((e) => e.type === type)!;

describe('the logistics chief\'s 強制卸貨 (design doc 6.2)', () => {
  it('L spits it once, ahead of the operator along his aim made four-way, and reports where', () => {
    const r = run(game(), 5, raiseAtStart);
    expect(ofType(r, 'unloadRaised')).toEqual([{ type: 'unloadRaised', x: START.x, y: START.y, dir: { x: 1, y: 0 } }]);
    expect(selectUnload(r.state)).toEqual({ phase: 'up', seconds: Math.ceil((UNLOAD.ticks - 4) / TICK_HZ) });
  });

  it('turns the aim into the nearest axis, a tie going to the horizontal', () => {
    expect(cardinalOf({ x: 0.3, y: -0.9 })).toEqual({ x: 0, y: -1 });
    expect(cardinalOf({ x: 0.6, y: 0.8 })).toEqual({ x: 0, y: 1 });
    expect(cardinalOf({ x: 0.8, y: -0.6 })).toEqual({ x: 1, y: 0 });
    expect(cardinalOf({ x: -0.9, y: 0.4 })).toEqual({ x: -1, y: 0 });
    expect(cardinalOf({ x: -Math.SQRT1_2, y: -Math.SQRT1_2 })).toEqual({ x: -1, y: 0 });
    expect(cardinalOf({ x: Math.SQRT1_2, y: Math.SQRT1_2 })).toEqual({ x: 1, y: 0 });
    const spat = (aim: { x: number; y: number }) => run(game([], aim), 1, raiseAtStart).state.unload!.dir;
    expect(spat({ x: 0.2, y: 0.97 })).toEqual({ x: 0, y: 1 });
    expect(spat(AIM.left)).toEqual({ x: -1, y: 0 });
  });

  it('lies as a 3 x 1.5 tile rectangle that starts a few pixels ahead of the operator\'s centre', () => {
    const at = (dir: { x: number; y: number }) => unloadBox({ ...UNLOAD_READY, ticksLeft: 1, x: START.x, y: START.y, dir });
    expect(at(AIM.right)).toEqual({ left: 168, right: 264, top: 168, bottom: 216 });
    expect(at(AIM.left)).toEqual({ left: 56, right: 152, top: 168, bottom: 216 });
    expect(at(AIM.up)).toEqual({ left: 136, right: 184, top: 88, bottom: 184 });
    expect(at(AIM.down)).toEqual({ left: 136, right: 184, top: 200, bottom: 296 });
    expect(UNLOAD.lengthPx).toBe(3 * TILE);
  });

  it('shoves an enemy in it along it, away from the operator, and not one outside', () => {
    const inside = run(game([{ type: 'dummy', x: 200, y: 192 }]), 10, raiseAtStart);
    expect(enemy(inside.state, 'dummy').x).toBeCloseTo(212, 6);
    expect(enemy(inside.state, 'dummy').y).toBe(192);
    // The same along the other axes.
    const up = run(game([{ type: 'dummy', x: 160, y: 150 }], AIM.up), 10, raiseAtStart);
    expect(enemy(up.state, 'dummy').y).toBeCloseTo(150 - 10 * UNLOAD.shovePx, 6);
    const left = run(game([{ type: 'dummy', x: 120, y: 192 }], AIM.left), 10, raiseAtStart);
    expect(enemy(left.state, 'dummy').x).toBeCloseTo(120 - 10 * UNLOAD.shovePx, 6);
    const down = run(game([{ type: 'dummy', x: 160, y: 240 }], AIM.down), 10, raiseAtStart);
    expect(enemy(down.state, 'dummy').y).toBeCloseTo(240 + 10 * UNLOAD.shovePx, 6);
    // Behind the operator, past the far end, and off to the side: left alone, no hit.
    for (const [x, y] of [[100, 192], [290, 192], [210, 236], [210, 148]] as const) {
      const out = run(game([{ type: 'dummy', x, y }]), 10, raiseAtStart);
      expect(ofType(out, 'hit')).toEqual([]);
      expect(enemy(out.state, 'dummy')).toEqual(enemy(run(game([{ type: 'dummy', x, y }]), 10).state, 'dummy'));
    }
  });

  it('costs an enemy in it 1 performance on the tick it lies and every half second after', () => {
    // Shoved against the west wall it cannot leave, so it stands in the acid for the whole 3 s.
    const wall = game([{ type: 'dummy', x: 70, y: 192 }], AIM.left, true, { x: 96, y: 192 });
    const r = run(wall, UNLOAD.ticks + 20, raiseAtStart);
    expect(enemy(r.state, 'dummy').x).toBe(32 + 7);
    expect(ticksOf(r, 'hit')).toEqual([0, 30, 60, 90, 120]);
    expect(ofType(r, 'hit').map((h) => h.hpLeft)).toEqual([5, 4, 3, 2, 1]);
    // The sixth bite closes the case (performance 6), and nothing bites a closed enemy after that.
    expect(ticksOf(r, 'caseClosed')).toEqual([150]);
    expect(enemy(r.state, 'dummy').phase).toBe('closed');
    expect(ticksOf(r, 'hit').filter((t) => t > 150)).toEqual([]);
  });

  it('is a continuous hurt, not a hit: no hit-stop on the enemy, and a closed one is not bitten again', () => {
    const r = run(game([{ type: 'dummy', x: 200, y: 192 }]), 5, raiseAtStart);
    expect(enemy(r.state, 'dummy').frozen).toBe(0);
    const g = game([{ type: 'dummy', x: 200, y: 192 }]);
    const last = { ...g, enemies: g.enemies.map((e) => ({ ...e, hp: 1 })) };
    const closed = run(last, 100, raiseAtStart);
    expect(ticksOf(closed, 'caseClosed')).toEqual([0]);
    expect(ofType(closed, 'hit')).toEqual([]);
    // Shoved on the tick it closed, and left where it fell.
    expect(enemy(closed.state, 'dummy')).toMatchObject({ phase: 'closed', x: 200 + UNLOAD.shovePx });
  });

  it('lies through its last tick and not one more', () => {
    const g = game([{ type: 'dummy', x: 200, y: 192 }]);
    const lying = (ticksLeft: number): GameState => ({ ...g, unload: { ticksLeft, cooldown: 100, x: START.x, y: START.y, dir: AIM.right } });
    // Two ticks left: this tick runs it down to its last, which still shoves.
    expect(enemy(run(lying(2), 1).state, 'dummy').x).toBeCloseTo(200 + UNLOAD.shovePx, 6);
    // One tick left: this tick runs it out, and an acid that is gone shoves nothing.
    expect(enemy(run(lying(1), 1).state, 'dummy').x).toBe(200);
    expect(ofType(run(lying(1), 1), 'hit')).toEqual([]);
  });

  it('is gone after 3 s: no more damage and no more shove', () => {
    const wall = game([{ type: 'dummy', x: 200, y: 192 }]);
    const r = run(wall, UNLOAD.ticks + 60, raiseAtStart);
    const after = run(r.state, 30);
    expect(enemy(after.state, 'dummy').x).toBe(enemy(r.state, 'dummy').x);
    expect(ofType(after, 'hit')).toEqual([]);
    expect(selectUnload(r.state)?.phase).toBe('cooling');
  });

  it('stays where it was spat when the operator walks away', () => {
    const away = run(game([{ type: 'dummy', x: 70, y: 192 }], AIM.left, true, { x: 96, y: 192 }), 70, (t) => press({ partnerPressed: t === 0, move: { x: t === 0 ? 0 : 1, y: 0 } }));
    expect(away.state.operator.x).toBeGreaterThan(96 + 20);
    expect(away.state.unload).toMatchObject({ x: 96, y: 192, dir: { x: -1, y: 0 } });
    expect(ticksOf(away, 'hit')).toEqual([0, 30, 60]);
  });

  it('does not care for a manager\'s shield, and bites a bound enemy without moving it', () => {
    const g = game([{ type: 'large_seller', x: 200, y: 192 }]);
    const faced = { ...g, enemies: g.enemies.map((e) => ({ ...e, facing: { x: -1, y: 0 } })) };
    // He faces the operator, so a thrown sheet or a folder from here would be turned back.
    expect(shieldCovers(faced.enemies[0]!, { x: -1, y: 0 })).toBe(true);
    const r = run(faced, 1, raiseAtStart);
    expect(ofType(r, 'hit')).toEqual([{ type: 'hit', target: faced.enemies[0]!.id, enemy: 'large_seller', hpLeft: 11 }]);

    const d = game([{ type: 'dummy', x: 200, y: 192 }]);
    const pinned = { ...d, enemies: d.enemies.map((e) => ({ ...e, frozen: 200, pin: 200 })) };
    const b = run(pinned, 40, raiseAtStart);
    expect(enemy(b.state, 'dummy').x).toBe(200);
    expect(ticksOf(b, 'hit')).toEqual([0, 30]);
  });

  it('leaves immune, reforming and cheers enemies and bosses alone', () => {
    for (const type of ['cold_virus', 'alcohol_barrel', 'adenosine', 'opportunist_bacteria', 'cheers']) {
      const spawn = [{ type, x: 200, y: 192 }];
      const withAcid = run(game(spawn), 20, raiseAtStart);
      const without = run(game(spawn), 20);
      expect(ofType(withAcid, 'hit'), type).toEqual([]);
      expect(enemy(withAcid.state, type), type).toEqual(enemy(without.state, type));
    }
  });

  it('leaves a boss to his own controller', () => {
    const toastRaw = JSON.parse(readFileSync('content/bosses/toast.json', 'utf8'));
    const caffeineRaw = JSON.parse(readFileSync('content/bosses/caffeine.json', 'utf8'));
    const params = JSON.parse(readFileSync('content/params.json', 'utf8')).defaults;
    const bosses = loadBossTable([caffeineRaw, toastRaw], TABLE, params);
    const arena = createGame(room([{ type: 'caffeine', x: 200, y: 192 }]), 1, TABLE, { bosses, unload: true });
    const g = { ...arena, operator: { ...arena.operator, aim: AIM.right } };
    const withAcid = run(g, 10, raiseAtStart);
    const without = run(g, 10);
    expect(withAcid.state.unload?.ticksLeft).toBeGreaterThan(0);
    expect(ofType(withAcid, 'hit')).toEqual([]);
    expect(withAcid.state.enemies.map((e) => [e.hp, e.x, e.y])).toEqual(without.state.enemies.map((e) => [e.hp, e.x, e.y]));
  });

  it('cools down for 9 s from the spit and ignores L until then', () => {
    const everyTick = run(game(), UNLOAD.cooldownTicks + 2, () => press({ partnerPressed: true }));
    expect(ticksOf(everyTick, 'unloadRaised')).toEqual([0, UNLOAD.cooldownTicks]);
    const mid = run(game(), 2 * TICK_HZ, raiseAtStart);
    expect(selectUnload(mid.state)?.phase).toBe('up');
    const after = run(game(), UNLOAD.ticks + 5, raiseAtStart);
    expect(selectUnload(after.state)).toEqual({ phase: 'cooling', seconds: Math.ceil((UNLOAD.cooldownTicks - UNLOAD.ticks - 5) / TICK_HZ) });
    expect(selectUnload(run(game(), UNLOAD.cooldownTicks + 1, raiseAtStart).state)?.phase).toBe('ready');
    expect(UNLOAD.ticks).toBe(3 * TICK_HZ);
    expect(UNLOAD.cooldownTicks).toBe(9 * TICK_HZ);
  });

  it('is only the partner\'s: no skill without it, and a hurt operator cannot spit', () => {
    const none = run(game([], AIM.right, false), 3, () => press({ partnerPressed: true }));
    expect(ofType(none, 'unloadRaised')).toEqual([]);
    expect(none.state.unload).toBeUndefined();
    expect(selectUnload(none.state)).toBeUndefined();

    const g = game();
    const hurt = { ...g, operator: { ...g.operator, action: { kind: 'hurt' as const, frame: 0, dir: { x: 1, y: 0 } } } };
    const r = run(hurt, 1, () => press({ partnerPressed: true }));
    expect(r.state.operator.action.kind).toBe('hurt');
    expect(ofType(r, 'unloadRaised')).toEqual([]);
    expect(r.state.unload).toEqual(UNLOAD_READY);
  });

  it('steps as a plain state machine', () => {
    const at = { x: 10, y: 20 };
    const raised = stepUnload(UNLOAD_READY, true, at, AIM.down);
    expect(raised).toEqual({ raised: true, unload: { ticksLeft: UNLOAD.ticks, cooldown: UNLOAD.cooldownTicks, x: 10, y: 20, dir: AIM.down } });
    // A press while cooling, or none at all, only runs the clocks down.
    expect(stepUnload(raised.unload, true, { x: 99, y: 99 }, AIM.up)).toEqual({ raised: false, unload: { ...raised.unload, ticksLeft: UNLOAD.ticks - 1, cooldown: UNLOAD.cooldownTicks - 1 } });
    expect(stepUnload(UNLOAD_READY, false, at, AIM.down)).toEqual({ raised: false, unload: UNLOAD_READY });
  });

  it('is put away by a forced leave, with the skill ready for the retry', () => {
    const g = game([{ type: 'salesman', x: 190, y: 192 }], AIM.left);
    const last = { ...g, operator: { ...g.operator, halves: 1 } };
    const r = run(last, 120, raiseAtStart);
    const gone = ticksOf(r, 'forcedLeave')[0]!;
    expect(gone).toBeGreaterThan(5);
    // Spat on the tick before, so it was still lying until the leave took the operator back.
    const before = run(last, gone, raiseAtStart).state;
    expect(before.unload!.ticksLeft).toBeGreaterThan(0);
    const after = run(last, gone + 1, raiseAtStart).state;
    expect(after.unload).toEqual(UNLOAD_READY);
  });
});

describe('the logistics chief in the stomach chapter', () => {
  const loadMap = (path: string) => JSON.parse(readFileSync(`public/assets/maps/${path}.tmj`, 'utf8')) as TiledMap;
  const content = (chapter: ChapterFile): ChapterContent => ({
    chapter,
    rooms: new Map(roomsOf(chapter).map((p) => [p, parseRoom(p, loadMap(p), TAGS)])),
    dialogues: DIALOGUES, dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS, rescues: RESCUES,
  });
  const STOMACH = content(CHAPTERS.get('stomach')!);

  it('is the stomach\'s partner: every room starts with the acid ready, and no pie', () => {
    expect(CHAPTERS.get('stomach')!.partner).toBe('logistics');
    for (const path of roomsOf(STOMACH.chapter)) {
      const { pending: _, ...s } = startChapter(STOMACH, { room: path });
      expect(s.game.unload, path).toEqual(UNLOAD_READY);
      expect(s.game.pie, path).toBeUndefined();
    }
  });

  it('L spits it through the chapter, and a chapter without that partner has none', () => {
    const { pending: _, ...s } = startChapter(STOMACH, { room: 'stomach/mixer-lab' });
    const r = stepChapter(STOMACH, s, { ...NO_INPUT, partnerPressed: true });
    expect(r.events.map((e) => e.type)).toContain('unloadRaised');
    expect(r.state.game.unload?.ticksLeft).toBeGreaterThan(0);

    const { partner: _p, ...rest } = STOMACH.chapter;
    const plain: ChapterContent = { ...STOMACH, chapter: rest };
    const { pending: __, ...q } = startChapter(plain, { room: 'stomach/mixer-lab' });
    expect(q.game.unload).toBeUndefined();
    expect(stepChapter(plain, q, { ...NO_INPUT, partnerPressed: true }).events.map((e) => e.type)).not.toContain('unloadRaised');
  });
});
