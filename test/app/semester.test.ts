import { describe, expect, it } from 'vitest';
import { HANDBOOK, STRINGS } from '../../src/app/content.ts';
import {
  COFFEE_PLANS, daySummary, endSummary, morningPlan, newSemester, NIGHT_PLANS, nightPlan, REST_PLANS, servesAlcohol, visitReport, weekdayOf,
  type CoffeePlanId, type NightPlanId, type RestPlanId,
} from '../../src/app/semester.ts';
import {
  advanceDay, EVENTS, FLOORS, MAX_INCIDENT, startSemester, withBarbecueOn, type Answer, type Ask, type ReportDocument, type SemesterContext, type SemesterState, type Strategy,
} from '../../src/core/index.ts';
import { ARCHETYPES, type ArchetypeName } from '../../sim/semester/archetypes.ts';
import { bingeTwice, bingeWeek, contextFor, drinkWeek } from '../../sim/semester/scenario.ts';
import { modelMeasure } from '../../src/view/text/measure.ts';
import { CARD, cardWidth, TEXT_SCALES } from '../../src/view/text/styles.ts';
import { wrapCJK } from '../../src/view/text/wrap.ts';

const text = (key: string): string => {
  const s = STRINGS.strings[key];
  if (!s) throw new Error(`no string "${key}"`);
  return s.text;
};
const SCREEN = 1280;

/** Every card a semester screen can show: its option label and note, and how many cards share the row. */
function cardsOfEveryScreen(): { key: string; label: string; note: string; n: number }[] {
  const cards: { key: string; label: string; note: string; n: number }[] = [];
  const row = (prefix: string, ids: readonly string[]) =>
    ids.forEach((id) => cards.push({ key: `${prefix}.${id}`, label: `${prefix}.${id}`, note: `${prefix}.${id}.note`, n: ids.length }));
  row('semester.coffee', Object.keys(COFFEE_PLANS));
  row('semester.rest', Object.keys(REST_PLANS));
  row('semester.night', Object.keys(NIGHT_PLANS));
  row('semester.overtime', ['none', 'yes']);
  for (const e of EVENTS) row(`semester.event.${e.id}`, Object.keys(e.options));
  return cards.map((c) => ({ ...c, label: text(c.label), note: text(c.note) }));
}

describe('semester screens: every question has its words', () => {
  it('has a title for each event and a label and note for each option of each event', () => {
    for (const e of EVENTS) {
      expect(STRINGS.strings[`semester.event.${e.id}.title`], e.id).toBeDefined();
      for (const o of Object.keys(e.options)) {
        expect(STRINGS.strings[`semester.event.${e.id}.${o}`], `${e.id}.${o}`).toBeDefined();
        expect(STRINGS.strings[`semester.event.${e.id}.${o}.note`], `${e.id}.${o}.note`).toBeDefined();
      }
    }
  });

  it('names every floor, light, weekday and phase the panel and the banner can show', () => {
    for (const f of FLOORS) expect(STRINGS.strings[`semester.floor.${f}`], f).toBeDefined();
    for (const l of ['off', 'yellow', 'orange', 'red']) expect(STRINGS.strings[`semester.light.${l}`], l).toBeDefined();
    for (let d = 0; d < 7; d++) expect(STRINGS.strings[`semester.weekday.${d}`], String(d)).toBeDefined();
    for (const p of ['plan', 'event', 'floor', 'night']) expect(STRINGS.strings[`semester.phase.${p}`], p).toBeDefined();
    expect(STRINGS.strings['semester.floor.liver_ok']).toBeDefined();
  });

  it('fits every card label in two lines and every note in four, at both text sizes, in the row it is shown in', () => {
    const cards = cardsOfEveryScreen();
    expect(cards.length).toBeGreaterThan(15);
    for (const c of cards) {
      const inner = cardWidth(c.n, SCREEN) - 2 * CARD.padding;
      for (const s of TEXT_SCALES) {
        const label = wrapCJK(c.label, inner, modelMeasure(CARD.label.fontSize * s));
        const note = wrapCJK(c.note, inner, modelMeasure(CARD.note.fontSize * s));
        expect(label.length, `${c.key} label at ${s}`).toBeLessThanOrEqual(CARD.label.maxLines);
        expect(note.length, `${c.key} note at ${s}`).toBeLessThanOrEqual(CARD.note.maxLines);
      }
    }
  });

  it('keeps up to three cards at the reviewed width and narrows a row of five to fit the screen', () => {
    expect([1, 2, 3].map((n) => cardWidth(n, SCREEN))).toEqual([CARD.width, CARD.width, CARD.width]);
    const w5 = cardWidth(5, SCREEN);
    expect(w5).toBeLessThan(CARD.width);
    expect(5 * w5 + 4 * CARD.gap).toBeLessThanOrEqual(SCREEN);
  });

  it('shows the under-18 notice on exactly the events that pour a drink (design doc 11.3)', () => {
    expect(EVENTS.filter((e) => servesAlcohol(e.id)).map((e) => e.id)).toEqual(['bbq']);
    expect(servesAlcohol('no-such-event')).toBe(false);
  });

  it('numbers the week from Monday', () => {
    expect([1, 5, 6, 7, 8].map(weekdayOf)).toEqual([0, 4, 5, 6, 0]);
  });
});

const coffeeIds = Object.keys(COFFEE_PLANS) as CoffeePlanId[];
const restIds = Object.keys(REST_PLANS) as RestPlanId[];
const nightIds = Object.keys(NIGHT_PLANS) as NightPlanId[];

/** Answers each question the way a player picking the `k`th card would, cycling through the presets. */
function answerPicking(ask: Ask, k: number): Answer {
  switch (ask.kind) {
    case 'plan': return { kind: 'plan', plan: morningPlan(coffeeIds[k % coffeeIds.length]!, restIds[k % restIds.length]!) };
    case 'event': return { kind: 'event', option: ask.options[k % ask.options.length]! };
    case 'floor': {
      const patrol = FLOORS[k % FLOORS.length]!;
      return { kind: 'floor', choice: k % 2 === 0 ? { patrol } : { patrol, overtime: FLOORS[(k + 1) % FLOORS.length]! } };
    }
    case 'night': return { kind: 'night', plan: nightPlan(nightIds[k % nightIds.length]!) };
  }
}

/** A whole semester through the same calls the scene makes, with the summary built after every day. */
function playThrough(ctx: SemesterContext, state: SemesterState, k: number): { days: { before: SemesterState; after: SemesterState; lines: string[] }[]; end: SemesterState } {
  const days: { before: SemesterState; after: SemesterState; lines: string[] }[] = [];
  let s = state;
  for (let guard = 0; !s.ended; guard++) {
    if (guard > ctx.params.days) throw new Error('the semester never ended');
    const answers: Answer[] = [];
    for (;;) {
      const step = advanceDay(s, ctx, answers);
      if (step.done) {
        days.push({ before: s, after: step.state, lines: daySummary(s, step.state, ctx) });
        s = step.state;
        break;
      }
      answers.push(answerPicking(step.ask, k + answers.length));
    }
  }
  return { days, end: s };
}

describe('semester presets and summaries', () => {
  it('lets every preset of every question be answered through the whole semester, whichever the seed', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      for (let k = 0; k < 6; k++) {
        const { ctx, state } = newSemester(seed);
        const { end } = playThrough(ctx, state, k);
        expect(end.ended, `seed ${seed}, pick ${k}`).toBe(true);
      }
    }
  });

  it('writes the exam results on the two exam days and fills every placeholder of every line', () => {
    const { ctx, state } = newSemester(3);
    const { days, end } = playThrough(ctx, state, 0);
    const byDay = (d: number) => days.find((x) => x.before.day === d)!;
    expect(byDay(ctx.params.midDay).lines.some((l) => l.startsWith('期中考結果：'))).toBe(true);
    expect(byDay(ctx.params.finDay).lines.some((l) => l.startsWith('期末考結果：'))).toBe(true);
    expect(byDay(1).lines.some((l) => l.includes('考結果'))).toBe(false);
    for (const line of [...days.flatMap((d) => d.lines), ...endSummary(end, ctx)]) expect(line, line).not.toMatch(/[{}]/);
  });

  it('reports the exam as 0% when the exam day is a hospital day', () => {
    const { ctx, state } = newSemester(1);
    const { days } = playThrough(ctx, state, 0);
    const eve = days.find((d) => d.before.day === ctx.params.midDay)!.before;
    const step = advanceDay({ ...eve, hospitalDay: ctx.params.midDay }, ctx, []);
    expect(step.done).toBe(true);
    if (!step.done) return;
    expect(step.state.history[step.state.history.length - 1]!.kind).toBe('hospital');
    const lines = daySummary(eve, step.state, ctx);
    expect(lines).toContain('期中考結果：0%');
    expect(lines).toContain('住院休養一天。');
  });

  it('never names the liver in a day summary unless it struck or was patrolled, however loaded it is', () => {
    const liver = text('semester.floor.liver');
    let heavy = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { ctx, state } = newSemester(seed);
      const { days } = playThrough(ctx, state, seed);
      for (const d of days) {
        const rec = d.after.history[d.after.history.length - 1]!;
        const shown = rec.strikes.includes('liver') || rec.patrols.some((p) => p.floor === 'liver');
        if (!shown && rec.loadsSettled.liver >= 40) {
          heavy += 1;
          expect(d.lines.join('\n'), `seed ${seed} day ${d.before.day}`).not.toContain(liver);
        }
      }
    }
    // The check means something only if the liver was loaded without showing on some day.
    expect(heavy).toBeGreaterThan(0);
  });

  it('refuses a summary of anything but one finished day, and an end summary before the end', () => {
    const { ctx, state } = newSemester(1);
    expect(() => daySummary(state, state, ctx)).toThrow(/exactly one day/);
    expect(() => endSummary(state, ctx)).toThrow(/has not ended/);
  });
});

const strategyAnswer = (strategy: Strategy, ask: Ask): Answer => {
  switch (ask.kind) {
    case 'plan': return { kind: 'plan', plan: strategy.plan(ask.view) };
    case 'event': return { kind: 'event', option: strategy.choose(ask.id, ask.options, ask.view) };
    case 'floor': return { kind: 'floor', choice: strategy.floor(ask.view) };
    case 'night': return { kind: 'night', plan: strategy.night(ask.view) };
  }
};

/** The days of one semester on which the scene would show a report, with the state it would build it from. */
function reportDays(ctx: SemesterContext, strategy: Strategy, seed: number, known: ReadonlySet<string>): { state: SemesterState; doc: ReportDocument | undefined }[] {
  const out: { state: SemesterState; doc: ReportDocument | undefined }[] = [];
  let s = startSemester(ctx, seed);
  for (let guard = 0; !s.ended; guard++) {
    if (guard > ctx.params.days) throw new Error('the semester never ended');
    const answers: Answer[] = [];
    for (;;) {
      const step = advanceDay(s, ctx, answers);
      if (step.done) {
        s = step.state;
        out.push({ state: s, doc: visitReport(s, ctx, seed, known) });
        break;
      }
      answers.push(strategyAnswer(strategy, step.ask));
    }
  }
  return out;
}

describe('the report after a visit to the emergency room', () => {
  const names = Object.keys(ARCHETYPES) as ArchetypeName[];
  // Played on first use, inside a test, so that filtering the file or a throw here fails a test and not the collection.
  let played: { name: ArchetypeName; seed: number; days: ReturnType<typeof reportDays> }[] | undefined;
  const semesters = () => (played ??= names.flatMap((name) => [1, 2, 3, 4].map((seed) => ({ name, seed, days: reportDays(contextFor(0.5, seed, { scenario: bingeTwice(seed) }), ARCHETYPES[name], seed, new Set()) }))));

  it('is written on exactly the days that sent the operator there: a notice first, a bankruptcy report second', () => {
    let notices = 0;
    let bankruptcies = 0;
    for (const { name, seed, days } of semesters()) {
      const docs = days.filter((d) => d.doc !== undefined).map((d) => d.doc!);
      const visits = days.filter((d) => d.state.history[d.state.history.length - 1]!.crisis !== undefined);
      expect(docs.length, `${name}, seed ${seed}`).toBe(visits.length);
      expect(docs.map((d) => d.kind), `${name}, seed ${seed}`).toEqual(visits.map((_, i) => (i === 0 ? 'notice' : 'bankruptcy')));
      notices += docs.filter((d) => d.kind === 'notice').length;
      bankruptcies += docs.filter((d) => d.kind === 'bankruptcy').length;
    }
    // The test means something only if both documents were written somewhere.
    expect(notices).toBeGreaterThan(0);
    expect(bankruptcies).toBeGreaterThan(0);
  });

  it('is a finished document: at most five sentences, no unfilled placeholder, and a page that exists', () => {
    const pages = new Set(HANDBOOK.pages.map((p) => p.id));
    for (const { days } of semesters()) {
      for (const { doc } of days) {
        if (doc === undefined) continue;
        expect(doc.incident.length).toBeGreaterThan(0);
        expect(doc.incident.length).toBeLessThanOrEqual(MAX_INCIDENT);
        expect(doc.lines.join('\n')).not.toMatch(/[{}]/);
        expect(pages.has(doc.unlock), doc.unlock).toBe(true);
      }
    }
  });

  it('says the page is only referred to when the player already holds it', () => {
    const { ctx, state, seed } = (() => {
      const hit = semesters().find((s) => s.days.some((d) => d.doc !== undefined))!;
      return { ctx: contextFor(0.5, hit.seed, { scenario: bingeTwice(hit.seed) }), state: hit.days.find((d) => d.doc !== undefined)!.state, seed: hit.seed };
    })();
    const fresh = visitReport(state, ctx, seed, new Set())!;
    const known = visitReport(state, ctx, seed, new Set([fresh.unlock]))!;
    expect(known.lines).not.toEqual(fresh.lines);
    expect(known.incident).toEqual(fresh.incident);
    expect(known.unlock).toBe(fresh.unlock);
  });

  it('is the same document every time it is written from the same semester', () => {
    const hit = semesters().find((s) => s.days.some((d) => d.doc !== undefined))!;
    const ctx = contextFor(0.5, hit.seed, { scenario: bingeTwice(hit.seed) });
    const { state, doc } = hit.days.find((d) => d.doc !== undefined)!;
    expect(visitReport(state, ctx, hit.seed, new Set())).toEqual(doc);
  });
});

describe('barbecue days for a dev run', () => {
  it('moves the barbecue to exactly the named days and leaves every other event where it was', () => {
    const base = { 1: ['deadline'], 3: ['bbq', 'late_snack'], 6: ['bbq'] };
    expect(withBarbecueOn(base, [2, 3])).toEqual({ 1: ['deadline'], 2: ['bbq'], 3: ['late_snack', 'bbq'], 6: [] });
  });

  it('plays the semester a seed deals when no days are named, and the named days when they are', () => {
    const dealt = newSemester(5).ctx.scenario;
    const days = (s: Record<number, readonly string[]>) => Object.entries(s).filter(([, ids]) => ids.includes('bbq')).map(([d]) => Number(d));
    expect(days(newSemester(5, [2, 3, 4]).ctx.scenario)).toEqual([2, 3, 4]);
    expect(days(newSemester(5).ctx.scenario)).toEqual(days(dealt));
  });
});

describe('the sim scenarios built on withBarbecueOn', () => {
  /** The definitions the sim had before the helper moved into core, written out day by day. */
  const strip = (seed: number): Record<number, string[]> => {
    const days: Record<number, string[]> = {};
    for (const [day, ids] of Object.entries(contextFor(0.5, seed).scenario)) days[Number(day)] = ids.filter((id) => id !== 'bbq');
    return days;
  };
  it('give the same days as the hand-written versions', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const week = strip(seed);
      for (const d of [2, 3, 4]) (week[d] ??= []).push('bbq');
      expect(bingeWeek(seed)).toEqual(week);
      for (const d of [6, 7]) (week[d] ??= []).push('bbq');
      expect(bingeTwice(seed)).toEqual(week);
      const drink = strip(seed);
      for (let d = 2; d <= 9; d++) (drink[d] ??= []).push('bbq');
      expect(drinkWeek(seed)).toEqual(drink);
    }
  });
});