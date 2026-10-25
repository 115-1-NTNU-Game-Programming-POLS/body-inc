import Phaser from 'phaser';
import type { Manifest, ManifestEntry } from '../../app/assets.ts';
import { FEEDBACK, STRINGS } from '../../app/content.ts';
import { sharedKeys, type KeyboardInput } from '../../app/input.ts';
import type { FixedStepLoop } from '../../app/loop.ts';
import type { SaveStore } from '../../app/storage.ts';
import {
  listProps, selectEnemies, selectOperator, selectProjectiles, storyOf, STORY, TILE, visibleProps,
  type ChapterState, type EnemyState, type GameEvent, type GameState, type TiledMapFile,
} from '../../core/index.ts';
import { BossView } from '../actors/BossView.ts';
import { EnemyView, SKINS } from '../actors/EnemyView.ts';
import { OperatorView } from '../actors/OperatorView.ts';
import { drawRoomObjects } from '../actors/RoomObjects.ts';
import { CollisionOverlay } from '../debug/CollisionOverlay.ts';
import { FeedbackPlayer, type ActorFx } from '../fx/FeedbackPlayer.ts';
import { HazardView } from '../fx/HazardView.ts';
import { makeFxTextures } from '../fx/textures.ts';
import { roomKey, SCENE_ATLASES } from './BootScene.ts';

export interface WorldNote {
  readonly text: string;
  readonly worldX: number;
  readonly worldY: number;
}

const FADE_MS = 160;

/** Renders a room and its actors from core snapshots; it never decides an outcome. */
export class WorldScene extends Phaser.Scene {
  private loop!: FixedStepLoop<ChapterState, GameEvent>;
  private input_!: KeyboardInput;
  private operator!: OperatorView;
  private overlay!: CollisionOverlay;
  private feedback!: FeedbackPlayer;
  private hazards!: HazardView;
  private entry!: (key: string) => ManifestEntry;
  private readonly enemyViews = new Map<number, EnemyView>();
  private readonly bossViews = new Map<number, BossView>();
  private readonly staples = new Map<number, Phaser.GameObjects.Image>();
  private readonly pending: GameEvent[] = [];
  /** True from the moment a room change is seen until the scene restarts; the rules stop meanwhile. */
  private leaving = false;

  constructor() {
    super('World');
  }

  /**
   * Builds the room the chapter is in. Moving to another room restarts the scene, and the loop
   * (which lives in the registry) carries on from there, so every field below is reset here.
   */
  create(): void {
    this.loop = this.registry.get('loop') as FixedStepLoop<ChapterState, GameEvent>;
    this.enemyViews.clear();
    this.bossViews.clear();
    this.staples.clear();
    this.pending.length = 0;
    this.leaving = false;

    const chapter = this.loop.state;
    const room = chapter.game.room;
    const mapData = this.cache.tilemap.get(roomKey(chapter.run.roomId)).data as TiledMapFile;
    makeFxTextures(this);

    const map = this.make.tilemap({ key: roomKey(chapter.run.roomId) });
    const tilesets = mapData.tilesets.filter((t) => t.image !== undefined).map((t) => {
      const ts = map.addTilesetImage(t.name, t.name, TILE, TILE, t.margin ?? 0, t.spacing ?? 0);
      if (!ts) throw new Error(`tileset ${t.name} is not loaded`);
      return ts;
    });
    map.createLayer('floor', tilesets);
    map.createLayer('walls', tilesets);
    this.drawProps(mapData, room.active);

    const manifest = this.cache.json.get('manifest') as Manifest;
    drawRoomObjects(this, room, manifest);
    this.entry = (key: string) => {
      const e = manifest.entries.find((m) => m.key === key);
      if (!e) throw new Error(`manifest has no ${key} entry`);
      return e;
    };
    this.operator = new OperatorView(this, this.entry('operator'), this.entry('adenosine-mini'));
    this.hazards = new HazardView(this);
    this.syncViews(chapter.game);
    this.overlay = new CollisionOverlay(this, chapter.game);
    this.feedback = new FeedbackPlayer(this, FEEDBACK, STRINGS, {
      enemy: (id): ActorFx | undefined => this.bossViews.get(id) ?? this.enemyViews.get(id),
      operator: this.operator,
      note: (text, worldX, worldY) => this.game.events.emit('world-note', { text, worldX, worldY } satisfies WorldNote),
    });
    // Events are collected while the loop steps and played after rendering, so feedback reads
    // sprite positions of the frame the player sees. The loop outlives this scene, so the
    // listener must go when the scene does.
    const off = this.loop.onEvent((e) => this.pending.push(e));

    const cam = this.cameras.main;
    cam.setZoom(2);
    cam.centerOn((room.grid.cols * TILE) / 2, (room.grid.rows * TILE) / 2);
    cam.fadeIn(FADE_MS);

    // One keyboard tracker for the whole run: a new one per room would not know which keys are
    // already down when the operator walks through a door, and would ignore them until the
    // keyboard's own auto-repeat started.
    this.input_ = sharedKeys(this.registry, window);
    this.input_.clearPresses();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, off);
    // Without a capture Phaser does not preventDefault, and F1 also opens the browser's help page.
    this.input.keyboard?.addCapture('F1');
    this.input.keyboard?.on('keydown-F1', () => this.overlay.toggle());

    const arrival = this.registry.get('arrival-note') as string | undefined;
    if (arrival) {
      this.registry.set('arrival-note', undefined);
      this.note(arrival);
    }
  }

  override update(time: number, delta: number): void {
    if (this.leaving) return;
    const alpha = this.loop.advance(delta, () => this.input_.sample());
    // On the tick a room is left the state already holds the next room, which this scene has no
    // views for: handle the exit and draw nothing more of it.
    if (this.pending.some((e) => e.type === 'roomChanged' || e.type === 'returnedToCheckpoint' || e.type === 'chapterEnded')) {
      for (const e of this.pending.splice(0)) this.react(e);
      return;
    }
    const chapter = this.loop.state;
    const state = chapter.game;
    // A forced leave teleports everyone back to the start, so draw the new snapshot as is.
    const prevState = this.pending.some((e) => e.type === 'forcedLeave') ? state : this.loop.previous.game;
    const tick = state.tick;

    const prev = selectOperator(prevState);
    const cur = selectOperator(state);
    const x = prev.x + (cur.x - prev.x) * alpha;
    const y = prev.y + (cur.y - prev.y) * alpha;
    for (const e of this.pending) if (e.type === 'fire') this.operator.fired(tick);
    this.operator.render(cur, x, y, tick);
    this.operator.renderStacks(cur.stacks);

    this.syncViews(state);
    const before = new Map<number, Readonly<EnemyState>>(selectEnemies(prevState).map((e) => [e.id, e]));
    for (const e of selectEnemies(state)) {
      if (e.boss) {
        const pinned = state.enemies.filter((x) => x.summoner === e.id && x.phase === 'pinned').length;
        this.bossViews.get(e.id)?.render(before.get(e.id), e, state.bosses[e.boss.def]!, pinned, alpha, tick);
      } else this.enemyViews.get(e.id)?.render(before.get(e.id), e, alpha, tick, time);
    }

    this.hazards.render(prevState, state, alpha);
    this.renderStaples(prevState, alpha);
    this.overlay.render(state);
    for (const e of this.pending.splice(0)) {
      if (e.type === 'stampLanded') this.stampRing(e.x, e.y, e.radius);
      this.react(e);
      this.feedback.play(e, tick);
    }
  }

  /** What the chapter's own events ask of the screen: saving, dialogue, leaving the room. */
  private react(e: GameEvent): void {
    switch (e.type) {
      case 'checkpointSaved': {
        const saves = this.registry.get('saves') as SaveStore;
        const story = storyOf(this.loop.state.run);
        const issues = saves.save(STORY, story);
        if (issues.length > 0) this.game.events.emit('save-issues', issues);
        // The title reads this copy, so it must follow the slot even when the write failed.
        this.registry.set('story', story);
        break;
      }
      case 'handbookUnlocked':
        // No handbook screen exists yet (build plan P6), so the note is the only sign of the unlock.
        this.note(STRINGS.strings['handbook.unlocked']!.text);
        break;
      case 'roomChanged':
        this.leave(() => this.scene.restart());
        break;
      case 'returnedToCheckpoint':
        this.registry.set('arrival-note', STRINGS.strings['checkpoint.returned']!.text);
        this.leave(() => this.scene.restart());
        break;
      case 'chapterEnded':
        this.registry.set('ended', true);
        this.leave(() => {
          this.scene.stop('Hud');
          this.scene.start('Title');
        });
        break;
      default:
        break;
    }
  }

  /** Fades out with the rules stopped, then runs `then`; the next room starts from the loop's state. */
  private leave(then: () => void): void {
    if (this.leaving) return;
    this.leaving = true;
    this.cameras.main.fadeOut(FADE_MS);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, then);
  }

  private note(text: string): void {
    const op = selectOperator(this.loop.state.game);
    this.game.events.emit('world-note', { text, worldX: op.x, worldY: op.y - 36 } satisfies WorldNote);
  }

  /**
   * One view per enemy in the snapshot. Bosses summon enemies mid-fight and a forced leave sends
   * them away, so views are made and dropped as ids come and go.
   */
  private syncViews(state: GameState): void {
    const ids = new Set(state.enemies.map((e) => e.id));
    for (const e of state.enemies) {
      if (this.enemyViews.has(e.id) || this.bossViews.has(e.id)) continue;
      const skin = SKINS[e.type];
      if (!skin) throw new Error(`no skin for enemy type ${e.type}; add it to SKINS in EnemyView.ts`);
      if (e.boss) this.bossViews.set(e.id, new BossView(this, this.entry(skin), this.entry('adenosine-mini')));
      else this.enemyViews.set(e.id, new EnemyView(this, this.entry(skin)));
    }
    for (const [id, v] of this.enemyViews) {
      if (ids.has(id)) continue;
      v.destroy();
      this.enemyViews.delete(id);
    }
  }

  /** The area the stamp covered, from the event itself so the ring matches the rule radius. */
  private stampRing(x: number, y: number, radius: number): void {
    const g = this.add.graphics().setDepth(1e5);
    g.lineStyle(2, 0xc8372d, 1).strokeCircle(x, y, radius);
    this.tweens.add({ targets: g, alpha: 0, duration: 300, onComplete: () => g.destroy() });
  }

  /**
   * Base props plus those of the variants active at entry. Boot already checked every frame
   * exists, so a miss here is a bug. Depth is the prop's bottom edge, like actors' feet.
   */
  private drawProps(mapData: TiledMapFile, active: readonly string[]): void {
    for (const p of visibleProps(listProps(mapData).props, active)) {
      const atlas = SCENE_ATLASES.find((k) => this.textures.get(k).has(p.frame));
      if (!atlas) throw new Error(`prop frame ${p.frame} is in no scene atlas`);
      this.add.image(p.x, p.y, atlas, p.frame).setOrigin(0, 0).setDepth(p.y + p.height);
    }
  }

  /** Staples are drawn 12 px above their ground position, rotated along their flight. */
  private renderStaples(prevState: GameState, alpha: number): void {
    const before = new Map(selectProjectiles(prevState).map((p) => [p.id, p]));
    const alive = new Set<number>();
    for (const p of selectProjectiles(this.loop.state.game)) {
      alive.add(p.id);
      const q = before.get(p.id) ?? p;
      let img = this.staples.get(p.id);
      if (!img) {
        img = this.add.image(0, 0, 'fx-staple').setRotation(Math.atan2(p.vy, p.vx));
        this.staples.set(p.id, img);
      }
      const px = q.x + (p.x - q.x) * alpha;
      const py = q.y + (p.y - q.y) * alpha;
      img.setPosition(Math.round(px), Math.round(py - 12)).setDepth(py);
    }
    for (const [id, img] of this.staples) {
      if (!alive.has(id)) {
        img.destroy();
        this.staples.delete(id);
      }
    }
  }
}
