import { boxAt } from '../collision/boxes.ts';
import { CLING, HURT, PARRY_BOOST } from '../combat/frames.ts';
import { NO_ASSISTS } from '../combat/assists.ts';
import { BASE_PERKS } from '../combat/perks.ts';
import { stepPie, sleepOfSpirit } from '../combat/pie.ts';
import { stepUnload } from '../combat/unload.ts';
import type { Vec } from '../combat/movement.ts';
import { OPERATOR_BODY, OPERATOR_HURT, stepOperator, type OperatorState, type TickInput } from '../combat/operator.ts';
import { sitting } from '../exam/fight.ts';
import { liveGate, portOpenAt, withBoxes } from '../rooms/boxes.ts';
import type { EnteredRoom } from '../rooms/entry.ts';
import { touchedObjects } from '../rooms/interact.ts';
import { TICK_HZ } from '../time.ts';
import { stepRoom } from '../tick/room.ts';
import type { Tick } from './tick.ts';
import { handOf } from './rules.ts';
import type { DomainEvent, GameState } from '../game.ts';

/** One tick off the sugar fatigue fog; the field goes once it runs out, as if never drunk. */
function tire(op: OperatorState): OperatorState {
  if (op.fatigue === undefined) return op;
  const { fatigue, ...rest } = op;
  return fatigue > 1 ? { ...rest, fatigue: fatigue - 1 } : rest;
}

/**
 * Whether moving from `from` to `to` brings the operator onto a door it was not on. The arrival
 * spot sits at the edge of a door's touch margin and a knockback is a tile, so a hit on arrival
 * would otherwise carry the operator back through the door just entered (#79).
 */
function ontoDoor(room: EnteredRoom, from: Vec, to: Vec): boolean {
  const doorsAt = (p: Vec) => touchedObjects(room, boxAt(OPERATOR_BODY, p.x, p.y)).filter((o) => o.kind === 'Door').map((o) => o.id);
  const before = doorsAt(from);
  return doorsAt(to).some((id) => !before.includes(id));
}

/**
 * Phases P2 to P8 of docs/reviews/game-step.md, and the working set the rest of the tick shares:
 * the port gate, the operator's own step, the partner's pie and acid, then the room's mechanisms
 * (`stepRoom`). What comes back is the `Tick` that the phases after it read and change.
 */
export function beginTick(state: GameState, pressed: TickInput, input: TickInput, events: DomainEvent[]): Tick {
  const now = state.tick;
  const gate = liveGate(state.room, state.delivered);
  if (gate && state.roomTicks > 0) {
    const open = portOpenAt(gate, state.roomTicks);
    if (open !== portOpenAt(gate, state.roomTicks - 1)) events.push({ type: open ? 'portOpened' : 'portClosed', object: gate.id });
  }

  const assists = input.assists ?? NO_ASSISTS;
  const room = state.room;
  let grid = withBoxes(room.grid, state.boxes);
  const senseRange = Math.min(CLING.senseRangePx, state.senseCapPx ?? CLING.senseRangePx);
  const perks = state.perks ?? BASE_PERKS;
  let bind = state.bind;
  let boostUntil = state.boostUntil;
  const s = stepOperator(grid, state.operator, input, now, boostUntil !== undefined && now < boostUntil ? PARRY_BOOST.factor : 1, handOf(state));
  let op = tire(s.op);
  // A door is passed by walking into it, never by being knocked into it: the knockback step is dropped instead.
  const knocked = state.operator.action.kind === 'hurt' && state.operator.action.frame < HURT.knockbackTicks;
  if (knocked && ontoDoor(room, state.operator, op)) op = { ...op, x: state.operator.x, y: state.operator.y };
  if (s.blockedX) events.push({ type: 'bumpWall', axis: 'x' });
  if (s.blockedY) events.push({ type: 'bumpWall', axis: 'y' });
  if (s.dodged) events.push({ type: 'dodge' });
  if (s.stampRaised) events.push({ type: 'stampRaised' });
  if (s.swapped) events.push({ type: 'toolSwapped', tool: s.swapped });
  if (s.swung !== undefined) events.push({ type: 'swing', combo: s.swung });
  if (s.guardRaised) events.push({ type: 'guardRaised' });
  if (s.lined) events.push({ type: 'lineDrawn' });
  // The partner's skill can be raised in any state but a hurt one, and does not touch the operator's own action.
  let pie = state.pie;
  if (pie) {
    const r = stepPie(pie, input.partnerPressed === true && op.action.kind !== 'hurt', state.p);
    pie = r.pie;
    if (r.raised) events.push({ type: 'pieRaised', radiusPx: pie.radiusPx, seconds: pie.ticksLeft / TICK_HZ, sleepy: sleepOfSpirit(state.p) < 1 });
  }
  // The acid is spat on the same rules: any state but a hurt one, and the operator's own action goes on.
  let unload = state.unload;
  let dissolved = state.dissolved;
  let roomNow = state.room;
  if (unload) {
    const r = stepUnload(unload, input.partnerPressed === true && op.action.kind !== 'hurt', { x: op.x, y: op.y }, op.aim);
    unload = r.unload;
    if (r.raised) events.push({ type: 'unloadRaised', x: unload.x, y: unload.y, dir: unload.dir });
  }

  const roomStep = stepRoom(state, input, op, grid, events);
  op = roomStep.op;
  grid = roomStep.grid;
  const { moved, push, doorsOpenNow, onNow, roomEvents } = roomStep;
  // Orders come and go inside the tick: the courier throws one on, the stamp takes them off.
  let boxes = moved.boxes;
  let switches = roomStep.switches;
  let cooling = roomStep.cooling;
  let taken = roomStep.taken;

  return {
    state, pressed, input, now, examining: sitting(state.exam), stepped: s, assists, perks, senseRange, events, roomEvents,
    op, enemies: new Map(), flying: [], movedShots: [], settled: new Set(), zones: new Map(), projectiles: [], shots: [],
    hurt: boxAt(OPERATOR_HURT, op.x, op.y), nextId: state.nextId, rng: state.rng, clock: state.clock, freeze: 0, grid,
    touchingNow: onNow.map((o) => o.id), carried: state.carried, switches, doorsOpen: doorsOpenNow, taken, boxes, push,
    delivered: moved.delivered, chilled: moved.chilled, room: roomNow, dissolved, cooling, orderSerial: state.orderSerial ?? 0,
    pie, unload, factory: state.factory, mixer: moved.mixer, sleep: state.sleep, bind, boostUntil,
  };
}
