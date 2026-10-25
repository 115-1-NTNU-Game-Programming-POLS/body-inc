import { boxAt, centeredBox, overlaps } from './collision/boxes.ts';
import { isSolid } from './collision/grid.ts';
import { enemyCenter, enemyHurtbox, isHittable, isMelee, stepEnemy, strikeBox, type EnemyState } from './combat/actors.ts';
import { newBossState, type BossDef, type BossTable } from './combat/bosses/boss.ts';
import { proposalOpen, stepCaffeine } from './combat/bosses/caffeine.ts';
import type { Enemy } from './content/generated.ts';
import type { EnemyTable } from './combat/enemies.ts';
import { BASE_HALVES, BOSS, CLING, DODGE, ENEMY_HIT_FREEZE, GAUGE, HURT, STAMP, STAPLER } from './combat/frames.ts';
import { circleTouchesBox, shotBox, zoneContinues, zoneLive, type Shot, type ShotSpec, type Zone, type ZoneSpec } from './combat/hazards.ts';
import type { Vec } from './combat/movement.ts';
import {
  bufferInput, gaugeFull, hurtOperator, inDodgeIframes, isInvincible, newOperator, OPERATOR_BODY, OPERATOR_HURT, stepOperator, unit,
  type OperatorState, type TickInput,
} from './combat/operator.ts';
import { advance, startClock, type RuleClock } from './clock.ts';
import { seedStreams, type RngStreams } from './rng.ts';
import type { EnteredRoom } from './rooms/entry.ts';
import { reachableObject, touchedObjects } from './rooms/interact.ts';
import { playerStart, type RoomObject } from './rooms/tiled.ts';
import { TICK_HZ, TILE } from './time.ts';

export { NO_INPUT, OPERATOR_BODY, OPERATOR_HURT, type OperatorAction, type OperatorState, type TickInput } from './combat/operator.ts';
export type { EnemyPhase, EnemyState } from './combat/actors.ts';
export type { Shot, Zone } from './combat/hazards.ts';

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
  /** Outer-layer clock; combat moves it only through rules such as the forced nap. */
  readonly clock: RuleClock;
  /** Chairman's spirit P, fixed at room entry from the tags (design doc 5.4). */
  readonly p: number;
  readonly room: EnteredRoom;
  readonly operator: OperatorState;
  readonly enemies: readonly EnemyState[];
  /** The operator's staples. */
  readonly projectiles: readonly Projectile[];
  /** Thrown enemy attacks: flyer sheets, coffee cups. */
  readonly shots: readonly Shot[];
  /** Tier-2 and tier-3 areas, from their telegraph to their last live tick. */
  readonly zones: readonly Zone[];
  /** Definitions of the bosses in this room, by boss id; kept in state so a replay needs nothing else. */
  readonly bosses: Readonly<Record<string, BossDef>>;
  readonly nextId: number;
  /** Whole-fight hit-stop: while above 0 only input buffering and the tick counter advance. */
  readonly freeze: number;
  /** Doors and triggers the operator stood on last tick, so each fires once when stepped onto. */
  readonly touching: readonly number[];
  /** Clinging stacks brought in from another room; they belong to no enemy here and only sleep clears them. */
  readonly carried: number;
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
  | { readonly type: 'telegraph'; readonly source: number; readonly tier: 1 | 2 | 3; readonly move?: string }
  | { readonly type: 'hit'; readonly target: number; readonly enemy: string; readonly hpLeft: number }
  | { readonly type: 'caseClosed'; readonly target: number; readonly enemy: string }
  | { readonly type: 'dispersed'; readonly target: number; readonly enemy: string }
  | { readonly type: 'reformed'; readonly target: number; readonly enemy: string }
  | { readonly type: 'respawned'; readonly target: number; readonly enemy: string }
  | { readonly type: 'immuneBounce'; readonly target: number; readonly enemy: string; readonly solution: string }
  | { readonly type: 'heartLost'; readonly halves: number; readonly cause: string }
  | { readonly type: 'freeze'; readonly frames: number }
  | { readonly type: 'forcedLeave' }
  | { readonly type: 'gaugeFull' }
  | { readonly type: 'stampRaised' }
  | { readonly type: 'stampLanded'; readonly x: number; readonly y: number; readonly radius: number }
  | { readonly type: 'stampVoid'; readonly target: number; readonly enemy: string; readonly solution: string }
  | { readonly type: 'clung'; readonly target: number; readonly enemy: string; readonly stacks: number }
  | { readonly type: 'forcedNap'; readonly minutes: number }
  | { readonly type: 'bossStage'; readonly target: number; readonly stage: 2 | 3 }
  | { readonly type: 'bossDrink'; readonly target: number; readonly residue: number; readonly cups: number }
  | { readonly type: 'bossSummon'; readonly target: number; readonly count: number }
  | { readonly type: 'powerCut'; readonly target: number; readonly seconds: number }
  | { readonly type: 'proposalRejected'; readonly target: number }
  | { readonly type: 'bossDefeated'; readonly target: number; readonly enemy: string }
  /** The operator stepped onto an unlocked door; the chapter decides where it leads. */
  | { readonly type: 'doorEntered'; readonly object: number; readonly door: string; readonly socket: string }
  | { readonly type: 'doorLocked'; readonly object: number; readonly lock: string }
  | { readonly type: 'triggerEntered'; readonly object: number; readonly trigger: string; readonly eventId: string }
  | { readonly type: 'talk'; readonly object: number; readonly npc: string; readonly dialogueId: string }
  | { readonly type: 'bedUse'; readonly object: number; readonly bedType: string };

export interface StepResult {
  readonly state: GameState;
  readonly events: readonly DomainEvent[];
}

export class GameSetupError extends Error {}

/** Spawn copies sit side by side so a count of 3 does not stack three sprites on one point. */
const COPY_SPACING = 20;
const STAPLE_HALF = 2;
const STAPLE_LIFE = Math.ceil(STAPLER.rangePx / STAPLER.speed);

function enemyFrom(def: Enemy, id: number, x: number, y: number, respawnTicks: number, extra: Partial<EnemyState> = {}): EnemyState {
  const hp = def.performance ?? 0;
  return {
    id, type: def.id, category: def.category,
    ...(def.archetype ? { archetype: def.archetype } : {}),
    ...(def.solution ? { solution: def.solution } : {}),
    x, y, homeX: x, homeY: y, hp, maxHp: hp, phase: 'idle', phaseTicks: 0, frozen: 0,
    strikeDir: { x: 0, y: 1 }, strikeSpent: false, respawnTicks, clings: def.clings === true,
    ...extra,
  };
}

/**
 * Enemies come from the Spawns enterRoom kept, so inactive variants and failed `when`s never
 * reach here. Ids come from the shared counter, taken in object id order, so no Spawn count
 * can make two enemies share an id.
 */
function spawnEnemies(room: EnteredRoom, table: EnemyTable, bosses: BossTable | undefined, firstId: number) {
  const out: EnemyState[] = [];
  const used: Record<string, BossDef> = {};
  let nextId = firstId;
  for (const o of [...room.objects].sort((a, b) => a.id - b.id)) {
    if (o.kind !== 'Spawn') continue;
    const type = String(o.props['enemyType']);
    const def = table.enemies.get(type);
    if (!def) throw new GameSetupError(`${room.id}: Spawn #${o.id} uses enemy "${type}", which content/enemies.json does not define`);
    const boss = def.boss === undefined ? undefined : bosses?.get(def.boss);
    if (def.boss !== undefined && !boss) throw new GameSetupError(`${room.id}: enemy "${type}" is a boss, but no definition for "${def.boss}" was given`);
    if (!boss && def.category === 'defeatable' && def.performance === undefined) {
      throw new GameSetupError(`${room.id}: enemy "${type}" has no performance in content/enemies.json, so it cannot be fought yet`);
    }
    const count = Number(o.props['count']);
    for (let i = 0; i < count; i++) {
      const x = o.x + (i - (count - 1) / 2) * COPY_SPACING;
      const respawn = Math.round(Number(o.props['respawnSeconds']) * TICK_HZ);
      if (boss) {
        used[boss.id] = boss;
        out.push(enemyFrom(def, nextId++, x, o.y, 0, { hp: boss.budget, maxHp: boss.budget, boss: newBossState(boss) }));
      } else out.push(enemyFrom(def, nextId++, x, o.y, respawn));
    }
  }
  return { enemies: out, nextId, bosses: used };
}

export interface GameOptions {
  /** From sleepFactor and chairmanSpirit on the entry tags; 1 means fully rested. */
  readonly p?: number;
  readonly clock?: RuleClock;
  /** Starting gauge, e.g. 50 from the early-sleep bonus card (design doc 8.8). */
  readonly gauge?: number;
  /** Needed when the room spawns a boss. */
  readonly bosses?: BossTable;
  /** Where the operator stands instead of the PlayerStart: through a door, or back at a checkpoint. */
  readonly start?: Vec;
  /** Hearts in halves carried in from the previous room; defaults to full. */
  readonly halves?: number;
  /** Clinging stacks carried in, 0 up to one below the forced-nap cap; defaults to none. */
  readonly stacks?: number;
}

/**
 * The enemy table is required: rooms with Spawns cannot start without it. The room must have
 * gone through enterRoom, so a caller cannot forget the tags and silently get the base room.
 */
export function createGame(room: EnteredRoom, seed: number, table: EnemyTable, options: GameOptions = {}): GameState {
  const p = options.p ?? 1;
  const gauge = options.gauge ?? 0;
  if (!(p > 0 && p <= 1)) throw new GameSetupError(`P must be in (0, 1], got ${p}`);
  if (!(gauge >= 0 && gauge <= STAMP.gaugeMax)) throw new GameSetupError(`gauge must be 0 to ${STAMP.gaugeMax}, got ${gauge}`);
  const halves = options.halves ?? BASE_HALVES;
  if (!Number.isInteger(halves) || halves < 1 || halves > BASE_HALVES) throw new GameSetupError(`halves must be a whole number from 1 to ${BASE_HALVES}, got ${halves}`);
  const carried = options.stacks ?? 0;
  if (!Number.isInteger(carried) || carried < 0 || carried >= CLING.maxStacks) {
    throw new GameSetupError(`stacks must be a whole number from 0 to ${CLING.maxStacks - 1}, got ${carried}`);
  }
  const start = options.start ?? playerStart(room);
  const spawned = spawnEnemies(room, table, options.bosses, 1);
  const operator = { ...newOperator(start.x, start.y, BASE_HALVES, gauge), halves, stacks: carried };
  return {
    tick: 0,
    rng: seedStreams(seed),
    clock: options.clock ?? startClock(1, 8),
    p,
    room,
    operator,
    enemies: spawned.enemies,
    projectiles: [],
    shots: [],
    zones: [],
    bosses: spawned.bosses,
    nextId: spawned.nextId,
    freeze: 0,
    // Standing on a door or trigger at the start (a checkpoint return) must not fire it again.
    touching: touchedObjects(room, boxAt(OPERATOR_BODY, operator.x, operator.y)).map((o) => o.id),
    carried,
  };
}

/** Soft lock (design doc 5.2): the nearest defeatable target within 25 degrees of aim and 7 tiles. */
function aimFrom(op: OperatorState, origin: Vec, enemies: readonly EnemyState[]): Vec {
  const cos = Math.cos((STAPLER.lockHalfAngleDeg * Math.PI) / 180);
  let best: { e: EnemyState; d: number } | undefined;
  for (const e of enemies) {
    if (e.category !== 'defeatable' || !isHittable(e)) continue;
    const c = enemyCenter(e);
    const dx = c.x - origin.x;
    const dy = c.y - origin.y;
    const d = Math.hypot(dx, dy);
    if (d === 0 || d > STAPLER.lockRangePx) continue;
    if ((dx * op.aim.x + dy * op.aim.y) / d < cos) continue;
    if (!best || d < best.d) best = { e, d };
  }
  if (!best) return op.aim;
  const c = enemyCenter(best.e);
  return unit({ x: c.x - origin.x, y: c.y - origin.y });
}

/**
 * Back to the last checkpoint: room enemies reset, nothing is taken away (design doc 5.6). The
 * gauge stays, and so do clinging stacks: only sleep clears adenosine, not a retry. A boss
 * starts its fight over, and what it summoned leaves with the attempt unless it clings on; a
 * clinging one is no longer the boss's, so it does not count toward the next attempt's summons.
 */
function forcedLeave(state: GameState): GameState {
  const start = playerStart(state.room);
  const enemies = state.enemies.filter((e) => e.summoner === undefined || e.phase === 'attached').map((e) => {
    if (e.phase === 'attached') {
      if (e.summoner === undefined) return e;
      const { summoner: _, ...own } = e;
      return own;
    }
    const reset: EnemyState = { ...e, x: e.homeX, y: e.homeY, hp: e.maxHp, phase: 'idle', phaseTicks: 0, frozen: 0 };
    return e.boss ? { ...reset, boss: newBossState(state.bosses[e.boss.def]!) } : reset;
  });
  const operator = withStacks(newOperator(start.x, start.y, state.operator.maxHalves, state.operator.gauge), enemies, state.carried);
  return {
    ...state,
    operator,
    enemies,
    projectiles: [],
    shots: [],
    zones: [],
    freeze: 0,
    touching: touchedObjects(state.room, boxAt(OPERATOR_BODY, operator.x, operator.y)).map((o) => o.id),
  };
}

/** A clinging stack goes back to where it spawned and reforms there; nothing is removed. */
const stackHome = (e: EnemyState): EnemyState =>
  e.phase === 'attached' ? { ...e, phase: 'dispersed', phaseTicks: 0, x: e.homeX, y: e.homeY } : e;

/** Sleep clears the stacks, not the adenosine: a nap on a bed does what the forced nap does. */
export function sendStacksHome(state: GameState): GameState {
  const enemies = state.enemies.map(stackHome);
  return { ...state, enemies, carried: 0, operator: withStacks(state.operator, enemies, 0) };
}

const stackCount = (enemies: Iterable<EnemyState>, carried: number): number =>
  carried + [...enemies].filter((e) => e.phase === 'attached').length;

function withStacks(op: OperatorState, enemies: Iterable<EnemyState>, carried: number): OperatorState {
  const stacks = stackCount(enemies, carried);
  return op.stacks === stacks ? op : { ...op, stacks };
}

/** Adds charge times P; rounded so that 125 staples at P = 1 fill the gauge exactly. */
function charge(op: OperatorState, amount: number, p: number, events: DomainEvent[]): OperatorState {
  if (gaugeFull(op)) return op;
  const gauge = Math.min(STAMP.gaugeMax, Math.round((op.gauge + amount * p) * 1e6) / 1e6);
  if (gauge >= STAMP.gaugeMax) events.push({ type: 'gaugeFull' });
  return { ...op, gauge };
}

/**
 * Damage to a defeatable enemy. A boss has no hit-stop, so hits never stretch its telegraphs,
 * and takes 1.5 times damage under review (design doc 5.4).
 */
function damage(e: EnemyState, amount: number, freeze: number, events: DomainEvent[]): EnemyState {
  const factor = e.boss && e.boss.review > 0 ? BOSS.reviewDamageFactor : 1;
  const hp = Math.round((e.hp - amount * factor) * 1e6) / 1e6;
  if (hp <= 0) {
    if (e.boss) {
      events.push({ type: 'bossDefeated', target: e.id, enemy: e.type });
      return { ...e, hp: 0, phase: 'closed', phaseTicks: 0, frozen: 0, boss: { ...e.boss, move: null } };
    }
    events.push({ type: 'caseClosed', target: e.id, enemy: e.type });
    return { ...e, hp: 0, phase: 'closed', phaseTicks: 0, frozen: 0 };
  }
  events.push({ type: 'hit', target: e.id, enemy: e.type, hpLeft: hp });
  return { ...e, hp, frozen: e.boss ? 0 : freeze };
}

function interactionOf(o: RoomObject): DomainEvent {
  return o.kind === 'NPC'
    ? { type: 'talk', object: o.id, npc: String(o.props['npcId']), dialogueId: String(o.props['dialogueId']) }
    : { type: 'bedUse', object: o.id, bedType: String(o.props['bedType']) };
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
  if (s.stampRaised) events.push({ type: 'stampRaised' });

  // Doors and triggers fire on the tick the operator steps onto them, not while standing there.
  const onNow = touchedObjects(state.room, boxAt(OPERATOR_BODY, op.x, op.y));
  const roomEvents: DomainEvent[] = [];
  for (const o of onNow) {
    if (state.touching.includes(o.id)) continue;
    if (o.kind === 'Door') {
      const lock = String(o.props['lock']);
      roomEvents.push(lock === 'none'
        ? { type: 'doorEntered', object: o.id, door: o.name, socket: String(o.props['socket']) }
        : { type: 'doorLocked', object: o.id, lock });
    } else roomEvents.push({ type: 'triggerEntered', object: o.id, trigger: String(o.props['event']), eventId: String(o.props['eventId']) });
  }
  if (input.interactPressed && op.action.kind === 'free') {
    const used = reachableObject(state.room, boxAt(OPERATOR_BODY, op.x, op.y), op);
    if (used) roomEvents.push(interactionOf(used));
  }
  events.push(...roomEvents);

  // Ids only ever grow, and every loop below runs in id order, so results never depend on
  // where an entity sits in its array.
  let nextId = state.nextId;
  let rng = state.rng;
  const projectiles: Projectile[] = [...state.projectiles];
  if (s.fired) {
    const origin = { x: op.x, y: op.y - 4 };
    const dir = aimFrom(op, origin, state.enemies);
    projectiles.push({ id: nextId++, x: origin.x, y: origin.y, vx: dir.x * STAPLER.speed, vy: dir.y * STAPLER.speed, ticksLeft: STAPLE_LIFE });
    events.push({ type: 'fire', weapon: 'stapler' });
  }

  // Zones age before new ones join, so a zone's first tick is its age 1.
  const zones = new Map<number, Zone>(state.zones.map((z) => [z.id, { ...z, age: z.age + 1 }]));
  const newShots: ShotSpec[] = [];
  const newZones: ZoneSpec[] = [];
  const target = { x: op.x, y: op.y };
  const enemies = new Map<number, EnemyState>();
  const ordered = [...state.enemies].sort((a, b) => a.id - b.id);
  for (const e of ordered) {
    if (e.boss && e.phase !== 'closed') {
      const def = state.bosses[e.boss.def]!;
      const summoned = ordered.filter((x) => x.summoner === e.id).length;
      const r = stepCaffeine(e, { grid, def, target, rng, summoned });
      rng = r.rng;
      enemies.set(e.id, r.enemy);
      events.push(...r.events);
      newShots.push(...r.shots);
      newZones.push(...r.zones);
      for (const at of r.summons) {
        const id = nextId++;
        enemies.set(id, enemyFrom(def.summon.enemy, id, at.x, at.y, 0, { summoner: e.id }));
      }
      if (r.powerCut) {
        // The adenosine at his feet piles onto him (design doc 7.4); what clings to the operator stays.
        for (const [id, z] of zones) if (z.owner === e.id) zones.delete(id);
        for (const x of ordered) {
          if (x.summoner === e.id && x.phase === 'idle') enemies.set(x.id, { ...x, phase: 'pinned', phaseTicks: 0, x: r.enemy.x, y: r.enemy.y });
        }
      }
      if (r.powerBack) {
        // They fall off as fluff and reform where they were summoned: the count never drops.
        for (const x of ordered) {
          if (x.summoner === e.id && x.phase === 'pinned') enemies.set(x.id, { ...x, phase: 'dispersed', phaseTicks: 0, x: x.homeX, y: x.homeY });
        }
      }
      continue;
    }
    if (enemies.has(e.id)) continue;
    const r = stepEnemy(grid, e, target);
    enemies.set(e.id, r.enemy);
    newShots.push(...r.shots);
    if (r.telegraph) events.push({ type: 'telegraph', source: e.id, tier: 1 });
    if (r.reformed) events.push({ type: 'reformed', target: e.id, enemy: e.type });
    if (r.respawned) events.push({ type: 'respawned', target: e.id, enemy: e.type });
  }
  for (const z of newZones) zones.set(nextId, { ...z, id: nextId++, age: 1, spent: false });
  let shots: Shot[] = [...state.shots, ...newShots.map((sh) => ({ ...sh, id: nextId++, spent: false }))];
  // Within a tick enemies are only added, never removed, so the sorted ids change only with the size.
  let order: number[] = [];
  const byId = (): EnemyState[] => {
    if (order.length !== enemies.size) order = [...enemies.keys()].sort((a, b) => a - b);
    return order.map((id) => enemies.get(id)!);
  };

  // The stamp covers every hittable enemy whose feet are within the radius of the operator's.
  // Only defeatable ones take damage; on the rest it is void, and the gauge is gone either way.
  if (s.stampLanded) {
    events.push({ type: 'stampLanded', x: op.x, y: op.y, radius: STAMP.radiusPx });
    for (const e of byId()) {
      if (!isHittable(e) || Math.hypot(e.x - op.x, e.y - op.y) > STAMP.radiusPx) continue;
      if (e.category !== 'defeatable') {
        events.push({ type: 'stampVoid', target: e.id, enemy: e.type, solution: e.solution ?? '' });
        continue;
      }
      if (!e.boss) {
        enemies.set(e.id, damage(e, STAMP.damage, STAMP.hitFreeze, events));
        continue;
      }
      const def = state.bosses[e.boss.def]!;
      const rejected = proposalOpen(def, e.boss);
      let hit = damage(e, BOSS.stampDamage, 0, events);
      if (rejected && hit.phase !== 'closed') {
        // The proposal is stamped: the move is cancelled and the boss sits under review.
        for (const [id, z] of zones) if (z.owner === e.id) zones.delete(id);
        hit = { ...hit, boss: { ...hit.boss!, move: null, review: BOSS.reviewTicks } };
        events.push({ type: 'proposalRejected', target: e.id });
      }
      enemies.set(e.id, hit);
    }
  }

  // Staples: move, stop at walls, hit the lowest-id hittable enemy they overlap.
  const flying: Projectile[] = [];
  for (const p0 of projectiles.sort((a, b) => a.id - b.id)) {
    const p = { ...p0, x: p0.x + p0.vx, y: p0.y + p0.vy, ticksLeft: p0.ticksLeft - 1 };
    if (p.ticksLeft < 0 || isSolid(grid, Math.floor(p.x / TILE), Math.floor(p.y / TILE))) continue;
    const box = centeredBox(p.x, p.y, STAPLE_HALF, STAPLE_HALF);
    const target = byId().find((e) => isHittable(e) && overlaps(box, enemyHurtbox(e)));
    if (!target) { flying.push(p); continue; }
    if (target.category === 'immune') {
      // No hit-stop and no damage: the flag decides, not a large health pool (design doc 5.1, 5.5).
      events.push({ type: 'immuneBounce', target: target.id, enemy: target.type, solution: target.solution ?? '' });
    } else if (target.category === 'reforming') {
      enemies.set(target.id, { ...target, phase: 'dispersed', phaseTicks: 0, frozen: 0 });
      events.push({ type: 'dispersed', target: target.id, enemy: target.type });
      op = charge(op, GAUGE.staple, state.p, events);
    } else {
      op = charge(op, GAUGE.staple, state.p, events);
      enemies.set(target.id, damage(target, STAPLER.damage, ENEMY_HIT_FREEZE, events));
    }
  }

  // A closed boss stops attacking at once: its shots and areas go with it. A closed ordinary
  // enemy's shot already in the air still flies.
  const closed = new Set(byId().filter((e) => e.boss && e.phase === 'closed').map((e) => e.id));
  for (const [id, z] of zones) if (closed.has(z.owner)) zones.delete(id);
  shots = shots.filter((sh) => !closed.has(sh.owner));

  // Hits on the operator: at most one lands per tick. Strikes, then shots, then areas, each in
  // id order. Dodge i-frames absorb any of them; the first six i-frames make it perfect.
  let freeze = 0;
  const hurt = boxAt(OPERATOR_HURT, op.x, op.y);
  const absorb = (source: number, halves: number, from: Vec, cause: string): 'dodged' | 'ignored' | 'hit' => {
    const a = op.action;
    if (inDodgeIframes(a)) {
      if (a.frame <= DODGE.perfectLast && !a.perfect) {
        op = { ...op, action: { ...a, perfect: true } };
        events.push({ type: 'perfectDodge', source });
        op = charge(op, GAUGE.perfectDodge, state.p, events);
      }
      return 'dodged';
    }
    if (isInvincible(op, now) || freeze > 0) return 'ignored';
    op = hurtOperator(op, halves, from, now);
    freeze = HURT.freezeTicks;
    events.push({ type: 'heartLost', halves, cause });
    return 'hit';
  };
  const typeOf = (id: number) => enemies.get(id)?.type ?? 'unknown';

  for (const e of byId()) {
    if (!isMelee(e) || e.phase !== 'strike' || e.strikeSpent || e.frozen > 0 || !overlaps(strikeBox(e), hurt)) continue;
    if (absorb(e.id, 1, { x: e.x, y: e.y }, e.type) !== 'ignored') enemies.set(e.id, { ...e, strikeSpent: true });
  }

  const movedShots: Shot[] = [];
  for (const sh0 of shots.sort((a, b) => a.id - b.id)) {
    const sh = { ...sh0, x: sh0.x + sh0.vx, y: sh0.y + sh0.vy, ticksLeft: sh0.ticksLeft - 1 };
    if (sh.ticksLeft < 0 || isSolid(grid, Math.floor(sh.x / TILE), Math.floor(sh.y / TILE))) continue;
    if (!sh.spent && overlaps(shotBox(sh), hurt)) {
      const r = absorb(sh.owner, sh.halves, { x: sh.x - sh.vx, y: sh.y - sh.vy }, typeOf(sh.owner));
      if (r === 'hit') continue;
      if (r === 'dodged') { movedShots.push({ ...sh, spent: true }); continue; }
    }
    movedShots.push(sh);
  }

  for (const z of [...zones.values()].sort((a, b) => a.id - b.id)) {
    if (!z.spent && zoneLive(z) && circleTouchesBox(z.x, z.y, z.radius, hurt)) {
      if (absorb(z.owner, z.halves, { x: z.x, y: z.y }, typeOf(z.owner)) !== 'ignored') zones.set(z.id, { ...z, spent: true });
    }
    if (!zoneContinues(zones.get(z.id)!)) zones.delete(z.id);
  }

  // Clinging: at most one enemy latches on per tick, and never through i-frames, so a dodge
  // through a crowd is still the answer. Reaching the cap is a forced nap (design doc 5.5); in
  // an exam fight it fails the current question instead, which arrives with the exam fight.
  let clock = state.clock;
  let carried = state.carried;
  if (!isInvincible(op, now)) {
    const body = boxAt(OPERATOR_BODY, op.x, op.y);
    const clinger = byId().find((e) => e.clings && e.phase === 'idle' && e.frozen === 0 && overlaps(enemyHurtbox(e), body));
    if (clinger) {
      enemies.set(clinger.id, { ...clinger, phase: 'attached', phaseTicks: 0 });
      const stacks = stackCount(enemies.values(), carried);
      events.push({ type: 'clung', target: clinger.id, enemy: clinger.type, stacks });
      if (stacks >= CLING.maxStacks) {
        // The stacks go home and reform there: the nap clears the stacks, not the adenosine.
        for (const e of byId()) enemies.set(e.id, stackHome(e));
        carried = 0;
        clock = advance(clock, CLING.napMinutes);
        events.push({ type: 'forcedNap', minutes: CLING.napMinutes });
      }
    }
  }
  op = withStacks(op, enemies.values(), carried);

  const next: GameState = {
    ...state, tick: now + 1, rng, clock, operator: op, enemies: byId(), projectiles: flying,
    shots: movedShots, zones: [...zones.values()].sort((a, b) => a.id - b.id), nextId, freeze,
    touching: onNow.map((o) => o.id), carried,
  };
  // A forced leave clears the freeze, so the freeze event is only emitted when it will happen.
  if (op.halves <= 0) {
    // The room is already reset by now, so a door, trigger or bed touched on the lethal tick would
    // be read against the wrong place and state; dying wins.
    const settled = events.filter((e) => !roomEvents.includes(e));
    settled.push({ type: 'forcedLeave' });
    return { state: forcedLeave(next), events: settled };
  }
  if (freeze > 0) events.push({ type: 'freeze', frames: freeze });
  return { state: next, events };
}

export const selectOperator = (s: GameState): Readonly<OperatorState> => s.operator;
export const selectEnemies = (s: GameState): readonly Readonly<EnemyState>[] => s.enemies;
export const selectProjectiles = (s: GameState): readonly Readonly<Projectile>[] => s.projectiles;
export const selectShots = (s: GameState): readonly Readonly<Shot>[] => s.shots;
export const selectZones = (s: GameState): readonly Readonly<Zone>[] => s.zones;
export const selectHearts = (s: GameState): { readonly halves: number; readonly maxHalves: number } =>
  ({ halves: s.operator.halves, maxHalves: s.operator.maxHalves });
export const selectTick = (s: GameState): number => s.tick;
export const selectActiveVariants = (s: GameState): readonly string[] => s.room.active;
export const selectFrozen = (s: GameState): boolean => s.freeze > 0;
export const selectGauge = (s: GameState): { readonly value: number; readonly max: number } =>
  ({ value: s.operator.gauge, max: STAMP.gaugeMax });
export const selectClock = (s: GameState): RuleClock => s.clock;
/** The NPC or bed the interact key would use right now, for the HUD prompt; same rule as the key. */
export function selectInteractable(s: GameState): { readonly object: number; readonly kind: string } | undefined {
  if (s.operator.action.kind !== 'free') return undefined;
  const o = reachableObject(s.room, boxAt(OPERATOR_BODY, s.operator.x, s.operator.y), s.operator);
  return o ? { object: o.id, kind: o.kind } : undefined;
}
/** Clinging enemies in id order, for drawing them on the operator. */
export const selectStacks = (s: GameState): readonly Readonly<EnemyState>[] =>
  s.enemies.filter((e) => e.phase === 'attached');

export interface BossSummary {
  readonly id: number;
  readonly type: string;
  readonly budget: number;
  readonly maxBudget: number;
  readonly stage: 1 | 2 | 3;
  readonly residue: number;
  readonly boostMin: number;
  readonly defeated: boolean;
}

/** The room's boss for the nameplate, or undefined in a room without one. */
export function selectBoss(s: GameState): BossSummary | undefined {
  const e = s.enemies.find((x) => x.boss);
  if (!e?.boss) return undefined;
  return {
    id: e.id, type: e.type, budget: e.hp, maxBudget: e.maxHp, stage: e.boss.stage, residue: e.boss.residue,
    boostMin: s.bosses[e.boss.def]!.boostMin, defeated: e.phase === 'closed',
  };
}
