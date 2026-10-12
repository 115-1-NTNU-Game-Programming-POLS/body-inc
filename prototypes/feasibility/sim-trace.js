'use strict';
// Feasibility spike: simulation layer with causal tag records + crash-report back-tracing.
// Numbers are toy values, not a balance proposal. Run: node sim-trace.js

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

class Sim {
  constructor(seed, strategy) {
    this.rng = mulberry32(seed);
    this.s = strategy;
    this.day = 1; this.hour = 7;
    this.m = { sleepDebt: 0, stress: 20, study: 0, caffeine: 0 };
    this.grudge = { brain: 0, immune: 0 };
    this.nodes = [];          // causal graph: every event / tag / crisis is a node with `causes`
    this.tags = new Map();    // tag -> { nid, until }
    this.ledger = {};         // metric -> day -> nodeId -> accumulated delta
    this.highStressDays = 0;
    this.result = null;
  }
  node(kind, data, causes = []) {
    const n = { id: this.nodes.length, kind, day: this.day, hour: this.hour, causes: causes.filter(c => c != null), causeAt: {}, ...data };
    for (const c of n.causes) n.causeAt[c] = this.now();
    this.nodes.push(n); return n.id;
  }
  // Activity nodes are memoised per day so a repeated activity is one cause, not 18.
  activity(key) {
    const k = `${this.day}:${key}`;
    this._act = this._act || {};
    if (this._act[k] == null) this._act[k] = this.node('activity', { key });
    return this._act[k];
  }
  now() { return this.day * 100 + this.hour; }
  change(metric, delta, src) {
    this.m[metric] += delta;
    if (metric === 'stress') this.m.stress = clamp(this.m.stress, 0, 100);
    const L = ((this.ledger[metric] ||= {})[this.day] ||= {});
    L[src] = (L[src] || 0) + delta;
  }
  // Metric-threshold tags need attribution, otherwise the chain breaks at "stress > 70".
  topContributors(metric, fromDay, toDay, k = 2) {
    const sum = {};
    for (let d = fromDay; d <= toDay; d++)
      for (const [src, v] of Object.entries((this.ledger[metric] || {})[d] || {}))
        if (v > 0) sum[src] = (sum[src] || 0) + v;
    return Object.entries(sum).sort((a, b) => b[1] - a[1]).slice(0, k).map(([src]) => +src);
  }
  addTag(tag, days, causes) {
    if (this.tags.has(tag)) {
      // Without this, causes freeze at first creation and later culprits (e.g. coffee) never reach the report.
      if (Sim.ACCUMULATE) {
        const n = this.nodes[this.tags.get(tag).nid];
        for (const c of causes) if (c != null && c !== n.id && !n.causes.includes(c)) { n.causes.push(c); n.causeAt[c] = this.now(); }
      }
      return this.tags.get(tag).nid;
    }
    const nid = this.node('tag', { tag }, causes);
    this.tags.set(tag, { nid, until: this.day + days });
    return nid;
  }
  tagNid(tag) { return this.tags.has(tag) ? this.tags.get(tag).nid : null; }

  runDay() {
    const s = this.s;
    let coffeeNid = null;
    // Day: study; coffee when brain is impaired
    const brainEff = Math.max(0.2, 1 - 0.08 * this.m.sleepDebt);
    if (s.coffee && this.m.sleepDebt >= 2) {
      this.hour = 15;
      coffeeNid = this.node('event', { key: 'coffee' }, [this.tagNid('sleep_debt')]);
      this.m.caffeine = 100;
      if (s.coffee === 2) { this.hour = 19; this.m.caffeine = 100 * Math.pow(0.5, 4 / 5) + 100; }
    }
    if (this.day >= 3 && this.day <= 6) {
      this.hour = 9;
      const dl = this.node('event', { key: 'deadline' });
      this.change('stress', 12, dl);
    }
    this.hour = 20;
    const studyNid = this.activity(s.bed > 24 ? 'study_late' : 'study');
    this.m.study += s.studyHours * brainEff * (coffeeNid != null ? 1.2 : 1);
    this.change('stress', s.studyHours * 2, studyNid);
    if (s.exercise) this.change('stress', -10, this.activity('exercise'));
    this.change('stress', -6, this.activity('sleep'));

    // Night settlement
    this.hour = s.bed;
    const caffeineAtBed = coffeeNid != null ? this.m.caffeine * Math.pow(0.5, (s.bed - (s.coffee === 2 ? 19 : 15)) / 5) : 0;
    let eff = 1;
    let caffeineNid = null;
    if (caffeineAtBed > 50) { eff *= 0.7; caffeineNid = this.node('effect', { key: 'caffeine_insomnia', residual: Math.round(caffeineAtBed) }, [coffeeNid]); }
    if (this.tags.has('chronic_stress')) eff *= 0.85;
    const hours = 7 + 24 - s.bed;   // wake at 07:00
    const effective = hours * eff;
    const loss = 8 - effective;
    const repay = Math.min(2, Math.max(0, -loss));
    // First run of the spike used null here for bed=24 and crashed the tracer: every metric change needs a source node.
    const lateNid = this.activity(s.bed > 24 ? 'stayed_up' : 'short_sleep');
    if (loss > 0) {
      // Split attribution between staying up and caffeine-induced inefficiency
      const lostToBedtime = Math.max(0, 8 - hours), lostToEff = loss - lostToBedtime;
      if (lostToBedtime > 0) this.change('sleepDebt', lostToBedtime, lateNid);
      if (lostToEff > 0) this.change('sleepDebt', lostToEff, caffeineNid ?? this.tagNid('chronic_stress') ?? lateNid);
    } else this.change('sleepDebt', -repay, this.activity('sleep'));
    this.m.sleepDebt = Math.max(0, this.m.sleepDebt);

    if (this.m.sleepDebt >= 3) this.addTag('sleep_debt', 99, this.topContributors('sleepDebt', 1, this.day));
    if (this.m.stress > 70) this.highStressDays++; else this.highStressDays = 0;
    if (this.highStressDays >= 2) this.addTag('chronic_stress', 99, this.topContributors('stress', this.day - 1, this.day));
    if (this.tags.has('chronic_stress') && !this._cut) {
      this._cut = this.node('event', { key: 'immune_budget_cut' }, [this.tagNid('chronic_stress')]);
    }
    if (this._cut) this.grudge.immune = clamp(this.grudge.immune + 15, 0, 100);
    this.grudge.brain = clamp(this.grudge.brain + this.m.sleepDebt * 6 - 8, 0, 100);
    if (this.grudge.brain > 85) this.addTag('brain_strike', 99, [this.tagNid('sleep_debt')]);

    // Virus exposure on day 7
    if (this.day === 7) {
      this.hour = 12;
      const contact = this.node('event', { key: 'roommate_flu' });
      const mH = this.tags.has('chronic_stress') ? 1.5 : 1, mS = this.m.sleepDebt >= 3 ? 1.4 : 1;
      const p = 0.3 * (1 + this.grudge.immune / 100) * mH * mS;
      if (this.rng() < p) {
        const causes = [contact, mH > 1 ? this.tagNid('chronic_stress') : null, mS > 1 ? this.tagNid('sleep_debt') : null, this._cut || null];
        this.addTag('flu', 3, causes);
      }
    }
    if (this.tags.has('brain_strike') && this.tags.has('flu')) {
      this.result = { type: 'bankrupt', nid: this.node('crisis', { key: 'er_visit' }, [this.tagNid('brain_strike'), this.tagNid('flu')]) };
      return false;
    }
    if (this.day === 10) { this.result = { type: this.m.study >= 45 ? 'pass' : 'fail' }; return false; }
    this.day++; return true;
  }
  run() { while (this.runDay()); return this; }

  // Back-trace: collect every ancestor of the crisis node, order by time, render with templates.
  trace(nid) {
    // Edges added after the crisis moment must be ignored, or the report cites things that happened later.
    const limit = this.nodes[nid].day * 100 + this.nodes[nid].hour;
    const seen = new Set(), stack = [nid];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const n = this.nodes[id];
      stack.push(...n.causes.filter(c => !Sim.TIME_BOUND || n.causeAt[c] <= limit));
    }
    return [...seen].map(i => this.nodes[i]).sort((a, b) => a.day - b.day || a.hour - b.hour || a.id - b.id);
  }
  report(nid) {
    const T = {
      'activity:study_late': n => `第 ${n.day} 天，宿主熬夜讀書，大腦部門持續加班`,
      'activity:stayed_up': n => `第 ${n.day} 天，宿主凌晨 ${n.hour - 24} 點才就寢，夜班清潔隊無法完成修復`,
      'event:deadline': n => `第 ${n.day} 天，報告死線逼近`,
      'event:coffee': n => `第 ${n.day} 天下午，董事長批准緊急咖啡採購`,
      'effect:caffeine_insomnia': n => `當晚咖啡因殘留 ${n.residual} 單位，宿主輾轉難眠`,
      'tag:sleep_debt': n => `第 ${n.day} 天起，公司背負「睡眠債」`,
      'tag:chronic_stress': n => `第 ${n.day} 天，公司進入「長期高壓」狀態`,
      'event:immune_budget_cut': n => `免疫保全部預算遭緊急應變小組挪用`,
      'tag:brain_strike': n => `第 ${n.day} 天，大腦部門宣布罷工`,
      'event:roommate_flu': n => `第 ${n.day} 天，室友把流感病毒帶進宿舍`,
      'tag:flu': n => `病毒長驅直入，宿主發燒`,
      'crisis:er_visit': n => `結果：第 ${n.day} 天，宿主被送進急診，公司宣告倒閉`,
    };
    const lines = this.trace(nid).map(n => {
      const f = T[`${n.kind}:${n.key || n.tag}`];
      return f ? f(n) : `[缺模板 ${n.kind}:${n.key || n.tag}]`;
    });
    // Collapse consecutive identical-template days ("連續 N 晚熬夜") would go here; omitted in spike.
    return '事故經過：' + lines.join('；') + '。';
  }
}

const strategies = {
  nightOwl:  { bed: 26, studyHours: 6, coffee: 0, exercise: false },
  caffeine:  { bed: 25, studyHours: 5, coffee: 2, exercise: false },
  healthy:   { bed: 23, studyHours: 2, coffee: 0, exercise: true },
  balanced:  { bed: 24, studyHours: 4, coffee: 0, exercise: true },
};

// 1) One traced run that goes bankrupt, with frozen vs accumulating tag causes
for (const [acc, tb] of [[false, false], [true, false], [true, true]]) {
Sim.ACCUMULATE = acc; Sim.TIME_BOUND = tb;
let demo = null;
for (let seed = 1; seed < 200 && !demo; seed++) {
  const sim = new Sim(seed, strategies.caffeine).run();
  if (sim.result.type === 'bankrupt') demo = { seed, sim };
}
if (demo) {
  const { sim, seed } = demo;
  console.log(`== Traced bankrupt run (strategy=caffeine, seed=${seed}, accumulateCauses=${acc}, timeBounded=${tb}) ==`);
  console.log(`graph nodes total: ${sim.nodes.length}, ancestors of crisis: ${sim.trace(sim.result.nid).length}`);
  for (const n of sim.trace(sim.result.nid))
    console.log(`  #${n.id} d${n.day} h${n.hour} ${n.kind}:${n.key || n.tag} <- [${n.causes.join(',')}]`);
  console.log('\n' + sim.report(sim.result.nid) + '\n');
} else console.log('no bankrupt run found');
}
Sim.ACCUMULATE = true; Sim.TIME_BOUND = true;

// 2) Batch strategy simulation throughput
const N = 500;
const t0 = process.hrtime.bigint();
for (const [name, st] of Object.entries(strategies)) {
  const tally = { bankrupt: 0, pass: 0, fail: 0 };
  let missing = 0;
  for (let i = 0; i < N; i++) {
    const sim = new Sim(1000 + i, st).run();
    tally[sim.result.type]++;
    if (sim.result.type === 'bankrupt' && sim.report(sim.result.nid).includes('缺模板')) missing++;
  }
  console.log(`${name.padEnd(9)} x${N}: ${JSON.stringify(tally)} reportsWithMissingTemplate=${missing}`);
}
console.log(`batch time: ${Number(process.hrtime.bigint() - t0) / 1e6} ms for ${4 * N} runs`);
