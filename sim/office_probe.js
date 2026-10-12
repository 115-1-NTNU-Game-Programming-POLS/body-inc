// Confirms the office-hour gate: low-progress players attend but get no bonus.
import { runBatch } from './batch.js';
import { STRATEGIES, EXTRA_STRATEGIES } from './strategies.js';

const ALL = { ...STRATEGIES, ...EXTRA_STRATEGIES };
for (const name of ['養生派', '平衡派', '應變派']) {
  const games = runBatch(ALL[name], { n: 300 });
  const went = games.reduce((s, g) => s + g.offices, 0);
  const got = games.reduce((s, g) => s + g.officesUnderstood, 0);
  console.log(`${name}: office hours attended ${went}, understood ${got} (${went ? ((100 * got) / went).toFixed(0) : 0}%)`);
}
