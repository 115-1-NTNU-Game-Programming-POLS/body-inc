import { describe, expect, it } from 'vitest';
import feedbackJson from '../../content/feedback.json';
import stringsJson from '../../content/strings/zh-TW.json';
import enemiesJson from '../../content/enemies.json';
import { feedbackProblems, noteFields, noteText, type FeedbackTable, type StringTable } from '../../src/app/feedback.ts';
import { KeyboardInput } from '../../src/app/input.ts';
import { loadEnemyTable } from '../../src/core/index.ts';

const FEEDBACK = feedbackJson as unknown as FeedbackTable;
const STRINGS = stringsJson as StringTable;
const TABLE = loadEnemyTable(enemiesJson);

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

  it('a key still held after a blur counts as held again on its next repeat, without a new press', () => {
    const target = new EventTarget();
    const input = new KeyboardInput(target);
    target.dispatchEvent(key('keydown', 'KeyD'));
    input.sample();
    target.dispatchEvent(new Event('blur'));
    expect(input.sample().move).toEqual({ x: 0, y: 0 });
    target.dispatchEvent(key('keydown', 'KeyD', true));
    expect(input.sample()).toMatchObject({ move: { x: 1, y: 0 }, attackPressed: false, dodgePressed: false });
    target.dispatchEvent(key('keydown', 'KeyJ'));
    input.sample();
    target.dispatchEvent(new Event('blur'));
    target.dispatchEvent(key('keydown', 'KeyJ', true));
    expect(input.sample()).toMatchObject({ attack: true, attackPressed: false });
  });

  it('R and the middle button stamp; a bound middle click cancels the browser autoscroll, an unbound one does not', () => {
    const target = new EventTarget();
    const input = new KeyboardInput(target);
    target.dispatchEvent(key('keydown', 'KeyR'));
    expect(input.sample()).toMatchObject({ stampPressed: true });
    const middle = Object.assign(new Event('mousedown', { cancelable: true }), { button: 1 });
    target.dispatchEvent(middle);
    expect(middle.defaultPrevented).toBe(true);
    expect(input.sample()).toMatchObject({ stampPressed: true });
    const right = Object.assign(new Event('mousedown', { cancelable: true }), { button: 2 });
    target.dispatchEvent(right);
    expect(right.defaultPrevented).toBe(false);
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
  const FIELDS = noteFields(TABLE);

  it('the real table names only known events, presets and strings', () => {
    expect(FIELDS.immuneBounce?.['solution']).toEqual(['conveyor', 'guards']);
    expect(FIELDS.stampVoid?.['solution']).toEqual(['conveyor', 'guards', 'sleep', 'territory']);
    expect(feedbackProblems(FEEDBACK, STRINGS, FIELDS)).toEqual([]);
  });

  it('a templated note is checked for every value its placeholder can take', () => {
    const { ['solution.guards']: _, ...rest } = STRINGS.strings;
    expect(feedbackProblems(FEEDBACK, { ...STRINGS, strings: rest }, FIELDS)).toEqual([
      'immuneBounce: note "solution.guards" is not in content/strings',
    ]);
    expect(feedbackProblems(FEEDBACK, STRINGS, {})).toEqual([
      'immuneBounce: note "solution.{solution}" uses unknown placeholder "{solution}"',
      'stampVoid: note "stamp_void.{solution}" uses unknown placeholder "{solution}"',
      'bossStage: note "boss_stage.{stage}" uses unknown placeholder "{stage}"',
    ]);
  });

  it('each boss stage a bossStage event can name has its line', () => {
    expect(FIELDS.bossStage?.['stage']).toEqual(['2', '3']);
    const { ['boss_stage.3']: _, ...rest } = STRINGS.strings;
    expect(feedbackProblems(FEEDBACK, { ...STRINGS, strings: rest }, FIELDS)).toEqual([
      'bossStage: note "boss_stage.3" is not in content/strings',
    ]);
  });

  it('the void stamp needs an explanation for reforming solutions that a bounce never shows', () => {
    const { ['stamp_void.sleep']: _, ...rest } = STRINGS.strings;
    expect(feedbackProblems(FEEDBACK, { ...STRINGS, strings: rest }, FIELDS)).toEqual([
      'stampVoid: note "stamp_void.sleep" is not in content/strings',
    ]);
  });

  it('reports a misspelled event, a missing preset and a missing string', () => {
    const broken = {
      ...FEEDBACK,
      events: { ...FEEDBACK.events, hitt: {}, dispersed: { particles: [{ preset: 'glitter', count: 1 }] }, perfectDodge: { note: 'nope' } },
    } as unknown as FeedbackTable;
    expect(feedbackProblems(broken, STRINGS, FIELDS)).toEqual([
      'dispersed: unknown particle preset "glitter"',
      'perfectDodge: note "nope" is not in content/strings',
      'feedback for unknown event "hitt"',
    ]);
  });

  it('fills note placeholders from the event', () => {
    const e = { type: 'immuneBounce', target: 1, enemy: 'alcohol_barrel', solution: 'conveyor' } as const;
    expect(noteText('solution.{solution}', e, STRINGS)).toBe('非本部門權限：請送產線');
    expect(noteText('solution.{solution}', { ...e, solution: 'nobody' }, STRINGS)).toBeUndefined();
  });
});
