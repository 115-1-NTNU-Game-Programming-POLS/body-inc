/**
 * Prints the four player archetypes of design doc 9.5 and exits 1 when an expectation fails that is not a known gap, or a
 * known gap holds: `node check-archetypes.ts [n=200]`. The expectations are in `expectations.ts`.
 */
import { expectations, verdict } from './expectations.ts';

const n = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 200);
const { ok, lines } = verdict(expectations(n));
for (const l of lines) console.log(l);
console.log(ok ? `the archetypes of design doc 9.5 hold, known gaps aside (${n} seeds)` : 'an archetype expectation broke');
process.exitCode = ok ? 0 : 1;
