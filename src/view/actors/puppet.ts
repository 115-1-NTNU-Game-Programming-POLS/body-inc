/**
 * Paper-puppet walk (art direction 5.4, branch B of 15.3): regular enemies have one drawn walk
 * frame per direction, and walking is shown by swaying the sprite around its anchor and lifting
 * it on each step. The pose is computed from time rather than tweened, because EnemyView sets the
 * position every frame and bounce() kills the sprite's tweens.
 */
export const PUPPET_SWAY_DEG = 4;
export const PUPPET_PERIOD_MS = 400;
export const PUPPET_HOP_PX = 2;

/** `ms` counts from the start of the walk, so a puppet always sets off upright. */
export function puppetPose(ms: number): { angle: number; hop: number } {
  const s = Math.sin((ms / PUPPET_PERIOD_MS) * Math.PI * 2);
  // Lifted at each end of the sway: one step per side.
  return { angle: PUPPET_SWAY_DEG * s, hop: Math.round(Math.abs(s) * PUPPET_HOP_PX) };
}
