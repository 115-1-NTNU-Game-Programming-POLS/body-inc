import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DIALOGUE_FILES, DIALOGUES, SPEAKERS, STRINGS, TAGS } from '../../src/app/content.ts';
import { portraitKey, portraitsUsed, speakerProblems } from '../../src/app/dialogue.ts';
import { KeyboardInput } from '../../src/app/input.ts';
import { loadDialogueTable, OPERATOR_SPEAKER } from '../../src/core/index.ts';

const HEADER = 'dialogueId,order,speaker,expression,text,condition,effect,next,fact';

describe('bundled dialogue', () => {
  it('every CSV under content/dialogue is bundled and loads', () => {
    expect(DIALOGUE_FILES.map((f) => f.file)).toContain('content/dialogue/greybox.csv');
    expect(DIALOGUES.has('greybox.liver.hello')).toBe(true);
    expect(DIALOGUES.get('greybox.brain.briefing')?.lines.filter((l) => l.speaker === OPERATOR_SPEAKER)).toHaveLength(3);
  });

  it('every speaker is registered and has a name tag string', () => {
    expect(speakerProblems(DIALOGUES, SPEAKERS)).toEqual([]);
    for (const id of Object.keys(SPEAKERS)) expect(STRINGS.strings[`speaker.${id}`], id).toBeDefined();
  });

  it('names the conversation and speaker when one is not registered', () => {
    const table = loadDialogueTable([{ file: 'x.csv', text: `${HEADER}\nhi,1,ghost,normal,哈,,,,\n` }], TAGS);
    expect(speakerProblems(table, SPEAKERS)).toEqual(['x.csv: hi names speaker "ghost", which content/speakers.json does not list']);
    expect(speakerProblems(table, { ghost: { style: 'box', portrait: false } })).toEqual([]);
  });

  it('the portraits Boot loads are the ones the conversations use, each once, and each file exists', () => {
    const used = portraitsUsed(DIALOGUES, SPEAKERS);
    expect(used.map((p) => p.key)).toContain(portraitKey('brain', 'surprised'));
    expect(new Set(used.map((p) => p.key)).size).toBe(used.length);
    for (const p of used) expect(existsSync(`public/${p.url}`), p.url).toBe(true);
  });

  it('a speaker without portraits loads none, and the operator never does', () => {
    const table = loadDialogueTable([{ file: 'x.csv', text: `${HEADER}\nhi,1,clerk,smile,哈,,,,\nhi,2,operator,,好,,,,\nhi,3,operator,,不,,,,\n` }], TAGS);
    expect(portraitsUsed(table, { clerk: { style: 'box', portrait: false } })).toEqual([]);
    expect(portraitsUsed(table, { clerk: { style: 'box', portrait: true } }).map((p) => p.key)).toEqual([portraitKey('clerk', 'smile')]);
  });
});

describe('keyboard input in a conversation', () => {
  const key = (type: string, code: string) => Object.assign(new Event(type), { code, repeat: false });
  const setup = () => {
    const target = new EventTarget();
    return { target, input: new KeyboardInput(target) };
  };

  it('a tap of W or S is one step up or down, once', () => {
    const { target, input } = setup();
    target.dispatchEvent(key('keydown', 'KeyS'));
    expect(input.sample().menuStep).toBe(1);
    expect(input.sample().menuStep).toBe(0);
    target.dispatchEvent(key('keyup', 'KeyS'));
    target.dispatchEvent(key('keydown', 'ArrowUp'));
    expect(input.sample().menuStep).toBe(-1);
  });

  it('a held S steps once, not every tick', () => {
    const { target, input } = setup();
    target.dispatchEvent(key('keydown', 'KeyS'));
    input.sample();
    expect(input.sample().menuStep).toBe(0);
  });

  it('up and down together cancel out', () => {
    const { target, input } = setup();
    target.dispatchEvent(key('keydown', 'KeyW'));
    target.dispatchEvent(key('keydown', 'KeyS'));
    expect(input.sample().menuStep).toBe(0);
  });

  it('1, 2 and 3 pick a reply, from either keyboard row, and nothing else sets a pick', () => {
    const { target, input } = setup();
    expect(input.sample()).not.toHaveProperty('pick');
    for (const [code, n] of [['Digit1', 1], ['Digit2', 2], ['Numpad3', 3]] as const) {
      target.dispatchEvent(key('keydown', code));
      expect(input.sample().pick, code).toBe(n);
      target.dispatchEvent(key('keyup', code));
    }
    expect(input.sample()).not.toHaveProperty('pick');
  });

  it('a reply clicked with the mouse arrives as a pick on the next tick only', () => {
    const { input } = setup();
    input.queuePick(2);
    expect(input.sample().pick).toBe(2);
    expect(input.sample()).not.toHaveProperty('pick');
  });

  it('a queued pick does not outlive a scene change', () => {
    const { input } = setup();
    input.queuePick(3);
    input.clearPresses();
    expect(input.sample()).not.toHaveProperty('pick');
    input.queuePick(3);
    input.ignoreHeld();
    expect(input.sample()).not.toHaveProperty('pick');
  });
});
