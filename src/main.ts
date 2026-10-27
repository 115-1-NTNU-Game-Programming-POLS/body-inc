import Phaser from 'phaser';
import { BootScene } from './view/scenes/BootScene.ts';
import { CardScene } from './view/scenes/CardScene.ts';
import { RescueScene } from './view/scenes/RescueScene.ts';
import { DialogueScene } from './view/scenes/DialogueScene.ts';
import { HandbookScene } from './view/scenes/HandbookScene.ts';
import { HudScene } from './view/scenes/HudScene.ts';
import { OpeningScene } from './view/scenes/OpeningScene.ts';
import { TitleScene } from './view/scenes/TitleScene.ts';
import { WorldScene } from './view/scenes/WorldScene.ts';

// 1280 x 768 canvas; the world camera zooms 2x so a 640 x 384 room fills it (design doc 13.1).
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 1280,
  height: 768,
  backgroundColor: '#0c1a33',
  pixelArt: true,
  roundPixels: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  // Draw order: later scenes are on top, so conversations and event cards cover the HUD.
  scene: [BootScene, TitleScene, OpeningScene, WorldScene, HudScene, DialogueScene, CardScene, RescueScene, HandbookScene],
});

// Dev builds only: lets the browser console and automated checks inspect scenes and frame rate.
if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;
