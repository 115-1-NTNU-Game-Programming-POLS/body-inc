/**
 * Causal log: the graph the close-out report is reconstructed from. It enforces the four rules
 * the feasibility prototype proved necessary (design doc 13.5, prototypes/feasibility/sim-trace.js):
 *
 * 1. Every derived entry (tag, effect, crisis) names at least one existing cause; none is empty.
 * 2. Causes accumulate: a tag that already exists gains later causes instead of freezing.
 * 3. Every link carries the rule time it was added at.
 * 4. Tracing ignores links added after the traced entry, so a report never cites the future.
 *
 * Times are RuleClock minutes (clock.ts).
 */

/** Source kinds start a chain; derived kinds must point back to one. */
export type SourceNodeKind = 'card' | 'event' | 'choice' | 'activity' | 'rule';
export type DerivedNodeKind = 'tag' | 'effect' | 'crisis';
export type NodeKind = SourceNodeKind | DerivedNodeKind;

const DERIVED: ReadonlySet<NodeKind> = new Set<NodeKind>(['tag', 'effect', 'crisis']);

export interface CauseLink {
  readonly node: number;
  readonly at: number;
}

export type NodeData = Readonly<Record<string, string | number | boolean>>;

export interface CausalNode {
  readonly id: number;
  readonly kind: NodeKind;
  /** Logical id used to pick the report template, e.g. "card.coffee_large" or "sleep_debt". */
  readonly key: string;
  readonly at: number;
  readonly causes: readonly CauseLink[];
  readonly data?: NodeData;
}

export interface CausalLog {
  readonly nodes: readonly CausalNode[];
}

export const EMPTY_LOG: CausalLog = { nodes: [] };

export class CausalError extends Error {}

export interface NewEntry {
  readonly kind: NodeKind;
  readonly key: string;
  readonly at: number;
  readonly causes?: readonly number[];
  readonly data?: NodeData;
}

function checkTime(at: number): void {
  if (!Number.isInteger(at) || at < 0) throw new CausalError(`time must be a non-negative integer minute, got ${at}`);
}

function checkCauses(log: CausalLog, causes: readonly number[], at: number, self?: number): void {
  for (const c of causes) {
    const n = log.nodes[c];
    if (!Number.isInteger(c) || !n) throw new CausalError(`cause #${c} does not exist`);
    if (c === self) throw new CausalError(`entry #${c} cannot cause itself`);
    if (n.at > at) throw new CausalError(`cause #${c} happens at ${n.at}, after the effect at ${at}`);
  }
}

export function record(log: CausalLog, entry: NewEntry): [CausalLog, number] {
  if (typeof entry.key !== 'string' || entry.key === '') throw new CausalError(`${entry.kind} entry has no key`);
  checkTime(entry.at);
  const causes = [...new Set(entry.causes ?? [])];
  if (DERIVED.has(entry.kind) && causes.length === 0) {
    throw new CausalError(`${entry.kind} "${entry.key}" has no source; every change must name what caused it`);
  }
  checkCauses(log, causes, entry.at);
  const id = log.nodes.length;
  const node: CausalNode = {
    id,
    kind: entry.kind,
    key: entry.key,
    at: entry.at,
    causes: causes.map((c) => ({ node: c, at: entry.at })),
    ...(entry.data ? { data: entry.data } : {}),
  };
  return [{ nodes: [...log.nodes, node] }, id];
}

/** Adds later causes to an existing entry (rule 2); causes it already has are kept as they were. */
export function addCauses(log: CausalLog, id: number, causes: readonly number[], at: number): CausalLog {
  const node = log.nodes[id];
  if (!node) throw new CausalError(`entry #${id} does not exist`);
  checkTime(at);
  if (at < node.at) throw new CausalError(`cannot add a cause to #${id} at ${at}, before it existed at ${node.at}`);
  checkCauses(log, causes, at, id);
  const have = new Set(node.causes.map((c) => c.node));
  const fresh = [...new Set(causes)].filter((c) => !have.has(c));
  if (fresh.length === 0) return log;
  const nodes = log.nodes.slice();
  nodes[id] = { ...node, causes: [...node.causes, ...fresh.map((c) => ({ node: c, at }))] };
  return { nodes };
}

/** Every ancestor of an entry through links no later than the entry itself, oldest first. */
export function trace(log: CausalLog, id: number): CausalNode[] {
  const root = log.nodes[id];
  if (!root) throw new CausalError(`entry #${id} does not exist`);
  const limit = root.at;
  const seen = new Set<number>();
  const stack = [id];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const link of log.nodes[cur]!.causes) if (link.at <= limit) stack.push(link.node);
  }
  return [...seen].map((i) => log.nodes[i]!).sort((a, b) => a.at - b.at || a.id - b.id);
}
