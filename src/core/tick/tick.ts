import type { SolidGrid } from '../collision/grid.ts';
import type { EnemyState } from '../combat/actors.ts';
import type { Shot, Zone } from '../combat/hazards.ts';
import type { OperatorState, TickInput } from '../combat/operator.ts';
import type { DomainEvent, GameState, Projectile } from '../game.ts';

/**
 * The working set of one tick of `step` (src/core/game.ts): the values its phases read and write
 * on the way from one `GameState` to the next. Issue #75 moves the phases of `step` out one at a
 * time (docs/reviews/game-step.md, section 4); each phase will take this object and change only
 * the fields it owns, and `step` will be the ordered list of those calls.
 *
 * It is mutable on purpose. `step` already works this way inside, with `let`s and Maps that later
 * phases see changed; the object only gives those variables one name. What `step` returns stays
 * a new, immutable `GameState`.
 *
 * For now only the last phase, `settleTick`, takes it, so the fields are the ones it reads. The
 * next steps of the refactor add the fields of the phases they move.
 */
export interface Tick {
  /** The state the tick started from. */
  readonly state: GameState;
  /** The input as the player gave it, before sleep or the locks gated it. */
  readonly pressed: TickInput;
  /** The input the rules act on: `pressed` after sleep and the locks. */
  readonly input: TickInput;
  /** The tick being stepped: `state.tick`. */
  readonly now: number;
  /** An exam question is being answered in this room this tick. */
  readonly examining: boolean;
  /** Everything that happened this tick, in order. */
  readonly events: DomainEvent[];
  /** The events of doors, triggers and beds touched this tick; a lethal tick drops them. */
  readonly roomEvents: readonly DomainEvent[];

  op: OperatorState;
  /** The room's enemies by id. Within a tick they are only added, never removed. */
  enemies: Map<number, EnemyState>;
  /** Staples still in flight after this tick, and the shots parried back into flight. */
  flying: Projectile[];
  /** Shots after their move this tick. */
  movedShots: Shot[];
  /** Waves (`owner:wave`) that reached the operator this tick: every shot of them is spent. */
  settled: Set<string>;
  zones: Map<number, Zone>;
  nextId: number;
  rng: GameState['rng'];
  clock: GameState['clock'];
  /** Frames of hit-stop this tick's hits call for. */
  freeze: number;
  /** The grid as this tick left it: walls, boxes, orders. */
  grid: SolidGrid;

  /** Objects the operator stood on when the doors were judged this tick. */
  touchingNow: readonly number[];
  carried: number;
  switches: GameState['switches'];
  doorsOpen: GameState['doorsOpen'];
  taken: GameState['taken'];
  boxes: GameState['boxes'];
  push: GameState['push'];
  delivered: GameState['delivered'];
  chilled: GameState['chilled'];
  /** The room with this tick's dissolved chunks taken out; `state.room` when none dissolved. */
  room: GameState['room'];
  dissolved: GameState['dissolved'];
  cooling: NonNullable<GameState['cooling']>;
  orderSerial: number;
  pie: GameState['pie'];
  unload: GameState['unload'];
  factory: GameState['factory'];
  mixer: GameState['mixer'];
  sleep: GameState['sleep'];
  bind: GameState['bind'];
  boostUntil: GameState['boostUntil'];
}

/** The tick's enemies in ascending id order, which is the order `GameState.enemies` keeps. */
export const enemiesById = (t: Pick<Tick, 'enemies'>): EnemyState[] =>
  [...t.enemies.keys()].sort((a, b) => a - b).map((id) => t.enemies.get(id)!);

/** The key of the wave a shot belongs to, or undefined for a shot that is not part of one. */
export const waveKey = (sh: Shot): string | undefined => (sh.wave === undefined ? undefined : `${sh.owner}:${sh.wave}`);
