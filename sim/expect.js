// The doc's 數值驗證 table as executable checks. evaluate() never throws; callers decide what a failure means.
import { STRATEGIES, EXTRA_STRATEGIES } from './strategies.js';
import { CARDS } from './params.js';
import { runBatch, stats, f1, f0 } from './batch.js';

const ALL = { ...STRATEGIES, ...EXTRA_STRATEGIES };

export function evaluate(params = {}, n = 500) {
  const st = {}, games = {};
  const get = (k) => (st[k] ||= stats((games[k] = runBatch(ALL[k], { n, params }))));
  const det = (k) => runBatch(ALL[k], { n: 1, params, cards: [], noEvents: true })[0];
  const B = get('平衡派');
  const res = [];
  const add = (id, desc, pass, detail) => res.push({ id, desc, pass, detail });

  // E1 night owl leads early, is overtaken within a few days, ends below balanced
  const N = get('熬夜派(睡6h)');
  const lead = [2, 3].every((d) => N.cum[d - 1] > B.cum[d - 1]);
  const cross = B.cum.findIndex((x, i) => i > 0 && N.cum[i] < x) + 1;
  add('E1', '熬夜派前期領先、數日後被反超、總分低於平衡派', lead && cross > 0 && cross <= 7 && N.total < B.total,
    `day2-3 lead=${lead}, overtaken on day ${cross || 'never'}, total ${f1(N.total)} vs ${f1(B.total)}`);

  // E2 healthy-only fails the final but stays healthy
  const H = get('養生派');
  add('E2', '養生派健康但期末不及格', H.passFin <= 10 && H.hospital <= 5, `passFin ${f0(H.passFin)}%, hosp ${f0(H.hospital)}%`);

  // E3 balanced passes
  add('E3', '平衡派過關', B.passFin >= 85 && B.passMid >= 85 && B.hospital <= 5,
    `passMid ${f0(B.passMid)}%, passFin ${f0(B.passFin)}%, hosp ${f0(B.hospital)}%`);

  // E4 cramming: more progress at the exam, lower total score
  for (const k of ['考前通宵派(熬到03:00)', '考前通宵派(真通宵)']) {
    const C = get(k);
    // the midterm itself must already be lower: otherwise only the later debt, not the exam-day S, is doing the work
    add('E4', `${k}：考前進度較高但期中分數與總分都低於平衡派`, C.cum[4] > B.cum[4] && C.mid < B.mid && C.total < B.total,
      `progress@d5 ${f1(C.cum[4])} vs ${f1(B.cum[4])}, mid ${f1(C.mid)} vs ${f1(B.mid)}, total ${f1(C.total)} vs ${f1(B.total)}`);
  }

  // E5 caffeine dependence: cups escalate while debt grows, ends below balanced
  const Dd = det('咖啡因依賴派');
  const cups = Dd.trace.map((t) => t.cups).filter((x) => x !== undefined);
  const D = get('咖啡因依賴派');
  add('E5', '咖啡因依賴派惡性循環（杯數上升、睡眠債上升、總分低）',
    cups[cups.length - 1] > cups[0] && Dd.trace[4].debt >= 4 && D.total < B.total,
    `cups/day ${cups.join(',')}, debt@d5 ${f1(Dd.trace[4].debt)}, total ${f1(D.total)}, hosp ${f0(D.hospital)}%`);

  // E6 morning coffee (same 23:00 bedtime as balanced) slightly better than balanced (0-15%)
  const M = get('早上咖啡派');
  const gain = M.total / B.total - 1;
  add('E6', '早上咖啡派（同樣 23:00 睡）小幅優於平衡派', gain > 0 && gain <= 0.15, `total ${f1(M.total)} vs ${f1(B.total)} (${f1(gain * 100)}%)`);

  // E10 timing matters: a 15:00 coffee is worse than an 08:00 coffee and worse than none
  const L = get('下午咖啡派(15:00)');
  add('E10', '咖啡看時機：15:00 咖啡劣於早上咖啡與不喝', L.total < M.total && L.total < B.total,
    `15:00 ${f1(L.total)} vs 08:00 ${f1(M.total)} vs none ${f1(B.total)}`);

  // E11 the first ER is a usable checkpoint: it comes mid-game and a player who reforms survives
  const firstEr = (k) => {
    const d = games[k].filter((g) => g.hospital).map((g) => g.log.find((l) => l.type === 'ER').day);
    return d.length ? d.reduce((a, b) => a + b, 0) / d.length : NaN;
  };
  get('熬夜派(住院後改過)');
  const er = firstEr('熬夜派(睡6h)'), R = st['熬夜派(住院後改過)'];
  add('E11', '首次送急診落在中段、住院後改正作息可避免倒閉', er >= 4 && er <= 7 && R.bankrupt <= 20,
    `熬夜派 first ER day ${f1(er)}, reformed bankrupt ${f0(R.bankrupt)}% (no reform ${f0(N.bankrupt)}%)`);

  // E7 fixed routine cannot pass reliably across semester cards (doc risk 3).
  // Compared with 應變派 (same coffee + 22:30 base) instead of 平衡派, which was an unfair comparison.
  const F = get('固定作息派');
  const Rx = get('應變派');
  const perCard = CARDS.map((c) => {
    const others = CARDS.filter((x) => x !== c);
    return [c, stats(runBatch(ALL['固定作息派'], { n: Math.round(n / 2), params, cards: (i) => [c, others[i % others.length]] })).passFin];
  });
  const worst = perCard.reduce((a, b) => (b[1] < a[1] ? b : a));
  add('E7', '固定作息派在某些學期設定下無法穩定過關', F.passFin <= Rx.passFin - 10 && worst[1] < 60,
    `overall passFin ${f0(F.passFin)}% vs 應變派 ${f0(Rx.passFin)}%, worst card ${worst[0]} ${f0(worst[1])}%`);

  // E8 hard gap: doing exercise + 2h social every day at 8h sleep is not enough to pass reliably
  const A = get('全都要派(每天運動+社交2h)');
  add('E8', '時間硬缺口：每天運動+社交2h+睡8h 無法穩定過關', A.passFin < 70, `passFin ${f0(A.passFin)}%`);

  // E9 nothing that sleeps less than balanced beats it
  const less = ['熬夜派(睡6h)', '考前通宵派(熬到03:00)', '考前通宵派(真通宵)', '咖啡因依賴派', '平衡派+每天夜班借調'];
  const best = less.map((k) => [k, get(k).total]).reduce((a, b) => (b[1] > a[1] ? b : a));
  add('E9', '少睡的策略都不比平衡派強', best[1] < B.total, `best short-sleeper ${best[0]} ${f1(best[1])} vs 平衡 ${f1(B.total)}`);

  const ranking = Object.keys(st).map((k) => [k, st[k].total]).sort((a, b) => b[1] - a[1]);
  return { res, ranking, stats: st };
}

export function print({ res, ranking }) {
  for (const r of res) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.id} ${r.desc} | ${r.detail}`);
  console.log('ranking by mid+fin:', ranking.slice(0, 4).map(([k, v]) => `${k} ${f1(v)}`).join(' > '));
}
