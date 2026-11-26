import { overlaps } from '../collision/boxes.ts';
import { isSolid } from '../collision/grid.ts';
import { isBound, isMelee, recoverTicksOf, strikeBox, type EnemyState } from '../combat/actors.ts';
import { snackProtested } from '../combat/bosses/snack.ts';
import { DODGE, FOLDER, GAUGE, HURT, MANAGER, PARRY_BOOST, SALESMAN, STAPLER, SUGAR_FOG } from '../combat/frames.ts';
import { guardCovers, parryOpen } from '../combat/folder.ts';
import { chip, owing } from '../combat/assists.ts';
import { pieCovers } from '../combat/pie.ts';
import { circleTouchesBox, shotBox, zoneContinues, zoneLive, type Shot } from '../combat/hazards.ts';
import type { Vec } from '../combat/movement.ts';
import { hurtOperator, inDodgeIframes, isInvincible, unit } from '../combat/operator.ts';
import { mixerOf } from '../rooms/boxes.ts';
import { isDelivery, takeDelivery } from '../stomach/mixer.ts';
import { mouthOf } from '../stomach/docks.ts';
import { orderId } from '../stomach/orders.ts';
import { TILE } from '../time.ts';
import { enemiesById, waveKey, type Tick } from './tick.ts';
import { charge } from './rules.ts';

/**
 * Phases P16 and P17: a closed boss takes its attacks back, then at most one hit lands on the
 * operator: strikes, shots, then areas, each in id order. The shots that fly the whole way to the
 * hopper feed the mixer. `hurt` is the hurtbox before this tick's knockback, which the fog reads later.
 */
export function stepHits(t: Tick): void {
  const { state, events, now, examining, assists, perks, pie, zones, enemies, grid, flying } = t;
  const room = state.room;
  let { op, shots, nextId, orderSerial, boostUntil } = t;
  const byId = (): EnemyState[] => enemiesById(t);

  // A closed boss stops attacking at once: its shots and areas go with it. A closed ordinary
  // enemy's shot already in the air still flies.
  const closed = new Set(byId().filter((e) => e.boss && e.phase === 'closed').map((e) => e.id));
  for (const [id, z] of zones) if (closed.has(z.owner)) zones.delete(id);
  shots = shots.filter((sh) => !closed.has(sh.owner));

  // Hits on the operator: at most one lands per tick. Strikes, then shots, then areas, each in
  // id order. Dodge i-frames absorb any of them; the first six i-frames make it perfect.
  let freeze = 0;
  const { hurt } = t;
  /** How an attack meets the operator before it can land: dodged through, passed by invincibility, or `undefined` when it lands. */
  const evade = (source: number): 'dodged' | 'ignored' | undefined => {
    const a = op.action;
    if (inDodgeIframes(a)) {
      const timed = a.frame <= DODGE.perfectLast;
      if ((timed || assists.autoPerfect) && !a.perfect) {
        op = { ...op, action: { ...a, perfect: true } };
        events.push(timed ? { type: 'perfectDodge', source } : { type: 'perfectDodge', source, assisted: true });
        op = charge(op, GAUGE.perfectDodge, state.p, events);
      }
      return 'dodged';
    }
    if (isInvincible(op, now) || freeze > 0) return 'ignored';
    return undefined;
  };
  // In an exam a hit still knocks back and freezes, but costs no heart: it counts against the performance.
  const absorb = (source: number, halves: number, from: Vec, cause: string): 'dodged' | 'ignored' | 'hit' => {
    const slipped = evade(source);
    if (slipped) return slipped;
    // An exam hit costs no heart, so it neither halves nor owes anything.
    const paid = examining ? { cost: 0, owed: op.halfCarry ?? 0 } : chip(halves, op.halfCarry ?? 0, assists);
    op = owing(hurtOperator(op, paid.cost, from, now), paid.owed);
    freeze = HURT.freezeTicks;
    events.push(examining ? { type: 'examHit', source, cause } : { type: 'heartLost', halves: paid.cost, cause });
    return 'hit';
  };
  const typeOf = (id: number) => enemies.get(id)?.type ?? 'unknown';

  // The guard faces the way the operator aims. A strike or shot that comes from inside its 120
  // degrees is caught: a parry (退件) in the first FOLDER.parryFrames, a plain block after. Areas
  // are never caught, so a boss move stays avoidable by dodging alone (design doc 5.3).
  const caught = (from: Vec): 'parry' | 'block' | undefined => {
    if (op.action.kind !== 'guard' || !guardCovers(op.aim, from)) return undefined;
    return parryOpen(op.action) ? 'parry' : 'block';
  };
  // 退件加速: with the card, a parry starts the speed-up, and a later parry renews it.
  const speedUp = (): void => {
    if (perks.parryBoost) boostUntil = now + PARRY_BOOST.ticks;
  };

  for (const e of byId()) {
    if (!isMelee(e) || e.phase !== 'strike' || e.strikeSpent || isBound(e) || !overlaps(strikeBox(e), hurt)) continue;
    const c = caught({ x: e.x - op.x, y: e.y - op.y });
    if (c) {
      events.push({ type: c === 'parry' ? 'parry' : 'blocked', source: e.id, kind: 'strike' });
      // The stunned enemy wakes into the last tick of its recovery, so the stun is the whole pause.
      const stunned = c === 'parry' ? { frozen: FOLDER.parryStunTicks, phase: 'recover' as const, phaseTicks: recoverTicksOf(e) - 1 } : {};
      enemies.set(e.id, { ...e, strikeSpent: true, ...stunned });
      if (c === 'parry') {
        op = charge(op, GAUGE.parry, state.p, events);
        speedUp();
      }
      continue;
    }
    const halves = e.archetype === 'manager' ? MANAGER.damageHalves : SALESMAN.damageHalves;
    if (absorb(e.id, halves, { x: e.x, y: e.y }, e.type) !== 'ignored') enemies.set(e.id, { ...e, strikeSpent: true });
  }

  // 婉拒 (design doc 7.7): a cheers kid's performance counts refusals, not hits, and the last one
  // sends him off, which closes his case. A wave still in the air after he has gone is refused all the same.
  const refuse = (owner: number, parry: boolean): void => {
    events.push({ type: 'refused', source: owner, parry });
    if (parry) op = charge(op, GAUGE.parry, state.p, events);
    if (parry) speedUp();
    const kid = enemies.get(owner);
    if (!kid || kid.archetype !== 'cheers' || kid.phase === 'closed') return;
    const hp = kid.hp - 1;
    if (hp > 0) {
      enemies.set(owner, { ...kid, hp });
      return;
    }
    enemies.set(owner, { ...kid, hp: 0, phase: 'closed', phaseTicks: 0, frozen: 0 });
    events.push({ type: 'caseClosed', target: owner, enemy: kid.type });
  };

  const movedShots: Shot[] = [];
  // Deliveries that flew to the end of their range: the mixer takes them in after the loop, in id order.
  const arrivals: Shot[] = [];
  // A ring is one wave: once any of its shots is refused or lands, the rest of it is spent.
  const settled = new Set<string>();
  const settle = (sh: Shot): void => {
    const k = waveKey(sh);
    if (k !== undefined) settled.add(k);
  };
  for (const sh0 of shots.sort((a, b) => a.id - b.id)) {
    const sh = { ...sh0, x: sh0.x + sh0.vx, y: sh0.y + sh0.vy, ticksLeft: sh0.ticksLeft - 1 };
    // A delivery that has flown its whole way is at the hopper: dodged through or not, it lands.
    if (sh.ticksLeft < 0 && sh0.delivery !== undefined) {
      arrivals.push(sh0);
      continue;
    }
    if (sh.ticksLeft < 0 || isSolid(grid, Math.floor(sh.x / TILE), Math.floor(sh.y / TILE))) continue;
    // The pie stops any shot that has come inside it; areas and strikes are not shots and pass.
    if (!sh.spent && pieCovers(pie, op, sh)) {
      events.push({ type: 'pieBlocked', source: sh.owner });
      continue;
    }
    if (sh.cups !== undefined) {
      // A toast wave costs no heart and is never an ordinary shot, even once its ring is settled.
      // Any guard frame refuses it, and nothing flies back; landing adds cups.
      const live = !sh.spent && !settled.has(waveKey(sh) ?? '');
      if (!live || !overlaps(shotBox(sh), hurt)) {
        movedShots.push(sh);
        continue;
      }
      const c = caught({ x: -sh.vx, y: -sh.vy });
      if (c) {
        refuse(sh.owner, c === 'parry');
        settle(sh);
        continue;
      }
      const r = evade(sh.owner);
      if (r === 'dodged') movedShots.push({ ...sh, spent: true });
      else if (r === 'ignored') movedShots.push(sh);
      else {
        events.push({ type: 'toasted', source: sh.owner, cups: sh.cups });
        settle(sh);
      }
      continue;
    }
    if (!sh.spent && overlaps(shotBox(sh), hurt)) {
      const c = caught({ x: -sh.vx, y: -sh.vy });
      if (c) {
        events.push({ type: c === 'parry' ? 'parry' : 'blocked', source: sh.owner, kind: 'shot' });
        if (c === 'parry') {
          op = charge(op, GAUGE.parry, state.p, events);
          speedUp();
          // Back at the thrower; if it is gone, back the way it came.
          const owner = enemies.get(sh.owner);
          const toOwner = owner ? unit({ x: owner.x - sh.x, y: owner.y - 8 - sh.y }) : { x: 0, y: 0 };
          const back = toOwner.x !== 0 || toOwner.y !== 0 ? toOwner : unit({ x: -sh.vx, y: -sh.vy });
          const speed = Math.hypot(sh.vx, sh.vy);
          // A box sent back is not a staple with a range: from a far dock it must still reach the one who threw it.
          const reach = sh.returnDamage !== undefined && owner ? Math.max(STAPLER.rangePx, Math.hypot(owner.x - sh.x, owner.y - 8 - sh.y) + 16) : STAPLER.rangePx;
          flying.push({
            id: nextId++, x: sh.x, y: sh.y, vx: back.x * speed, vy: back.y * speed, ticksLeft: Math.ceil(reach / speed),
            damage: sh.returnDamage ?? FOLDER.reflectDamage, reflected: true,
            ...(sh.delivery !== undefined ? { boxHalf: sh.half } : {}),
          });
        }
        continue;
      }
      if (sh.drink) {
        // A drink is drunk, not taken as a hit: no knockback, no freeze, no heart.
        const r = evade(sh.owner);
        if (r !== undefined) movedShots.push(r === 'dodged' ? { ...sh, spent: true } : sh);
        else if (sh.drink === 'can') events.push({ type: 'canTaken', source: sh.owner });
        else {
          events.push({ type: 'teaTaken', source: sh.owner });
          op = { ...op, fatigue: SUGAR_FOG.ticks };
        }
        continue;
      }
      const r = absorb(sh.owner, sh.halves, { x: sh.x - sh.vx, y: sh.y - sh.vy }, typeOf(sh.owner));
      if (r === 'hit') continue;
      if (r === 'dodged') { movedShots.push({ ...sh, spent: true }); continue; }
    }
    movedShots.push(sh);
  }

  // The mixer takes the deliveries in. One box over its capacity makes it protest: it empties and
  // throws an area round the hopper that warns for a tier-3 telegraph first (design doc 7.5, 胃抗議).
  let mixerNow = t.mixer;
  const hopper = arrivals.length > 0 ? mixerOf(room) : undefined;
  const mouth = arrivals.length > 0 ? mouthOf(room) : undefined;
  for (const sh of arrivals) {
    if (!mixerNow || !hopper || !mouth) break;
    const boxId = orderId(orderSerial++);
    const capacity = Number(hopper.props['capacity']);
    const held = mixerNow.batches.filter(isDelivery).length;
    const taken = takeDelivery(mixerNow, capacity, boxId, sh.delivery!);
    mixerNow = taken.mixer;
    if (!taken.jammed) {
      events.push({ type: 'mixerFed', object: boxId, mixer: hopper.id, portion: sh.delivery!, count: taken.count, capacity });
      continue;
    }
    events.push({ type: 'mixerProtest', mixer: hopper.id, x: mouth.x, y: mouth.y });
    const boss = enemies.get(sh.owner);
    const def = boss?.boss ? state.bosses[boss.boss.def] : undefined;
    if (def?.behaviour !== 'snack') continue;
    enemies.set(sh.owner, snackProtested(def, boss!, held, events));
    const id = nextId++;
    zones.set(id, {
      id, owner: sh.owner, move: 'protest', tier: 3, x: mouth.x, y: mouth.y, radius: def.protest.radius,
      telegraphTicks: def.protest.telegraphTicks, activeTicks: def.protest.activeTicks, halves: def.protest.halves, age: 1, spent: false,
    });
    // Announced as an area and not as tier 3, whose caption says the move can be stamped back; this one cannot.
    events.push({ type: 'telegraph', source: sh.owner, tier: 2, move: 'protest', ticks: def.protest.telegraphTicks });
  }

  for (const z of [...zones.values()].sort((a, b) => a.id - b.id)) {
    if (!z.spent && zoneLive(z) && circleTouchesBox(z.x, z.y, z.radius, hurt)) {
      if (absorb(z.owner, z.halves, { x: z.x, y: z.y }, typeOf(z.owner)) !== 'ignored') zones.set(z.id, { ...z, spent: true });
    }
    if (!zoneContinues(zones.get(z.id)!)) zones.delete(z.id);
  }
  t.op = op;
  t.freeze = freeze;
  t.boostUntil = boostUntil;
  t.nextId = nextId;
  t.orderSerial = orderSerial;
  t.mixer = mixerNow;
  t.movedShots = movedShots;
  t.settled = settled;
}
