import Phaser from 'phaser';
import type { Manifest } from '../../app/assets.ts';
import { ENEMIES, FEEDBACK, STRINGS, TAGS } from '../../app/content.ts';
import { KeyboardInput } from '../../app/input.ts';
import { FixedStepLoop } from '../../app/loop.ts';
import {
  createGame, parseRoom, selectEnemies, selectOperator, selectProjectiles, TILE, type DomainEvent, type EnemyState, type GameState, type TiledMap,
} from '../../core/index.ts';
import { EnemyView, SKINS } from '../actors/EnemyView.ts';
import { OperatorView } from '../actors/OperatorView.ts';
import { CollisionOverlay } from '../debug/CollisionOverlay.ts';
import { FeedbackPlayer } from '../fx/FeedbackPlayer.ts';
import { makeFxTextures } from '../fx/textures.ts';
import { GREYBOX_MAP } from './BootScene.ts';

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
    const mapData = this.cache.tilemap.get(GREYBOX_MAP).data as TiledMap & {
      tilesets: readonly { name: string; margin: number; spacing: number }[];
    };
    const room = parseRoom(GREYBOX_MAP, mapData, TAGS);
    this.loop = new FixedStepLoop(createGame(room, 1, ENEMIES));
    this.registry.set('loop', this.loop);
    makeFxTextures(this);

    const map = this.make.tilemap({ key: GREYBOX_MAP });
    const tilesets = mapData.tilesets.map((t) => {
      const ts = map.addTilesetImage(t.name, t.name, TILE, TILE, t.margin, t.spacing);
      if (!ts) throw new Error(`tileset ${t.name} is not loaded`);
      return ts;
    });
    map.createLayer('floor', tilesets);
    map.createLayer('walls', tilesets);

    const manifest = this.cache.json.get('manifest') as Manifest;
    const entry = (key: string) => {
      const e = manifest.entries.find((m) => m.key === key);
      if (!e) throw new Error(`manifest has no ${key} entry`);
      return e;
    };
    this.operator = new OperatorView(this, entry('operator'));
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

    const before = new Map<number, Readonly<EnemyState>>(selectEnemies(prevState).map((e) => [e.id, e]));
    for (const e of selectEnemies(state)) this.enemyViews.get(e.id)?.render(before.get(e.id), e, alpha, tick, time);

    this.renderStaples(prevState, alpha);
    this.overlay.render(state);
    for (const e of this.pending.splice(0)) this.feedback.play(e, tick);
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
