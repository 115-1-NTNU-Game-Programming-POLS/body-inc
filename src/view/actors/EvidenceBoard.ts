import Phaser from 'phaser';
import { fillStr, str } from '../../app/content.ts';
import { pinWall, TILE, WALL_DAYS, WALL_LAYOUT, type EnteredRoom, type Pinned, type Wall, type WallKind } from '../../core/index.ts';
import { addText } from '../text/fonts.ts';

const INK = 0x0c2d5e;
const PAPER = 0xfbfaf6;
const CORK = 0xb98a58;
const CORK_EDGE = 0x6d4c2a;
const TAG_YELLOW = 0xf5df7a;
const NOTE_BLUE = 0x3a5a9a;
const DESK = 0x7a5430;
/** The red pen of the report (art direction 7.6); on this wall it only draws lines, never a hazard. */
const RED_PEN = 0xc8372d;
const HIGHLIGHT = 0xfff23d;
const SAG = 4;
/** A node counts as stopped on when the operator's feet are no more than this far below its column's lowest slot. */
const REACH = 44;

const { cork: CORK_COLS, board: BOARD, desk: DESK_BOX, cabinet: CABINET, firstDayCol } = WALL_LAYOUT;

export interface WallNoteMessage {
  /** Lines of the note, or none when the operator is not under a node. */
  readonly text: string | undefined;
}

/**
 * The investigation wall of design doc 8.11 drawn into its Tiled room: the cork, the day labels,
 * the nodes on the room's EvidenceSlots, the red lines and the report desk. The operator's place
 * decides which column of nodes is lit and what the HUD's note says; nothing here decides a rule.
 */
export class EvidenceBoard {
  private readonly pinned: readonly Pinned[];
  private readonly outlines = new Map<number, Phaser.GameObjects.Rectangle>();
  private readonly scene: Phaser.Scene;
  private shown = '';

  constructor(scene: Phaser.Scene, room: EnteredRoom, wall: Wall) {
    this.scene = scene;
    this.pinned = pinWall(wall, room.objects);
    this.drawCork();
    this.drawFloorThings();
    const centre = new Map(this.pinned.map((p) => [p.node.id, { x: p.slot.x + p.slot.width / 2, y: p.slot.y + p.slot.height / 2 }]));

    const pen = scene.add.graphics().setDepth(2);
    pen.lineStyle(1, RED_PEN, 1);
    for (const [from, to] of wall.links) {
      const a = centre.get(from)!;
      const b = centre.get(to)!;
      pen.beginPath();
      pen.moveTo(a.x, a.y);
      pen.lineTo((a.x + b.x) / 2, (a.y + b.y) / 2 + SAG);
      pen.lineTo(b.x, b.y);
      pen.strokePath();
    }
    for (const p of this.pinned) {
      const c = centre.get(p.node.id)!;
      const depth = p.node.lane === 'liver' ? (BOARD.row + BOARD.rows) * TILE + 1 : 3;
      drawNode(scene, p.node.kind, c.x, c.y).setDepth(depth);
      this.outlines.set(p.node.id, scene.add.rectangle(c.x, c.y, TILE - 2, TILE - 2).setStrokeStyle(1.5, HIGHLIGHT).setDepth(depth + 0.5).setVisible(false));
    }
  }

  /** Lights the nodes of the column the operator stands under and returns what the HUD's note should say. */
  update(x: number, y: number): WallNoteMessage {
    const col = Math.floor(x / TILE);
    // The tracks and the liver board share some columns but not the floor they are read from, so each is its own group.
    const here = this.pinned.filter((p) => Math.floor(p.slot.x / TILE) === col);
    const groups = [here.filter((p) => p.node.lane !== 'liver'), here.filter((p) => p.node.lane === 'liver')];
    // A group's lowest slot sets the reach, so the nodes above it are reached from the same spot.
    const lit = groups.find((g) => {
      const lowest = Math.max(...g.map((p) => p.slot.y + p.slot.height));
      return g.length > 0 && y > lowest && y - lowest <= REACH;
    }) ?? [];
    const ids = new Set(lit.map((p) => p.node.id));
    for (const [id, o] of this.outlines) o.setVisible(ids.has(id));
    const text = lit.length === 0 ? undefined : lit.sort((a, b) => a.slot.y - b.slot.y).map((p) => noteOf(p)).join('\n');
    if ((text ?? '') !== this.shown) {
      this.shown = text ?? '';
      this.scene.game.events.emit('wall-note', { text } satisfies WallNoteMessage);
    }
    return { text };
  }

  destroy(): void {
    this.scene.game.events.emit('wall-note', { text: undefined } satisfies WallNoteMessage);
  }

  /** Cork over the north wall with a label per day and the time axis under the tracks (art direction 7.6). */
  private drawCork(): void {
    const s = this.scene;
    const left = CORK_COLS.from * TILE;
    const width = (CORK_COLS.to - CORK_COLS.from) * TILE;
    s.add.rectangle(left, 0, width, 3 * TILE, CORK).setOrigin(0, 0).setStrokeStyle(2, CORK_EDGE).setDepth(1);
    for (let d = 1; d <= WALL_DAYS; d++) {
      const x = (firstDayCol + (d - 1) * 3) * TILE;
      if (d > 1) s.add.rectangle(x, 4, 1, 3 * TILE - 12, CORK_EDGE, 0.4).setOrigin(0, 0).setDepth(1.5);
      addText(s, x + 1.5 * TILE, 1, fillStr('semester.wall.day', { n: d }), { role: 'print', weight: 700, size: 9, color: '#2b1c0c' }).setOrigin(0.5, 0).setDepth(1.6);
    }
    const axis = 3 * TILE - 3;
    s.add.rectangle(firstDayCol * TILE, axis, WALL_DAYS * 3 * TILE, 1, INK).setOrigin(0, 0.5).setDepth(1.6);
    for (let d = 0; d <= WALL_DAYS; d++) s.add.rectangle((firstDayCol + d * 3) * TILE, axis, 1, 4, INK).setDepth(1.6);
  }

  /** The liver's board, the report desk and the cabinet: solid in the room, drawn to match. */
  private drawFloorThings(): void {
    const s = this.scene;
    const boxOf = (b: { col: number; row: number; cols: number; rows: number }) => ({ x: b.col * TILE, y: b.row * TILE, w: b.cols * TILE, h: b.rows * TILE });
    const board = boxOf(BOARD);
    s.add.rectangle(board.x, board.y, board.w, board.h, CORK).setOrigin(0, 0).setStrokeStyle(2, CORK_EDGE).setDepth(board.y + board.h);
    addText(s, board.x + board.w / 2, board.y - 1, str('semester.wall.liver_board'), { role: 'print', weight: 700, size: 9, color: '#2b1c0c' })
      .setOrigin(0.5, 1).setDepth(board.y + board.h);
    const desk = boxOf(DESK_BOX);
    s.add.rectangle(desk.x, desk.y, desk.w, desk.h, DESK).setOrigin(0, 0).setStrokeStyle(2, INK).setDepth(desk.y + desk.h);
    s.add.rectangle(desk.x + 12, desk.y + 10, desk.w - 24, desk.h - 26, PAPER).setOrigin(0, 0).setDepth(desk.y + desk.h + 0.1);
    const cab = boxOf(CABINET);
    s.add.rectangle(cab.x, cab.y, cab.w, cab.h, 0x8a93a3).setOrigin(0, 0).setStrokeStyle(2, INK).setDepth(cab.y + cab.h);
  }
}

/** One line of the HUD's note: what kind of thing it is, the day, and what it says. */
function noteOf(p: Pinned): string {
  const kind = str(`semester.wall.kind.${p.node.kind}`);
  const head = p.node.kind === 'smile' ? kind : `${kind}　${fillStr('semester.wall.day', { n: p.node.day })}`;
  return `${head}\n${p.node.text}`;
}

/** Nodes are plain shapes with no text: the name comes in the HUD's note (art direction 7.6). */
function drawNode(scene: Phaser.Scene, kind: WallKind, x: number, y: number): Phaser.GameObjects.Container {
  const s = scene;
  const c = s.add.container(x, y);
  const half = TILE / 2 - 2;
  const shadow = (w: number, h: number) => s.add.rectangle(1, 1, w, h, 0x000000, 0.35);
  switch (kind) {
    case 'event':
      c.add([shadow(24, 26), s.add.rectangle(0, 0, 24, 26, PAPER).setStrokeStyle(1, INK), s.add.rectangle(0, -half + 6, 20, 4, TAG_YELLOW), s.add.circle(0, -half + 2, 2, RED_PEN)]);
      break;
    case 'tag':
      c.add([shadow(22, 24), s.add.rectangle(0, 0, 22, 24, TAG_YELLOW).setStrokeStyle(1, INK), s.add.circle(0, -half + 5, 2, CORK_EDGE)]);
      break;
    case 'floor':
      c.add([shadow(28, 20), s.add.rectangle(0, 0, 28, 20, 0x2a3a52).setStrokeStyle(1, INK), s.add.circle(0, 0, 5, RED_PEN).setStrokeStyle(1, PAPER)]);
      break;
    case 'ops':
      c.add([shadow(24, 24), s.add.rectangle(0, 0, 24, 24, NOTE_BLUE).setStrokeStyle(1, INK)]);
      for (const dy of [-6, 0, 6]) c.add(s.add.rectangle(0, dy, 16, 1, PAPER));
      break;
    case 'order':
      c.add([shadow(14, 26), s.add.rectangle(0, 0, 14, 26, 0xefe6cf).setStrokeStyle(1, INK), s.add.rectangle(0, -9, 14, 3, RED_PEN), s.add.rectangle(0, 2, 8, 1, INK), s.add.rectangle(0, 6, 8, 1, INK)]);
      break;
    case 'smile':
      c.add([shadow(26, 26), s.add.rectangle(0, 0, 26, 26, TAG_YELLOW).setStrokeStyle(1, INK), s.add.circle(-5, -3, 1.5, INK), s.add.circle(5, -3, 1.5, INK)]);
      c.add(s.add.graphics().lineStyle(1.5, INK, 1).beginPath().arc(0, 1, 7, 0.25, Math.PI - 0.25).strokePath());
      break;
  }
  return c;
}
