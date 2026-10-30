/**
 * Custom Tiled classes of design doc 13.3. This one definition produces the Tiled project file
 * (tools/maps/make-tiled-project.ts), applies defaults in the room parser, and drives the map
 * check, so the editor, the game and the check cannot disagree about a property.
 *
 * Tiled saves only the members an author changed from the class default, so the parser must
 * fill in these same defaults; that is why defaults live here and not only in the project file.
 */

export type Scalar = string | number | boolean;

/** A list of ids supplied by content (enemy types, dialogue ids) rather than fixed here. */
export type RefKind = 'enemy' | 'dialogue' | 'handbook';

export type PropSpec =
  | { readonly type: 'string'; readonly default: string; readonly required?: boolean }
  | { readonly type: 'int'; readonly default: number; readonly min?: number; readonly max?: number }
  | { readonly type: 'float'; readonly default: number; readonly min?: number }
  | { readonly type: 'bool'; readonly default: boolean }
  /** A required enum defaults to '' so a forgotten choice is reported, not silently the first value. */
  | { readonly type: 'enum'; readonly enum: string; readonly values: readonly string[]; readonly default: string; readonly required?: boolean }
  | { readonly type: 'ref'; readonly ref: RefKind; readonly required: boolean }
  /** A `when` expression; empty means always. */
  | { readonly type: 'condition'; readonly required?: boolean }
  /** Another object in the same map, stored by Tiled as its numeric id. */
  | { readonly type: 'object'; readonly required: boolean };

export type ClassSpec = Readonly<Record<string, PropSpec>>;

const SOCKETS = ['N', 'E', 'S', 'W'] as const;
const enumOf = (name: string, values: readonly string[], def = values[0]!): PropSpec =>
  ({ type: 'enum', enum: name, values, default: def });

export const ORGANS = ['lobby', 'brain', 'stomach', 'liver', 'immune', 'gut', 'exam'] as const;
export const ROLES = ['combat', 'puzzle', 'rest', 'treasure', 'transit', 'core'] as const;

/** Map-level properties every module room fills in (design doc 13.3). */
export const ROOM_CLASS: ClassSpec = {
  organ: { type: 'enum', enum: 'Organ', values: ORGANS, default: '', required: true },
  role: { type: 'enum', enum: 'Role', values: ROLES, default: '', required: true },
  difficulty: { type: 'int', default: 1, min: 1, max: 3 },
  /** Comma-separated abilities the room needs, e.g. "squad,highlighter". */
  needs: { type: 'string', default: '' },
  /** Estimated seconds to clear; 0 means not filled in yet, which the map check rejects. */
  estSeconds: { type: 'int', default: 0, min: 0 },
  needsClock: { type: 'bool', default: false },
  storyOnly: { type: 'bool', default: false },
  /** Comma-separated enemy types this room is the no-threat tutorial for (design doc 5.5). */
  tutorialFor: { type: 'string', default: '' },
};

export const OBJECT_CLASSES: Readonly<Record<string, ClassSpec>> = {
  PlayerStart: {},
  Spawn: {
    enemyType: { type: 'ref', ref: 'enemy', required: true },
    count: { type: 'int', default: 1, min: 1 },
    respawnSeconds: { type: 'float', default: 0, min: 0 },
    when: { type: 'condition' },
  },
  NPC: {
    npcId: { type: 'string', default: '', required: true },
    dialogueId: { type: 'ref', ref: 'dialogue', required: true },
    portrait: { type: 'string', default: '' },
    facing: enumOf('Facing', ['down', 'up', 'left', 'right']),
  },
  Trigger: {
    event: enumOf('TriggerEvent', ['dialogue', 'card', 'cutscene', 'checkpoint', 'clock_advance', 'end', 'rescue', 'exam']),
    eventId: { type: 'string', default: '' },
    once: { type: 'bool', default: true },
    when: { type: 'condition' },
  },
  Door: {
    socket: enumOf('Socket', SOCKETS),
    lock: enumOf('Lock', ['none', 'key', 'switch', 'clock', 'resource']),
    lockParam: { type: 'string', default: '' },
  },
  Switch: {
    target: { type: 'object', required: true },
    mode: enumOf('SwitchMode', ['toggle', 'hold']),
  },
  Conveyor: {
    direction: enumOf('Direction', SOCKETS, 'E'),
    speed: enumOf('ConveyorSpeed', ['slow', 'normal', 'fast'], 'normal'),
  },
  /**
   * A push box. Not in design doc 13.3's table, which predates the puzzle rules; the prologue's
   * glucose crates and the liver chapter's acetaldehyde crates need it. `boxType` only picks the art.
   */
  Box: {
    boxType: enumOf('BoxType', ['crate', 'glucose', 'acetaldehyde', 'food']),
    when: { type: 'condition' },
  },
  /**
   * Where boxes are delivered, such as the prologue's blood glucose dispatch (design doc 7.3): a
   * box that comes to rest on it is taken in for good. Once it holds `need` boxes it counts as a
   * switch that is on, for the door or conveyor it targets, and opens its conversation once. Not
   * in design doc 13.3's table either. One per room.
   */
  Port: {
    need: { type: 'int', default: 1, min: 1 },
    target: { type: 'object', required: false },
    dialogueId: { type: 'ref', ref: 'dialogue', required: false },
  },
  /**
   * The liver factory's lines (design doc 7.7), not in design doc 13.3's table: `receiving` is the
   * dock where alcohol crates wait (a rectangle, solid like a counter), `outlet` the point where the
   * first line puts out acetaldehyde crates, and `intake` the second line's rectangle, which takes
   * in an acetaldehyde crate that comes to rest on it. A factory room has one of each.
   */
  Line: {
    stage: { type: 'enum', enum: 'LineStage', values: ['receiving', 'outlet', 'intake'], default: '', required: true },
  },
  Hazard: {
    hazardType: enumOf('HazardType', ['red_fog', 'water', 'syrup']),
    when: { type: 'condition' },
  },
  Pickup: {
    itemType: enumOf('ItemType', ['handbook', 'coffee', 'meal', 'ors', 'file', 'thanks_card', 'memory']),
    itemId: { type: 'string', default: '' },
    when: { type: 'condition' },
  },
  Bed: {
    bedType: enumOf('BedType', ['nap', 'sleep']),
    requires: { type: 'condition' },
    /** A handbook page the bed unlocks when it is used (design doc 7.4: the nap sofa gives 〈短暫午睡〉). */
    unlocks: { type: 'string', default: '' },
  },
};

/** Layers named "variant:<id>" are state variants switched on by their `when` property. */
export const VARIANT_PREFIX = 'variant:';
