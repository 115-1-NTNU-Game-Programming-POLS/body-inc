import Phaser from 'phaser';
import { atlasProblems, atlasUrls, type AsepriteJson, type AtlasIndex, type Manifest } from '../../app/assets.ts';

export const GREYBOX_MAP = 'greybox-room';

interface TilesetMeta {
  readonly image: string;
}

/**
 * Loads the manifest first, then every atlas it implies and the tilesets the map uses, and
 * validates them. Any failure ends on a readable problem list instead of a blank canvas.
 */
export class BootScene extends Phaser.Scene {
  private readonly failed: string[] = [];

  constructor() {
    super('Boot');
  }

  preload(): void {
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      this.failed.push(`failed to load ${file.url}`);
    });
    this.load.json('manifest', 'assets/manifest.json');
    this.load.json('atlas-index', 'assets/atlases/index.json');
    this.load.json('tilesets', 'assets/tilesets/tilesets.json');
    this.load.tilemapTiledJSON(GREYBOX_MAP, 'assets/maps/greybox/greybox-room.tmj');
  }

  create(): void {
    const manifest = this.cache.json.get('manifest') as Manifest | undefined;
    const index = this.cache.json.get('atlas-index') as AtlasIndex | undefined;
    const tilesets = this.cache.json.get('tilesets') as Record<string, TilesetMeta> | undefined;
    const map = this.cache.tilemap.get(GREYBOX_MAP)?.data as { tilesets: readonly { name: string }[] } | undefined;
    if (!manifest || !index || !tilesets || !map) return this.fail();

    try {
      for (const e of manifest.entries) {
        const url = atlasUrls(index, e.key);
        this.load.aseprite(e.key, url.png, url.json);
      }
    } catch (err) {
      this.failed.push(String(err));
      return this.fail();
    }
    for (const { name } of map.tilesets) {
      const meta = tilesets[name];
      if (!meta) this.failed.push(`map uses tileset ${name}, which tilesets.json does not list`);
      else this.load.image(name, meta.image);
    }
    this.load.once(Phaser.Loader.Events.COMPLETE, () => this.ready(manifest));
    this.load.start();
  }

  private ready(manifest: Manifest): void {
    for (const e of manifest.entries) {
      const atlas = this.cache.json.get(e.key) as AsepriteJson | undefined;
      if (atlas) this.failed.push(...atlasProblems(e, atlas));
      else this.failed.push(`${e.key}: atlas JSON missing`);
    }
    if (this.failed.length > 0) return this.fail();
    for (const e of manifest.entries) this.anims.createFromAseprite(e.key);
    this.scene.start('World');
    this.scene.launch('Hud');
  }

  private fail(): void {
    const lines = this.failed.length ? this.failed : ['a required boot file did not load'];
    this.add.text(16, 16, ['Asset problems:', ...lines].join('\n'), { color: '#ffb4a8', fontSize: '16px' });
  }
}
