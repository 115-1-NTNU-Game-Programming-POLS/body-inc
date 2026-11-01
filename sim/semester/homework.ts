/**
 * The operating-systems assignments against when they are started (design doc 9.6): `node homework.ts [n=300]`.
 * Wanted: starting two days or more before the deadline ends after 01:00 less than 10% of debugging nights and starting the
 * night before more than 50%, and starting early is the better play. The reward is HOMEWORK_PROGRESS of courses.ts.
 * Limits of the columns: the early player debugs at most 2 hours a night, so its `after01%` is bounded by that policy and
 * cannot fail on its own; read it together with `handed`, which says whether the spread still gets the work in. `sleep`
 * averages every night of the semester, so the debugging nights are diluted in it. `checks.ts` asserts these readings.
 */
import { HOMEWORK_PROGRESS } from '../../src/core/index.ts';
import { homeworkPlayer, homeworkRow } from './cards.ts';
import { ARCHETYPES } from './archetypes.ts';

const n = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 300);

const f1 = (x: number): string => x.toFixed(1).padStart(6);

console.log(`HOMEWORK_PROGRESS = ${HOMEWORK_PROGRESS}`);
console.log(`${'start'.padEnd(10)} skill  grade  pass%  handed  after01%  sleep`);
for (const skill of [0.2, 0.5]) {
  for (const [label, st] of [['ignore', ARCHETYPES.balanced], ['early', homeworkPlayer(true)], ['night before', homeworkPlayer(false)]] as const) {
    const row = homeworkRow(n, skill, st);
    console.log([label.padEnd(10), skill.toFixed(1).padStart(5), f1(row.grade), f1(row.pass), f1(row.handed), f1(row.after01).padStart(9), f1(row.sleep)].join(' '));
  }
}
