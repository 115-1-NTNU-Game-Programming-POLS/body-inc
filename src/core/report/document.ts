import { fillTemplate } from './bank.ts';
import { mergeFacts, placeFacts, selectGroups } from './merge.ts';
import { groupScore, pickOne, renderGroup, type RenderEnv } from './render.ts';
import { clockHour, hhmm, minuteOfDay, narrativeDay, ordinal } from './time.ts';
import { type IncidentLine, type ReportDocument, type ReportInput, type SentenceGroup } from './types.ts';

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** The digits of a case number, from the day and hour of the emergency room (ux-spec 4.2). */
function caseNumber(at: number, wakes: readonly number[]): { number: string; day: number; minute: number } {
  const day = narrativeDay(at, wakes);
  const minute = minuteOfDay(at, day);
  return { number: `${pad2(day)}${pad2(clockHour(minute))}`, day, minute };
}

/** "A", "A與B", "A、B與C". */
const listOf = (names: readonly string[]): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join('、')}與${names[names.length - 1]}`;

function causePhrase(struck: readonly string[], fasting: boolean, env: RenderEnv): string {
  const { cfg, text } = env;
  const names = struck.map((s) => {
    const scope = cfg.scopes[s];
    if (!scope) throw new RangeError(`"${s}" is not a scope of the report bank`);
    return text(scope.dept);
  });
  const list = listOf(names);
  if (struck.length === 1 && struck[0] === 'liver' && fasting) return fillTemplate(text(cfg.doc.causeLiverFasting), { list });
  return fillTemplate(text(struck.length === 1 ? cfg.doc.causeSingle : cfg.doc.causeMulti), { list });
}

/**
 * The family of causes a report is mostly about: the one whose sentences score the most, the
 * order in the bank breaking a tie. It decides the handbook page and the advice.
 */
function dominantTheme(groups: readonly SentenceGroup[], env: RenderEnv): string {
  const { cfg } = env;
  const tally = new Map<string, number>();
  for (const g of groups) {
    const theme = cfg.keys[g.key]?.theme ?? cfg.scopes[g.scope ?? '']?.theme;
    if (theme !== undefined) tally.set(theme, (tally.get(theme) ?? 0) + groupScore(cfg, g));
  }
  let best = cfg.defaultTheme;
  let most = 0;
  for (const theme of cfg.themeOrder) {
    const score = tally.get(theme) ?? 0;
    if (score > most) {
      best = theme;
      most = score;
    }
  }
  return best;
}

/** Nothing after the crisis may be cited (ux-spec 4.6, the time boundary); what is left is merged. */
function candidates(input: ReportInput, env: RenderEnv): SentenceGroup[] {
  const { cfg } = env;
  return mergeFacts(placeFacts(input.facts.filter((f) => f.at <= input.at), input.wakes), {
    run: (k) => cfg.keys[k]?.run !== undefined,
    spread: (k) => cfg.keys[k]?.spread !== undefined,
  });
}

function lineOf(g: SentenceGroup, prev: SentenceGroup | undefined, env: RenderEnv): IncidentLine {
  const r = renderGroup(g, prev, env);
  return { key: g.key, ...(g.scope !== undefined ? { scope: g.scope } : {}), form: g.form, text: r.text, firstDay: g.firstDay, lastDay: g.lastDay, at: g.at, generic: r.generic };
}

/**
 * Every sentence a report could hold, worded and in time order, before the five best are chosen.
 * A report only words its five, so the batch check uses this to see that no template, variable or
 * placeholder is broken in a sentence that merely happened not to make the cut.
 */
export function wordAll(input: ReportInput, env: RenderEnv): IncidentLine[] {
  const groups = candidates(input, env);
  return groups.map((g, i) => lineOf(g, groups[i - 1], env));
}
/**
 * Writes one report (ux-spec 4.2 to 4.6): the facts up to the crisis are merged, the best five
 * kept, worded in time order, and set into the frame of a closure notice or a bankruptcy report.
 */
export function composeReport(input: ReportInput, env: RenderEnv): ReportDocument {
  const { cfg, text, seed } = env;
  const doc = cfg.doc;
  const say = (key: string, values: Record<string, string> = {}): string => fillTemplate(text(key), values);

  const groups = candidates(input, env);
  const theme = dominantTheme(groups, env);
  const kept = selectGroups(groups, (g) => groupScore(cfg, g));
  const incident = kept.map((g, i) => lineOf(g, kept[i - 1], env));
  const items = incident.map((l, i) => say(doc.incidentItem, { n: ordinal(i + 1), text: l.text }));

  const t = cfg.themes[theme]!;
  const page = text(`handbook.${t.page}.title`);
  const unlock = text(input.known.has(t.page) ? doc.unlockKnown : doc.unlockNew);
  const cause = causePhrase(input.struck, input.fasting, env);
  const here = caseNumber(input.at, input.wakes);
  const liverNote = input.struck.includes('liver') ? [text(doc.liverNote)] : [];
  const pool = input.struck.includes('liver') ? cfg.opinions.afterStrike : theme === 'alcohol' ? cfg.opinions.hangover : cfg.opinions.default;
  const chair = say(doc.chair, { opinion: text(pickOne(pool, seed, 'opinion')) });
  const frame = [text(doc.letterhead)];
  const close = [chair, text(doc.copyTo), text(doc.copyCc)];

  let lines: string[];
  if (input.kind === 'notice') {
    const h = input.hospital;
    if (!h) throw new RangeError('a closure notice needs the hospital stay it announces');
    const missed = h.missedExam ? say(doc.noticeMissed, { exam: text(h.missedExam === 'mid' ? doc.examMid : doc.examFin) }) : '';
    lines = [
      ...frame,
      say(doc.noticeDate, { day: String(h.issueDay), time: `${pad2(h.wake)}:00` }),
      say(doc.noticeNumber, { number: here.number }),
      text(doc.recipient),
      '',
      say(doc.noticeSubject, { cause, stay: String(h.day) }),
      '',
      text(doc.explain),
      text(doc.incidentHead),
      ...items,
      say(doc.noticePenalty, { cap: String(h.cap), debt: String(h.debtPercent), missed }),
      say(doc.noticeAdvice, { page, unlock, education: text(t.education[0]!) }),
      ...liverNote,
      '',
      text(doc.noticeWarning),
      '',
      ...close,
    ];
  } else {
    const prev = input.previous;
    const before = prev ? caseNumber(prev.at, input.wakes) : undefined;
    lines = [
      ...frame,
      say(doc.bankruptDate, { day: String(here.day), time: hhmm(here.minute) }),
      say(doc.bankruptNumber, { number: here.number }),
      text(doc.recipient),
      ...(prev && before ? [say(doc.bankruptPrevious, { day: String(before.day), cause: causePhrase(prev.struck, prev.fasting, env), number: before.number })] : []),
      '',
      say(doc.bankruptSubject, { cause }),
      '',
      text(doc.explain),
      text(doc.incidentHead),
      ...items,
      say(doc.bankruptResult, { cause, situation: text(t.situation) }),
      ...liverNote,
      '',
      text(doc.bankruptAdviceHead),
      say(doc.bankruptAdvice1, { page, unlock, education: t.education.map((k) => text(k)).join('') }),
      say(doc.bankruptAdvice2, { action: text(t.action) }),
      say(doc.bankruptAdvice3, { sign: text(t.sign) }),
      '',
      ...close,
    ];
  }
  return {
    kind: input.kind,
    number: here.number,
    lines,
    incident,
    unlock: t.page,
    theme,
    generic: incident.filter((l) => l.generic).length,
    struck: input.struck,
  };
}
