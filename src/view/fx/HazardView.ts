import Phaser from 'phaser';
import { zoneFill, type GameState, type Shot } from '../../core/index.ts';
import { dashedCircle } from './telegraph.ts';

const RED = 0xc8372d;
/** Hatch period of fx-hatch-tile (art direction 9.2): 45-degree lines every 8 world px. */
const HATCH_PERIOD = 8;
// The toast wave borrows the cup until it has art of its own.
const SHOT_TEXTURES: Readonly<Record<string, string>> = { cup: 'fx-shot-cup', sheet: 'fx-shot-sheet', toast: 'fx-shot-cup' };

/**
 * Tier-2 areas and thrown shots, drawn from core state each frame. A tier-2 area is the
 * attack's real shape: a dashed red outline at full size from the first tick and 45-degree red
 * hatching that fills from the rim inward, complete on the tick it goes live (art direction
 * 9.2). Tier-3 areas are not drawn on the ground; their warning is the proposal on the boss.
 */
export class HazardView {
  private readonly scene: Phaser.Scene;
  private readonly ground: Phaser.GameObjects.Graphics;
  private readonly shots = new Map<number, Phaser.GameObjects.Image>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    // Ground decal depth (art direction 2.2): above the floor, below every actor.
    this.ground = scene.add.graphics().setDepth(10);
  }

  render(prev: GameState, cur: GameState, alpha: number): void {
    const g = this.ground.clear();
    for (const z of cur.zones) {
      if (z.tier !== 2) continue;
      dashedCircle(g, z.x, z.y, z.radius, RED);
      const inner = z.radius * (1 - zoneFill(z));
      hatchRing(g, z.x, z.y, z.radius, inner);
    }

    const before = new Map<number, Shot>(prev.shots.map((s) => [s.id, s]));
    const alive = new Set<number>();
    for (const s of cur.shots) {
      alive.add(s.id);
      const q = before.get(s.id) ?? s;
      let img = this.shots.get(s.id);
      if (!img) {
        img = this.scene.add.image(0, 0, SHOT_TEXTURES[s.kind] ?? 'fx-shot-sheet');
        this.shots.set(s.id, img);
      }
      const x = q.x + (s.x - q.x) * alpha;
      const y = q.y + (s.y - q.y) * alpha;
      // Lifted like staples: the core position is the shadow on the ground plane.
      img.setPosition(Math.round(x), Math.round(y - 12)).setDepth(y).setAlpha(s.spent ? 0.5 : 1);
    }
    for (const [id, img] of this.shots) {
      if (alive.has(id)) continue;
      img.destroy();
      this.shots.delete(id);
    }
  }
}

/** 45-degree lines clipped to the ring between `inner` and `outer`. */
function hatchRing(g: Phaser.GameObjects.Graphics, cx: number, cy: number, outer: number, inner: number): void {
  g.lineStyle(1.5, RED, 0.55);
  // Lines x - y = c, at perpendicular distance |c| / sqrt 2 from the centre.
  const reach = Math.floor((outer * Math.SQRT2) / HATCH_PERIOD) * HATCH_PERIOD;
  for (let c = -reach; c <= reach; c += HATCH_PERIOD) {
    const d = Math.abs(c) / Math.SQRT2;
    if (d >= outer) continue;
    const h = Math.sqrt(outer * outer - d * d);
    const hi = d < inner ? Math.sqrt(inner * inner - d * d) : 0;
    // Foot of the perpendicular from the centre, then along the line direction (1, 1) / sqrt 2.
    const fx = cx + c / 2;
    const fy = cy - c / 2;
    const seg = (t0: number, t1: number) => {
      g.lineBetween(fx + t0 / Math.SQRT2, fy + t0 / Math.SQRT2, fx + t1 / Math.SQRT2, fy + t1 / Math.SQRT2);
    };
    if (hi > 0) { seg(-h, -hi); seg(hi, h); } else seg(-h, h);
  }
}
