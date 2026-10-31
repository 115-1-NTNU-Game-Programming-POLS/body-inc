import type { ReportFile } from '../content/generated.ts';
import { DAY_SLOTS, LIVER_SLOTS, type SlotLane } from '../rooms/slots.ts';
import type { RoomObject } from '../rooms/tiled.ts';
import { fillTemplate } from './bank.ts';
import type { ReportDocument, StringLookup } from './types.ts';

/** Event cards and operation notes hang on the upper track, tags and floors on the lower one, work orders on the liver board (art direction 7.6). */
export type WallLane = SlotLane;

export type WallKind = 'event' | 'tag' | 'floor' | 'ops' | 'order' | 'smile';

/** A day of the wall holds this many nodes per track; more are folded into one "N more" note. */
export const SLOTS_PER_LANE = DAY_SLOTS;

export interface WallNode {
  readonly id: number;
  readonly kind: WallKind;
  readonly lane: WallLane;
  /** Day column of the node; for the liver board the day the work order came in, which the board does not use to place it. */
  readonly day: number;
  /** Place within its day and track (1 to 3), or on the liver board (1 to 8): the `order` of the EvidenceSlot it takes. */
  readonly slot: number;
  /** What the note says when the node is stopped on; a folded node joins its parts. */
  readonly text: string;
  /** Sentences folded into this node, when it stands for several. */
  readonly folded?: number;
}

export interface Wall {
  readonly kind: ReportDocument['kind'];
  readonly nodes: readonly WallNode[];
  /** Red lines, as [from, to] node ids. They run in time order, ending at the floors that struck. */
  readonly links: readonly (readonly [number, number])[];
  /** Handbook page the report desk hands over at the end of the wall. */
  readonly unlock: string;
}

export interface Pinned {
  readonly node: WallNode;
  /** The EvidenceSlot the node hangs on. */
  readonly slot: RoomObject;
}

/**
 * Hangs every node of the wall on the EvidenceSlot of its day, track and place (the liver board has
 * no days). A room the map check passed offers all of them, so a missing slot is a bug and throws.
 */
export function pinWall(wall: Wall, objects: readonly RoomObject[]): Pinned[] {
  const slots = objects.filter((o) => o.kind === 'EvidenceSlot' && o.variant === undefined);
  return wall.nodes.map((node) => {
    const slot = slots.find((o) => o.props['lane'] === node.lane && o.props['order'] === node.slot && (node.lane === 'liver' || o.props['day'] === node.day));
    if (!slot) throw new RangeError(`the room has no ${node.lane} slot ${node.slot} on day ${node.day}`);
    return { node, slot };
  });
}

function kindOf(cfg: ReportFile, key: string): WallKind {
  if (key === 'strike') return 'floor';
  if (key === 'warning' || key.startsWith('ops:')) return 'ops';
  const score = cfg.keys[key]?.score;
  return score === 'effect' || score === 'tag' ? 'tag' : 'event';
}

const laneOf = (kind: WallKind): WallLane => (kind === 'event' || kind === 'ops' ? 'upper' : kind === 'order' || kind === 'smile' ? 'liver' : 'lower');

/** The case number of a report starts with the day of the emergency room (document.ts caseNumber). */
const crisisDay = (doc: ReportDocument): number => Number(doc.number.slice(0, 2));

type Draft = { kind: WallKind; day: number; at: number; text: string; folded?: number };

/** Keeps the first `room - 1` of a crowded group and folds the rest into one note that still carries their words. */
function fold(group: readonly Draft[], room: number, cfg: ReportFile, text: StringLookup): Draft[] {
  if (group.length <= room) return [...group];
  const rest = group.slice(room - 1);
  return [...group.slice(0, room - 1), {
    kind: rest[0]!.kind, day: rest[0]!.day, at: rest[0]!.at, folded: rest.length,
    text: `${fillTemplate(text(cfg.doc.wallMore), { n: String(rest.length) })}\n${rest.map((r) => r.text).join('\n')}`,
  }];
}

/**
 * The wall of design doc 8.11 for one report: the sentences of its incident part as nodes on the day
 * they began, the floors that struck on the night of the emergency room at the end, and a red line
 * from each node to the next in time. When the liver struck, the work orders it was sent (`liverOrders`,
 * the days they came in) go on their own board, ending in the liver's smiley note, which never changed.
 * The lines show order, not proof of cause: the report keeps only its best five sentences, and the
 * causal log's own edges are not carried by them.
 */
export function buildWall(doc: ReportDocument, cfg: ReportFile, text: StringLookup, liverOrders: readonly number[] = []): Wall {
  const day = crisisDay(doc);
  const drafts: Draft[] = doc.incident.map((l) => ({ kind: kindOf(cfg, l.key), day: l.firstDay, at: l.at, text: l.text }));
  // Only the floors that struck on the crisis night are not already a sentence of the incident.
  const stated = new Set(doc.incident.filter((l) => l.key === 'strike').map((l) => l.scope));
  const end: Draft[] = doc.struck.filter((s) => !stated.has(s)).map((s) => {
    const dept = cfg.scopes[s]?.dept;
    if (dept === undefined) throw new RangeError(`"${s}" is not a scope of the report bank`);
    return { kind: 'floor' as const, day, at: Number.MAX_SAFE_INTEGER, text: fillTemplate(text(cfg.doc.wallStruck), { dept: text(dept) }) };
  });

  const cells = new Map<string, Draft[]>();
  for (const d of [...drafts, ...end].sort((a, b) => a.day - b.day || a.at - b.at)) {
    const k = `${d.day}/${laneOf(d.kind)}`;
    cells.set(k, [...(cells.get(k) ?? []), d]);
  }
  const placed: (Draft & { lane: WallLane; slot: number })[] = [];
  for (const group of cells.values()) {
    fold(group, SLOTS_PER_LANE, cfg, text).forEach((d, i) => placed.push({ ...d, lane: laneOf(d.kind), slot: i + 1 }));
  }
  placed.sort((a, b) => a.day - b.day || a.at - b.at);

  const nodes: WallNode[] = placed.map((p, id) => ({
    id, kind: p.kind, lane: p.lane, day: p.day, slot: p.slot, text: p.text, ...(p.folded !== undefined ? { folded: p.folded } : {}),
  }));
  const links: [number, number][] = [];
  const chain = nodes.filter((_, i) => placed[i]!.at !== Number.MAX_SAFE_INTEGER);
  for (let i = 1; i < chain.length; i++) links.push([chain[i - 1]!.id, chain[i]!.id]);
  const last = chain[chain.length - 1];
  if (last !== undefined) for (const n of nodes) if (placed[n.id]!.at === Number.MAX_SAFE_INTEGER) links.push([last.id, n.id]);

  // The liver's board: its smiley note takes the last place, so at most LIVER_SLOTS - 1 work orders show and the earliest fold.
  const orders = doc.struck.includes('liver') ? liverOrders.filter((d) => d <= day).sort((a, b) => a - b) : [];
  if (orders.length > 0) {
    const drafted: Draft[] = orders.map((d, i) => ({ kind: 'order', day: d, at: i, text: fillTemplate(text(cfg.doc.wallOrder), { day: String(d) }) }));
    const shown = fold(drafted, LIVER_SLOTS - 1, cfg, text);
    const smile: Draft = { kind: 'smile', day: orders[orders.length - 1]!, at: orders.length, text: text(cfg.doc.wallSmile) };
    const first = nodes.length;
    [...shown, smile].forEach((d, i) => nodes.push({
      id: first + i, kind: d.kind, lane: 'liver', day: d.day, slot: i + 1, text: d.text, ...(d.folded !== undefined ? { folded: d.folded } : {}),
    }));
    for (let i = 1; i < shown.length; i++) links.push([first + i - 1, first + i]);
  }
  return { kind: doc.kind, nodes, links, unlock: doc.unlock };
}
