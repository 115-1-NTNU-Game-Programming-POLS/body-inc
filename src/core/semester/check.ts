import { FLOORS, lightOf, LIVER, mapFloors, type FloorThresholds, type Loads } from './floors.ts';
import type { DayRecord } from './types.ts';

/**
 * Invariants of design doc 8.4 and 8.6 that must hold in every simulated state, read off a
 * semester's history. The sim and the tests share it, so a rule that is broken in the rules layer
 * shows up wherever a semester is run. Returns one sentence per violation; empty means healthy.
 */
export function semesterProblems(history: readonly DayRecord[], k: FloorThresholds & { readonly floorOmenCap: number }): string[] {
  const out: string[] = [];
  let before: Loads | undefined;
  for (const r of history) {
    const at = `day ${r.day}`;
    if (r.lights.liver !== 'off') out.push(`${at}: the liver light is ${r.lights.liver}; it must stay off (8.6)`);
    if (r.lit.includes(LIVER)) out.push(`${at}: the liver is counted among the lit floors`);
    if (!r.liverNote) out.push(`${at}: the liver button has lost its smiley note`);
    if (r.routine === LIVER) out.push(`${at}: the routine patrol marker points at the liver`);

    const shown = mapFloors((f) => lightOf(f, r.loadsBefore[f], k));
    for (const f of FLOORS) {
      if (r.lights[f] !== shown[f]) out.push(`${at}: ${f} showed ${r.lights[f]} for a load of ${r.loadsBefore[f]}, which is ${shown[f]}`);
      for (const [name, load] of [['before', r.loadsBefore[f]], ['after', r.loadsAfter[f]]] as const) {
        if (!(load >= 0 && load <= 100)) out.push(`${at}: ${f} load ${load} (${name}) is outside 0 to 100`);
      }
      if (!r.settled) continue;
      // Omen guarantee: nothing strikes without at least one orange night first.
      if (r.loadsBefore[f] < k.floorOrangeAt && r.loadsSettled[f] > k.floorOmenCap) {
        out.push(`${at}: ${f} rose from ${r.loadsBefore[f]} to ${r.loadsSettled[f]} in one night, past the cap of ${k.floorOmenCap}`);
      }
      if (f !== LIVER && r.loadsSettled[f] >= k.floorRedAt !== r.strikes.includes(f)) {
        out.push(`${at}: ${f} settles at ${r.loadsSettled[f]} and ${r.strikes.includes(f) ? 'strikes' : 'does not strike'}`);
      }
    }
    if (r.strikes.includes(LIVER)) {
      const why = r.liverStrike;
      if (!why || !why.alcoholAtBed || !why.orderBefore || r.loadsSettled.liver < k.floorRedAt) {
        out.push(`${at}: the liver struck without all three conditions of 8.6`);
      }
    } else if (r.liverStrike) {
      out.push(`${at}: a liver strike is explained but the liver is not on strike`);
    }
    if (before) {
      for (const f of FLOORS) if (r.loadsBefore[f] !== before[f]) out.push(`${at}: ${f} began at ${r.loadsBefore[f]} but ended the previous day at ${before[f]}`);
    }
    before = r.loadsAfter;
  }
  return out;
}
