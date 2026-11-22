/**
 * Prints the burden guard rail of design doc 8.3 over every legal selection and exits 1 when a criterion fails:
 * `node check-burden.ts [n=20] [skill=0.5]`. The rail is in `burden.ts`.
 */
import { allSelections, bestOf, burdenChecks, burdenRows, candidates } from './burden.ts';

const nums = process.argv.slice(2).filter((a) => /^\d+(\.\d+)?$/.test(a)).map(Number);
const n = nums[0] ?? 20;
const skill = nums[1] ?? 0.5;
const rows = burdenRows(n, skill, allSelections(), candidates());
const best = new Map<string, number>();
for (const r of rows) best.set(bestOf(r), (best.get(bestOf(r)) ?? 0) + 1);
console.log(`${rows.length} selections, ${n} seeds each, skill ${skill}; best strategy: ${[...best].map(([k, v]) => `${k} ${v}`).join(', ')}`);
const results = burdenChecks(rows);
for (const r of results) console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${r.name}: ${r.detail}`);
const failed = results.filter((r) => !r.pass).length;
console.log(`${results.length - failed} of ${results.length} burden guard rail checks hold`);
process.exitCode = failed === 0 ? 0 : 1;
