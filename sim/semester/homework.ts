/**
 * The operating-systems assignments against when they are started (design doc 9.6): `node homework.ts [n=300]`.
 * Wanted: starting two days or more before the deadline ends after 01:00 less than 10% of debugging nights and starting the
 * night before more than 50%, and starting early is the better play. The reward is HOMEWORK_PROGRESS of courses.ts.
 */
import { HOMEWORK_PROGRESS, MAX_DEBUG_PER_NIGHT, runSemester, summarize, WRITE_HOURS, type Strategy } from '../../src/core/index.ts';
import { ARCHETYPES } from './archetypes.ts';
import { contextFor, scenarioFor } from './scenario.ts';

const n = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 300);
const COURSES = ['os', 'database', 'networks', 'ta'];
const base = ARCHETYPES.balanced;

/** `early` writes on the first day the assignment is open and debugs two hours a night; the other writes on the last day and debugs the whole night. */
const player = (early: boolean): Strategy => ({
  ...base,
  plan: (v) => {
    const h = v.homework.find((x) => x.written < WRITE_HOURS && (early || x.due - v.day === 1));
    return { ...base.plan(v), ...(h ? { write: WRITE_HOURS - h.written } : {}) };
  },
  night: (v) => {
    const h = v.homework.find((x) => x.debug !== undefined && x.debugged < x.debug);
    const hours = h ? Math.min(early ? 2 : MAX_DEBUG_PER_NIGHT, h.debug! - h.debugged) : 0;
    return { ...base.night(v), ...(hours > 0 ? { debug: hours } : {}) };
  },
});

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const f1 = (x: number): string => x.toFixed(1).padStart(6);

console.log(`HOMEWORK_PROGRESS = ${HOMEWORK_PROGRESS}`);
console.log(`${'start'.padEnd(10)} skill  grade  pass%  handed  after01%  sleep`);
for (const skill of [0.2, 0.5]) {
  const b = contextFor(skill, 1, { scenario: {} });
  for (const [label, st] of [['ignore', base], ['early', player(true)], ['night before', player(false)]] as const) {
    const grades: number[] = [];
    const pass: number[] = [];
    const handed: number[] = [];
    const late: number[] = [];
    const sleep: number[] = [];
    for (let seed = 1; seed <= n; seed++) {
      const ctx = { ...b, courses: COURSES, scenario: scenarioFor(seed) };
      const end = runSemester(ctx, st, seed);
      const m = summarize(end, ctx);
      grades.push(m.grade);
      pass.push(m.passMid && m.passFin ? 100 : 0);
      handed.push(end.history.reduce((a, r) => a + r.homework.filter((h) => h.done).length, 0));
      end.history.forEach((r, i) => {
        if (r.bedEnd === undefined) return;
        const next = end.history[i + 1];
        if (next) sleep.push(24 + next.wake - r.bedEnd);
        if (r.homework.some((h) => h.debugged > 0)) late.push(r.bedEnd >= 25 ? 100 : 0);
      });
    }
    console.log([label.padEnd(10), skill.toFixed(1).padStart(5), f1(mean(grades)), f1(mean(pass)), f1(mean(handed)), f1(mean(late)).padStart(9), f1(mean(sleep))].join(' '));
  }
}
