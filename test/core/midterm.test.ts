import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOSSES, DECKS, DIALOGUES, ENEMIES, EXAMS, PARAMS, RESCUES, TAGS } from '../../src/app/content.ts';
import { tagsFromQuery } from '../../src/app/session.ts';
import {
  amount, cloakSecondsFor, examResult, ExamTableError, flag, loadExamTable, LOCK_TICKS, parseRoom, questionOf, readContent, roomsOf, senseCap,
  startChapter, stateHash, stepAt, stepChapter, stepExam, TICK_HZ, TILE,
  type ChapterContent, type ChapterState, type ExamDef, type ExamState, type ExamTally, type GameEvent, type TickInput, type TiledMap,
} from '../../src/core/index.ts';
import { CLING } from '../../src/core/combat/frames.ts';

const CHAPTER = readContent('chapter', JSON.parse(readFileSync('content/chapters/midterm.json', 'utf8')));
const ROOM = 'midterm/exam-room';
const loadMap = (path: string) => JSON.parse(readFileSync(`public/assets/maps/${path}.tmj`, 'utf8')) as TiledMap;
const midterm: ChapterContent = {
  chapter: CHAPTER,
  rooms: new Map(roomsOf(CHAPTER).map((p) => [p, parseRoom(p, loadMap(p), TAGS)])),
  dialogues: DIALOGUES, dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS, rescues: RESCUES, exams: EXAMS, deck: DECKS.get('midterm')!,
};
const DEF: ExamDef = EXAMS.get('midterm')!;
const RAW = JSON.parse(readFileSync('content/exams/midterm.json', 'utf8')) as Record<string, unknown>;

const tags = (q: string) => tagsFromQuery(`?tags=${q}`, TAGS);
const NONE: TickInput = { move: { x: 0, y: 0 } };
const PRESS: TickInput = { move: { x: 0, y: 0 }, interactPressed: true };

function at(room: string, q = ''): ChapterState {
  const { pending: _, ...s } = startChapter(midterm, { room, ...(q ? { tags: tags(q) } : {}) });
  return s;
}
function place(s: ChapterState, x: number, y: number): ChapterState {
  return { ...s, game: { ...s.game, touching: [], operator: { ...s.game.operator, x, y } } };
}
function run(s: ChapterState, input: TickInput | ((s: ChapterState, i: number) => TickInput), n: number): { state: ChapterState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    const r = stepChapter(midterm, s, typeof input === 'function' ? input(s, i) : input);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}
/** Steps until done holds; hit-stop ticks pause the exam, so its clock is not the room's. */
function until(s: ChapterState, done: (s: ChapterState, events: readonly GameEvent[]) => boolean, input: TickInput = NONE, cap = 20000): { state: ChapterState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 0; i < cap; i++) {
    const r = stepChapter(midterm, s, input);
    s = r.state;
    events.push(...r.events);
    if (done(s, events)) return { state: s, events };
  }
  throw new Error('never happened');
}
/** Steps onto the exam trigger: the forecast opens. */
function forecast(q = ''): { state: ChapterState; events: GameEvent[] } {
  return run(place(at(ROOM, q), 4 * TILE + 16, 7 * TILE), NONE, 1);
}
/** The forecast read and closed: the first question is open. */
function seated(q = ''): ChapterState {
  const f = forecast(q).state;
  return run(run(f, NONE, LOCK_TICKS).state, PRESS, 1).state;
}
const types = (s: ChapterState, type: string) => s.game.enemies.filter((e) => e.type === type);

describe('the exam table (design doc 7.6)', () => {
  it('the shipped midterm loads with its two segments, and every question names its strings', () => {
    expect(DEF.segments.map((s) => s.kind)).toEqual(['oj', 'proof']);
    expect(DEF.cloakTicks).toBe(60 * TICK_HZ);
    // The residue halves every 30 s, as in a boss fight (bossSecondsPerHour x halfLife).
    expect(DEF.decayPerTick ** (30 * TICK_HZ)).toBeCloseTo(0.5, 6);
  });

  const reject = (change: (f: Record<string, any>) => void): string[] => {
    const f = structuredClone(RAW) as Record<string, any>;
    change(f);
    try {
      loadExamTable([f], ENEMIES, TAGS, PARAMS);
    } catch (e) {
      if (e instanceof ExamTableError) return [...e.problems];
      throw e;
    }
    return [];
  };

  it('rejects what the fight could not run', () => {
    expect(reject(() => {})).toEqual([]);
    expect(reject((f) => { f.paper = 'testcase'; })).toEqual([expect.stringMatching(/paper must be immune/)]);
    expect(reject((f) => { f.caseEnemy = 'adenosine'; })).toEqual([expect.stringMatching(/caseEnemy "adenosine" must be defeatable/)]);
    expect(reject((f) => { f.adenosine.enemy = 'testcase'; })).toEqual([expect.stringMatching(/adenosine.enemy must be a reforming enemy that clings/)]);
    expect(reject((f) => { f.segments[0].readinessTag = 'breakfast'; })).toEqual([expect.stringMatching(/"breakfast" \(oj readiness\) must be a number tag/)]);
    expect(reject((f) => { f.id = 'final'; })).toEqual([
      expect.stringMatching(/tag "final_score"/), expect.stringMatching(/tag "final_taken"/),
    ]);
    expect(reject((f) => { f.segments[1].stages[1].questions[1].id = 'invariant'; })).toEqual([expect.stringMatching(/question id "invariant" is used twice/)]);
    expect(reject((f) => { f.readiness.floor = 70; })).toEqual([expect.stringMatching(/floor above passAt/)]);
    expect(reject((f) => { f.segments[0].stages[0].barrage.everySeconds = 0.5; })).toEqual([expect.stringMatching(/longer than the 0.5 s tier-1 telegraph/)]);
    expect(reject((f) => { f.segments[0].stages[0].questions[0].steps = 3; })).toEqual([expect.stringMatching(/an oj question has cases and speedTiles and no steps/)]);
    expect(reject((f) => { f.segments[1].stages[0].questions[0].cases = 3; })).toEqual([expect.stringMatching(/a proof question has steps and no cases/)]);
    expect(reject((f) => { f.segments[0].stages[0].bonus.atSeconds = 25; })).toEqual([expect.stringMatching(/bonus.atSeconds must fall inside/)]);
    expect(reject((f) => { delete f.notes; }).length).toBeGreaterThan(0);
  });
});

describe('the forecast (design doc 7.6, 8.9)', () => {
  it('stepping into the exam opens the forecast, which freezes the room until it is read', () => {
    const { state, events } = forecast('sleep_debt:4,caffeine:100,exam_practice:95');
    expect(events.map((e) => e.type)).toContain('examForecast');
    const f = state.exam!.forecast!;
    expect(f.bars).toEqual([{ kind: 'oj', readiness: 95 }, { kind: 'proof', readiness: 50 }]);
    // Design doc 8.9: adenosine = 2 x sleep debt; a cup of 100 cloaks for the whole 60 s.
    expect(f.adenosine).toBe(8);
    expect(f.cloakSeconds).toBe(60);
    expect(f.breakfast).toBe(false);
    expect(f.s).toBeLessThan(1);
    const held = run(state, NONE, LOCK_TICKS + 30).state;
    expect(held.game.tick).toBe(state.game.tick);
    expect(held.game.exam).toBeUndefined();
  });

  it('the cloak is the time the residue takes to fall below the near line, at most 60 s', () => {
    expect(cloakSecondsFor(DEF, 0)).toBe(0);
    expect(cloakSecondsFor(DEF, 50)).toBe(30);
    expect(cloakSecondsFor(DEF, 100)).toBe(60);
    expect(cloakSecondsFor(DEF, 400)).toBe(60);
    expect(forecast('sleep_debt:9').state.exam!.forecast!.adenosine).toBe(10);
  });
});

describe('the exam fight', () => {
  it('closing the forecast starts the fight: adenosine for the debt and the first test cases', () => {
    const s = seated('sleep_debt:2');
    expect(s.exam).toBeUndefined();
    const exam = s.game.exam!;
    expect(exam.part).toBe('run');
    expect(types(s, 'adenosine')).toHaveLength(4);
    expect(types(s, 'testcase')).toHaveLength(questionOf(DEF, exam).cases);
    for (const e of types(s, 'adenosine')) expect(Math.hypot(e.x - s.game.operator.x, e.y - s.game.operator.y)).toBeGreaterThanOrEqual(5 * TILE);
  });

  it('the chapter clock stands still while the exam is sat, and runs again after', () => {
    const s = seated();
    const later = run(s, NONE, 600).state;
    expect(later.game.clock).toEqual(s.game.clock);
    expect(later.run.explored).toBe(s.run.explored);
    const outside = run(at('midterm/hall'), NONE, 600).state;
    expect(outside.game.clock.minute).toBeGreaterThan(at('midterm/hall').game.clock.minute);
  });

  it('the cloak comes from the residue on the boss clock and is gone after 60 s, whatever is left', () => {
    const s = seated('caffeine:400');
    expect(s.game.senseCapPx).toBe(senseCap(400));
    const before = until(s, (x) => x.game.exam!.elapsed === DEF.cloakTicks - 1).state;
    expect(before.game.exam!.residue).toBeGreaterThan(50);
    expect(before.game.senseCapPx).toBe(senseCap(100));
    // The cap a tick runs under is judged as it starts, from the residue the last tick left.
    const later = run(before, NONE, 2).state;
    expect(later.game.exam!.residue).toBe(0);
    expect(later.game.senseCapPx).toBeUndefined();
    // The chapter's residue is not what the fight reads: it has not moved.
    expect(amount(later.run.tags, TAGS, 'caffeine')).toBe(400);
  });

  it('a hit costs no heart but counts against the segment', () => {
    const s = seated();
    const { state, events } = run(s, NONE, 20 * TICK_HZ);
    expect(events.some((e) => e.type === 'examHit')).toBe(true);
    expect(events.some((e) => e.type === 'heartLost')).toBe(false);
    expect(state.game.operator.halves).toBe(s.game.operator.halves);
    expect(state.game.exam!.tallies[0]!.hits).toBe(events.filter((e) => e.type === 'examHit').length);
  });

  it('a question runs out of time with partial credit, and the next one opens after the gap', () => {
    const s = seated();
    const { state, events } = until(s, (_, ev) => ev.some((e) => e.type === 'examAnswered'));
    expect(events.filter((e) => e.type === 'examHit').length).toBeGreaterThan(0);
    const answered = events.find((e) => e.type === 'examAnswered');
    expect(answered).toMatchObject({ how: 'time', share: 0, question: 'oj1' });
    expect(types(state, 'testcase')).toHaveLength(0);
    const next = until(state, (x) => x.game.exam!.part === 'run');
    expect(next.events).toContainEqual(expect.objectContaining({ type: 'examQuestion', question: 'oj2' }));
  });

  it('three clinging stacks fail the open question instead of forcing a nap', () => {
    const s = seated('sleep_debt:2');
    const op = s.game.operator;
    // No cloak, so they see and grab; three of them where the operator stands.
    const enemies = s.game.enemies.map((e) => (e.type === 'adenosine' ? { ...e, x: op.x, y: op.y } : e));
    const { state, events } = run({ ...s, game: { ...s.game, enemies } }, NONE, 3 * CLING.maxStacks);
    expect(events.filter((e) => e.type === 'clung').length).toBeGreaterThanOrEqual(CLING.maxStacks);
    expect(events.some((e) => e.type === 'forcedNap')).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({ type: 'examAnswered', how: 'stacks', share: 0 }));
    expect(state.game.clock).toEqual(s.game.clock);
  });

  it('proof steps are stamped in order; a step out of order undoes the question', () => {
    // Straight to the written test's first question.
    let s = seated();
    const exam = { ...s.game.exam!, segment: 1, stage: 0, question: 0, part: 'break' as const, ticks: DEF.breakTicks };
    s = { ...s, game: { ...s.game, exam: { ...exam, segment: 0 } } };
    s = run(s, NONE, 1).state;
    const steps = s.game.exam!.steps;
    expect(steps).toHaveLength(questionOf(DEF, s.game.exam!).steps);
    const stamp = (st: ChapterState, order: number) => {
      const p = steps.find((x) => x.order === order)!;
      const placed = { ...st, game: { ...st.game, operator: { ...st.game.operator, x: p.x, y: p.y } } };
      expect(stepAt(placed.game.exam!, placed.game.operator)?.order).toBe(order);
      return run(placed, PRESS, 1);
    };
    let r = stamp(s, 0);
    expect(r.events).toContainEqual({ type: 'proofStamped', order: 0, ok: true, stamped: 1 });
    r = stamp(r.state, 2);
    expect(r.events).toContainEqual({ type: 'proofStamped', order: 2, ok: false, stamped: 0 });
    for (let i = 0; i < steps.length; i++) r = stamp(r.state, i);
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'examAnswered', question: 'invariant', share: 1, how: 'solved' }));
  });

  it('the bonus case appears once per stage and leaves when its time is up', () => {
    const s = seated();
    const stage = DEF.segments[0]!.stages[0]!;
    const { state, events } = until(s, (x) => x.game.exam!.stageTicks === stage.bonus!.atTicks);
    expect(events.filter((e) => e.type === 'bonusShown')).toHaveLength(1);
    expect(types(state, 'testcase_bonus')).toHaveLength(1);
    expect(state.game.exam!.tallies[0]!.bonusOffered).toBe(1);
    const gone = until(state, (x) => x.game.exam!.bonus === null).state;
    expect(gone.game.exam!.bonus).toBeNull();
    expect(types(gone, 'testcase_bonus')).toHaveLength(0);
  });

  it('a whole exam replays to the same hash, and the score and the taken flag go into the tags', () => {
    const play = (q: string) => {
      let s = seated(q);
      const all: GameEvent[] = [];
      for (let i = 0; i < 400 * TICK_HZ && s.game.exam?.part !== 'done'; i++) {
        const r = stepChapter(midterm, s, { move: { x: Math.sin(i / 40), y: Math.cos(i / 55) }, attack: i % 3 === 0 });
        s = r.state;
        all.push(...r.events);
      }
      return { s, all };
    };
    const a = play('sleep_debt:2,caffeine:100');
    expect(a.s.game.exam!.part).toBe('done');
    expect(stateHash(a.s)).toBe(stateHash(play('sleep_debt:2,caffeine:100').s));
    expect(stateHash(a.s)).not.toBe(stateHash(play('sleep_debt:4,caffeine:100').s));
    const result = a.all.find((e) => e.type === 'examResult');
    expect(result).toBeDefined();
    expect(a.s.exam?.result?.total).toBe((result as { total: number }).total);
    expect(amount(a.s.run.tags, TAGS, 'midterm_score')).toBe(a.s.exam!.result!.total);
    expect(flag(a.s.run.tags, TAGS, 'midterm_taken')).toBe(true);
    // The exam's adenosine leaves with the paper's summons; no test case is left behind.
    expect(types(a.s, 'testcase')).toHaveLength(0);
    // Closing the result opens the conversation after the exam.
    const closed = run(run(a.s, NONE, LOCK_TICKS).state, PRESS, 2);
    expect(closed.events).toContainEqual({ type: 'examClosed', exam: 'midterm' });
    expect(closed.events).toContainEqual(expect.objectContaining({ type: 'dialogueOpened', dialogueId: 'midterm.after' }));
  });
});

describe('the score (design doc 8.9)', () => {
  const tally = (t: Partial<ExamTally>): ExamTally => ({ questions: 3, answered: 3, hits: 0, bonusOffered: 2, bonusHit: 2, ...t });

  it('a bar at passAt and S = 1 gives 60 before the performance, and the floor holds the bar up', () => {
    const r = examResult(DEF, [tally({}), tally({})], tags('exam_practice:60,exam_archived:10'), TAGS, PARAMS);
    expect(r.segments.map((s) => s.readiness)).toEqual([60, 50]);
    expect(r.segments[0]!.score.base).toBeCloseTo(60);
    expect(r.segments[0]!.score.examPercent).toBeCloseTo(75);
  });

  it('hits, a missed bonus and unanswered questions cost performance; with none offered the bonus scores as the rest does', () => {
    const full = examResult(DEF, [tally({}), tally({})], tags('exam_practice:80,exam_archived:80'), TAGS, PARAMS).segments[0]!;
    const hit = examResult(DEF, [tally({ hits: DEF.hitsForZero }), tally({})], tags('exam_practice:80,exam_archived:80'), TAGS, PARAMS).segments[0]!;
    expect(hit.hitScore).toBe(0);
    expect(hit.score.examPercent).toBeLessThan(full.score.examPercent);
    const missed = examResult(DEF, [tally({ bonusHit: 0 }), tally({})], tags(''), TAGS, PARAMS).segments[0]!;
    expect(missed.bonusRate).toBe(0);
    // Answering a stage before its bonus appears is neither a miss nor a free 15%.
    const fast = examResult(DEF, [tally({ bonusOffered: 0, bonusHit: 0 }), tally({})], tags(''), TAGS, PARAMS).segments[0]!;
    expect(fast.bonusRate).toBe(1);
    expect([fast.noBonus, missed.noBonus]).toEqual([true, false]);
    const fastHit = examResult(DEF, [tally({ bonusOffered: 0, bonusHit: 0, hits: DEF.hitsForZero / 2 }), tally({})], tags(''), TAGS, PARAMS).segments[0]!;
    expect(fastHit.bonusRate).toBeCloseTo((0.6 + 0.25 * 0.5) / 0.85);
    expect(fastHit.score.kind === 'regular' && fastHit.score.performance).toBeCloseTo((0.6 + 0.25 * 0.5) / 0.85);
    const half = examResult(DEF, [tally({ answered: 1.5 }), tally({})], tags(''), TAGS, PARAMS).segments[0]!;
    expect(half.answerRate).toBeCloseTo(0.5);
  });

  it('sleep debt lowers the base through S, and practice without filing says so', () => {
    const rested = examResult(DEF, [tally({}), tally({})], tags('exam_practice:95'), TAGS, PARAMS);
    const tired = examResult(DEF, [tally({}), tally({})], tags('exam_practice:95,sleep_debt:4'), TAGS, PARAMS);
    expect(tired.s).toBeLessThan(rested.s);
    expect(tired.total).toBeLessThan(rested.total);
    expect(rested.practiceOnly).toBe(true);
    expect(examResult(DEF, [tally({}), tally({})], tags('exam_practice:80,exam_archived:80'), TAGS, PARAMS).practiceOnly).toBe(false);
  });
});

describe('the bonus case belongs to its stage (review of PR #29)', () => {
  const tick = (s: ChapterState, exam: ExamState, happened: GameEvent[] = [], enemies = s.game.enemies) => stepExam(DEF, {
    exam, grid: s.game.room.grid, enemies, rng: s.game.rng, nextId: s.game.nextId,
    operator: s.game.operator, interact: false, happened: happened as never,
  });
  const atStage = (stage: number, question: number): { s: ChapterState; exam: ExamState } => {
    const s = seated();
    const at = DEF.segments[0]!.stages[stage]!.bonus!.atTicks;
    return { s, exam: { ...s.game.exam!, stage, question, ticks: 0, stageTicks: at - 1, bonusShown: false } };
  };

  it('appears only during the stage\'s first question: a stage whose first question was answered early offers none', () => {
    const late = atStage(0, 1);
    expect(tick(late.s, late.exam).events.some((e) => e.type === 'bonusShown')).toBe(false);
    const first = atStage(0, 0);
    expect(tick(first.s, first.exam).events.some((e) => e.type === 'bonusShown')).toBe(true);
  });

  it('leaves when its stage ends, so it never crosses into the next segment', () => {
    // The computer test's last stage, its one question open, the bonus just out.
    const { s, exam } = atStage(1, 0);
    const shown = tick(s, exam);
    const bonus = shown.exam.bonus!;
    expect(bonus).not.toBeNull();
    const closed = tick(s, shown.exam, [{ type: 'examStacked' }], shown.enemies);
    expect(closed.exam.part).toBe('break');
    expect(closed.exam.bonus).toBeNull();
    expect(closed.enemies.some((e) => e.id === bonus.id)).toBe(false);
  });

  it('a hit on it counts for the segment that offered it, never above what was offered', () => {
    const { s, exam } = atStage(0, 0);
    const shown = tick(s, exam);
    const bonus = shown.exam.bonus!;
    // Moved to the written test by hand, as an old bonus would have been before the fix.
    const later = { ...shown.exam, segment: 1, stage: 0, question: 0, stageTicks: 0, bonusShown: true };
    const hit = tick(s, later, [{ type: 'caseClosed', target: bonus.id } as unknown as GameEvent], shown.enemies);
    expect(hit.exam.tallies[0]).toMatchObject({ bonusOffered: 1, bonusHit: 1 });
    expect(hit.exam.tallies[1]).toMatchObject({ bonusOffered: 0, bonusHit: 0 });
  });
});

describe('a single exam tick', () => {
  it('a stack failure closes the open question with nothing answered', () => {
    const s = seated();
    const r = stepExam(DEF, {
      exam: s.game.exam!, grid: s.game.room.grid, enemies: s.game.enemies, rng: s.game.rng, nextId: s.game.nextId,
      operator: s.game.operator, interact: false, happened: [{ type: 'examStacked' }],
    });
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'examAnswered', how: 'stacks', share: 0 }));
    expect(r.exam.part).toBe('gap');
    expect(r.exam.tallies[0]).toMatchObject({ questions: 1, answered: 0 });
  });
});
