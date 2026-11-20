import {
  CHAPTER_OPENS, passBody, playOpening, resumeChapter, STAMP, startChapter, startClock, startOpened, stepChapter, TICK_HZ,
  type Answer, type CaffeineDef, type CaffeineState, type ChapterContent, type ChapterState, type Checkpoint, type Deck, type EnemyState,
  type RuleClock, type SemesterRun, type TagState, type TickInput, type Tool,
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

/** A day of studying until 01:00 on two cups, the liver the floor visited: `before` answers the events that come before the floor, `after` those after the night. */
const crunch = (before: readonly Answer[] = [], after: readonly Answer[] = []): Answer[] => [
  { kind: 'plan', plan: morningPlan('two', 'balanced') },
  ...before,
  { kind: 'floor', choice: floorChoice('liver') },
  { kind: 'night', plan: nightPlan('late') },
  ...after,
];
const say = (option: string): Answer => ({ kind: 'event', option });

/**
 * The run behind the pre-generated report (design doc 14.1, ux-spec 6). Every answer is one the menus
 * offer, so a player can play it; seed 46 closes the company on day 7. docs/build-plan.md says how
 * it was found and what test/app/demo-report.test.ts pins.
 */
export const REPORT_RUN: SemesterRun = {
  seed: 46,
  courses: [...TUTORIAL_COURSES],
  days: [
    crunch(),
    crunch([say('decline')], [say('go')]),
    crunch([say('decline'), say('squeeze')], [say('go')]),
    crunch(),
    [],
    crunch(),
  ],
};

/** The answers of day 7, the night that closes the company: the title plays it so the wall and the report open at once. */
export const REPORT_LAST: readonly Answer[] = crunch();

/** The chapters the presentation plays a part of (design doc 14.1); docs/build-plan.md says what each demo shows. */
export const STORY_DEMOS = ['brain', 'liver'] as const;
export type StoryDemoId = (typeof STORY_DEMOS)[number];
export const isStoryDemo = (id: string): id is StoryDemoId => (STORY_DEMOS as readonly string[]).includes(id);

/** What the brain chapter has handed over by the evening: the stamp from the prologue and the folder from the general affairs counter. */
const DEMO_TOOLS: readonly Tool[] = ['stamp', 'folder'];
/** The first room with adenosine, so that the cloak's retreat is seen where the adenosine are. */
const BRAIN_ROOM = 'brain/open-office';
const COFFEE_ROOM = 'brain/coffee-pm';
const ARENA_ROOM = 'brain/arena';
const IDLE: TickInput = { move: { x: 0, y: 0 } };
/** The longest an untouched boss may take to reach his first power cut. */
const CUT_LIMIT = 300 * TICK_HZ;

/** One option index per opening card, looked up by id so a reordered deck still plays the answers written here. */
function picks(deck: Deck, chosen: Readonly<Record<string, string>>): number[] {
  return deck.opening.map((card) => {
    const i = card.options.findIndex((o) => o.id === chosen[card.id]);
    if (i < 0) throw new Error(`the demo answers card "${card.id}" with "${String(chosen[card.id])}", which the deck does not offer`);
    return i;
  });
}

/** Which moment of the chapter a demo starts from; the arena is the brain chapter's boss. */
export type StoryPart = 'start' | 'arena';

/**
 * The tags of the brain's evening at `hour`: a 01:00 bedtime, no morning coffee and one cup taken from the 17:00 machine
 * by the chapter's own pickup rule, so a change to what a cup does moves the demo.
 */
function brainTags(ctx: ChapterContent, deck: Deck, hour: number): TagState {
  const { dict, params: k } = ctx;
  const opening = playOpening(deck, dict, picks(deck, { bedtime: 'at_01', morning_coffee: 'skip' }), CHAPTER_OPENS, k);
  const cup = startClock(1, 17);
  const machine = ctx.rooms.get(COFFEE_ROOM)?.objects.find((o) => o.kind === 'Pickup');
  if (!machine) throw new Error(`${COFFEE_ROOM} has no coffee to pick up`);
  const reached = startChapter(ctx, { room: COFFEE_ROOM, clock: cup, tools: DEMO_TOOLS, tags: passBody(opening.tags, dict, cup.minute - opening.clock.minute, k, opening.clock.minute) });
  const at = { ...reached, game: { ...reached.game, operator: { ...reached.game.operator, x: machine.x, y: machine.y } } };
  const taken = stepChapter(ctx, at, { move: { x: 0, y: 0 }, interactPressed: true }).state;
  if (taken.run.fired.length === 0) throw new Error('the demo could not take the cup from the 17:00 machine');
  return passBody(taken.run.tags, dict, startClock(1, hour).minute - taken.game.clock.minute, k, taken.game.clock.minute);
}

/** The chapter at `room` with a checkpoint under the operator's feet, so a forced leave returns there. */
function resumedAt(ctx: ChapterContent, room: string, tags: TagState, clock: RuleClock): ChapterState {
  const placed = startChapter(ctx, { room, tags, clock, tools: DEMO_TOOLS });
  const checkpoint: Checkpoint = {
    chapter: ctx.chapter.id, roomId: room, x: placed.game.operator.x, y: placed.game.operator.y, tags: placed.run.tags, clock,
    fired: [], switches: [], boxes: [], tools: [...DEMO_TOOLS],
  };
  return resumeChapter(ctx, checkpoint);
}

const caffeine = (e: EnemyState): (EnemyState & { readonly boss: CaffeineState }) | undefined =>
  e.boss?.behaviour === 'caffeine' ? (e as EnemyState & { readonly boss: CaffeineState }) : undefined;

/**
 * The caffeine boss at the first power cut of his third stage: the adenosine at his feet piled onto him, the
 * stamp gauge full, so a presenter has the whole cut to hit him and the burst after it to reject a proposal.
 * It is the arena played by the rules: the boss is put in stage 2 with caffeine still above his boost threshold and
 * left alone until his own rules cut the power, then the operator is given back as the room began.
 */
function arenaDemo(ctx: ChapterContent, deck: Deck): ChapterState {
  const base = resumedAt(ctx, ARENA_ROOM, brainTags(ctx, deck, 22), startClock(1, 22));
  const boss = base.game.enemies.find((e) => caffeine(e));
  if (!boss) throw new Error(`${ARENA_ROOM} has no caffeine boss`);
  const def = base.game.bosses[caffeine(boss)!.boss.def] as CaffeineDef;
  // The operator is made unhurtable only while the fight plays out alone, which a restored operator then forgets.
  let state: ChapterState = {
    ...base,
    game: {
      ...base.game,
      operator: { ...base.game.operator, halves: 999, maxHalves: 999 },
      enemies: base.game.enemies.map((e) => (e === boss ? { ...e, hp: def.stage2Budget, boss: { ...caffeine(e)!.boss, stage: 2, burst: 0, rest: 1, residue: 2 * def.boostMin, boosted: true, summonIn: 0 } } : e)),
    },
  };
  for (let t = 0; t < CUT_LIMIT; t++) {
    const r = stepChapter(ctx, state, IDLE);
    state = r.state;
    if (!r.events.some((e) => e.type === 'powerCut')) continue;
    if (state.game.enemies.some((e) => e.summoner === boss.id && e.phase === 'pinned') === false) throw new Error('the power cut came with no adenosine to pin');
    if (state.game.enemies.some((e) => e.phase === 'attached')) throw new Error('adenosine clings to the operator at the power cut');
    // The room remembers which triggers the operator stands on; the one at the door must not fire again for an operator put back on it.
    return { ...state, game: { ...state.game, operator: { ...base.game.operator, gauge: STAMP.gaugeMax }, touching: base.game.touching } };
  }
  throw new Error('the caffeine boss never reached his power cut');
}

/**
 * The state a story demo of `ctx`'s chapter starts from, played by the rules and never stored, with the
 * fixed seed of a new game. The brain stands in the open office at 20:00 or in the arena at his power cut,
 * with a checkpoint under its feet; the liver opens as a new game does.
 */
export function storyDemo(ctx: ChapterContent, part: StoryPart = 'start'): ChapterState {
  const id = ctx.chapter.id;
  if (!isStoryDemo(id)) throw new Error(`there is no demo of chapter "${id}"`);
  if (!ctx.deck) throw new Error(`the ${id} demo needs the chapter's opening cards`);
  const { deck, dict, params: k } = ctx;
  if (id === 'liver') {
    if (part !== 'start') throw new Error('the liver has no arena demo');
    return startOpened(ctx, playOpening(deck, dict, picks(deck, { dinner: 'eat', ride: 'roommate' }), CHAPTER_OPENS, k), DEMO_TOOLS);
  }
  return part === 'arena' ? arenaDemo(ctx, deck) : resumedAt(ctx, BRAIN_ROOM, brainTags(ctx, deck, 20), startClock(1, 20));
}
