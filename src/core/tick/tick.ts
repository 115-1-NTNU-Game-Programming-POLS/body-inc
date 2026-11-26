import type { SolidGrid } from '../collision/grid.ts';
import type { EnemyState } from '../combat/actors.ts';
import type { Shot, Zone } from '../combat/hazards.ts';
import type { OperatorState, TickInput } from '../combat/operator.ts';
import type { Perks } from '../combat/perks.ts';
import type { Assists } from '../combat/assists.ts';
import type { Box } from '../collision/boxes.ts';
import type { stepOperator } from '../combat/operator.ts';
import type { DomainEvent, GameState, Projectile } from '../game.ts';

/**
 * The working set of one tick of `step` (src/core/game.ts): the values its phases read and write
 * on the way from one `GameState` to the next. `step` is the ordered list of phases, and each one
 * takes this object and changes only the fields it owns (docs/reviews/game-step.md, section 4):
 * `beginTick` (the operator, the partner, `stepRoom`), `stepEnemies`, `stepWeapons`, `stepHits`,
 * `stepAftermath`, then `settleTick` in game.ts, which builds the next state.
 *
 * It is mutable on purpose. A phase copies the fields it uses into locals on the way in, so its
 * closures keep the shape they had inside `step`, and writes back what it changed on the way out:
 * a field a phase changes and does not write back is lost to the phases after it, and only the
 * step characterization (test/core/step-characterization.test.ts) notices. What `step` returns
 * stays a new, immutable `GameState`.
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
  /** What the operator's own step did this tick: the swing, the stamp, the line and the circle that landed, the staple fired. */
  readonly stepped: ReturnType<typeof stepOperator>;
  readonly assists: Assists;
  readonly perks: Perks;
  /** How far an adenosine senses the operator this tick. */
  readonly senseRange: number;
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
  /** Staples in the air as the tick began, plus the one fired this tick; moved by the weapons. */
  projectiles: Projectile[];
  /** The enemies' shots in play, those of this tick's spawns included. */
  shots: Shot[];
  /** The operator's hurtbox as the hits are judged, which is also the box the fog reads: nothing before the hits moves the operator, and a knockback comes after. */
  readonly hurt: Box;
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
