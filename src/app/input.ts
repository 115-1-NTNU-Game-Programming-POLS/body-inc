import type { TickInput } from '../core/index.ts';

export type Action = 'up' | 'down' | 'left' | 'right' | 'attack' | 'dodge' | 'stamp' | 'swap' | 'interact' | 'pick1' | 'pick2' | 'pick3' | 'pick4' | 'pick5' | 'pick6';

/** Default bindings (design doc 5.2). Stored per player later; core only ever sees TickInput. */
export const DEFAULT_BINDINGS: Readonly<Record<Action, readonly string[]>> = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  attack: ['KeyJ', 'Mouse0'],
  dodge: ['Space', 'KeyK'],
  stamp: ['KeyR', 'Mouse1'],
  // The mouse wheel of design doc 5.2 is not tracked yet.
  swap: ['KeyF'],
  interact: ['KeyE', 'Enter'],
  pick1: ['Digit1', 'Numpad1'],
  pick2: ['Digit2', 'Numpad2'],
  pick3: ['Digit3', 'Numpad3'],
  // A rescue panel lists six actions (design doc 7.7).
  pick4: ['Digit4', 'Numpad4'],
  pick5: ['Digit5', 'Numpad5'],
  pick6: ['Digit6', 'Numpad6'],
};

const PICKS = ['pick1', 'pick2', 'pick3', 'pick4', 'pick5', 'pick6'] as const;

/**
 * Tracks held keys by KeyboardEvent.code, so bindings work on any keyboard layout. Mouse
 * buttons are recorded as "Mouse<button>". A key that goes down and up between two samples
 * still counts as pressed, so a quick tap is never lost to the fixed-step loop.
 */
export class KeyboardInput {
  private readonly held = new Set<string>();
  /** Held keys that count as released until they come up; see `ignoreHeld`. */
  private readonly ignored = new Set<string>();
  private readonly pressedSince = new Set<string>();
  /** A reply chosen with the mouse, reported once by the next `sample`. */
  private queuedPick = 0;
  /** See `ignoreMouse`. */
  private mouseIgnored = false;
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
  private readonly onKeyUp = (e: Event) => this.release((e as KeyboardEvent).code);
  private readonly onMouseDown = (e: Event) => {
    const code = `Mouse${(e as MouseEvent).button}`;
    // A bound middle button would otherwise also start the browser's autoscroll.
    if (this.isBound(code)) e.preventDefault();
    if (!this.mouseIgnored) this.down(code);
  };
  private readonly onMouseUp = (e: Event) => this.release(`Mouse${(e as MouseEvent).button}`);
  private readonly onBlur = () => {
    this.held.clear();
    this.ignored.clear();
  };

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

  private release(code: string): void {
    this.held.delete(code);
    this.ignored.delete(code);
  }

  private isHeld(action: Action): boolean {
    return this.bindings[action].some((code) => this.held.has(code) && !this.ignored.has(code));
  }

  private wasPressed(action: Action): boolean {
    return this.bindings[action].some((code) => this.pressedSince.has(code));
  }

  /**
   * Forgets key-down edges seen so far while keeping what is still held. A scene that starts
   * calls it, so the Enter that chose "new game" is not also an interact press, and a key held
   * through a doorway keeps moving the operator in the next room.
   */
  clearPresses(): void {
    this.pressedSince.clear();
    this.queuedPick = 0;
  }

  /**
   * Treats every key down right now as released until it comes up. The title calls it before the
   * run starts, so the J or Space that chose "new game" does not fire a staple or dodge on tick one.
   */
  ignoreHeld(): void {
    for (const code of this.held) this.ignored.add(code);
    this.pressedSince.clear();
    this.queuedPick = 0;
  }

  /**
   * While replies are offered, a click counts only through `queuePick` on the note it hit. Mouse0 is
   * also bound to attack, which confirms the highlighted reply, so a click that missed every note
   * would otherwise commit a reply the player did not aim at.
   */
  ignoreMouse(on: boolean): void {
    this.mouseIgnored = on;
  }

  /** A reply (1 to 3) clicked on screen; the dialogue scene calls this, and the next tick sees it as a key press. */
  queuePick(n: number): void {
    this.queuedPick = n;
  }

  /** Called once per rule tick; clears the presses it reports. */
  sample(): TickInput {
    const x = (this.isHeld('right') ? 1 : 0) - (this.isHeld('left') ? 1 : 0);
    const y = (this.isHeld('down') ? 1 : 0) - (this.isHeld('up') ? 1 : 0);
    // A press of up and of down in the same tick cancel out, like holding both.
    const menuStep = (this.wasPressed('down') ? 1 : 0) - (this.wasPressed('up') ? 1 : 0) as -1 | 0 | 1;
    const pick = this.queuedPick || (PICKS.findIndex((a) => this.wasPressed(a)) + 1);
    const input: TickInput = {
      move: { x, y },
      attack: this.isHeld('attack'),
      attackPressed: this.wasPressed('attack'),
      dodgePressed: this.wasPressed('dodge'),
      stampPressed: this.wasPressed('stamp'),
      swapPressed: this.wasPressed('swap'),
      interactPressed: this.wasPressed('interact'),
      menuStep,
      ...(pick > 0 ? { pick } : {}),
    };
    this.pressedSince.clear();
    this.queuedPick = 0;
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

interface Store {
  get(key: string): unknown;
  set(key: string, value: unknown): unknown;
}

/**
 * The one tracker of a play session, kept in the game's registry. The title creates it before the
 * first key is pressed and the world reuses it, so a key held across a scene change is known.
 */
export function sharedKeys(store: Store, target: EventTarget): KeyboardInput {
  let keys = store.get('keys') as KeyboardInput | undefined;
  if (!keys) {
    keys = new KeyboardInput(target);
    store.set('keys', keys);
  }
  return keys;
}
