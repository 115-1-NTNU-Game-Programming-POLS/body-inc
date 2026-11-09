import type { TickInput } from '../core/index.ts';

export type Action = 'up' | 'down' | 'left' | 'right' | 'attack' | 'dodge' | 'stamp' | 'swap' | 'partner' | 'interact' | 'pick1' | 'pick2' | 'pick3' | 'pick4' | 'pick5' | 'pick6';

/** Default bindings (design doc 5.2). Stored per player later; core only ever sees TickInput. */
export const DEFAULT_BINDINGS: Readonly<Record<Action, readonly string[]>> = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  attack: ['KeyJ', 'Mouse0'],
  dodge: ['Space', 'KeyK'],
  stamp: ['KeyR', 'Mouse1'],
  // 'Wheel' is a notch of the mouse wheel in either direction: there are two stationery slots, so both swap.
  swap: ['KeyF', 'Wheel'],
  // The right button: the browser's context menu is cancelled so the click reaches the game.
  partner: ['KeyL', 'Mouse2'],
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
 * Milliseconds the wheel must stay still before a new wheel event counts as another swap. A mouse
 * notch is one event, but a trackpad sends a stream of them for one gesture, momentum included,
 * every 10 to 20 ms; every event restarts this wait, so the whole stream is one swap however long
 * it runs. Two notches turned faster than this also make one swap, which costs nothing with two slots.
 */
export const WHEEL_QUIET_MS = 200;

/** A DOM node where the browser's own right-click menu is still wanted (the host's name box, for pasting). */
function isEditable(target: EventTarget | null): boolean {
  const el = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  return el?.isContentEditable === true || el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA';
}

/**
 * Tracks held keys by KeyboardEvent.code, so bindings work on any keyboard layout. Mouse
 * buttons are recorded as "Mouse<button>" and a turn of the wheel as a press of "Wheel", which is
 * never held. A key that goes down and up between two samples still counts as pressed, so a quick
 * tap is never lost to the fixed-step loop.
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
  /** Whether the toggled attack is on (`sample` with `toggleAttack`). */
  private attackOn = false;
  /** When the last wheel event came, counted or not; see `WHEEL_QUIET_MS`. */
  private lastWheelAt: number | undefined;
  private readonly target: EventTarget;
  private readonly bindings: Readonly<Record<Action, readonly string[]>>;
  private readonly now: () => number;
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
  private readonly onWheel = (e: Event) => {
    const w = e as WheelEvent;
    // While the game has the page, the wheel never scrolls it, and a pinch or Ctrl+wheel never zooms it.
    w.preventDefault();
    // A trackpad pinch arrives as a wheel event with ctrlKey set, and a sideways swipe has no deltaY: neither is a notch.
    if (w.ctrlKey || !w.deltaY) return;
    const at = this.now();
    if (this.lastWheelAt === undefined || at - this.lastWheelAt >= WHEEL_QUIET_MS) this.pressedSince.add('Wheel');
    this.lastWheelAt = at;
  };
  private readonly onContextMenu = (e: Event) => {
    if (!isEditable(e.target)) e.preventDefault();
  };
  private readonly onBlur = () => {
    this.held.clear();
    this.ignored.clear();
    this.attackOn = false;
  };

  /** `now` is a clock in milliseconds, for the wheel; tests pass their own. */
  constructor(target: EventTarget, bindings = DEFAULT_BINDINGS, now: () => number = () => performance.now()) {
    this.target = target;
    this.bindings = bindings;
    this.now = now;
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('mousedown', this.onMouseDown);
    target.addEventListener('mouseup', this.onMouseUp);
    // Not passive, or the browser would scroll before preventDefault could stop it.
    target.addEventListener('wheel', this.onWheel, { passive: false });
    target.addEventListener('contextmenu', this.onContextMenu);
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
    // A conversation, the handbook or the menu was in the way: attacking must be started again.
    this.attackOn = false;
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

  /** Stops the toggled attack. A scene that starts calls it, so one left on in a patrol or a room does not carry into the next. */
  stopAttack(): void {
    this.attackOn = false;
  }

  /**
   * Called once per rule tick; clears the presses it reports. With `toggleAttack` (design doc 5.7)
   * one press starts attacking and the next stops it: `attack` is the toggled state and the press
   * that starts it is the only one reported, so the press that stops it fires nothing. The caller
   * passes false while a panel owns the keys, where the plain press is what confirms.
   */
  sample(toggleAttack = false): TickInput {
    const x = (this.isHeld('right') ? 1 : 0) - (this.isHeld('left') ? 1 : 0);
    const y = (this.isHeld('down') ? 1 : 0) - (this.isHeld('up') ? 1 : 0);
    // A press of up and of down in the same tick cancel out, like holding both.
    const menuStep = (this.wasPressed('down') ? 1 : 0) - (this.wasPressed('up') ? 1 : 0) as -1 | 0 | 1;
    const pick = this.queuedPick || (PICKS.findIndex((a) => this.wasPressed(a)) + 1);
    const tapped = this.wasPressed('attack');
    if (toggleAttack) {
      if (tapped) this.attackOn = !this.attackOn;
    } else this.attackOn = false;
    const input: TickInput = {
      move: { x, y },
      attack: toggleAttack ? this.attackOn : this.isHeld('attack'),
      attackPressed: toggleAttack ? tapped && this.attackOn : tapped,
      dodgePressed: this.wasPressed('dodge'),
      stampPressed: this.wasPressed('stamp'),
      swapPressed: this.wasPressed('swap'),
      partnerPressed: this.wasPressed('partner'),
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
    this.target.removeEventListener('wheel', this.onWheel);
    this.target.removeEventListener('contextmenu', this.onContextMenu);
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
