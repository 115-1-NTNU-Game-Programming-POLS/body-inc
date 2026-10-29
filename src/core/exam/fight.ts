import { bodyOverlapsSolid, type SolidGrid } from '../collision/grid.ts';
import { ENEMY_BODY, enemyFrom, type EnemyState } from '../combat/actors.ts';
import type { EnemyTable } from '../combat/enemies.ts';
import { TELEGRAPH } from '../combat/frames.ts';
import type { ShotSpec } from '../combat/hazards.ts';
import type { Vec } from '../combat/movement.ts';
import type { OperatorState } from '../combat/operator.ts';
import type { Enemy, ExamFile } from '../content/generated.ts';
import { schemaProblems } from '../content/read.ts';
import { schemaProblemText } from '../content/schema.ts';
import type { DomainEvent } from '../game.ts';
import { drawFloat, drawInt, type RngStreams } from '../rng.ts';
import type { TagDictionary } from '../tags/dictionary.ts';
import { TICK_HZ, TILE, tilesPerSecond } from '../time.ts';

/**
 * The story's exam fight (design doc 7.6; the scoring is 8.9 and lives in scoring.ts). The paper
 * stands in the room and throws a barrage; the operator answers questions in segments: the
 * computer test's questions are test cases drifting about the room, each answered by one hit of
 * stationery, and the written test's are proof steps on the floor, stamped in order with the
 * interact key, where a step out of order undoes the question's stamps. Three clinging adenosine
 * stacks fail the question being answered instead of forcing a nap. Hits cost no hearts here,
 * since the exam never ends the story; they count against the performance. Why each rule was
 * chosen where the design doc is silent is in docs/authoring/exams.md.
 */

export type ExamKind = 'oj' | 'proof';

export interface ExamQuestionDef {
  readonly id: string;
  readonly ticks: number;
  /** oj: test cases on the floor at once; 0 for proof. */
  readonly cases: number;
  /** oj: drift of the test cases in pixels per tick. */
  readonly speed: number;
  /** proof: steps to stamp in order; 0 for oj. */
  readonly steps: number;
}

export interface ExamBarrageDef {
  readonly everyTicks: number;
  readonly shots: number;
  readonly spreadRad: number;
  readonly shotSpeed: number;
  readonly shotTicks: number;
}

export interface ExamStageDef {
  readonly questions: readonly ExamQuestionDef[];
  readonly barrage: ExamBarrageDef;
  readonly bonus?: { readonly atTicks: number; readonly ticks: number; readonly speed: number };
}

export interface ExamSegmentDef {
  readonly kind: ExamKind;
  readonly readinessTag: string;
  readonly stages: readonly ExamStageDef[];
}

export interface ExamDef {
  readonly id: string;
  readonly paper: Enemy;
  readonly caseEnemy: Enemy;
  readonly bonusEnemy: Enemy;
  readonly floor: number;
  readonly passAt: number;
  readonly adenosine: { readonly enemy: Enemy; readonly perDebtHour: number; readonly max: number };
  readonly cloakTicks: number;
  readonly hitsForZero: number;
  readonly gapTicks: number;
  readonly breakTicks: number;
  readonly afterDialogue: string;
  readonly segments: readonly ExamSegmentDef[];
  /** Residue multiplier per tick on the boss clock, so a cup's cloak lasts as long as in a boss fight. */
  readonly decayPerTick: number;
}

export type ExamTable = ReadonlyMap<string, ExamDef>;

export class ExamTableError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`exam table is invalid:\n  ${problems.join('\n  ')}`);
    this.problems = problems;
  }
}

/** The caffeine rules of content/params.json the fight's cloak needs. */
export interface ExamClockParams {
  readonly halfLife: number;
  readonly bossSecondsPerHour: number;
}

/** Tags the chapter writes when an exam ends: the score, and that it was sat. */
export const scoreTag = (id: string): string => `${id}_score`;
export const takenTag = (id: string): string => `${id}_taken`;

const ticks = (seconds: number): number => Math.round(seconds * TICK_HZ);

function enemyProblems(where: string, enemies: EnemyTable, f: ExamFile): string[] {
  const out: string[] = [];
  const paper = enemies.enemies.get(f.paper);
  if (!paper) out.push(`${where}: paper "${f.paper}" is not in content/enemies.json`);
  else if (paper.category !== 'immune') out.push(`${where}: the paper must be immune, so hitting it answers nothing`);
  for (const [field, id] of [['caseEnemy', f.caseEnemy], ['bonusEnemy', f.bonusEnemy]] as const) {
    const e = enemies.enemies.get(id);
    if (!e) out.push(`${where}: ${field} "${id}" is not in content/enemies.json`);
    else if (e.category !== 'defeatable' || e.archetype !== 'testcase' || e.performance !== 1) {
      out.push(`${where}: ${field} "${id}" must be defeatable with archetype testcase and performance 1, so one hit answers it`);
    }
  }
  const a = enemies.enemies.get(f.adenosine.enemy);
  if (!a) out.push(`${where}: adenosine.enemy "${f.adenosine.enemy}" is not in content/enemies.json`);
  else if (a.category !== 'reforming' || a.clings !== true) out.push(`${where}: adenosine.enemy must be a reforming enemy that clings`);
  return out;
}

function tagProblems(where: string, f: ExamFile, dict: TagDictionary): string[] {
  const out: string[] = [];
  const need = (name: string, type: 'number' | 'boolean', why: string) => {
    const t = dict.tags.get(name);
    if (!t) out.push(`${where}: tag "${name}" (${why}) is not in content/tags.json`);
    else if (t.type !== type) out.push(`${where}: tag "${name}" (${why}) must be a ${type} tag`);
  };
  for (const s of f.segments) need(s.readinessTag, 'number', `${s.kind} readiness`);
  need(scoreTag(f.id), 'number', 'the score the chapter writes');
  need(takenTag(f.id), 'boolean', 'set once the exam is sat');
  return out;
}

function stageDef(where: string, kind: ExamKind, s: ExamFile['segments'][number]['stages'][number], problems: string[]): ExamStageDef {
  const b = s.barrage;
  const everyTicks = ticks(b.everySeconds);
  // Each fan's tier-1 warning plays out before the next one starts (design doc 5.3).
  if (everyTicks <= TELEGRAPH.tier1Ticks) problems.push(`${where}: barrage.everySeconds must be longer than the 0.5 s tier-1 telegraph`);
  const questions = s.questions.map((q) => {
    const at = `${where} question "${q.id}"`;
    if (kind === 'oj' && (q.cases === undefined || q.speedTiles === undefined || q.steps !== undefined)) {
      problems.push(`${at}: an oj question has cases and speedTiles and no steps`);
    }
    if (kind === 'proof' && (q.steps === undefined || q.cases !== undefined || q.speedTiles !== undefined)) {
      problems.push(`${at}: a proof question has steps and no cases or speedTiles`);
    }
    return { id: q.id, ticks: ticks(q.seconds), cases: q.cases ?? 0, speed: tilesPerSecond(q.speedTiles ?? 0), steps: q.steps ?? 0 };
  });
  const speed = tilesPerSecond(b.shotSpeedTiles);
  const bonus = s.bonus && { atTicks: ticks(s.bonus.atSeconds), ticks: ticks(s.bonus.seconds), speed: tilesPerSecond(s.bonus.speedTiles) };
  // It appears during the stage's first question, so a bonus timed after that question ends would never be offered.
  if (bonus && questions[0] && bonus.atTicks >= questions[0].ticks) problems.push(`${where}: bonus.atSeconds must fall inside the stage's first question`);
  return {
    questions,
    barrage: { everyTicks, shots: b.shots, spreadRad: (b.spreadDeg * Math.PI) / 180, shotSpeed: speed, shotTicks: Math.ceil((b.rangeTiles * TILE) / speed) },
    ...(bonus ? { bonus } : {}),
  };
}

/** Validates each file against the exam schema and cross-checks it with the enemy table and the tags. */
export function loadExamTable(files: readonly unknown[], enemies: EnemyTable, dict: TagDictionary, k: ExamClockParams): ExamTable {
  const problems: string[] = [];
  const out = new Map<string, ExamDef>();
  for (const raw of files) {
    const shape = schemaProblems('exam', raw);
    if (shape.length > 0) {
      problems.push(...shape.map(schemaProblemText));
      continue;
    }
    const f = raw as ExamFile;
    const where = `exam "${f.id}"`;
    if (out.has(f.id)) problems.push(`${where}: defined twice`);
    const bad = [...enemyProblems(where, enemies, f), ...tagProblems(where, f, dict)];
    problems.push(...bad);
    const ids = f.segments.flatMap((s) => s.stages.flatMap((st) => st.questions.map((q) => q.id)));
    for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) problems.push(`${where}: question id "${id}" is used twice; its strings are keyed by it`);
    if (f.readiness.floor > f.readiness.passAt) problems.push(`${where}: readiness.floor above passAt would make every exam a pass on the floor alone`);
    const segments = f.segments.map((s, i) => ({
      kind: s.kind,
      readinessTag: s.readinessTag,
      stages: s.stages.map((st, j) => stageDef(`${where} segment ${i + 1} stage ${j + 1}`, s.kind, st, problems)),
    }));
    if (bad.length > 0) continue;
    out.set(f.id, {
      id: f.id,
      paper: enemies.enemies.get(f.paper)!,
      caseEnemy: enemies.enemies.get(f.caseEnemy)!,
      bonusEnemy: enemies.enemies.get(f.bonusEnemy)!,
      floor: f.readiness.floor,
      passAt: f.readiness.passAt,
      adenosine: { enemy: enemies.enemies.get(f.adenosine.enemy)!, perDebtHour: f.adenosine.perDebtHour, max: f.adenosine.max },
      cloakTicks: ticks(f.cloakSeconds),
      hitsForZero: f.hitsForZero,
      gapTicks: ticks(f.gapSeconds),
      breakTicks: ticks(f.breakSeconds),
      afterDialogue: f.afterDialogue,
      segments,
      decayPerTick: 0.5 ** (1 / (k.halfLife * k.bossSecondsPerHour * TICK_HZ)),
    });
  }
  if (problems.length > 0) throw new ExamTableError(problems);
  return out;
}

/** The string keys an exam shows: the paper's name, each question's prompt and each proof step. */
export function examStringKeys(def: Pick<ExamDef, 'id' | 'segments'>): string[] {
  const at = `exam.${def.id}`;
  return [
    `${at}.name`,
    ...def.segments.flatMap((s) => [
      `${at}.segment.${s.kind}`,
      ...s.stages.flatMap((st) => st.questions.flatMap((q) => [
        `${at}.${q.id}.prompt`,
        ...Array.from({ length: q.steps }, (_, n) => `${at}.${q.id}.step.${n + 1}`),
      ])),
    ]),
  ];
}

/** What one segment has scored so far. `answered` sums each question's share answered, from 0 to 1. */
export interface ExamTally {
  readonly questions: number;
  readonly answered: number;
  readonly hits: number;
  readonly bonusOffered: number;
  readonly bonusHit: number;
}

/** A proof step on the floor; `order` counts from 0 in the order it must be stamped. */
export interface ProofStep {
  readonly order: number;
  readonly x: number;
  readonly y: number;
}

/**
 * `run` while a question is open, `gap` between two questions, `break` between segments, `done`
 * once the last question is over. The indices point at the question being answered, or during a
 * gap or a break at the one just finished.
 */
export type ExamPart = 'run' | 'gap' | 'break' | 'done';

export interface ExamState {
  readonly def: string;
  /** The paper's enemy id: the barrage comes from it, and the exam's adenosine is summoned by it. */
  readonly paper: number;
  readonly part: ExamPart;
  readonly segment: number;
  readonly stage: number;
  readonly question: number;
  /** Ticks into the current part. */
  readonly ticks: number;
  /** Ticks of questions since the stage began, which time the bonus. */
  readonly stageTicks: number;
  /** Ticks since the exam began, which cap the cloak. */
  readonly elapsed: number;
  /** Caffeine residue on the boss clock; 0 once the cloak's time is up. */
  readonly residue: number;
  /** oj: the enemy ids of this question's test cases, answered or not. */
  readonly cases: readonly number[];
  /** proof: this question's steps; the first `next` of them are stamped. */
  readonly steps: readonly ProofStep[];
  readonly next: number;
  /** Ticks until the paper raises the next fan. */
  readonly barrage: number;
  /** Frame of the fan's tier-1 telegraph, counted from 1; 0 when none is raised. */
  readonly windup: number;
  /** The bonus case on the floor, its age, how long it stays, and the segment whose tally it counts for. */
  readonly bonus: { readonly id: number; readonly age: number; readonly life: number; readonly segment: number } | null;
  /** The stage's bonus has been offered. */
  readonly bonusShown: boolean;
  readonly tallies: readonly ExamTally[];
}

/** How far from a step's centre the operator's feet may be to stamp it. */
export const STEP_REACH = 20;

const EMPTY_TALLY: ExamTally = { questions: 0, answered: 0, hits: 0, bonusOffered: 0, bonusHit: 0 };

export const questionOf = (def: ExamDef, s: Pick<ExamState, 'segment' | 'stage' | 'question'>): ExamQuestionDef =>
  def.segments[s.segment]!.stages[s.stage]!.questions[s.question]!;

export const sitting = (s: ExamState | undefined): boolean => s !== undefined && s.part !== 'done';

/** What one exam tick hands back to the room. */
export interface ExamTick {
  readonly exam: ExamState;
  /** Every enemy of the room after the tick, in id order. */
  readonly enemies: readonly EnemyState[];
  readonly shots: readonly ShotSpec[];
  /** Set when the exam ends: shots of this owner already in the air are taken away. */
  readonly dropShotsOf?: number;
  readonly rng: RngStreams;
  readonly nextId: number;
  readonly events: readonly DomainEvent[];
}

export interface ExamRoom {
  readonly grid: SolidGrid;
  readonly enemies: readonly EnemyState[];
  readonly rng: RngStreams;
  readonly nextId: number;
}

export class ExamError extends Error {}

/** Feet points at the bottom middle of each free tile, as a Spawn's would be. */
function floorSpots(grid: SolidGrid): Vec[] {
  const out: Vec[] = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const at = { x: (col + 0.5) * TILE, y: row * TILE + 24 };
      if (!bodyOverlapsSolid(grid, ENEMY_BODY, at.x, at.y)) out.push(at);
    }
  }
  return out;
}

const spotCache = new WeakMap<SolidGrid, readonly Vec[]>();

/**
 * `n` free spots, each at least `away` from every point in `keepClear` and `spacing` from the
 * others, drawn from the enemies stream. When the room runs out of such spots the spacing is
 * dropped before the distance from the operator, so a crowded room still gets every case.
 */
function pickSpots(grid: SolidGrid, rng0: RngStreams, n: number, keepClear: readonly { at: Vec; away: number }[], spacing: number): { spots: Vec[]; rng: RngStreams } {
  let all = spotCache.get(grid);
  if (!all) {
    all = floorSpots(grid);
    spotCache.set(grid, all);
  }
  const clear = all.filter((p) => keepClear.every((k) => Math.hypot(p.x - k.at.x, p.y - k.at.y) >= k.away));
  const pool = clear.length > 0 ? clear : all;
  const spots: Vec[] = [];
  let rng = rng0;
  for (let i = 0; i < n; i++) {
    const spaced = pool.filter((p) => spots.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= spacing));
    const from = spaced.length > 0 ? spaced : pool;
    let k: number;
    [k, rng] = drawInt(rng, 'enemies', from.length);
    spots.push(from[k]!);
  }
  return { spots, rng };
}

const byId = (es: readonly EnemyState[]): EnemyState[] => [...es].sort((a, b) => a.id - b.id);

interface Work {
  exam: ExamState;
  enemies: EnemyState[];
  shots: ShotSpec[];
  rng: RngStreams;
  nextId: number;
  events: DomainEvent[];
  dropShotsOf?: number;
}

function paperOf(w: Work): EnemyState {
  const p = w.enemies.find((e) => e.id === w.exam.paper);
  if (!p) throw new ExamError(`exam ${w.exam.def}: the paper (#${w.exam.paper}) has left the room`);
  return p;
}

function spawnDrifting(w: Work, def: Enemy, at: Vec, speed: number): number {
  let a: number;
  [a, w.rng] = drawFloat(w.rng, 'enemies');
  const angle = a * 2 * Math.PI;
  const id = w.nextId++;
  w.enemies.push(enemyFrom(def, id, at.x, at.y, 0, { summoner: w.exam.paper, drift: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed } }));
  return id;
}

/** Opens the question the indices point at: its test cases drift in, or its steps are laid out. */
function begin(def: ExamDef, w: Work, grid: SolidGrid, op: Vec): void {
  const q = questionOf(def, w.exam);
  const seg = def.segments[w.exam.segment]!;
  const paper = paperOf(w);
  const near = { at: { x: paper.x, y: paper.y }, away: 2 * TILE };
  let cases: number[] = [];
  let steps: ProofStep[] = [];
  if (seg.kind === 'oj') {
    const picked = pickSpots(grid, w.rng, q.cases, [{ at: op, away: 4 * TILE }, near], 1.5 * TILE);
    w.rng = picked.rng;
    cases = picked.spots.map((at) => spawnDrifting(w, def.caseEnemy, at, q.speed));
  } else {
    const picked = pickSpots(grid, w.rng, q.steps, [{ at: op, away: 2 * TILE }, near], 3 * TILE);
    w.rng = picked.rng;
    // Tile centres, where the operator stands to stamp; the feet points are the bottom middle.
    steps = picked.spots.map((at, order) => ({ order, x: at.x, y: at.y - 8 }));
  }
  w.exam = {
    ...w.exam, part: 'run', ticks: 0, cases, steps, next: 0,
    barrage: def.segments[w.exam.segment]!.stages[w.exam.stage]!.barrage.everyTicks, windup: 0,
  };
  w.events.push({ type: 'examQuestion', segment: w.exam.segment, kind: seg.kind, question: q.id });
}

export interface ExamSetup extends ExamRoom {
  /** Where the operator stands as the exam begins. */
  readonly op: Vec;
  /** Caffeine residue as the forecast closes. */
  readonly residue: number;
  readonly sleepDebt: number;
}

/** Adenosine at the start of the fight: perDebtHour per hour of sleep debt, at most max (design doc 8.9). */
export const adenosineFor = (def: ExamDef, sleepDebt: number): number =>
  Math.min(def.adenosine.max, Math.round(def.adenosine.perDebtHour * Math.max(0, sleepDebt)));

/**
 * The exam begins: adenosine for the night's sleep debt is summoned away from the operator, and
 * the first question opens. The room must hold the paper.
 */
export function startExam(def: ExamDef, setup: ExamSetup): ExamTick {
  const paper = setup.enemies.find((e) => e.type === def.paper.id && e.phase !== 'closed');
  if (!paper) throw new ExamError(`exam ${def.id}: the room has no ${def.paper.id} to sit it with`);
  const w: Work = {
    exam: {
      def: def.id, paper: paper.id, part: 'run', segment: 0, stage: 0, question: 0, ticks: 0, stageTicks: 0, elapsed: 0,
      residue: setup.residue, cases: [], steps: [], next: 0, barrage: 0, windup: 0, bonus: null, bonusShown: false,
      tallies: def.segments.map(() => EMPTY_TALLY),
    },
    enemies: [...setup.enemies], shots: [], rng: setup.rng, nextId: setup.nextId, events: [],
  };
  const n = adenosineFor(def, setup.sleepDebt);
  const picked = pickSpots(setup.grid, w.rng, n, [{ at: setup.op, away: 5 * TILE }], 2 * TILE);
  w.rng = picked.rng;
  for (const at of picked.spots) w.enemies.push(enemyFrom(def.adenosine.enemy, w.nextId++, at.x, at.y, 0, { summoner: paper.id }));
  w.events.push({ type: 'examStarted', exam: def.id, adenosine: n });
  begin(def, w, setup.grid, setup.op);
  return out(w);
}

const out = (w: Work): ExamTick => ({
  exam: w.exam, enemies: byId(w.enemies), shots: w.shots, rng: w.rng, nextId: w.nextId, events: w.events,
  ...(w.dropShotsOf !== undefined ? { dropShotsOf: w.dropShotsOf } : {}),
});

function tally(w: Work, change: (t: ExamTally) => ExamTally, segment = w.exam.segment): void {
  w.exam = { ...w.exam, tallies: w.exam.tallies.map((t, i) => (i === segment ? change(t) : t)) };
}

/** The share of the open question answered right now: cases closed, or steps stamped. */
function shareAnswered(def: ExamDef, w: Work): number {
  const q = questionOf(def, w.exam);
  if (q.steps > 0) return w.exam.next / q.steps;
  const closed = w.exam.cases.filter((id) => w.enemies.find((e) => e.id === id)?.phase === 'closed').length;
  return closed / q.cases;
}

/** Ends the open question with the share answered, and takes its cases and steps off the floor. */
function close(def: ExamDef, w: Work, share: number, how: 'solved' | 'time' | 'stacks'): void {
  const q = questionOf(def, w.exam);
  tally(w, (t) => ({ ...t, questions: t.questions + 1, answered: t.answered + share }));
  const gone = new Set(w.exam.cases);
  w.enemies = w.enemies.filter((e) => !gone.has(e.id));
  w.exam = { ...w.exam, part: 'gap', ticks: 0, cases: [], steps: [], next: 0, windup: 0 };
  w.events.push({ type: 'examAnswered', segment: w.exam.segment, question: q.id, share, how });
  const seg = def.segments[w.exam.segment]!;
  const lastQuestion = w.exam.question + 1 >= seg.stages[w.exam.stage]!.questions.length;
  const lastStage = w.exam.stage + 1 >= seg.stages.length;
  // A stage's bonus goes with the stage, so an unanswered one never runs into the next stage or segment.
  const bonus = w.exam.bonus;
  if (lastQuestion && bonus) {
    w.enemies = w.enemies.filter((e) => e.id !== bonus.id);
    w.exam = { ...w.exam, bonus: null };
  }
  if (!lastQuestion || !lastStage) return;
  if (w.exam.segment + 1 < def.segments.length) {
    w.exam = { ...w.exam, part: 'break' };
    w.events.push({ type: 'examBreak', segment: w.exam.segment + 1, kind: def.segments[w.exam.segment + 1]!.kind });
    return;
  }
  finish(def, w);
}

/**
 * The last question is over. Test cases, the bonus and the paper's shots go; the exam's adenosine
 * goes too, except what clings to the operator, which is no longer the paper's: only sleep clears
 * a stack (design doc 5.5).
 */
function finish(def: ExamDef, w: Work): void {
  const bonus = w.exam.bonus?.id;
  w.enemies = w.enemies
    .filter((e) => e.id !== bonus && (e.summoner !== w.exam.paper || e.phase === 'attached'))
    .map((e) => {
      if (e.summoner !== w.exam.paper) return e;
      const { summoner: _, ...own } = e;
      return own;
    });
  w.dropShotsOf = w.exam.paper;
  w.exam = { ...w.exam, part: 'done', ticks: 0, bonus: null, windup: 0, residue: 0 };
  w.events.push({ type: 'examFinished', exam: def.id, tallies: w.exam.tallies });
}

/** The fan of a raised telegraph, aimed where the operator stands at release. */
function fan(w: Work, b: ExamBarrageDef, target: Vec): void {
  const p = paperOf(w);
  const oy = p.y - 8;
  const base = Math.atan2(target.y - 4 - oy, target.x - p.x);
  for (let i = 0; i < b.shots; i++) {
    const a = base + (i - (b.shots - 1) / 2) * b.spreadRad;
    w.shots.push({
      owner: p.id, kind: 'sheet', x: p.x, y: oy, vx: Math.cos(a) * b.shotSpeed, vy: Math.sin(a) * b.shotSpeed,
      ticksLeft: b.shotTicks, halves: 1, half: 3,
    });
  }
}

/** The nearest unstamped step within reach of the feet, or undefined; the interact key stamps it, and the HUD prompts for it. */
export function stepAt(s: Pick<ExamState, 'steps' | 'next'>, feet: Vec): ProofStep | undefined {
  let best: { p: ProofStep; d: number } | undefined;
  for (const p of s.steps) {
    if (p.order < s.next) continue;
    const d = Math.hypot(p.x - feet.x, p.y - feet.y);
    if (d <= STEP_REACH && (!best || d < best.d)) best = { p, d };
  }
  return best?.p;
}

export interface ExamStepIn extends ExamRoom {
  readonly exam: ExamState;
  readonly operator: OperatorState;
  readonly interact: boolean;
  /** The room's events of this tick, after hits: what the exam counts. */
  readonly happened: readonly DomainEvent[];
}

/**
 * One tick of the exam, after the room's own step: it counts what the room reported (hits taken,
 * cases and the bonus answered, a stack failure), stamps proof steps, runs the barrage and the
 * clock of the open question or pause, and moves on to the next one.
 */
export function stepExam(def: ExamDef, input: ExamStepIn): ExamTick {
  const w: Work = { exam: input.exam, enemies: [...input.enemies], shots: [], rng: input.rng, nextId: input.nextId, events: [] };
  if (w.exam.part === 'done') return out(w);
  const op = input.operator;
  const feet = { x: op.x, y: op.y };
  const elapsed = w.exam.elapsed + 1;
  // The cloak lasts at most cloakTicks, whatever the residue left (design doc 8.9).
  w.exam = { ...w.exam, elapsed, residue: elapsed >= def.cloakTicks ? 0 : w.exam.residue * def.decayPerTick };

  let stacked = false;
  for (const e of input.happened) {
    if (e.type === 'examHit') tally(w, (t) => ({ ...t, hits: t.hits + 1 }));
    else if (e.type === 'caseClosed' && e.target === w.exam.bonus?.id) tally(w, (t) => ({ ...t, bonusHit: t.bonusHit + 1 }), w.exam.bonus.segment);
    else if (e.type === 'examStacked') stacked = true;
  }

  // The bonus leaves when its time is up, answered or not.
  const bonus = w.exam.bonus;
  if (bonus) {
    const age = bonus.age + 1;
    if (age >= bonus.life) {
      w.enemies = w.enemies.filter((e) => e.id !== bonus.id);
      w.exam = { ...w.exam, bonus: null };
    } else w.exam = { ...w.exam, bonus: { ...bonus, age } };
  }

  if (w.exam.part === 'gap' || w.exam.part === 'break') {
    const t = w.exam.ticks + 1;
    if (t < (w.exam.part === 'gap' ? def.gapTicks : def.breakTicks)) {
      w.exam = { ...w.exam, ticks: t };
      return out(w);
    }
    const seg = def.segments[w.exam.segment]!;
    if (w.exam.part === 'break') w.exam = { ...w.exam, segment: w.exam.segment + 1, stage: 0, question: 0, stageTicks: 0, bonusShown: false };
    else if (w.exam.question + 1 < seg.stages[w.exam.stage]!.questions.length) w.exam = { ...w.exam, question: w.exam.question + 1 };
    else w.exam = { ...w.exam, stage: w.exam.stage + 1, question: 0, stageTicks: 0, bonusShown: false };
    begin(def, w, input.grid, feet);
    return out(w);
  }

  // A run: the question is open.
  if (stacked) {
    close(def, w, 0, 'stacks');
    return out(w);
  }
  const q = questionOf(def, w.exam);
  if (q.steps > 0 && input.interact && op.action.kind === 'free') {
    const step = stepAt(w.exam, feet);
    if (step) {
      const ok = step.order === w.exam.next;
      w.exam = { ...w.exam, next: ok ? w.exam.next + 1 : 0 };
      w.events.push({ type: 'proofStamped', order: step.order, ok, stamped: w.exam.next });
    }
  }
  const share = shareAnswered(def, w);
  if (share >= 1) {
    close(def, w, 1, 'solved');
    return out(w);
  }

  const stage = def.segments[w.exam.segment]!.stages[w.exam.stage]!;
  const t = w.exam.ticks + 1;
  const stageTicks = w.exam.stageTicks + 1;
  w.exam = { ...w.exam, ticks: t, stageTicks };
  // Only during the stage's first question: one answered before the bonus time offers none (see examResult).
  if (stage.bonus && !w.exam.bonusShown && w.exam.question === 0 && stageTicks >= stage.bonus.atTicks) {
    const picked = pickSpots(input.grid, w.rng, 1, [{ at: feet, away: 4 * TILE }], 0);
    w.rng = picked.rng;
    const id = spawnDrifting(w, def.bonusEnemy, picked.spots[0]!, stage.bonus.speed);
    w.exam = { ...w.exam, bonus: { id, age: 0, life: stage.bonus.ticks, segment: w.exam.segment }, bonusShown: true };
    tally(w, (x) => ({ ...x, bonusOffered: x.bonusOffered + 1 }));
    w.events.push({ type: 'bonusShown', target: id });
  }

  // The barrage: a tier-1 telegraph on the paper, then the fan.
  if (w.exam.windup > 0) {
    const frame = w.exam.windup + 1;
    if (frame > TELEGRAPH.tier1Ticks) {
      fan(w, stage.barrage, feet);
      w.exam = { ...w.exam, windup: 0 };
    } else w.exam = { ...w.exam, windup: frame };
  } else if (w.exam.barrage <= 1) {
    w.exam = { ...w.exam, windup: 1, barrage: stage.barrage.everyTicks };
    w.events.push({ type: 'telegraph', source: w.exam.paper, tier: 1, move: 'barrage' });
  } else w.exam = { ...w.exam, barrage: w.exam.barrage - 1 };

  if (t >= q.ticks) close(def, w, share, 'time');
  return out(w);
}
