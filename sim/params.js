// All tunable numbers live here.
// Tag on every line: DOC = taken from the design doc; ASSUME = not defined in the doc, filled in for the sim.
// Hours use an extended clock: 25 = 01:00 next day, 27 = 03:00.

export const DEFAULTS = {
  // ---- calendar
  days: 10, midDay: 5, finDay: 10,            // DOC
  weekend: [6, 7],                            // ASSUME day 1 = Monday, so days 6-7 are Sat/Sun
  examHours: [9, 10],                         // ASSUME exam 09:00-11:00, scored with that morning's S

  // ---- daily time
  wake: 7, bed: 23,                           // DOC default 07:00 wake, 23:00 bed
  bedMin: 22, bedMax: 27,                     // DOC bedtime choice 22:00-03:00
  meals: [7, 12, 18],                         // ASSUME 1h each (includes hygiene); 3h/day
  classes: [10, 11, 14, 15],                  // ASSUME 4h class per weekday
  classesEarly: [8, 9, 10, 11, 14],           // ASSUME card "滿堂早八": 5h/weekday from 08:00 (+1h)
  commute: [17],                              // ASSUME card "通勤生": +1h/weekday, no roommate events
  jobDays: [7], job: [14, 15, 16, 17],        // ASSUME card "週末打工": Sun 4h shift + Sat night shift (DOC 大夜班)
  clubDays: [2, 7], clubHours: [19, 20, 21],  // ASSUME card "社團幹部": 3h meetings, social +1/h

  // ---- sleep
  sleepNeed: 8,                               // DOC
  repayRatio: 0.5,                            // DOC only 50% of sleep beyond 8h repays debt
  sCoef: 0.07, sFloor: 0.3,                   // DOC S = max(0.3, 1 - 0.07*debt)
  examDiscount: true,                         // DOC exam = progress * S(exam morning)

  // ---- caffeine
  cup: 100, halfLife: 5, boostMin: 25,        // DOC
  boost: 1.2, boostTolerant: 1.1,             // DOC
  cafSleepK: 0.4,                             // DOC sleep coef = 1 - 0.4*min(1, residual/100)
  cafDeadZone: 15,                            // PROPOSED FIX: doc has none (=0); residual < 15 at bedtime -> no sleep penalty
  tolDays: 3, tolCups: 2, withdrawal: 0.9,    // DOC
  energyDrink: 150,                           // DOC
  tolResetDays: 2,                            // ASSUME tolerance clears after 2 coffee-free days

  // ---- tokens and departments
  brainTokenBonus: 0.1,                       // DOC +10% study per extra brain token
  borrowTokens: 2, borrowSleep: 0.7,          // DOC night-shift loan: +2 tokens, sleep repair -30%
  deptTokens: 2,                              // ASSUME 12 tokens = 6 depts x 2 (brain floor 2 is DOC)
  baseDemand: 1.2,                            // ASSUME per dept per awake hour
  debtDemand: 0.08,                           // ASSUME unfinished night repair: +0.08 demand per hour of debt
  backlogRes: 5, moveRes: 10, sleepRecover: 8,// DOC
  complainAt: 60, strikeAt: 85,               // DOC
  strikeEnd: 60,                              // ASSUME strike lifts when resentment < 60
  strikeDropsBacklog: true,                   // DESIGN FIX: doc-literal (false) makes a strike an absorbing state
  sprainP: 0.03,                              // DOC 10% is for un-warmed exercise; ASSUME players warm up -> 3%
  crises: [3, 5],                             // DOC 3-5 dispatch crises per day; each = +10 on one donor
  erStrikeHours: 6,                           // DOC
  hospitalRes: 40, hospitalStress: 15,        // DOC
  hospitalDebtMult: 0.5,                      // PROPOSED FIX: doc is silent; with 1 a sleep-debt ER almost always repeats (bankrupt)
  coldImmune: 0.6, feverImmune: 1.5,          // ASSUME extra immune demand while ill
  chronicImmuneEff: 0.75,                     // ASSUME "長期高壓" cuts immune budget by 25%
  alcoholLiver: 1.5, gastroGut: 1.5,          // ASSUME

  // ---- stress and social
  stress0: 30, social0: 5,                    // ASSUME starting values
  stressPerHour: {                            // ASSUME
    study: 2, class: 1, exam: 3, work: 1.5,
    exercise: -8, social: -5, leisure: -4, meal: 0, commute: 0.5, hospital: 0,
    office: 1, studygroup: 0, lategroup: 2, walk: -8,
  },
  stressSleep: -1.5,                          // ASSUME per effective sleep hour
  chronicAt: 70, chronicDays: 2,              // DOC
  chronicOff: 60,                             // ASSUME tag clears when end-of-day stress < 60
  lowSocial: 3, lowSocialStress: 10,          // DOC
  socialPerHour: 1,                           // ASSUME a 2h social card = +2
  socialDecay: 1,                             // DOC -1 on days without social

  // ---- multipliers
  chronicSleep: 0.9, alcoholSleep: 0.8, snackSleep: 0.9, nightShiftSleep: 0.85, // DOC
  slump: 0.85, slumpHours: 2,                 // DOC
  feverStudy: 0.5,                            // DOC
  coldStudy: 0.8, gastroStudy: 0.8,           // ASSUME
  exerciseSleepBonus: 1.0,                    // ASSUME off by default (doc only says "better sleep")

  // ---- infection
  infBase: 0.3, chronicInf: 1.5, debtInf: 1.4, debtInfAt: 3, // DOC
  vaccineInf: 0.6,                            // ASSUME vaccine cuts infection chance by 40%
  campusExposure: 0.10,                       // ASSUME daily non-roommate exposure
  restBed: 23, restEff: 7.5,                  // ASSUME "early sleep" that stops a sore throat
  feverIfEffBelow: 7,                         // ASSUME cold escalates if a night has < 7h effective sleep

  // ---- exam pass thresholds (derived in report; points of progress*S)
  passMid: 18, passFin: 37,                   // ASSUME tuned with the risk-3 calendar (was 40 before it); difficulty scales passFin

  // ---- risk-3 mechanisms (calendar.js). Everything here is ASSUME unless noted.
  difficulty: 0,                              // index into DIFFICULTY below
  // time-shifting semester cards
  labHours: [14, 15, 16, 17, 19, 20],         // 實驗課: on 2 random weekdays the day's classes become 14:00-21:00 (morning free, net +2h)
  shiftHours: [19, 20, 21],                   // 排班表: two evening shifts 19:00-22:00
  nightShiftHours: [22, 23, 24, 25, 26],      // 排班表: one night shift 22:00-03:00 on Sat or Sun night (DOC 大夜班, next night x0.85)
  showcaseHours: [21, 22, 23],                // 社團成果發表: rehearsal 21:00-24:00 on 3 consecutive nights after midterm (counts as social)
  // time-shifting events
  makeupHours: [7], makeupWake: 6,            // 補課通知: 07:00 make-up roll call, must be up at 06:00
  makeupCount: 1,                             // 補課通知 per game
  makeupAnnounceP: 0.8,                       // 20% of make-up notices arrive the same morning (no preview)
  typhoonP: 0.3,                              // 颱風假: 30% of games, one weekday without class
  partyCount: 2,                              // 室友派對 per game: one on days 1-3, one on days 6-9
  partyUntil: 23, partySleep: 0.8,            // 室友期末派對: going to bed before 23:00 that night -> sleep efficiency x0.8
  // opportunity events (need an RSVP the evening before, i.e. reading ctx.tomorrow)
  officeHourOptions: [13, 16], officeBonus: 1.08,  // office hour: next exam x1.08
  officeMinPacePerDay: 3.5,                        // office hour only helps if progress >= 3.5 x days elapsed (~55% of 平衡派 pace); otherwise "聽不懂"
  studyGroupHours: [19, 20], studyGroupMult: 1.2,  // 讀書會: study x1.2 and counts as social
  lateGroupHours: [22, 23, 24], lateGroupMult: 2.5,// 深夜讀書會 22:00-01:00: study x2.5 (user decision: high risk, high reward), bed >= 01:00
  walkHours: [16],                                 // 校園健走: exercise + social in one hour
  pastExamBonus: 1.05,                             // 學長姐考古題 (sudden): final x1.05 for one social hour
  wakeCap: 11,                                     // latest sleep-in on a free morning
  examWake: 7,                                     // exam mornings: must be up by 07:00 (travel + prep)
};

// Difficulty ladder (spec from coordinator; values ASSUME).
export const DIFFICULTY = [
  { name: '0 新生', finMult: 1.0, minDisrupt: 0, oppRemove: 0, exposureMult: 1.0, startDebt: 0 },
  { name: '1 大一下', finMult: 1.1, minDisrupt: 0, oppRemove: 0, exposureMult: 1.0, startDebt: 0 },
  { name: '2 大二', finMult: 1.1, minDisrupt: 1, oppRemove: 0, exposureMult: 1.0, startDebt: 0 },
  { name: '3 大三', finMult: 1.2, minDisrupt: 1, oppRemove: 1, exposureMult: 1.0, startDebt: 0 },
  { name: '4 大四', finMult: 1.2, minDisrupt: 2, oppRemove: 1, exposureMult: 1.5, startDebt: 0 },
  { name: '5 延畢生', finMult: 1.2, minDisrupt: 2, oppRemove: 1, exposureMult: 1.5, startDebt: 1.5 },
];

// Semester cards (DOC names; effects ASSUME except where the doc states them).
// 排班表 replaces the earlier 週末打工 (its night shift is now one of three randomly placed shifts).
export const DISRUPTIVE_CARDS = ['排班表', '實驗課', '社團成果發表'];
export const CARDS = ['滿堂早八', '夜貓室友', '乳糖不耐', '通勤生', '分組報告地獄', '社團幹部', ...DISRUPTIVE_CARDS];
