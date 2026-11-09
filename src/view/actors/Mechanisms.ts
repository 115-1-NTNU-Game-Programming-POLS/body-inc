import Phaser from 'phaser';
import {
  conveyorTiles, directionOf, dockTiles, hopperTiles, isSpawnedCrate, MIST, objectBox, outletTile, PARCEL, selectBoxes, selectConveyors, selectDoorLocks, selectFactory,
  selectMixer, selectPickups, selectPort, selectSwitches, TILE, type BoxState, type GameState, type RoomObject,
} from '../../core/index.ts';
import { fillStr } from '../../app/content.ts';
import { addText, updateText } from '../text/fonts.ts';

const INK = 0x0c2d5e;
const PAPER = 0xf4efe4;
const BLUE = 0x2f5fa8;
const GREY = 0x8a8780;

/**
 * Placeholder pictures for switches, pickups and door locks, redrawn only when their state changes. A
 * locked door carries an ink-blue plate whose icon names the lock (art direction 4: key, switch,
 * clock, resource); the plate comes off when the door opens. Real art replaces these later.
 */
export class Mechanisms {
  private readonly levers = new Map<number, { g: Phaser.GameObjects.Graphics; o: RoomObject; on?: boolean }>();
  private readonly plates = new Map<number, Phaser.GameObjects.Graphics>();
  private readonly items = new Map<number, Phaser.GameObjects.Graphics>();
  /** A food box keeps its id when the mixer turns it into a parcel, so the type drawn is kept to redraw it then. */
  private readonly boxes = new Map<number, { g: Phaser.GameObjects.Graphics; type: string }>();
  private mixer: { gauge: Phaser.GameObjects.Graphics; o: RoomObject; drawn?: string } | undefined;
  private readonly belts = new Map<number, { g: Phaser.GameObjects.Graphics; o: RoomObject; drawn?: string }>();
  private port: { g: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text; o: RoomObject; drawn?: string; text?: string } | undefined;
  private factory: { dock: Phaser.GameObjects.Graphics; fog: Phaser.GameObjects.Graphics; dockDrawn?: number; fogDrawn?: readonly BoxState[] } | undefined;
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene, state: GameState) {
    this.scene = scene;
    const byId = new Map(state.room.objects.map((o) => [o.id, o]));
    // Belts lie on the floor (tile layers sit at depth 0), under everything that stands on them, whose depth is its feet line.
    for (const c of selectConveyors(state)) this.belts.set(c.object, { g: scene.add.graphics().setDepth(1), o: byId.get(c.object)! });
    const port = selectPort(state);
    if (port) {
      const o = byId.get(port.object)!;
      const b = objectBox(o);
      // A timed gate's countdown is long, so it is right-aligned to grow away from what lies east, such as a wall belt.
      const timed = port.gate !== undefined;
      const label = addText(scene, timed ? b.right : (b.left + b.right) / 2, b.top - 4, '', { role: 'print', weight: 700, size: 14, color: '#0c2d5e', backgroundColor: '#f4efe4', padding: { x: 4, y: 1 } })
        .setOrigin(timed ? 1 : 0.5, 1).setDepth(1e4);
      this.port = { g: scene.add.graphics().setDepth(1), label, o };
    }
    const factory = selectFactory(state);
    if (factory) {
      // The intake and outlet lie on the floor; the dock stands like a counter, drawn at its feet line.
      const floor = scene.add.graphics().setDepth(1);
      if (factory.intake) drawIntake(floor, factory.intake);
      const out = outletTile(state.room);
      if (out) drawOutlet(floor, out.col, out.row);
      const dock = dockTiles(state.room);
      const bottom = Math.max(...dock.map((t) => (t.row + 1) * TILE));
      this.factory = { dock: scene.add.graphics().setDepth(bottom), fog: scene.add.graphics().setDepth(2) };
    }
    const mix = selectMixer(state);
    if (mix) {
      const floor = scene.add.graphics().setDepth(1);
      drawHopper(floor, hopperTiles(state.room));
      if (mix.outlet) drawOutlet(floor, mix.outlet.col, mix.outlet.row);
      this.mixer = { gauge: scene.add.graphics().setDepth(1e4), o: mix.mixer };
    }
    for (const p of selectPickups(state)) {
      const o = byId.get(p.object)!;
      const g = scene.add.graphics().setDepth(objectBox(o).bottom);
      drawItem(g, o, p.itemType);
      this.items.set(p.object, g);
    }
    for (const s of selectSwitches(state)) {
      const o = byId.get(s.object)!;
      // A plate is flat on the floor like a belt, so a box resting on it is drawn on top.
      const depth = s.mode === 'hold' ? 1 : objectBox(o).bottom;
      this.levers.set(s.object, { g: scene.add.graphics().setDepth(depth), o });
    }
    for (const d of selectDoorLocks(state)) {
      const o = byId.get(d.object)!;
      const g = scene.add.graphics().setDepth(1e4);
      lockPlate(g, o, d.lock);
      this.plates.set(d.object, g);
    }
    this.render(state);
  }

  render(state: GameState): void {
    for (const s of selectSwitches(state)) {
      const v = this.levers.get(s.object);
      if (!v || v.on === s.on) continue;
      v.on = s.on;
      v.g.clear();
      if (s.mode === 'hold') drawPlate(v.g, v.o, s.on);
      else drawLever(v.g, v.o, s.on);
    }
    for (const d of selectDoorLocks(state)) this.plates.get(d.object)?.setVisible(!d.open);
    for (const p of selectPickups(state)) this.items.get(p.object)?.setVisible(p.present);
    // A box is drawn at its feet line like an actor, so the operator walks behind or in front of it.
    // Acetaldehyde crates come out of the line while the room is open, so pictures are made on first sight.
    const here = new Set<number>();
    for (const b of selectBoxes(state)) {
      here.add(b.object);
      let v = this.boxes.get(b.object);
      if (!v) {
        v = { g: this.scene.add.graphics(), type: '' };
        this.boxes.set(b.object, v);
      }
      if (v.type !== b.boxType) {
        v.type = b.boxType;
        drawBox(v.g.clear(), b.boxType);
      }
      v.g.setPosition(b.x, b.y).setDepth(b.y + TILE);
    }
    this.renderFactory(state);
    this.renderMixer(state);
    // A box the port took in leaves the room's state; its picture goes with it.
    for (const [id, v] of this.boxes) {
      if (here.has(id)) v.g.setVisible(true);
      else if (id < 0) {
        // A spawned crate taken in does not come back under the same id on this visit.
        v.g.destroy();
        this.boxes.delete(id);
      } else v.g.setVisible(false);
    }
    const port = selectPort(state);
    if (port && this.port) {
      const gate = port.gate;
      const full = port.count >= port.need;
      // The countdown ticks every second; the picture only changes when the gate flips or a box goes in.
      const look = `${port.count}/${gate?.open}`;
      if (this.port.drawn !== look) {
        this.port.drawn = look;
        drawPort(this.port.g.clear(), this.port.o, full, gate?.open === false);
      }
      const text = gate
        ? fillStr(gate.open ? 'port.gate.open' : 'port.gate.closed', { n: port.count, total: port.need, seconds: gate.seconds })
        : `${port.count}/${port.need}`;
      if (this.port.text !== text) {
        this.port.text = text;
        updateText(this.port.label, text);
      }
    }
    for (const c of selectConveyors(state)) {
      const v = this.belts.get(c.object);
      if (!v) continue;
      // The chevrons crawl one step every 8 rule ticks while running, which is enough to read the direction.
      const phase = c.running ? Math.floor(state.tick / 8) % 4 : 0;
      const key = `${c.running}|${phase}`;
      if (v.drawn === key) continue;
      v.drawn = key;
      v.g.clear();
      drawBelt(v.g, v.o, c.running, phase);
    }
  }

  /**
   * One slot per box the mixer can hold, above the hopper: an empty slot is an outline, a full one
   * fills from the left as the box is digested. Redrawn in sixteenths, so not on every tick.
   */
  private renderMixer(state: GameState): void {
    const m = selectMixer(state);
    const v = this.mixer;
    if (!m || !v) return;
    const steps = m.batches.map((b) => Math.floor(b.done * 16));
    const key = `${m.capacity}|${steps.join(',')}`;
    if (v.drawn === key) return;
    v.drawn = key;
    const b = objectBox(v.o);
    const w = 10;
    const gap = 3;
    const left = (b.left + b.right) / 2 - (m.capacity * w + (m.capacity - 1) * gap) / 2;
    const g = v.gauge.clear();
    for (let i = 0; i < m.capacity; i++) {
      const x = left + i * (w + gap);
      g.fillStyle(PAPER, 0.9).fillRect(x, b.top - 12, w, 8);
      if (i < steps.length) g.fillStyle(BLUE).fillRect(x, b.top - 12, (w * steps[i]!) / 16, 8);
      g.lineStyle(1.5, INK, 1).strokeRect(x, b.top - 12, w, 8);
    }
  }

  /** The dock's alcohol crates and the red fog round each acetaldehyde crate, redrawn only when they change. */
  private renderFactory(state: GameState): void {
    const f = selectFactory(state);
    const v = this.factory;
    if (!f || !v) return;
    if (v.dockDrawn !== f.crates.length) {
      v.dockDrawn = f.crates.length;
      drawDock(v.dock.clear(), dockTiles(state.room), f.crates.length);
    }
    // The rules keep the boxes array while no box moves, so the same array means the same fog.
    if (v.fogDrawn === state.boxes) return;
    v.fogDrawn = state.boxes;
    const crates = selectBoxes(state).filter((b) => isSpawnedCrate({ id: b.object }));
    const g = v.fog.clear();
    for (const b of crates) {
      g.fillStyle(0xc8372d, 0.16).fillCircle(b.x + TILE / 2, b.y + TILE / 2, MIST.radiusPx);
      g.lineStyle(1, 0xc8372d, 0.45).strokeCircle(b.x + TILE / 2, b.y + TILE / 2, MIST.radiusPx);
    }
  }
}

/** The receiving dock: a steel counter, with a barrel on each of the first `n` tiles. */
function drawDock(g: Phaser.GameObjects.Graphics, tiles: readonly { col: number; row: number }[], n: number): void {
  tiles.forEach((t, i) => {
    const x = t.col * TILE;
    const y = t.row * TILE;
    g.fillStyle(0x7d8594).fillRect(x, y + 6, TILE, TILE - 6).lineStyle(1, INK, 0.8).strokeRect(x + 0.5, y + 6.5, TILE - 1, TILE - 7);
    if (i >= n) return;
    // An alcohol barrel: amber staves, ink hoops.
    g.fillStyle(0xc98a3a).fillRoundedRect(x + 6, y - 6, 20, 26, 5).lineStyle(1.5, INK, 1).strokeRoundedRect(x + 6, y - 6, 20, 26, 5);
    g.lineBetween(x + 6, y + 1, x + 26, y + 1).lineBetween(x + 6, y + 13, x + 26, y + 13);
  });
}

/** The second line's mouth: a dark bay with an arrow in. */
function drawIntake(g: Phaser.GameObjects.Graphics, o: RoomObject): void {
  const b = objectBox(o);
  g.fillStyle(0x3d4352, 0.7).fillRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
  g.lineStyle(2, INK, 1).strokeRect(b.left + 1, b.top + 1, b.right - b.left - 2, b.bottom - b.top - 2);
  const cy = (b.top + b.bottom) / 2;
  g.lineStyle(3, PAPER, 0.8).lineBetween(b.left + 8, cy, b.right - 12, cy).lineBetween(b.right - 18, cy - 6, b.right - 12, cy).lineBetween(b.right - 18, cy + 6, b.right - 12, cy);
}

/** Where the first line puts out crates: a hatch ring on the floor. */
function drawOutlet(g: Phaser.GameObjects.Graphics, col: number, row: number): void {
  g.lineStyle(2, INK, 0.7).strokeCircle((col + 0.5) * TILE, (row + 0.5) * TILE, TILE / 2 - 3);
}

/** The dispatch port: a hatched yellow bay on the floor; filled, it turns blue. A shut timed gate has a grey shutter across it. */
function drawPort(g: Phaser.GameObjects.Graphics, o: RoomObject, full: boolean, shut: boolean): void {
  const b = objectBox(o);
  const w = b.right - b.left;
  const h = b.bottom - b.top;
  g.fillStyle(full ? BLUE : 0xe8c96a, 0.55).fillRect(b.left, b.top, w, h);
  g.lineStyle(2, INK, 1).strokeRect(b.left + 1, b.top + 1, w - 2, h - 2);
  g.lineStyle(1, INK, 0.35);
  for (let d = 8; d < w + h; d += 8) g.lineBetween(b.left + Math.max(0, d - h), b.top + Math.min(d, h), b.left + Math.min(d, w), b.top + Math.max(0, d - w));
  if (!shut) return;
  g.fillStyle(0x7d8594, 0.9).fillRect(b.left + 2, b.top + 2, w - 4, h - 4);
  g.lineStyle(2, INK, 0.8);
  for (let y = b.top + 8; y < b.bottom - 2; y += 8) g.lineBetween(b.left + 2, y, b.right - 2, y);
}

/** The mixer's hopper: a steel drum mouth over each tile, with the blades showing. */
function drawHopper(g: Phaser.GameObjects.Graphics, tiles: readonly { col: number; row: number }[]): void {
  for (const t of tiles) {
    const x = t.col * TILE;
    const y = t.row * TILE;
    g.fillStyle(0x7d8594).fillRect(x, y, TILE, TILE).lineStyle(1, INK, 0.8).strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
    g.fillStyle(0x3d4352).fillCircle(x + TILE / 2, y + TILE / 2, 12).lineStyle(2, INK, 1).strokeCircle(x + TILE / 2, y + TILE / 2, 12);
    g.lineStyle(2, GREY, 1).lineBetween(x + 8, y + 16, x + 24, y + 16).lineBetween(x + 16, y + 8, x + 16, y + 24);
  }
}

/**
 * A crate on its tile, drawn from the tile's top-left; the type only changes the label colour. A
 * parcel, what the mixer puts out, is a small paper bundle tied with string instead.
 */
function drawBox(g: Phaser.GameObjects.Graphics, boxType: string): void {
  if (boxType === PARCEL) {
    g.fillStyle(INK, 0.25).fillEllipse(16, 28, 20, 5);
    g.fillStyle(PAPER).fillRect(8, 13, 16, 14).lineStyle(1.5, INK, 1).strokeRect(8, 13, 16, 14);
    g.lineStyle(1, 0xb58a55, 1).lineBetween(16, 13, 16, 27).lineBetween(8, 20, 24, 20);
    return;
  }
  const label = boxType === 'glucose' ? 0xe8c96a : boxType === 'acetaldehyde' ? 0xa0306a : boxType === 'food' ? 0xe8955a : PAPER;
  g.fillStyle(INK, 0.25).fillEllipse(16, 29, 28, 6);
  g.fillStyle(0xb58a55).fillRect(3, 6, 26, 23).lineStyle(1.5, INK, 1).strokeRect(3, 6, 26, 23);
  g.lineBetween(3, 12, 29, 12);
  g.fillStyle(label).fillRect(10, 16, 12, 8).strokeRect(10, 16, 12, 8);
}

/** A grey belt with chevrons pointing the way it runs; stopped, the chevrons go dim. */
function drawBelt(g: Phaser.GameObjects.Graphics, o: RoomObject, running: boolean, phase: number): void {
  const d = directionOf(o);
  for (const t of conveyorTiles(o)) {
    const x = t.col * TILE;
    const y = t.row * TILE;
    g.fillStyle(0x5c6270).fillRect(x, y, TILE, TILE);
    g.lineStyle(1, INK, 0.6).strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
    g.lineStyle(2, running ? 0xf4efe4 : 0x8a8780, running ? 0.9 : 0.5);
    for (let i = 0; i < 2; i++) {
      // Along the belt: 0..31 px, shifted by the phase so the marks travel.
      const along = (i * 16 + phase * 4) % TILE + 4;
      const cx = x + (d.col !== 0 ? (d.col > 0 ? along : TILE - along) : TILE / 2);
      const cy = y + (d.row !== 0 ? (d.row > 0 ? along : TILE - along) : TILE / 2);
      const back = 5;
      const side = 6;
      g.lineBetween(cx - d.col * back - d.row * side, cy - d.row * back - d.col * side, cx, cy);
      g.lineBetween(cx - d.col * back + d.row * side, cy - d.row * back + d.col * side, cx, cy);
    }
  }
}

/**
 * An item on the floor, centred in its box: a blue booklet for a handbook page, a paper cup for
 * coffee, a folder for a file, a bento box for a meal, a bottle for oral rehydration salts, a
 * card for a thanks card, a stack of loose sheets for a memory file.
 */
function drawItem(g: Phaser.GameObjects.Graphics, o: RoomObject, itemType: string): void {
  const b = objectBox(o);
  const cx = Math.round((b.left + b.right) / 2);
  const cy = Math.round((b.top + b.bottom) / 2);
  g.fillStyle(INK, 0.25).fillEllipse(cx, cy + 8, 20, 6);
  g.lineStyle(1.5, INK, 1);
  switch (itemType) {
    case 'handbook':
      g.fillStyle(BLUE).fillRect(cx - 7, cy - 9, 14, 17).strokeRect(cx - 7, cy - 9, 14, 17);
      g.fillStyle(PAPER).fillRect(cx - 4, cy - 6, 8, 2).fillRect(cx - 4, cy - 2, 8, 2);
      break;
    case 'coffee':
      g.fillStyle(PAPER).fillRect(cx - 5, cy - 7, 10, 14).strokeRect(cx - 5, cy - 7, 10, 14);
      g.fillStyle(INK).fillRect(cx - 6, cy - 9, 12, 3).fillStyle(0x8a5a35).fillRect(cx - 5, cy - 1, 10, 4);
      break;
    case 'file':
      g.fillStyle(0xe8c96a).fillRect(cx - 9, cy - 6, 18, 13).strokeRect(cx - 9, cy - 6, 18, 13);
      g.fillRect(cx - 9, cy - 9, 7, 3).strokeRect(cx - 9, cy - 9, 7, 3);
      break;
    case 'meal':
      g.fillStyle(0xc8372d).fillRect(cx - 9, cy - 6, 18, 12).strokeRect(cx - 9, cy - 6, 18, 12);
      g.fillStyle(PAPER).fillRect(cx - 7, cy - 4, 7, 8).fillStyle(0x6a9a4a).fillRect(cx + 1, cy - 4, 6, 8);
      break;
    case 'ors':
      g.fillStyle(PAPER).fillRect(cx - 4, cy - 6, 8, 14).strokeRect(cx - 4, cy - 6, 8, 14);
      g.fillStyle(BLUE).fillRect(cx - 2, cy - 9, 4, 3).fillRect(cx - 4, cy, 8, 3);
      break;
    case 'memory':
      g.fillStyle(PAPER).fillRect(cx - 5, cy - 9, 14, 16).strokeRect(cx - 5, cy - 9, 14, 16);
      g.fillRect(cx - 9, cy - 6, 14, 16).strokeRect(cx - 9, cy - 6, 14, 16);
      g.fillStyle(BLUE).fillRect(cx - 7, cy - 3, 10, 2).fillRect(cx - 7, cy + 1, 10, 2).fillRect(cx - 7, cy + 5, 6, 2);
      break;
    default:
      g.fillStyle(PAPER).fillRect(cx - 8, cy - 6, 16, 12).strokeRect(cx - 8, cy - 6, 16, 12);
      g.fillStyle(0xc8372d).fillCircle(cx - 2, cy - 1, 2).fillCircle(cx + 2, cy - 1, 2).fillTriangle(cx - 4, cy, cx + 4, cy, cx, cy + 4);
  }
}

/** A floor plate; pressed, it sinks and darkens. */
function drawPlate(g: Phaser.GameObjects.Graphics, o: RoomObject, down: boolean): void {
  const b = objectBox(o);
  const w = b.right - b.left;
  const h = b.bottom - b.top;
  g.fillStyle(INK).fillRect(b.left + 3, b.top + 3, w - 6, h - 6);
  g.fillStyle(down ? BLUE : PAPER).fillRect(b.left + 5, b.top + (down ? 7 : 5), w - 10, h - (down ? 12 : 10));
}

/** A lever on a base: thrown, it leans right and turns blue. */
function drawLever(g: Phaser.GameObjects.Graphics, o: RoomObject, on: boolean): void {
  const b = objectBox(o);
  const cx = (b.left + b.right) / 2;
  const base = b.bottom - 6;
  g.fillStyle(INK).fillRect(cx - 9, base - 4, 18, 8);
  const tipX = cx + (on ? 9 : -9);
  const tipY = base - 16;
  g.lineStyle(3, INK, 1).lineBetween(cx, base - 2, tipX, tipY);
  g.fillStyle(on ? BLUE : GREY).fillCircle(tipX, tipY, 4).lineStyle(1, INK, 1).strokeCircle(tipX, tipY, 4);
}

/** An ink plate with the lock's icon, on the face of the door. */
function lockPlate(g: Phaser.GameObjects.Graphics, door: RoomObject, lock: string): void {
  const b = objectBox(door);
  const cx = (b.left + b.right) / 2;
  // A north door's box includes the wall top; the plate sits on the face below it.
  const cy = door.props['socket'] === 'N' ? b.bottom - 24 : (b.top + b.bottom) / 2;
  g.fillStyle(INK).fillRoundedRect(cx - 11, cy - 11, 22, 22, 4);
  g.lineStyle(2, PAPER, 1).fillStyle(PAPER);
  switch (lock) {
    case 'key':
      g.strokeCircle(cx - 3, cy, 4).lineBetween(cx + 1, cy, cx + 7, cy).lineBetween(cx + 5, cy, cx + 5, cy + 3);
      break;
    case 'switch':
      g.fillRect(cx - 6, cy + 3, 12, 3).lineBetween(cx, cy + 3, cx + 5, cy - 5);
      break;
    case 'clock':
      g.strokeCircle(cx, cy, 7).lineBetween(cx, cy, cx, cy - 5).lineBetween(cx, cy, cx + 4, cy);
      break;
    default:
      for (let i = 0; i < 3; i++) g.fillRect(cx - 7 + i * 5, cy + 6 - (i + 1) * 4, 3, (i + 1) * 4);
  }
}
