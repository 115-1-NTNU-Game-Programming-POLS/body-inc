import Phaser from 'phaser';
import { FixedStepLoop } from '../../app/loop.ts';
import { KeyboardInput } from '../../app/input.ts';
import type { Manifest } from '../../app/assets.ts';
import { createGame, parseRoom, selectOperator, TILE, type TiledMap } from '../../core/index.ts';
import { GREYBOX_MAP } from './BootScene.ts';
import { OperatorView } from '../actors/OperatorView.ts';
import { CollisionOverlay } from '../debug/CollisionOverlay.ts';

/** Renders a room and its actors from core snapshots; it never decides an outcome. */
export class WorldScene extends Phaser.Scene {
  private loop!: FixedStepLoop;
  private input_!: KeyboardInput;
  private operator!: OperatorView;
  private overlay!: CollisionOverlay;

  constructor() {
    super('World');
  }

  create(): void {
    const mapData = this.cache.tilemap.get(GREYBOX_MAP).data as TiledMap & {
      tilesets: readonly { name: string; margin: number; spacing: number }[];
    };
    const room = parseRoom(GREYBOX_MAP, mapData);
    this.loop = new FixedStepLoop(createGame(room, 1));
    this.registry.set('loop', this.loop);

    const map = this.make.tilemap({ key: GREYBOX_MAP });
    const tilesets = mapData.tilesets.map((t) => {
      const ts = map.addTilesetImage(t.name, t.name, TILE, TILE, t.margin, t.spacing);
      if (!ts) throw new Error(`tileset ${t.name} is not loaded`);
      return ts;
    });
    map.createLayer('floor', tilesets);
    map.createLayer('walls', tilesets);

    const manifest = this.cache.json.get('manifest') as Manifest;
    const entry = manifest.entries.find((e) => e.key === 'operator');
    if (!entry) throw new Error('manifest has no operator entry');
    this.operator = new OperatorView(this, entry);
    this.overlay = new CollisionOverlay(this, room.grid);

    const cam = this.cameras.main;
    cam.setZoom(2);
    cam.centerOn((room.grid.cols * TILE) / 2, (room.grid.rows * TILE) / 2);

    this.input_ = new KeyboardInput(window);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.input_.dispose());
    // Without a capture Phaser does not preventDefault, and F1 also opens the browser's help page.
    this.input.keyboard?.addCapture('F1');
    this.input.keyboard?.on('keydown-F1', () => this.overlay.toggle());
  }

  override update(_time: number, delta: number): void {
    const alpha = this.loop.advance(delta, () => this.input_.sample());
    const prev = selectOperator(this.loop.previous);
    const cur = selectOperator(this.loop.state);
    const x = prev.x + (cur.x - prev.x) * alpha;
    const y = prev.y + (cur.y - prev.y) * alpha;
    this.operator.render(cur, x, y);
    this.overlay.render(x, y);
  }
}
