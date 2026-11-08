import { describe, expect, it } from 'vitest';
import { KeyboardInput, WHEEL_QUIET_MS } from '../../src/app/input.ts';
import { primary } from '../../src/view/ui/primary.ts';

const key = (type: 'keydown' | 'keyup', code: string) => Object.assign(new Event(type), { code, repeat: false });

describe('the partner key (design doc 5.2)', () => {
  it('L reports one press per tap', () => {
    const target = new EventTarget();
    const keys = new KeyboardInput(target);
    target.dispatchEvent(key('keydown', 'KeyL'));
    expect(keys.sample().partnerPressed).toBe(true);
    expect(keys.sample().partnerPressed).toBe(false);
    keys.dispose();
  });
});

describe('the swap key (design doc 5.2)', () => {
  it('F reports one swap press per tap and the held key reports none again', () => {
    const target = new EventTarget();
    const keys = new KeyboardInput(target);
    target.dispatchEvent(key('keydown', 'KeyF'));
    expect(keys.sample().swapPressed).toBe(true);
    expect(keys.sample().swapPressed).toBe(false);
    target.dispatchEvent(key('keyup', 'KeyF'));
    expect(keys.sample().swapPressed).toBe(false);
    keys.dispose();
  });

  it('a tap shorter than a tick is not lost', () => {
    const target = new EventTarget();
    const keys = new KeyboardInput(target);
    target.dispatchEvent(key('keydown', 'KeyF'));
    target.dispatchEvent(key('keyup', 'KeyF'));
    expect(keys.sample().swapPressed).toBe(true);
    keys.dispose();
  });
});

describe('the toggled attack assist (design doc 5.7)', () => {
  const setup = () => {
    const target = new EventTarget();
    return { target, keys: new KeyboardInput(target) };
  };
  const tap = (target: EventTarget, code: string) => {
    target.dispatchEvent(key('keydown', code));
    target.dispatchEvent(key('keyup', code));
  };

  it('one press starts attacking and the key can be let go; the next press stops it', () => {
    const { target, keys } = setup();
    target.dispatchEvent(key('keydown', 'KeyJ'));
    expect(keys.sample(true)).toMatchObject({ attack: true, attackPressed: true });
    target.dispatchEvent(key('keyup', 'KeyJ'));
    expect(keys.sample(true)).toMatchObject({ attack: true, attackPressed: false });
    expect(keys.sample(true)).toMatchObject({ attack: true, attackPressed: false });
    // The press that stops it reports no press, so it buffers no last staple.
    target.dispatchEvent(key('keydown', 'KeyJ'));
    expect(keys.sample(true)).toMatchObject({ attack: false, attackPressed: false });
    target.dispatchEvent(key('keyup', 'KeyJ'));
    expect(keys.sample(true)).toMatchObject({ attack: false, attackPressed: false });
    target.dispatchEvent(key('keydown', 'KeyJ'));
    expect(keys.sample(true)).toMatchObject({ attack: true, attackPressed: true });
    keys.dispose();
  });

  it('a tap shorter than a tick still toggles, and the mouse button toggles it as well', () => {
    const { target, keys } = setup();
    tap(target, 'KeyJ');
    expect(keys.sample(true).attack).toBe(true);
    target.dispatchEvent(Object.assign(new Event('mousedown'), { button: 0 }));
    target.dispatchEvent(Object.assign(new Event('mouseup'), { button: 0 }));
    expect(keys.sample(true).attack).toBe(false);
    keys.dispose();
  });

  it('without the assist the key is plain: held while down, and a sample that is not toggling forgets the toggle', () => {
    const { target, keys } = setup();
    target.dispatchEvent(key('keydown', 'KeyJ'));
    expect(keys.sample(false)).toMatchObject({ attack: true, attackPressed: true });
    target.dispatchEvent(key('keyup', 'KeyJ'));
    expect(keys.sample(false)).toMatchObject({ attack: false, attackPressed: false });
    tap(target, 'KeyJ');
    expect(keys.sample(true).attack).toBe(true);
    // A panel took the keys for a moment (the caller samples without the toggle): attacking starts again from off.
    expect(keys.sample(false).attack).toBe(false);
    expect(keys.sample(true).attack).toBe(false);
    keys.dispose();
  });

  it('ignoring the keys held, as after a conversation, a menu or a lost focus, stops the attack', () => {
    const { target, keys } = setup();
    tap(target, 'KeyJ');
    expect(keys.sample(true).attack).toBe(true);
    keys.ignoreHeld();
    expect(keys.sample(true).attack).toBe(false);
    tap(target, 'KeyJ');
    expect(keys.sample(true).attack).toBe(true);
    target.dispatchEvent(new Event('blur'));
    expect(keys.sample(true).attack).toBe(false);
    keys.dispose();
  });

  it('can be stopped from outside, which a scene that starts does so an attack left on does not carry over', () => {
    const { target, keys } = setup();
    tap(target, 'KeyJ');
    expect(keys.sample(true).attack).toBe(true);
    keys.stopAttack();
    expect(keys.sample(true).attack).toBe(false);
    // The next press starts it again, not stops a toggle that is no longer on.
    tap(target, 'KeyJ');
    expect(keys.sample(true)).toMatchObject({ attack: true, attackPressed: true });
    keys.dispose();
  });

  it('leaves every other key as it was', () => {
    const { target, keys } = setup();
    tap(target, 'KeyJ');
    target.dispatchEvent(key('keydown', 'Space'));
    target.dispatchEvent(key('keydown', 'KeyD'));
    expect(keys.sample(true)).toMatchObject({ attack: true, dodgePressed: true, move: { x: 1, y: 0 } });
    keys.dispose();
  });
});

describe('the mouse wheel swaps stationery (design doc 5.2)', () => {
  const wheel = (deltaY: number, more: Partial<{ deltaX: number; ctrlKey: boolean }> = {}) =>
    Object.assign(new Event('wheel', { cancelable: true }), { deltaY, deltaX: 0, ctrlKey: false, ...more });
  const setup = () => {
    let now = 1000;
    const target = new EventTarget();
    const keys = new KeyboardInput(target, undefined, () => now);
    return { target, keys, advance: (ms: number) => { now += ms; } };
  };

  it('a notch in either direction is one swap press, the same as F', () => {
    const { target, keys, advance } = setup();
    target.dispatchEvent(wheel(-100));
    expect(keys.sample().swapPressed).toBe(true);
    expect(keys.sample().swapPressed).toBe(false);
    advance(WHEEL_QUIET_MS);
    target.dispatchEvent(wheel(100));
    expect(keys.sample().swapPressed).toBe(true);
    keys.dispose();
  });

  it('a trackpad burst is one swap, however long it runs, and the next gesture after a quiet spell is another', () => {
    const { target, keys, advance } = setup();
    // Ninety events 16 ms apart: 1.4 s of scrolling and momentum, far longer than the quiet spell.
    let swaps = 0;
    for (let i = 0; i < 90; i++) {
      target.dispatchEvent(wheel(4));
      if (keys.sample().swapPressed) swaps++;
      advance(16);
    }
    expect(swaps).toBe(1);
    // Just short of the quiet spell after the last event: still the same gesture.
    advance(WHEEL_QUIET_MS - 16 - 1);
    target.dispatchEvent(wheel(4));
    expect(keys.sample().swapPressed).toBe(false);
    // The spell ends: the next event is a new swap.
    advance(WHEEL_QUIET_MS);
    target.dispatchEvent(wheel(4));
    expect(keys.sample().swapPressed).toBe(true);
    keys.dispose();
  });

  it('never scrolls or zooms the page, and a pinch or a sideways swipe is not a swap', () => {
    const { target, keys, advance } = setup();
    const notch = wheel(100);
    target.dispatchEvent(notch);
    expect(notch.defaultPrevented).toBe(true);
    keys.sample();
    advance(WHEEL_QUIET_MS);
    const pinch = wheel(-3, { ctrlKey: true });
    target.dispatchEvent(pinch);
    expect(pinch.defaultPrevented).toBe(true);
    expect(keys.sample().swapPressed).toBe(false);
    advance(WHEEL_QUIET_MS);
    const sideways = wheel(0, { deltaX: 30 });
    target.dispatchEvent(sideways);
    expect(sideways.defaultPrevented).toBe(true);
    expect(keys.sample().swapPressed).toBe(false);
    keys.dispose();
  });

  it('is dropped with the other presses when a scene takes the keys, as F is', () => {
    const { target, keys } = setup();
    target.dispatchEvent(wheel(100));
    keys.ignoreHeld();
    expect(keys.sample().swapPressed).toBe(false);
    keys.dispose();
  });

  it('stops listening once disposed', () => {
    const { target, keys } = setup();
    keys.dispose();
    const notch = wheel(100);
    target.dispatchEvent(notch);
    expect(notch.defaultPrevented).toBe(false);
  });
});

describe('the right mouse button is the partner skill (design doc 5.2)', () => {
  const button = (type: 'mousedown' | 'mouseup', b: number) => Object.assign(new Event(type, { cancelable: true }), { button: b });

  it('a right click reports one partner press and nothing else', () => {
    const target = new EventTarget();
    const keys = new KeyboardInput(target);
    target.dispatchEvent(button('mousedown', 2));
    target.dispatchEvent(button('mouseup', 2));
    expect(keys.sample()).toMatchObject({ partnerPressed: true, attackPressed: false, stampPressed: false, swapPressed: false });
    expect(keys.sample().partnerPressed).toBe(false);
    keys.dispose();
  });

  it('cancels the browser context menu on the game, but not in a text box', () => {
    const target = new EventTarget();
    const keys = new KeyboardInput(target);
    const onGame = new Event('contextmenu', { cancelable: true });
    target.dispatchEvent(onGame);
    expect(onGame.defaultPrevented).toBe(true);
    keys.dispose();
    // The host's name box is a DOM <input>: its own menu (paste) stays. Here the event's target is the box.
    const box = Object.assign(new EventTarget(), { tagName: 'INPUT' });
    const boxKeys = new KeyboardInput(box);
    const inBox = new Event('contextmenu', { cancelable: true });
    box.dispatchEvent(inBox);
    expect(inBox.defaultPrevented).toBe(false);
    boxKeys.dispose();
  });

  it('is ignored while replies take the mouse, like the other buttons', () => {
    const target = new EventTarget();
    const keys = new KeyboardInput(target);
    keys.ignoreMouse(true);
    target.dispatchEvent(button('mousedown', 2));
    expect(keys.sample().partnerPressed).toBe(false);
    keys.dispose();
  });
});

describe('menu clicks take only the primary button', () => {
  it('a left click or a touch runs the handler; a right or middle click does not', () => {
    let runs = 0;
    const onClick = primary(() => { runs++; });
    onClick({ button: 0 });
    onClick({ button: 2 });
    onClick({ button: 1 });
    expect(runs).toBe(1);
  });
});
