import { advance, startClock, wholeMinutes, type RuleClock } from '../clock.ts';
import type { BossTable } from '../combat/bosses/boss.ts';
import type { EnemyTable } from '../combat/enemies.ts';
import { BASE_HALVES } from '../combat/frames.ts';
import { OPERATOR_BODY, type TickInput } from '../combat/operator.ts';
import type { ChapterFile } from '../content/generated.ts';
import type { DialogueState } from '../dialogue/runner.ts';
import type { DialogueTable } from '../dialogue/lines.ts';
import { createGame, sendStacksHome, step, type DomainEvent, type GameState } from '../game.ts';
import { enterRoom } from '../rooms/entry.ts';
import { arrivalPoint } from '../rooms/interact.ts';
import type { RoomModel } from '../rooms/tiled.ts';
import type { Checkpoint, StoryData } from '../save/slots.ts';
import { spiritAtEntry, type SleepCoefficients } from '../spirit.ts';
import type { TagDictionary } from '../tags/dictionary.ts';
import { EMPTY_TAGS, holds, type TagState } from '../tags/store.ts';
import { openTalk, stepTalk } from './talk.ts';

/**
 * A story chapter in play (build plan P0): the room being fought in plus what outlives a room.
 * `game.ts` knows one room and nothing else, so everything between rooms lives here: which door
 * leads where, the tags the next room is entered with, one-time triggers, the checkpoint. It is
 * plain data and a pure step, so a walk through several rooms replays to the same hash in Node.
 */

/** A 20-minute nap (design doc 7.4). Its 60 seconds of not being clung to wait on fact-check item 3. */
export const NAP = { minutes: 20 } as const;

export class ChapterError extends Error {}

export interface Run {
  readonly chapter: string;
  /** Room path as folder/map, the key of the room library. */
  readonly roomId: string;
  readonly tags: TagState;
  /** One-time triggers and beds already used, as `roomId#objectId`. */
  readonly fired: readonly string[];
  readonly checkpoint: Checkpoint | null;
  readonly seed: number;
  /** Rooms entered so far; each entry reseeds from it so a retry is not a copy of the last try. */
  readonly entries: number;
}

export interface ChapterState {
  readonly run: Run;
  readonly game: GameState;
  /** The conversation on screen, or null. While one is open the room is frozen and only it takes input. */
  readonly dialogue: DialogueState | null;
}

/** What the chapter itself reports on top of a room's events. */
export type ChapterEvent =
  | { readonly type: 'roomChanged'; readonly from: string; readonly to: string }
  | { readonly type: 'dialogueOpened'; readonly dialogueId: string }
  | { readonly type: 'dialogueClosed'; readonly dialogueId: string }
  /** A line unlocked a handbook page; nothing keeps the page yet (the handbook slot is not built). */
  | { readonly type: 'handbookUnlocked'; readonly id: string }
  | { readonly type: 'bedRefused'; readonly object: number; readonly bedType: string }
  | { readonly type: 'napped'; readonly minutes: number }
  | { readonly type: 'checkpointSaved'; readonly room: string }
  | { readonly type: 'clockAdvanced'; readonly minutes: number }
  /** A card or cutscene trigger fired; the outer layer picks it up when it exists. */
  | { readonly type: 'outerRequested'; readonly kind: string; readonly eventId: string }
  | { readonly type: 'returnedToCheckpoint'; readonly room: string }
  | { readonly type: 'chapterEnded' };

export type GameEvent = DomainEvent | ChapterEvent;

/** Content handed in at startup, like everything else core uses; core never reads files. */
export interface ChapterContent {
  readonly chapter: ChapterFile;
  /** Every room of the chapter, by room path. */
  readonly rooms: ReadonlyMap<string, RoomModel>;
  /** Every conversation of the game; Tiled names them by id. */
  readonly dialogues: DialogueTable;
  readonly dict: TagDictionary;
  readonly enemies: EnemyTable;
  readonly bosses: BossTable;
  readonly params: SleepCoefficients;
}

export interface ChapterResult {
  readonly state: ChapterState;
  readonly events: readonly GameEvent[];
}

type Place =
  | { readonly kind: 'start' }
  | { readonly kind: 'door'; readonly door: string }
  | { readonly kind: 'at'; readonly x: number; readonly y: number };

interface Carry {
  readonly clock: RuleClock;
  readonly gauge: number;
  readonly halves: number;
  readonly stacks: number;
}

function build(ctx: ChapterContent, run: Run, place: Place, carry: Carry): GameState {
  const model = ctx.rooms.get(run.roomId);
  if (!model) throw new ChapterError(`${ctx.chapter.id}: room ${run.roomId} is not in the room library`);
  const room = enterRoom(model, run.tags, ctx.dict);
  let start: { x: number; y: number } | undefined;
  if (place.kind === 'door') {
    const door = room.objects.find((o) => o.kind === 'Door' && o.name === place.door);
    if (!door) throw new ChapterError(`${run.roomId}: no door named "${place.door}" (the map check should have caught this)`);
    start = arrivalPoint(door, OPERATOR_BODY);
  } else if (place.kind === 'at') start = { x: place.x, y: place.y };
  return createGame(room, run.seed + run.entries, ctx.enemies, {
    p: spiritAtEntry(run.tags, ctx.dict, ctx.params),
    bosses: ctx.bosses,
    clock: carry.clock,
    gauge: carry.gauge,
    halves: carry.halves,
    stacks: carry.stacks,
    ...(start ? { start } : {}),
  });
}

export interface StartOptions {
  /** Room to open in; the chapter's start room when absent. */
  readonly room?: string;
  readonly tags?: TagState;
  readonly seed?: number;
  readonly gauge?: number;
  readonly halves?: number;
  readonly clock?: RuleClock;
}

export function startChapter(ctx: ChapterContent, options: StartOptions = {}): ChapterState {
  const run: Run = {
    chapter: ctx.chapter.id,
    roomId: options.room ?? ctx.chapter.start,
    tags: options.tags ?? EMPTY_TAGS,
    fired: [],
    checkpoint: null,
    seed: options.seed ?? 1,
    entries: 1,
  };
  const game = build(ctx, run, { kind: 'start' }, {
    clock: options.clock ?? startClock(1, 8), gauge: options.gauge ?? 0, halves: options.halves ?? BASE_HALVES, stacks: 0,
  });
  return { run, game, dialogue: null };
}

/** Continue from a saved checkpoint: its room and place, its tags and clock, full hearts. */
export function resumeChapter(ctx: ChapterContent, saved: Checkpoint, seed = 1): ChapterState {
  if (saved.chapter !== ctx.chapter.id) throw new ChapterError(`checkpoint belongs to chapter "${saved.chapter}", not "${ctx.chapter.id}"`);
  const run: Run = {
    chapter: saved.chapter, roomId: saved.roomId, tags: saved.tags, fired: saved.fired, checkpoint: saved, seed, entries: 1,
  };
  const game = build(ctx, run, { kind: 'at', x: saved.x, y: saved.y }, { clock: saved.clock, gauge: 0, halves: BASE_HALVES, stacks: 0 });
  return { run, game, dialogue: null };
}

/** Every room the chapter file names, start first; the rooms the app must have loaded before play. */
export function roomsOf(chapter: ChapterFile): string[] {
  const out = new Set<string>([chapter.start]);
  for (const l of chapter.links) for (const end of [l.a, l.b]) out.add(end.split('#')[0]!);
  return [...out];
}

/** What the story slot should hold for this run. */
export const storyOf = (run: Run): StoryData => ({ checkpoint: run.checkpoint });

/** The other end of the door `door` in `room`, or undefined when the chapter file does not link it. */
export function across(chapter: ChapterFile, room: string, door: string): { room: string; door: string } | undefined {
  const here = `${room}#${door}`;
  for (const l of chapter.links) {
    const other = l.a === here ? l.b : l.b === here ? l.a : undefined;
    if (other === undefined) continue;
    const [r = '', d = ''] = other.split('#');
    return { room: r, door: d };
  }
  return undefined;
}

interface Applied {
  readonly run: Run;
  readonly game: GameState;
  readonly events: readonly ChapterEvent[];
  /** The id of a dialogue trigger; the conversation opens once the tick's other events are settled. */
  readonly dialogue?: string;
  /** The `fired` key this trigger just used up; given back if its conversation never opens. */
  readonly spent?: string;
}

function onTrigger(ctx: ChapterContent, run: Run, game: GameState, e: Extract<DomainEvent, { type: 'triggerEntered' }>): Applied {
  const o = game.room.objects.find((x) => x.id === e.object);
  if (!o) throw new ChapterError(`${run.roomId}: trigger #${e.object} is not in the room`);
  const when = o.conditions['when'];
  if (when && !holds(run.tags, ctx.dict, when)) return { run, game, events: [] };
  const key = `${run.roomId}#${o.id}`;
  // A checkpoint is punched every time: skipping the second visit would leave the old spot as the restart point.
  const once = o.props['once'] === true && e.trigger !== 'checkpoint';
  if (once && run.fired.includes(key)) return { run, game, events: [] };
  if (once) run = { ...run, fired: [...run.fired, key] };

  switch (e.trigger) {
    case 'checkpoint': {
      const checkpoint: Checkpoint = {
        chapter: run.chapter, roomId: run.roomId, x: game.operator.x, y: game.operator.y, tags: run.tags, clock: game.clock, fired: run.fired,
      };
      // The tea room sits beside the time clock (design doc 5.6), so punching in also restores the hearts.
      return {
        run: { ...run, checkpoint },
        game: { ...game, operator: { ...game.operator, halves: game.operator.maxHalves } },
        events: [{ type: 'checkpointSaved', room: run.roomId }],
      };
    }
    case 'clock_advance': {
      const minutes = wholeMinutes(e.eventId);
      if (minutes === undefined) throw new ChapterError(`${run.roomId}: clock_advance trigger #${o.id} needs whole minutes in eventId, got "${e.eventId}"`);
      return { run, game: { ...game, clock: advance(game.clock, minutes) }, events: [{ type: 'clockAdvanced', minutes }] };
    }
    case 'dialogue':
      return { run, game, events: [], dialogue: e.eventId, ...(once ? { spent: key } : {}) };
    default:
      return { run, game, events: [{ type: 'outerRequested', kind: e.trigger, eventId: e.eventId }] };
  }
}

function onBed(ctx: ChapterContent, run: Run, game: GameState, e: Extract<DomainEvent, { type: 'bedUse' }>): Applied {
  const o = game.room.objects.find((x) => x.id === e.object);
  if (!o) throw new ChapterError(`${run.roomId}: bed #${e.object} is not in the room`);
  const refused: Applied = { run, game, events: [{ type: 'bedRefused', object: o.id, bedType: e.bedType }] };
  const requires = o.conditions['requires'];
  if (requires && !holds(run.tags, ctx.dict, requires)) return refused;
  if (e.bedType === 'sleep') return { run, game, events: [{ type: 'chapterEnded' }] };
  // The nap sofa is once per chapter (design doc 7.4); here that is once per bed object.
  const key = `${run.roomId}#${o.id}`;
  if (run.fired.includes(key)) return refused;
  return {
    run: { ...run, fired: [...run.fired, key] },
    game: sendStacksHome({ ...game, clock: advance(game.clock, NAP.minutes) }),
    events: [{ type: 'napped', minutes: NAP.minutes }],
  };
}

const isBed = (ctx: ChapterContent, key: string): boolean => {
  const [room = '', id = ''] = key.split('#');
  return ctx.rooms.get(room)?.objects.some((o) => o.kind === 'Bed' && String(o.id) === id) ?? false;
};

export function stepChapter(ctx: ChapterContent, state: ChapterState, input: TickInput): ChapterResult {
  if (state.dialogue) return stepTalk(ctx, state, input);
  const r = step(state.game, input);
  let { run } = state;
  let game = r.state;
  const extra: ChapterEvent[] = [];
  let through: Extract<DomainEvent, { type: 'doorEntered' }> | undefined;
  /** The first conversation asked for this tick; one at a time, so a second request is dropped. */
  let opening: { readonly id: string; readonly spent?: string } | undefined;
  /** A once-trigger whose conversation is not shown has not been seen, so it can fire again. */
  const giveBack = (key: string | undefined) => {
    if (key !== undefined) run = { ...run, fired: run.fired.filter((k) => k !== key) };
  };
  const done = (next: ChapterState, more: readonly ChapterEvent[]): ChapterResult => ({ state: next, events: [...r.events, ...extra, ...more] });

  for (const e of r.events) {
    switch (e.type) {
      case 'doorEntered':
        // Left for last: a trigger or bed touched on the same tick still belongs to the room being left.
        through ??= e;
        break;
      case 'forcedLeave': {
        const cp = run.checkpoint;
        // Without a checkpoint the room has already restarted at its start, which is all there is to return to.
        if (!cp) break;
        // The clock goes back to the punch, which undoes a nap taken since, so its bed is usable again.
        // Everything else spent stays spent.
        const fired = run.fired.filter((k) => cp.fired.includes(k) || !isBed(ctx, k));
        const next: Run = { ...run, roomId: cp.roomId, tags: cp.tags, fired, entries: run.entries + 1 };
        // Only sleep clears adenosine, so the stacks come back with the operator.
        const built = build(ctx, next, { kind: 'at', x: cp.x, y: cp.y }, {
          clock: cp.clock, gauge: game.operator.gauge, halves: game.operator.maxHalves, stacks: game.operator.stacks,
        });
        return done({ run: next, game: built, dialogue: null }, [{ type: 'returnedToCheckpoint', room: cp.roomId }]);
      }
      case 'talk':
        opening ??= { id: e.dialogueId };
        break;
      case 'triggerEntered': {
        const a = onTrigger(ctx, run, game, e);
        ({ run, game } = a);
        extra.push(...a.events);
        if (a.dialogue === undefined) break;
        if (opening) giveBack(a.spent);
        else opening = { id: a.dialogue, ...(a.spent !== undefined ? { spent: a.spent } : {}) };
        break;
      }
      case 'bedUse': {
        const a = onBed(ctx, run, game, e);
        ({ run, game } = a);
        extra.push(...a.events);
        break;
      }
      default:
        break;
    }
  }

  if (opening !== undefined) {
    if (!ctx.dialogues.has(opening.id)) throw new ChapterError(`${run.roomId}: dialogue "${opening.id}" does not exist (the map check and Boot should have caught this)`);
    const talk = openTalk(ctx, run, game, opening.id);
    if (talk) {
      // A door crossed on the same tick waits: it is forgotten as touched, so it fires again once the conversation is over.
      const touching = through ? talk.game.touching.filter((id) => id !== through!.object) : talk.game.touching;
      return done({ run: talk.run, game: { ...talk.game, touching }, dialogue: talk.dialogue }, talk.events);
    }
    giveBack(opening.spent);
  }

  if (through) {
    const dest = across(ctx.chapter, run.roomId, through.door);
    if (!dest) throw new ChapterError(`${run.roomId}: door "${through.door}" leads nowhere in chapter ${ctx.chapter.id} (the map check should have caught this)`);
    const next: Run = { ...run, roomId: dest.room, entries: run.entries + 1 };
    // Only sleep clears adenosine, so a door must not: the stacks ride along into the next room.
    const built = build(ctx, next, { kind: 'door', door: dest.door }, {
      clock: game.clock, gauge: game.operator.gauge, halves: game.operator.halves, stacks: game.operator.stacks,
    });
    return done({ run: next, game: built, dialogue: null }, [{ type: 'roomChanged', from: run.roomId, to: dest.room }]);
  }
  return done({ run, game, dialogue: null }, []);
}
