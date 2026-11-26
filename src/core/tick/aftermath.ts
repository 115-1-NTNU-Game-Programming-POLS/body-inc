import { boxAt, overlaps } from '../collision/boxes.ts';
import { enemyHurtbox, type EnemyState } from '../combat/actors.ts';
import { CLING } from '../combat/frames.ts';
import { chip, owing } from '../combat/assists.ts';
import { isInvincible, OPERATOR_BODY } from '../combat/operator.ts';
import { advance } from '../clock.ts';
import { stepSleep } from '../rooms/sleep.ts';
import { MIST } from '../liver/factory.ts';
import { enemiesById, type Tick } from './tick.ts';
import { inMist, stackCount, stackHome, withStacks } from './rules.ts';

/**
 * Phases P18 to P21: what the tick's hits leave behind. The acetaldehyde fog, the clinging
 * adenosine and a forced nap, the assist that keeps the last half heart, and the sleep bar, which
 * reads every event of the tick that landed on the operator.
 */
export function stepAftermath(t: Tick): void {
  const { state, events, now, examining, assists, senseRange, enemies, boxes, hurt } = t;
  let { op, factory, clock, carried, sleep } = t;
  const byId = (): EnemyState[] => enemiesById(t);

  // Acetaldehyde fog (design doc 7.7) is a place, not an attack: a dodge does not pass through it,
  // and it neither knocks back nor freezes. Only taking the crate to the second line clears it.
  if (factory) {
    const inFog = inMist(boxes, hurt);
    let mist = inFog ? factory.mist + 1 : 0;
    if (mist >= MIST.intervalTicks) {
      mist = 0;
      const paid = chip(MIST.halves, op.halfCarry ?? 0, assists);
      op = owing({ ...op, halves: op.halves - paid.cost }, paid.owed);
      events.push({ type: 'heartLost', halves: paid.cost, cause: MIST.cause });
    }
    if (mist !== factory.mist) factory = { ...factory, mist };
  }

  // Clinging: at most one enemy latches on per tick, and never through i-frames, so a dodge
  // through a crowd is still the answer. Reaching the cap is a forced nap (design doc 5.5); in
  // an exam it fails the question being answered instead, and the clock does not move.
  // Under a full cloak they cannot see the operator, so they do not grab either (design doc 7.4).
  if (!isInvincible(op, now) && senseRange > 0) {
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
        if (examining) events.push({ type: 'examStacked' });
        else {
          clock = advance(clock, CLING.napMinutes);
          events.push({ type: 'forcedNap', minutes: CLING.napMinutes });
        }
      }
    }
  }
  op = withStacks(op, enemies.values(), carried);
  // The hit above has already knocked back and frozen the fight; the assist only keeps the last half heart.
  if (assists.neverEmpty && op.halves < 1) op = { ...op, halves: 1 };
  if (sleep) {
    // Anything that lands on the operator wakes them, not only a heart lost: a sleeper cannot dodge, so clinging would otherwise run up to a forced nap.
    const struck = events.some((e) => e.type === 'heartLost' || e.type === 'clung' || e.type === 'toasted' || e.type === 'canTaken' || e.type === 'teaTaken');
    const r = stepSleep(sleep, t.mixer?.batches.some((b) => b.left > 0) === true, struck);
    sleep = r.sleep;
    events.push(...r.events);
  }
  t.op = op;
  t.factory = factory;
  t.clock = clock;
  t.carried = carried;
  t.sleep = sleep;
}
