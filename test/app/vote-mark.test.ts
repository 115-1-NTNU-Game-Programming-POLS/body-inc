import { describe, expect, it } from 'vitest';
import { REPORT_LAST, REPORT_RUN } from '../../src/app/demo.ts';
import { resumeSemester, visitReport } from '../../src/app/semester.ts';
import { advanceDay, decode, encode, RUN, type Answer, type SemesterRun } from '../../src/core/index.ts';

const MARK = '（經股東會舉手表決）';

const unvoted = (answers: readonly Answer[]): Answer[] => answers.map((a) => (a.kind === 'event' ? { kind: 'event', option: a.option } : a));
const withoutVotes = (run: SemesterRun): SemesterRun => ({ ...run, days: run.days.map(unvoted) });

/** The run played to its last night, as the scene does, with the nodes the events left and the report of that night. */
function play(run: SemesterRun, last: readonly Answer[]) {
  const back = resumeSemester(run);
  if (back === undefined) throw new Error('the run no longer replays');
  const step = advanceDay(back.state, back.ctx, last);
  if (!step.done) throw new Error('the last day asks for more than it is given');
  const events = step.state.tags.log.nodes.filter((n) => n.kind === 'event');
  return { events, doc: visitReport(step.state, back.ctx, run.seed, new Set())! };
}

describe('the show of hands in the report (ux-spec 6.2)', () => {
  const voted = play(REPORT_RUN, REPORT_LAST);
  const plain = play(withoutVotes(REPORT_RUN), unvoted(REPORT_LAST));

  // The roommate's cold is an event of the semester that nobody is asked about, so no hands are raised for it.
  const asked = (n: { key: string }): boolean => n.key !== 'event.roommate_cold.contact';

  it('marks an event answered by a vote in the causal log, one that was not answered by a vote not at all, and one nobody answers never', () => {
    expect(voted.events.filter(asked).length).toBeGreaterThan(0);
    expect(voted.events.filter(asked).every((n) => n.data?.['vote'] === true)).toBe(true);
    expect(voted.events.filter((n) => !asked(n)).every((n) => n.data?.['vote'] === undefined)).toBe(true);
    expect(plain.events.every((n) => n.data?.['vote'] === undefined)).toBe(true);
  });

  it('says in the report that those events were decided by a show of hands, and says it of nothing else', () => {
    const text = voted.doc.lines.join('\n');
    expect(text).toContain(MARK);
    expect(plain.doc.lines.join('\n')).not.toContain(MARK);
    // The mark is a parenthesis on a sentence: with it taken out the two reports are the same document.
    expect(text.split(MARK).join('')).toBe(plain.doc.lines.join('\n'));
  });

  it('is only a mark: the report cites the same visit, unlocks the same page and has no unfilled placeholder', () => {
    expect(voted.doc.unlock).toBe(plain.doc.unlock);
    expect(voted.doc.lines.join('\n')).not.toMatch(/[{}]/);
  });

  it('is part of the run a save holds, which takes only true', () => {
    expect(decode(RUN, encode(RUN, { semester: REPORT_RUN })).kind).toBe('ok');
    const bad: SemesterRun = { ...REPORT_RUN, days: [[{ kind: 'event', option: 'go', byVote: false as unknown as true }]] };
    expect(decode(RUN, encode(RUN, { semester: bad })).kind).not.toBe('ok');
  });

  it('leaves a run saved before the mark valid, as a migration from version 12', () => {
    const v12 = JSON.stringify({ schema: 12, data: { semester: { seed: 4, days: [[{ kind: 'event', option: 'go' }]] } } });
    expect(decode(RUN, v12)).toEqual({ kind: 'migrated', from: 12, data: { semester: { seed: 4, days: [[{ kind: 'event', option: 'go' }]] } } });
  });
});
