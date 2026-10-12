// Usage: node ladder.js [n=500] : difficulty x strategy table (mean mid+fin, final pass %, hospital %).
import { STRATEGIES, EXTRA_STRATEGIES } from './strategies.js';
import { DIFFICULTY } from './params.js';
import { runBatch, stats, f1, f0 } from './batch.js';

export const LADDER_STRATS = ['應變派', '應變派(不讀預告)', '固定作息派', '早上咖啡派(22:30睡)', '平衡派'];
const ALL = { ...STRATEGIES, ...EXTRA_STRATEGIES };

export function ladder(n = 500, params = {}, names = LADDER_STRATS) {
  return DIFFICULTY.map((D, lv) => Object.fromEntries(names.map((k) => [k, stats(runBatch(ALL[k], { n, params: { ...params, difficulty: lv } }))])));
}

if (/ladder\.js$/.test(process.argv[1] || '')) {
  const n = Number(process.argv[2] || 500);
  const L = ladder(n);
  console.log('難度'.padEnd(10) + LADDER_STRATS.map((k) => k.padStart(22)).join(''));
  L.forEach((row, lv) => console.log(DIFFICULTY[lv].name.padEnd(10) +
    LADDER_STRATS.map((k) => `${f1(row[k].total)} / ${f0(row[k].passFin)}% / ${f0(row[k].hospital)}%`.padStart(22)).join('')));
  console.log('cells: mean mid+fin / final pass % / hospital %');
}
