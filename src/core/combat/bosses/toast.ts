import type { DomainEvent } from '../../game.ts';
import { TICK_HZ } from '../../time.ts';
import type { EnemyState } from '../actors.ts';
import { TELEGRAPH } from '../frames.ts';
import type { ShotSpec } from '../hazards.ts';
import type { Vec } from '../movement.ts';
import type { ToastDef, ToastState } from './boss.ts';

/**
 * The toast boss, boss.toast.name in the strings (design doc 7.7, 乾杯三巡). He waits until the
 * operator comes within wakeDistance, then stands and sings:
 * each line of a round telegraphs at tier 1 and then sends a ring of toast waves, one shot aimed
 * at the operator and the rest evenly round him. A wave costs no heart; one that lands is a cup
 * in the liver's receiving area, and the guard refuses it. After a round's last line he breathes
 * for breathTicks, his weak point, and then sings the next round at a quicker beat; the last round
 * repeats until his budget runs out, when he gives up instead of being closed (game.ts).
 */
export interface ToastTick {
  readonly enemy: EnemyState;
  readonly shots: readonly ShotSpec[];
  readonly events: readonly DomainEvent[];
}

/** Half the side of a wave's box, as for the cheers kid's. */
const SHOT_HALF = 4;

function ring(e: EnemyState, def: ToastDef, wave: number, target: Vec): ShotSpec[] {
  const ox = e.x;
  const oy = e.y - 4;
  const base = Math.atan2(target.y - 4 - oy, target.x - ox);
  const { shots, shotSpeed, shotTicks, cups } = def.ring;
  return Array.from({ length: shots }, (_, i) => {
    const a = base + (i * 2 * Math.PI) / shots;
    return {
      owner: e.id, kind: 'toast', x: ox, y: oy, vx: Math.cos(a) * shotSpeed, vy: Math.sin(a) * shotSpeed,
      ticksLeft: shotTicks, halves: 0, cups, wave, half: SHOT_HALF,
    };
  });
}

export function stepToast(e: EnemyState, def: ToastDef, target: Vec): ToastTick {
  const shots: ShotSpec[] = [];
  const events: DomainEvent[] = [];
  let b = e.boss as ToastState;
  const done = (): ToastTick => ({ enemy: { ...e, boss: b }, shots, events });
  const startLine = (line: number) => {
    b = { ...b, part: 'sing', line, ticks: 0, move: { id: 'toast', frame: 1 } };
    events.push({ type: 'telegraph', source: e.id, tier: 1, move: 'toast' });
  };
  const t = b.ticks + 1;

  // He stands still, so his position is his spawn point. The intro conversation is a room
  // trigger the rules cannot see; the distance keeps the song from starting before it.
  if (b.part === 'wait') {
    if (Math.hypot(target.x - e.x, target.y - e.y) <= def.wakeDistance) b = { ...b, part: 'intro', ticks: 0 };
    return done();
  }

  if (b.part === 'intro') {
    if (t >= def.introTicks) startLine(0);
    else b = { ...b, ticks: t };
    return done();
  }

  if (b.part === 'breath') {
    if (t < def.breathTicks) {
      b = { ...b, ticks: t };
      return done();
    }
    const stage = Math.min(b.stage + 1, def.rounds.length) as 1 | 2 | 3;
    if (stage !== b.stage) events.push({ type: 'bossRound', target: e.id, round: stage });
    b = { ...b, stage };
    startLine(0);
    return done();
  }

  if (b.move) {
    const frame = b.move.frame + 1;
    if (frame === TELEGRAPH.tier1Ticks + 1) {
      shots.push(...ring(e, def, b.waves + 1, target));
      b = { ...b, waves: b.waves + 1, move: null };
    } else b = { ...b, move: { id: 'toast', frame } };
  }
  const round = def.rounds[b.stage - 1]!;
  if (t < round.beatTicks) {
    b = { ...b, ticks: t };
    return done();
  }
  if (b.line + 1 < round.lines) {
    startLine(b.line + 1);
    return done();
  }
  b = { ...b, part: 'breath', ticks: 0, move: null };
  events.push({ type: 'bossBreath', target: e.id, seconds: def.breathTicks / TICK_HZ });
  return done();
}

/** True while he breathes after a round, when hits count breathDamageFactor times (design doc 7.7). */
export const breathing = (b: ToastState): boolean => b.part === 'breath';
