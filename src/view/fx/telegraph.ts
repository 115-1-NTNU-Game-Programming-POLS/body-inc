import type Phaser from 'phaser';

/** Ticks of the tier-1 telegraph that show a white flash: 0.00-0.08 s and 0.25-0.33 s. */
const FLASH_WINDOWS: ReadonlyArray<readonly [number, number]> = [[0, 5], [15, 20]];

/** `tick` counts from 0 at the start of the telegraph. */
export const tier1Flash = (tick: number): boolean => FLASH_WINDOWS.some(([a, b]) => tick >= a && tick < b);

/** Dashed ring, 8 on and 6 off in world pixels, turned by `phase` radians. */
export function dashedCircle(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, color: number, phase = 0): void {
  const step = 14 / r;
  const on = 8 / r;
  const end = phase + Math.PI * 2;
  g.lineStyle(1.5, color, 1);
  for (let a = phase; a < end; a += step) {
    g.beginPath();
    g.arc(cx, cy, r, a, Math.min(a + on, end));
    g.strokePath();
  }
}
