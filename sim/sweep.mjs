import { STRATEGIES, EXTRA_STRATEGIES } from './strategies.js';
import { runBatch, stats, f0, f1 } from './batch.js';
const S = { ...STRATEGIES, ...EXTRA_STRATEGIES };
const names = ['平衡派','熬夜派(睡6h)','熬夜派(住院後改過)','咖啡因依賴派','考前通宵派(真通宵)','固定作息派'];
for (const dd of [0.08, 0.06, 0.05]) for (const hm of [1, 0.5]) {
  const row = names.map(k => { const g = runBatch(S[k], { n: 300, params: { debtDemand: dd, hospitalDebtMult: hm } });
    const st = stats(g); const er = g.filter(x=>x.hospital).map(x=>x.log.find(l=>l.type==='ER').day); const md = er.length? (er.reduce((a,b)=>a+b,0)/er.length).toFixed(1):'-';
    return `${k}:${f0(st.hospital)}/${f0(st.bankrupt)}@${md}`; });
  console.log(`dd=${dd} hm=${hm} | ` + row.join('  '));
}
