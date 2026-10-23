import { TILE } from '../time.ts';

/** Solid-tile grid of a room. Out-of-bounds counts as solid so nothing can leave the room. */
export interface SolidGrid {
  readonly cols: number;
  readonly rows: number;
  readonly solid: readonly boolean[];
}

/** Axis-aligned box given by its center-bottom (feet) point, matching sprite anchors. */
export interface Body {
  readonly halfW: number;
  readonly height: number;
}

export function isSolid(grid: SolidGrid, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return true;
  return grid.solid[row * grid.cols + col] === true;
}

/** Boxes are half-open [left, right) x [top, bottom), so a box flush with a wall does not touch it. */
function overlapsSolid(grid: SolidGrid, left: number, top: number, right: number, bottom: number): boolean {
  const c0 = Math.floor(left / TILE);
  const c1 = Math.ceil(right / TILE) - 1;
  const r0 = Math.floor(top / TILE);
  const r1 = Math.ceil(bottom / TILE) - 1;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (isSolid(grid, c, r)) return true;
  return false;
}

export function bodyOverlapsSolid(grid: SolidGrid, body: Body, x: number, y: number): boolean {
  return overlapsSolid(grid, x - body.halfW, y - body.height, x + body.halfW, y);
}

/** No single step may exceed this, so a fast dodge cannot skip a one-tile wall. */
const MAX_STEP = 8;

export interface MoveResult {
  readonly x: number;
  readonly y: number;
  readonly blockedX: boolean;
  readonly blockedY: boolean;
}

/** Moves x first, then y, each in sub-steps, snapping flush against the first solid tile hit. */
export function moveAndCollide(grid: SolidGrid, body: Body, x: number, y: number, dx: number, dy: number): MoveResult {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / MAX_STEP));
  let blockedX = false;
  let blockedY = false;
  for (let i = 0; i < steps; i++) {
    if (!blockedX && dx !== 0) {
      const nx = x + dx / steps;
      if (bodyOverlapsSolid(grid, body, nx, y)) {
        x = dx > 0
          ? Math.floor((nx + body.halfW) / TILE) * TILE - body.halfW
          : Math.ceil((nx - body.halfW) / TILE) * TILE + body.halfW;
        blockedX = true;
      } else x = nx;
    }
    if (!blockedY && dy !== 0) {
      const ny = y + dy / steps;
      if (bodyOverlapsSolid(grid, body, x, ny)) {
        y = dy > 0
          ? Math.floor(ny / TILE) * TILE
          : Math.ceil((ny - body.height) / TILE) * TILE + body.height;
        blockedY = true;
      } else y = ny;
    }
  }
  return { x, y, blockedX, blockedY };
}
