import type { ReportFile } from '../content/generated.ts';
import { fillTemplate } from './bank.ts';
import type { ReportDocument, StringLookup } from './types.ts';

/** Event cards and operation notes hang on the upper track, tags and floors on the lower one (art direction 7.6). */
export type WallLane = 'upper' | 'lower';

export type WallKind = 'event' | 'tag' | 'floor' | 'ops';

/** A day of the wall holds this many nodes per lane; more are folded into one "N more" note (art direction 7.6). */
export const SLOTS_PER_LANE = 3;

export interface WallNode {
  readonly id: number;
  readonly kind: WallKind;
  readonly lane: WallLane;
  readonly day: number;
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

function kindOf(cfg: ReportFile, key: string): WallKind {
  if (key === 'strike') return 'floor';
  if (key === 'warning' || key.startsWith('ops:')) return 'ops';
  const score = cfg.keys[key]?.score;
  return score === 'effect' || score === 'tag' ? 'tag' : 'event';
}

const laneOf = (kind: WallKind): WallLane => (kind === 'event' || kind === 'ops' ? 'upper' : 'lower');

/** The case number of a report starts with the day of the emergency room (document.ts caseNumber). */
const crisisDay = (doc: ReportDocument): number => Number(doc.number.slice(0, 2));

/**
 * The wall of design doc 8.11 for one report: the sentences of its incident part as nodes on the day
 * they began, the floors that struck at the end, and a red line from each node to the next in time.
 * The lines show order, not proof of cause: the report keeps only its best five sentences, and the
 * causal log's own edges are not carried by them.
 */
export function buildWall(doc: ReportDocument, cfg: ReportFile, text: StringLookup): Wall {
  type Draft = { kind: WallKind; day: number; at: number; text: string };
  const drafts: Draft[] = doc.incident.map((l) => ({ kind: kindOf(cfg, l.key), day: l.firstDay, at: l.at, text: l.text }));
  // Only the floors that struck on the crisis night are not already a sentence of the incident.
  const day = crisisDay(doc);
  const stated = new Set(doc.incident.filter((l) => l.key === 'strike').map((l) => l.scope));
  const end: Draft[] = doc.struck.filter((s) => !stated.has(s)).map((s) => {
    const dept = cfg.scopes[s]?.dept;
    if (dept === undefined) throw new RangeError(`"${s}" is not a scope of the report bank`);
    return { kind: 'floor' as const, day, at: Number.MAX_SAFE_INTEGER, text: fillTemplate(text(cfg.doc.wallStruck), { dept: text(dept) }) };
  });

  // Fold each crowded day and lane into SLOTS_PER_LANE nodes: the earliest stay, the rest become one note.
  const placed: (Draft & { folded?: number })[] = [];
  const cells = new Map<string, Draft[]>();
  for (const d of [...drafts, ...end].sort((a, b) => a.day - b.day || a.at - b.at)) {
    const k = `${d.day}/${laneOf(d.kind)}`;
    cells.set(k, [...(cells.get(k) ?? []), d]);
  }
  for (const group of cells.values()) {
    if (group.length <= SLOTS_PER_LANE) {
      placed.push(...group);
      continue;
    }
    const keep = group.slice(0, SLOTS_PER_LANE - 1);
    const rest = group.slice(SLOTS_PER_LANE - 1);
    placed.push(...keep, {
      kind: rest[0]!.kind, day: rest[0]!.day, at: rest[0]!.at, folded: rest.length,
      text: `${fillTemplate(text(cfg.doc.wallMore), { n: String(rest.length) })}\n${rest.map((r) => r.text).join('\n')}`,
    });
  }
  placed.sort((a, b) => a.day - b.day || a.at - b.at);

  const nodes: WallNode[] = placed.map((p, id) => ({
    id, kind: p.kind, lane: laneOf(p.kind), day: p.day, text: p.text, ...(p.folded !== undefined ? { folded: p.folded } : {}),
  }));
  const links: [number, number][] = [];
  const chain = nodes.filter((_, i) => placed[i]!.at !== Number.MAX_SAFE_INTEGER);
  for (let i = 1; i < chain.length; i++) links.push([chain[i - 1]!.id, chain[i]!.id]);
  const last = chain[chain.length - 1];
  if (last !== undefined) for (const n of nodes) if (placed[n.id]!.at === Number.MAX_SAFE_INTEGER) links.push([last.id, n.id]);
  return { kind: doc.kind, nodes, links, unlock: doc.unlock };
}
