// Risk-3 acceptance checks. Usage: node accept.js [n=500] [--param key=value ...]; exit 1 if any check fails.
import { STRATEGIES, EXTRA_STRATEGIES } from './strategies.js';
import { DIFFICULTY } from './params.js';
import { runBatch, stats, f1, f0 } from './batch.js';
import { evaluate } from './expect.js';

const ALL = { ...STRATEGIES, ...EXTRA_STRATEGIES };

export function accept(params = {}, n = 500) {
  const res = [];
  const add = (id, desc, pass, detail) => res.push({ id, desc, pass, detail });
  const at = (k, lv, extra = {}) => stats(runBatch(ALL[k], { n, params: { ...params, difficulty: lv, ...extra } }));

  const ladder = DIFFICULTY.map((_, lv) => ({
    R: at('應變派', lv), F: at('固定作息派', lv), Bl: at('應變派(不讀預告)', lv), B: at('平衡派', lv),
  }));
  const L0 = ladder[0], L5 = ladder[5];

  add('A1', '難度0：固定作息及格60-75%、總分比應變派低15%以上、應變派及格≥90%',
    L0.F.passFin >= 60 && L0.F.passFin <= 75 && L0.F.total <= 0.85 * L0.R.total && L0.R.passFin >= 90,
    `fixed ${f0(L0.F.passFin)}%, total ${f1(L0.F.total)} vs ${f1(L0.R.total)} (${f1((L0.F.total / L0.R.total - 1) * 100)}%), 應變派 ${f0(L0.R.passFin)}%`);
  add('A2', '難度5：固定作息<30%、應變派≥50%', L5.F.passFin < 30 && L5.R.passFin >= 50,
    `fixed ${f0(L5.F.passFin)}%, 應變派 ${f0(L5.R.passFin)}%`);
  const seq = ladder.map((x) => x.R.passFin);
  add('A3', '應變派及格率隨難度大致單調下降（容許回升≤3pt）', seq.every((v, i) => i === 0 || v <= seq[i - 1] + 3),
    seq.map(f0).join(' > '));

  // A4 late-night study group, isolated: random late groups removed, one forced on chosen nights, paired seeds
  const late = (days, k) => stats(runBatch(ALL[k], { n, params: { ...params, dropTypes: ['lateGroup'], forceItems: days.map((d) => ({ day: d, type: 'lateGroup' })) } })).total;
  const eveNo = late([4, 9], '應變派(深夜讀書會:不去)'), eveYes = late([4, 9], '應變派(深夜讀書會:只考前一晚)');
  const wkNo = late([2], '應變派(深夜讀書會:不去)'), wkYes = late([2], '應變派(深夜讀書會:都去)');
  const wkDelta = wkYes / wkNo - 1;
  add('A4', '深夜讀書會（×2.5）：考前一晚去的總分比不去低5%以上；期中前一週挑對時機去一次略高於不去',
    eveYes <= 0.95 * eveNo && wkDelta > 0,
    `exam eves ${f1(eveYes)} vs ${f1(eveNo)} (${f1((eveYes / eveNo - 1) * 100)}%); day 2 ${f1(wkYes)} vs ${f1(wkNo)} (${f1(wkDelta * 100)}%)`);

  const old = evaluate({ ...params, difficulty: 0 }, n);
  const oldFail = old.res.filter((r) => !r.pass);
  add('A5', '原 12 項教育檢查在難度0全部通過', oldFail.length === 0, oldFail.length ? oldFail.map((r) => r.id).join(',') : 'all pass');

  const gap = L0.R.total - L0.F.total, gapBlind = L0.Bl.total - L0.F.total;
  add('A6', '鑑別力：關掉預告後應變派對固定作息的差距縮小≥40%', gapBlind <= 0.6 * gap,
    `gap ${f1(gap)} -> ${f1(gapBlind)} (${f0((1 - gapBlind / gap) * 100)}% smaller); passFin ${f0(L0.R.passFin)}% -> ${f0(L0.Bl.passFin)}%`);
  return { res, ladder, old };
}

if (/accept\.js$/.test(process.argv[1] || '')) {
  const args = process.argv.slice(2);
  const n = Number(args.find((a) => /^\d+$/.test(a)) || 500);
  const params = {};
  for (let i = 0; i < args.length; i++) if (args[i] === '--param') { const [k, v] = args[++i].split('='); params[k] = Number(v); }
  const out = accept(params, n);
  console.log('難度        應變派               不讀預告            固定作息            平衡派   (total / passFin / hosp)');
  out.ladder.forEach((x, lv) => console.log(DIFFICULTY[lv].name.padEnd(8),
    ['R', 'Bl', 'F', 'B'].map((k) => `${f1(x[k].total)}/${f0(x[k].passFin)}%/${f0(x[k].hospital)}%`.padStart(18)).join('')));
  for (const r of out.old.res) if (!r.pass) console.log(`  old ${r.id} FAIL: ${r.detail}`);
  for (const r of out.res) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.id} ${r.desc} | ${r.detail}`);
  process.exitCode = out.res.every((r) => r.pass) ? 0 : 1;
}
