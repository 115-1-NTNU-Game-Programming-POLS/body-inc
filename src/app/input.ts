import type { TickInput } from '../core/index.ts';

export type Action = 'up' | 'down' | 'left' | 'right';

/** Default bindings (design doc 5.2). Stored per player later; core only ever sees TickInput. */
export const DEFAULT_BINDINGS: Readonly<Record<Action, readonly string[]>> = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
};

/** Tracks held keys by KeyboardEvent.code, so bindings work on any keyboard layout. */
export class KeyboardInput {
  private readonly held = new Set<string>();
  private readonly target: EventTarget;
  private readonly bindings: Readonly<Record<Action, readonly string[]>>;
  private readonly onDown = (e: Event) => this.held.add((e as KeyboardEvent).code);
  private readonly onUp = (e: Event) => this.held.delete((e as KeyboardEvent).code);
  private readonly onBlur = () => this.held.clear();

  constructor(target: EventTarget, bindings = DEFAULT_BINDINGS) {
    this.target = target;
    this.bindings = bindings;
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  private pressed(action: Action): boolean {
    return this.bindings[action].some((code) => this.held.has(code));
  }

  sample(): TickInput {
    const x = (this.pressed('right') ? 1 : 0) - (this.pressed('left') ? 1 : 0);
    const y = (this.pressed('down') ? 1 : 0) - (this.pressed('up') ? 1 : 0);
    return { move: { x, y } };
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    this.target.removeEventListener('blur', this.onBlur);
  }
}
