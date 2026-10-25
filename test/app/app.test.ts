import { chapterContent, chapterLoop, tryResume } from '../../src/app/chapters.ts';
import { CHAPTERS, ENEMIES, TAGS } from '../../src/app/content.ts';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { atlasProblems, atlasUrls, type AsepriteJson, type Manifest } from '../../src/app/assets.ts';
import { FixedStepLoop } from '../../src/app/loop.ts';
import {
  createGame, EMPTY_TAGS, enterRoom, parseRoom, roomsOf, startChapter, startClock, step, TICK_MS, type TiledMap,
} from '../../src/core/index.ts';

const manifest = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8')) as Manifest;
const index = JSON.parse(readFileSync('public/assets/atlases/index.json', 'utf8')) as Record<string, string>;
const load = (key: string) => JSON.parse(readFileSync(`public/${atlasUrls(index, key).json}`, 'utf8')) as AsepriteJson;

describe('asset contract', () => {
  it('every manifest entry has an atlas that satisfies it', () => {
    const problems = manifest.entries.flatMap((e) => atlasProblems(e, load(e.key)));
    expect(problems).toEqual([]);
  });

  it('reports a missing tag and a wrong frame count', () => {
    const op = manifest.entries.find((e) => e.key === 'operator')!;
    const atlas = load('operator');
    const tags = atlas.meta.frameTags.filter((t) => t.name !== 'operator.walk_up')
      .map((t) => (t.name === 'operator.walk_down' ? { ...t, to: t.to - 1 } : t));
    const problems = atlasProblems(op, { ...atlas, meta: { frameTags: tags } });
    expect(problems.some((p) => p.includes('missing tag operator.walk_up'))).toBe(true);
    expect(problems.some((p) => p.includes('walk_down has 3 frames'))).toBe(true);
  });

  it('reports frames that createFromAseprite cannot find by index', () => {
    const op = manifest.entries.find((e) => e.key === 'operator')!;
    const atlas = load('operator');
    const renamed = Object.fromEntries(Object.entries(atlas.frames).map(([k, v]) => [`operator ${k}.aseprite`, v]));
    expect(atlasProblems(op, { ...atlas, frames: renamed }).some((p) => p.includes('--filename-format'))).toBe(true);
  });
});

describe('fixed-step loop', () => {
  const room = enterRoom(parseRoom('g', JSON.parse(readFileSync('public/assets/maps/greybox/greybox-room.tmj', 'utf8')) as TiledMap, TAGS), EMPTY_TAGS, TAGS);

  it('turns elapsed time into whole ticks and scales by game speed', () => {
    const loop = new FixedStepLoop(createGame(room, 1, ENEMIES), step);
    loop.advance(TICK_MS * 4 + 1);
    expect(loop.state.tick).toBe(4);
    const slow = new FixedStepLoop(createGame(room, 1, ENEMIES), step);
    slow.speed = 0.5;
    slow.advance(TICK_MS * 4 + 1);
    expect(slow.state.tick).toBe(2);
  });

  it('delivers events to listeners until they remove themselves', () => {
    const loop = new FixedStepLoop(createGame(room, 1, ENEMIES), step);
    const seen: string[] = [];
    const off = loop.onEvent((e) => seen.push(e.type));
    const hold = () => ({ move: { x: 0, y: -1 } });
    for (let i = 0; i < 120; i++) loop.advance(TICK_MS, hold);
    expect(seen).toContain('bumpWall');
    off();
    seen.length = 0;
    for (let i = 0; i < 120; i++) loop.advance(TICK_MS, hold);
    expect(seen).toEqual([]);
  });

  it('drives a whole chapter: the loop steps the chapter and its events reach listeners', () => {
    const chapter = CHAPTERS.get('greybox')!;
    const maps = new Map(roomsOf(chapter).map((p) => [p, JSON.parse(readFileSync(`public/assets/maps/${p}.tmj`, 'utf8')) as TiledMap]));
    const ctx = chapterContent(chapter, maps);
    const loop = chapterLoop(ctx, startChapter(ctx));
    const rooms: string[] = [];
    loop.onEvent((e) => { if (e.type === 'roomChanged') rooms.push(e.to); });
    for (let i = 0; i < 200; i++) loop.advance(TICK_MS, () => ({ move: { x: 0, y: 1 } }));
    expect(rooms).toEqual(['greybox/rest-room']);
    expect(loop.state.run.roomId).toBe('greybox/rest-room');
    expect(loop.state.game.room.id).toBe('greybox/rest-room');
  });

  it('chapter content refuses rooms that start a conversation the game does not have', () => {
    const chapter = CHAPTERS.get('greybox')!;
    const maps = new Map(roomsOf(chapter).map((p) => {
      const text = readFileSync(`public/assets/maps/${p}.tmj`, 'utf8').replaceAll('greybox.brain.briefing', 'greybox.brain.gone');
      return [p, JSON.parse(text) as TiledMap];
    }));
    expect(() => chapterContent(chapter, maps)).toThrow(/NPC #\d+ starts conversation "greybox\.brain\.gone"/);
  });

  it('a frame ends at an event that leaves the room, so no tick runs in a room nobody has seen', () => {
    const leaving = (e: string) => e === 'moved';
    const stepper = (n: number) => ({ state: n + 1, events: n === 1 ? ['moved'] : [] });
    const loop = new FixedStepLoop<number, string>(0, stepper, leaving);
    loop.advance(TICK_MS * 5 + 1);
    expect(loop.state).toBe(2);
    expect(loop.advance(0)).toBe(0);
    expect(loop.state).toBe(2);
    const plain = new FixedStepLoop<number, string>(0, stepper);
    plain.advance(TICK_MS * 5 + 1);
    expect(plain.state).toBe(5);
  });

  it('the chapter loop leaves a new room on its first tick however the frame was split', () => {
    const chapter = CHAPTERS.get('greybox')!;
    const maps = new Map(roomsOf(chapter).map((p) => [p, JSON.parse(readFileSync(`public/assets/maps/${p}.tmj`, 'utf8')) as TiledMap]));
    const ctx = chapterContent(chapter, maps);
    // The crossing lands on a different tick of the 5-tick frame for each lead-in.
    for (let lead = 0; lead < 5; lead++) {
      const loop = chapterLoop(ctx, startChapter(ctx));
      let left = false;
      loop.onEvent((e) => { if (e.type === 'roomChanged') left = true; });
      loop.advance(TICK_MS * lead + 1);
      for (let i = 0; i < 200 && !left; i++) loop.advance(TICK_MS * 5 + 1, () => ({ move: { x: 0, y: 1 } }));
      expect(left, `lead ${lead}`).toBe(true);
      expect(loop.state.game.tick, `lead ${lead}`).toBe(0);
    }
  });

  it('every chapter file in content/chapters is bundled, so a new chapter cannot be left out of the game', () => {
    const files = readdirSync('content/chapters').filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -'.json'.length)).sort();
    expect([...CHAPTERS.keys()].sort()).toEqual(files);
  });

  it('continue offers only a checkpoint that still fits the bundled content', () => {
    const chapter = CHAPTERS.get('greybox')!;
    const maps = new Map(roomsOf(chapter).map((p) => [p, JSON.parse(readFileSync(`public/assets/maps/${p}.tmj`, 'utf8')) as TiledMap]));
    const ctx = chapterContent(chapter, maps);
    const saved = { chapter: 'greybox', roomId: 'greybox/rest-room', x: 128, y: 230, tags: EMPTY_TAGS, clock: startClock(1, 9), fired: [] };
    expect(tryResume(ctx, saved)?.run.roomId).toBe('greybox/rest-room');
    expect(tryResume(ctx, { ...saved, roomId: 'greybox/renamed-since' })).toBeUndefined();
    expect(tryResume(ctx, { ...saved, chapter: 'brain' })).toBeUndefined();
  });

  it('every room a bundled chapter names is on disk and passes the room parser', () => {
    for (const chapter of CHAPTERS.values()) {
      for (const p of roomsOf(chapter)) {
        const map = JSON.parse(readFileSync(`public/assets/maps/${p}.tmj`, 'utf8')) as TiledMap;
        expect(() => parseRoom(p, map, TAGS), p).not.toThrow();
      }
    }
  });

  it('drops catch-up beyond 5 ticks per frame after a stall', () => {
    const loop = new FixedStepLoop(createGame(room, 1, ENEMIES), step);
    const alpha = loop.advance(10_000);
    expect(loop.state.tick).toBe(5);
    expect(alpha).toBe(0);
    loop.advance(0);
    expect(loop.state.tick).toBe(5);
  });
});
