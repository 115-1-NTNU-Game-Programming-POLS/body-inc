// Usage: node debug.js <strategy name> [n=200] : prints ER causes and a few traces.
import { STRATEGIES, EXTRA_STRATEGIES } from './strategies.js';
import { runBatch } from './batch.js';

const name = process.argv[2] || '平衡派';
const n = Number(process.argv[3] || 200);
const games = runBatch({ ...STRATEGIES, ...EXTRA_STRATEGIES }[name], { n });
const er = games.filter((g) => g.hospital);
console.log(`${name}: ER in ${er.length}/${n}`);
for (const g of er.slice(0, 6)) {
  console.log(' cards', g.cards.join('+'), 'log', JSON.stringify(g.log.filter((l) => l.type !== 'infected')));
  console.log('  debt', g.trace.map((t) => t.debt.toFixed(1)).join(' '), '| stress', g.trace.map((t) => Math.round(t.stress)).join(' '));
}
const ok = games.filter((g) => !g.hospital).slice(0, 3);
for (const g of ok) {
  console.log(' OK cards', g.cards.join('+'), 'mid', g.mid.toFixed(1), 'fin', g.fin.toFixed(1));
  console.log('  studyH', g.trace.map((t) => t.studyH ?? '-').join(' '), '| bed', g.trace.map((t) => t.bed ?? '-').join(' '));
  console.log('  debt', g.trace.map((t) => t.debt.toFixed(1)).join(' '), '| social', g.trace.map((t) => t.social).join(' '));
}
