import { describe, expect, it } from 'vitest';
import feedbackJson from '../../content/feedback.json';
import stringsJson from '../../content/strings/zh-TW.json';
import { feedbackProblems, noteText, type FeedbackTable, type StringTable } from '../../src/app/feedback.ts';
import { KeyboardInput } from '../../src/app/input.ts';

const FEEDBACK = feedbackJson as unknown as FeedbackTable;
const STRINGS = stringsJson as StringTable;

const key = (type: string, code: string, repeat = false) => Object.assign(new Event(type), { code, repeat });

describe('keyboard input adapter', () => {
  it('a tap that goes down and up between two ticks is still pressed once', () => {
    const target = new EventTarget();
    const input = new KeyboardInput(target);
    target.dispatchEvent(key('keydown', 'KeyJ'));
    target.dispatchEvent(key('keyup', 'KeyJ'));
    expect(input.sample()).toMatchObject({ attack: false, attackPressed: true });
    expect(input.sample()).toMatchObject({ attackPressed: false });
  });

  it('holding reports held every tick but pressed only once, ignoring key repeat', () => {
    const target = new EventTarget();
    const input = new KeyboardInput(target);
    target.dispatchEvent(key('keydown', 'Space'));
    expect(input.sample()).toMatchObject({ dodgePressed: true });
    target.dispatchEvent(key('keydown', 'Space', true));
    expect(input.sample()).toMatchObject({ dodgePressed: false });
    target.dispatchEvent(key('keydown', 'KeyJ'));
    target.dispatchEvent(key('keydown', 'KeyJ', true));
    expect(input.sample()).toMatchObject({ attack: true, attackPressed: true });
    expect(input.sample()).toMatchObject({ attack: true, attackPressed: false });
  });

  it('the left mouse button attacks; losing focus releases everything', () => {
    const target = new EventTarget();
    const input = new KeyboardInput(target);
    target.dispatchEvent(Object.assign(new Event('mousedown'), { button: 0 }));
    expect(input.sample()).toMatchObject({ attack: true, attackPressed: true });
    target.dispatchEvent(new Event('blur'));
    expect(input.sample()).toMatchObject({ attack: false });
  });
});

describe('feedback table', () => {
  it('the real table names only known events, presets and strings', () => {
    expect(feedbackProblems(FEEDBACK, STRINGS)).toEqual([]);
  });

  it('reports a misspelled event, a missing preset and a missing string', () => {
    const broken = {
      ...FEEDBACK,
      events: { ...FEEDBACK.events, hitt: {}, dispersed: { particles: [{ preset: 'glitter', count: 1 }] }, perfectDodge: { note: 'nope' } },
    } as unknown as FeedbackTable;
    expect(feedbackProblems(broken, STRINGS)).toEqual([
      'dispersed: unknown particle preset "glitter"',
      'perfectDodge: note "nope" is not in content/strings',
      'feedback for unknown event "hitt"',
    ]);
  });

  it('fills note placeholders from the event', () => {
    const e = { type: 'immuneBounce', target: 1, enemy: 'alcohol_barrel', solution: 'conveyor' } as const;
    expect(noteText('solution.{solution}', e, STRINGS)).toBe('非本部門權限：請送產線');
    expect(noteText('solution.{solution}', { ...e, solution: 'guards' }, STRINGS)).toBeUndefined();
  });
});
