import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CLING, createGame, EMPTY_LOG, EMPTY_TAGS, GAUGE, isInvincible, loadDictionary, loadEnemyTable, MOVE, NO_INPUT, record,
  REFORM_TICKS, SALESMAN, sendStacksHome, setAmount, spiritAtEntry, STAMP, STAMP_LAND, step, TILE,
  type DomainEvent, type EnteredRoom, type GameOptions, type GameState, type TickInput,
} from '../../src/core/index.ts';

const TABLE = loadEnemyTable(JSON.parse(readFileSync('content/enemies.json', 'utf8')));
const DICT = loadDictionary(JSON.parse(readFileSync('content/tags.json', 'utf8')));
const PARAMS = JSON.parse(readFileSync('content/params.json', 'utf8')).defaults as { sCoef: number; sFloor: number };

/** Open 20 x 12 room with a one-tile border; PlayerStart at (160, 192). */
function room(spawns: { type: string; x: number; y: number }[] = []): EnteredRoom {
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
      { id: 1, kind: 'PlayerStart', name: '', x: 160, y: 192, width: 0, height: 0, props: {}, conditions: {} },
      ...spawns.map((s, i) => ({
        id: 10 + i, kind: 'Spawn', name: '', x: s.x, y: s.y, width: 0, height: 0, conditions: {},
        props: { enemyType: s.type, count: 1, respawnSeconds: 0, when: '' },
      })),
    ],
  };
}

const game = (spawns: Parameters<typeof room>[0] = [], options: GameOptions = {}) => createGame(room(spawns), 1, TABLE, options);
const press = (extra: Partial<TickInput> = {}): TickInput => ({ ...NO_INPUT, ...extra });
const aimed = (g: GameState, x: number, y: number): GameState => ({ ...g, operator: { ...g.operator, aim: { x, y } } });

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
const all = (r: Run) => r.events.flat();
const ofType = <T extends DomainEvent['type']>(r: Run, type: T) => all(r).filter((e): e is Extract<DomainEvent, { type: T }> => e.type === type);

describe('chairman spirit P (design doc glossary, 5.4)', () => {
  const debt = (hours: number) => {
    const [log, source] = record(EMPTY_LOG, { kind: 'event', key: 'test', at: 0 });
    return spiritAtEntry(setAmount({ ...EMPTY_TAGS, log }, DICT, 'sleep_debt', hours, source, 0), DICT, PARAMS);
  };

  it('is 1 when rested, 0.72 at 8 hours of debt and bottoms out at 0.65', () => {
    expect(spiritAtEntry(EMPTY_TAGS, DICT, PARAMS)).toBe(1);
    expect(debt(8)).toBeCloseTo(0.72, 10);
    expect(debt(10)).toBeCloseTo(0.65, 10);
    expect(debt(30)).toBeCloseTo(0.65, 10);
  });

  it('turns the 25 s rested fill into about 35 s at 8 hours of debt', () => {
    expect(25 / debt(8)).toBeCloseTo(34.7, 1);
  });

  it('createGame refuses a P outside (0, 1] and a gauge outside 0 to 100', () => {
    expect(() => game([], { p: 0 })).toThrow(/P must be/);
    expect(() => game([], { p: 1.2 })).toThrow(/P must be/);
    expect(() => game([], { gauge: 101 })).toThrow(/gauge must be/);
  });
});

describe('gauge sources (design doc 5.4)', () => {
  // A staple aimed right from x = 160 reaches a target at x = 220 in a few ticks.
  const shoot = (type: string, p: number) =>
    run(aimed(game([{ type, x: 220, y: 192 }], { p }), 1, 0), 12, (t) => press({ attackPressed: t === 0 }));

  it('a staple that hits a defeatable enemy adds 0.8 x P', () => {
    expect(ofType(shoot('salesman', 1), 'hit')).toHaveLength(1);
    expect(shoot('salesman', 1).state.operator.gauge).toBeCloseTo(GAUGE.staple, 10);
    expect(shoot('salesman', 0.72).state.operator.gauge).toBeCloseTo(GAUGE.staple * 0.72, 10);
  });

  it('a staple that disperses a reforming enemy adds 0.8 x P', () => {
    const r = shoot('adenosine', 0.72);
    expect(ofType(r, 'dispersed')).toHaveLength(1);
    expect(r.state.operator.gauge).toBeCloseTo(GAUGE.staple * 0.72, 10);
  });

  it('a staple that bounces off an immune enemy adds nothing', () => {
    const r = shoot('alcohol_barrel', 1);
    expect(ofType(r, 'immuneBounce')).toHaveLength(1);
    expect(r.state.operator.gauge).toBe(0);
  });

  it('a perfect dodge adds 10 x P', () => {
    const duel = () => game([{ type: 'salesman', x: 190, y: 192 }], { p: 0.72 });
    const tele = run(duel(), 60).events.findIndex((es) => es.some((e) => e.type === 'telegraph'));
    const at = tele + SALESMAN.windupTicks - 2;
    const r = run(duel(), 90, (t) => press({ dodgePressed: t === at, move: { x: t === at ? 1 : 0, y: 0 } }));
    expect(ofType(r, 'perfectDodge')).toHaveLength(1);
    expect(r.state.operator.gauge).toBeCloseTo(GAUGE.perfectDodge * 0.72, 10);
  });

  it('fills to exactly 100 after 125 rested staple hits, says so once, and stops there', () => {
    let s = game([{ type: 'salesman', x: 220, y: 192 }]);
    const events: DomainEvent[] = [];
    for (let i = 0; i < 130; i++) {
      // Keep the target alive and in place so every staple is a hit.
      s = { ...s, enemies: s.enemies.map((e) => ({ ...e, hp: 99, x: 220, y: 192, phase: 'idle' as const })) };
      const r = run(aimed(s, 1, 0), 12, (t) => press({ attackPressed: t === 0 }));
      s = r.state;
      events.push(...all(r));
      if (i === 124) expect(s.operator.gauge).toBe(STAMP.gaugeMax);
    }
    expect(s.operator.gauge).toBe(STAMP.gaugeMax);
    expect(events.filter((e) => e.type === 'gaugeFull')).toHaveLength(1);
  });
});

describe('rejection stamp (design doc 5.4)', () => {
  const full = (spawns: Parameters<typeof room>[0] = []) => game(spawns, { gauge: STAMP.gaugeMax });
  const stamp = (g: GameState, ticks = STAMP_LAND + 2) => run(g, ticks, (t) => press({ stampPressed: t === 0 }));

  it('does nothing before the gauge is full', () => {
    const r = stamp(game([], { gauge: STAMP.gaugeMax - 0.1 }));
    expect(ofType(r, 'stampRaised')).toEqual([]);
    expect(r.state.operator.gauge).toBeCloseTo(STAMP.gaugeMax - 0.1, 10);
  });

  it('a press before the gauge is full is not kept: filling it right after does not stamp by itself', () => {
    const s0 = step(game([], { gauge: STAMP.gaugeMax - 0.1 }), press({ stampPressed: true })).state;
    const r = run({ ...s0, operator: { ...s0.operator, gauge: STAMP.gaugeMax } }, STAMP_LAND + 2, () => press());
    expect(ofType(r, 'stampRaised')).toEqual([]);
    expect(r.state.operator.gauge).toBe(STAMP.gaugeMax);
  });

  it('empties the gauge on the press and lands 0.35 s later, invincible until it lands', () => {
    let s = full();
    const invincible: boolean[] = [];
    let landed = -1;
    for (let t = 0; t < STAMP_LAND + 3; t++) {
      const r = step(s, press({ stampPressed: t === 0 }));
      s = r.state;
      if (t === 0) expect(s.operator.gauge).toBe(0);
      if (r.events.some((e) => e.type === 'stampLanded')) landed = t;
      invincible.push(isInvincible(s.operator, s.tick - 1));
    }
    expect(landed).toBe(STAMP.startupTicks);
    expect(STAMP.startupTicks).toBe(21);
    expect(invincible.slice(0, STAMP_LAND)).toEqual(Array(STAMP_LAND).fill(true));
    expect(invincible[STAMP_LAND]).toBe(false);
  });

  it('the operator stands still while stamping', () => {
    const r = run(full(), STAMP_LAND, (t) => press({ stampPressed: t === 0, move: { x: 1, y: 0 } }));
    expect(r.state.operator.x).toBe(160);
  });

  it('takes 25 from a defeatable enemy inside the radius, which closes a salesman', () => {
    const r = stamp(full([{ type: 'salesman', x: 240, y: 192 }]));
    expect(ofType(r, 'caseClosed')).toEqual([{ type: 'caseClosed', target: 1, enemy: 'salesman' }]);
  });

  it('covers enemies up to 3.5 tiles from the operator and none beyond', () => {
    const edge = 160 + STAMP.radiusPx;
    const r = stamp(full([{ type: 'alcohol_barrel', x: edge, y: 192 }, { type: 'alcohol_barrel', x: edge + 1, y: 192 }]));
    expect(STAMP.radiusPx).toBe(3.5 * TILE);
    expect(ofType(r, 'stampVoid').map((e) => e.target)).toEqual([1]);
  });

  it('never removes an immune target, and the gauge is spent anyway', () => {
    const g = full([{ type: 'alcohol_barrel', x: 200, y: 192 }]);
    const r = stamp(g);
    expect(ofType(r, 'stampVoid')).toEqual([{ type: 'stampVoid', target: 1, enemy: 'alcohol_barrel', solution: 'conveyor' }]);
    expect(r.state.enemies).toEqual(run(g, STAMP_LAND + 2).state.enemies);
    expect(r.state.enemies[0]!.phase).toBe('idle');
    expect(r.state.operator.gauge).toBe(0);
  });

  it('is void on a reforming enemy too: it is not dispersed', () => {
    // Out of the adenosine's reach for the stamp's duration, so only the stamp can touch it.
    const r = stamp(full([{ type: 'adenosine', x: 160 + 3 * TILE, y: 192 }]));
    expect(ofType(r, 'stampVoid')).toEqual([{ type: 'stampVoid', target: 1, enemy: 'adenosine', solution: 'sleep' }]);
    expect(ofType(r, 'dispersed')).toEqual([]);
  });
});

describe('clinging and the forced nap (design doc 5.5, chapter 1)', () => {
  it('adenosine drifts toward an operator within range and leaves one beyond it alone', () => {
    const r = run(game([{ type: 'adenosine', x: 260, y: 192 }, { type: 'adenosine', x: 160 + CLING.senseRangePx + 40, y: 192 }]), 30);
    expect(r.state.enemies[0]!.x).toBeLessThan(260);
    expect(r.state.enemies[1]!.x).toBe(160 + CLING.senseRangePx + 40);
  });

  it('a touching adenosine clings as one 5% slow stack and cannot be hit while attached', () => {
    const r = run(game([{ type: 'adenosine', x: 170, y: 192 }]), 1);
    expect(ofType(r, 'clung')).toEqual([{ type: 'clung', target: 1, enemy: 'adenosine', stacks: 1 }]);
    expect(r.state.operator.stacks).toBe(1);
    const moved = run(r.state, 20, () => press({ move: { x: 1, y: 0 } }));
    expect(Math.hypot(moved.state.operator.vx, moved.state.operator.vy)).toBeCloseTo(MOVE.maxSpeed * 0.95, 10);
    const shot = run(aimed(r.state, 1, 0), 12, (t) => press({ attackPressed: t === 0 }));
    expect(ofType(shot, 'dispersed')).toEqual([]);
  });

  it('only enemies marked to cling do; an immune barrel against the operator never does', () => {
    const r = run(game([{ type: 'alcohol_barrel', x: 170, y: 192 }]), 10);
    expect(ofType(r, 'clung')).toEqual([]);
    expect(r.state.operator.stacks).toBe(0);
  });

  it('the enemy table rejects clinging on anything but a reforming enemy', () => {
    const raw = JSON.parse(readFileSync('content/enemies.json', 'utf8'));
    raw.enemies.push({ id: 'sticky_suit', category: 'defeatable', performance: 2, clings: true });
    expect(() => loadEnemyTable(raw)).toThrow(/only reforming enemies cling/);
  });

  it('does not cling through dodge i-frames', () => {
    // Dodge first, then meet the adenosine while invincible.
    const g = game([{ type: 'adenosine', x: 200, y: 192 }]);
    const r = run(g, 6, (t) => press({ dodgePressed: t === 0, move: { x: 1, y: 0 } }));
    expect(ofType(r, 'clung')).toEqual([]);
  });

  it('the third stack is a forced nap: the clock moves one hour, stacks clear and the adenosine reforms at home', () => {
    const homes = [{ x: 170, y: 192 }, { x: 150, y: 192 }, { x: 160, y: 196 }];
    const g = game(homes.map((h) => ({ type: 'adenosine', ...h })));
    const r = run(g, 3);
    expect(ofType(r, 'clung').map((e) => e.stacks)).toEqual([1, 2, 3]);
    expect(ofType(r, 'forcedNap')).toEqual([{ type: 'forcedNap', minutes: 60 }]);
    expect(r.state.clock.minute - g.clock.minute).toBe(CLING.napMinutes);
    expect(r.state.operator.stacks).toBe(0);
    expect(r.state.enemies.map((e) => [e.phase, e.x, e.y])).toEqual(homes.map((h) => ['dispersed', h.x, h.y]));
    const back = run(r.state, REFORM_TICKS);
    expect(ofType(back, 'reformed')).toHaveLength(3);
    expect(back.state.enemies).toHaveLength(3);
  });

  it('two stacks do not advance the clock', () => {
    const g = game([{ type: 'adenosine', x: 170, y: 192 }, { type: 'adenosine', x: 150, y: 192 }]);
    const r = run(g, 10);
    expect(r.state.operator.stacks).toBe(2);
    expect(r.state.clock).toEqual(g.clock);
  });

  it('a forced leave keeps the stacks and the gauge: only sleep clears adenosine', () => {
    const g = game([{ type: 'adenosine', x: 170, y: 192 }], { gauge: 40 });
    const clung = run(g, 1).state;
    const dying = { ...clung, operator: { ...clung.operator, halves: 0 } };
    const r = step(dying, NO_INPUT);
    expect(r.events.map((e) => e.type)).toContain('forcedLeave');
    expect(r.state.operator.stacks).toBe(1);
    expect(r.state.operator.gauge).toBe(40);
    expect(r.state.enemies[0]!.phase).toBe('attached');
  });

  describe('stacks carried in from another room', () => {
    it('ride on the operator, slow it, and count toward the forced nap', () => {
      const g = game([{ type: 'adenosine', x: 170, y: 192 }], { stacks: 2 });
      expect(g.operator.stacks).toBe(2);
      expect(g.carried).toBe(2);
      const r = run(g, 1);
      expect(ofType(r, 'clung').map((e) => e.stacks)).toEqual([3]);
      expect(ofType(r, 'forcedNap')).toEqual([{ type: 'forcedNap', minutes: 60 }]);
      expect(r.state.operator.stacks).toBe(0);
      expect(r.state.carried).toBe(0);
    });

    it('stay through a forced leave, since only sleep clears adenosine', () => {
      const g = game([], { stacks: 2 });
      const r = step({ ...g, operator: { ...g.operator, halves: 0 } }, NO_INPUT);
      expect(r.events.map((e) => e.type)).toContain('forcedLeave');
      expect(r.state.operator.stacks).toBe(2);
      expect(r.state.carried).toBe(2);
    });

    it('sleep clears them with the rest', () => {
      const asleep = sendStacksHome(game([{ type: 'adenosine', x: 170, y: 192 }], { stacks: 1 }));
      expect(asleep.carried).toBe(0);
      expect(asleep.operator.stacks).toBe(0);
    });

    it('a whole number below the nap cap is all createGame takes', () => {
      for (const stacks of [-1, 1.5, CLING.maxStacks]) expect(() => game([], { stacks })).toThrow(/stacks must be/);
    });
  });
});
