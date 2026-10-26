import { advance, startClock, wholeMinutes, type RuleClock } from '../clock.ts';
import type { BossTable } from '../combat/bosses/boss.ts';
import type { EnemyTable } from '../combat/enemies.ts';
import { BASE_HALVES } from '../combat/frames.ts';
import { OPERATOR_BODY, type TickInput } from '../combat/operator.ts';
import type { ChapterFile } from '../content/generated.ts';
import type { DialogueState } from '../dialogue/runner.ts';
import type { DialogueTable, Effect } from '../dialogue/lines.ts';
import { createGame, sendStacksHome, step, type DomainEvent, type GameState } from '../game.ts';
import { enterRoom } from '../rooms/entry.ts';
import { arrivalPoint } from '../rooms/interact.ts';
import { openByState } from '../rooms/locks.ts';
import type { RoomModel } from '../rooms/tiled.ts';
import type { BoxPlace, Checkpoint, StoryData } from '../save/slots.ts';
import { spiritAtEntry, type SleepCoefficients } from '../spirit.ts';
import type { TagDictionary } from '../tags/dictionary.ts';
import { EMPTY_TAGS, holds, type TagState } from '../tags/store.ts';
import { TICK_HZ } from '../time.ts';
import { caffeineOf, metabolise, senseCap, type MetabolismParams } from '../outer/caffeine.ts';
import type { Deck } from '../outer/deck.ts';
import { openCard, stepCard, type CardState } from './cards.ts';
import { applyEffects } from './effects.ts';
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
  /** One-time triggers, beds and pickups already used, as `roomId#objectId`. */
  readonly fired: readonly string[];
  /**
   * Toggle switches that are on, as `roomId#objectId`. A room is rebuilt on every entry, so the
   * run keeps them; a solved mechanism stays solved, through doors and forced leaves alike.
   */
  readonly switches: readonly string[];
  /** Where each moved box was last sent, by `roomId#objectId`; the room settles them on entry. */
  readonly boxes: readonly BoxPlace[];
  readonly checkpoint: Checkpoint | null;
  readonly seed: number;
  /** Rooms entered so far; each entry reseeds from it so a retry is not a copy of the last try. */
  readonly entries: number;
  /**
   * Exploring ticks since the chapter clock last moved a minute. It lives on the run, not the
   * room, so the part of a minute walked before a door is not lost when the next room starts.
   */
  readonly explored: number;
}

export interface ChapterState {
  readonly run: Run;
  readonly game: GameState;
  /** The conversation on screen, or null. While one is open the room is frozen and only it takes input. */
  readonly dialogue: DialogueState | null;
  /** The event card on screen, or null; like a conversation it freezes the room. */
  readonly card: CardState | null;
}

/** What the chapter itself reports on top of a room's events. */
export type ChapterEvent =
  | { readonly type: 'roomChanged'; readonly from: string; readonly to: string }
  | { readonly type: 'dialogueOpened'; readonly dialogueId: string }
  | { readonly type: 'dialogueClosed'; readonly dialogueId: string }
  /** A line or a pickup unlocked a handbook page; the app keeps it in the progress slot. */
  | { readonly type: 'handbookUnlocked'; readonly id: string }
  | { readonly type: 'bedRefused'; readonly object: number; readonly bedType: string }
  | { readonly type: 'napped'; readonly minutes: number }
  | { readonly type: 'checkpointSaved'; readonly room: string }
  | { readonly type: 'clockAdvanced'; readonly minutes: number }
  | { readonly type: 'cardOpened'; readonly card: string }
  | { readonly type: 'cardChosen'; readonly card: string; readonly option: string }
  /** A cutscene trigger fired; the cutscene player picks it up when it exists. */
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
  readonly params: ChapterParams;
  /** The chapter's outer-layer cards; absent for a chapter without any. */
  readonly deck?: Deck;
}

export interface ChapterParams extends SleepCoefficients, MetabolismParams {
  /** Real seconds per game hour of the chapter clock while exploring (design doc 7.2). */
  readonly exploreSecondsPerHour: number;
  /** Caffeine residual one cup of coffee adds (design doc 7.4). */
  readonly cup: number;
}

/** Room ticks per minute of the chapter clock. */
export const ticksPerMinute = (k: ChapterParams): number => Math.max(1, Math.round((k.exploreSecondsPerHour * TICK_HZ) / 60));

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
    switches: idsHere(run, run.switches),
    unlocked: openByState(room.objects, run.tags, ctx.dict, carry.clock),
    // `fired` also holds triggers and beds; the room keeps only the ids that are its pickups.
    taken: idsHere(run, run.fired),
    boxes: boxesHere(run),
    ...(start ? { start } : {}),
  });
}

/** The run's remembered boxes of its current room, by object id. */
function boxesHere(run: Run): Map<number, { col: number; row: number }> {
  const prefix = `${run.roomId}#`;
  return new Map(run.boxes.filter((b) => b.key.startsWith(prefix)).map((b) => [Number(b.key.slice(prefix.length)), { col: b.col, row: b.row }]));
}

/** Object ids of the run's current room among `roomId#objectId` keys. */
function idsHere(run: Run, keys: readonly string[]): number[] {
  const prefix = `${run.roomId}#`;
  return keys.filter((k) => k.startsWith(prefix)).map((k) => Number(k.slice(prefix.length)));
}

/** When a chapter opens unless told otherwise: day 1, 08:00. The opening cards are played at this time too. */
export const CHAPTER_OPENS: RuleClock = startClock(1, 8);

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
    switches: [],
    boxes: [],
    checkpoint: null,
    seed: options.seed ?? 1,
    entries: 1,
    explored: 0,
  };
  const game = build(ctx, run, { kind: 'start' }, {
    clock: options.clock ?? CHAPTER_OPENS, gauge: options.gauge ?? 0, halves: options.halves ?? BASE_HALVES, stacks: 0,
  });
  return { run, game, dialogue: null, card: null };
}

/** Continue from a saved checkpoint: its room and place, its tags and clock, full hearts. */
export function resumeChapter(ctx: ChapterContent, saved: Checkpoint, seed = 1): ChapterState {
  if (saved.chapter !== ctx.chapter.id) throw new ChapterError(`checkpoint belongs to chapter "${saved.chapter}", not "${ctx.chapter.id}"`);
  const run: Run = {
    chapter: saved.chapter, roomId: saved.roomId, tags: saved.tags, fired: saved.fired, switches: saved.switches, boxes: saved.boxes, checkpoint: saved, seed, entries: 1, explored: 0,
  };
  const game = build(ctx, run, { kind: 'at', x: saved.x, y: saved.y }, { clock: saved.clock, gauge: 0, halves: BASE_HALVES, stacks: 0 });
  return { run, game, dialogue: null, card: null };
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
  /** A conversation or event card this trigger asks for; it opens once the tick's other events are settled. */
  readonly opens?: Modal;
  /** The `fired` key this trigger just used up; given back if what it opens never appears. */
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
        switches: run.switches, boxes: run.boxes,
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
      return { ...passTime(ctx, run, game, minutes), events: [{ type: 'clockAdvanced', minutes }] };
    }
    case 'dialogue':
    case 'card':
      return { run, game, events: [], opens: { kind: e.trigger, id: e.eventId }, ...(once ? { spent: key } : {}) };
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
  const slept = passTime(ctx, { ...run, fired: [...run.fired, key] }, game, NAP.minutes);
  return { run: slept.run, game: sendStacksHome(slept.game), events: [{ type: 'napped', minutes: NAP.minutes }] };
}

/**
 * What an item does once taken. Coffee is a cup of residual (design doc 7.4) and a handbook page
 * goes into the handbook; the other kinds have no rule yet and only leave the room. Like a
 * conversation's effects, each pickup is one entry in the causal log.
 */
function onPickup(ctx: ChapterContent, run: Run, game: GameState, e: Extract<DomainEvent, { type: 'pickedUp' }>): Applied {
  const spent: Run = { ...run, fired: [...run.fired, `${run.roomId}#${e.object}`] };
  const effects: Effect[] = e.itemType === 'coffee' ? [{ kind: 'amount', name: 'caffeine', mode: 'add', value: ctx.params.cup }]
    : e.itemType === 'handbook' ? [{ kind: 'unlock', id: e.itemId }]
      : [];
  const out = applyEffects(ctx.dict, spent.tags, game.clock, effects, { kind: 'activity', key: `pickup.${e.itemType}` }, ctx.params);
  return { run: { ...spent, tags: out.tags }, game, events: out.events };
}

/**
 * Moves the chapter clock on, and the caffeine residual with it (design doc 7.4). Every forward
 * move goes through here or through a `clock:` effect, which decays the same way; a return to a
 * checkpoint moves the clock back and restores the saved tags instead.
 */
function passTime(ctx: ChapterContent, run: Run, game: GameState, minutes: number): { run: Run; game: GameState } {
  return { run: { ...run, tags: metabolise(run.tags, ctx.dict, minutes, ctx.params) }, game: { ...game, clock: advance(game.clock, minutes) } };
}

/**
 * Beds and pickups used since the punch come back on a return to it: the clock and the tags go
 * back to the punch, so the nap or the coffee they gave is undone too. A handbook page is the
 * exception, since the page it gave outlives every run and is not undone.
 */
const undoneByReturn = (ctx: ChapterContent, key: string): boolean => {
  const [room = '', id = ''] = key.split('#');
  return ctx.rooms.get(room)?.objects.some((o) => String(o.id) === id
    && (o.kind === 'Bed' || (o.kind === 'Pickup' && o.props['itemType'] !== 'handbook'))) ?? false;
};

/** A conversation or an event card. Only one is on screen at a time, and only one opens per tick. */
export interface Modal {
  readonly kind: 'dialogue' | 'card';
  readonly id: string;
}

/**
 * One rule tick of a chapter. While a conversation or an event card is open only it takes input
 * and the room is frozen; otherwise the room steps and the chapter handles what only a chapter
 * can.
 */
export function stepChapter(ctx: ChapterContent, state: ChapterState, input: TickInput): ChapterResult {
  return state.dialogue ? stepTalk(ctx, state, input) : state.card ? stepCard(ctx, state, input) : stepRoom(ctx, state, input);
}

/** The room as the cloak leaves it: adenosine sees less while the residual is high (design doc 7.4). */
function cloaked(ctx: ChapterContent, run: Run, game: GameState): GameState {
  const cap = senseCap(caffeineOf(run.tags, ctx.dict));
  if (cap !== undefined) return game.senseCapPx === cap ? game : { ...game, senseCapPx: cap };
  if (game.senseCapPx === undefined) return game;
  const { senseCapPx: _, ...rest } = game;
  return rest;
}

/** The room with its clock and resource locks judged from the tags and the clock as the tick starts. */
function unlockedNow(ctx: ChapterContent, run: Run, game: GameState): GameState {
  const unlocked = openByState(game.room.objects, run.tags, ctx.dict, game.clock);
  const same = unlocked.length === game.unlocked.length && unlocked.every((id, i) => id === game.unlocked[i]);
  return same ? game : { ...game, unlocked };
}

const plain = (run: Run, game: GameState): ChapterState => ({ run, game, dialogue: null, card: null });

function stepRoom(ctx: ChapterContent, state: ChapterState, input: TickInput): ChapterResult {
  const r = step(unlockedNow(ctx, state.run, cloaked(ctx, state.run, state.game)), input);
  let { run } = state;
  let game = r.state;
  // The chapter clock runs while exploring (design doc 7.2); a conversation or a card stops it.
  const explored = run.explored + 1;
  if (explored < ticksPerMinute(ctx.params)) run = { ...run, explored };
  else ({ run, game } = passTime(ctx, { ...run, explored: 0 }, game, 1));
  const extra: ChapterEvent[] = [];
  let through: Extract<DomainEvent, { type: 'doorEntered' }> | undefined;
  /** The first conversation or card asked for this tick; one at a time, so a second request is dropped. */
  let opening: (Modal & { readonly spent?: string }) | undefined;
  /**
   * A once-trigger whose conversation is not shown has not been seen, so it can fire again. A
   * checkpoint punched later in the same tick already copied the key, so it is taken back there too.
   */
  const giveBack = (key: string | undefined) => {
    if (key === undefined) return;
    const cp = run.checkpoint;
    run = {
      ...run,
      fired: run.fired.filter((k) => k !== key),
      checkpoint: cp?.fired.includes(key) ? { ...cp, fired: cp.fired.filter((k) => k !== key) } : cp,
    };
  };
  const done = (next: ChapterState, more: readonly ChapterEvent[]): ChapterResult => ({ state: next, events: [...r.events, ...extra, ...more] });

  for (const e of r.events) {
    switch (e.type) {
      case 'switchChanged': {
        // Only a toggle switch outlives the moment; a plate is down only while stood on.
        if (e.mode !== 'toggle') break;
        const key = `${run.roomId}#${e.object}`;
        run = { ...run, switches: e.on ? [...run.switches.filter((k) => k !== key), key] : run.switches.filter((k) => k !== key) };
        break;
      }
      case 'boxMoved': {
        // Like a lever, a box outlives the visit and the forced leave; settleBoxes decides on entry what stays.
        const key = `${run.roomId}#${e.object}`;
        run = { ...run, boxes: [...run.boxes.filter((b) => b.key !== key), { key, col: e.col, row: e.row }] };
        break;
      }
      case 'doorEntered':
        // Left for last: a trigger or bed touched on the same tick still belongs to the room being left.
        through ??= e;
        break;
      case 'forcedLeave': {
        const cp = run.checkpoint;
        // Without a checkpoint the room has already restarted at its start, which is all there is to return to.
        if (!cp) break;
        // Everything else spent stays spent.
        const fired = run.fired.filter((k) => cp.fired.includes(k) || !undoneByReturn(ctx, k));
        const next: Run = { ...run, roomId: cp.roomId, tags: cp.tags, fired, entries: run.entries + 1 };
        // Only sleep clears adenosine, so the stacks come back with the operator.
        const built = build(ctx, next, { kind: 'at', x: cp.x, y: cp.y }, {
          clock: cp.clock, gauge: game.operator.gauge, halves: game.operator.maxHalves, stacks: game.operator.stacks,
        });
        return done(plain(next, built), [{ type: 'returnedToCheckpoint', room: cp.roomId }]);
      }
      case 'talk':
        opening ??= { kind: 'dialogue', id: e.dialogueId };
        break;
      case 'triggerEntered': {
        const a = onTrigger(ctx, run, game, e);
        ({ run, game } = a);
        extra.push(...a.events);
        if (a.opens === undefined) break;
        if (opening) giveBack(a.spent);
        else opening = { ...a.opens, ...(a.spent !== undefined ? { spent: a.spent } : {}) };
        break;
      }
      case 'pickedUp': {
        const a = onPickup(ctx, run, game, e);
        ({ run, game } = a);
        extra.push(...a.events);
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

  // A door crossed on the same tick waits: it is forgotten as touched, so it fires again once the
  // conversation or card is over.
  const holdDoor = (g: GameState): GameState => (through ? { ...g, touching: g.touching.filter((id) => id !== through!.object) } : g);
  if (opening?.kind === 'card') {
    return done({ ...plain(run, holdDoor(game)), card: openCard(ctx, opening.id) }, [{ type: 'cardOpened', card: opening.id }]);
  }
  if (opening !== undefined) {
    if (!ctx.dialogues.has(opening.id)) throw new ChapterError(`${run.roomId}: dialogue "${opening.id}" does not exist (the map check and Boot should have caught this)`);
    const talk = openTalk(ctx, run, game, opening.id);
    if (talk) return done({ ...plain(talk.run, holdDoor(talk.game)), dialogue: talk.dialogue }, talk.events);
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
    return done(plain(next, built), [{ type: 'roomChanged', from: run.roomId, to: dest.room }]);
  }
  return done(plain(run, game), []);
}
