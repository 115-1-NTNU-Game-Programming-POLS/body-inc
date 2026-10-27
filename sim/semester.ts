/**
 * Headless semester runs on the shared core (build plan L3).
 *
 *   node semester.ts [n=200]      exit 1 when any simulated state breaks an invariant
 *
 * Every archetype plays n semesters at a low and a high combat skill (design doc 9.5). The table is
 * a first look at the building, not a balance result: the floor numbers of design doc 8.4 are
 * first versions that design doc 9.6 lists for re-simulation. What the exit code vouches for is
 * structural: the liver light is off in every state, a floor never skips its orange night, and a
 * liver strike always has its three conditions.
 */
import { runSemester, semesterProblems, summarize } from '../src/core/index.ts';
import { ARCHETYPES, type ArchetypeName } from './semester/archetypes.ts';
import { bingeWeek, contextFor, scenarioFor } from './semester/scenario.ts';

const n = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 200);
const SKILLS = [0.2, 0.9] as const;
const SCENARIOS = { regular: scenarioFor, 'binge week': bingeWeek } as const;

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const pct = (xs: readonly boolean[]): number => (100 * xs.filter(Boolean).length) / Math.max(1, xs.length);
const f1 = (x: number): string => x.toFixed(1).padStart(6);

console.log(`${'scenario'.padEnd(10)} ${'archetype'.padEnd(16)} skill   mid   fin  grade  pass%  hosp%  bank%  liver peak  liver strikes  lit-liver days  problems`);
let problems = 0;
for (const [scenario, scenarioOf] of Object.entries(SCENARIOS)) {
  for (const name of Object.keys(ARCHETYPES) as ArchetypeName[]) {
    for (const skill of SKILLS) {
      const rows = [];
      for (let seed = 1; seed <= n; seed++) {
        const ctx = contextFor(skill, seed, { scenario: scenarioOf(seed) });
        const end = runSemester(ctx, ARCHETYPES[name], seed);
        const found = semesterProblems(end.history, ctx.params);
        problems += found.length;
        if (found.length > 0) console.log(`  ${scenario}, ${name}, seed ${seed}: ${found[0]}`);
        rows.push({
          sum: summarize(end, ctx),
          liverPeak: Math.max(...end.history.map((r) => r.loadsSettled.liver)),
          liverStrikes: end.history.filter((r) => r.strikes.includes('liver')).length,
          litLiver: end.history.filter((r) => r.lights.liver !== 'off').length,
          problems: found.length,
        });
      }
      console.log([
        scenario.padEnd(10), name.padEnd(16), skill.toFixed(1).padStart(5), f1(mean(rows.map((r) => r.sum.mid))), f1(mean(rows.map((r) => r.sum.fin))),
        f1(mean(rows.map((r) => r.sum.grade))), f1(pct(rows.map((r) => r.sum.passMid && r.sum.passFin))),
        f1(pct(rows.map((r) => r.sum.hospitalized))), f1(pct(rows.map((r) => r.sum.bankrupt))),
        f1(mean(rows.map((r) => r.liverPeak))).padStart(10), f1(mean(rows.map((r) => r.liverStrikes))).padStart(13),
        String(rows.reduce((a, r) => a + r.litLiver, 0)).padStart(14), String(rows.reduce((a, r) => a + r.problems, 0)).padStart(9),
      ].join(' '));
    }
  }
}
process.exitCode = problems === 0 ? 0 : 1;
