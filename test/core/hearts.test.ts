import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chairmanSpirit, createGame, debtOfSpirit, loadEnemyTable, sleepFactor, type EnteredRoom, type SleepCoefficients } from '../../src/core/index.ts';
import { BASE_HALVES, heartCap, MIN_HALVES } from '../../src/core/combat/frames.ts';

const TABLE = loadEnemyTable(JSON.parse(readFileSync('content/enemies.json', 'utf8')));
const K = JSON.parse(readFileSync('content/params.json', 'utf8')).defaults as SleepCoefficients;

/** The chairman's spirit a night's sleep debt leaves, through the real coefficients of content/params.json. */
const spiritAt = (debt: number): number => chairmanSpirit(sleepFactor(debt, K));
/** Whole hearts a debt leaves. */
const heartsAt = (debt: number): number => heartCap(spiritAt(debt)) / 2;

function room(): EnteredRoom {
  const cols = 20;
  const rows = 12;
  const solid = Array.from({ length: cols * rows }, (_, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    return c === 0 || r === 0 || c === cols - 1 || r === rows - 1;
  });
  return {
    id: 'test', grid: { cols, rows, solid }, props: {}, variants: [], active: [],
    objects: [{ id: 1, kind: 'PlayerStart', name: '', x: 160, y: 192, width: 0, height: 0, props: {}, conditions: {} }],
  };
}

describe('the heart cap follows the chairman\'s spirit (design doc 5.6, issue 61)', () => {
  it('is the table of the design doc: 6 hearts for 0 to 2 hours of debt, 5 for 3 to 7, 4 from 8', () => {
    for (const debt of [0, 1, 2]) expect(heartsAt(debt), `debt ${debt}`).toBe(6);
    for (const debt of [3, 4, 5, 6, 7]) expect(heartsAt(debt), `debt ${debt}`).toBe(5);
    for (const debt of [8, 9, 12, 20, 100]) expect(heartsAt(debt), `debt ${debt}`).toBe(4);
  });

  it('never rises with the debt, never leaves fewer than 4 hearts, and counts whole hearts', () => {
    let last = BASE_HALVES;
    for (let debt = 0; debt <= 30; debt += 0.25) {
      const cap = heartCap(spiritAt(debt));
      expect(cap, `debt ${debt}`).toBeLessThanOrEqual(last);
      expect(cap, `debt ${debt}`).toBeGreaterThanOrEqual(MIN_HALVES);
      expect(cap % 2, `debt ${debt}`).toBe(0);
      last = cap;
    }
    expect(MIN_HALVES).toBe(8);
    expect(heartCap(1)).toBe(BASE_HALVES);
  });

  it('rounds half a heart up and holds the floor of 4 hearts', () => {
    const table: [p: number, hearts: number][] = [[1, 6], [0.92, 6], [0.9167, 6], [0.9166, 5], [0.75, 5], [0.7499, 4], [0.65, 4], [0.5, 4], [0.1, 4]];
    for (const [p, hearts] of table) expect(heartCap(p) / 2, `P ${p}`).toBe(hearts);
  });

  it('follows a fractional debt to the edge of the table, not only whole hours', () => {
    // 6 hearts need 6 P of at least 5.5, which is an S of 5/6; 5 hearts need an S of 1/2.
    const edge6 = (1 - 5 / 6) / K.sCoef;
    const edge5 = (1 - 1 / 2) / K.sCoef;
    expect([heartsAt(edge6 - 0.01), heartsAt(edge6 + 0.01)]).toEqual([6, 5]);
    expect([heartsAt(edge5 - 0.01), heartsAt(edge5 + 0.01)]).toEqual([5, 4]);
  });

  it('reads the debt back from P, up to where S stops falling', () => {
    for (const debt of [0, 1, 2.4, 5, 7.2, 9]) expect(debtOfSpirit(spiritAt(debt), K).hours, `debt ${debt}`).toBeCloseTo(debt, 6);
    expect(debtOfSpirit(spiritAt(9), K).atFloor).toBe(false);
    const floor = debtOfSpirit(spiritAt(30), K);
    expect(floor.atFloor).toBe(true);
    expect(floor.hours).toBeCloseTo((1 - K.sFloor) / K.sCoef, 6);
    // A P below what any debt gives (a test or dev option) still reads as the floor.
    expect(debtOfSpirit(0.5, K).hours).toBeCloseTo(floor.hours, 6);
  });

  it('opens a room with all the hearts the spirit allows, and no more', () => {
    const tired = createGame(room(), 1, TABLE, { p: spiritAt(8) });
    expect(tired.operator.maxHalves).toBe(8);
    expect(tired.operator.halves).toBe(8);
    const rested = createGame(room(), 1, TABLE, { p: spiritAt(0) });
    expect(rested.operator.maxHalves).toBe(BASE_HALVES);
    expect(rested.operator.halves).toBe(BASE_HALVES);
  });

  it('keeps hearts carried in down to the cap of the new room, and lets fewer through', () => {
    const p = spiritAt(8);
    expect(createGame(room(), 1, TABLE, { p, halves: 12 }).operator.halves).toBe(8);
    expect(createGame(room(), 1, TABLE, { p, halves: 5 }).operator.halves).toBe(5);
    expect(createGame(room(), 1, TABLE, { p, halves: 5 }).operator.maxHalves).toBe(8);
  });

  it('still refuses a heart count outside the base hearts', () => {
    expect(() => createGame(room(), 1, TABLE, { halves: BASE_HALVES + 1 })).toThrow(/halves must be a whole number/);
    expect(() => createGame(room(), 1, TABLE, { halves: 0 })).toThrow(/halves must be a whole number/);
  });
});
