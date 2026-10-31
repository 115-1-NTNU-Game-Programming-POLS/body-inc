import type { RoomObject } from './tiled.ts';

/** The evidence wall's days (art direction 7.6); a semester has ten. */
export const WALL_DAYS = 10;
/** Slots a day holds on each of its two tracks, and the nodes a day's track holds before it folds. */
export const DAY_SLOTS = 3;
/** Slots of the stand-alone board for the liver's work orders. */
export const LIVER_SLOTS = 8;

export type SlotLane = 'upper' | 'lower' | 'liver';

/**
 * Where the wall room (tools/maps/make-wall.ts) puts what is not an EvidenceSlot, in tiles. The view
 * draws the cork, the liver board, the desk and the cabinet from the same numbers the generator
 * makes solid, so moving one here moves both.
 */
export const WALL_LAYOUT = {
  firstDayCol: 4,
  cork: { from: 3, to: 34 },
  board: { col: 30, row: 4, cols: 4, rows: 2 },
  desk: { col: 35, row: 5, cols: 3, rows: 2 },
  cabinet: { col: 38, row: 4, cols: 1, rows: 2 },
} as const;

export interface SlotProblem {
  readonly object?: number;
  readonly code: 'slot-count' | 'slot-duplicate';
  readonly args: Readonly<Record<string, string | number>>;
}

/**
 * What a room with an evidence wall must offer: three slots per day on each track, numbered 1 to
 * 3, and eight on the liver board, numbered 1 to 8. A room with no EvidenceSlot at all is not a wall.
 * The liver board has no days, so its slots' `day` is not read.
 */
export function slotProblems(objects: readonly RoomObject[]): SlotProblem[] {
  // A variant layer is not part of the room until it is switched on, and pinWall leaves those slots out too.
  const slots = objects.filter((o) => o.kind === 'EvidenceSlot' && o.variant === undefined);
  if (slots.length === 0) return [];
  const out: SlotProblem[] = [];
  const key = (o: RoomObject): string => (o.props['lane'] === 'liver' ? 'liver' : `${o.props['lane']}/${o.props['day']}`);
  const seen = new Map<string, RoomObject>();
  for (const o of [...slots].sort((a, b) => a.id - b.id)) {
    const k = `${key(o)}#${o.props['order']}`;
    const twin = seen.get(k);
    if (twin) out.push({ object: o.id, code: 'slot-duplicate', args: { cell: key(o), order: Number(o.props['order']), other: twin.id } });
    else seen.set(k, o);
  }
  const cells: [string, number][] = [['liver', LIVER_SLOTS]];
  for (let d = 1; d <= WALL_DAYS; d++) for (const lane of ['upper', 'lower']) cells.push([`${lane}/${d}`, DAY_SLOTS]);
  for (const [cell, want] of cells) {
    const have = slots.filter((o) => key(o) === cell);
    // A repeated order is reported on its own as slot-duplicate, so only the count and the range are judged here.
    const ok = have.length === want && have.every((o) => Number(o.props['order']) >= 1 && Number(o.props['order']) <= want);
    if (!ok) out.push({ code: 'slot-count', args: { cell, want, have: have.length } });
  }
  return out;
}
