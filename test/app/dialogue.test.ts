import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHAPTERS, DIALOGUE_FILES, DIALOGUES, SPEAKERS, STRINGS, TAGS } from '../../src/app/content.ts';
import { missingDialogues, portraitKey, portraitsUsed, releaseKeysOnClose, speakerProblems } from '../../src/app/dialogue.ts';
import { KeyboardInput } from '../../src/app/input.ts';
import { FixedStepLoop } from '../../src/app/loop.ts';
import { loadDialogueTable, OPERATOR_SPEAKER, parseRoom, roomsOf, TICK_MS, type GameEvent, type TiledMap } from '../../src/core/index.ts';

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

  it('the hint under a spoken line offers no choice, and the one under replies explains the choice keys', () => {
    const say = STRINGS.strings['dialogue.hint']!.text;
    const choose = STRINGS.strings['dialogue.hint_choose']!.text;
    expect(say).not.toMatch(/選擇|1 2 3/);
    expect(choose).toMatch(/W／S/);
    expect(choose).toMatch(/1 2 3/);
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

describe('conversations the rooms start', () => {
  const table = loadDialogueTable([{ file: 'x.csv', text: `${HEADER}\nhere,1,brain,normal,哈,,,,\n` }], TAGS);
  const obj = (id: number, kind: string, props: Record<string, string | number | boolean>) => ({ id, kind, props });
  const rooms = (...objects: ReturnType<typeof obj>[]) => new Map([['lab/room', { objects }]]);

  it('accepts an NPC and a dialogue trigger that name a conversation the table holds', () => {
    const found = missingDialogues(rooms(obj(2, 'NPC', { dialogueId: 'here' }), obj(3, 'Trigger', { event: 'dialogue', eventId: 'here' })), table);
    expect(found).toEqual([]);
  });

  it('names the room, the object and the conversation for an NPC or a trigger that points nowhere', () => {
    const found = missingDialogues(rooms(obj(2, 'NPC', { dialogueId: 'gone' }), obj(3, 'Trigger', { event: 'dialogue', eventId: 'lost' })), table);
    expect(found).toEqual([
      expect.stringMatching(/^lab\/room: NPC #2 .*"gone"/),
      expect.stringMatching(/^lab\/room: Trigger #3 .*"lost"/),
    ]);
  });

  it('leaves alone a trigger that is not a dialogue, whose eventId means something else', () => {
    expect(missingDialogues(rooms(obj(3, 'Trigger', { event: 'clock_advance', eventId: '10' }), obj(4, 'Door', { socket: 'N' })), table)).toEqual([]);
  });

  it('holds for every bundled room, and sees the NPC of the brain corridor once its conversation is gone', () => {
    const rooms = new Map([...CHAPTERS.values()].flatMap((c) => roomsOf(c)).map((p) => {
      const map = JSON.parse(readFileSync(`public/assets/maps/${p}.tmj`, 'utf8')) as TiledMap;
      return [p, parseRoom(p, map, TAGS)] as const;
    }));
    expect(missingDialogues(rooms, DIALOGUES)).toEqual([]);
    const without = new Map([...DIALOGUES].filter(([id]) => id !== 'greybox.brain.briefing'));
    expect(missingDialogues(rooms, without)).toEqual([expect.stringContaining('"greybox.brain.briefing"')]);
  });
});

describe('keyboard input in a conversation', () => {
  const key = (type: string, code: string) => Object.assign(new Event(type), { code, repeat: false });
  const mouse = (type: string, button: number) => Object.assign(new Event(type), { button });
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

  it('while replies are offered a click counts only as the note it hit, not as attack', () => {
    const { target, input } = setup();
    input.ignoreMouse(true);
    target.dispatchEvent(mouse('mousedown', 0));
    const missed = input.sample();
    expect(missed.attackPressed).toBe(false);
    expect(missed.attack).toBe(false);
    target.dispatchEvent(mouse('mouseup', 0));
    target.dispatchEvent(mouse('mousedown', 0));
    input.queuePick(2);
    expect(input.sample()).toMatchObject({ pick: 2, attackPressed: false });
    target.dispatchEvent(mouse('mouseup', 0));
    target.dispatchEvent(key('keydown', 'KeyJ'));
    expect(input.sample().attackPressed).toBe(true);
    target.dispatchEvent(key('keyup', 'KeyJ'));
    input.ignoreMouse(false);
    target.dispatchEvent(mouse('mousedown', 0));
    expect(input.sample().attackPressed).toBe(true);
  });

  it('a key held to close a conversation is not a held attack afterwards', () => {
    const { target, input } = setup();
    const loop = new FixedStepLoop<number, GameEvent>(0, (s) => ({ state: s + 1, events: s === 0 ? [{ type: 'dialogueClosed', dialogueId: 'x' }] : [] }));
    releaseKeysOnClose(loop, input);
    const seen: boolean[] = [];
    target.dispatchEvent(key('keydown', 'KeyJ'));
    loop.advance(TICK_MS * 3 + 1, () => {
      const i = input.sample();
      seen.push(i.attack === true);
      return i;
    });
    expect(seen).toEqual([true, false, false]);
    target.dispatchEvent(key('keyup', 'KeyJ'));
    target.dispatchEvent(key('keydown', 'KeyJ'));
    expect(input.sample().attack).toBe(true);
  });
});
