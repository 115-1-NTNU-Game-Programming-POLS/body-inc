import {
  addAmount, CHAPTER_OPENS, passBody, playOpening, record, resumeChapter, startChapter, startClock, startOpened,
  type Answer, type ChapterContent, type ChapterState, type Checkpoint, type Deck, type SemesterRun, type Tool,
} from '../core/index.ts';
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

/** The chapters the presentation plays a part of (design doc 14.1): the brain from 20:00 and the liver from the department barbecue. */
export const STORY_DEMOS = ['brain', 'liver'] as const;
export type StoryDemoId = (typeof STORY_DEMOS)[number];

/** The stamp from the prologue and the folder from the general affairs counter: what the brain chapter has handed over by the evening. */
const DEMO_TOOLS: readonly Tool[] = ['stamp', 'folder'];
/** The open office is the first room with adenosine, so the cloak's retreat is seen where the adenosine are. */
const BRAIN_ROOM = 'brain/open-office';

/** One option index per opening card, looked up by id so a reordered deck still plays the answers written here. */
function picks(deck: Deck, chosen: Readonly<Record<string, string>>): number[] {
  return deck.opening.map((card) => {
    const i = card.options.findIndex((o) => o.id === chosen[card.id]);
    if (i < 0) throw new Error(`the demo answers card "${card.id}" with "${String(chosen[card.id])}", which the deck does not offer`);
    return i;
  });
}

/**
 * The state a story demo starts from, played by the rules and never stored, so it can only drift when
 * the rules do (test/app/demo-story.test.ts pins what each one shows). Both use the fixed seed of a
 * new game. The title loads them with F2 and F4; nothing they do reaches the story slot.
 *
 * The brain opens at 20:00 on the night after a 01:00 bedtime, with no morning coffee and one cup
 * from the 17:00 machine. The residual is then about 66 and halves every five hours, so it falls below 50
 * at 22:00, which is about two minutes into play (design doc 7.4): the cloak is on at first and its retreat
 * is seen in the room with the adenosine. The operator stands in the open office with a checkpoint under
 * its feet, so a forced leave returns there and the beat can be tried again.
 *
 * The liver opens as a new game does, with the barbecue's own introduction and the guardrail it
 * shows first (design doc 7.7); dinner is eaten and the ride is shared, so the rescue has its helper.
 */
export function storyDemo(ctx: ChapterContent, id: StoryDemoId): ChapterState {
  if (ctx.chapter.id !== id) throw new Error(`the ${id} demo was given chapter "${ctx.chapter.id}"`);
  if (!ctx.deck) throw new Error(`the ${id} demo needs the chapter's opening cards`);
  const { deck, dict, params: k } = ctx;
  if (id === 'liver') {
    return startOpened(ctx, playOpening(deck, dict, picks(deck, { dinner: 'eat', ride: 'roommate' }), CHAPTER_OPENS, k), DEMO_TOOLS);
  }

  const opening = playOpening(deck, dict, picks(deck, { bedtime: 'at_01', morning_coffee: 'skip' }), CHAPTER_OPENS, k);
  const cup = startClock(1, 17);
  const evening = startClock(1, 20);
  let tags = passBody(opening.tags, dict, cup.minute - opening.clock.minute, k, opening.clock.minute);
  const [log, cause] = record(tags.log, { kind: 'activity', key: 'pickup.coffee', at: cup.minute });
  tags = addAmount({ ...tags, log }, dict, 'caffeine', k.cup, cause, cup.minute);
  tags = passBody(tags, dict, evening.minute - cup.minute, k, cup.minute);
  const placed = startChapter(ctx, { room: BRAIN_ROOM, tags, clock: evening, tools: DEMO_TOOLS });
  const checkpoint: Checkpoint = {
    chapter: id, roomId: BRAIN_ROOM, x: placed.game.operator.x, y: placed.game.operator.y, tags: placed.run.tags, clock: evening,
    fired: [], switches: [], boxes: [], tools: [...DEMO_TOOLS],
  };
  return resumeChapter(ctx, checkpoint);
}
