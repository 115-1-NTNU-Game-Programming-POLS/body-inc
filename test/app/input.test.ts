import { describe, expect, it } from 'vitest';
import { KeyboardInput } from '../../src/app/input.ts';

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

  it('leaves every other key as it was', () => {
    const { target, keys } = setup();
    tap(target, 'KeyJ');
    target.dispatchEvent(key('keydown', 'Space'));
    target.dispatchEvent(key('keydown', 'KeyD'));
    expect(keys.sample(true)).toMatchObject({ attack: true, dodgePressed: true, move: { x: 1, y: 0 } });
    keys.dispose();
  });
});
