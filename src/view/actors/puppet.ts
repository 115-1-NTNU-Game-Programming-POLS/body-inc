import type { Motion } from '../../app/assets.ts';
import type { EnemyState } from '../../core/index.ts';

/**
 * Paper-puppet walk (art direction 5.4, branch B of 15.3): regular enemies have one drawn walk
 * frame per direction, and walking is shown by swaying the sprite around its anchor and lifting
 * it on each step. The pose is computed from time rather than tweened, because EnemyView sets the
 * position every frame and bounce() kills the sprite's tweens.
 *
 * The sway holds three angles instead of turning smoothly: a nearest-neighbour rotation of a few
 * degrees breaks a 1 px outline and the face details differently on every frame, which shimmers
 * while walking. Three held poses are three renderings an artist can check (art direction 5.4).
 */
export const PUPPET_SWAY_DEG = 4;
export const PUPPET_PERIOD_MS = 400;
export const PUPPET_HOP_PX = 2;
/** The sine must pass this fraction of its swing for the puppet to tilt; below it the puppet stands upright. */
const TILT_ABOVE = 0.5;

/** `ms` counts from the start of the walk, so a puppet always sets off upright. */
export function puppetPose(ms: number): { angle: number; hop: number } {
  const s = Math.sin((ms / PUPPET_PERIOD_MS) * Math.PI * 2);
  const tilt = Math.abs(s) > TILT_ABOVE ? Math.sign(s) : 0;
  // Lifted while tilted: one step per side.
  return { angle: PUPPET_SWAY_DEG * tilt, hop: Math.abs(tilt) * PUPPET_HOP_PX };
}

export interface PuppetSway {
  /** When the current walk began, or undefined while the puppet is not swaying. */
  readonly since: number | undefined;
  readonly angle: number;
  /** Screen-space y offset; never positive, since a hop lifts the sprite. */
  readonly dy: number;
}

/**
 * One frame of the sway. Windup, strike and hurt are held poses that stay upright, so the
 * telegraph silhouette is never blurred. A puppet that stops goes upright in that same frame,
 * as a frame-animated enemy drops to its first frame: easing back would delay the pose the
 * player is watching for when the alert bubble appears.
 */
export function puppetSway(
  since: number | undefined,
  ms: number,
  motion: Motion | undefined,
  moving: boolean,
  enemy: Pick<EnemyState, 'phase' | 'frozen'>,
): PuppetSway {
  const swaying = motion === 'puppet' && moving && enemy.phase !== 'windup' && enemy.phase !== 'strike' && enemy.frozen === 0;
  if (!swaying) return { since: undefined, angle: 0, dy: 0 };
  const start = since ?? ms;
  const pose = puppetPose(ms - start);
  // 0 - hop, not -hop: a hop of 0 must stay 0 rather than become -0, which toEqual tells apart.
  return { since: start, angle: pose.angle, dy: 0 - pose.hop };
}
