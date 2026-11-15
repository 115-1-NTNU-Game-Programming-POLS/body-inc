import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOSSES, CHAPTERS, DECKS, DIALOGUES, ENEMIES, PARAMS, RESCUES, TAGS } from '../../src/app/content.ts';
import { tagsFromQuery } from '../../src/app/session.ts';
import {
  amount, arrivalPoint, CHAPTER_OPENS, EMPTY_TAGS, holds, LOCK_TICKS, parseRoom, playOpening, raisedGauge, readDeck, roomsOf, startChapter, stepChapter, TICK_HZ, TILE,
  type ChapterContent, type ChapterState, type GameEvent, type TickInput, type TiledMap,
} from '../../src/core/index.ts';
import { applyEffects } from '../../src/core/chapter/effects.ts';
import { stepSnack } from '../../src/core/combat/bosses/snack.ts';
import type { SnackDef, SnackState } from '../../src/core/combat/bosses/boss.ts';
import type { EnemyState } from '../../src/core/combat/actors.ts';
import { STAMP, SUGAR_FOG } from '../../src/core/combat/frames.ts';
import { OPERATOR_BODY } from '../../src/core/combat/operator.ts';
import { parseEffects } from '../../src/core/dialogue/lines.ts';
import { compileCondition } from '../../src/core/tags/dictionary.ts';

/**
 * The stomach chapter's outer-layer cards (design doc 7.5): the dinner and bedtime cards before the
 * mixer lab, the roommate's message before the night lab, and the climax before the 1 a.m. delivery,
 * with the `gauge:` effect that carries their rewards.
 */

const NONE: TickInput = { move: { x: 0, y: 0 } };
const USE: TickInput = { ...NONE, interactPressed: true };
const CHAPTER = CHAPTERS.get('stomach')!;
const DECK = DECKS.get('stomach')!;
const loadMap = (path: string) => JSON.parse(readFileSync(`public/assets/maps/${path}.tmj`, 'utf8')) as TiledMap;
const STOMACH: ChapterContent = {
  chapter: CHAPTER,
  rooms: new Map(roomsOf(CHAPTER).map((p) => [p, parseRoom(p, loadMap(p), TAGS)])),
  dialogues: DIALOGUES, dict: TAGS, enemies: ENEMIES, bosses: BOSSES, params: PARAMS, rescues: RESCUES, deck: DECK,
};
const SNACK = BOSSES.get('snack') as SnackDef;
const tags = (q: string) => tagsFromQuery(`?tags=${q}`, TAGS);
const has = (s: ChapterState, cond: string) => holds(s.run.tags, TAGS, compileCondition(TAGS, cond));

function at(room: string, q = '', place?: { x: number; y: number }): ChapterState {
  const { pending: _, ...s } = startChapter(STOMACH, { room, ...(q ? { tags: tags(q) } : {}) });
  return place ? { ...s, game: { ...s.game, operator: { ...s.game.operator, x: place.x, y: place.y } } } : s;
}

function go(s: ChapterState, input: TickInput, n: number): { state: ChapterState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    const r = stepChapter(STOMACH, s, input);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

/** Steps with `input` until an event of one of `types` happens. */
function until(s: ChapterState, input: TickInput, types: readonly string[], max = 600): { state: ChapterState; hit: GameEvent } {
  for (let i = 0; i < max; i++) {
    const r = stepChapter(STOMACH, s, input);
    const hit = r.events.find((e) => types.includes(e.type));
    if (hit) return { state: r.state, hit };
    s = r.state;
  }
  throw new Error(`none of ${types.join()} within ${max} ticks`);
}

/** Answers the open card with its `pick`-th option (1-based) once the card takes input. */
const choose = (s: ChapterState, pick: number) => go(go(s, NONE, LOCK_TICKS).state, { ...NONE, pick }, 1);

const door = (room: string, name: string) => STOMACH.rooms.get(room)!.objects.find((o) => o.kind === 'Door' && o.name === name)!;
const boxIds = (s: ChapterState) => s.game.boxes.map((b) => b.id).sort((a, b) => a - b);
const option = (card: string, id: string) => {
  const c = DECK.opening.find((x) => x.id === card) ?? DECK.events.get(card)!;
  return c.options.findIndex((o) => o.id === id);
};

describe('the gauge effect', () => {
  it('reads gauge:N as a whole number from 1 to the gauge maximum, and nothing else', () => {
    expect(parseEffects('gauge:25', TAGS).effects).toEqual([{ kind: 'gauge', points: 25 }]);
    expect(parseEffects(`gauge:${STAMP.gaugeMax}`, TAGS).problems).toEqual([]);
    for (const bad of ['gauge:0', `gauge:${STAMP.gaugeMax + 1}`, 'gauge:2.5', 'gauge:', 'gauge:-5', 'gauge:ten']) {
      expect([bad, parseEffects(bad, TAGS).problems]).toEqual([bad, [{ code: 'gauge', part: bad }]]);
    }
  });

  it('is a combat reward, so it never shares a cell with a drink', () => {
    expect(parseEffects('tag:alcohol+1;gauge:25', TAGS, ['event']).problems).toEqual([{ code: 'alcohol-buff', part: 'gauge:25' }]);
  });

  it('is refused on a closing card, which hands the next chapter its tags only', () => {
    const raw = { version: 1, chapter: 'stomach', opening: [], events: [], closing: [{ id: 'night', options: [{ id: 'a', effect: 'gauge:10' }, { id: 'b', effect: '' }] }] };
    expect(readDeck(raw, TAGS).problems).toEqual([{ code: 'effect', section: 'closing', card: 'night', option: 'a', part: 'gauge:10', effect: 'closing' }]);
    expect(readDeck({ ...raw, opening: raw.closing, closing: [] }, TAGS).problems).toEqual([]);
  });

  it('is logged and reported as an event, and the gauge it raises stops at the maximum', () => {
    const r = applyEffects(TAGS, EMPTY_TAGS, CHAPTER_OPENS, [{ kind: 'gauge', points: 25 }], { kind: 'card', key: 'card.x.y' }, PARAMS);
    expect(r.events).toEqual([{ type: 'gaugeRaised', points: 25 }]);
    expect(r.tags.log.nodes.map((n) => n.key)).toEqual(['card.x.y', 'gauge.25']);
    expect(raisedGauge(90, [...r.events, { type: 'clockAdvanced', minutes: 5 }])).toBe(STAMP.gaugeMax);
    expect(raisedGauge(0, [])).toBe(0);
  });
});

describe('the opening cards (design doc 7.5: what dinner, and bed at what time)', () => {
  const open = (dinner: string, bedtime: string) =>
    playOpening(DECK, TAGS, [option('dinner', dinner), option('bedtime', bedtime)], CHAPTER_OPENS, PARAMS);
  const enter = (dinner: string, bedtime = 'fix_only') => {
    const o = open(dinner, bedtime);
    const { pending: _, ...s } = startChapter(STOMACH, { tags: o.tags, clock: o.clock, gauge: raisedGauge(0, o.events) });
    return s;
  };

  it('are the dinner and the bedtime cards, in that order', () => {
    expect(DECK.opening.map((c) => [c.id, c.options.map((o) => o.id)])).toEqual([
      ['dinner', ['bento', 'buffet', 'fried']],
      ['bedtime', ['fix_only', 'past_papers']],
    ]);
  });

  it('a bento is the warehouse as built, with 10 on the gauge', () => {
    const s = enter('bento');
    expect(s.game.operator.gauge).toBe(10);
    expect(boxIds(s)).toEqual([2, 3, 4, 5, 6]);
  });

  it('a buffet swaps the large portion for a small one in the same place, and raises nothing', () => {
    const s = enter('buffet');
    expect(s.game.operator.gauge).toBe(0);
    expect(boxIds(s)).toEqual([2, 3, 5, 6, 19]);
    const room = STOMACH.rooms.get('stomach/mixer-lab')!;
    const [large, small] = [4, 19].map((id) => room.objects.find((o) => o.id === id)!);
    expect([small!.props['portion'], small!.x, small!.y]).toEqual(['small', large!.x, large!.y]);
  });

  it('fried chicken adds a large portion that rides straight into the hopper, the sugar fog, and 25 on the gauge', () => {
    const s = enter('fried');
    expect(s.game.operator.gauge).toBe(25);
    expect(boxIds(s)).toEqual([2, 3, 4, 5, 6, 20]);
    expect(has(s, 'sugar_fatigue')).toBe(true);
    const fed = until(s, NONE, ['mixerFed'], 4 * TICK_HZ);
    expect(fed.hit).toMatchObject({ type: 'mixerFed', object: 20 });
  });

  it('staying up for the past papers adds to the computer-test readiness and lowers the chairman\'s spirit', () => {
    const early = enter('bento', 'fix_only');
    const late = enter('bento', 'past_papers');
    const practice = (s: ChapterState) => amount(s.run.tags, TAGS, 'exam_practice');
    expect(practice(late) - practice(early)).toBe(15);
    expect(late.game.p).toBeLessThan(early.game.p);
    // On top of what the brain chapter left, never past the bar's 100% (core/chapter/exam.ts caps the reading).
    const brain = tags('exam_practice:60');
    const o = playOpening(DECK, TAGS, [0, option('bedtime', 'past_papers')], CHAPTER_OPENS, PARAMS, brain);
    expect(amount(o.tags, TAGS, 'exam_practice')).toBe(75);
  });
});

describe('the roommate card (design doc 7.5, the mid-chapter event)', () => {
  const ROOM = 'stomach/sorting-lab';
  const east = door(ROOM, 'door-e');
  const bare = (q = '', place = { x: 16 * TILE, y: east.y + 16 }) => {
    const s = at(ROOM, q, place);
    return { ...s, game: { ...s.game, enemies: [], unlocked: [...s.game.unlocked, east.id] } };
  };

  it('is asked on the way to the night lab, before the door is reached, from either of the door\'s rows', () => {
    for (const y of [east.y + 4, east.y + east.height - 4]) {
      const r = until(bare('', { x: 16 * TILE, y }), { move: { x: 1, y: 0 } }, ['cardOpened', 'roomChanged']);
      expect(r.hit).toEqual({ type: 'cardOpened', card: 'roommate' });
    }
  });

  it('is asked only once', () => {
    const asked = until(bare(), { move: { x: 1, y: 0 } }, ['cardOpened']).state;
    const done = choose(asked, 2).state;
    const back = go(go(done, { move: { x: -1, y: 0 } }, 30).state, { move: { x: 1, y: 0 } }, 60);
    expect(back.events.map((e) => e.type)).not.toContain('cardOpened');
  });

  it('going along is 25 on the gauge, turning him down an early night, asking for breakfast 10 on the gauge', () => {
    const asked = until(bare(), { move: { x: 1, y: 0 } }, ['cardOpened']).state;
    const cases = [['go_small', 'snack_run', 25], ['sleep', 'early_night', 0], ['bring', 'snack_saved', 10]] as const;
    for (const [id, tag, gauge] of cases) {
      const r = choose(asked, option('roommate', id) + 1);
      expect([id, has(r.state, tag), r.state.game.operator.gauge - asked.game.operator.gauge]).toEqual([id, true, gauge]);
      if (gauge > 0) expect(r.events).toContainEqual({ type: 'gaugeRaised', points: gauge });
    }
  });

  it('the gauge it raises stops at the maximum', () => {
    const s = bare();
    const full = { ...s, game: { ...s.game, operator: { ...s.game.operator, gauge: STAMP.gaugeMax - 5 } } };
    const r = choose(until(full, { move: { x: 1, y: 0 } }, ['cardOpened']).state, option('roommate', 'go_small') + 1);
    expect(r.state.game.operator.gauge).toBe(STAMP.gaugeMax);
  });
});

describe('the night lab after the roommate card', () => {
  const ROOM = 'stomach/night-lab';
  const couriers = (s: ChapterState) => s.game.enemies.filter((e) => e.type === 'courier').length;

  it('has no courier after an early night, on the way to the arena and back', () => {
    expect(couriers(at(ROOM))).toBe(1);
    expect(couriers(at(ROOM, 'early_night'))).toBe(0);
    expect(couriers(at(ROOM, 'early_night,snack_settled'))).toBe(0);
  });

  it('puts the roommate\'s boxes out only on the walk back to bed', () => {
    const base = boxIds(at(ROOM));
    expect(boxIds(at(ROOM, 'snack_run'))).toEqual(base);
    expect(boxIds(at(ROOM, 'snack_saved'))).toEqual(base);
    expect(boxIds(at(ROOM, 'snack_run,snack_settled'))).toEqual([...base, 19, 20].sort((a, b) => a - b));
    expect(boxIds(at(ROOM, 'snack_saved,snack_settled'))).toEqual([...base, 21].sort((a, b) => a - b));
  });

  it('the breakfast share is one push west from the cold store', () => {
    const s = at(ROOM, 'snack_saved,snack_settled,courier_closed');
    const box = STOMACH.rooms.get(ROOM)!.objects.find((o) => o.id === 21)!;
    const r = until({ ...s, game: { ...s.game, operator: { ...s.game.operator, x: box.x + 24, y: box.y + 4 } } }, { move: { x: -1, y: 0 } }, ['boxChilled'], 3 * TICK_HZ);
    expect(r.hit).toMatchObject({ type: 'boxChilled', object: 21 });
  });

  /**
   * Walks back in from the arena with the case closed and the courier's too, goes straight to bed
   * after `wait` ticks and lies down, then sleeps up to 40 seconds. Whether the mixer's alarm woke
   * the operator and whether the chapter ended.
   */
  function bedtime(q: string, wait = 0): { woke: boolean; ended: boolean } {
    const arena = at('stomach/boss-arena', ['snack_settled', 'courier_closed', q].filter(Boolean).join(','));
    let s = until({ ...arena, game: { ...arena.game, enemies: [] } }, { move: { x: -1, y: 0 } }, ['roomChanged']).state;
    expect(s.run.roomId).toBe(ROOM);
    expect(arrivalPoint(door(ROOM, 'door-e'), OPERATOR_BODY).x).toBeCloseTo(s.game.operator.x, 0);
    s = go(s, NONE, wait).state;
    const bed = STOMACH.rooms.get(ROOM)!.objects.find((o) => o.kind === 'Bed')!;
    const target = { x: bed.x + bed.width / 2, y: bed.y - 6 };
    for (let i = 0; i < 300 && Math.hypot(target.x - s.game.operator.x, target.y - s.game.operator.y) > 3; i++) {
      const dx = target.x - s.game.operator.x;
      const dy = target.y - s.game.operator.y;
      const d = Math.hypot(dx, dy);
      s = go(s, { move: { x: dx / d, y: dy / d } }, 1).state;
    }
    const lay = go(s, USE, 1);
    expect(lay.events.map((e) => e.type)).toContain('fellAsleep');
    const night = go(lay.state, NONE, 40 * TICK_HZ);
    const types = night.events.map((e) => e.type);
    return { woke: types.includes('sleepInterrupted'), ended: types.includes('chapterEnded') };
  }

  it('going along keeps the mixer running into the sleep, so lying down at once is woken once', () => {
    expect(bedtime('snack_run')).toEqual({ woke: true, ended: false });
  });

  it('waiting for the mixer to empty first, or having stayed in, lets the operator sleep through', () => {
    expect(bedtime('snack_run', 30 * TICK_HZ)).toEqual({ woke: false, ended: true });
    expect(bedtime('early_night')).toEqual({ woke: false, ended: true });
    expect(bedtime('')).toEqual({ woke: false, ended: true });
  });
});

describe('the climax card (design doc 7.5: before the 1 a.m. delivery)', () => {
  const ROOM = 'stomach/night-lab';
  const east = door(ROOM, 'door-e');

  it('is asked once, on the arena door\'s rows, before the arena is entered', () => {
    // The top of the door's rows is as high as a body clears the food chunks above them.
    for (const y of [east.y + OPERATOR_BODY.height + 2, east.y + east.height - 4]) {
      const s = at(ROOM, 'courier_closed', { x: 16 * TILE, y });
      const r = until({ ...s, game: { ...s.game, enemies: [] } }, { move: { x: 1, y: 0 } }, ['cardOpened', 'roomChanged']);
      expect(r.hit).toEqual({ type: 'cardOpened', card: 'climax' });
    }
  });

  it('eating first sets the late snack and 25 on the gauge; saving it for breakfast sets nothing', () => {
    const s = at(ROOM, 'courier_closed', { x: 16 * TILE, y: east.y + 16 });
    const asked = until({ ...s, game: { ...s.game, enemies: [] } }, { move: { x: 1, y: 0 } }, ['cardOpened']).state;
    const eat = choose(asked, option('climax', 'eat') + 1).state;
    expect([has(eat, 'late_snack'), eat.game.operator.gauge - asked.game.operator.gauge]).toEqual([true, 25]);
    const save = choose(asked, option('climax', 'save') + 1).state;
    expect([has(save, 'late_snack'), save.game.operator.gauge]).toEqual([false, asked.game.operator.gauge]);
  });

  it('puts the chapter\'s pace on the arena only while the late snack is on', () => {
    expect(CHAPTER.climax).toEqual({ flag: 'late_snack', paceFactor: 1.5 });
    expect(go(at('stomach/boss-arena', 'late_snack'), NONE, 1).state.game.paceScale).toBe(1.5);
    expect(go(at('stomach/boss-arena'), NONE, 1).state.game.paceScale).toBeUndefined();
  });

  /** Seconds between his throws in `stage` at `pace`, from the second throw on. */
  function rhythm(stage: 1 | 2 | 3, pace: number): number {
    const boss: SnackState = { stage, ticks: 0, dock: 0, stageThrown: 1, move: null, ...(stage === 3 ? { sleep: { slept: 0, hold: 0, wakes: 0 } } : {}) } as SnackState;
    const hp = stage === 1 ? SNACK.budget : stage === 2 ? SNACK.stage2.budget : SNACK.stage3.budget;
    let e = { id: 1, hp, boss } as unknown as EnemyState;
    const thrown: number[] = [];
    for (let t = 0; t < 30 * TICK_HZ && thrown.length < 3; t++) {
      const r = stepSnack(e, SNACK, [{ x: 0, y: 0 }], { x: 100, y: 0 }, 0, pace);
      if (r.events.some((x) => x.type === 'deliveryThrown')) thrown.push(t);
      e = r.enemy;
    }
    return (thrown[2]! - thrown[1]!) / TICK_HZ;
  }

  it('the late snack makes his stage-2 large boxes come every 4 seconds instead of 6, and leaves the other stages alone', () => {
    expect(rhythm(2, 1)).toBeCloseTo(SNACK.stage2.everyTicks / TICK_HZ, 1);
    expect(rhythm(2, 1.5)).toBeCloseTo(4, 1);
    expect(rhythm(1, 1.5)).toBeCloseTo(rhythm(1, 1), 5);
    expect(rhythm(3, 1.5)).toBeCloseTo(rhythm(3, 1), 5);
  });
});

describe('what the review of the cards found', () => {
  it('fried chicken opens the chapter in the full sugar fog, which a bento does not', () => {
    const open = (dinner: string) => {
      const o = playOpening(DECK, TAGS, [option('dinner', dinner), 0], CHAPTER_OPENS, PARAMS);
      const { pending: _, ...s } = startChapter(STOMACH, { tags: o.tags, clock: o.clock });
      return s;
    };
    expect(open('fried').game.operator.fatigue).toBe(SUGAR_FOG.ticks);
    expect(open('bento').game.operator.fatigue).toBeUndefined();
  });

  it('a card that fills the gauge sounds it full, reports only what it added, and raises nothing on a full gauge', () => {
    const ROOM = 'stomach/sorting-lab';
    const east = door(ROOM, 'door-e');
    const near = (gauge: number) => {
      const s = at(ROOM, '', { x: 16 * TILE, y: east.y + 16 });
      return { ...s, game: { ...s.game, enemies: [], operator: { ...s.game.operator, gauge } } };
    };
    const pick = (gauge: number) => choose(until(near(gauge), { move: { x: 1, y: 0 } }, ['cardOpened']).state, option('roommate', 'go_small') + 1).events;
    expect(pick(90)).toEqual(expect.arrayContaining([{ type: 'gaugeRaised', points: 10 }, { type: 'gaugeFull' }]));
    expect(pick(STAMP.gaugeMax).map((e) => e.type)).not.toContain('gaugeRaised');
    expect(pick(STAMP.gaugeMax).map((e) => e.type)).not.toContain('gaugeFull');
    expect(pick(0).map((e) => e.type)).not.toContain('gaugeFull');
  });

  it('the drink rule cites the gauge part as the author wrote it', () => {
    expect(parseEffects('tag:alcohol+1;gauge:025', TAGS, ['event']).problems).toEqual([{ code: 'alcohol-buff', part: 'gauge:025' }]);
  });
});
