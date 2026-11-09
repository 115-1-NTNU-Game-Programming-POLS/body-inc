import Phaser from 'phaser';

const KEY = 'fx-fatigue-fog';
/** Twice the world view (1280 x 768 screen px at zoom 2), so it covers the screen wherever the operator stands. */
const W = 1280;
const H = 768;
/** The clear circle round the operator, in world px: about two and a half tiles, then a soft edge to the full fog. */
const CLEAR_PX = 80;
const EDGE_PX = 48;
const FOG_ALPHA = 0.85;
/** The fog fades in and out over this long, so starting and ending it is not a flash (art direction's comfort rules). */
const FADE_MS = 400;

/**
 * The sugar fatigue fog's shrunk view (design doc 7.5): the room dims beyond a small circle round
 * the operator while `fatigue` lasts. Only the view draws it; the rules know only the slow.
 */
export class FogView {
  private readonly image: Phaser.GameObjects.Image;
  private shown: boolean;

  /**
   * `foggy` is the state the room is entered in: a door rebuilds the scene, and fading the fog in
   * again there would show the new room clear for a moment, since the camera's own fade is shorter.
   */
  constructor(scene: Phaser.Scene, foggy: boolean) {
    if (!scene.textures.exists(KEY)) paint(scene);
    this.shown = foggy;
    // Over the actors and the room's labels, which the fog hides too; the HUD is its own scene above it.
    this.image = scene.add.image(0, 0, KEY).setDepth(2e4).setAlpha(foggy ? 1 : 0).setVisible(foggy);
  }

  render(scene: Phaser.Scene, foggy: boolean, x: number, y: number): void {
    this.image.setPosition(x, y);
    if (foggy === this.shown) return;
    this.shown = foggy;
    scene.tweens.killTweensOf(this.image);
    if (foggy) this.image.setVisible(true);
    scene.tweens.add({
      targets: this.image, alpha: foggy ? 1 : 0, duration: FADE_MS,
      onComplete: () => { if (!foggy) this.image.setVisible(false); },
    });
  }
}

function paint(scene: Phaser.Scene): void {
  const tex = scene.textures.createCanvas(KEY, W, H);
  if (!tex) return;
  const ctx = tex.getContext();
  const r = Math.hypot(W / 2, H / 2);
  const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, r);
  g.addColorStop(0, 'rgba(16, 19, 28, 0)');
  g.addColorStop(CLEAR_PX / r, 'rgba(16, 19, 28, 0)');
  g.addColorStop((CLEAR_PX + EDGE_PX) / r, `rgba(16, 19, 28, ${FOG_ALPHA})`);
  g.addColorStop(1, `rgba(16, 19, 28, ${FOG_ALPHA})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  tex.refresh();
}
