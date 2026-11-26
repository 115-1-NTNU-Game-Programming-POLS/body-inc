import { boxAt } from '../collision/boxes.ts';
import { moveAndCollide, type SolidGrid } from '../collision/grid.ts';
import { ENEMY_BODY, type EnemyState } from '../combat/actors.ts';
import { OPERATOR_BODY, type OperatorState, type TickInput } from '../combat/operator.ts';
import { advanceSlide, beltAt, boxAhead, canEnter, CONVEYOR_TICKS, conveyorTiles, filledPorts, flowOf, coldStoreAt, liveGate, onPort, portOf, portOpenAt, portTakes, PUSH, pushDirection, startSlide, tileAt, tileBox, withBoxes, type BoxState, type Occupants, type Tile } from '../rooms/boxes.ts';
import { boxTypeOf, stepMixer, type MixerState } from '../stomach/mixer.ts';
import type { EnteredRoom } from '../rooms/entry.ts';
import { coolDown, cooldownTicks, coolingLeft, startCooling, type Cooling } from '../rooms/cooling.ts';
import { asleep } from '../rooms/sleep.ts';
import { platesUnder, reachableObject, touchedObjects } from '../rooms/interact.ts';
import { doorOpen, switchesFor } from '../rooms/locks.ts';
import { isSpawnedCrate, linesOf, onIntake } from '../liver/factory.ts';
import type { RoomObject } from '../rooms/tiled.ts';
import { TICK_HZ, TILE } from '../time.ts';
import type { DomainEvent, GameState, PushState } from '../game.ts';

export const switchMode = (room: EnteredRoom, id: number): string | undefined => {
  const o = room.objects.find((x) => x.id === id && x.kind === 'Switch');
  return o ? String(o.props['mode']) : undefined;
};

/** A door whose only switches are reveal switches not lit yet: a hidden passage, which reads as wall, so touching it says nothing. */
export const hiddenDoor = (room: EnteredRoom, door: RoomObject, switches: readonly number[]): boolean => {
  const aimed = switchesFor(room.objects, door.id);
  return door.props['lock'] === 'switch' && aimed.length > 0 && aimed.every((o) => o.props['mode'] === 'reveal' && !switches.includes(o.id));
};

export const ascending = (ids: Iterable<number>): number[] => [...new Set(ids)].sort((a, b) => a - b);

/** Plates held down by a box at rest; a sliding box has not arrived and presses nothing yet. */
export const platesUnderBoxes = (room: EnteredRoom, boxes: readonly BoxState[]): number[] =>
  boxes.filter((b) => b.left === 0).flatMap((b) => platesUnder(room, tileBox(b)));

/**
 * Bodies a box must not slide into or settle on: the operator, every enemy still standing in the
 * room, and every enemy's home, since enemies reappear there (respawn, reform, a nap, a forced leave).
 */
export function occupantsOf(op: OperatorState, enemies: Iterable<EnemyState>): Occupants {
  const bodies = [boxAt(OPERATOR_BODY, op.x, op.y)];
  for (const e of enemies) {
    if (e.phase !== 'attached' && e.phase !== 'closed') bodies.push(boxAt(ENEMY_BODY, e.x, e.y));
    bodies.push(boxAt(ENEMY_BODY, e.homeX, e.homeY));
  }
  return { bodies };
}

/** Doors open with these switches, state-opened doors and taken keys, in id order. */
export function openDoors(room: EnteredRoom, switches: readonly number[], unlocked: readonly number[], taken: readonly number[]): number[] {
  return room.objects.filter((o) => o.kind === 'Door' && doorOpen(room.objects, o, switches, unlocked, taken)).map((o) => o.id).sort((a, b) => a - b);
}

const triggerOf = (o: RoomObject): DomainEvent => ({ type: 'triggerEntered', object: o.id, trigger: String(o.props['event']), eventId: String(o.props['eventId']) });

function interactionOf(o: RoomObject): DomainEvent {
  if (o.kind === 'Trigger') return triggerOf(o);
  return o.kind === 'NPC'
    ? { type: 'talk', object: o.id, npc: String(o.props['npcId']), dialogueId: String(o.props['dialogueId']) }
    : { type: 'bedUse', object: o.id, bedType: String(o.props['bedType']) };
}

/**
 * Boxes for this tick: slides already under way move on, the port and the second line take in
 * what rests on them, the mixer works, belts carry the boxes resting on them, then the operator's
 * push, so a box shoved onto a belt is carried from the next tick. A shut timed gate takes nothing.
 * The switches are last tick's: a lever thrown this tick starts its conveyor on the next.
 * The array is kept when nothing moves, so the solid grid built from it stays cached.
 */
function moveBoxes(state: GameState, op: OperatorState, input: TickInput): MovedBoxes {
  if (state.boxes.length === 0 && !state.mixer?.batches.length) return { boxes: state.boxes, push: null, events: [], delivered: state.delivered, chilled: state.chilled, mixer: state.mixer };
  const room = state.room;
  const events: DomainEvent[] = [];
  const port = portOf(room);
  const gate = liveGate(room, state.delivered);
  const now = state.roomTicks;
  const takes = (b: BoxState): boolean => port !== undefined && !isSpawnedCrate(b) && portTakes(port, boxTypeOf(room, b));
  // No box ever rests on a live gate that will not take it in: a belt holds it at the edge, a push
  // against the gate does nothing and the mixer keeps its parcel. A box coming to rest `ticks` from
  // now is taken that tick only if the gate is open then and takes its type. Tiles go by the centre rule.
  const refused = (t: Tile, ticks: number, b?: BoxState): boolean =>
    gate !== undefined && onPort(gate, t) && (!portOpenAt(gate, now + ticks) || (b !== undefined && !takes(b)));
  const occupants = occupantsOf(op, state.enemies);
  // A parcel set down now is taken a tick later, since the port's pass comes before the mixer's.
  const held = gate ? conveyorTiles(gate).filter((t) => refused(t, 1)) : [];
  const mixerSees = held.length > 0 ? { bodies: [...occupants.bodies, ...held.map(tileBox)] } : occupants;
  let boxes = state.boxes.some((b) => b.left > 0) ? state.boxes.map((b) => (b.left > 0 ? advanceSlide(b) : b)) : state.boxes;
  const replace = (next: BoxState) => { boxes = boxes.map((b) => (b.id === next.id ? next : b)); };

  // A box that has come to rest on the port is taken in before belts or a push could move it on.
  let delivered = state.delivered;
  if (port && !(gate && !portOpenAt(gate, now))) {
    const need = Number(port.props['need']);
    for (const b of boxes.filter((x) => x.left === 0 && onPort(port, x) && takes(x))) {
      boxes = boxes.filter((x) => x.id !== b.id);
      delivered = ascending([...delivered, b.id]);
      events.push({ type: 'boxDelivered', object: b.id, port: port.id, count: delivered.length, need });
      if (delivered.length === need) events.push({ type: 'portFilled', object: port.id });
    }
  }
  // A cold store chills a food box at rest on it in the same way; other boxes rest there like on floor.
  let chilled = state.chilled;
  for (const b of boxes.filter((x) => x.left === 0 && !isSpawnedCrate(x) && boxTypeOf(room, x) === 'food')) {
    const store = coldStoreAt(room, b);
    if (!store) continue;
    boxes = boxes.filter((x) => x.id !== b.id);
    chilled = ascending([...chilled, b.id]);
    events.push({ type: 'boxChilled', object: b.id, store: store.id });
  }
  // The second line takes in an acetaldehyde crate at rest on it in the same way (design doc 7.7).
  const intake = state.factory ? linesOf(room).intake : undefined;
  if (intake) {
    for (const b of boxes.filter((x) => x.left === 0 && isSpawnedCrate(x) && onIntake(room, x))) {
      boxes = boxes.filter((x) => x.id !== b.id);
      events.push({ type: 'crateTaken', object: b.id, line: intake.id });
    }
  }
  // The mixer works after the port and before the belts and the push: a parcel it puts out may be
  // carried or pushed on the same tick, and only a port takes it in a tick later.
  let mixer = state.mixer;
  if (mixer) {
    const m = stepMixer(room, mixer, boxes, mixerSees);
    mixer = m.mixer;
    boxes = m.boxes;
    events.push(...m.events);
  }
  const out = (push: PushState | null): MovedBoxes => ({ boxes, push, events, delivered, chilled, mixer });

  for (const b of [...boxes]) {
    if (b.left > 0) continue;
    const belt = beltAt(room, b, state.switches);
    if (!belt) continue;
    const dir = flowOf(room.objects, belt, state.switches);
    const to = { col: b.col + dir.col, row: b.row + dir.row };
    const ticks = CONVEYOR_TICKS[String(belt.props['speed'])]!;
    if (!canEnter(room, boxes, to, occupants) || refused(to, ticks, b)) continue;
    replace(startSlide(b, dir, ticks, true));
    events.push({ type: 'boxMoved', object: b.id, ...to, by: 'conveyor' });
  }

  const dir = op.action.kind === 'free' ? pushDirection(input.move) : undefined;
  if (!dir) return out(null);
  const same = state.push && state.push.dir.col === dir.col && state.push.dir.row === dir.row ? state.push : null;
  const ahead = boxAhead(boxes, boxAt(OPERATOR_BODY, op.x, op.y), dir);
  // Still pressing the same way while the box slides off and the operator catches up: the next
  // push follows without a fresh wait. Only that box gets the head start.
  if (!ahead) return out(same);
  const ticks = Math.min(PUSH.delayTicks, same?.box === ahead.id ? same.ticks + 1 : 1);
  if (ticks >= PUSH.delayTicks) {
    const to = { col: ahead.col + dir.col, row: ahead.row + dir.row };
    if (canEnter(room, boxes, to, occupants) && !refused(to, PUSH.slideTicks, ahead)) {
      replace(startSlide(ahead, dir, PUSH.slideTicks));
      events.push({ type: 'boxMoved', object: ahead.id, ...to, by: 'push' });
    }
  }
  return out({ box: ahead.id, dir, ticks });
}

interface MovedBoxes {
  readonly boxes: readonly BoxState[];
  readonly push: PushState | null;
  readonly events: DomainEvent[];
  readonly delivered: readonly number[];
  readonly chilled: readonly number[];
  readonly mixer: MixerState | undefined;
}

/** What the room's mechanisms did this tick, for the phases that follow. */
export interface RoomTick {
  readonly op: OperatorState;
  readonly grid: SolidGrid;
  readonly moved: MovedBoxes;
  readonly push: PushState | null;
  readonly switches: readonly number[];
  readonly cooling: readonly Cooling[];
  readonly taken: readonly number[];
  readonly doorsOpenNow: readonly number[];
  readonly onNow: readonly RoomObject[];
  readonly roomEvents: readonly DomainEvent[];
}

/**
 * The room's mechanisms for one tick (phases P5 to P8 of docs/reviews/game-step.md): the belt under
 * the operator, boxes, levers, pickups, plates and the port, then the doors and triggers touched.
 * Their order is the rule: a push reads the position the belt left, and the doors are judged on
 * this tick's switches. Pushes onto `events` as it goes.
 */
export function stepRoom(state: GameState, input: TickInput, opIn: OperatorState, gridIn: SolidGrid, events: DomainEvent[]): RoomTick {
  const room = state.room;
  let op = opIn;
  // A running belt under the feet carries the operator along. Walking against it is slower; a fast
  // belt (4 tiles/s) outruns an operator slowed below that, by held fire, a raised folder or the liver
  // chapter's dizziness. Clinging stacks alone cannot: two leave 4.05 tiles/s, and the third forces a nap.
  // Asleep, the operator stays in bed: a belt within reach of it would otherwise carry them off through doors and triggers.
  const underfoot = asleep(state.sleep) ? undefined : beltAt(room, tileAt(op.x, op.y - 1), state.switches);
  if (underfoot) {
    const d = flowOf(room.objects, underfoot, state.switches);
    const v = TILE / CONVEYOR_TICKS[String(underfoot.props['speed'])]!;
    const m = moveAndCollide(gridIn, OPERATOR_BODY, op.x, op.y, d.col * v, d.row * v);
    op = { ...op, x: m.x, y: m.y };
  }

  const moved = moveBoxes(state, op, input);
  const boxes = moved.boxes;
  const push = moved.push;
  events.push(...moved.events);
  const grid = withBoxes(room.grid, boxes);

  // Switches and keys move before doors are judged, so a door opened this tick lets the operator
  // through at once. Their events are not room events: a switch thrown or an item taken on a
  // lethal tick counts as if done a tick earlier; the chapter's forced leave then decides what a
  // return to the punch undoes.
  const body = boxAt(OPERATOR_BODY, op.x, op.y);
  const used = input.interactPressed && op.action.kind === 'free' ? reachableObject(state.room, body, op, state.taken) : undefined;
  let levers = state.switches.filter((id) => switchMode(state.room, id) === 'toggle');
  let cooling = coolDown(state.cooling ?? []);
  if (used?.kind === 'Switch') {
    const left = coolingLeft(cooling, used.id);
    if (left > 0) events.push({ type: 'switchCooling', object: used.id, seconds: left / TICK_HZ });
    else {
      const on = !levers.includes(used.id);
      levers = on ? [...levers, used.id] : levers.filter((id) => id !== used.id);
      cooling = startCooling(cooling, used.id, cooldownTicks(used));
      events.push({ type: 'switchChanged', object: used.id, on, mode: 'toggle', by: 'interact' });
    }
  }
  let taken = state.taken;
  if (used?.kind === 'Pickup') {
    taken = ascending([...taken, used.id]);
    events.push({ type: 'pickedUp', object: used.id, itemType: String(used.props['itemType']), itemId: String(used.props['itemId']).trim() });
  }
  const stoodOn = platesUnder(state.room, body);
  const plates = ascending([...stoodOn, ...platesUnderBoxes(state.room, boxes)]);
  const wasDown = state.switches.filter((id) => switchMode(state.room, id) === 'hold');
  const boxWasOn = platesUnderBoxes(state.room, state.boxes);
  for (const id of ascending([...plates, ...wasDown])) {
    if (plates.includes(id) === wasDown.includes(id)) continue;
    const on = plates.includes(id);
    // Down: the operator wins when both arrive. Up: a box was holding it, so the box left.
    const byBox = on ? !stoodOn.includes(id) : boxWasOn.includes(id);
    events.push({ type: 'switchChanged', object: id, on, mode: 'hold', by: byBox ? 'box' : 'step' });
  }
  const reveals = state.switches.filter((id) => switchMode(state.room, id) === 'reveal');
  let switches = ascending([...levers, ...reveals, ...plates, ...filledPorts(state.room, moved.delivered)]);
  const doorsOpenNow = openDoors(state.room, switches, state.unlocked, taken);

  // Doors and triggers fire on the tick the operator steps onto them, not while standing there;
  // a locked door that opens while the operator is pressed against it counts as stepped onto.
  const onNow = touchedObjects(state.room, body);
  const roomEvents: DomainEvent[] = [];
  for (const o of onNow) {
    const opened = o.kind === 'Door' && doorsOpenNow.includes(o.id) && !state.doorsOpen.includes(o.id);
    if (state.touching.includes(o.id) && !opened) continue;
    if (o.kind === 'Door') {
      if (!doorsOpenNow.includes(o.id) && hiddenDoor(state.room, o, switches)) continue;
      roomEvents.push(doorsOpenNow.includes(o.id)
        ? { type: 'doorEntered', object: o.id, door: o.name, socket: String(o.props['socket']) }
        : { type: 'doorLocked', object: o.id, lock: String(o.props['lock']) });
    } else roomEvents.push(triggerOf(o));
  }
  // A time clock stepped onto and keyed on the same tick is punched once.
  const stepped = (id: number) => roomEvents.some((e) => e.type === 'triggerEntered' && e.object === id);
  if (used && used.kind !== 'Switch' && used.kind !== 'Pickup' && !stepped(used.id)) roomEvents.push(interactionOf(used));
  events.push(...roomEvents);
  return { op, grid, moved, push, switches, cooling, taken, doorsOpenNow, onNow, roomEvents };
}
