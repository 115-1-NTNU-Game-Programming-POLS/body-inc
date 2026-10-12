// Usage: node run.js [n=500] [--extra] [--param key=value ...]
import { STRATEGIES, EXTRA_STRATEGIES } from './strategies.js';
import { CARDS, DEFAULTS } from './params.js';
import { runBatch, stats, f1, f0 } from './batch.js';

const args = process.argv.slice(2);
const n = Number(args.find((a) => /^\d+$/.test(a)) || 500);
const params = {};
for (let i = 0; i < args.length; i++) if (args[i] === '--param') {
  const [k, v] = args[++i].split('=');
  params[k] = v === 'true' ? true : v === 'false' ? false : Number(v);
}
const P = { ...DEFAULTS, ...params };
const strats = { ...STRATEGIES, ...(args.includes('--extra') ? EXTRA_STRATEGIES : {}) };

console.log(`# params override: ${JSON.stringify(params)}  pass thresholds mid=${P.passMid} fin=${P.passFin}  n=${n}\n`);

console.log('## A. Deterministic baseline (no events, no semester cards): cumulative progress by morning of day d / S');
for (const [name, s] of Object.entries(strats)) {
  const g = runBatch(s, { n: 1, params, cards: [], noEvents: true })[0];
  console.log(`${name.padEnd(18)} cum: ${g.trace.map((t) => f1(t.progress)).join(' ')} | S: ${g.trace.map((t) => t.S.toFixed(2)).join(' ')} | mid ${f1(g.mid)} fin ${f1(g.fin)}${g.hospital ? ' ER@d' + g.log.find((l) => l.type === 'ER').day : ''}${g.trace.some((t) => t.cups) ? ' cups ' + g.trace.map((t) => t.cups ?? '-').join('') : ''}`);
}

console.log('\n## B. Batch with random events + 2 random semester cards');
console.log('strategy           | mid  | fin  | mid+fin | passMid% | passFin% | hosp% | bankr% | fever% | debt@d10 | cups d1-3 -> d7-9');
const all = {};
for (const [name, s] of Object.entries(strats)) {
  const st = stats(runBatch(s, { n, params }));
  all[name] = st;
  console.log(`${name.padEnd(18)} | ${f1(st.mid)} | ${f1(st.fin)} | ${f1(st.total)} | ${f0(st.passMid)} | ${f0(st.passFin)} | ${f0(st.hospital)} | ${f0(st.bankrupt)} | ${f0(st.fever)} | ${f1(st.debt10)} | ${f1(st.cupsEarly)} -> ${f1(st.cupsLate)}`);
}

console.log('\n## C. Mean cumulative progress by morning of day d (batch)');
for (const [name, st] of Object.entries(all)) console.log(`${name.padEnd(18)} ${st.cum.map(f1).join(' ')}`);

if (args.includes('--cards')) {
  console.log('\n## D. passMid% / passFin% when one semester card is forced (second card random among the rest)');
  const pick = Object.keys(strats).filter((k) => /^平衡派$|^應變派$|^固定作息派$|^應變派\(不讀預告\)$/.test(k));
  console.log('card'.padEnd(10) + pick.map((p) => p.padStart(16)).join(''));
  for (const c of [null, ...CARDS]) {
    const others = CARDS.filter((x) => x !== c);
    const cardsFn = c ? (i) => [c, others[i % others.length]] : [];
    const row = pick.map((p) => {
      const st = stats(runBatch(strats[p], { n, params, cards: cardsFn }));
      return `${f0(st.passMid)}/${f0(st.passFin)}`.padStart(16);
    });
    console.log((c || '無設定卡').padEnd(10) + row.join(''));
  }
}
