import { describe, expect, it } from 'vitest';
import { BOSSES, DIALOGUES, ENEMIES, PARAMS, TAGS } from '../../src/app/content.ts';
import { tagsFromQuery } from '../../src/app/session.ts';
import {
  amount, chairmanSpirit, CLING, CONVEYOR_TICKS, createGame, DODGE, FLYER, GLUCOSE, MANAGER, metabolise, MIST, MOVE, NO_INPUT, parseRoom,
  SALESMAN, senseCap, sleepFactor, startChapter, step, stepChapter, STAPLER, TELEGRAPH, TICK_HZ,
  type ChapterContent, type ChapterState, type EnteredRoom, type GameState, type TickInput, type TiledMap,
} from '../../src/core/index.ts';

/**
 * Design rules that the rules-layer numbers must obey (issue #11, review in docs/reviews/rules-numbers.md).
 * Each test reads the constants it checks instead of repeating them, so tuning a number keeps it
 * green as long as the rule still holds; it fails only when the rule itself breaks. Rules that
 * already have a test elsewhere are listed in the review, not tested again here.
 */

// ---------------------------------------------------------------------------------------------
// Helpers, copied from combat.test.ts and boxes.test.ts (there is no shared helper module).

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

/**
 * Ticks the first enemy spends in its windup, from the tick its telegraph is announced to the
 * tick it strikes or throws, with the operator standing still and never attacking.
 */
function observedWindup(type: string, x: number): number {
  let s: GameState = createGame(room([{ type, x, y: 192 }]), 1, ENEMIES);
  let telegraph = -1;
  for (let t = 0; t < 30 * TICK_HZ; t++) {
    const r = step(s, NO_INPUT);
    s = r.state;
    if (telegraph < 0 && r.events.some((e) => e.type === 'telegraph')) telegraph = t;
    if (telegraph >= 0 && s.enemies[0]!.phase !== 'windup') return t - telegraph;
  }
  throw new Error(`${type} never finished a windup`);
}

const p = (name: string, value: string | number | boolean) => ({ name, value });

/** A bare 20 x 12 floor with one conveyor along row 8, from column 2 to column 17. */
function beltChapter(direction: string, speed: string): ChapterContent {
  const map = {
    width: 20, height: 12, tilewidth: 32, tileheight: 32,
    properties: [p('organ', 'lobby'), p('role', 'puzzle'), p('estSeconds', 10)],
    layers: [
      { type: 'tilelayer', name: 'walls', data: Array.from({ length: 240 }, () => 0) },
      {
        type: 'objectgroup', name: 'objects', objects: [
          { id: 1, type: 'PlayerStart', x: 320, y: 280 },
          { id: 3, type: 'Conveyor', x: 2 * 32, y: 8 * 32, width: 16 * 32, height: 32, properties: [p('direction', direction), p('speed', speed)] },
        ],
      },
    ],
  } as unknown as TiledMap;
  return {
    chapter: { version: 1, id: 'lab', start: 'lab/a', links: [] },
    rooms: new Map([['lab/a', parseRoom('lab/a', map, TAGS)]]),
    dialogues: DIALOGUES, dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS,
  };
}

/** How far the operator gets in one second walking west against an eastbound belt (negative: carried back east). */
function headwayAgainst(speed: string, attack: boolean): number {
  const c = beltChapter('E', speed);
  let s: ChapterState = startChapter(c);
  const x0 = s.game.operator.x;
  const input: TickInput = { move: { x: -1, y: 0 }, attack };
  for (let t = 0; t < TICK_HZ; t++) s = stepChapter(c, s, input).state;
  return x0 - s.game.operator.x;
}

// ---------------------------------------------------------------------------------------------

describe('frame data (design doc 5.2, 5.3)', () => {
  it('warnings grow longer with their tier: tier 1, then tier 2, then the tier-3 range', () => {
    expect(TELEGRAPH.tier1Ticks).toBeLessThan(TELEGRAPH.tier2Ticks);
    expect(TELEGRAPH.tier2Ticks).toBeLessThan(TELEGRAPH.tier3MinTicks);
    expect(TELEGRAPH.tier3MinTicks).toBeLessThanOrEqual(TELEGRAPH.tier3MaxTicks);
  });

  it('the perfect-dodge window is the first 6 i-frames and lies inside the dodge', () => {
    expect(DODGE.perfectLast - DODGE.iframeFirst + 1).toBe(6);
    expect(DODGE.iframeFirst).toBeGreaterThanOrEqual(1);
    expect(DODGE.perfectLast).toBeLessThanOrEqual(DODGE.iframeLast);
    expect(DODGE.iframeLast).toBeLessThanOrEqual(DODGE.ticks);
  });

  it('soft lock never picks a target farther than a staple can fly', () => {
    expect(STAPLER.lockRangePx).toBeLessThanOrEqual(STAPLER.rangePx);
  });

  it('every regular enemy attack telegraphs for exactly the tier-1 warning', () => {
    // Each archetype starts its windup at its own distance: the salesman in reach, the flyer between near and far.
    expect(observedWindup('salesman', 190)).toBe(TELEGRAPH.tier1Ticks);
    expect(observedWindup('flyer', 160 + (FLYER.nearPx + FLYER.farPx) / 2)).toBe(TELEGRAPH.tier1Ticks);
    expect(observedWindup('energy_seller', 160 + (FLYER.nearPx + FLYER.farPx) / 2)).toBe(TELEGRAPH.tier1Ticks);
    // The manager turns to face the operator first, so the count starts at his telegraph and not at his arrival.
    expect(observedWindup('large_seller', 190)).toBe(TELEGRAPH.tier1Ticks);
  });

  it('a flyer can reach the operator from anywhere in the band it keeps', () => {
    expect(FLYER.nearPx).toBeLessThan(FLYER.farPx);
    expect(FLYER.shotRangePx).toBeGreaterThanOrEqual(FLYER.farPx);
  });
});

describe('hits on the operator (design doc 5.3)', () => {
  it('a regular attack costs half a heart, and no single hit anywhere takes more than a heart and a half', () => {
    expect(SALESMAN.damageHalves).toBe(1);
    expect(FLYER.damageHalves).toBe(1);
    expect(MANAGER.damageHalves).toBe(1);
    const hits: number[] = [SALESMAN.damageHalves, FLYER.damageHalves, MANAGER.damageHalves, MIST.halves];
    for (const def of BOSSES.values()) {
      if ('moves' in def) hits.push(...def.moves.map((m) => m.halves));
    }
    expect(hits.length).toBeGreaterThan(3);
    for (const h of hits) {
      expect(h).toBeGreaterThan(0);
      expect(h).toBeLessThanOrEqual(3);
    }
  });
});

describe('slows (design doc 5.1, 5.5, 7.7)', () => {
  it('clinging up to the stack limit is exactly the slow cap, and no single visible source exceeds it', () => {
    expect(CLING.maxStacks * CLING.slowPerStack).toBeCloseTo(MOVE.slowCap, 10);
    expect(CLING.slowPerStack).toBeLessThan(MOVE.slowCap);
    expect(GLUCOSE.dizzySlow).toBeLessThanOrEqual(MOVE.slowCap);
  });
});

describe('conveyors (authoring guide, 推箱與輸送帶)', () => {
  it('belts are slow, normal and fast in that order', () => {
    expect(CONVEYOR_TICKS['slow']).toBeGreaterThan(CONVEYOR_TICKS['normal']!);
    expect(CONVEYOR_TICKS['normal']).toBeGreaterThan(CONVEYOR_TICKS['fast']!);
  });

  it('an unslowed operator makes headway against every belt; holding fire, the fast belt carries them back', () => {
    for (const speed of Object.keys(CONVEYOR_TICKS)) expect(headwayAgainst(speed, false)).toBeGreaterThan(0);
    expect(headwayAgainst('fast', true)).toBeLessThan(0);
  });
});

describe('chairman spirit P (design doc 5.4, 5.6)', () => {
  it('never rises with sleep debt, is 1 when rested and never falls below its floor', () => {
    const floor = chairmanSpirit(PARAMS.sFloor);
    expect(chairmanSpirit(sleepFactor(0, PARAMS))).toBe(1);
    let last = Infinity;
    for (let debt = 0; debt <= 30; debt += 0.25) {
      const pNow = chairmanSpirit(sleepFactor(debt, PARAMS));
      expect(pNow).toBeLessThanOrEqual(last);
      expect(pNow).toBeGreaterThanOrEqual(floor);
      expect(pNow).toBeLessThanOrEqual(1);
      last = pNow;
    }
    // The floor is reached, not only approached: a long enough debt bottoms out.
    expect(last).toBeCloseTo(floor, 10);
  });
});

describe('caffeine (design doc 7.4, 9.2)', () => {
  it('the cloak only ever narrows sight: more caffeine never lets adenosine see farther', () => {
    let last = CLING.senseRangePx;
    for (let c = 0; c <= 3 * PARAMS.cup; c++) {
      const sight = Math.min(CLING.senseRangePx, senseCap(c) ?? CLING.senseRangePx);
      expect(senseCap(c) ?? 0).toBeLessThanOrEqual(CLING.senseRangePx);
      expect(sight).toBeLessThanOrEqual(last);
      last = sight;
    }
    expect(senseCap(PARAMS.cup)).toBe(0);
  });

  // The sleep door of design doc 7.4 and 9.2: fully open below 15, shut at 50 or more. The doc's
  // worked examples (a cup at 08:00 leaves about 12 at 23:00, one at 15:00 about 33) are what make
  // the morning cup the cheap way through the corridor and the afternoon cup cost something.
  const DOOR = { fullOpenBelow: 15, shutAt: 50 };
  const leftAt23 = (cupAt: number) =>
    amount(metabolise(tagsFromQuery(`?tags=caffeine:${PARAMS.cup}`, TAGS), TAGS, (23 - cupAt) * 60, PARAMS), TAGS, 'caffeine');

  it('a cup at 08:00 no longer holds the sleep door at 23:00, and a cup at 15:00 still half-closes it', () => {
    expect(leftAt23(8)).toBeLessThan(DOOR.fullOpenBelow);
    expect(leftAt23(15)).toBeGreaterThanOrEqual(DOOR.fullOpenBelow);
    expect(leftAt23(15)).toBeLessThan(DOOR.shutAt);
  });
});

describe('blood glucose (design doc 7.3, 7.7)', () => {
  it('the morning value and the refill target lie in the normal band, and only a shut warehouse reaches the dizzy line', () => {
    const { band } = GLUCOSE;
    expect(GLUCOSE.start).toBeGreaterThanOrEqual(band.low);
    expect(GLUCOSE.start).toBeLessThanOrEqual(band.high);
    expect(GLUCOSE.refillTo).toBeGreaterThan(GLUCOSE.refillBelow);
    expect(GLUCOSE.refillTo).toBeLessThanOrEqual(band.high);
    expect(GLUCOSE.refillBelow).toBeLessThanOrEqual(band.low);
    // With the warehouse open a drop under refillBelow is refilled on the same tick, so the meter
    // never rests under refillBelow; the dizzy line must lie at or under it.
    expect(GLUCOSE.dizzyBelow).toBeLessThanOrEqual(GLUCOSE.refillBelow);
    expect(GLUCOSE.shutFloor).toBeLessThan(GLUCOSE.dizzyBelow);
  });
});
