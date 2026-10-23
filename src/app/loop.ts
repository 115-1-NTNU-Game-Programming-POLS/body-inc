import { NO_INPUT, step, TICK_MS, type DomainEvent, type GameState, type TickInput } from '../core/index.ts';

/** More catch-up than this per rendered frame is dropped, so a stalled tab does not fast-forward. */
const MAX_TICKS_PER_FRAME = 5;

/**
 * Fixed-step driver: turns variable frame times into whole rule ticks. Game speed (the 80% and
 * 70% assist, design doc 5.7) scales elapsed time here, so rules never see it.
 */
export class FixedStepLoop {
  state: GameState;
  previous: GameState;
  speed = 1;
  private acc = 0;
  private readonly listeners: Array<(e: DomainEvent) => void> = [];

  constructor(initial: GameState) {
    this.state = initial;
    this.previous = initial;
  }

  onEvent(fn: (e: DomainEvent) => void): void {
    this.listeners.push(fn);
  }

  /** Advances by real elapsed milliseconds; returns the interpolation factor for rendering. */
  advance(elapsedMs: number, sample: () => TickInput = () => NO_INPUT): number {
    this.acc += elapsedMs * this.speed;
    let ticks = 0;
    while (this.acc >= TICK_MS && ticks < MAX_TICKS_PER_FRAME) {
      const result = step(this.state, sample());
      this.previous = this.state;
      this.state = result.state;
      for (const e of result.events) for (const fn of this.listeners) fn(e);
      this.acc -= TICK_MS;
      ticks++;
    }
    if (ticks === MAX_TICKS_PER_FRAME) this.acc = Math.min(this.acc, TICK_MS);
    return this.acc / TICK_MS;
  }
}
