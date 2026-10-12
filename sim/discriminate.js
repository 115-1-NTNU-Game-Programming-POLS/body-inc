// Breaks one rule at a time and shows the checks notice it (a check that passes on broken params proves nothing).
import { evaluate, print } from './expect.js';

const n = Number(process.argv[2] || 300);
const CASES = [
  ['healthy (recommended params)', {}],
  ['BROKEN: S coefficient 0.07 -> 0.01', { sCoef: 0.01 }],
  ['BROKEN: S coefficient 0.01 and no department load from debt', { sCoef: 0.01, debtDemand: 0 }],
  ['BROKEN: no exam-day S discount', { examDiscount: false }],
  ['BROKEN: caffeine never hurts sleep (k=0)', { cafSleepK: 0 }],
  ['DOC-LITERAL: no caffeine dead zone', { cafDeadZone: 0 }],
  ['DOC-LITERAL: strikes keep backlog + debt kept after hospital', { strikeDropsBacklog: false, hospitalDebtMult: 1 }],
];
for (const [name, params] of CASES) {
  console.log(`\n=== ${name} ${JSON.stringify(params)}`);
  const out = evaluate(params, n);
  print(out);
  console.log(`=> ${out.res.filter((r) => !r.pass).length} of ${out.res.length} checks FAIL`);
}
