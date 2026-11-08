import type { GameEvent } from '../core/index.ts';

type Axis = Extract<GameEvent, { type: 'bumpWall' }>['axis'];

/**
 * Lets a bump against a wall sound once, when the operator first touches it. The rules report
 * `bumpWall` on every tick the operator presses into a wall, so playing each would buzz for as long
 * as a key is held. Each axis counts on its own: sliding along a wall into a corner touches the
 * second wall, which sounds. A frame that ran no tick changes nothing, so a screen faster than the
 * 60 Hz rules does not count a still-held wall as a new touch.
 */
export class WallContact {
  private touching = new Set<Axis>();
  private lastTick: number | undefined;

  /** The bumpWall events among one frame's events that begin a contact; `tick` is the rules tick after them. */
  starts(events: readonly GameEvent[], tick: number): ReadonlySet<GameEvent> {
    const out = new Set<GameEvent>();
    if (tick === this.lastTick) return out;
    this.lastTick = tick;
    const now = new Set<Axis>();
    for (const e of events) {
      if (e.type !== 'bumpWall' || now.has(e.axis)) continue;
      now.add(e.axis);
      if (!this.touching.has(e.axis)) out.add(e);
    }
    this.touching = now;
    return out;
  }
}
