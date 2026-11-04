import type Phaser from 'phaser';
import type { PortraitFile } from '../app/dialogue.ts';

/**
 * Portraits are kept out of Boot (cold start budget, docs/perf/cold-start.md). They load through
 * plain images into the game's texture manager instead of a scene's loader, because the loader
 * stops with its scene and the title that starts this is left within seconds.
 */
const inFlight = new Map<string, Promise<boolean>>();

function loadOne(textures: Phaser.Textures.TextureManager, file: PortraitFile): Promise<boolean> {
  if (textures.exists(file.key)) return Promise.resolve(true);
  let p = inFlight.get(file.key);
  if (!p) {
    p = new Promise<boolean>((resolve) => {
      const image = new Image();
      image.onload = () => {
        if (!textures.exists(file.key)) textures.addImage(file.key, image);
        resolve(true);
      };
      image.onerror = () => {
        // Forgotten so a later conversation retries; the content check (npm run check) is what catches a missing file.
        inFlight.delete(file.key);
        console.error(`failed to load portrait ${file.url}`);
        resolve(false);
      };
      image.src = file.url;
    });
    inFlight.set(file.key, p);
  }
  return p;
}

/** Loads the portraits not yet in the texture manager. Resolves once every file has loaded or failed; a failure is logged with its file name. */
export async function loadPortraits(textures: Phaser.Textures.TextureManager, files: readonly PortraitFile[]): Promise<void> {
  await Promise.all(files.map((f) => loadOne(textures, f)));
}
