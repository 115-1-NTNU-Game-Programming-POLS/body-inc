import { drawDistinct, drawInt, seedStreams } from '../rng.ts';
import { BASE_CREDITS, MAX_CREDITS, type Commitment } from './courses.ts';
import type { Scenario, SemesterContext, SemesterParams } from './types.ts';

/**
 * The overtime clauses of design doc 8.14 the presentation has: 0 normal, 1 heavier finals, 2 a setting card that always
 * disrupts. Levels 3 and up come after the presentation. The clauses stack, and the burden of the course selection is a separate axis.
 */
export const MAX_CLAUSE = 2;

/** The level a setting card is forced to be a disrupting one from. */
export const DISRUPT_FROM = 2;

/** Final-exam threshold multiplier per level; level 2 keeps the 1.1 of level 1 (the old ladder's `finMult` is 1.1 on both). */
const FIN_MULT: readonly number[] = [1, 1.1, 1.1];

export const validClause = (level: unknown): level is number => Number.isInteger(level) && (level as number) >= 0 && (level as number) <= MAX_CLAUSE;

export const clauseFinMult = (level: number): number => FIN_MULT[level] ?? 1;

/**
 * The highest level a player may start at after a semester played at `level`: clearing the top unlocked level opens the next,
 * and clearing a lower one changes nothing (design doc 8.14).
 */
export const unlockedAfter = (unlocked: number, level: number, cleared: boolean): number =>
  cleared && level === unlocked ? Math.min(MAX_CLAUSE, unlocked + 1) : unlocked;

/** The disrupting setting cards (design doc 8.12), each as the hours it takes from the evenings. */
export const SETTING_IDS = ['shifts', 'lab'] as const;
export type SettingId = (typeof SETTING_IDS)[number];

/** How many days of the semester each card falls on, as the old cards had them; the old shift card's night shift is left out, since it needs a forced bedtime. */
export const SETTING_DAYS: Readonly<Record<SettingId, number>> = { shifts: 2, lab: 2 };

/** The most credits a selection can carry at each level. ASSUME: set by the stacking sweep of design doc 9.6, see "加班條款的實作狀態" in docs/design-doc.md. */
export const CLAUSE_CREDIT_CAP: readonly number[] = [MAX_CREDITS, MAX_CREDITS, BASE_CREDITS];

export type ClauseProblem = 'burden';

/** The rule the selection breaks at `level`, or undefined when the two can be played together. */
export const clauseProblem = (level: number, credits: number): ClauseProblem | undefined =>
  credits > (CLAUSE_CREDIT_CAP[level] ?? MAX_CREDITS) ? 'burden' : undefined;

export interface Setting {
  readonly id: SettingId;
  readonly commitments: readonly Commitment[];
}


/**
 * The semester's setting card, or undefined below DISRUPT_FROM: the regular cards of design doc 8.12 are not built, so a draw
 * that could land on one has nothing to show. Drawn from the seed alone, so a saved run replays it. The hours never fall on an
 * exam day, nor on an evening with a barbecue, whose hour they would cover.
 */
export function settingFor(seed: number, level: number, params: Pick<SemesterParams, 'days' | 'midDay' | 'finDay' | 'weekend' | 'shiftHours' | 'labHours'>, scenario: Scenario): Setting | undefined {
  if (level < DISRUPT_FROM) return undefined;
  let s = seedStreams(seed);
  let i: number;
  [i, s] = drawInt(s, 'setting', SETTING_IDS.length);
  const id = SETTING_IDS[i]!;
  const days = Array.from({ length: params.days }, (_, d) => d + 1)
    .filter((d) => d !== params.midDay && d !== params.finDay && !(scenario[d] ?? []).includes('bbq'))
    .filter((d) => id === 'shifts' || !params.weekend.includes(d));
  const [chosen] = drawDistinct(s, 'setting', days, SETTING_DAYS[id]);
  const hours = id === 'shifts' ? params.shiftHours : params.labHours;
  return { id, commitments: chosen.sort((a, b) => a - b).map((day) => ({ day, hours })) };
}

export const settingHours = (setting: Setting | undefined, day: number): readonly number[] =>
  setting?.commitments.find((c) => c.day === day)?.hours ?? [];

/**
 * `ctx` under the clauses of `level`: the final exam threshold, and from level 2 the setting card the seed draws. The scenario is
 * read as it stands, so a context whose events change afterwards must be given the clause after that, and only once: the final
 * multiplier would compound.
 */
export function withClause(ctx: SemesterContext, seed: number, level: number): SemesterContext {
  if (!validClause(level)) throw new RangeError(`the overtime clause must be a whole level from 0 to ${MAX_CLAUSE}, got ${String(level)}`);
  if (ctx.clause !== undefined) throw new RangeError(`the context already carries overtime clause ${ctx.clause}`);
  if (level === 0) return ctx;
  const setting = settingFor(seed, level, ctx.params, ctx.scenario);
  return { ...ctx, clause: level, finMult: (ctx.finMult ?? 1) * clauseFinMult(level), ...(setting === undefined ? {} : { setting }) };
}
