import { ENEMIES, TAGS } from '../../src/app/content.ts';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { atlasProblems, atlasUrls, type AsepriteJson, type Manifest } from '../../src/app/assets.ts';
import { FixedStepLoop } from '../../src/app/loop.ts';
import { createGame, parseRoom, TICK_MS, type TiledMap } from '../../src/core/index.ts';

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
  const room = parseRoom('g', JSON.parse(readFileSync('public/assets/maps/greybox/greybox-room.tmj', 'utf8')) as TiledMap, TAGS);

  it('turns elapsed time into whole ticks and scales by game speed', () => {
    const loop = new FixedStepLoop(createGame(room, 1, ENEMIES));
    loop.advance(TICK_MS * 4 + 1);
    expect(loop.state.tick).toBe(4);
    const slow = new FixedStepLoop(createGame(room, 1, ENEMIES));
    slow.speed = 0.5;
    slow.advance(TICK_MS * 4 + 1);
    expect(slow.state.tick).toBe(2);
  });

  it('drops catch-up beyond 5 ticks per frame after a stall', () => {
    const loop = new FixedStepLoop(createGame(room, 1, ENEMIES));
    const alpha = loop.advance(10_000);
    expect(loop.state.tick).toBe(5);
    expect(alpha).toBe(0);
    loop.advance(0);
    expect(loop.state.tick).toBe(5);
  });
});
