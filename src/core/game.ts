import { boxAt, centeredBox, overlaps } from './collision/boxes.ts';
import { isSolid } from './collision/grid.ts';
import { enemyHurtbox, isHittable, stepEnemy, strikeBox, type EnemyState } from './combat/actors.ts';
import type { EnemyTable } from './combat/enemies.ts';
import { BASE_HALVES, DODGE, ENEMY_HIT_FREEZE, HURT, STAPLER } from './combat/frames.ts';
import type { Vec } from './combat/movement.ts';
import {
  bufferInput, hurtOperator, inDodgeIframes, isInvincible, newOperator, OPERATOR_HURT, stepOperator, unit,
  type OperatorState, type TickInput,
} from './combat/operator.ts';
import { seedStreams, type RngStreams } from './rng.ts';
import type { EnteredRoom } from './rooms/entry.ts';
import { playerStart } from './rooms/tiled.ts';
import { TICK_HZ, TILE } from './time.ts';

export { NO_INPUT, OPERATOR_BODY, OPERATOR_HURT, type OperatorAction, type OperatorState, type TickInput } from './combat/operator.ts';
export type { EnemyPhase, EnemyState } from './combat/actors.ts';

export interface Projectile {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly ticksLeft: number;
}

export interface GameState {
  readonly tick: number;
  readonly rng: RngStreams;
  readonly room: EnteredRoom;
  readonly operator: OperatorState;
  readonly enemies: readonly EnemyState[];
  readonly projectiles: readonly Projectile[];
  readonly nextId: number;
  /** Whole-fight hit-stop: while above 0 only input buffering and the tick counter advance. */
  readonly freeze: number;
}

/**
 * Something that happened this tick, with logical ids and reasons only; the view maps each
 * type to feedback through content/feedback.json.
 */
export type DomainEvent =
  | { readonly type: 'bumpWall'; readonly axis: 'x' | 'y' }
  | { readonly type: 'fire'; readonly weapon: 'stapler' }
  | { readonly type: 'dodge' }
  | { readonly type: 'perfectDodge'; readonly source: number }
  | { readonly type: 'telegraph'; readonly source: number; readonly tier: 1 }
  | { readonly type: 'hit'; readonly target: number; readonly enemy: string; readonly hpLeft: number }
  | { readonly type: 'caseClosed'; readonly target: number; readonly enemy: string }
  | { readonly type: 'dispersed'; readonly target: number; readonly enemy: string }
  | { readonly type: 'reformed'; readonly target: number; readonly enemy: string }
  | { readonly type: 'respawned'; readonly target: number; readonly enemy: string }
  | { readonly type: 'immuneBounce'; readonly target: number; readonly enemy: string; readonly solution: string }
  | { readonly type: 'heartLost'; readonly halves: number; readonly cause: string }
  | { readonly type: 'freeze'; readonly frames: number }
  | { readonly type: 'forcedLeave' };

export interface StepResult {
  readonly state: GameState;
  readonly events: readonly DomainEvent[];
}

export class GameSetupError extends Error {}

/** Spawn copies sit side by side so a count of 3 does not stack three sprites on one point. */
const COPY_SPACING = 20;
const STAPLE_HALF = 2;
const STAPLE_LIFE = Math.ceil(STAPLER.rangePx / STAPLER.speed);

/**
 * Enemies come from the Spawns enterRoom kept, so inactive variants and failed `when`s never
 * reach here. Ids come from the shared counter, taken in object id order, so no Spawn count
 * can make two enemies share an id.
 */
function spawnEnemies(room: EnteredRoom, table: EnemyTable, firstId: number): { enemies: EnemyState[]; nextId: number } {
  const out: EnemyState[] = [];
  let nextId = firstId;
  for (const o of [...room.objects].sort((a, b) => a.id - b.id)) {
    if (o.kind !== 'Spawn') continue;
    const type = String(o.props['enemyType']);
    const def = table.enemies.get(type);
    if (!def) throw new GameSetupError(`${room.id}: Spawn #${o.id} uses enemy "${type}", which content/enemies.json does not define`);
    if (def.category === 'defeatable' && def.performance === undefined) {
      throw new GameSetupError(`${room.id}: enemy "${type}" has no performance in content/enemies.json, so it cannot be fought yet`);
    }
    const count = Number(o.props['count']);
    for (let i = 0; i < count; i++) {
      const x = o.x + (i - (count - 1) / 2) * COPY_SPACING;
      const hp = def.performance ?? 0;
      out.push({
        id: nextId++, type, category: def.category,
        ...(def.archetype ? { archetype: def.archetype } : {}),
        ...(def.solution ? { solution: def.solution } : {}),
        x, y: o.y, homeX: x, homeY: o.y, hp, maxHp: hp, phase: 'idle', phaseTicks: 0, frozen: 0,
        strikeDir: { x: 0, y: 1 }, strikeSpent: false,
        respawnTicks: Math.round(Number(o.props['respawnSeconds']) * TICK_HZ),
      });
    }
  }
  return { enemies: out, nextId };
}

/**
 * The enemy table is required: rooms with Spawns cannot start without it. The room must have
 * gone through enterRoom, so a caller cannot forget the tags and silently get the base room.
 */
export function createGame(room: EnteredRoom, seed: number, table: EnemyTable): GameState {
  const start = playerStart(room);
  const spawned = spawnEnemies(room, table, 1);
  return {
    tick: 0,
    rng: seedStreams(seed),
    room,
    operator: newOperator(start.x, start.y, BASE_HALVES),
    enemies: spawned.enemies,
    projectiles: [],
    nextId: spawned.nextId,
    freeze: 0,
  };
}

const center = (e: EnemyState): Vec => ({ x: e.x, y: e.y - 8 });

/** Soft lock (design doc 5.2): the nearest defeatable target within 25 degrees of aim and 7 tiles. */
function aimFrom(op: OperatorState, origin: Vec, enemies: readonly EnemyState[]): Vec {
  const cos = Math.cos((STAPLER.lockHalfAngleDeg * Math.PI) / 180);
  let best: { e: EnemyState; d: number } | undefined;
  for (const e of enemies) {
    if (e.category !== 'defeatable' || !isHittable(e)) continue;
    const c = center(e);
    const dx = c.x - origin.x;
    const dy = c.y - origin.y;
    const d = Math.hypot(dx, dy);
    if (d === 0 || d > STAPLER.lockRangePx) continue;
    if ((dx * op.aim.x + dy * op.aim.y) / d < cos) continue;
    if (!best || d < best.d) best = { e, d };
  }
  if (!best) return op.aim;
  const c = center(best.e);
  return unit({ x: c.x - origin.x, y: c.y - origin.y });
}

/** Back to the last checkpoint: room enemies reset, nothing is taken away (design doc 5.6). */
function forcedLeave(state: GameState): GameState {
  const start = playerStart(state.room);
  return {
    ...state,
    operator: newOperator(start.x, start.y, state.operator.maxHalves),
    enemies: state.enemies.map((e) => ({ ...e, x: e.homeX, y: e.homeY, hp: e.maxHp, phase: 'idle' as const, phaseTicks: 0, frozen: 0 })),
    projectiles: [],
    freeze: 0,
  };
}

export function step(state: GameState, input: TickInput): StepResult {
  const now = state.tick;
  const events: DomainEvent[] = [];

  if (state.freeze > 0) {
    return { state: { ...state, tick: now + 1, freeze: state.freeze - 1, operator: bufferInput(state.operator, input, now) }, events };
  }

  const grid = state.room.grid;
  const s = stepOperator(grid, state.operator, input, now);
  let op = s.op;
  if (s.blockedX) events.push({ type: 'bumpWall', axis: 'x' });
  if (s.blockedY) events.push({ type: 'bumpWall', axis: 'y' });
  if (s.dodged) events.push({ type: 'dodge' });

  // Ids only ever grow, and every loop below runs in id order, so results never depend on
  // where an entity sits in its array.
  let nextId = state.nextId;
  const projectiles: Projectile[] = [...state.projectiles];
  if (s.fired) {
    const origin = { x: op.x, y: op.y - 4 };
    const dir = aimFrom(op, origin, state.enemies);
    projectiles.push({ id: nextId++, x: origin.x, y: origin.y, vx: dir.x * STAPLER.speed, vy: dir.y * STAPLER.speed, ticksLeft: STAPLE_LIFE });
    events.push({ type: 'fire', weapon: 'stapler' });
  }

  const enemies = new Map<number, EnemyState>();
  for (const e of [...state.enemies].sort((a, b) => a.id - b.id)) {
    const r = stepEnemy(grid, e, { x: op.x, y: op.y });
    enemies.set(e.id, r.enemy);
    if (r.telegraph) events.push({ type: 'telegraph', source: e.id, tier: 1 });
    if (r.reformed) events.push({ type: 'reformed', target: e.id, enemy: e.type });
    if (r.respawned) events.push({ type: 'respawned', target: e.id, enemy: e.type });
  }

  // Staples: move, stop at walls, hit the lowest-id hittable enemy they overlap.
  const flying: Projectile[] = [];
  for (const p0 of projectiles.sort((a, b) => a.id - b.id)) {
    const p = { ...p0, x: p0.x + p0.vx, y: p0.y + p0.vy, ticksLeft: p0.ticksLeft - 1 };
    if (p.ticksLeft < 0 || isSolid(grid, Math.floor(p.x / TILE), Math.floor(p.y / TILE))) continue;
    const box = centeredBox(p.x, p.y, STAPLE_HALF, STAPLE_HALF);
    const target = [...enemies.values()].find((e) => isHittable(e) && overlaps(box, enemyHurtbox(e)));
    if (!target) { flying.push(p); continue; }
    if (target.category === 'immune') {
      // No hit-stop and no damage: the flag decides, not a large health pool (design doc 5.1, 5.5).
      events.push({ type: 'immuneBounce', target: target.id, enemy: target.type, solution: target.solution ?? '' });
    } else if (target.category === 'reforming') {
      enemies.set(target.id, { ...target, phase: 'dispersed', phaseTicks: 0, frozen: 0 });
      events.push({ type: 'dispersed', target: target.id, enemy: target.type });
    } else {
      const hp = target.hp - STAPLER.damage;
      if (hp <= 0) {
        enemies.set(target.id, { ...target, hp: 0, phase: 'closed', phaseTicks: 0, frozen: 0 });
        events.push({ type: 'caseClosed', target: target.id, enemy: target.type });
      } else {
        enemies.set(target.id, { ...target, hp, frozen: ENEMY_HIT_FREEZE });
        events.push({ type: 'hit', target: target.id, enemy: target.type, hpLeft: hp });
      }
    }
  }

  // Strikes against the operator: at most one lands per tick, lowest id first.
  let freeze = 0;
  const hurt = boxAt(OPERATOR_HURT, op.x, op.y);
  for (const e of [...enemies.values()]) {
    if (e.phase !== 'strike' || e.strikeSpent || e.frozen > 0 || !overlaps(strikeBox(e), hurt)) continue;
    const a = op.action;
    if (inDodgeIframes(a)) {
      enemies.set(e.id, { ...e, strikeSpent: true });
      if (a.frame <= DODGE.perfectLast && !a.perfect) {
        op = { ...op, action: { ...a, perfect: true } };
        events.push({ type: 'perfectDodge', source: e.id });
      }
      continue;
    }
    if (isInvincible(op, now) || freeze > 0) continue;
    enemies.set(e.id, { ...e, strikeSpent: true });
    op = hurtOperator(op, 1, { x: e.x, y: e.y }, now);
    freeze = HURT.freezeTicks;
    events.push({ type: 'heartLost', halves: 1, cause: e.type });
  }

  const next: GameState = {
    ...state, tick: now + 1, operator: op, enemies: [...enemies.values()], projectiles: flying, nextId, freeze,
  };
  // A forced leave clears the freeze, so the freeze event is only emitted when it will happen.
  if (op.halves <= 0) {
    events.push({ type: 'forcedLeave' });
    return { state: forcedLeave(next), events };
  }
  if (freeze > 0) events.push({ type: 'freeze', frames: freeze });
  return { state: next, events };
}

export const selectOperator = (s: GameState): Readonly<OperatorState> => s.operator;
export const selectEnemies = (s: GameState): readonly Readonly<EnemyState>[] => s.enemies;
export const selectProjectiles = (s: GameState): readonly Readonly<Projectile>[] => s.projectiles;
export const selectHearts = (s: GameState): { readonly halves: number; readonly maxHalves: number } =>
  ({ halves: s.operator.halves, maxHalves: s.operator.maxHalves });
export const selectTick = (s: GameState): number => s.tick;
export const selectActiveVariants = (s: GameState): readonly string[] => s.room.active;
export const selectFrozen = (s: GameState): boolean => s.freeze > 0;
