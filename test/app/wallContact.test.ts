import { describe, expect, it } from 'vitest';
import { WallContact } from '../../src/app/wallContact.ts';
import type { GameEvent } from '../../src/core/index.ts';

const bump = (axis: 'x' | 'y'): GameEvent => ({ type: 'bumpWall', axis });

describe('a wall sounds once per touch', () => {
  it('sounds on the tick the operator first presses into a wall, and not while the press goes on', () => {
    const walls = new WallContact();
    const first = bump('x');
    expect(walls.starts([first], 1)).toEqual(new Set([first]));
    for (let t = 2; t < 60; t++) expect(walls.starts([bump('x')], t).size).toBe(0);
  });

  it('sounds again after the operator has let go of the wall for one tick', () => {
    const walls = new WallContact();
    walls.starts([bump('x')], 1);
    walls.starts([bump('x')], 2);
    expect(walls.starts([], 3).size).toBe(0);
    const again = bump('x');
    expect(walls.starts([again], 4)).toEqual(new Set([again]));
  });

  it('counts each axis on its own: sliding along a wall into a corner sounds the second wall', () => {
    const walls = new WallContact();
    walls.starts([bump('y')], 1);
    const corner = bump('x');
    expect(walls.starts([bump('y'), corner], 2)).toEqual(new Set([corner]));
  });

  it('sounds once when a frame runs two ticks against the same wall', () => {
    const walls = new WallContact();
    const a = bump('x');
    expect(walls.starts([a, bump('x')], 2)).toEqual(new Set([a]));
  });

  it('keeps the touch through a frame that ran no tick, as a screen faster than 60 Hz has', () => {
    const walls = new WallContact();
    walls.starts([bump('x')], 1);
    expect(walls.starts([], 1).size).toBe(0);
    expect(walls.starts([bump('x')], 2).size).toBe(0);
  });

  it('leaves every other event alone', () => {
    const walls = new WallContact();
    const hit: GameEvent = { type: 'dodge' } as GameEvent;
    expect(walls.starts([hit], 1).size).toBe(0);
  });
});
