import { type Answer, type SemesterRun } from '../core/index.ts';
import { floorChoice, morningPlan, nightPlan, type NightPlanId, TUTORIAL_COURSES, TUTORIAL_SEED } from './semester.ts';

const day = (night: NightPlanId, ...event: Answer[]): Answer[] => [
  { kind: 'plan', plan: morningPlan('morning', 'balanced') },
  ...event,
  { kind: 'floor', choice: floorChoice('brain') },
  { kind: 'night', plan: nightPlan(night) },
];

/**
 * The demo save of the presentation (design doc 14.1): the scripted first week up to the morning of
 * day 4, played so the barbecue of day 2 is a binge on an empty stomach and the brain is the only
 * floor visited. Days 2 and 3 go to bed at midnight, which is the sleep debt behind the rest: the
 * elevator panel is then dark and the liver's note still smiles, while the stomach conveyor is
 * jammed. The first operating-systems assignment opens on day 4, so the week has no homework to hand in.
 * It is a run like any other, so it replays from the rules; the title
 * loads it with F9 (production ignores the URL). test/app/demo-save.test.ts pins what it leads to.
 */
export const DEMO_RUN: SemesterRun = {
  seed: TUTORIAL_SEED,
  courses: [...TUTORIAL_COURSES],
  days: [day('early'), day('midnight', { kind: 'event', option: 'binge' }), day('midnight')],
};
