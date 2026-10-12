// Event library (subset of the doc's 大學生事件庫 that touches study time, sleep, stress, social or illness).
// Base probabilities are DOC unless marked ASSUME. Effects are returned as plain data; model.js applies them.

export const SLOTS = ['morning', 'lunch', 'afternoon', 'evening', 'latenight'];

// Weighted per-slot events. w(ctx) returns base x condition multipliers (DOC formula w = base * prod(mult)).
export const SLOT_EVENTS = [
  {
    id: 'bubble_tea', slot: 'afternoon',
    w: () => 0.40,                                             // DOC 40%
    options: {
      join: { social: 1, slump: true },                        // DOC social +1, 2h slump
      skip: {},                                                // ASSUME no cost for skipping
    },
  },
  {
    id: 'late_snack', slot: 'latenight',
    w: (c) => 0.25 * (c.cards.has('夜貓室友') ? 2 : 1) * (c.cards.has('通勤生') ? 0.3 : 1), // DOC 25%, night-owl x2
    options: {
      go: { social: 2, sleepMult: 0.9, bedDelay: 1, bedDelayAct: 'social' },  // DOC
      no: { social: -1, stress: 5 },                                          // DOC
      takeout: { social: 1, sleepMult: 0.9 },                                 // DOC
    },
  },
  {
    id: 'phone_scroll', slot: 'latenight',
    w: (c) => 0.35 * (c.stress > 50 ? 2 : 1) * (c.cards.has('夜貓室友') ? 2 : 1), // DOC 35%, stress>50 weighted
    options: { forced: { bedDelayRand: [0.5, 1], bedDelayAct: 'leisure' } },   // DOC delay 0.5-1h
  },
  {
    id: 'oversleep', slot: 'morning',
    w: (c) => (c.debt >= 2 || c.cards.has('滿堂早八') ? 0.30 : 0) * (c.cards.has('滿堂早八') ? 2 : 1), // DOC 30%
    options: { skipBreakfast: { slump: true, liverRes: 10 } },              // ASSUME effect of skipping
  },
  {
    id: 'deadline', slot: 'afternoon',
    w: (c) => 0.20 * ([4, 5, 8, 9].includes(c.day) ? 2 : 1),             // DOC 20%, exam weeks x2
    options: {
      squeeze: { stress: 20, chores: 2 },                                // ASSUME report eats 2h of free time
      overtime: { stress: 20, bedDelay: 2, bedDelayAct: 'work', energyDrinkChance: 0.5 }, // DOC "熬夜選項"; energy drink 50%
    },
  },
  {
    id: 'roommate_cold', slot: 'evening',
    w: (c) => (c.cards.has('通勤生') ? 0 : 0.15 * (c.P.exposureMult ?? 1)), // DOC 15%, dorm only; difficulty x1.5
    options: { forced: { exposure: true } },
  },
];

// Fixed-count events scheduled at game start (DOC counts, ASSUME day windows where the doc is silent).
export function scheduleOnce(rng, cards, P) {
  const s = {};
  const add = (day, ev) => { (s[day] ||= []).push(ev); };
  add(rng.int(1, 3), 'vaccine');                                         // DOC once, days 1-3
  const bbq = rng.int(1, 2);                                             // DOC 1-2 per game, days 2-4
  const bbqDays = shuffle(rng, [2, 3, 4]).slice(0, bbq);
  bbqDays.forEach((d) => add(d, 'bbq'));
  const groups = cards.has('分組報告地獄') ? 3 : rng.int(1, 2);           // DOC 1-2; card ASSUME 3
  shuffle(rng, [1, 2, 3, 4, 6, 7, 8, 9]).slice(0, groups).forEach((d) => add(d, 'group_slacker'));
  add(rng.int(6, 7), 'night_out');                                       // DOC once, after midterm
  if (cards.has('週末打工')) add(6, 'night_shift');                       // DOC once per week on weekend
  if (rng() < 0.5) add(rng.int(2, 9), 'homesick_roll');                  // DOC 0-1 per game (weighted at fire time)
  return s;
}

export const ONCE_EVENTS = {
  vaccine: { take: { vaccine: true }, skip: {} },
  bbq: {
    drink: { socialHours: 3, alcohol: true, bedDelay: 1, bedDelayAct: 'social' }, // DOC social +3, alcohol tag
    sober: { socialHours: 3, social: -1 },                                        // DOC refuse 勸酒 -> social -1
    decline: { social: -1, stress: 5 },                                           // ASSUME same cost as declining snack
  },
  group_slacker: {
    cover: { chores: 2 },                                                         // DOC study need +2h
    conflict: { social: -2, stress: 10 },                                         // ASSUME size of "社交衝突"
  },
  night_out: {
    go: { social: 3, debt: 4 },                                                   // DOC
    no: { social: -1 },                                                           // ASSUME
  },
  night_shift: { forced: { nightShift: true } },                                  // DOC next-night sleep x0.85
  homesick_roll: {
    talk: { socialHours: 2, homesick: false },                                    // ASSUME talking it out resolves it
    ignore: { homesick: true },                                                   // DOC stress gain x1.5
  },
};

function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Draw at most one weighted event per slot; a fired event gets weight x0.2 for 2 days (DOC).
export function drawSlotEvents(rng, c, recent) {
  const fired = [];
  for (const slot of SLOTS) {
    const cands = SLOT_EVENTS.filter((e) => e.slot === slot)
      .map((e) => ({ e, w: e.w(c) * (recent[e.id] !== undefined && c.day - recent[e.id] <= 2 ? 0.2 : 1) }))
      .filter((x) => x.w > 0);
    let r = rng();
    for (const x of cands) {
      if (r < x.w) { fired.push(x.e.id); recent[x.e.id] = c.day; break; }
      r -= x.w;
    }
  }
  return fired;
}
