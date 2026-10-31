import { describe, expect, it } from 'vitest';
import { STRINGS } from '../../src/app/content.ts';
import {
  COFFEE_PLANS, daySummary, endSummary, morningPlan, newSemester, NIGHT_PLANS, nightPlan, REST_PLANS, servesAlcohol, weekdayOf,
  type CoffeePlanId, type NightPlanId, type RestPlanId,
} from '../../src/app/semester.ts';
import { advanceDay, EVENTS, FLOORS, type Answer, type Ask, type SemesterContext, type SemesterState } from '../../src/core/index.ts';
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
