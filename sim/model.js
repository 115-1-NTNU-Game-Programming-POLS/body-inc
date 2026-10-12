// Simulation layer: pure JS, no rendering. One game = runGame(strategy, opts).
import { DEFAULTS, CARDS, DIFFICULTY } from './params.js';
import { makeRng } from './rng.js';
import { drawSlotEvents, scheduleOnce, SLOT_EVENTS, ONCE_EVENTS } from './events.js';
import { buildCalendar, drawCardsFor, OPPORTUNITY, ACT_OF } from './calendar.js';

export const DEPTS = ['brain', 'stomach', 'gut', 'liver', 'immune', 'muscle'];

// ---------- formulas from the doc (pure)
export const sleepFactor = (debt, P) => Math.max(P.sFloor, 1 - P.sCoef * debt);
export const cafSleepCoef = (res, P) => (res < P.cafDeadZone ? 1 : 1 - P.cafSleepK * Math.min(1, res / 100));
export const decay = (res, hours, P) => res * Math.pow(0.5, hours / P.halfLife);
export const nextDebt = (debt, eff, P) =>
  eff <= P.sleepNeed ? debt + (P.sleepNeed - eff) : Math.max(0, debt - P.repayRatio * (eff - P.sleepNeed));
export const infectionP = (st, P) =>
  P.infBase * (1 + st.depts.immune.res / 100) * (st.chronic ? P.chronicInf : 1) *
  (st.debt >= P.debtInfAt ? P.debtInf : 1) * (st.vaccinated ? P.vaccineInf : 1);
export const examScore = (progress, S, P) => progress * (P.examDiscount ? S : 1);

export function isWeekend(day, P) { return P.weekend.includes(day); }

// Hours the player cannot schedule (meals, class, exam, commute, job, club).
export function mandatoryFor(day, wake, P, cards, items = [], rsvp = new Set()) {
  const m = new Map();
  const wk = isWeekend(day, P);
  const its = items.filter((i) => i.day === day);
  m.set(wake < P.meals[0] ? wake : Math.max(wake, P.meals[0]), 'meal');
  for (const h of P.meals.slice(1)) m.set(h, 'meal');
  if (!wk && !its.some((i) => i.type === 'typhoon' || i.type === 'lab')) {
    for (const h of cards.has('滿堂早八') ? P.classesEarly : P.classes) m.set(h, 'class');
    if (cards.has('通勤生')) for (const h of P.commute) m.set(h, 'commute');
  }
  if (day === P.midDay || day === P.finDay) for (const h of P.examHours) m.set(h, 'exam');
  if (P.jobDays.includes(day) && cards.has('週末打工')) for (const h of P.job) m.set(h, 'work');
  if (cards.has('社團幹部') && P.clubDays.includes(day)) for (const h of P.clubHours) m.set(h, 'social');
  const ACT = { lab: 'class', makeup: 'class', shift: 'work', nightShift: 'work', showcase: 'social' };
  for (const it of its) if (ACT[it.type]) for (const h of it.hours) if (m.get(h) !== 'exam') m.set(h, ACT[it.type]);
  // an RSVP'd opportunity happens only if none of its hours collide with something mandatory
  for (const it of its) {
    if (!OPPORTUNITY.has(it.type) || !rsvp.has(it.id)) continue;
    if (it.hours.every((h) => !m.has(h))) for (const h of it.hours) m.set(h, ACT_OF[it.type]);
  }
  for (const h of [...m.keys()]) if (h < wake) m.delete(h);
  return m;
}

// First hour of `day` that is fixed and not a meal (used to cap how late one can sleep in).
export function wakeCapFor(day, P, cards, items) {
  const m = mandatoryFor(day, 0, P, cards, items);
  const hs = [...m.entries()].filter(([, a]) => a !== 'meal').map(([h]) => h);
  const mk = items.find((i) => i.day === day && i.type === 'makeup');
  const exam = day === P.midDay || day === P.finDay ? P.examWake : 99;
  return Math.min(P.wakeCap, hs.length ? Math.min(...hs) - 1 : 99, mk ? mk.wake : 99, exam);
}

function initState(P, cards) {
  const depts = {};
  for (const d of DEPTS) depts[d] = { res: 0, backlog: 0, striking: false, strikeH: 0 };
  return {
    day: 1, wake: P.wake, debt: 0, caf: 0, progress: 0, stress: P.stress0, social: P.social0,
    depts, cards, chronic: false, highDays: 0, vaccinated: false, ill: null, gastro: 0,
    homesick: false, tolerant: false, cupsHist: [], zeroCupDays: 0, injured: false,
    hospital: 0, hospitalDay: null, bankrupt: false, scores: { mid: null, fin: null },
    trace: [], log: [], recent: {}, items: [], rsvp: new Set(), bonus: { mid: 1, fin: 1 },
  };
}

function ctxOf(st, P, extra = {}) {
  const d = st.day;
  const vis = (i) => ({ ...i, rsvpd: st.rsvp.has(i.id) });
  return {
    today: st.items.filter((i) => i.day === d && (i.announced || !OPPORTUNITY.has(i.type))).map(vis),
    tomorrow: st.items.filter((i) => i.day === d + 1 && i.announced && i.type !== 'pastExam').map(vis),
    wakeCapTomorrow: wakeCapFor(d + 1, P, st.cards, st.items),
    bonus: { ...st.bonus },
    day: st.day, P, cards: st.cards, debt: st.debt, S: sleepFactor(st.debt, P), stress: st.stress,
    social: st.social, caf: st.caf, ill: st.ill ? st.ill.stage : null, chronic: st.chronic,
    tolerant: st.tolerant, hospital: st.hospital, weekend: isWeekend(st.day, P), wake: st.wake, injured: st.injured,
    examTomorrow: st.day + 1 === P.midDay || st.day + 1 === P.finDay,
    nextWeekend: isWeekend(st.day + 1, P),
    mandatory: (wake) => mandatoryFor(st.day, wake, P, st.cards, st.items, st.rsvp),
    ...extra,
  };
}

function choose(strategy, id, options, ctx) {
  const pick = strategy.choose ? strategy.choose(id, ctx) : undefined;
  return options[pick] ? pick : Object.keys(options)[0];
}

function mergeEffects(list) {
  const e = { social: 0, stress: 0, chores: 0, socialHours: 0, bedDelay: 0, sleepMult: 1, delayActs: [] };
  for (const x of list) {
    e.social += x.social || 0; e.stress += x.stress || 0; e.chores += x.chores || 0;
    e.socialHours += x.socialHours || 0;
    if (x.bedDelay) { e.bedDelay += x.bedDelay; e.delayActs.push([x.bedDelay, x.bedDelayAct || 'leisure']); }
    if (x.sleepMult) e.sleepMult *= x.sleepMult;
    for (const k of ['slump', 'alcohol', 'exposure', 'vaccine', 'nightShift', 'energyDrinkChance', 'liverRes', 'debt'])
      if (x[k] !== undefined) e[k] = (typeof x[k] === 'number' && e[k]) ? e[k] + x[k] : x[k];
    if (x.homesick !== undefined) e.homesick = x.homesick;
  }
  return e;
}

function hospitalize(st, P, why) {
  st.hospital += 1;
  st.log.push({ day: st.day, type: 'ER', why });
  if (st.hospital >= 2) { st.bankrupt = true; return; }
  for (const d of DEPTS) Object.assign(st.depts[d], { res: P.hospitalRes, backlog: 0, striking: false, strikeH: 0 });
  st.stress = Math.min(100, st.stress + P.hospitalStress);
  st.ill = null; st.gastro = 0;
  st.debt *= P.hospitalDebtMult;
  st.hospitalDay = st.day + 1;
}

let opts_debug = null;

// ---------- one game
export function runGame(strategy, opts = {}) {
  opts_debug = opts.debug || null;
  const P0 = { ...DEFAULTS, ...(opts.params || {}) };
  const D = { ...DIFFICULTY[P0.difficulty], ...(P0.diffOverride || {}) };
  const P = { ...P0, passFin: P0.passFin * D.finMult, campusExposure: P0.campusExposure * D.exposureMult, exposureMult: D.exposureMult };
  const rng = makeRng(opts.seed ?? 1);
  const cards = opts.cards ? new Set(opts.cards) : drawCardsFor(rng, CARDS, D.minDisrupt);
  const st = initState(P, cards);
  st.debt = D.startDebt;
  const once = opts.noEvents ? {} : scheduleOnce(rng, cards, P);
  st.items = opts.noEvents ? [] : buildCalendar(rng, cards, P, D.oppRemove);

  for (let d = 1; d <= P.days; d++) {
    st.day = d;
    const S = sleepFactor(st.debt, P);
    st.trace.push({ day: d, debt: st.debt, S, progress: st.progress, stress: st.stress, social: st.social });

    if (st.hospitalDay === d) {
      if (d === P.midDay) st.scores.mid = 0;
      if (d === P.finDay) { st.scores.fin = 0; break; }
      dayOff(st, P);
      continue;
    }
    if (d === P.midDay) st.scores.mid = examScore(st.progress, S, P) * st.bonus.mid;
    if (d === P.finDay) { st.scores.fin = examScore(st.progress, S, P) * st.bonus.fin; break; }

    // events
    const ctx0 = ctxOf(st, P);
    const ids = opts.noEvents ? [] : drawSlotEvents(rng, ctx0, st.recent);
    const effs = [];
    for (const id of ids) {
      const ev = SLOT_EVENTS.find((e) => e.id === id);
      effs.push(ev.options[choose(strategy, id, ev.options, ctx0)]);
    }
    for (const id of once[d] || []) {
      if (id === 'homesick_roll') {
        const w = st.social < P.lowSocial && st.stress > 60 ? 1 : 0.4; // ASSUME weighting
        if (rng() > w) continue;
      }
      effs.push(ONCE_EVENTS[id][choose(strategy, id, ONCE_EVENTS[id], ctx0)]);
      ids.push(id);
    }
    if (!opts.noEvents && rng() < P.campusExposure) effs.push({ exposure: true });
    if (!opts.noEvents && st.cards.has('乳糖不耐') && rng() < 0.2) effs.push({ chores: 1, lactose: true }); // ASSUME 20%/day lose 1h
    if (!opts.noEvents && rng() < 0.02) st.gastro = Math.max(st.gastro, 1);                               // ASSUME 2%/day
    const E = mergeEffects(effs);
    if (effs.some((x) => x.lactose)) st.depts.gut.res += 10;

    st.social = clamp(st.social + E.social, 0, 10);
    st.stress = clamp(st.stress + E.stress * (st.homesick && E.stress > 0 ? 1.5 : 1), 0, 100);
    if (E.homesick !== undefined) st.homesick = E.homesick;
    if (E.vaccine) st.vaccinated = true;
    if (E.liverRes) st.depts.liver.res += E.liverRes;
    if (E.exposure && !st.ill && rng() < infectionP(st, P)) { st.ill = { stage: 'throat', days: 1 }; st.log.push({ day: d, type: 'infected' }); }

    const ctx = ctxOf(st, P, { events: ids, effects: E });
    const pastExam = st.items.find((i) => i.day === d && i.type === 'pastExam');
    if (pastExam && choose(strategy, 'past_exam', { take: 1, skip: 1 }, ctx) === 'take') E.pastExam = true;
    const plan = strategy.plan(ctx);
    for (const id of plan.rsvp || []) {
      const it = st.items.find((i) => i.id === id);
      if (it && it.day === d + 1 && it.announced && OPPORTUNITY.has(it.type)) st.rsvp.add(id);
    }
    const todayTypes = st.items.filter((i) => i.day === d).map((i) => i.type);
    if (todayTypes.includes('nightShift')) E.nightShift = true;
    if (todayTypes.includes('party')) E.party = true;
    simulateDay(st, P, rng, plan, E, strategy, ctx);
    if (st.bankrupt) break;
  }
  if (st.scores.mid === null) st.scores.mid = 0;
  if (st.scores.fin === null) st.scores.fin = 0;
  return summarize(st, P);
}

function dayOff(st, P) {
  // Hospital day: no study/social, fixed 23:00-07:00 sleep (ASSUME).
  st.log.push({ day: st.day, type: 'hospital_day' });
  st.caf = decay(st.caf, 16, P);
  st.cupsHist.push(0);
  night(st, P, { bed: 23, nextWake: 7, socialToday: false, exercised: false, borrow: false, E: mergeEffects([]) });
  st.hospitalDay = null;
}

function simulateDay(st, P, rng, plan, E, strategy, ctx) {
  const wake = st.wake;
  if (plan.doctor && st.ill) st.ill.doctor = true;
  const mand = mandatoryFor(st.day, wake, P, st.cards, st.items, st.rsvp);
  let bed = clamp(plan.bed, P.bedMin, plan.allowAllNighter ? 31 : P.bedMax);
  // fixed late-evening commitments (shift, rehearsal, late study group) push bedtime back
  const lateMand = [...mand.keys()].filter((h) => h >= 19);
  if (lateMand.length) bed = Math.max(bed, Math.max(...lateMand) + 1);
  // timeline: mandatory overrides the plan
  const segs = [];
  const baseBed = bed;
  for (let h = wake; h < baseBed; h++) {
    const dur = Math.min(1, baseBed - h);
    const act = mand.get(h) || (plan.slots && plan.slots[h]) || 'leisure';
    segs.push({ h, dur, act });
  }
  if (E.nightShift) { // work 22:00-03:00 replaces the late evening (DOC "打工大夜班")
    for (const s of segs) if (s.h >= 22) s.act = 'work';
    for (let h = Math.ceil(baseBed); h < 27; h++) segs.push({ h, dur: 1, act: 'work' });
    bed = 27;
  } else {
    for (const [hrs, act] of E.delayActs) {
      let left = hrs;
      while (left > 0) { const dur = Math.min(1, left); segs.push({ h: bed, dur, act }); bed += dur; left -= dur; }
    }
  }
  // phone scrolling (random 0.5-1h) is stored on the slot-event option as bedDelayRand
  if (ctx.events.includes('phone_scroll') && !E.nightShift) {
    const extra = 0.5 + rng() * 0.5;
    segs.push({ h: bed, dur: extra, act: 'leisure' }); bed += extra;
  }
  bed = Math.min(bed, plan.allowAllNighter ? 31 : P.bedMax + 2); // events can push past 03:00 at most 2h (ASSUME)
  if (E.pastExam) { // 學長姐考古題: costs one social hour (free if a social hour is already planned)
    if (!segs.some((s) => ['social', 'studygroup', 'walk'].includes(s.act))) {
      const s = [...segs].reverse().find((x) => x.act === 'study');
      if (s) s.act = 'social';
    }
    st.bonus.fin *= P.pastExamBonus;
  }

  // coffee and energy drinks
  const cups = new Map();
  for (const c of plan.coffee || []) cups.set(c, (cups.get(c) || 0) + P.cup);
  let energy = false;
  if (E.energyDrinkChance && rng() < E.energyDrinkChance && choose(strategy, 'energy_drink', { drink: 1, skip: 1 }, ctx) === 'drink') {
    const t = Math.floor(plan.bed);
    cups.set(t, (cups.get(t) || 0) + P.energyDrink); energy = true;
  }
  const cupsToday = (plan.coffee || []).length + (energy ? 1 : 0);
  const withdrawal = st.tolerant && cupsToday === 0 && st.zeroCupDays === 0;

  // brain allocation
  const extra = plan.extraBrain || 0;
  const nonBrain = DEPTS.filter((d) => d !== 'brain').sort((a, b) => st.depts[a].res - st.depts[b].res);
  const donors = nonBrain.slice(0, extra);
  for (const d of donors) st.depts[d].res += P.moveRes;
  const loan = plan.borrow ? P.borrowTokens : 0;

  // dispatch crises at random awake hours (DOC 3-5/day): +10 on the least-resentful non-brain dept
  const nCrises = rng.int(P.crises[0], P.crises[1]);
  const crisisAt = new Map();
  for (let i = 0; i < nCrises; i++) { const s = segs[Math.floor(rng() * segs.length)]; crisisAt.set(s, (crisisAt.get(s) || 0) + 1); }

  const S = sleepFactor(st.debt, P);
  let slumpLeft = E.slump ? P.slumpHours : 0;
  let socialToday = E.socialHours > 0 || E.social > 0;
  let exercised = false, studyH = 0, studyOut = 0;
  let alcoholLeft = E.alcohol ? 4 : 0;
  if (st.cards.has('社團幹部')) socialToday = socialToday || [...mand.values()].includes('social');

  for (const seg of segs) {
    for (const [h, mg] of cups) if (h >= seg.h && h < seg.h + seg.dur) st.caf += mg;
    const cafCoef = st.caf >= P.boostMin ? (st.tolerant ? P.boostTolerant : P.boost) : 1;
    const studying = seg.act === 'study' || seg.act === 'studygroup' || seg.act === 'lategroup';

    for (let i = 0; i < (crisisAt.get(seg) || 0); i++) {
      const d = DEPTS.filter((x) => x !== 'brain').sort((a, b) => st.depts[a].res - st.depts[b].res)[0];
      st.depts[d].res += P.moveRes;
    }
    // departments
    for (const name of DEPTS) {
      const dp = st.depts[name];
      let tokens = P.deptTokens;
      if (studying && name === 'brain') tokens += extra + loan;
      if (studying && donors.includes(name)) tokens -= 1;
      let eff = 1 - Math.min(100, dp.res) / 200;
      if (name === 'immune' && st.chronic) eff *= P.chronicImmuneEff;
      const cap = dp.striking ? 0 : tokens * eff;
      let demand = P.baseDemand + P.debtDemand * st.debt;
      if (name === 'immune' && st.ill) demand += st.ill.stage === 'fever' ? P.feverImmune : st.ill.stage === 'cold' ? P.coldImmune : 0;
      if (name === 'liver' && alcoholLeft > 0) demand += P.alcoholLiver;
      if (name === 'gut' && st.gastro > 0) demand += P.gastroGut;
      dp.backlog = Math.max(0, dp.backlog + (demand - cap) * seg.dur);
      dp.res = Math.min(100, dp.res + P.backlogRes * dp.backlog * seg.dur);
      if (!dp.striking && dp.res > P.strikeAt) { dp.striking = true; dp.strikeH = 0; st.log.push({ day: st.day, type: 'strike', dept: name }); }
      if (dp.striking && P.strikeDropsBacklog) dp.backlog = 0;
      if (dp.striking) dp.strikeH += seg.dur;
    }
    if (E.alcohol && seg.act === 'social') alcoholLeft = 4;
    else if (alcoholLeft > 0) alcoholLeft -= seg.dur;

    if (opts_debug) opts_debug(st, seg);
    const striking = DEPTS.filter((d) => st.depts[d].striking);
    const crisisTag = st.ill && st.ill.stage === 'fever';
    if (striking.some((d) => st.depts[d].strikeH >= P.erStrikeHours) && (striking.length >= 2 || crisisTag)) {
      hospitalize(st, P, { striking, crisisTag, debt: st.debt, stress: st.stress });
      st.cupsHist.push(cupsToday);
      if (st.bankrupt) return;
      // ER night: 9h effective, no caffeine penalty (ASSUME)
      st.caf = decay(st.caf, 9, P);
      st.debt = nextDebt(st.debt, 9, P);
      st.wake = 7;
      return;
    }

    if (studying) {
      let m = (1 + P.brainTokenBonus * (extra + loan)) * S * cafCoef;
      if (seg.act === 'studygroup') m *= P.studyGroupMult;
      if (seg.act === 'lategroup') m *= P.lateGroupMult;
      if (slumpLeft > 0 && seg.h >= 13) { m *= P.slump; slumpLeft -= seg.dur; }
      if (withdrawal) m *= P.withdrawal;
      if (st.ill?.stage === 'cold') m *= P.coldStudy;
      if (st.ill?.stage === 'fever') m *= P.feverStudy;
      if (st.gastro > 0) m *= P.gastroStudy;
      if (st.depts.brain.striking) m = 0;
      st.progress += m * seg.dur; studyH += seg.dur; studyOut += m * seg.dur;
    }
    if (seg.act === 'office') {
      const understood = st.progress >= P.officeMinPacePerDay * (st.day - 1);
      if (understood) {
        if (st.day < P.midDay) st.bonus.mid *= P.officeBonus; else st.bonus.fin *= P.officeBonus;
      }
      st.log.push({ day: st.day, type: 'office', understood });
    }
    if (seg.act === 'exercise' || seg.act === 'walk') {
      exercised = true;
      if (rng() < P.sprainP) { st.injured = true; Object.assign(st.depts.muscle, { res: 100, striking: true, strikeH: 0 }); } // DOC 10%
    }
    if (['social', 'studygroup', 'walk'].includes(seg.act)) { st.social = clamp(st.social + P.socialPerHour * seg.dur, 0, 10); socialToday = true; }
    const ds = (P.stressPerHour[seg.act] ?? 0) * seg.dur;
    st.stress = clamp(st.stress + ds * (st.homesick && ds > 0 ? 1.5 : 1), 0, 100);
    st.caf = decay(st.caf, seg.dur, P);
  }
  st.cupsHist.push(cupsToday);
  st.trace[st.trace.length - 1].studyH = studyH;
  st.trace[st.trace.length - 1].studyOut = studyOut;
  st.trace[st.trace.length - 1].cups = cupsToday;
  st.trace[st.trace.length - 1].bed = bed;
  // a make-up class forces an early alarm whether or not the player saw it coming
  const mk = st.items.find((i) => i.day === st.day + 1 && i.type === 'makeup');
  const examNext = st.day + 1 === P.midDay || st.day + 1 === P.finDay;
  const nextWake = Math.min(plan.nextWake ?? P.wake, mk ? mk.wake : 99, examNext ? P.examWake : 99);
  night(st, P, { bed, nextWake, socialToday, exercised, borrow: !!plan.borrow, E });
}

function night(st, P, { bed, nextWake, socialToday, exercised, borrow, E }) {
  const sleepH = Math.max(0, 24 + nextWake - bed);
  let mult = cafSleepCoef(st.caf, P) * (E.alcohol ? P.alcoholSleep : 1) * E.sleepMult *
    (st.chronic ? P.chronicSleep : 1) * (st.nightShiftNext ? P.nightShiftSleep : 1) *
    (E.party && bed < P.partyUntil ? P.partySleep : 1);
  if (exercised) mult = Math.min(1, mult * P.exerciseSleepBonus);
  st.nightShiftNext = !!E.nightShift;
  const eff = sleepH * mult * (borrow ? P.borrowSleep : 1);
  st.debt = nextDebt(st.debt + (E.debt || 0), eff, P);
  for (const d of DEPTS) {
    const dp = st.depts[d];
    dp.backlog = Math.max(0, dp.backlog - P.deptTokens * mult * sleepH);
    dp.res = Math.max(0, dp.res - P.sleepRecover * eff);
    if (dp.striking && dp.res < P.strikeEnd) { dp.striking = false; dp.strikeH = 0; }
  }
  st.injured = false;
  st.stress = clamp(st.stress + P.stressSleep * eff, 0, 100);
  st.caf = decay(st.caf, sleepH, P);
  // illness ladder (DOC stages; thresholds ASSUME)
  if (st.ill) {
    const ill = st.ill;
    if (ill.stage === 'throat') {
      if (bed <= P.restBed && eff >= P.restEff) st.ill = null; else Object.assign(ill, { stage: 'cold', days: 2 });
    } else if (ill.stage === 'cold') {
      if (eff < P.feverIfEffBelow) { Object.assign(ill, { stage: 'fever', days: ill.doctor ? 1 : 2 }); st.log.push({ day: st.day, type: 'fever' }); }
      else { ill.days -= eff >= 8.5 ? 2 : 1; if (ill.days <= 0) st.ill = null; }
    } else if (ill.stage === 'fever') {
      ill.days -= ill.doctor ? 2 : 1; if (ill.days <= 0) st.ill = null;
    }
  }
  if (st.gastro > 0) st.gastro -= 1;
  if (!socialToday) st.social = clamp(st.social - P.socialDecay, 0, 10);
  if (st.social < P.lowSocial) st.stress = clamp(st.stress + P.lowSocialStress * (st.homesick ? 1.5 : 1), 0, 100);
  st.highDays = st.stress > P.chronicAt ? st.highDays + 1 : 0;
  if (st.highDays >= P.chronicDays) st.chronic = true;
  if (st.chronic && st.stress < P.chronicOff) st.chronic = false;
  // tolerance (DOC: 3 consecutive days with >=2 cups)
  const h = st.cupsHist;
  if (h.length >= P.tolDays && h.slice(-P.tolDays).every((c) => c >= P.tolCups)) st.tolerant = true;
  st.zeroCupDays = h[h.length - 1] === 0 ? st.zeroCupDays + 1 : 0;
  if (st.zeroCupDays >= P.tolResetDays) st.tolerant = false;
  st.wake = nextWake;
}

function summarize(st, P) {
  const mid = st.scores.mid, fin = st.scores.fin;
  return {
    cards: [...st.cards], mid, fin, passMid: mid >= P.passMid, passFin: fin >= P.passFin && !st.bankrupt,
    hospital: st.hospital > 0, bankrupt: st.bankrupt, finalDebt: st.debt, progress: st.progress,
    fevers: st.log.filter((l) => l.type === 'fever').length, infected: st.log.filter((l) => l.type === 'infected').length,
    strikes: st.log.filter((l) => l.type === 'strike').length, offices: st.log.filter((l) => l.type === 'office').length,
    officesUnderstood: st.log.filter((l) => l.type === 'office' && l.understood).length,
    trace: st.trace, log: st.log, maxStress: Math.max(...st.trace.map((t) => t.stress)), chronic: st.chronic,
  };
}

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
