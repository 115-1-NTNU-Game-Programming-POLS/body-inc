import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BOSS, boostFactor, BossTableError, createGame, DODGE, GameSetupError, loadBossTable, loadEnemyTable, NO_INPUT, REFORM_TICKS,
  stateHash, step, STAMP, STAMP_LAND, TELEGRAPH, TICK_HZ, TILE, ZONE_MAX_ACTIVE,
  type BossState, type CaffeineParams, type DomainEvent, type EnemyState, type EnteredRoom, type GameState, type TickInput,
} from '../../src/core/index.ts';

const TABLE = loadEnemyTable(JSON.parse(readFileSync('content/enemies.json', 'utf8')));
const PARAMS = JSON.parse(readFileSync('content/params.json', 'utf8')).defaults as CaffeineParams;
const RAW = JSON.parse(readFileSync('content/bosses/caffeine.json', 'utf8'));
const BOSSES = loadBossTable([RAW], TABLE, PARAMS);
const DEF = BOSSES.get('caffeine')!;
const HOME = { x: 320, y: 168 };

/** Open 20 x 12 room with a one-tile border, the boss at HOME and the operator where asked. */
function arena(start: { x: number; y: number }, extra: { type: string; x: number; y: number }[] = []): EnteredRoom {
  const cols = 20;
  const rows = 12;
  const solid = Array.from({ length: cols * rows }, (_, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    return c === 0 || r === 0 || c === cols - 1 || r === rows - 1;
  });
  const spawns = [{ type: 'caffeine', ...HOME }, ...extra];
  return {
    id: 'arena', grid: { cols, rows, solid }, props: {}, variants: [], active: [],
    objects: [
      { id: 1, kind: 'PlayerStart', name: '', x: start.x, y: start.y, width: 0, height: 0, props: {}, conditions: {} },
      ...spawns.map((s, i) => ({
        id: 10 + i, kind: 'Spawn', name: '', x: s.x, y: s.y, width: 0, height: 0, conditions: {},
        props: { enemyType: s.type, count: 1, respawnSeconds: 0, when: '' },
      })),
    ],
  };
}

/** Four tiles below the boss: inside his preferred range, so he stands still between moves. */
const NEAR = { x: HOME.x, y: HOME.y + 4 * TILE };

const fight = (start = NEAR, gauge = 0) => createGame(arena(start), 1, TABLE, { bosses: BOSSES, gauge });
const boss = (s: GameState): EnemyState => s.enemies.find((e) => e.boss)!;
const withBoss = (s: GameState, b: Partial<BossState>, e: Partial<EnemyState> = {}): GameState =>
  ({ ...s, enemies: s.enemies.map((x) => (x.boss ? { ...x, ...e, boss: { ...x.boss, ...b } } : x)) });
/** Same boss, but its move table holds only `id`, so the next attack is that one. */
const only = (s: GameState, id: string): GameState =>
  ({ ...s, bosses: { ...s.bosses, caffeine: { ...DEF, moves: DEF.moves.filter((m) => m.id === id) } } });
/** Past the opening cup with no caffeine, ready to attack on the next tick. */
const ready = (s: GameState): GameState => withBoss(s, { burst: 0, rest: 1, lowTicks: 0, residue: 0 });
const press = (extra: Partial<TickInput> = {}): TickInput => ({ ...NO_INPUT, ...extra });

interface Run { state: GameState; events: DomainEvent[][] }
function run(state: GameState, ticks: number, input: (t: number, s: GameState) => TickInput = () => NO_INPUT): Run {
  const events: DomainEvent[][] = [];
  let s = state;
  for (let t = 0; t < ticks; t++) {
    const r = step(s, input(t, s));
    s = r.state;
    events.push([...r.events]);
  }
  return { state: s, events };
}
const firstTick = (r: Run, type: DomainEvent['type']) => r.events.findIndex((es) => es.some((e) => e.type === type));
const ofType = <T extends DomainEvent['type']>(r: Run, type: T) =>
  r.events.flat().filter((e): e is Extract<DomainEvent, { type: T }> => e.type === type);

describe('boss definitions (design doc 5.3)', () => {
  const load = (edit: (raw: typeof RAW) => void) => {
    const raw = structuredClone(RAW);
    edit(raw);
    return () => loadBossTable([raw], TABLE, PARAMS);
  };

  it('loads the caffeine boss with each tier at its telegraph length', () => {
    expect(DEF.moves.map((m) => [m.id, m.tier, m.telegraphTicks])).toEqual([
      ['cup_throw', 1, TELEGRAPH.tier1Ticks], ['refill_plan', 3, 78], ['splash', 2, TELEGRAPH.tier2Ticks],
    ]);
    expect([TELEGRAPH.tier1Ticks, TELEGRAPH.tier2Ticks, TELEGRAPH.tier3MinTicks, TELEGRAPH.tier3MaxTicks]).toEqual([30, 48, 72, 90]);
  });

  it('refuses a telegraph outside its tier, an area live longer than the i-frames, and a signature move under a heart', () => {
    expect(load((r) => { r.moves.refill_plan.telegraphSeconds = 1.6; })).toThrow(/tier-3 telegraph is 1.2 to 1.5 s/);
    expect(load((r) => { r.moves.splash.telegraphSeconds = 0.6; })).toThrow(/tier-2 telegraph is 0.8 s/);
    expect(load((r) => { r.moves.splash.activeTicks = ZONE_MAX_ACTIVE + 1; })).toThrow(/a dodge could not avoid it/);
    expect(load((r) => { r.moves.refill_plan.halves = 1; })).toThrow(/whole heart/);
    expect(load((r) => { r.moves.cup_throw.halves = 2; })).toThrow(/half a heart/);
    expect(ZONE_MAX_ACTIVE).toBe(DODGE.iframeLast - DODGE.iframeFirst + 1);
  });

  it('refuses an unknown summon, a move named like a built-in action, and a boss enemy without a file', () => {
    expect(load((r) => { r.summon.enemy = 'ghost'; })).toThrow(/summon.enemy "ghost"/);
    expect(load((r) => { r.moves.drink = r.moves.splash; })).toThrow(/built-in action/);
    expect(() => loadBossTable([], TABLE, PARAMS)).toThrow(BossTableError);
  });

  it('a room with a boss cannot start without the boss table', () => {
    expect(() => createGame(arena(NEAR), 1, TABLE)).toThrow(GameSetupError);
  });
});

describe('caffeine residue on the boss clock (design doc 7.4, 9.6)', () => {
  it('opens the fight with a cup: residue 100', () => {
    const r = run(fight(), DEF.restTicks + DEF.drinkTicks + 2);
    expect(ofType(r, 'bossDrink')).toEqual([{ type: 'bossDrink', target: 1, residue: 100, cups: 1 }]);
  });

  it('halves every 30 s, because one game hour is 6 s in a boss fight', () => {
    // Held under review so nothing but decay touches the residue.
    const s = withBoss(fight(), { residue: 100, review: 31 * TICK_HZ });
    expect(boss(run(s, 30 * TICK_HZ).state).boss!.residue).toBeCloseTo(50, 6);
    expect(PARAMS.halfLife * PARAMS.bossSecondsPerHour).toBe(30);
  });

  it('speeds him up 1.2 at 25 or more, only 1.1 from the third cup, and not at all below 25', () => {
    const b = boss(fight()).boss!;
    expect(boostFactor(DEF, { ...b, residue: 25, cups: 1 })).toBe(1.2);
    expect(boostFactor(DEF, { ...b, residue: 80, cups: 3 })).toBe(1.1);
    expect(boostFactor(DEF, { ...b, residue: 24.9, cups: 1 })).toBe(1);
  });

  it('the boost shows in how fast he walks', () => {
    // Far away, so he walks toward the operator; rest held high so he does not start a move.
    const far = { x: 600, y: 330 };
    const walked = (residue: number) => {
      const s = withBoss(fight(far), { residue, burst: 0, rest: 999 });
      return Math.hypot(boss(run(s, 10).state).x - HOME.x, boss(run(s, 10).state).y - HOME.y);
    };
    expect(walked(100) / walked(0)).toBeCloseTo(1.2, 2);
  });
});

describe('every boss move can be dodged (build plan P4)', () => {
  for (const m of DEF.moves) {
    it(`${m.id} (tier ${m.tier}) hits a standing operator, and a dodge leaves hearts unchanged`, () => {
      const start = ready(only(fight(), m.id));
      const span = 60 + m.telegraphTicks + m.activeTicks + m.recoverTicks;

      const control = run(start, span);
      const t = firstTick(control, 'telegraph');
      const h = firstTick(control, 'heartLost');
      expect(ofType(control, 'telegraph')[0]).toMatchObject({ tier: m.tier, move: m.id });
      expect(h).toBeGreaterThan(t);
      expect(ofType(control, 'heartLost')[0]!.halves).toBe(m.halves);
      // Areas land on the first tick after the telegraph; so a dodge on its last tick covers them.
      if (m.tier !== 1) expect(h).toBe(t + m.telegraphTicks);

      // Tier 1 is a thrown cup: dodge as it arrives. Tiers 2 and 3: dodge as the telegraph ends.
      // Areas: toward the boss, so the dodge stays inside the area. A cup: sideways, because a dodge's first frame is not yet invincible and stepping into the cup would meet it there.
      const at = m.tier === 1 ? h - 1 : t + m.telegraphTicks - 1;
      const dir = m.tier === 1 ? { x: 1, y: 0 } : { x: 0, y: -1 };
      const dodged = run(start, span, (k) => press({ dodgePressed: k === at, move: k === at ? dir : { x: 0, y: 0 } }));
      expect(ofType(dodged, 'heartLost')).toEqual([]);
      expect(dodged.state.operator.halves).toBe(start.operator.halves);
      // The i-frames took it, not the dodge's distance.
      expect(ofType(dodged, 'perfectDodge').length).toBeGreaterThan(0);
    });
  }

  it('hit-stop never stretches a telegraph: a boss shot during it still lands on time', () => {
    const start = ready(only(fight(), 'splash'));
    const shooting = run({ ...start, operator: { ...start.operator, aim: { x: 0, y: -1 } } }, 120, () => press({ attack: true }));
    expect(ofType(shooting, 'hit').length).toBeGreaterThan(2);
    expect(boss(shooting.state).frozen).toBe(0);
    expect(firstTick(shooting, 'heartLost') - firstTick(shooting, 'telegraph')).toBe(TELEGRAPH.tier2Ticks);
  });
});

describe('stamp against the boss (design doc 5.4)', () => {
  // Three tiles away: inside the stamp radius and the boss's range.
  const close = { x: HOME.x, y: HOME.y + 3 * TILE };

  it('a stamp that lands during the proposal rejects it: no hit, 4 s under review at 1.5 times damage', () => {
    const start = ready(only(fight(close, STAMP.gaugeMax), 'refill_plan'));
    const t = firstTick(run(start, 10), 'telegraph');
    // Pressed so that it lands halfway through the 1.3 s telegraph.
    const at = t + 30 - STAMP_LAND + 1;
    const r = run(start, t + 200, (k) => press({ stampPressed: k === at }));
    expect(ofType(r, 'proposalRejected')).toEqual([{ type: 'proposalRejected', target: 1 }]);
    expect(ofType(r, 'heartLost')).toEqual([]);
    expect(boss(r.state).hp).toBe(DEF.budget - BOSS.stampDamage);

    const after = run(start, t + 31, (k) => press({ stampPressed: k === at })).state;
    expect(boss(after).boss!.review).toBeGreaterThan(BOSS.reviewTicks - 10);
    expect(after.zones).toEqual([]);
    const shot = run({ ...after, operator: { ...after.operator, aim: { x: 0, y: -1 } } }, 24, (k) => press({ attackPressed: k === 0 }));
    expect(ofType(shot, 'hit').at(-1)!.hpLeft).toBe(DEF.budget - BOSS.stampDamage - 1.5);
  });

  it('a stamp outside a proposal takes 40 and rejects nothing', () => {
    const start = ready(only(fight(close, STAMP.gaugeMax), 'splash'));
    const r = run(start, STAMP_LAND + 4, (k) => press({ stampPressed: k === 0 }));
    expect(ofType(r, 'proposalRejected')).toEqual([]);
    expect(boss(r.state).hp).toBe(DEF.budget - BOSS.stampDamage);
    expect(boss(r.state).boss!.review).toBe(0);
  });

  it('review holds him still: no move starts for 4 s', () => {
    const s = withBoss(ready(fight()), { review: BOSS.reviewTicks });
    const r = run(s, BOSS.reviewTicks);
    expect(ofType(r, 'telegraph')).toEqual([]);
    expect(ofType(run(r.state, 10), 'telegraph')).toHaveLength(1);
  });
});

describe('stages: tolerance, summons and the power cut (design doc 7.4)', () => {
  it('stage 2 starts at two thirds of the budget with a burst of cups; the third cup brings tolerance', () => {
    const s = withBoss(fight(), { burst: 0, cups: 1, rest: 1, residue: 0 }, { hp: DEF.stage2Budget });
    const r = run(s, 4 * TICK_HZ);
    expect(ofType(r, 'bossStage')).toEqual([{ type: 'bossStage', target: 1, stage: 2 }]);
    expect(ofType(r, 'bossDrink').map((e) => e.cups)).toEqual([2, 3]);
    expect(boostFactor(DEF, boss(r.state).boss!)).toBe(PARAMS.boostTolerant);
  });

  it('in stage 2 he summons adenosine at his feet, up to the cap', () => {
    const s0 = withBoss(fight({ x: 600, y: 330 }), { stage: 2, burst: 0, rest: 1, residue: 200, boosted: true, summonIn: 0 });
    // Enough hearts that a long fight never ends in a forced leave, which would send the summons away.
    const s = { ...s0, operator: { ...s0.operator, halves: 999, maxHalves: 999 } };
    const r = run(s, 120 * TICK_HZ);
    const summoned = r.state.enemies.filter((e) => e.summoner === 1);
    expect(ofType(r, 'bossSummon')[0]).toEqual({ type: 'bossSummon', target: 1, count: DEF.summon.count });
    expect(summoned.length).toBe(DEF.summon.max);
    // A cap that is not a multiple of the batch: the last summon only tops up to it.
    const odd = { ...s, bosses: { caffeine: { ...DEF, summon: { ...DEF.summon, max: 7 } } } };
    const topped = run(odd, 120 * TICK_HZ);
    expect(topped.state.enemies.filter((e) => e.summoner === 1)).toHaveLength(7);
    expect(ofType(topped, 'bossSummon').at(-1)!.count).toBe(1);
    expect(summoned.every((e) => e.type === 'adenosine' && e.clings)).toBe(true);
  });

  it('after the burst, the residue falling under 25 is the power cut: the adenosine piles on, he is stuck 8 s, nothing is removed', () => {
    // The operator stands far away, so the summoned adenosine stays at his feet.
    let s = withBoss(fight({ x: 600, y: 330 }), { stage: 2, burst: 0, rest: 999, residue: DEF.boostMin + 0.001, boosted: true, summonIn: 999 });
    s = { ...s, enemies: [...s.enemies, ...[0, 1].map((i) => adenosineAt(10 + i, HOME.x - 20 + 40 * i, HOME.y + 14))] };
    const r = run(s, DEF.powerCutTicks + 2);
    expect(ofType(r, 'powerCut')).toEqual([{ type: 'powerCut', target: 1, seconds: 8 }]);
    const cut = firstTick(r, 'powerCut');
    const during = run(s, cut + 1).state;
    expect(during.enemies.filter((e) => e.summoner === 1).map((e) => e.phase)).toEqual(['pinned', 'pinned']);
    expect(boss(during).boss!.stage).toBe(3);
    expect(ofType(r, 'telegraph')).toEqual([]);

    const after = run(s, cut + DEF.powerCutTicks + 1).state;
    expect(after.enemies.filter((e) => e.summoner === 1).map((e) => e.phase)).toEqual(['dispersed', 'dispersed']);
    // A hit taken meanwhile freezes the whole fight for a few ticks, so allow for that.
    const back = run(after, REFORM_TICKS + 20);
    expect(ofType(back, 'reformed')).toHaveLength(2);
    expect(back.state.enemies.filter((e) => e.summoner === 1)).toHaveLength(2);
    // Then he drinks another burst, so the cycle can repeat.
    expect(ofType(run(after, 6 * TICK_HZ), 'bossDrink').length).toBe(DEF.burstCups);
  });

  it('beside a wall, a summon that would land inside it appears at his feet instead', () => {
    // The left-hand offset from x = 40 puts the adenosine body inside the border tile.
    const s0 = withBoss(fight({ x: 200, y: HOME.y }), { stage: 2, burst: 0, rest: 1, residue: 0, summonIn: 0 }, { x: 40, homeX: 40 });
    const r = run(s0, DEF.summon.ticks + 2);
    const summoned = r.state.enemies.filter((e) => e.summoner === 1);
    expect(summoned).toHaveLength(DEF.summon.count);
    // homeX is where each was summoned; they drift toward the operator from there.
    expect(summoned.map((e) => e.homeX)).toEqual([40, 40 + 24]);
    expect(summoned.every((e) => e.homeX - 7 >= TILE)).toBe(true);
  });

  it('no power cut while a burst is still to drink', () => {
    const s = withBoss(fight(), { stage: 2, burst: 2, rest: 999, residue: DEF.boostMin + 0.001, boosted: true });
    expect(ofType(run(s, 60), 'powerCut')).toEqual([]);
  });
});

describe('end of the fight and retries', () => {
  it('a budget of zero is a defeat that takes his attacks with him', () => {
    const start = ready(only(fight(), 'splash'));
    const mid = run(start, 20).state;
    expect(mid.zones).toHaveLength(1);
    const low = withBoss(mid, {}, { hp: 1 });
    const r = run({ ...low, operator: { ...low.operator, aim: { x: 0, y: -1 } } }, 24, (k) => press({ attackPressed: k === 0 }));
    expect(ofType(r, 'bossDefeated')).toEqual([{ type: 'bossDefeated', target: 1, enemy: 'caffeine' }]);
    expect(r.state.zones).toEqual([]);
    expect(ofType(run(r.state, 300), 'telegraph')).toEqual([]);
  });

  it('a forced leave restarts the fight and sends the summons away, except those clinging, which stop counting as his', () => {
    let s = withBoss(fight(), { stage: 2, residue: 80, cups: 3 }, { hp: 120 });
    s = { ...s, enemies: [...s.enemies, adenosineAt(10, 100, 300), { ...adenosineAt(11, 120, 300), phase: 'attached' }] };
    const r = step({ ...s, operator: { ...s.operator, halves: 0 } }, NO_INPUT);
    expect(r.events.map((e) => e.type)).toContain('forcedLeave');
    expect(boss(r.state)).toMatchObject({ hp: DEF.budget, x: HOME.x, y: HOME.y });
    expect(boss(r.state).boss).toEqual(boss(fight()).boss);
    expect(r.state.enemies.filter((e) => e.type === 'adenosine').map((e) => [e.id, e.phase])).toEqual([[11, 'attached']]);
    expect(r.state.enemies.filter((e) => e.summoner === 1)).toEqual([]);
  });

  it('a seeded fight replays to the same hash, and another seed picks other moves', () => {
    const play = (seed: number) => {
      let st = createGame(arena(NEAR), seed, TABLE, { bosses: BOSSES });
      st = { ...st, operator: { ...st.operator, halves: 999, maxHalves: 999 } };
      const moves: string[] = [];
      for (let t = 0; t < 40 * TICK_HZ; t++) {
        const r = step(st, press({ move: { x: Math.sin(t / 50), y: 0 }, attack: t % 90 < 45, dodgePressed: t % 97 === 0 }));
        st = r.state;
        for (const e of r.events) if (e.type === 'telegraph' && e.move) moves.push(e.move);
      }
      return { hash: stateHash(st), moves };
    };
    expect(play(5).hash).toBe(play(5).hash);
    expect(play(5).moves).not.toEqual(play(6).moves);
    expect(new Set(play(5).moves)).toEqual(new Set(DEF.moves.map((m) => m.id)));
  });
});

/** A summoned adenosine for hand-built states. */
function adenosineAt(id: number, x: number, y: number): EnemyState {
  return {
    id, type: 'adenosine', category: 'reforming', solution: 'sleep', clings: true, summoner: 1,
    x, y, homeX: x, homeY: y, hp: 0, maxHp: 0, phase: 'idle', phaseTicks: 0, frozen: 0, respawnTicks: 0,
    strikeDir: { x: 0, y: 1 }, strikeSpent: false,
  };
}