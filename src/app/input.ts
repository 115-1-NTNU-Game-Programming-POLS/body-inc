import type { TickInput } from '../core/index.ts';

export type Action = 'up' | 'down' | 'left' | 'right' | 'attack' | 'dodge' | 'stamp';

/** Default bindings (design doc 5.2). Stored per player later; core only ever sees TickInput. */
export const DEFAULT_BINDINGS: Readonly<Record<Action, readonly string[]>> = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  attack: ['KeyJ', 'Mouse0'],
  dodge: ['Space', 'KeyK'],
  stamp: ['KeyR', 'Mouse1'],
};

/**
 * Tracks held keys by KeyboardEvent.code, so bindings work on any keyboard layout. Mouse
 * buttons are recorded as "Mouse<button>". A key that goes down and up between two samples
 * still counts as pressed, so a quick tap is never lost to the fixed-step loop.
 */
export class KeyboardInput {
  private readonly held = new Set<string>();
  private readonly pressedSince = new Set<string>();
  private readonly target: EventTarget;
  private readonly bindings: Readonly<Record<Action, readonly string[]>>;
  private readonly down = (code: string) => {
    if (!this.held.has(code)) this.pressedSince.add(code);
    this.held.add(code);
  };
  private readonly onKeyDown = (e: Event) => {
    const k = e as KeyboardEvent;
    if (this.isBound(k.code)) k.preventDefault();
    // A repeat is not a new press, but it still marks the key held: after a blur cleared
    // `held`, repeats are the only sign that a key is still down.
    if (k.repeat) this.held.add(k.code);
    else this.down(k.code);
  };
  private readonly onKeyUp = (e: Event) => this.held.delete((e as KeyboardEvent).code);
  private readonly onMouseDown = (e: Event) => {
    const code = `Mouse${(e as MouseEvent).button}`;
    // A bound middle button would otherwise also start the browser's autoscroll.
    if (this.isBound(code)) e.preventDefault();
    this.down(code);
  };
  private readonly onMouseUp = (e: Event) => this.held.delete(`Mouse${(e as MouseEvent).button}`);
  private readonly onBlur = () => this.held.clear();

  constructor(target: EventTarget, bindings = DEFAULT_BINDINGS) {
    this.target = target;
    this.bindings = bindings;
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('mousedown', this.onMouseDown);
    target.addEventListener('mouseup', this.onMouseUp);
    target.addEventListener('blur', this.onBlur);
  }

  private isBound(code: string): boolean {
    return Object.values(this.bindings).some((codes) => codes.includes(code));
  }

  private isHeld(action: Action): boolean {
    return this.bindings[action].some((code) => this.held.has(code));
  }

  private wasPressed(action: Action): boolean {
    return this.bindings[action].some((code) => this.pressedSince.has(code));
  }

  /** Called once per rule tick; clears the presses it reports. */
  sample(): TickInput {
    const x = (this.isHeld('right') ? 1 : 0) - (this.isHeld('left') ? 1 : 0);
    const y = (this.isHeld('down') ? 1 : 0) - (this.isHeld('up') ? 1 : 0);
    const input: TickInput = {
      move: { x, y },
      attack: this.isHeld('attack'),
      attackPressed: this.wasPressed('attack'),
      dodgePressed: this.wasPressed('dodge'),
      stampPressed: this.wasPressed('stamp'),
    };
    this.pressedSince.clear();
    return input;
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('mousedown', this.onMouseDown);
    this.target.removeEventListener('mouseup', this.onMouseUp);
    this.target.removeEventListener('blur', this.onBlur);
  }
}
