import Phaser from 'phaser';

/**
 * Placeholder effect textures (art direction 9.2) drawn in code until the art lead delivers
 * the real ones; a delivered texture with the same key replaces these without code changes.
 * Pixel sizes follow the art direction table.
 */
export const REFORM_STAGES = 8;

export function makeFxTextures(scene: Phaser.Scene): void {
  const g = scene.make.graphics({}, false);
  const make = (key: string, w: number, h: number, draw: () => void) => {
    if (scene.textures.exists(key)) return;
    g.clear();
    draw();
    g.generateTexture(key, w, h);
  };
  make('fx-paper', 3, 3, () => { g.fillStyle(0xf4efe4).fillRect(0, 0, 3, 3); });
  make('fx-ink', 2, 2, () => { g.fillStyle(0x2f5fa8).fillRect(0, 0, 2, 2); });
  make('fx-fuzz', 4, 4, () => { g.fillStyle(0xc9c2ee).fillRect(1, 0, 2, 4).fillRect(0, 1, 4, 2); });
  make('fx-sweat', 4, 6, () => { g.fillStyle(0xa8d4f0).fillRect(1, 0, 2, 2).fillRect(0, 2, 4, 4); });
  make('fx-staple', 6, 2, () => { g.fillStyle(0xd8dde6).fillRect(0, 0, 6, 2); });
  make('fx-afterimage', 1, 1, () => { g.fillStyle(0xffffff).fillRect(0, 0, 1, 1); });
  // Thrown attacks: a takeaway cup in the caffeine palette (art direction 5.5) and a folded flyer.
  make('fx-shot-cup', 6, 8, () => {
    g.fillStyle(0x6b4a3a).fillRect(0, 0, 6, 2);
    g.fillStyle(0xf4ebdd).fillRect(1, 2, 4, 6);
    g.fillStyle(0x8b5a3c).fillRect(1, 4, 4, 2);
  });
  make('fx-shot-sheet', 7, 6, () => {
    g.fillStyle(0x0c2d5e).fillRect(0, 0, 7, 6);
    g.fillStyle(0xf4efe4).fillRect(1, 1, 5, 4);
    g.fillStyle(0x0c2d5e).fillRect(2, 2, 3, 1);
  });
  // White "!" bubble, the tier-1 telegraph shape (12 x 14).
  make('fx-alert-bubble', 12, 14, () => {
    g.fillStyle(0xffffff).fillRect(1, 0, 10, 11).fillRect(0, 1, 12, 9).fillRect(4, 11, 3, 2);
    g.fillStyle(0x1f2a44).fillRect(5, 2, 2, 5).fillRect(5, 8, 2, 2);
  });
  // Reform ring: dashed purple circle filled in eight stages, as pixel textures rather than
  // vector lines, so it keeps the pixel edge under the 2x camera (art direction 9.1).
  for (let s = 1; s <= REFORM_STAGES; s++) {
    make(`fx-reform-ring-${s}`, 32, 32, () => {
      g.fillStyle(0x6a5fb8);
      const dots = 48;
      for (let i = 0; i < dots * (s / REFORM_STAGES); i++) {
        if (i % 3 === 2) continue;
        const a = (i / dots) * Math.PI * 2 - Math.PI / 2;
        g.fillRect(Math.round(16 + Math.cos(a) * 13) - 1, Math.round(16 + Math.sin(a) * 13) - 1, 2, 2);
      }
    });
  }
  g.destroy();
}
