import type { Answer, SemesterRun } from '../core/index.ts';
import { floorChoice, morningPlan, nightPlan, TUTORIAL_SEED } from './semester.ts';

const day = (...event: Answer[]): Answer[] => [
  { kind: 'plan', plan: morningPlan('morning', 'balanced') },
  ...event,
  { kind: 'floor', choice: floorChoice('brain') },
  { kind: 'night', plan: nightPlan('early') },
];

/**
 * The demo save of the presentation (design doc 14.1): the scripted first week up to the morning of
 * day 4, played so the barbecue of day 2 is a binge on an empty stomach and the brain is the only
 * floor visited. The elevator panel is then dark and the liver's note still smiles, while the
 * stomach conveyor is jammed. It is a run like any other, so it replays from the rules; the title
 * loads it with F9 (production ignores the URL). test/app/demo-save.test.ts pins what it leads to.
 */
export const DEMO_RUN: SemesterRun = {
  seed: TUTORIAL_SEED,
  days: [day(), day({ kind: 'event', option: 'binge' }), day()],
};
