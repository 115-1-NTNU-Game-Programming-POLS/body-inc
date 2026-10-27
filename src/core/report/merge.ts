import { MAX_INCIDENT, type ReportFact, type SentenceGroup, type PlacedFact } from './types.ts';
import { minuteOfDay, narrativeDay } from './time.ts';

export function placeFacts(facts: readonly ReportFact[], wakes: readonly number[]): PlacedFact[] {
  return facts.map((fact) => {
    const day = narrativeDay(fact.at, wakes);
    return { fact, day, minute: minuteOfDay(fact.at, day) };
  });
}

/** Which merged wordings a key has; a key without one is told day by day instead. */
export interface MergeRules {
  readonly run: (key: string) => boolean;
  readonly spread: (key: string) => boolean;
}

const cmp = (a: string | number, b: string | number): number => (a < b ? -1 : a > b ? 1 : 0);

function groupOf(members: readonly PlacedFact[], days: readonly number[], form: SentenceGroup['form']): SentenceGroup {
  const sorted = members.slice().sort((a, b) => a.fact.at - b.fact.at);
  const first = sorted[0]!;
  return {
    key: first.fact.key,
    ...(first.fact.scope !== undefined ? { scope: first.fact.scope } : {}),
    form,
    members: sorted,
    days,
    firstDay: days[0]!,
    lastDay: days[days.length - 1]!,
    at: first.fact.at,
    parent: sorted.some((m) => m.fact.parent === true),
  };
}

const byDay = (members: readonly PlacedFact[]): Map<number, PlacedFact[]> => {
  const days = new Map<number, PlacedFact[]>();
  for (const m of members) days.set(m.day, [...(days.get(m.day) ?? []), m]);
  return days;
};

/**
 * ux-spec 4.6. Facts of one key and scope make one sentence: several on a day are counted, the same
 * key on consecutive days is a run ("連續三晚"), on days apart a spread ("共三次"). A key with no
 * wording for the merged form is told day by day. Groups come back in time order.
 */
export function mergeFacts(placed: readonly PlacedFact[], rules: MergeRules): SentenceGroup[] {
  const buckets = new Map<string, PlacedFact[]>();
  for (const p of placed) {
    const id = `${p.fact.key}\u0000${p.fact.scope ?? ''}`;
    buckets.set(id, [...(buckets.get(id) ?? []), p]);
  }
  const out: SentenceGroup[] = [];
  for (const members of buckets.values()) {
    const perDay = byDay(members);
    const days = [...perDay.keys()].sort((a, b) => a - b);
    const key = members[0]!.fact.key;
    const consecutive = days.every((d, i) => i === 0 || d === days[i - 1]! + 1);
    const form = days.length === 1 ? 'single' : consecutive ? 'run' : 'spread';
    if (form === 'single' || (form === 'run' ? !rules.run(key) : !rules.spread(key))) {
      for (const d of days) out.push(groupOf(perDay.get(d)!, [d], 'single'));
    } else {
      out.push(groupOf(members, days, form));
    }
  }
  return out.sort((a, b) => a.at - b.at || cmp(a.key, b.key) || cmp(a.scope ?? '', b.scope ?? ''));
}

/**
 * ux-spec 4.6, sentence selection: the sentences that fit are the highest-scoring ones, the direct
 * parents of the crisis always among them, then back in time order. When the parents alone are more
 * than fit, the best-scoring of them stay.
 */
export function selectGroups(groups: readonly SentenceGroup[], scoreOf: (g: SentenceGroup) => number, max: number = MAX_INCIDENT): SentenceGroup[] {
  const rank = (a: SentenceGroup, b: SentenceGroup): number =>
    scoreOf(b) - scoreOf(a) || b.members.length - a.members.length || a.at - b.at || cmp(a.key, b.key) || cmp(a.scope ?? '', b.scope ?? '');
  const kept = [...groups.filter((g) => g.parent).sort(rank), ...groups.filter((g) => !g.parent).sort(rank)].slice(0, max);
  return kept.sort((a, b) => a.at - b.at || rank(a, b));
}
