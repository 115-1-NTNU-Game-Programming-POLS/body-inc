// Strategy = { plan(ctx) -> dayPlan, choose(eventId, ctx) -> option key }.
// dayPlan: { bed, nextWake, coffee: [hours], slots: {hour: activity}, extraBrain, borrow, doctor, allowAllNighter }

export function freeHours(ctx, wake, bed) {
  const m = ctx.mandatory(wake);
  const out = [];
  for (let h = wake; h < Math.ceil(bed); h++) if (!m.has(h)) out.push(h);
  return out;
}

// Put counted activities into preferred free hours; everything left becomes `fill`.
export function layout(free, spec) {
  const slots = {};
  const avail = new Set(free);
  const take = (act, n, prefer) => {
    const order = [...prefer, ...[...avail].sort((a, b) => b - a)];
    let k = 0;
    for (const h of order) {
      if (k >= n) break;
      if (avail.has(h)) { slots[h] = act; avail.delete(h); k++; }
    }
  };
  take('work', spec.chores || 0, [19, 20, 21, 22, 16, 17, 13]);
  take('social', spec.social || 0, [20, 21, 19, 22, 13]);
  take('exercise', spec.exercise || 0, [17, 16, 19, 13]);
  take('leisure', spec.leisure || 0, [22, 21, 23, 24, 19]);
  if (spec.studyMax !== undefined) take('study', spec.studyMax, [8, 9, 13, 16, 10, 11]);
  for (const h of avail) slots[h] = spec.fill || 'study';
  return slots;
}

// Adaptive "knows the rules" player. Options let other archetypes reuse it.
function adaptive(o0 = {}) {
  // Every archetype that 'knows the rules' also reads tomorrow's notices; 熬夜派/咖啡因依賴派 (no illness reaction) do not.
  const o = { react: o0.reactsToIllness !== false, ...o0 };
  return {
    plan(ctx0) {
      // a "blind" player cannot read tomorrow's notices (used to test that previews matter)
      // (tonight's party is itself a notice from yesterday, so a blind player only finds out at bedtime)
      const ctx = o.blind ? { ...ctx0, tomorrow: [], today: ctx0.today.filter((i) => i.type !== 'party') } : ctx0;
      const sick = o.reactsToIllness !== false && ctx.ill !== null;
      let bed = typeof o.bed === 'function' ? o.bed(ctx) : (o.bed ?? 23);
      // knowledgeable players pay sleep debt back early (only 50% of extra sleep counts)
      if (o.repayDebt !== false && o.reactsToIllness !== false && ctx.debt >= 1) bed = Math.min(bed, 22);
      if (sick) bed = Math.min(bed, 22);
      else if (ctx.examTomorrow && o.examEveBed !== undefined) bed = o.examEveBed;
      const has = (list, t) => list.find((i) => i.type === t);
      if (o.react) {
        const mk = has(ctx.tomorrow, 'makeup');
        if (mk) bed = Math.min(bed, mk.wake + 24 - 8);              // early night before a 07:00 make-up class
        if (has(ctx.today, 'party')) bed = Math.max(bed, ctx.P.partyUntil); // don't try to sleep through the party
      }
      const repay = o.weekendSleepIn !== false && ctx.nextWeekend && ctx.debt > 0.5;
      let nextWake = repay ? 9 : 7;
      if (o.react && has(ctx.tomorrow, 'typhoon') && ctx.debt > 0.5) nextWake = 9;
      // sleep debt only repays at 50%, so pay it off early by sleeping in when tomorrow's morning is free
      if (o.react && o.sleepIn !== false && ctx.debt >= 1) nextWake = Math.max(nextWake, 8);
      // a fixed late commitment tonight (shift, rehearsal, late study group): sleep in as far as tomorrow allows
      const late = [...ctx.mandatory(ctx.wake).keys()].filter((h) => h >= 19);
      const effBed = Math.max(bed, late.length ? Math.max(...late) + 1 : 0);
      if (o.weekendSleepIn !== false && effBed > Math.max(bed, 23)) nextWake = Math.max(nextWake, Math.ceil(effBed + 8 - 24));
      if (o.weekendSleepIn !== false) nextWake = Math.min(nextWake, Math.max(7, ctx.wakeCapTomorrow));
      const free = freeHours(ctx, ctx.wake, bed);
      const doctor = o.reactsToIllness !== false && ctx.ill === 'fever';
      const chores = ctx.effects.chores + (doctor ? 2 : 0);
      let social = ctx.effects.socialHours, exercise = 0, leisure = 0;
      if (!sick) {
        if (social === 0 && (ctx.social <= 4 || ctx.day % 2 === 0)) social = 2;
        if (!ctx.injured && (ctx.day % 2 === 1 || ctx.stress >= 60)) exercise = 1;
        if (ctx.stress >= 60) leisure = 1;
      }
      if (o.react) {
        const fixedActs = [...ctx.mandatory(ctx.wake).values()];
        if (fixedActs.includes('walk')) { exercise = 0; social = ctx.effects.socialHours; }
        if (fixedActs.includes('studygroup') || fixedActs.includes('social')) social = ctx.effects.socialHours;
      }
      // hard-gap trade-off: protect a minimum of study hours by dropping relief first
      const minStudy = o.minStudy ?? 6;
      const room = () => free.length - chores - social - exercise - leisure;
      if (room() < minStudy && leisure) leisure = 0;
      if (room() < minStudy && social > ctx.effects.socialHours && ctx.social >= 4) social = ctx.effects.socialHours;
      if (room() < minStudy && exercise && ctx.stress < 50) exercise = 0;
      let slots = layout(free, { chores, social, exercise, leisure, studyMax: o.studyMax, fill: o.studyMax !== undefined ? 'leisure' : 'study' });
      let coffee = typeof o.coffee === 'function' ? o.coffee(ctx) : (o.coffee || []).map((x) => (x === 'wake+1' ? ctx.wake + 1 : x));
      const rsvp = o.react ? ctx.tomorrow.filter((i) => i.rsvp && wantOpportunity(i, ctx, o)).map((i) => i.id) : [];
      return { bed, nextWake, coffee, slots, extraBrain: o.extraBrain || 0, borrow: !!o.borrow, doctor, allowAllNighter: bed > 27, rsvp };
    },
    choose(id, ctx) {
      if (o.choices && o.choices[id]) return o.choices[id](ctx);
      const lonely = ctx.social <= 3;
      switch (id) {
        case 'bubble_tea': return lonely ? 'join' : 'skip';
        case 'late_snack': return lonely ? 'takeout' : 'no';
        case 'deadline': return 'squeeze';
        case 'bbq': return lonely ? 'sober' : 'decline';
        case 'group_slacker': return 'cover';
        case 'night_out': return lonely ? 'go' : 'no';
        case 'homesick_roll': return 'talk';
        case 'energy_drink': return 'skip';
        case 'vaccine': return 'take';
        case 'past_exam': return 'take';
        default: return undefined;
      }
    },
  };
}

// Which announced opportunities an adaptive player signs up for.
function wantOpportunity(it, ctx, o) {
  if (it.type !== 'lateGroup') return true; // office hour, study group, campus walk are always worth it
  const eve = it.day + 1 === ctx.P.midDay || it.day + 1 === ctx.P.finDay;
  switch (o.late ?? 'smart') {
    case 'never': return false;
    case 'always': return true;
    case 'eveOnly': return eve;
    // smart: only well before the midterm, rested, at most once
    default: return !eve && it.day <= 3 && ctx.debt < 0.5;
  }
}

const nightOwlChoices = {
  deadline: () => 'overtime', late_snack: () => 'takeout', night_out: () => 'go', energy_drink: () => 'drink',
};

// Fixed routine copied every day: does not adapt to cards, illness, exams or events.
function fixedRoutine(o = {}) {
  const bed = o.bed ?? 22.5;
  const template = {};
  for (let h = 7; h < Math.ceil(bed); h++) template[h] = 'study';
  template[17] = 'exercise';
  for (const h of o.socialHours ?? [21]) template[h] = 'social';
  return {
    plan(ctx) {
      const slots = { ...template };
      // event chores overwrite the evening in clock order regardless of what was there
      let n = ctx.effects.chores, s = ctx.effects.socialHours;
      for (const h of [19, 20, 21, 22, 16]) {
        if (n > 0) { slots[h] = 'work'; n--; } else if (s > 0) { slots[h] = 'social'; s--; }
      }
      if (ctx.injured && slots[17] === 'exercise') slots[17] = 'leisure';
      return { bed, nextWake: 7, coffee: o.coffee === false ? [] : [8], slots, extraBrain: 0 };
    },
    choose(id) {
      return { bubble_tea: 'skip', late_snack: 'no', deadline: 'squeeze', bbq: 'decline', group_slacker: 'cover',
        night_out: 'no', homesick_roll: 'ignore', energy_drink: 'skip', vaccine: 'take', past_exam: 'take' }[id];
    },
  };
}

export const STRATEGIES = {
  // Same event choices as 平衡派 so the only difference is a fixed 01:00 bedtime (6h).
  '熬夜派(睡6h)': adaptive({ bed: 25, reactsToIllness: false, weekendSleepIn: false }),
  // Reads notices and signs up for office hours like everyone else; office hours only pay off with enough progress.
  '養生派': adaptive({ bed: 22, studyMax: 3, minStudy: 0, late: 'never', choices: { bbq: () => 'sober', night_out: () => 'no' } }),
  // The reference healthy player never stays up for the late-night study group; exploiting it well is 應變派's edge.
  '平衡派': adaptive({ examEveBed: 22.5, late: 'never' }),
  '考前通宵派(熬到03:00)': adaptive({ examEveBed: 27 }),
  '考前通宵派(真通宵)': adaptive({ examEveBed: 31 }),
  '咖啡因依賴派': adaptive({
    bed: (c) => (c.S < 0.7 ? 25 : 24), reactsToIllness: false, weekendSleepIn: false, choices: nightOwlChoices,
    coffee: (c) => [8, ...(c.S < 0.85 ? [14] : []), ...(c.S < 0.7 ? [20] : [])],
  }),
  '早上咖啡派': adaptive({ examEveBed: 22.5, coffee: ['wake+1'] }),
  // Best copyable template: morning coffee, 22:30 bed, study everything, 17:00 exercise, 21:00 social. Never reads notices.
  '固定作息派': fixedRoutine(),
  // Healthy base of the fixed routine plus reading tomorrow's notices and reacting.
  '應變派': adaptive({ bed: 22.5, examEveBed: 22.5, coffee: ['wake+1'], react: true }),
};

export const EXTRA_STRATEGIES = {
  '應變派(不讀預告)': adaptive({ bed: 22.5, examEveBed: 22.5, coffee: ['wake+1'], react: true, blind: true }),
  '應變派(深夜讀書會:不去)': adaptive({ bed: 22.5, examEveBed: 22.5, coffee: ['wake+1'], react: true, late: 'never' }),
  '應變派(深夜讀書會:都去)': adaptive({ bed: 22.5, examEveBed: 22.5, coffee: ['wake+1'], react: true, late: 'always' }),
  '應變派(深夜讀書會:只考前一晚)': adaptive({ bed: 22.5, examEveBed: 22.5, coffee: ['wake+1'], react: true, late: 'eveOnly' }),
  '熬夜派(住院後改過)': adaptive({ bed: (c) => (c.hospital > 0 ? 22 : 25), reactsToIllness: false, weekendSleepIn: false }),
  '熬夜派(+夜貓選項)': adaptive({ bed: 25, reactsToIllness: false, weekendSleepIn: false, choices: nightOwlChoices }),
  '早上咖啡派(22:30睡)': adaptive({ bed: 22.5, examEveBed: 22.5, coffee: ['wake+1'] }),
  '下午咖啡派(15:00)': adaptive({ examEveBed: 22.5, coffee: [15] }),
  '平衡派+大腦加派1枚': adaptive({ examEveBed: 22.5, extraBrain: 1 }),
  '平衡派+每天夜班借調': adaptive({ examEveBed: 22.5, borrow: true }),
  // Hard-gap probe: 8h sleep + 1h exercise + 2h social every day, study the rest.
  '全都要派(每天運動+社交2h)': fixedRoutine({ coffee: false, bed: 23, socialHours: [20, 21] }),
  '固定作息派(無咖啡23:00睡)': fixedRoutine({ coffee: false, bed: 23 }),
  '固定作息派(咖啡23:00睡)': fixedRoutine({ bed: 23 }),
};
