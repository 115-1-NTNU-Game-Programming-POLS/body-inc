import Phaser from 'phaser';
import { tagKey, type Manifest } from '../../app/assets.ts';
import { objectBox, TILE, type EnteredRoom, type RoomObject } from '../../core/index.ts';

const INK = 0x0c2d5e;
const PAPER = 0xf4efe4;
const BLUE = 0x2f5fa8;
const GREY = 0xd9d6cf;

/**
 * Placeholder pictures for the objects a room can hold that the player meets by walking up to
 * them: beds, the time clock, a patrol's elevator, the way out of a chapter, NPCs. Doors are part of
 * the wall tiles, and other triggers are invisible by design. Real art replaces these through the manifest like everything else, so an
 * NPC whose id is a manifest key already shows that sprite.
 */
export function drawRoomObjects(scene: Phaser.Scene, room: EnteredRoom, manifest: Manifest): void {
  for (const o of room.objects) {
    if (o.kind === 'Bed') bed(scene, o);
    else if (o.kind === 'Pen') pen(scene, o);
    else if (o.kind === 'Trigger' && o.props['event'] === 'checkpoint') timeClock(scene, o);
    else if (o.kind === 'Trigger' && o.props['eventId'] === 'elevator') elevator(scene, o);
    else if (o.kind === 'Trigger' && o.props['event'] === 'end') exit(scene, o, room.grid.cols * TILE);
    else if (o.kind === 'NPC') npc(scene, o, manifest);
  }
}

/**
 * Where a chapter ends by walking (clocking out, going home): a pale strip with arrows toward the
 * nearer side wall. Left invisible, the last room looked empty and nothing said where to go (#82).
 */
function exit(scene: Phaser.Scene, o: RoomObject, roomWidth: number): void {
  const b = objectBox(o);
  const cx = (b.left + b.right) / 2;
  const dir = cx < roomWidth / 2 ? -1 : 1;
  const g = scene.add.graphics().setDepth(b.top);
  g.fillStyle(PAPER, 0.25).fillRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
  g.lineStyle(2, INK, 0.5).strokeRect(b.left + 1, b.top + 1, b.right - b.left - 2, b.bottom - b.top - 2);
  g.fillStyle(INK, 0.7);
  for (let y = b.top + TILE; y + TILE / 2 <= b.bottom; y += 2 * TILE) {
    for (const dx of [-10, 6]) {
      const x = cx + dx * dir;
      g.fillTriangle(x + 8 * dir, y, x, y - 8, x, y + 8);
    }
  }
}

/** The way out of a patrol: a grey landing along the east wall with the up and down arrows of a lift call button at its middle. */
function elevator(scene: Phaser.Scene, o: RoomObject): void {
  const b = objectBox(o);
  const cx = (b.left + b.right) / 2;
  const cy = (b.top + b.bottom) / 2;
  const g = scene.add.graphics().setDepth(b.top);
  g.fillStyle(GREY, 0.85).fillRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
  g.lineStyle(2, INK, 1).strokeRect(b.left + 1, b.top + 1, b.right - b.left - 2, b.bottom - b.top - 2);
  g.fillStyle(INK).fillTriangle(cx, cy - 12, cx - 7, cy - 3, cx + 7, cy - 3).fillTriangle(cx, cy + 12, cx - 7, cy + 3, cx + 7, cy + 3);
}

/** A mattress with a pillow at the left end; the one you can sleep a night in is under a blue blanket. */
function bed(scene: Phaser.Scene, o: RoomObject): void {
  const b = objectBox(o);
  const w = b.right - b.left;
  const h = b.bottom - b.top;
  const g = scene.add.graphics().setDepth(b.top);
  g.fillStyle(INK).fillRect(b.left - 1, b.top - 1, w + 2, h + 2);
  g.fillStyle(o.props['bedType'] === 'sleep' ? BLUE : GREY).fillRect(b.left, b.top, w, h);
  g.fillStyle(PAPER).fillRect(b.left + 3, b.top + 3, Math.min(14, w / 3), h - 6);
}

/** The brain patrol's rest area: a blue mat under the floor with a pillow for every two tiles, so a rectangle of mats reads as somewhere to sleep. */
function pen(scene: Phaser.Scene, o: RoomObject): void {
  const b = objectBox(o);
  const g = scene.add.graphics().setDepth(b.top);
  g.fillStyle(BLUE, 0.3).fillRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
  g.lineStyle(2, INK, 0.6).strokeRect(b.left + 1, b.top + 1, b.right - b.left - 2, b.bottom - b.top - 2);
  g.fillStyle(PAPER, 0.9);
  for (let x = b.left + 8; x + 14 <= b.right - 4; x += 64) for (let y = b.top + 6; y + 8 <= b.bottom - 4; y += 64) g.fillRect(x, y, 14, 8);
}

/** A wall clock face on the floor mat: the spot where the next restart will be. */
function timeClock(scene: Phaser.Scene, o: RoomObject): void {
  const b = objectBox(o);
  const cx = (b.left + b.right) / 2;
  const cy = (b.top + b.bottom) / 2;
  const g = scene.add.graphics().setDepth(b.top);
  g.fillStyle(INK, 0.18).fillRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
  g.fillStyle(PAPER).fillCircle(cx, cy, 14).lineStyle(2, INK, 1).strokeCircle(cx, cy, 14);
  g.lineStyle(2, INK, 1).lineBetween(cx, cy, cx, cy - 9).lineBetween(cx, cy, cx + 6, cy + 2);
}

function npc(scene: Phaser.Scene, o: RoomObject, manifest: Manifest): void {
  const entry = manifest.entries.find((e) => e.key === String(o.props['npcId']));
  if (!entry) {
    scene.add.graphics().setDepth(o.y).fillStyle(INK).fillRect(o.x - 9, o.y - 25, 18, 25).fillStyle(PAPER).fillRect(o.x - 7, o.y - 23, 14, 8);
    return;
  }
  const sprite = scene.add.sprite(o.x, o.y, entry.key, '0')
    .setOrigin(entry.anchor[0] / entry.frame[0], entry.anchor[1] / entry.frame[1]).setDepth(o.y);
  const idle = tagKey(entry.key, 'idle_down');
  if (scene.anims.exists(idle)) sprite.play(idle);
}
