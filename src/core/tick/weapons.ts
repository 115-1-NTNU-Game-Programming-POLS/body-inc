import { centeredBox, overlaps, type Box } from '../collision/boxes.ts';
import { isSolid, moveAndCollide } from '../collision/grid.ts';
import { backOff, ENEMY_BODY, enemyHurtbox, isBound, isHittable, recoverTicksOf, shieldCovers, type EnemyState } from '../combat/actors.ts';
import { proposalOpen } from '../combat/bosses/caffeine.ts';
import { snackExposed } from '../combat/bosses/snack.ts';
import { BIND, BOSS, ENEMY_HIT_FREEZE, FOLDER, GAUGE, HIGHLIGHTER, MANAGER, STAMP, STAPLER } from '../combat/frames.ts';
import { circleCentre, inCircle, isMarked, lineCrosses } from '../combat/highlighter.ts';
import { swingBox } from '../combat/folder.ts';
import { UNLOAD, unloadAge, unloadBox } from '../combat/unload.ts';
import { circleTouchesBox } from '../combat/hazards.ts';
import { tileBox } from '../rooms/boxes.ts';
import { isOrder } from '../stomach/orders.ts';
import { CHUNK, chunksUnder, withoutChunks } from '../stomach/chunks.ts';
import { cooldownTicks, coolingLeft, startCooling } from '../rooms/cooling.ts';
import { leverAt, objectBox } from '../rooms/interact.ts';
import { ALCOHOL_CRATE, boxCentre, crateOnTile, crateTiles, linesOf } from '../liver/factory.ts';
import { TILE } from '../time.ts';
import { ascending } from '../tick/room.ts';
import { enemiesById, type Tick } from './tick.ts';
import type { Projectile } from '../game.ts';
import { charge, damage, unrevealed, type Strike } from './rules.ts';

const STAPLE_HALF = 2;

/**
 * Phase P15: the operator's weapons land on the enemies, and the crates and switches beside them.
 * The stamp, the folder's swing, the highlighter's line and circle, the acid and the staples in
 * flight run in that order; `hitEnemy` and its helpers are the closures they share.
 */
export function stepWeapons(t: Tick): void {
  const { state, events, now, stepped: s, perks, enemies, zones, unload, grid, projectiles } = t;
  const room = state.room;
  let { op, bind, boxes, switches, cooling, dissolved } = t;
  let roomNow = t.room;
  const byId = (): EnemyState[] => enemiesById(t);

  // Hitting a cheers kid is no answer (design doc 7.7): he only backs off, and nothing is charged,
  // so he cannot be farmed for the gauge. Only refusals close his case.
  const shoo = (e: EnemyState): void => {
    const off = backOff(e);
    if (off === e) return;
    enemies.set(e.id, off);
    events.push({ type: 'backedOff', target: e.id, enemy: e.type });
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
      if (e.archetype === 'cheers') {
        shoo(e);
        continue;
      }
      if (!e.boss) {
        enemies.set(e.id, damage(e, STAMP.damage, STAMP.hitFreeze, events, state.bosses));
        continue;
      }
      const def = state.bosses[e.boss.def]!;
      if (def.behaviour === 'snack' && e.boss.behaviour === 'snack' && e.boss.stage === 3) {
        // In the lights out only the stamp ends him, and only once he has slept and the stomach is quiet (design doc 7.5).
        if (snackExposed(def, e.boss, t.mixer)) enemies.set(e.id, damage(e, BOSS.stampDamage, 0, events, state.bosses));
        else events.push({ type: 'snackStampRefused', target: e.id });
        continue;
      }
      const rejected = def.behaviour === 'caffeine' && e.boss.behaviour === 'caffeine' && proposalOpen(def, e.boss);
      let hit = damage(e, BOSS.stampDamage, 0, events, state.bosses);
      if (rejected && hit.phase !== 'closed' && hit.boss?.behaviour === 'caffeine') {
        // The proposal is stamped: the move is cancelled and the boss sits under review.
        for (const [id, z] of zones) if (z.owner === e.id) zones.delete(id);
        hit = { ...hit, boss: { ...hit.boss, move: null, review: BOSS.reviewTicks } };
        events.push({ type: 'proposalRejected', target: e.id });
      }
      enemies.set(e.id, hit);
    }
    // An order within the radius is sent back to the courier (退貨); the others are on their way to the mixer.
    const sent = boxes.filter((b) => isOrder(b) && Math.hypot(boxCentre(b).x - op.x, boxCentre(b).y - op.y) <= STAMP.radiusPx);
    if (sent.length > 0) {
      const gone = new Set(sent.map((b) => b.id));
      boxes = boxes.filter((b) => !gone.has(b.id));
      for (const b of sent) events.push({ type: 'orderReturned', object: b.id, col: b.col, row: b.row });
    }
    // Alcohol crates in reach take the grey stamp like any immune object; one note for the dock.
    const f = state.factory;
    if (f && crateTiles(room, f.waiting).some((t) => Math.hypot((t.col + 0.5) * TILE - op.x, (t.row + 0.5) * TILE - op.y) <= STAMP.radiusPx)) {
      events.push({ type: 'stampVoid', target: linesOf(room).receiving!.id, enemy: ALCOHOL_CRATE, solution: f.solution });
    }
  }

  // A weapon landing on a hittable enemy. The flag decides what it does, not a large health pool
  // (design doc 5.1, 5.5): immune ones bounce it with no hit-stop and no damage, reforming ones
  // scatter, the rest lose `amount`. `gain` is the gauge the hit charges before P, 0 for none.
  // `strike` says where the weapon comes from (a vector from the target towards the attacker) and
  // whether it can break a manager's shield; the rest of the weapons never reach a shield.
  // `marks` is whether the highlighter's mark doubles the hit: true for the stapler and the folder.
  const hitEnemy = (target: EnemyState, amount: number, freeze: number, gain: number, binds = 0, strike?: Strike, marks = false): void => {
    if (target.archetype === 'cheers') {
      shoo(target);
    } else if (target.boss?.behaviour === 'snack' && (strike?.breaks !== 'reflect' || target.boss.stage === 3)) {
      events.push({ type: 'snackShrugged', target: target.id });
    } else if (target.category === 'immune') {
      events.push({ type: 'immuneBounce', target: target.id, enemy: target.type, solution: target.solution ?? '' });
    } else if (target.category === 'reforming') {
      enemies.set(target.id, { ...target, phase: 'dispersed', phaseTicks: 0, frozen: 0 });
      events.push({ type: 'dispersed', target: target.id, enemy: target.type });
      if (gain > 0) op = charge(op, gain, state.p, events);
    } else {
      const shielded = strike !== undefined && shieldCovers(target, strike.from);
      if (shielded && strike.breaks === undefined) {
        events.push({ type: 'shieldBlocked', target: target.id, enemy: target.type });
        return;
      }
      if (gain > 0) op = charge(op, gain, state.p, events);
      const wasBound = isBound(target);
      let hit = damage(target, marks && isMarked(target, now) ? amount * HIGHLIGHTER.markFactor : amount, freeze, events, state.bosses);
      if (shielded && hit.phase !== 'closed') {
        // The hit landed and the bash he was winding up is off: he wakes into the last tick of his pause, so the stun is all of it.
        events.push({ type: 'shieldBroken', target: target.id, enemy: target.type, by: strike.breaks! });
        hit = {
          ...hit, broken: MANAGER.breakTicks, frozen: Math.max(hit.frozen, MANAGER.breakStunTicks),
          phase: 'recover', phaseTicks: recoverTicksOf(hit) - 1, strikeSpent: true,
        };
      }
      enemies.set(target.id, binds > 0 ? bindHit(hit, binds) : hit);
      if (wasBound && perks.bindSplash > 0) splash(target);
    }
  };

  // 裝訂: staple hits in a row on one enemy add up to a pin. A different target, a lapse of
  // BIND.windowTicks, or a boss (which is never frozen) ends the run.
  const bindHit = (e: EnemyState, count: number): EnemyState => {
    if (e.phase === 'closed' || e.boss) return e;
    const run = bind !== undefined && bind.target === e.id && now - bind.at <= BIND.windowTicks ? bind.hits : 0;
    const hits = run + count;
    if (hits < perks.bindHits) {
      bind = { target: e.id, hits, at: now };
      return e;
    }
    bind = { target: e.id, hits: 0, at: now };
    events.push({ type: 'bound', target: e.id, enemy: e.type });
    return { ...e, frozen: Math.max(e.frozen, perks.pinTicks), pin: perks.pinTicks };
  };

  // 裝訂大師: a hit on a bound enemy chips the ordinary enemies around it. The splash binds nothing and splashes nothing.
  const splash = (centre: EnemyState): void => {
    for (const o of byId()) {
      const near = Math.hypot(o.x - centre.x, o.y - centre.y) <= BIND.splashPx;
      if (o.id === centre.id || !near || !isHittable(o) || o.category !== 'defeatable' || o.archetype === 'cheers' || o.boss) continue;
      enemies.set(o.id, damage(o, perks.bindSplash, ENEMY_HIT_FREEZE, events, state.bosses));
    }
  };

  // The folder's swing has a box on one frame and covers every hittable enemy in it, lowest id first.
  // Alcohol crates in the dock only wobble under it, like under a staple: no tool shortens the wait.
  if (s.swingHit !== undefined) {
    const box = swingBox(op);
    // Read each enemy afresh: an earlier hit's splash (裝訂大師) may have changed the ones beside it.
    for (const { id } of byId()) {
      const e = enemies.get(id)!;
      if (isHittable(e) && overlaps(box, enemyHurtbox(e))) {
        const heavy = s.swingHit === FOLDER.finisher;
        hitEnemy(e, FOLDER.damage[s.swingHit]!, FOLDER.hitFreeze[s.swingHit]!, GAUGE.folder, 0, { from: { x: op.x - e.x, y: op.y - e.y }, breaks: heavy ? 'folder' : undefined }, true);
      }
    }
    const f = state.factory;
    if (f && crateTiles(room, f.waiting).some((t) => overlaps(box, tileBox(t)))) {
      events.push({ type: 'immuneBounce', target: linesOf(room).receiving!.id, enemy: ALCOHOL_CRATE, solution: f.solution });
    }
  }

  // The health check (design doc 7.7): a reveal switch the line crosses or the circle touches is lit
  // for good, in id order. A door it unlocks opens on the next tick, as after a staple's lever.
  const reveal = (meets: (b: Box) => boolean): void => {
    for (const o of unrevealed(state.room, switches)) {
      if (!meets(objectBox(o))) continue;
      switches = ascending([...switches, o.id]);
      events.push({ type: 'switchChanged', object: o.id, on: true, mode: 'reveal', by: 'highlighter' });
    }
  };

  // The highlighter's line pierces: every hittable enemy it crosses takes the hit, lowest id first,
  // on the stapler's terms (a manager's shield stops it, immune ones bounce it, reforming ones
  // scatter). Its own hits are never doubled by a mark (issue #76, decision 3). Alcohol crates only wobble.
  if (s.lineHit) {
    for (const { id } of byId()) {
      const e = enemies.get(id)!;
      if (isHittable(e) && lineCrosses(op, enemyHurtbox(e))) {
        hitEnemy(e, HIGHLIGHTER.damage, HIGHLIGHTER.hitFreeze, GAUGE.highlighter, 0, { from: { x: op.x - e.x, y: op.y - e.y }, breaks: undefined });
      }
    }
    const f = state.factory;
    if (f && crateTiles(room, f.waiting).some((t) => lineCrosses(op, tileBox(t)))) {
      events.push({ type: 'immuneBounce', target: linesOf(room).receiving!.id, enemy: ALCOHOL_CRATE, solution: f.solution });
    }
    reveal((b) => lineCrosses(op, b));
  }

  // The circle marks the defeatable enemies standing in it; it is no hit, so it charges nothing and
  // a shield does not stop it. An immune one bounces it and a reforming one scatters, so only an
  // enemy that can be beaten ever carries a mark. The cheers kid is closed only by refusals and ignores it.
  if (s.circleLanded) {
    const centre = circleCentre(op);
    events.push({ type: 'circleDrawn', x: centre.x, y: centre.y, radius: HIGHLIGHTER.circleRadiusPx });
    reveal((b) => circleTouchesBox(centre.x, centre.y, HIGHLIGHTER.circleRadiusPx, b));
    for (const { id } of byId()) {
      const e = enemies.get(id)!;
      if (!isHittable(e) || e.archetype === 'cheers' || !inCircle(centre, e)) continue;
      if (e.category === 'immune') {
        events.push({ type: 'immuneBounce', target: e.id, enemy: e.type, solution: e.solution ?? '' });
      } else if (e.category === 'reforming') {
        enemies.set(e.id, { ...e, phase: 'dispersed', phaseTicks: 0, frozen: 0 });
        events.push({ type: 'dispersed', target: e.id, enemy: e.type });
      } else {
        enemies.set(e.id, { ...e, markedUntil: now + perks.markTicks });
        events.push({ type: 'marked', target: e.id, enemy: e.type });
      }
    }
  }

  // 強制卸貨: while the acid lies, an ordinary defeatable enemy in it is shoved along it and, on the
  // acid's rhythm, loses performance. A pinned enemy is held where it is, a manager's shield does not
  // meet spit, and the rest (immune, reforming, the cheers kid, bosses) are left alone.
  if (unload && unload.ticksLeft > 0) {
    const area = unloadBox(unload);
    const bite = (unloadAge(unload) - 1) % UNLOAD.damageEveryTicks === 0;
    for (const { id } of byId()) {
      const e = enemies.get(id)!;
      if (!isHittable(e) || e.category !== 'defeatable' || e.archetype === 'cheers' || e.boss || !overlaps(area, enemyHurtbox(e))) continue;
      const m = isBound(e) ? { x: e.x, y: e.y } : moveAndCollide(grid, ENEMY_BODY, e.x, e.y, unload.dir.x * UNLOAD.shovePx, unload.dir.y * UNLOAD.shovePx);
      const shoved: EnemyState = { ...e, x: m.x, y: m.y };
      enemies.set(id, bite ? damage(shoved, UNLOAD.damage, 0, events, state.bosses) : shoved);
    }
    // The acid is a fixed rectangle, so a chunk it covers is covered for as long as it lies and only the clock matters. The tiles open at the end of the tick.
    if (unloadAge(unload) === CHUNK.dissolveTicks) {
      const gone = chunksUnder(state.room, state.dissolved, area).map((c) => c.object.id);
      if (gone.length > 0) {
        dissolved = ascending([...dissolved, ...gone]);
        roomNow = withoutChunks(state.room, dissolved);
        for (const object of gone) events.push({ type: 'chunkDissolved', object });
      }
    }
  }

  // Staples: move, pin a lever they reach (design doc 6.1 shoots far switches), stop at walls,
  // hit the lowest-id hittable enemy they overlap. Levers come before walls because they are
  // usually mounted on one. A staple only ever turns a lever on: held fire would otherwise flick
  // it on and off six times a second. A shot the folder sent back flies like a staple but throws
  // no lever and charges no gauge.
  const flying: Projectile[] = [];
  for (const p0 of projectiles.sort((a, b) => a.id - b.id)) {
    const p = { ...p0, x: p0.x + p0.vx, y: p0.y + p0.vy, ticksLeft: p0.ticksLeft - 1 };
    if (p.ticksLeft < 0) continue;
    const box = centeredBox(p.x, p.y, STAPLE_HALF, STAPLE_HALF);
    const lever = p.reflected ? undefined : leverAt(state.room, box);
    if (lever) {
      // A crate may sit on a lever (only doors and the like are kept clear), and then it takes the staple.
      // Only a crate over the lever itself counts: one beside it must not eat a staple that grazes it.
      const leverBox = objectBox(lever);
      const covers = (t: Box) => overlaps(box, t) && overlaps(leverBox, t);
      const crated = boxes.some((b) => covers(tileBox(b)) || (b.carried === true && b.from !== undefined && covers(tileBox(b.from))));
      if (!crated && !switches.includes(lever.id) && coolingLeft(cooling, lever.id) === 0) {
        switches = ascending([...switches, lever.id]);
        cooling = startCooling(cooling, lever.id, cooldownTicks(lever));
        events.push({ type: 'switchChanged', object: lever.id, on: true, mode: 'toggle', by: 'staple' });
      }
      continue;
    }
    const col = Math.floor(p.x / TILE);
    const row = Math.floor(p.y / TILE);
    if (state.factory && crateOnTile(room, state.factory.waiting, col, row)) {
      // An alcohol crate only wobbles (design doc 7.7): the bounce of an immune object, never a hit.
      events.push({ type: 'immuneBounce', target: linesOf(room).receiving!.id, enemy: ALCOHOL_CRATE, solution: state.factory.solution });
      continue;
    }
    if (isSolid(grid, col, row)) continue;
    const target = byId().find((e) => isHittable(e) && overlaps(box, enemyHurtbox(e)));
    if (!target) { flying.push(p); continue; }
    hitEnemy(target, p.damage ?? STAPLER.damage, ENEMY_HIT_FREEZE, p.reflected ? 0 : GAUGE.staple, p.reflected ? perks.parryBind : 1,
      { from: { x: -p.vx, y: -p.vy }, breaks: p.reflected ? 'reflect' : undefined }, true);
  }
  t.op = op;
  t.bind = bind;
  t.boxes = boxes;
  t.switches = switches;
  t.cooling = cooling;
  t.dissolved = dissolved;
  t.room = roomNow;
  t.flying = flying;
}
