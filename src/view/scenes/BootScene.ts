import Phaser from 'phaser';
import { atlasProblems, atlasUrls, type AsepriteJson, type AtlasIndex, type Manifest } from '../../app/assets.ts';
import { chapterContent, chapterLoop } from '../../app/chapters.ts';
import { CHAPTERS, DIALOGUES, DIALOGUE_TEXT, SPEAKERS, STRINGS, TAGS } from '../../app/content.ts';
import { portraitsUsed } from '../../app/dialogue.ts';
import { chapterOfRoom, gaugeFromQuery, halvesFromQuery, roomFromQuery, tagsFromQuery } from '../../app/session.ts';
import { browserStore, SaveStore, type SaveIssue } from '../../app/storage.ts';
import {
  EMPTY_TAGS, listProps, PROGRESS, roomsOf, SETTINGS, startChapter, STORY, type ChapterContent, type TagState, type TiledMapFile,
} from '../../core/index.ts';
import { glyphCorpus } from '../text/corpus.ts';
import { addSystemText, loadFonts, type FontGateResult } from '../text/fonts.ts';

/** Phaser cache key of a room's Tiled map; the room path is folder/map as in the chapter file. */
export const roomKey = (path: string): string => `room:${path}`;
/** Scene atlases packed by tools/art/pack_atlases.py; props are drawn from their frames. */
export const SCENE_ATLASES = ['atlas-brain', 'atlas-common', 'atlas-exam', 'atlas-liver'] as const;
/**
 * Every room of every bundled chapter is loaded up front, so a broken map stops Boot with its name
 * and a door never waits on the network. Revisit when a chapter's rooms are heavy enough to matter.
 */
const ALL_ROOMS: readonly string[] = [...new Set([...CHAPTERS.values()].flatMap(roomsOf))];

interface TilesetMeta {
  readonly image: string;
}

/**
 * Loads the manifest first, then every atlas it implies, the rooms of the chapters and the
 * tilesets they use, and validates them. Any failure ends on a readable problem list instead of
 * a blank canvas. A dev URL with ?room= goes straight into that room; otherwise the title opens.
 */
export class BootScene extends Phaser.Scene {
  private readonly failed: string[] = [];
  private fonts!: Promise<FontGateResult>;
  private devRoom: string | undefined;
  private tags: TagState = EMPTY_TAGS;
  private gauge: number | undefined;
  private halves: number | undefined;

  constructor() {
    super('Boot');
  }

  preload(): void {
    // Fonts load in parallel with the assets; no scene that draws text starts before both finish.
    this.fonts = loadFonts(glyphCorpus(STRINGS, DIALOGUE_TEXT));
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      this.failed.push(`failed to load ${file.url}`);
    });
    const query = import.meta.env.DEV ? window.location.search : '';
    try {
      this.devRoom = roomFromQuery(query);
      this.tags = tagsFromQuery(query, TAGS);
      this.gauge = gaugeFromQuery(query);
      this.halves = halvesFromQuery(query);
      if (this.devRoom !== undefined) {
        const chapter = CHAPTERS.get(chapterOfRoom(this.devRoom));
        if (!chapter || !roomsOf(chapter).includes(this.devRoom)) this.failed.push(`?room=${this.devRoom}: no bundled chapter lists this room`);
      }
    } catch (err) {
      this.failed.push(String(err));
    }
    this.load.json('manifest', 'assets/manifest.json');
    this.load.json('atlas-index', 'assets/atlases/index.json');
    this.load.json('tilesets', 'assets/tilesets/tilesets.json');
    for (const path of ALL_ROOMS) this.load.tilemapTiledJSON(roomKey(path), `assets/maps/${path}.tmj`);
    for (const key of SCENE_ATLASES) this.load.atlas(key, `assets/atlases/${key}.png`, `assets/atlases/${key}.json`);
  }

  create(): void {
    const manifest = this.cache.json.get('manifest') as Manifest | undefined;
    const index = this.cache.json.get('atlas-index') as AtlasIndex | undefined;
    const tilesets = this.cache.json.get('tilesets') as Record<string, TilesetMeta> | undefined;
    const maps = new Map<string, TiledMapFile>();
    for (const path of ALL_ROOMS) {
      const data = this.cache.tilemap.get(roomKey(path))?.data as TiledMapFile | undefined;
      if (data) maps.set(path, data);
      else this.failed.push(`${path}: map did not load`);
    }
    if (!manifest || !index || !tilesets || this.failed.length > 0) return this.fail();

    try {
      for (const e of manifest.entries) {
        const url = atlasUrls(index, e.key);
        this.load.aseprite(e.key, url.png, url.json);
      }
    } catch (err) {
      this.failed.push(String(err));
      return this.fail();
    }
    // Image-collection tilesets hold props, which come from the scene atlases instead. Rooms of a
    // chapter share sheets, so each is loaded once.
    const sheets = new Set([...maps.values()].flatMap((m) => m.tilesets.filter((t) => t.image !== undefined).map((t) => t.name)));
    for (const name of sheets) {
      const meta = tilesets[name];
      if (!meta) this.failed.push(`a map uses tileset ${name}, which tilesets.json does not list`);
      else this.load.image(name, meta.image);
    }
    // A portrait the check missed stops Boot here with its file name, not on the first conversation.
    for (const p of portraitsUsed(DIALOGUES, SPEAKERS)) this.load.image(p.key, p.url);
    this.load.once(Phaser.Loader.Events.COMPLETE, () => this.ready(manifest, maps));
    this.load.start();
  }

  private ready(manifest: Manifest, maps: ReadonlyMap<string, TiledMapFile>): void {
    for (const e of manifest.entries) {
      const atlas = this.cache.json.get(e.key) as AsepriteJson | undefined;
      if (atlas) this.failed.push(...atlasProblems(e, atlas));
      else this.failed.push(`${e.key}: atlas JSON missing`);
    }
    // Every variant's props of every room are checked, not only the active ones, so a bad frame
    // cannot hide until someone enters the room with the right tags.
    for (const [path, map] of maps) {
      const props = listProps(map);
      for (const p of props.problems) this.failed.push(`${path}: prop ${p.code}${'object' in p ? ` #${p.object}` : ''} in ${p.layer}`);
      for (const p of props.props) {
        if (!SCENE_ATLASES.some((k) => this.textures.get(k).has(p.frame))) {
          this.failed.push(`${path}: prop #${p.object} uses frame ${p.frame}, which no scene atlas has`);
        }
      }
    }
    if (this.failed.length > 0) return this.fail();
    for (const e of manifest.entries) this.anims.createFromAseprite(e.key);
    void this.fonts.then(({ problems }) => {
      this.failed.push(...problems);
      if (this.failed.length > 0) return this.fail();
      const contexts = new Map<string, ChapterContent>();
      try {
        for (const chapter of CHAPTERS.values()) {
          contexts.set(chapter.id, chapterContent(chapter, new Map(roomsOf(chapter).map((p) => [p, maps.get(p)!] as const))));
        }
      } catch (err) {
        this.failed.push(String(err));
        return this.fail();
      }
      this.loadSaves();
      this.registry.set('chapters', contexts);
      this.start(contexts);
    });
  }

  private start(contexts: ReadonlyMap<string, ChapterContent>): void {
    if (this.devRoom === undefined) {
      this.scene.start('Title');
      return;
    }
    const ctx = contexts.get(chapterOfRoom(this.devRoom))!;
    const state = startChapter(ctx, {
      room: this.devRoom,
      tags: this.tags,
      ...(this.gauge !== undefined ? { gauge: this.gauge } : {}),
      ...(this.halves !== undefined ? { halves: this.halves } : {}),
    });
    this.registry.set('loop', chapterLoop(ctx, state));
    this.scene.start('World');
    this.scene.launch('Hud');
  }

  /** Save problems never stop the game; they reach the HUD as notices (ux-spec section 8). */
  private loadSaves(): void {
    const saves = new SaveStore(browserStore(window));
    const settings = saves.load(SETTINGS);
    const story = saves.load(STORY);
    const progress = saves.load(PROGRESS);
    const issues: SaveIssue[] = [...settings.issues, ...story.issues, ...progress.issues];
    if (settings.needsWrite) issues.push(...saves.save(SETTINGS, settings.data));
    if (story.needsWrite) issues.push(...saves.save(STORY, story.data));
    if (progress.needsWrite) issues.push(...saves.save(PROGRESS, progress.data));
    this.registry.set('saves', saves);
    this.registry.set('settings', settings.data);
    this.registry.set('story', story.data);
    this.registry.set('progress', progress.data);
    this.registry.set('save-issues', issues);
  }

  private fail(): void {
    const lines = this.failed.length ? this.failed : ['a required boot file did not load'];
    addSystemText(this, 16, 16, ['Boot problems:', ...lines].join('\n'), '#ffb4a8');
  }
}
