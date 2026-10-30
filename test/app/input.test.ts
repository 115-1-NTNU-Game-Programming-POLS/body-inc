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