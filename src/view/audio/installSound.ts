import Phaser from 'phaser';
import { AUDIO } from '../../app/content.ts';
import { Sound, type SoundContext } from '../../app/sound.ts';
import type { Settings } from '../../core/index.ts';

type ContextClass = new () => SoundContext;

/**
 * The one set of speakers of the page, put in the registry for every scene. Browsers start audio
 * only after a gesture, so the first press or key unlocks it; the volumes follow the settings.
 */
export function installSound(game: Phaser.Game): Sound {
  const sound = new Sound(AUDIO, {
    settings: () => game.registry.get('settings') as Settings | undefined,
    makeContext: () => {
      const Context = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: ContextClass }).webkitAudioContext) as ContextClass | undefined;
      return Context ? new Context() : undefined;
    },
    makePlayer: () => new Audio(),
    now: () => performance.now(),
    musicBase: 'assets/audio/music/',
  });
  for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, () => sound.unlock(), true);
  document.addEventListener('visibilitychange', () => sound.hidden(document.hidden));
  game.registry.events.on('changedata-settings', () => sound.apply());
  game.registry.set('sound', sound);
  return sound;
}

/** The speakers, or undefined before Boot has made them. */
export const soundIn = (scene: Phaser.Scene): Sound | undefined => scene.registry.get('sound') as Sound | undefined;

/** Plays a cue by id on the scene's speakers. */
export const playCue = (scene: Phaser.Scene, id: string): void => {
  soundIn(scene)?.cue(id);
};
