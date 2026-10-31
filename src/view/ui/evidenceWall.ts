import Phaser from 'phaser';
import type { Wall, WallKind, WallNode } from '../../core/index.ts';
import { fillStr, str } from '../../app/content.ts';
import { addText, updateText } from '../text/fonts.ts';

const INK = 0x0c2d5e;
const PAPER = 0xfbfaf6;
const CORK = 0xb98a58;
const CORK_EDGE = 0x6d4c2a;
const TAG_YELLOW = 0xf5df7a;
const NOTE_BLUE = 0x3a5a9a;
/** The red pen of the report (art direction 7.6); it only draws lines on this wall, never a hazard. */
const RED_PEN = 0xc8372d;
const HIGHLIGHT = 0xfff23d;

const BOARD = { x: 40, y: 84, h: 330, pad: 12 };
const NODE = 32;
/** Centres of the two tracks, from the top of the board. */
const LANE_Y = { upper: 118, lower: 232 } as const;
const DAYS = 10;
/** Ten days and the report desk at the end (art direction 7.6 puts the desk past day 10). */
const COLUMNS = DAYS + 1;
const NOTE = { y: 438, w: 1100 };

interface Mark {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly outline: Phaser.GameObjects.Rectangle;
}

/**
 * The investigation wall of design doc 8.11 as a cork board: one column per day, event cards and
 * operation notes on the upper track, tags and floors on the lower one, red lines joining the
 * nodes in time order, and the report desk after the last day. The wall only draws; what a key
 * or click means is up to the scene, which calls `select`, `move` and reads `onDesk`.
 */
export class EvidenceWallView {
  private readonly layer: Phaser.GameObjects.Container;
  private readonly marks: Mark[] = [];
  private readonly kind: Phaser.GameObjects.Text;
  private readonly body: Phaser.GameObjects.Text;
  private readonly scene: Phaser.Scene;
  private readonly wall: Wall;
  private cursor = 0;

  constructor(scene: Phaser.Scene, wall: Wall, scale: number, onPick: (index: number) => void) {
    this.scene = scene;
    this.wall = wall;
    this.layer = scene.add.container(0, 0);
    const w = scene.scale.width;
    const boardW = w - 2 * BOARD.x;
    const colW = (boardW - 2 * BOARD.pad) / COLUMNS;
    const colX = (c: number): number => BOARD.x + BOARD.pad + colW * (c + 0.5);

    this.layer.add(addText(scene, BOARD.x, 28, str('semester.wall.title'), { role: 'hand', weight: 700, size: 36, color: '#fbfaf6' }));
    this.layer.add(scene.add.rectangle(BOARD.x + 6, BOARD.y + 6, boardW, BOARD.h, 0x000000, 0.45).setOrigin(0, 0));
    this.layer.add(scene.add.rectangle(BOARD.x, BOARD.y, boardW, BOARD.h, CORK).setOrigin(0, 0).setStrokeStyle(6, CORK_EDGE));
    for (let d = 1; d <= COLUMNS; d++) {
      if (d > 1) this.layer.add(scene.add.rectangle(BOARD.x + BOARD.pad + colW * (d - 1), BOARD.y + 36, 1, BOARD.h - 72, CORK_EDGE, 0.35).setOrigin(0, 0));
    }
    // The time axis under the board, one tick per day.
    const axisY = BOARD.y + BOARD.h - 28;
    this.layer.add(scene.add.rectangle(BOARD.x + BOARD.pad, axisY, colW * DAYS, 2, INK).setOrigin(0, 0.5));
    for (let d = 1; d <= DAYS; d++) {
      this.layer.add(scene.add.rectangle(colX(d - 1), axisY, 2, 10, INK));
      this.layer.add(addText(scene, colX(d - 1), BOARD.y + 12, fillStr('semester.wall.day', { n: d }), { role: 'print', weight: 700, size: 14, color: '#2b1c0c' }).setOrigin(0.5, 0));
    }

    // A cell's nodes sit side by side, centred in the column.
    const cell = new Map<string, WallNode[]>();
    for (const n of wall.nodes) cell.set(`${n.day}/${n.lane}`, [...(cell.get(`${n.day}/${n.lane}`) ?? []), n]);
    const pos = new Map<number, { x: number; y: number }>();
    for (const group of cell.values()) {
      const step = Math.min(NODE + 6, (colW - 6) / group.length);
      group.forEach((n, s) => pos.set(n.id, { x: colX(Math.min(n.day, DAYS) - 1) + (s - (group.length - 1) / 2) * step, y: BOARD.y + LANE_Y[n.lane] }));
    }

    // Lines first, so every node is pinned on top of them.
    const pen = scene.add.graphics();
    pen.lineStyle(2, RED_PEN, 1);
    for (const [from, to] of wall.links) {
      const a = pos.get(from)!;
      const b = pos.get(to)!;
      pen.beginPath();
      pen.moveTo(a.x, a.y);
      pen.lineTo((a.x + b.x) / 2, (a.y + b.y) / 2 + 4);
      pen.lineTo(b.x, b.y);
      pen.strokePath();
    }
    this.layer.add(pen);

    wall.nodes.forEach((n, i) => {
      const p = pos.get(n.id)!;
      this.layer.add(this.draw(n.kind, p.x, p.y));
      this.marks.push(this.mark(i, p.x, p.y, onPick));
    });
    const desk = { x: colX(DAYS), y: BOARD.y + LANE_Y.lower };
    this.layer.add(this.drawDesk(desk.x, desk.y));
    this.marks.push(this.mark(wall.nodes.length, desk.x, desk.y, onPick));

    this.kind = addText(scene, BOARD.x, NOTE.y, '', { role: 'print', weight: 700, size: 18 * scale, color: '#c9d3e3' });
    this.body = addText(scene, BOARD.x, NOTE.y + 32 * scale, ' ', { role: 'print', weight: 400, size: 24 * scale, color: '#fbfaf6', maxWidth: NOTE.w, lineHeight: 1.5 });
    this.layer.add([this.kind, this.body]);
    this.select(0);
  }

  /** Nodes plus the report desk. */
  get count(): number {
    return this.wall.nodes.length + 1;
  }

  get onDesk(): boolean {
    return this.cursor === this.wall.nodes.length;
  }

  select(i: number): void {
    this.cursor = Math.max(0, Math.min(this.count - 1, i));
    this.marks.forEach((m) => m.outline.setVisible(m.index === this.cursor));
    const node = this.wall.nodes[this.cursor];
    updateText(this.kind, node === undefined ? str('semester.wall.desk') : `${str(`semester.wall.kind.${node.kind}`)}　${fillStr('semester.wall.day', { n: node.day })}`);
    updateText(this.body, node === undefined ? str('semester.wall.desk.note') : node.text);
  }

  move(step: number): void {
    this.select(this.cursor + step);
  }

  destroy(): void {
    this.layer.destroy();
  }

  private mark(index: number, x: number, y: number, onPick: (index: number) => void): Mark {
    const outline = this.scene.add.rectangle(x, y, NODE + 10, NODE + 10).setStrokeStyle(3, HIGHLIGHT).setVisible(false);
    const hit = this.scene.add.rectangle(x, y, NODE + 8, NODE + 8, 0xffffff, 0.001).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', () => onPick(index));
    this.layer.add([outline, hit]);
    return { index, x, y, outline };
  }

  /** Nodes are plain shapes, no text: the name comes in the note below (art direction 7.6). */
  private draw(kind: WallKind, x: number, y: number): Phaser.GameObjects.Container {
    const s = this.scene;
    const c = s.add.container(x, y);
    const half = NODE / 2;
    switch (kind) {
      case 'event':
        c.add([
          s.add.rectangle(2, 2, NODE - 4, NODE - 2, 0x000000, 0.35), s.add.rectangle(0, 0, NODE - 4, NODE - 2, PAPER).setStrokeStyle(2, INK),
          s.add.rectangle(0, -half + 6, NODE - 8, 5, TAG_YELLOW), s.add.circle(0, -half + 1, 3, RED_PEN),
        ]);
        break;
      case 'tag':
        c.add([
          s.add.rectangle(2, 2, NODE - 6, NODE - 4, 0x000000, 0.35), s.add.rectangle(0, 0, NODE - 6, NODE - 4, TAG_YELLOW).setStrokeStyle(2, INK),
          s.add.circle(0, -half + 7, 3, CORK_EDGE),
        ]);
        break;
      case 'floor':
        c.add([
          s.add.rectangle(2, 2, NODE, NODE - 8, 0x000000, 0.35), s.add.rectangle(0, 0, NODE, NODE - 8, 0x2a3a52).setStrokeStyle(2, INK),
          s.add.circle(0, 0, 7, RED_PEN).setStrokeStyle(2, PAPER),
        ]);
        break;
      case 'ops':
        c.add([s.add.rectangle(2, 2, NODE - 4, NODE - 4, 0x000000, 0.35), s.add.rectangle(0, 0, NODE - 4, NODE - 4, NOTE_BLUE).setStrokeStyle(2, INK)]);
        for (const dy of [-6, 0, 6]) c.add(s.add.rectangle(0, dy, NODE - 12, 2, PAPER));
        break;
    }
    return c;
  }

  private drawDesk(x: number, y: number): Phaser.GameObjects.Container {
    const s = this.scene;
    return s.add.container(x, y, [
      s.add.rectangle(3, 3, NODE + 6, NODE - 2, 0x000000, 0.35), s.add.rectangle(0, 0, NODE + 6, NODE - 2, 0x7a5430).setStrokeStyle(2, INK),
      s.add.rectangle(0, -4, NODE - 6, NODE - 12, PAPER),
    ]);
  }
}
