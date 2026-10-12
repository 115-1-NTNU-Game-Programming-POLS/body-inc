import { STRATEGIES } from './strategies.js';
import { runBatch } from './batch.js';
for (const k of ['平衡派','養生派','固定作息派']) {
  const g = runBatch(STRATEGIES[k], { n: 500 });
  const rates = [2,3,4,6,7,8,9].map(d => { const a = g.filter(x => x.trace[d-1]).map(x => x.trace[d-1].progress/(d-1)).sort((p,q)=>p-q); return a[Math.floor(a.length/2)].toFixed(2); });
  console.log(k, 'median progress/(day-1) on days 2,3,4,6,7,8,9:', rates.join(' '));
}
