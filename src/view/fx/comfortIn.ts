import type Phaser from 'phaser';
import { comfortOf, type Comfort } from '../../app/comfort.ts';
import type { Settings } from '../../core/index.ts';

/** The comfort assists as the player has them set now; the pause menu rewrites the registry entry. */
export const comfortIn = (scene: Phaser.Scene): Comfort => comfortOf(scene.registry.get('settings') as Settings | undefined);
