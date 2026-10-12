// Per-game calendar for the risk-3 mechanisms: time-shifting cards/events and opportunity events.
// Items are data; model.js turns them into mandatory hours, sleep effects and exam bonuses.
import { DISRUPTIVE_CARDS } from './params.js';

export const OPPORTUNITY = new Set(['office', 'studyGroup', 'lateGroup', 'walk']);
export const ACT_OF = { office: 'office', studyGroup: 'studygroup', lateGroup: 'lategroup', walk: 'walk' };

const shuffle = (rng, arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

// Exam days (5, 10) carry no items. Day 1 has no opportunities because nobody could RSVP the evening before.
export function buildCalendar(rng, cards, P, oppRemove = 0) {
  const items = [];
  let n = 0;
  const add = (day, type, extra = {}) => items.push({ id: `${type}#${n++}`, day, type, announced: true, ...extra });
  const pick = (pool, k = 1) => shuffle(rng, pool).slice(0, k);
  const weekdays = [1, 2, 3, 4, 8, 9];
  const nonExam = [1, 2, 3, 4, 6, 7, 8, 9];

  if (cards.has('實驗課')) pick(weekdays, 2).forEach((d) => add(d, 'lab', { hours: P.labHours }));
  if (cards.has('排班表')) {
    const ns = rng.int(6, 7);
    add(ns, 'nightShift', { hours: P.nightShiftHours });
    pick(nonExam.filter((d) => d !== ns), 2).forEach((d) => add(d, 'shift', { hours: P.shiftHours }));
  }
  if (cards.has('社團成果發表')) { const s = rng.int(6, 7); [s, s + 1, s + 2].forEach((d) => add(d, 'showcase', { hours: P.showcaseHours })); }

  for (const d of pick(weekdays, P.makeupCount)) add(d, 'makeup', { hours: P.makeupHours, wake: P.makeupWake, announced: rng() < P.makeupAnnounceP });
  if (rng() < P.typhoonP) add(pick(weekdays)[0], 'typhoon');
  if (!cards.has('通勤生')) [rng.int(6, 9), rng.int(1, 3)].slice(0, P.partyCount).forEach((d) => add(d, 'party'));

  const opp = [
    ['office', pick([2, 3, 4])[0], { hours: [rng.pick(P.officeHourOptions)] }],
    ['office', pick([8, 9])[0], { hours: [rng.pick(P.officeHourOptions)] }],
    ...pick([2, 3, 4, 6, 7, 8, 9], 2).map((d) => ['studyGroup', d, { hours: P.studyGroupHours }]),
    ['lateGroup', pick([2, 3, 4])[0], { hours: P.lateGroupHours }],
    ['lateGroup', pick([6, 7, 8, 9])[0], { hours: P.lateGroupHours }],
    ...pick([2, 3, 4, 6, 7, 8, 9], 2).map((d) => ['walk', d, { hours: P.walkHours }]),
  ];
  const kept = shuffle(rng, opp).slice(oppRemove);
  for (const [type, day, extra] of kept) add(day, type, { rsvp: true, ...extra });
  add(rng.int(6, 9), 'pastExam', { announced: false });

  // test hooks: dropTypes removes generated items, forceItems then adds exact ones
  const out = P.dropTypes ? items.filter((i) => !P.dropTypes.includes(i.type)) : items;
  for (const f of P.forceItems || []) {
    out.push({ id: `${f.type}#f${n++}`, announced: true, rsvp: OPPORTUNITY.has(f.type), hours: P[`${f.type}Hours`], ...f });
  }
  return out;
}

export function drawCardsFor(rng, CARDS, minDisrupt) {
  const a = shuffle(rng, CARDS).slice(0, 2);
  let k = a.filter((c) => DISRUPTIVE_CARDS.includes(c)).length;
  const pool = shuffle(rng, DISRUPTIVE_CARDS.filter((c) => !a.includes(c)));
  for (let i = 0; i < a.length && k < minDisrupt; i++) {
    if (!DISRUPTIVE_CARDS.includes(a[i])) { a[i] = pool.pop(); k++; }
  }
  return new Set(a);
}
