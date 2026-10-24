import Phaser from 'phaser';
import type { Manifest } from '../../app/assets.ts';
import { ENEMIES, FEEDBACK, PARAMS, STRINGS, TAGS } from '../../app/content.ts';
import { KeyboardInput } from '../../app/input.ts';
import { FixedStepLoop } from '../../app/loop.ts';
import {
  createGame, enterRoom, listProps, parseRoom, visibleProps, selectEnemies, selectOperator, selectProjectiles, selectStacks, spiritAtEntry, TILE,
  type DomainEvent, type EnemyState, type EnteredRoom, type GameState, type TagState, type TiledMapFile,
} from '../../core/index.ts';
import { EnemyView, SKINS } from '../actors/EnemyView.ts';
import { OperatorView } from '../actors/OperatorView.ts';
import { CollisionOverlay } from '../debug/CollisionOverlay.ts';
import { FeedbackPlayer } from '../fx/FeedbackPlayer.ts';
import { makeFxTextures } from '../fx/textures.ts';
import { ROOM_MAP, SCENE_ATLASES } from './BootScene.ts';

export interface WorldNote {
  readonly text: string;
  readonly worldX: number;
  readonly worldY: number;
}

/** Renders a room and its actors from core snapshots; it never decides an outcome. */
export class WorldScene extends Phaser.Scene {
  private loop!: FixedStepLoop;
  private input_!: KeyboardInput;
  private operator!: OperatorView;
  private overlay!: CollisionOverlay;
  private feedback!: FeedbackPlayer;
  private readonly enemyViews = new Map<number, EnemyView>();
  private readonly staples = new Map<number, Phaser.GameObjects.Image>();
  private readonly pending: DomainEvent[] = [];

  constructor() {
    super('World');
  }

  create(): void {
    const mapData = this.cache.tilemap.get(ROOM_MAP).data as TiledMapFile;
    const path = this.registry.get('room-path') as string;
    const tags = this.registry.get('entry-tags') as TagState;
    const room = enterRoom(parseRoom(path, mapData, TAGS), tags, TAGS);
    const gauge = this.registry.get('entry-gauge') as number | undefined;
    this.loop = new FixedStepLoop(createGame(room, 1, ENEMIES, {
      p: spiritAtEntry(tags, TAGS, PARAMS), ...(gauge !== undefined ? { gauge } : {}),
    }));
    this.registry.set('loop', this.loop);
    makeFxTextures(this);

    const map = this.make.tilemap({ key: ROOM_MAP });
    const tilesets = mapData.tilesets.filter((t) => t.image !== undefined).map((t) => {
      const ts = map.addTilesetImage(t.name, t.name, TILE, TILE, t.margin ?? 0, t.spacing ?? 0);
      if (!ts) throw new Error(`tileset ${t.name} is not loaded`);
      return ts;
    });
    map.createLayer('floor', tilesets);
    map.createLayer('walls', tilesets);
    this.drawProps(mapData, room);

    const manifest = this.cache.json.get('manifest') as Manifest;
    const entry = (key: string) => {
      const e = manifest.entries.find((m) => m.key === key);
      if (!e) throw new Error(`manifest has no ${key} entry`);
      return e;
    };
    this.operator = new OperatorView(this, entry('operator'), entry('adenosine-mini'));
    for (const e of this.loop.state.enemies) {
      const skin = SKINS[e.type];
      if (!skin) throw new Error(`no skin for enemy type ${e.type}; add it to SKINS in EnemyView.ts`);
      this.enemyViews.set(e.id, new EnemyView(this, entry(skin)));
    }
    this.overlay = new CollisionOverlay(this, this.loop.state);
    this.feedback = new FeedbackPlayer(this, FEEDBACK, STRINGS, {
      enemy: (id) => this.enemyViews.get(id),
      operator: this.operator,
      note: (text, worldX, worldY) => this.game.events.emit('world-note', { text, worldX, worldY } satisfies WorldNote),
    });
    // Events are collected while the loop steps and played after rendering, so feedback reads
    // sprite positions of the frame the player sees.
    this.loop.onEvent((e) => this.pending.push(e));

    const cam = this.cameras.main;
    cam.setZoom(2);
    cam.centerOn((room.grid.cols * TILE) / 2, (room.grid.rows * TILE) / 2);

    this.input_ = new KeyboardInput(window);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.input_.dispose());
    // Without a capture Phaser does not preventDefault, and F1 also opens the browser's help page.
    this.input.keyboard?.addCapture('F1');
    this.input.keyboard?.on('keydown-F1', () => this.overlay.toggle());
  }

  override update(time: number, delta: number): void {
    const alpha = this.loop.advance(delta, () => this.input_.sample());
    const state = this.loop.state;
    // A forced leave teleports everyone back to the start, so draw the new snapshot as is.
    const prevState = this.pending.some((e) => e.type === 'forcedLeave') ? state : this.loop.previous;
    const tick = state.tick;

    const prev = selectOperator(prevState);
    const cur = selectOperator(state);
    const x = prev.x + (cur.x - prev.x) * alpha;
    const y = prev.y + (cur.y - prev.y) * alpha;
    for (const e of this.pending) if (e.type === 'fire') this.operator.fired(tick);
    this.operator.render(cur, x, y, tick);
    this.operator.renderStacks(selectStacks(state).length);

    const before = new Map<number, Readonly<EnemyState>>(selectEnemies(prevState).map((e) => [e.id, e]));
    for (const e of selectEnemies(state)) this.enemyViews.get(e.id)?.render(before.get(e.id), e, alpha, tick, time);

    this.renderStaples(prevState, alpha);
    this.overlay.render(state);
    for (const e of this.pending.splice(0)) {
      if (e.type === 'stampLanded') this.stampRing(e.x, e.y, e.radius);
      this.feedback.play(e, tick);
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
  private drawProps(mapData: TiledMapFile, room: EnteredRoom): void {
    for (const p of visibleProps(listProps(mapData).props, room.active)) {
      const atlas = SCENE_ATLASES.find((k) => this.textures.get(k).has(p.frame));
      if (!atlas) throw new Error(`prop frame ${p.frame} is in no scene atlas`);
      this.add.image(p.x, p.y, atlas, p.frame).setOrigin(0, 0).setDepth(p.y + p.height);
    }
  }

  /** Staples are drawn 12 px above their ground position, rotated along their flight. */
  private renderStaples(prevState: GameState, alpha: number): void {
    const before = new Map(selectProjectiles(prevState).map((p) => [p.id, p]));
    const alive = new Set<number>();
    for (const p of selectProjectiles(this.loop.state)) {
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
