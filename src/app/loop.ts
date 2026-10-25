import { NO_INPUT, TICK_MS, type TickInput } from '../core/index.ts';

/** More catch-up than this per rendered frame is dropped, so a stalled tab does not fast-forward. */
const MAX_TICKS_PER_FRAME = 5;

export interface StepOutcome<S, E> {
  readonly state: S;
  readonly events: readonly E[];
}

/** One rule tick: a room's `step`, or a whole chapter's `stepChapter` bound to its content. */
export type Stepper<S, E> = (state: S, input: TickInput) => StepOutcome<S, E>;

/**
 * Fixed-step driver: turns variable frame times into whole rule ticks. Game speed (the 80% and
 * 70% assist, design doc 5.7) scales elapsed time here, so rules never see it.
 */
export class FixedStepLoop<S, E> {
  state: S;
  previous: S;
  speed = 1;
  private acc = 0;
  private readonly stepFn: Stepper<S, E>;
  private readonly endsFrame: (e: E) => boolean;
  private readonly listeners = new Set<(e: E) => void>();

  /**
   * `endsFrame` marks events after which the state is no longer the one on screen (a new room):
   * the rest of the frame's catch-up is dropped, so no tick runs in a room nobody has seen yet.
   */
  constructor(initial: S, stepFn: Stepper<S, E>, endsFrame: (e: E) => boolean = () => false) {
    this.state = initial;
    this.previous = initial;
    this.stepFn = stepFn;
    this.endsFrame = endsFrame;
  }

  /** Returns the function that removes the listener; a scene that restarts must call it. */
  onEvent(fn: (e: E) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** Advances by real elapsed milliseconds; returns the interpolation factor for rendering. */
  advance(elapsedMs: number, sample: () => TickInput = () => NO_INPUT): number {
    this.acc += elapsedMs * this.speed;
    let ticks = 0;
    while (this.acc >= TICK_MS && ticks < MAX_TICKS_PER_FRAME) {
      const result = this.stepFn(this.state, sample());
      this.previous = this.state;
      this.state = result.state;
      for (const e of result.events) for (const fn of this.listeners) fn(e);
      this.acc -= TICK_MS;
      ticks++;
      if (result.events.some(this.endsFrame)) {
        this.acc = 0;
        break;
      }
    }
    if (ticks === MAX_TICKS_PER_FRAME) this.acc = 0;
    return this.acc / TICK_MS;
  }
}
