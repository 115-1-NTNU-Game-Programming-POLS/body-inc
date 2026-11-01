/** Prints the course card checks of design doc 9.6 and exits 1 when one fails: `node check-cards.ts [n=300]`. */
import { courseCardChecks } from './checks.ts';

const n = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 300);
const results = courseCardChecks(n);
for (const r of results) console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${r.name}: ${r.detail}`);
const failed = results.filter((r) => !r.pass).length;
console.log(`${results.length - failed} of ${results.length} course card checks hold`);
process.exitCode = failed === 0 ? 0 : 1;
