import Phaser from 'phaser';
import { objectBox, selectDoorLocks, selectSwitches, type GameState, type RoomObject } from '../../core/index.ts';

const INK = 0x0c2d5e;
const PAPER = 0xf4efe4;
const BLUE = 0x2f5fa8;
const GREY = 0x8a8780;

/**
 * Placeholder pictures for switches and door locks, redrawn only when their state changes. A
 * locked door carries an ink-blue plate whose icon names the lock (art direction 4: key, switch,
 * clock, resource); the plate comes off when the door opens. Real art replaces these later.
 */
export class Mechanisms {
  private readonly levers = new Map<number, { g: Phaser.GameObjects.Graphics; o: RoomObject; on?: boolean }>();
  private readonly plates = new Map<number, Phaser.GameObjects.Graphics>();

  constructor(scene: Phaser.Scene, state: GameState) {
    const byId = new Map(state.room.objects.map((o) => [o.id, o]));
    for (const s of selectSwitches(state)) {
      const o = byId.get(s.object)!;
      this.levers.set(s.object, { g: scene.add.graphics().setDepth(objectBox(o).bottom), o });
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
