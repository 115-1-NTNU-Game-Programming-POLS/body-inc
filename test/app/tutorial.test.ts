import { describe, expect, it } from 'vitest';
import { freshSeed, newSemester, resumeSemester, semesterContext, TUTORIAL_SEED, tutorialScenario, TUTOR_DAYS, tutorLine } from '../../src/app/semester.ts';
import { STRINGS } from '../../src/app/content.ts';
import { SaveStore } from '../../src/app/storage.ts';
import { advanceDay, decode, DEFAULT_HOST, encode, PROGRESS, scenarioFor, type Answer, type Ask, type ProgressData, type Strategy } from '../../src/core/index.ts';
import { finishSemester } from '../../src/app/semester.ts';
import { ARCHETYPES } from '../../sim/semester/archetypes.ts';

const answerFrom = (strategy: Strategy, ask: Ask): Answer => {
  switch (ask.kind) {
    case 'plan': return { kind: 'plan', plan: strategy.plan(ask.view) };
    case 'event': return { kind: 'event', option: strategy.choose(ask.id, ask.options, ask.view) };
    case 'floor': return { kind: 'floor', choice: strategy.floor(ask.view) };
    case 'night': return { kind: 'night', plan: strategy.night(ask.view) };
  }
};

describe('the scripted first week (design doc 8.13)', () => {
  it('fixes the first three days: the barbecue on the evening of day 2 and nothing on days 1 and 3', () => {
    const s = semesterContext(TUTORIAL_SEED).scenario;
    expect(s[1] ?? []).toEqual([]);
    expect(s[2]).toEqual(['bbq']);
    expect(s[3] ?? []).toEqual([]);
  });

  it('replaces whatever the seed dealt on those three days and keeps the rest', () => {
    const dealt = { 1: ['deadline'], 2: ['late_snack', 'deadline'], 3: ['bbq', 'deadline'], 4: ['bbq'], 9: ['late_snack'] };
    expect(tutorialScenario(dealt)).toEqual({ 1: [], 2: ['bbq'], 3: [], 4: ['bbq'], 9: ['late_snack'] });
  });

  it('leaves every other semester as its seed deals it, and day 4 onwards of the tutorial too', () => {
    const tutorial = semesterContext(TUTORIAL_SEED).scenario;
    const dealt = scenarioFor(TUTORIAL_SEED);
    expect(Object.values(dealt).flat().length).toBeGreaterThan(3);
    for (let day = 4; day <= 10; day++) expect(tutorial[day] ?? [], `day ${day}`).toEqual(dealt[day] ?? []);
    for (const seed of [1, 2, 3, TUTORIAL_SEED + 1]) expect(semesterContext(seed).scenario, `seed ${seed}`).toEqual(scenarioFor(seed));
  });

  it('is the semester every new player gets first, and the clock seed after one has been played', () => {
    expect(freshSeed(0, 1_000_000)).toBe(TUTORIAL_SEED);
    expect(freshSeed(1, 1_000_000)).toBe(1_000_000);
    expect(freshSeed(3, 2_147_483_647 + 5)).toBe(5);
  });

  it('has the chairman speak on its days and nowhere else', () => {
    for (let day = 1; day <= 10; day++) {
      const line = tutorLine(TUTORIAL_SEED, day);
      expect(line !== undefined, `day ${day}`).toBe((TUTOR_DAYS as readonly number[]).includes(day));
      expect(tutorLine(TUTORIAL_SEED + 1, day), `another seed, day ${day}`).toBeUndefined();
    }
    for (const d of TUTOR_DAYS) expect(STRINGS.strings[`semester.tutor.${d}`]?.text).toMatch(/^董事長：/);
  });

  it('is saved and resumed like any semester, with its script', () => {
    const { ctx, state } = newSemester(TUTORIAL_SEED);
    const strategy = ARCHETYPES.balanced;
    let s = state;
    const days: Answer[][] = [];
    for (let day = 0; day < 3; day++) {
      const answers: Answer[] = [];
      for (;;) {
        const step = advanceDay(s, ctx, answers);
        if (step.done) {
          s = step.state;
          break;
        }
        answers.push(answerFrom(strategy, step.ask));
      }
      days.push(answers);
    }
    // Day 2 asked about the barbecue, which is how the script shows.
    expect(days[1]!.some((a) => a.kind === 'event')).toBe(true);
    expect(days[0]!.some((a) => a.kind === 'event')).toBe(false);
    expect(days[2]!.some((a) => a.kind === 'event')).toBe(false);
    expect(resumeSemester({ seed: TUTORIAL_SEED, days })?.state).toEqual(s);
  });
});

describe('counting finished semesters', () => {
  const fresh: ProgressData = { handbook: [], hostName: DEFAULT_HOST, semestersDone: 0 };

  it('starts at none, migrates an older save to none, and refuses a negative count', () => {
    expect(decode(PROGRESS, null).data.semestersDone).toBe(0);
    const v2 = JSON.stringify({ schema: 2, data: { handbook: ['caffeine'], hostName: '阿明' } });
    expect(decode(PROGRESS, v2)).toEqual({ kind: 'migrated', from: 2, data: { handbook: ['caffeine'], hostName: '阿明', semestersDone: 0 } });
    const bad = JSON.stringify({ schema: 3, data: { handbook: [], hostName: DEFAULT_HOST, semestersDone: -1 } });
    expect(decode(PROGRESS, bad).kind).toBe('invalid');
    expect(decode(PROGRESS, encode(PROGRESS, { ...fresh, semestersDone: 4 })).data.semestersDone).toBe(4);
  });

  it('adds one and writes it to the progress slot', () => {
    const data = new Map<string, string>();
    const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
    const done = finishSemester(new SaveStore(store), fresh);
    expect(done.progress).toEqual({ ...fresh, semestersDone: 1 });
    expect(done.issues).toEqual([]);
    expect(decode(PROGRESS, data.get('hbc.v1.progress') ?? null).data.semestersDone).toBe(1);
  });
});
