import Phaser from 'phaser';
import { BootScene } from './view/scenes/BootScene.ts';
import { HudScene } from './view/scenes/HudScene.ts';
import { WorldScene } from './view/scenes/WorldScene.ts';

// 1280 x 768 canvas; the world camera zooms 2x so a 640 x 384 room fills it (design doc 13.1).
new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 1280,
  height: 768,
  backgroundColor: '#0c1a33',
  pixelArt: true,
  roundPixels: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, WorldScene, HudScene],
});
