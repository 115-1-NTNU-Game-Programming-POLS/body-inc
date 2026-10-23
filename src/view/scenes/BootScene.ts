import Phaser from 'phaser';
import { atlasProblems, atlasUrls, type AsepriteJson, type AtlasIndex, type Manifest } from '../../app/assets.ts';

export const GREYBOX_MAP = 'greybox-room';

interface TilesetMeta {
  readonly image: string;
}

/** Loads the manifest first, then every atlas and tileset it implies, and validates them. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    this.load.json('manifest', 'assets/manifest.json');
    this.load.json('atlas-index', 'assets/atlases/index.json');
    this.load.json('tilesets', 'assets/tilesets/tilesets.json');
    this.load.tilemapTiledJSON(GREYBOX_MAP, 'assets/maps/greybox/greybox-room.tmj');
  }

  create(): void {
    const manifest = this.cache.json.get('manifest') as Manifest;
    const index = this.cache.json.get('atlas-index') as AtlasIndex;
    const tilesets = this.cache.json.get('tilesets') as Record<string, TilesetMeta>;
    for (const e of manifest.entries) {
      const url = atlasUrls(index, e.key);
      this.load.aseprite(e.key, url.png, url.json);
    }
    for (const [name, meta] of Object.entries(tilesets)) this.load.image(name, meta.image);
    this.load.once(Phaser.Loader.Events.COMPLETE, () => this.ready(manifest));
    this.load.start();
  }

  private ready(manifest: Manifest): void {
    const problems = manifest.entries.flatMap((e) => atlasProblems(e, this.cache.json.get(e.key) as AsepriteJson));
    if (problems.length > 0) {
      this.add.text(16, 16, ['Asset problems:', ...problems].join('\n'), { color: '#ffb4a8', fontSize: '16px' });
      return;
    }
    for (const e of manifest.entries) this.anims.createFromAseprite(e.key);
    this.scene.start('World');
    this.scene.launch('Hud');
  }
}
