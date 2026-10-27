import type { ReportFile } from '../content/generated.ts';
import { liverClues, minuteOf, type DayRecord, type FloorId, type SemesterContext, type SemesterState } from '../semester/index.ts';
import { trace, type CausalNode } from '../tags/causal.ts';
import { composeReport } from './document.ts';
import type { ReportFact, ReportDocument, ReportInput, StringLookup } from './types.ts';

/** An entry of a table keyed by "<kind>:<key>", where a trailing * stands for any ending. */
function lookup<T>(table: Readonly<Record<string, T>>, id: string): T | undefined {
  if (table[id] !== undefined) return table[id];
  let best: string | undefined;
  for (const k of Object.keys(table)) {
    if (k.endsWith('*') && id.startsWith(k.slice(0, -1)) && (best === undefined || k.length > best.length)) best = k;
  }
  return best === undefined ? undefined : table[best];
}

const ignored = (cfg: ReportFile, id: string): boolean => cfg.ignore.some((p) => (p.endsWith('*') ? id.startsWith(p.slice(0, -1)) : p === id));

const tens = (n: number, round: (x: number) => number): number => round(n / 10) * 10;

/** The life-side facts: what the causal log traces back from the crisis, each entry worded under its bank key. */
export function nodeFacts(nodes: readonly CausalNode[], cfg: ReportFile, parents: ReadonlySet<number>): ReportFact[] {
  const out: ReportFact[] = [];
  for (const n of nodes) {
    const id = `${n.kind}:${n.key}`;
    if (n.kind === 'crisis' || ignored(cfg, id)) continue;
    const mapped = lookup(cfg.nodes, id);
    const key = mapped ?? id;
    const entry = cfg.keys[key];
    const vars: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(n.data ?? {})) if (typeof v !== 'boolean') vars[k] = v;
    // The sentence bank asks for alcohol in grams and caffeine to the nearest ten; the log keeps cups and units.
    if (entry?.vars?.['g'] && typeof vars['cups'] === 'number') vars['g'] = vars['cups'] * cfg.cupGrams;
    if (typeof vars['residual'] === 'number') {
      if (entry?.vars?.['r']) vars['r'] = tens(vars['residual'], Math.round);
      if (entry?.vars?.['rmin']) vars['rmin'] = tens(vars['residual'], Math.floor);
    }
    if (entry === undefined) vars['label'] = n.key;
    const scope = typeof n.data?.['floor'] === 'string' ? n.data['floor'] : undefined;
    out.push({ key, ...(scope !== undefined ? { scope } : {}), at: n.at, vars, ...(parents.has(n.id) ? { parent: true } : {}) });
  }
  return out;
}

/**
 * The operations record of design doc 8.11: which lit floors went unvisited, what was patrolled
 * while work orders piled up at the liver, which patrols went badly. They are not in the causal
 * log because they are things the player did not do, so they are read from the day records.
 * Only the floors that struck and the liver clues matter to a report.
 */
export function operationFacts(
  history: readonly DayRecord[], state: SemesterState, ctx: SemesterContext, struck: ReadonlySet<FloorId>, text: StringLookup, cfg: ReportFile,
  after: number, upTo: number,
): ReportFact[] {
  const k = ctx.params;
  const out: ReportFact[] = [];
  for (const rec of history) {
    if (rec.day <= after || rec.day > upTo || rec.kind !== 'normal') continue;
    const morning = minuteOf(rec.day, rec.wake);
    const evening = minuteOf(rec.day, k.bedMin);
    const visited = new Set(rec.patrols.map((p) => p.floor));
    for (const floor of rec.lit) {
      // Design doc 8.4: a department says its symptom aloud from the orange light on, not at yellow.
      if (!struck.has(floor) || visited.has(floor) || (rec.lights[floor] !== 'orange' && rec.lights[floor] !== 'red')) continue;
      const symptom = cfg.scopes[floor]?.symptom;
      out.push({ key: 'warning', scope: floor, at: morning, vars: symptom ? { symptom: text(symptom) } : {} });
    }
    for (const p of rec.patrols) {
      if (p.grade === 'C' && struck.has(p.floor)) out.push({ key: 'ops:poor_patrol', scope: p.floor, at: evening });
    }
    if (!struck.has('liver') || visited.has('liver')) continue;
    const orders = state.liverOrders.filter((d) => d <= rec.day).length;
    const first = rec.patrols.find((p) => !p.overtime);
    if (orders > 0 && first) out.push({ key: 'ops:patrol_orders', scope: first.floor, at: evening, vars: { orders } });
    if (liverClues(rec.loadsBefore.liver, state.liverOrders, k).stomachJam) out.push({ key: 'ops:liver_clue', scope: 'stomach', at: morning });
  }
  return out;
}

export interface SemesterReportOptions {
  readonly cfg: ReportFile;
  readonly text: StringLookup;
  /** The run's seed, for the choice among variants. */
  readonly seed: number;
  /** Handbook pages the player already holds. */
  readonly known?: ReadonlySet<string>;
}

/**
 * What the report of every visit to the emergency room in a semester is written from: a closure
 * notice for the first, a bankruptcy report for the second. Each is built from the causal log
 * traced back from its own crisis entry, so it never cites a night after it.
 */
export function semesterInputs(state: SemesterState, ctx: SemesterContext, o: SemesterReportOptions): ReportInput[] {
  const k = ctx.params;
  const wakes = state.history.map((r) => r.wake);
  const visits = state.history.filter((r): r is DayRecord & { crisis: NonNullable<DayRecord['crisis']> } => r.crisis !== undefined);
  return visits.map((rec, i) => {
    const crisis = state.tags.log.nodes[rec.crisis.node]!;
    const struck = new Set(rec.strikes);
    const parents = new Set(crisis.causes.map((c) => c.node));
    const previous = visits[i - 1];
    const facts: ReportFact[] = [
      ...nodeFacts(trace(state.tags.log, crisis.id), o.cfg, parents),
      ...operationFacts(state.history, state, ctx, struck, o.text, o.cfg, previous?.day ?? 0, rec.day),
    ];
    const common = { seed: o.seed, wakes, at: rec.crisis.at, facts, struck: rec.strikes, fasting: rec.crisis.fasting, known: o.known ?? new Set<string>() };
    return i === 0
      ? {
        ...common, kind: 'notice',
        hospital: {
          day: rec.day + 1,
          issueDay: Math.min(rec.day + 2, k.days),
          wake: k.wake,
          cap: k.hospitalFloorLoad,
          debtPercent: Math.round(k.hospitalDebtMult * 100),
          ...(rec.day + 1 === k.midDay ? { missedExam: 'mid' as const } : rec.day + 1 === k.finDay ? { missedExam: 'fin' as const } : {}),
        },
      }
      : { ...common, kind: 'bankruptcy', previous: { at: previous!.crisis.at, struck: previous!.strikes, fasting: previous!.crisis.fasting } };
  });
}

export function semesterReports(state: SemesterState, ctx: SemesterContext, o: SemesterReportOptions): ReportDocument[] {
  return semesterInputs(state, ctx, o).map((input) => composeReport(input, { cfg: o.cfg, text: o.text, seed: o.seed }));
}
