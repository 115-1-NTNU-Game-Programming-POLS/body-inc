import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chapterContent } from '../../src/app/chapters.ts';
import { CHAPTERS, DIALOGUES, TAGS } from '../../src/app/content.ts';
import { STORY_DEMOS, storyDemo, type StoryDemoId } from '../../src/app/demo.ts';
import {
  amount, flag, holds, hourOf, roomsOf, STAMP, stateHash, stepChapter, storyOf, TICK_HZ,
  type CaffeineDef, type CaffeineState, type ChapterContent, type ChapterState, type TiledMap, type TickInput,
} from '../../src/core/index.ts';

const IDLE: TickInput = { move: { x: 0, y: 0 } };
const loadMap = (path: string) => JSON.parse(readFileSync(`public/assets/maps/${path}.tmj`, 'utf8')) as TiledMap;
const content = (id: StoryDemoId): ChapterContent => {
  const chapter = CHAPTERS.get(id)!;
  return chapterContent(chapter, new Map(roomsOf(chapter).map((p) => [p, loadMap(p)] as const)));
};
const brain = content('brain');
const liver = content('liver');

const bedRequires = brain.rooms.get('brain/rooftop')!.objects.find((o) => o.kind === 'Bed')!.conditions['requires']!;

const idle = (s: ChapterState, ticks: number): ChapterState => {
  for (let i = 0; i < ticks; i++) s = stepChapter(brain, s, IDLE).state;
  return s;
};

describe('the chapter demos (design doc 14.1)', () => {
  it('are the brain and the liver, each from the chapter it names', () => {
    expect(STORY_DEMOS).toEqual(['brain', 'liver']);
    const other = { ...brain, chapter: { ...brain.chapter, id: 'prologue' } };
    expect(() => storyDemo(other)).toThrow(/there is no demo of chapter "prologue"/);
    expect(() => storyDemo(liver, 'arena')).toThrow(/the liver has no arena demo/);
  });

  describe('the brain from 20:00', () => {
    const start = storyDemo(brain);

    it('stands in the open office at 20:00 with the stamp and the folder and a checkpoint to come back to', () => {
      expect(start.run.roomId).toBe('brain/open-office');
      expect(hourOf(start.game.clock)).toBe(20);
      expect(start.run.tools).toEqual(['stamp', 'folder']);
      expect(start.pending).toBeUndefined();
      expect(storyOf(start.run).checkpoint).toMatchObject({ roomId: 'brain/open-office', clock: start.game.clock, tools: ['stamp', 'folder'] });
    });

    it('arrives after a 01:00 bedtime and the 17:00 machine alone, so the cloak is on and the bed door shut', () => {
      const tags = start.run.tags;
      expect(amount(tags, TAGS, 'sleep_debt')).toBe(2);
      // 100 at 17:00, halved every five hours: about 66 three hours on.
      expect(amount(tags, TAGS, 'caffeine')).toBeGreaterThan(60);
      expect(amount(tags, TAGS, 'caffeine')).toBeLessThan(70);
      expect(flag(tags, TAGS, 'one_more_cup')).toBe(false);
      expect(tags.log.nodes.map((n) => n.key)).toEqual(expect.arrayContaining(['card.bedtime.at_01', 'card.morning_coffee.skip', 'pickup.coffee']));
      expect(holds(tags, TAGS, bedRequires)).toBe(false);
    });

    it('lets the cloak fall within the first two minutes, as the caffeine of the 17:00 cup does by 22:00', () => {
      const after = idle(start, 2 * 60 * TICK_HZ);
      expect(hourOf(after.game.clock)).toBeGreaterThanOrEqual(22);
      expect(amount(after.run.tags, TAGS, 'caffeine')).toBeLessThan(50);
      expect(holds(after.run.tags, TAGS, bedRequires)).toBe(true);
      expect(amount(start.run.tags, TAGS, 'caffeine')).toBeGreaterThanOrEqual(50);
    });

    it('plays the same from every start: ten seconds of play leave the same state hash', () => {
      const a = stateHash(idle(storyDemo(brain), 600));
      const b = stateHash(idle(storyDemo(brain), 600));
      expect(a).toBe(b);
      expect(a).not.toBe(stateHash(idle(storyDemo(brain), 601)));
    });
  });

  describe('the brain at the power cut of the caffeine boss', () => {
    const start = storyDemo(brain, 'arena');
    const boss = start.game.enemies.find((e) => e.boss)!;
    const state = (s: ChapterState) => s.game.enemies.find((e) => e.boss)!.boss as CaffeineState;
    const def = start.game.bosses[state(start).def] as CaffeineDef;

    it('stands in the arena after the cloak has fallen, with the third stage begun and the boss unable to act', () => {
      expect(start.run.roomId).toBe('brain/arena');
      expect(hourOf(start.game.clock)).toBeGreaterThanOrEqual(22);
      expect(start.run.tools).toEqual(['stamp', 'folder']);
      expect(state(start).stage).toBe(3);
      expect(state(start).stunned).toBeGreaterThan(0);
      expect(boss.hp).toBe(def.stage2Budget);
    });

    it('has the adenosine at his feet piled onto him and none on the operator, who has full hearts and a full gauge', () => {
      const summoned = start.game.enemies.filter((e) => e.summoner === boss.id);
      expect(summoned.length).toBeGreaterThan(0);
      expect(summoned.every((e) => e.phase === 'pinned')).toBe(true);
      expect(start.game.enemies.some((e) => e.phase === 'attached')).toBe(false);
      expect(start.game.operator.halves).toBe(start.game.operator.maxHalves);
      expect(start.game.operator.maxHalves).toBeLessThan(999);
      expect(start.game.operator.gauge).toBe(STAMP.gaugeMax);
      expect(start.game.shots).toEqual([]);
    });

    it('goes on by the rules: no conversation opens, the cut ends after its seconds and he drinks a burst again', () => {
      let s = start;
      const seen = new Set<string>();
      for (let i = 0; i < def.powerCutTicks + 8 * TICK_HZ; i++) {
        const r = stepChapter(brain, s, IDLE);
        s = r.state;
        r.events.forEach((e) => seen.add(e.type));
        // A conversation would freeze the room, and the boss would never leave the cut.
        expect(s.dialogue).toBeNull();
      }
      expect(state(s).stunned).toBe(0);
      expect(seen.has('bossDrink')).toBe(true);
      expect(storyOf(start.run).checkpoint).toMatchObject({ roomId: 'brain/arena' });
    });

    it('is the same from every start', () => {
      expect(stateHash(storyDemo(brain, 'arena'))).toBe(stateHash(start));
    });
  });

  describe('the liver from the barbecue', () => {
    const start = storyDemo(liver);

    it('opens as a new game does: the chapter\'s first room with its introduction waiting, which begins with the guardrail', () => {
      expect(start.run.roomId).toBe(CHAPTERS.get('liver')!.start);
      expect(start.pending).toBe('liver.intro');
      expect(DIALOGUES.get('liver.intro')!.lines[0]!.text).toContain('未滿 18 歲不得飲酒');
      expect(start.run.tools).toEqual(['stamp', 'folder']);
    });

    it('has eaten and comes with the roommate, so the rescue has its helper', () => {
      expect(flag(start.run.tags, TAGS, 'fasting')).toBe(false);
      expect(flag(start.run.tags, TAGS, 'roommate')).toBe(true);
      expect(start.run.tags.log.nodes.map((n) => n.key)).toEqual(expect.arrayContaining(['card.dinner.eat', 'card.ride.roommate']));
    });
  });
});
