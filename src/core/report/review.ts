import type { ReportFile } from '../content/generated.ts';
import { summarize, type DayRecord, type SemesterContext, type SemesterState } from '../semester/index.ts';
import { fillTemplate } from './bank.ts';
import type { Wall, WallNode } from './wall.ts';
import type { StringLookup } from './types.ts';

/** What a passed semester can be praised for, best teaching point first (design doc 8.11: "three things done right"). */
export const MERITS = ['liver_check', 'declined', 'early_bed', 'patrol', 'no_hospital', 'passed_fin', 'passed_mid'] as const;
export type MeritId = (typeof MERITS)[number];

export interface Merit {
  readonly id: MeritId;
  readonly day: number;
  readonly vars: Readonly<Record<string, string>>;
}

/** The review's words by merit, as keys of the report bank's `doc`. */
export const MERIT_TEXT: Readonly<Record<MeritId, keyof ReportFile['doc']>> = {
  liver_check: 'reviewLiverCheck', declined: 'reviewDeclined', early_bed: 'reviewBed', patrol: 'reviewPatrol',
  no_hospital: 'reviewHospital', passed_fin: 'reviewFin', passed_mid: 'reviewMid',
};

/** Latest bedtime of a night that counts as early, on the extended clock where 24 is midnight. */
const EARLY_BED = 24;
const EARLY_RUN = 3;
const GOOD_GRADES: readonly string[] = ['A', 'S'];

function earlyRun(history: readonly DayRecord[]): { from: number; to: number } | undefined {
  let best: { from: number; to: number } | undefined;
  let from = 0;
  for (const r of history) {
    // The history has every day in order, so a late night (or the final exam day, which has none) ends a run.
    if (r.bedEnd === undefined || r.bedEnd > EARLY_BED) { from = 0; continue; }
    if (from === 0) from = r.day;
    if (r.day - from + 1 >= EARLY_RUN && (best === undefined || r.day - from > best.to - best.from)) best = { from, to: r.day };
  }
  return best;
}

/** Every merit the semester earned, in the order of MERITS. */
export function meritsOf(state: SemesterState, ctx: SemesterContext, cfg: ReportFile, text: StringLookup): Merit[] {
  const sum = summarize(state, ctx);
  const out: Merit[] = [];
  const add = (id: MeritId, day: number, vars: Record<string, string> = {}) => out.push({ id, day, vars: { day: String(day), ...vars } });

  // The liver gives no warning light, so a visit to it while it is dark and orders are waiting is the lesson of design doc 8.6.
  const check = state.history.find((r) => r.lights.liver === 'off' && r.patrols.some((p) => p.floor === 'liver') && state.liverOrders.some((d) => d < r.day));
  if (check) add('liver_check', check.day);
  const declined = state.history.find((r) => r.events.some((e) => e.id === 'bbq' && (e.option === 'decline' || e.option === 'sober')));
  if (declined) add('declined', declined.day);
  const run = earlyRun(state.history);
  if (run) add('early_bed', run.from, { from: String(run.from), to: String(run.to), n: String(run.to - run.from + 1) });
  for (const r of state.history) {
    const p = r.patrols.find((x) => !x.overtime && r.lit.includes(x.floor) && GOOD_GRADES.includes(x.grade));
    if (!p) continue;
    const dept = cfg.scopes[p.floor]?.dept;
    add('patrol', r.day, { dept: dept === undefined ? p.floor : text(dept), grade: p.grade });
    break;
  }
  if (!sum.hospitalized) add('no_hospital', ctx.params.days);
  if (sum.passFin) add('passed_fin', ctx.params.finDay);
  if (sum.passMid) add('passed_mid', ctx.params.midDay);
  return out;
}

/**
 * The year-end review of design doc 8.11 for a passed semester: the first three merits as nodes on
 * the day they happened, joined by blue lines in time order. A semester that is not over or not
 * passed has none. The desk hands over the page of the first merit that has one, else the page of
 * the default cause family.
 */
export function reviewWall(state: SemesterState, ctx: SemesterContext, cfg: ReportFile, text: StringLookup): Wall | undefined {
  if (!state.ended) return undefined;
  const sum = summarize(state, ctx);
  if (!sum.passMid || !sum.passFin) return undefined;
  const merits = meritsOf(state, ctx, cfg, text).slice(0, 3);
  const ordered = [...merits].sort((a, b) => a.day - b.day || MERITS.indexOf(a.id) - MERITS.indexOf(b.id));
  const taken = new Map<number, number>();
  const nodes: WallNode[] = ordered.map((m, id) => {
    const slot = (taken.get(m.day) ?? 0) + 1;
    taken.set(m.day, slot);
    return { id, kind: 'merit', lane: 'upper', day: m.day, slot, text: fillTemplate(text(cfg.doc[MERIT_TEXT[m.id]]), m.vars) };
  });
  const links = nodes.slice(1).map((n, i) => [nodes[i]!.id, n.id] as const);
  const page = merits.map((m) => cfg.reviewPages[m.id]).find((p) => p !== undefined) ?? cfg.themes[cfg.defaultTheme]!.page;
  return { kind: 'review', nodes, links, unlock: page };
}
