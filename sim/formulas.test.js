// Unit checks of the doc's closed-form formulas (node formulas.test.js).
import assert from 'node:assert/strict';
import { DEFAULTS } from './params.js';
import { sleepFactor, cafSleepCoef, decay, nextDebt, examScore } from './model.js';

const P = { ...DEFAULTS, cafDeadZone: 0 }; // doc-literal caffeine for the doc's worked examples
const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

// caffeine examples quoted in the doc
near(decay(100, 15, P), 12.5, 0.1); near(cafSleepCoef(decay(100, 15, P), P), 0.95);   // 08:00 -> 23:00
near(decay(100, 8, P), 33, 0.1);    near(cafSleepCoef(decay(100, 8, P), P), 0.868);   // 15:00 -> 23:00
near(decay(100, 5, P), 50);         near(cafSleepCoef(50, P), 0.8);                   // 20:00 -> 01:00
near(cafSleepCoef(250, P), 0.6);                                                       // capped at min(1, r/100)
assert.equal(cafSleepCoef(12.5, DEFAULTS), 1);                                         // proposed dead zone
// sleep debt: deficit adds 1:1, surplus repays 50%, floor 0
near(nextDebt(0, 6, P), 2); near(nextDebt(3, 10, P), 2); near(nextDebt(0.5, 10, P), 0);
// S = max(0.3, 1 - 0.07 debt)
near(sleepFactor(0, P), 1); near(sleepFactor(4, P), 0.72); near(sleepFactor(20, P), 0.3);
// exam score uses exam-morning S
near(examScore(50, 0.72, P), 36); near(examScore(50, 0.72, { ...P, examDiscount: false }), 50);
console.log('formula checks OK');
