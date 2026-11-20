import {
  CHAPTER_OPENS, passBody, playOpening, resumeChapter, startChapter, startClock, startOpened, stepChapter,
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

/** The chapters the presentation plays a part of (design doc 14.1); docs/build-plan.md says what each demo shows. */
export const STORY_DEMOS = ['brain', 'liver'] as const;
export type StoryDemoId = (typeof STORY_DEMOS)[number];
export const isStoryDemo = (id: string): id is StoryDemoId => (STORY_DEMOS as readonly string[]).includes(id);

/** What the brain chapter has handed over by the evening: the stamp from the prologue and the folder from the general affairs counter. */
const DEMO_TOOLS: readonly Tool[] = ['stamp', 'folder'];
/** The first room with adenosine, so that the cloak's retreat is seen where the adenosine are. */
const BRAIN_ROOM = 'brain/open-office';
const COFFEE_ROOM = 'brain/coffee-pm';

/** One option index per opening card, looked up by id so a reordered deck still plays the answers written here. */
function picks(deck: Deck, chosen: Readonly<Record<string, string>>): number[] {
  return deck.opening.map((card) => {
    const i = card.options.findIndex((o) => o.id === chosen[card.id]);
    if (i < 0) throw new Error(`the demo answers card "${card.id}" with "${String(chosen[card.id])}", which the deck does not offer`);
    return i;
  });
}

/**
 * The state a story demo of `ctx`'s chapter starts from, played by the rules and never stored, with the
 * fixed seed of a new game. The brain stands in the open office at 20:00 with a checkpoint under its
 * feet; the liver opens as a new game does.
 */
export function storyDemo(ctx: ChapterContent): ChapterState {
  const id = ctx.chapter.id;
  if (!isStoryDemo(id)) throw new Error(`there is no demo of chapter "${id}"`);
  if (!ctx.deck) throw new Error(`the ${id} demo needs the chapter's opening cards`);
  const { deck, dict, params: k } = ctx;
  if (id === 'liver') {
    return startOpened(ctx, playOpening(deck, dict, picks(deck, { dinner: 'eat', ride: 'roommate' }), CHAPTER_OPENS, k), DEMO_TOOLS);
  }

  const opening = playOpening(deck, dict, picks(deck, { bedtime: 'at_01', morning_coffee: 'skip' }), CHAPTER_OPENS, k);
  const cup = startClock(1, 17);
  const evening = startClock(1, 20);
  // The cup is taken from the 17:00 machine by the chapter's own pickup rule, so a change to what a cup does moves the demo.
  const machine = ctx.rooms.get(COFFEE_ROOM)?.objects.find((o) => o.kind === 'Pickup');
  if (!machine) throw new Error(`${COFFEE_ROOM} has no coffee to pick up`);
  const reached = startChapter(ctx, { room: COFFEE_ROOM, clock: cup, tools: DEMO_TOOLS, tags: passBody(opening.tags, dict, cup.minute - opening.clock.minute, k, opening.clock.minute) });
  const at = { ...reached, game: { ...reached.game, operator: { ...reached.game.operator, x: machine.x, y: machine.y } } };
  const taken = stepChapter(ctx, at, { move: { x: 0, y: 0 }, interactPressed: true }).state;
  if (taken.run.fired.length === 0) throw new Error('the demo could not take the cup from the 17:00 machine');
  const tags = passBody(taken.run.tags, dict, evening.minute - taken.game.clock.minute, k, taken.game.clock.minute);
  const placed = startChapter(ctx, { room: BRAIN_ROOM, tags, clock: evening, tools: DEMO_TOOLS });
  const checkpoint: Checkpoint = {
    chapter: id, roomId: BRAIN_ROOM, x: placed.game.operator.x, y: placed.game.operator.y, tags: placed.run.tags, clock: evening,
    fired: [], switches: [], boxes: [], tools: [...DEMO_TOOLS],
  };
  return resumeChapter(ctx, checkpoint);
}
