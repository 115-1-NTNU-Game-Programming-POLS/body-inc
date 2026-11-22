/**
 * The welfare cards and the career tree against the player who fights well and ignores the body (design doc 9.6): no
 * combination may lift that player's pass rate over 50%. Run by `check-cards.ts` and `test/sim/course-card-checks.test.ts`.
 *
 * "Every combination" is read as the cards and nodes that change the semester's rules, all at once and in the player's favour:
 * every patrol and overtime patrol rated S with ACE_RECORDS perfect dodges, the brain card wanted most taken whenever an offer shows it (the general cards
 * change only the fights, which the S already stands for), 開局重抽 spent to reach it, 健檢提前's earlier blood test, and under
 * clause 2 each setting card 多一種開局卡 lets the player pick. 工單明細 only shows text, so it is left out. The earlier blood test
 * is kept although it changes nothing for these players, who never patrol the liver on what it reads.
 *
 * Only the combinations that can differ are played: a course card is wanted first only by a player who takes its course, and the
 * crammer, who always patrols the immune floor, is never offered a brain card, so only its clause plays vary.
 */
import {
  BOOKED_BLOOD_TEST_DAY, runSemester, SETTING_IDS, summarize, welfareOffer, withBloodTestOn, withClause,
  type FloorChoice, type SettingId, type Strategy,
} from '../../src/core/index.ts';
import { ARCHETYPES } from './archetypes.ts';
import type { CardCheck } from './checks.ts';
import { mean } from './cards.ts';
import { owlOf } from './players.ts';
import { contextFor, scenarioFor } from './scenario.ts';

/** Design doc 9.6: the percent of seeds the skilled player who ignores the body must stay under, whatever is held. */
export const PERK_MAX_PASS = 50;
/** The skill of that player: the best fighter the sim plays. */
const ACE_SKILL = 1;
/** Perfect dodges a patrol: one every three seconds of a three-minute patrol, far past the 27 that passed the owl uncapped. */
export const ACE_RECORDS = 60;
/** The brain cards; the course ones are offered only with their course, so the selection below takes both. */
const BRAIN_CARDS = ['early_sleep', 'minutes', 'early_start', 'know_when_to_stop'] as const;
const CARD_COURSE: Partial<Record<string, string>> = { early_start: 'os', know_when_to_stop: 'algorithms' };
const PERK_COURSES = ['algorithms', 'os', 'database', 'networks'];

/** `base`, with every patrol rated S with ACE_RECORDS perfect dodges and the cards picked in the order of `wanted`, drawing the offer again when that reaches a better one. */
export function aceOf(base: Strategy, courses: readonly string[] | undefined, wanted: readonly string[], reroll: boolean): Strategy {
  const rank = (c: string): number => (wanted.includes(c) ? wanted.indexOf(c) : wanted.length);
  const best = (offer: readonly string[]): string | undefined => [...offer].sort((a, b) => rank(a) - rank(b))[0];
  return {
    ...base,
    floor: (v, today, lights): FloorChoice => {
      const c = base.floor(v, today, lights);
      const ace = { grade: 'S' as const, records: ACE_RECORDS };
      const played = [ace, ...(c.overtime !== undefined ? [ace] : [])];
      const req = { salt: v.welfare.salt, day: v.day, floor: c.patrol, grade: 'S' as const, held: v.welfare.held, courses };
      const first = welfareOffer(req);
      const pick = best(first);
      if (pick === undefined) return { ...c, played };
      if (reroll && !v.welfare.rerolled && rank(pick) > 0) {
        const again = welfareOffer({ ...req, instead: first });
        const other = best(again);
        if (again.length >= first.length && other !== undefined && rank(other) < rank(pick)) return { ...c, played, card: other, reroll: true };
      }
      return { ...c, played, card: pick };
    },
  };
}

interface PerkRow {
  readonly label: string;
  readonly pass: number;
  /** The best seed's lower exam percent, which says how far the row is from passing when none does. */
  readonly closest: number;
}

/** Pass percent over seeds 1 to `n` of `player` aced with `wanted` first, under `clause` and its `setting`, with every node. */
function perkRow(n: number, player: (courses: readonly string[] | undefined) => Strategy, courses: readonly string[] | undefined, wanted: string, clause: number, setting: SettingId | undefined): Omit<PerkRow, 'label'> {
  const pass: number[] = [];
  let closest = 0;
  const strategy = aceOf(player(courses), courses, [wanted, ...BRAIN_CARDS.filter((c) => c !== wanted)], true);
  for (let seed = 1; seed <= n; seed++) {
    const base = contextFor(ACE_SKILL, seed, courses === undefined ? {} : { courses });
    const booked = { ...base, scenario: withBloodTestOn(scenarioFor(seed), BOOKED_BLOOD_TEST_DAY), reroll: true as const };
    const ctx = withClause(booked, seed, clause, setting);
    const m = summarize(runSemester(ctx, strategy, seed), ctx);
    pass.push(m.passMid && m.passFin ? 100 : 0);
    closest = Math.max(closest, Math.min(m.mid, m.fin));
  }
  return { pass: mean(pass), closest };
}

/** The players of design doc 9.4 who fight well and ignore the body: the night owl and the crammer, and the owl who also works the course cards. */
const PLAYERS: readonly { name: string; courses: readonly string[] | undefined; brain: boolean; of: (c: readonly string[] | undefined) => Strategy }[] = [
  { name: 'night owl', courses: undefined, brain: true, of: () => ARCHETYPES.nightOwl },
  { name: 'crammer', courses: undefined, brain: false, of: () => ARCHETYPES.crammer },
  { name: 'night owl with the course cards', courses: PERK_COURSES, brain: true, of: () => owlOf(true) },
];

export function perkChecks(n = 100): CardCheck[] {
  const plays: readonly [number, SettingId | undefined][] = [[0, undefined], [1, undefined], ...SETTING_IDS.map((s) => [2, s] as [number, SettingId])];
  return PLAYERS.map((p) => {
    const rows: PerkRow[] = [];
    const offered = (c: string): boolean => CARD_COURSE[c] === undefined || (p.courses ?? []).includes(CARD_COURSE[c]!);
    const wants = p.brain ? BRAIN_CARDS.filter(offered) : [BRAIN_CARDS[0]];
    for (const wanted of wants) {
      for (const [clause, setting] of plays) {
        const what = p.brain ? `${wanted}, ` : 'no brain card, ';
        rows.push({ label: `${what}clause ${clause}${setting ? ` ${setting}` : ''}`, ...perkRow(n, p.of, p.courses, wanted, clause, setting) });
      }
    }
    const worst = rows.reduce((a, b) => (b.pass > a.pass || (b.pass === a.pass && b.closest > a.closest) ? b : a));
    const best = worst.pass > 0 ? `best ${worst.pass.toFixed(1)}% (${worst.label})` : `0.0% in every one, closest exam ${worst.closest.toFixed(1)}% (${worst.label})`;
    return {
      name: `perks: the ${p.name} passes under ${PERK_MAX_PASS}% whatever cards and nodes it holds`,
      pass: worst.pass < PERK_MAX_PASS,
      detail: `${best} of ${rows.length} combinations, wanted under ${PERK_MAX_PASS}%`,
    };
  });
}
