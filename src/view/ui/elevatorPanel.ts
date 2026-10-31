import Phaser from 'phaser';
import { str } from '../../app/content.ts';
import type { ElevatorPanel, FloorId, Light } from '../../core/index.ts';
import { addText } from '../text/fonts.ts';

const INK = 0x0c2d5e;
const STAMP_RED = 0xc8372d;
const PAPER = 0xfbfaf6;
const NOTE_YELLOW = 0xf5df7a;
const LIGHT: Record<Light, number> = { off: 0x8f98a8, yellow: 0xf2cf4a, orange: 0xef8a2f, red: 0xd63a30 };
const PLATE = { w: 200, h: 300, gap: 24, top: 210 };
const SHADOW = 6;

export interface ElevatorTexts {
  readonly title: string;
}

interface Plate {
  readonly frame: Phaser.GameObjects.Graphics;
  readonly floor: FloorId;
  readonly disabled: boolean;
}

/**
 * The elevator panel of design doc 8.4: one plate per floor with its light. It is built from an
 * ElevatorPanel, which carries lights and never a load, so the liver's plate can only show what the
 * building shows: no light and a smiley note. It only draws; `onPick` is up to the scene.
 */
export class ElevatorPanelView {
  private readonly layer: Phaser.GameObjects.Container;
  private readonly plates: Plate[] = [];

  constructor(scene: Phaser.Scene, panel: ElevatorPanel, texts: ElevatorTexts, disabled: FloorId | undefined, onPick: (index: number) => void, onHover?: (index: number) => void) {
    this.layer = scene.add.container(0, 0);
    const cx = scene.scale.width / 2;
    this.layer.add(addText(scene, cx, 96, texts.title, { role: 'hand', weight: 700, size: 32, color: '#fbfaf6' }).setOrigin(0.5, 0));
    const left = cx - (panel.buttons.length * PLATE.w + (panel.buttons.length - 1) * PLATE.gap) / 2;
    panel.buttons.forEach((b, i) => {
      const off = b.floor === disabled;
      const frame = scene.add.graphics();
      const parts: Phaser.GameObjects.GameObject[] = [frame];
      parts.push(addText(scene, PLATE.w / 2, 26, str(`semester.floor.${b.floor}`), { role: 'hand', weight: 700, size: 36, color: '#0c2d5e' }).setOrigin(0.5, 0));
      parts.push(scene.add.circle(PLATE.w / 2, 138, 36, LIGHT[b.light]).setStrokeStyle(3, INK));
      parts.push(addText(scene, PLATE.w / 2, 188, str(`semester.light.${b.light}`), { role: 'print', weight: 700, size: 20, color: '#2b3448' }).setOrigin(0.5, 0));
      if (b.note !== undefined) {
        parts.push(scene.add.rectangle(PLATE.w / 2, 252, PLATE.w - 40, 38, NOTE_YELLOW).setRotation(-0.03));
        parts.push(addText(scene, PLATE.w / 2, 252, str(`semester.floor.${b.note}`), { role: 'hand', weight: 700, size: 20, color: '#0c2d5e' }).setOrigin(0.5));
      } else if (panel.routine === b.floor) {
        parts.push(addText(scene, PLATE.w / 2, 252, str('semester.floor.routine'), { role: 'hand', weight: 700, size: 22, color: '#c8372d' }).setOrigin(0.5));
      }
      parts.push(addText(scene, 22, 14, String(i + 1), { role: 'print', weight: 700, size: 16, color: '#2b3448' }));
      if (!off) {
        const zone = scene.add.zone(0, 0, PLATE.w, PLATE.h).setOrigin(0, 0).setInteractive({ useHandCursor: true });
        zone.on('pointerdown', () => onPick(i));
        if (onHover) zone.on('pointerover', () => onHover(i));
        parts.push(zone);
      }
      const box = scene.add.container(left + i * (PLATE.w + PLATE.gap), PLATE.top, parts);
      if (off) box.setAlpha(0.4);
      this.layer.add(box);
      this.plates.push({ frame, floor: b.floor, disabled: off });
    });
  }

  /** The floor of a plate, in panel order. */
  floorAt(index: number): FloorId | undefined {
    return this.plates[index]?.floor;
  }

  isDisabled(index: number): boolean {
    return this.plates[index]?.disabled ?? true;
  }

  /** Redraws the plates: the highlighted one has the heavy outline. */
  paint(cursor: number): void {
    this.plates.forEach((p, i) => {
      const on = i === cursor && !p.disabled;
      const g = p.frame.clear();
      g.fillStyle(INK, 0.2).fillRoundedRect(SHADOW, SHADOW, PLATE.w, PLATE.h, 12);
      g.fillStyle(PAPER).fillRoundedRect(0, 0, PLATE.w, PLATE.h, 12);
      g.lineStyle(on ? 4 : 1, on ? STAMP_RED : INK, on ? 1 : 0.5).strokeRoundedRect(on ? 2 : 0.5, on ? 2 : 0.5, PLATE.w - (on ? 4 : 1), PLATE.h - (on ? 4 : 1), 12);
    });
  }

  destroy(): void {
    this.layer.destroy(true);
    this.plates.length = 0;
  }
}
