import Phaser from 'phaser';
import { atlasProblems, atlasUrls, type AsepriteJson, type AtlasIndex, type Manifest } from '../../app/assets.ts';
import { STRINGS, TAGS } from '../../app/content.ts';
import { DEFAULT_ROOM, gaugeFromQuery, roomFromQuery, tagsFromQuery } from '../../app/session.ts';
import { browserStore, SaveStore, type SaveIssue } from '../../app/storage.ts';
import { EMPTY_TAGS, listProps, SETTINGS, type TagState, type TiledMapFile } from '../../core/index.ts';
import { glyphCorpus } from '../text/corpus.ts';
import { addSystemText, loadFonts, type FontGateResult } from '../text/fonts.ts';

/** Cache key of the room being played; its path is in the registry as 'room-path'. */
export const ROOM_MAP = 'room';
/** Scene atlases packed by tools/art/pack_atlases.py; props are drawn from their frames. */
export const SCENE_ATLASES = ['atlas-brain', 'atlas-common', 'atlas-exam', 'atlas-liver'] as const;

interface TilesetMeta {
  readonly image: string;
}

/**
 * Loads the manifest first, then every atlas it implies and the tilesets the map uses, and
 * validates them. Any failure ends on a readable problem list instead of a blank canvas.
 */
export class BootScene extends Phaser.Scene {
  private readonly failed: string[] = [];
  private fonts!: Promise<FontGateResult>;
  private roomPath = DEFAULT_ROOM;
  private tags: TagState = EMPTY_TAGS;
  private gauge: number | undefined;

  constructor() {
    super('Boot');
  }

  preload(): void {
    // Fonts load in parallel with the assets; no scene that draws text starts before both finish.
    this.fonts = loadFonts(glyphCorpus(STRINGS));
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      this.failed.push(`failed to load ${file.url}`);
    });
    const query = import.meta.env.DEV ? window.location.search : '';
    try {
      this.roomPath = roomFromQuery(query);
      this.tags = tagsFromQuery(query, TAGS);
      this.gauge = gaugeFromQuery(query);
    } catch (err) {
      this.failed.push(String(err));
    }
    this.load.json('manifest', 'assets/manifest.json');
    this.load.json('atlas-index', 'assets/atlases/index.json');
    this.load.json('tilesets', 'assets/tilesets/tilesets.json');
    this.load.tilemapTiledJSON(ROOM_MAP, `assets/maps/${this.roomPath}.tmj`);
    for (const key of SCENE_ATLASES) this.load.atlas(key, `assets/atlases/${key}.png`, `assets/atlases/${key}.json`);
  }

  create(): void {
    const manifest = this.cache.json.get('manifest') as Manifest | undefined;
    const index = this.cache.json.get('atlas-index') as AtlasIndex | undefined;
    const tilesets = this.cache.json.get('tilesets') as Record<string, TilesetMeta> | undefined;
    const map = this.cache.tilemap.get(ROOM_MAP)?.data as TiledMapFile | undefined;
    if (!manifest || !index || !tilesets || !map || this.failed.length > 0) return this.fail();

    try {
      for (const e of manifest.entries) {
        const url = atlasUrls(index, e.key);
        this.load.aseprite(e.key, url.png, url.json);
      }
    } catch (err) {
      this.failed.push(String(err));
      return this.fail();
    }
    // Image-collection tilesets hold props, which come from the scene atlases instead.
    for (const { name } of map.tilesets.filter((t) => t.image !== undefined)) {
      const meta = tilesets[name];
      if (!meta) this.failed.push(`map uses tileset ${name}, which tilesets.json does not list`);
      else this.load.image(name, meta.image);
    }
    this.load.once(Phaser.Loader.Events.COMPLETE, () => this.ready(manifest, map));
    this.load.start();
  }

  private ready(manifest: Manifest, map: TiledMapFile): void {
    for (const e of manifest.entries) {
      const atlas = this.cache.json.get(e.key) as AsepriteJson | undefined;
      if (atlas) this.failed.push(...atlasProblems(e, atlas));
      else this.failed.push(`${e.key}: atlas JSON missing`);
    }
    // Every variant's props are checked, not only the active ones, so a bad frame cannot hide
    // until someone enters the room with the right tags.
    const props = listProps(map);
    for (const p of props.problems) this.failed.push(`${this.roomPath}: prop ${p.code}${'object' in p ? ` #${p.object}` : ''} in ${p.layer}`);
    for (const p of props.props) {
      if (!SCENE_ATLASES.some((k) => this.textures.get(k).has(p.frame))) {
        this.failed.push(`${this.roomPath}: prop #${p.object} uses frame ${p.frame}, which no scene atlas has`);
      }
    }
    if (this.failed.length > 0) return this.fail();
    for (const e of manifest.entries) this.anims.createFromAseprite(e.key);
    void this.fonts.then(({ problems }) => {
      this.failed.push(...problems);
      if (this.failed.length > 0) return this.fail();
      this.loadSaves();
      this.registry.set('room-path', this.roomPath);
      this.registry.set('entry-tags', this.tags);
      this.registry.set('entry-gauge', this.gauge);
      this.scene.start('World');
      this.scene.launch('Hud');
    });
  }

  /** Save problems never stop the game; they reach the HUD as notices (ux-spec section 8). */
  private loadSaves(): void {
    const saves = new SaveStore(browserStore(window));
    const settings = saves.load(SETTINGS);
    const issues: SaveIssue[] = [...settings.issues];
    if (settings.needsWrite) issues.push(...saves.save(SETTINGS, settings.data));
    this.registry.set('saves', saves);
    this.registry.set('settings', settings.data);
    this.registry.set('save-issues', issues);
  }

  private fail(): void {
    const lines = this.failed.length ? this.failed : ['a required boot file did not load'];
    addSystemText(this, 16, 16, ['Boot problems:', ...lines].join('\n'), '#ffb4a8');
  }
}
