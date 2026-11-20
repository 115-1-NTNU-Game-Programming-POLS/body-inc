/**
 * Prints the four player archetypes of design doc 9.5 and exits 1 when an expectation fails that is not a known gap, or a
 * known gap holds or has moved further from the doc: `node check-archetypes.ts [n]`, n semesters, by default one for each
 * legal course selection. The expectations are in `expectations.ts`.
 */
import { expectations, SELECTION_COUNT, verdict } from './expectations.ts';

const n = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? SELECTION_COUNT);
const { ok, lines } = verdict(expectations(n), n);
for (const l of lines) console.log(l);
console.log(ok ? `the archetypes of design doc 9.5 hold, known gaps aside (${n} semesters)` : 'an archetype expectation broke');
process.exitCode = ok ? 0 : 1;
