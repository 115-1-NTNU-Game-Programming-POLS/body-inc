import Phaser from 'phaser';
import {
  bankPoints, buyCareerNode, careerCards, COFFEE_PLANS, commendation, rerollOffer, sealColumns, settingChoices, daySummary, endSummary, finishSemester, hasAchievement, workOrderTray, floorChoice, freshSeed, gradePrompt, kitWith, morningPlan, newSemester, NIGHT_PLANS, nightPlan, patrolOffer, patrolResultLine, projectPrompt, REST_PLANS, resumeSemester, semesterCleared, servesAlcohol, settingLines,
  latestReading, readingPrompt, TUTORIAL_COURSES, TUTORIAL_SEED, tutorLine, visitReport, walkPrompt, weekdayOf, welfareCaption, welfareText,
  type CoffeePlanId, type NightPlanId, type RestPlanId,
} from '../../app/semester.ts';
import { musicFor, UI } from '../../app/audio.ts';
import { AUDIO, fillStr, REPORT, str } from '../../app/content.ts';
import { keepPage } from '../../app/handbook.ts';
import { patrolChapter, patrolLoop, type PatrolSession } from '../../app/patrol.ts';
import type { SaveStore } from '../../app/storage.ts';
import {
  advanceDay, buildWall, earnedAchievements, isCareerNode, yearEndPoints, gradeRoom, MAX_DEBUG_PER_NIGHT, MAX_RANK_HOURS, nightRoom, pinWall, projectRoom, rankGain, RANK_FULL, rankSharePercent, reviewWall, RUN, WRITE_HOURS, type Answer, type Ask, type ChapterContent, type DayView, type FloorId, type HomeworkView, type PatrolKit, type PatrolResult, type ProgressData, type ReportDocument, type RunData,
  type AchievementId, type SemesterContext, type SemesterRun, type SemesterState, type SettingId, type Settings, type TagState, type Wall,
} from '../../core/index.ts';
import { WALL_CHAPTER, wallLoop, type WallSession } from '../../app/wall.ts';
import { playCue, soundIn } from '../audio/installSound.ts';
import { addText, updateText } from '../text/fonts.ts';
import { CardTable } from '../ui/cardTable.ts';
import { drawLiverStop, ElevatorPanelView } from '../ui/elevatorPanel.ts';
import { primary } from '../ui/primary.ts';

const DIM = '#c9d3e3';
const PAPER = '#fbfaf6';
const INK = '#0c2d5e';
/** The report sheet of art direction 8.5: 720 wide, a 64 px binding margin on the left, 8 px hard shadow; at most 640 tall. */
const SHEET = { y: 24, w: 720, h: 624, binding: 64, pad: 24, top: 28, footer: 40, shadow: 8 };
/** The commendation of art direction 9: a 640 x 440 square-cornered document with the company's 120 x 120 seal. */
const COMMEND = { w: 640, h: 440, pad: 40, seal: 120 };
const STAMP_RED = 0xc8372d;
const STAMP_RED_CSS = '#c8372d';
/** How long a chosen card stays highlighted before the next question, so the choice is seen. */
const CHOSEN_MS = 220;
/** After the wall closes, Esc is ignored this long so a double press does not also leave the semester. */
const ESC_GUARD_MS = 600;
const CONFIRM = ['Enter', 'NumpadEnter', 'KeyJ', 'KeyE', 'Space'];
const PREV = ['KeyW', 'KeyA', 'ArrowUp', 'ArrowLeft'];
const NEXT = ['KeyS', 'KeyD', 'ArrowDown', 'ArrowRight'];
const PICK = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];
const PICK_PAD = ['Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5'];

export interface SemesterData {
  /** Fixes the semester's events; a new game takes it from the clock. */
  readonly seed?: number;
  /** Dev builds only: the days the barbecue falls on, in place of the ones the seed deals. */
  readonly bbqDays?: readonly number[];
  /** A saved run to go on with, already checked by `resumeSemester`; it replaces `seed`. */
  readonly resume?: SemesterRun;
  /** The cards picked on the course scene, for a new semester; the scripted first week takes its own list. */
  readonly courses?: readonly string[];
  /** The overtime clause level picked on the course scene; absent is level 0. */
  readonly clause?: number;
  /** The presentation's demo save: played from the run given in `resume`, but never written to the run slot or counted. */
  readonly demo?: boolean;
}

/** Whatever is on screen that a choice is made from: a row of cards or the elevator panel. */
interface Menu {
  readonly n: number;
  paint(cursor: number): void;
  destroy(): void;
  /** Whether the choice at `i` may be taken; a floor already patrolled may not be patrolled again as overtime. */
  allowed(i: number): boolean;
  choose(i: number): void;
}

/**
 * Semester mode (design doc 8): the day's questions in the order the rules ask them, one screen
 * each. Like the title it runs outside the chapter loop. Every answer goes to `advanceDay`, which
 * replays the day with it, so the choices here and a strategy in `sim/` play the same rules. The
 * brain and liver patrols are played in the rooms; a floor without rooms draws its grade from an
 * abstract skill (app/semester.ts).
 */
export class SemesterScene extends Phaser.Scene {
  private ctx!: SemesterContext;
  private seed = 0;
  private state!: SemesterState;
  private answers: Answer[] = [];
  /** The answers of the days already finished, which is what the save holds. */
  private finished: (readonly Answer[])[] = [];
  /** Whether the run is written to the run slot; see `create`. */
  private keep = true;
  private menu: Menu | undefined;
  private cursor = 0;
  private busy = false;
  /** What Enter does when no menu is up: go on from the day or the semester summary. */
  private onContinue: (() => void) | undefined;
  private head: Phaser.GameObjects.Text | undefined;
  /** The career tree nodes owned when the semester began, kept in its save so it replays with the same schedule. */
  private career: readonly string[] = [];
  /** The setting card picked with 多一種開局卡, which the saved run keeps so it replays with the same one. */
  private setting: string | undefined;
  /** Handbook pages known when the scene opened; the year-end points count the ones found after. */
  private pagesAtStart = 0;
  /** The year-end points banked for this semester so far. */
  private banked = 0;
  /** The last reading of the liver whose report was shown, as day and reader, so a report comes once, right after the reading. */
  private readingShown: string | undefined;
  /** The latest reading of the liver, at the top right of every phase once there is one. */
  private readingLine: Phaser.GameObjects.Text | undefined;
  private lines: Phaser.GameObjects.GameObject[] = [];
  /** Until this time (scene clock) Esc does not leave the semester: the Esc that closed the wall must not also close this. */
  private escGuardUntil = 0;
  /** What Esc does instead of leaving, while that would skip a step the semester's end must not lose. */
  private escape: (() => void) | undefined;

  constructor() {
    super('Semester');
  }

  /** The elevator music; a patrol or the wall plays its own while this scene sleeps, so it is asked for again on waking. */
  private music(): void {
    soundIn(this)?.music(musicFor(AUDIO, { scene: this.scene.key }));
  }

  create(data: SemesterData): void {
    this.music();
    const back = data.resume === undefined ? undefined : resumeSemester(data.resume);
    if (data.resume !== undefined && back === undefined) throw new Error('the title offered a semester save that no longer replays');
    const done = (this.registry.get('progress') as ProgressData | undefined)?.semestersDone ?? 1;
    const seed = data.resume?.seed ?? data.seed ?? freshSeed(done, Date.now());
    // The scripted first week has its course list; any other new semester has the picks of the course scene, and a dev one none.
    const courses = data.courses ?? (data.seed === undefined && seed === TUTORIAL_SEED ? [...TUTORIAL_COURSES] : undefined);
    // A run fixed from the URL is for looking at the rules and must not replace the player's save; nor may the demo.
    this.keep = data.seed === undefined && data.bbqDays === undefined && data.demo !== true;
    const progress = this.registry.get('progress') as ProgressData | undefined;
    // The career tree shapes only the player's own semesters, so a dev or demo run plays the schedule its seed deals.
    // A resumed run replays with the nodes it saved, and a save without them began with none, whatever was bought since.
    this.career = data.resume !== undefined ? (data.resume.career ?? []) : this.keep ? (progress?.career ?? []).filter(isCareerNode) : [];
    this.pagesAtStart = progress?.handbook.length ?? 0;
    this.banked = 0;
    const begin = (setting?: SettingId): void => {
      const fresh = back ?? newSemester(seed, data.bbqDays, courses, data.clause, this.career, setting);
      this.ctx = fresh.ctx;
      this.state = fresh.state;
      this.setting = data.resume?.setting ?? setting;
    };
    begin();
    // 多一種開局卡 asks for the card before the first morning; a resumed run has its pick saved.
    const choices = back === undefined && this.keep ? settingChoices(seed, courses, data.clause ?? 0, this.career) : [];
    this.seed = seed;
    this.finished = data.resume === undefined ? [] : [...data.resume.days];
    this.answers = [];
    this.menu = undefined;
    this.cursor = 0;
    this.busy = false;
    this.onContinue = undefined;
    this.lines = [];
    this.head = undefined;
    this.readingLine = undefined;
    // Phaser keeps one scene object for every semester of the page's life, so what was shown belongs to the last one.
    this.readingShown = undefined;
    this.escGuardUntil = 0;
    this.escape = undefined;
    addText(this, this.scale.width / 2, this.scale.height - 40, str(data.demo === true ? 'semester.hint.demo' : 'semester.hint'), { role: 'print', weight: 400, size: 18, color: DIM }).setOrigin(0.5, 1);

    const onKey = (e: KeyboardEvent) => {
      // Leaving keeps the save of the last finished day; the hint line says so.
      if (e.code === 'Escape') return performance.now() < this.escGuardUntil ? undefined : (this.escape ?? (() => this.leave()))();
      if (e.repeat || this.busy) return;
      if (this.menu === undefined) {
        if (CONFIRM.includes(e.code)) this.proceed();
        return;
      }
      if (PREV.includes(e.code)) this.move(-1);
      else if (NEXT.includes(e.code)) this.move(1);
      else if (CONFIRM.includes(e.code)) this.choose(this.cursor);
      else {
        const i = Math.max(PICK.indexOf(e.code), PICK_PAD.indexOf(e.code));
        if (i >= 0 && i < this.menu.n) this.choose(i);
      }
    };
    // A click goes on from a text page; on a menu the cards and plates take it.
    const onClick = primary(() => {
      if (this.menu === undefined && !this.busy) this.proceed();
    });
    this.input.keyboard?.on('keydown', onKey);
    this.input.on('pointerdown', onClick);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown', onKey);
      this.input.off('pointerdown', onClick);
      this.clear();
    });
    if (choices.length === 0) return this.ask();
    this.cards(choices, str('semester.setting.pick.title'), str('semester.setting.pick.caption'), (i) => {
      begin(choices[i]!.id);
      this.ask();
    });
  }

  /**
   * The investigation wall of design doc 8.11, a room the player walks through before the report, or
   * the year-end review of a passed semester before the end page (build plan: evidence wall). The semester sleeps while the World and the HUD run the wall
   * chapter; taking the page from the report desk, or Esc, wakes it and goes on with `go`.
   */
  private showWall(make: () => Wall, go: () => void, onPage?: () => void): void {
    const base = (this.registry.get('chapters') as ReadonlyMap<string, ChapterContent> | undefined)?.get(WALL_CHAPTER);
    let session: { wall: Wall; loop: ReturnType<typeof wallLoop>['loop'] };
    try {
      if (!base) throw new Error(`the ${WALL_CHAPTER} chapter is not loaded`);
      const wall = make();
      const { ctx, loop } = wallLoop(base, wall.unlock);
      // The board throws on a node with no slot; find that here, while the report can still be shown without the wall.
      pinWall(wall, ctx.rooms.get(ctx.chapter.start)!.objects);
      session = { wall, loop };
    } catch (err) {
      // Like the report itself, the wall is an addition: if it cannot be built the report is still shown.
      console.error('evidence wall skipped:', err);
      return go();
    }
    this.registry.set('loop', session.loop);
    this.registry.set('wall', {
      wall: session.wall,
      ...(onPage ? { onPage } : {}),
      done: () => {
        this.registry.set('loop', undefined);
        this.events.once(Phaser.Scenes.Events.WAKE, () => {
          this.music();
          // Held input: the key that closed the wall must not also turn the first page of the report or leave the semester.
          this.busy = true;
          // Wall-clock time: a sleeping scene's clock stands still, so 	his.time.now would be stale right after the wake.
          this.escGuardUntil = performance.now() + ESC_GUARD_MS;
          this.time.delayedCall(CHOSEN_MS, () => {
            this.busy = false;
          });
          go();
        });
        this.scene.wake();
      },
    } satisfies WallSession);
    this.scene.sleep();
    this.scene.launch('World');
    this.scene.launch('Hud');
  }

  private leave(): void {
    this.onContinue = undefined;
    window.setTimeout(() => this.scene.start('Title'), 0);
  }

  /** Goes on from a text page, and holds input for a moment so a second tap does not answer the next question. */
  private proceed(): void {
    const go = this.onContinue;
    if (go === undefined) return;
    this.onContinue = undefined;
    this.busy = true;
    this.time.delayedCall(CHOSEN_MS, () => {
      this.busy = false;
    });
    go();
  }

  private get textScale(): number {
    return (this.registry.get('settings') as Settings | undefined)?.textScale ?? 1;
  }

  /** The next question of the day, or the day's end when the answers so far cover it. */
  private ask(): void {
    const step = advanceDay(this.state, this.ctx, this.answers);
    if (step.done) return this.endOfDay(step.state);
    this.show(step.ask);
  }

  private answer(a: Answer): void {
    this.busy = true;
    this.answers.push(a);
    this.time.delayedCall(CHOSEN_MS, () => {
      this.busy = false;
      this.ask();
    });
  }

  private banner(view: DayView, phase: string): void {
    this.head?.destroy();
    this.showReading(view.liverReading);
    const weekday = str(`semester.weekday.${weekdayOf(view.day)}`);
    const day = fillStr('semester.day', { n: view.day, weekday });
    const exam = view.exam === null ? '' : `　${str(`semester.exam.${view.exam}`)}`;
    this.head = addText(this, 32, 24, `${day}　${str(`semester.phase.${phase}`)}${exam}`, { role: 'print', weight: 700, size: 22, color: DIM });
  }

  private showReading(reading: DayView['liverReading']): void {
    this.readingLine?.destroy();
    const latest = latestReading(reading);
    this.readingLine = latest === undefined ? undefined : addText(this, this.scale.width - 32, 28, latest, { role: 'print', weight: 400, size: 18, color: DIM }).setOrigin(1, 0);
  }

  private show(ask: Ask): void {
    const reading = ask.view.liverReading;
    const key = reading && `${reading.day}:${reading.by}`;
    // The highlighter's reading is the figure over the liver in the patrol's rooms, which is its report.
    if (reading !== undefined && reading.day === ask.view.day && reading.by !== 'highlighter' && this.readingShown !== key) {
      this.readingShown = key;
      this.banner(ask.view, reading.by === 'checkup' ? 'plan' : 'event');
      const { title, caption, options } = readingPrompt({ load: reading.load, by: reading.by });
      return this.cards(options, title, caption, () => this.show(ask));
    }
    switch (ask.kind) {
      case 'plan': return this.askCoffee(ask.view);
      case 'event': return this.askEvent(ask.view, ask.id, ask.options);
      case 'floor': return this.askFloor(ask.view, ask.tags, ask.liverLoad);
      case 'night': return this.askNight(ask.view);
    }
  }

  private cards(labels: readonly { label: string; note: string }[], title: string, caption: string | undefined, pick: (i: number) => void): void {
    this.clear();
    const table = new CardTable(this, { ...(caption ? { caption } : {}), title, options: labels }, this.textScale, (i) => this.choose(i), (i) => this.select(i));
    this.menu = { n: labels.length, paint: (c) => table.paint(c), destroy: () => table.destroy(), allowed: () => true, choose: pick };
    this.start(0);
  }

  private askCoffee(view: DayView): void {
    this.banner(view, 'plan');
    const ids = Object.keys(COFFEE_PLANS) as CoffeePlanId[];
    const caption = [tutorLine(this.seed, view.day), ...settingLines(this.ctx, view.day)].filter((l): l is string => l !== undefined).join('\n');
    this.cards(ids.map((id) => ({ label: str(`semester.coffee.${id}`), note: str(`semester.coffee.${id}.note`) })), str('semester.coffee.title'), caption === '' ? undefined : caption, (i) => {
      this.askRest(view, ids[i]!);
    });
  }

  private askRest(view: DayView, coffee: CoffeePlanId): void {
    const ids = Object.keys(REST_PLANS) as RestPlanId[];
    this.cards(ids.map((id) => ({ label: str(`semester.rest.${id}`), note: str(`semester.rest.${id}.note`) })), str('semester.rest.title'), undefined, (i) => {
      const rest = ids[i]!;
      const writing = view.homework.find((h) => h.written < WRITE_HOURS);
      // The assignment, the grading, the compiler project and the walk are asked in turn, each only when the day has it.
      const afterWrite = (write: number): void => {
        const afterGrade = (grade: number): void => {
          if (view.project === undefined) return this.answer({ kind: 'plan', plan: morningPlan(coffee, rest, write, 0, false, grade) });
          const askWalk = (project: number): void => this.askWalk((walk) => this.answer({ kind: 'plan', plan: morningPlan(coffee, rest, write, project, walk, grade) }));
          if (!view.project.open) return askWalk(0);
          const room = projectRoom(this.ctx.params, this.ctx.courses, view.day, view.wake, view.exam !== null, REST_PLANS[rest], write + grade, this.ctx.setting?.commitments);
          this.askProject(view.project, room, askWalk);
        };
        if (view.grade?.open !== true) return afterGrade(0);
        const room = gradeRoom(this.ctx.params, this.ctx.courses, view.day, view.wake, view.exam !== null, REST_PLANS[rest], write, view.grade.done, this.ctx.setting?.commitments);
        if (room === 0) return afterGrade(0);
        this.askGrade(view.grade, false, room, afterGrade);
      };
      if (writing === undefined) return afterWrite(0);
      this.askWrite(writing, afterWrite);
    });
  }

  /** `room` is how many hours the plan so far leaves for the project, so the cards offer no more than the day has. */
  private askProject(project: NonNullable<DayView['project']>, room: number, done: (hours: number) => void): void {
    const hours = Array.from({ length: room + 1 }, (_, n) => n);
    const labels = hours.map((n) => (n === 0
      ? { label: str('semester.project.none'), note: str('semester.project.none.note') }
      : { label: fillStr('semester.project.hours', { hours: n }), note: fillStr('semester.project.hours.note', { hours: n }) }));
    const { title, caption } = projectPrompt(project, room, this.ctx.params);
    this.cards(labels, title, caption, (i) => done(hours[i]!));
  }

  /** `room` is how many hours the plan so far leaves for the grading of the TA line, so the cards offer no more than the day or the night has. */
  private askGrade(grade: NonNullable<DayView['grade']>, night: boolean, room: number, done: (hours: number) => void): void {
    const hours = Array.from({ length: room + 1 }, (_, n) => n);
    const kind = night ? 'gradenight' : 'grade';
    const labels = hours.map((n) => (n === 0
      ? { label: str(`semester.${kind}.none`), note: str(`semester.${kind}.none.note`) }
      : { label: fillStr(`semester.${kind}.hours`, { hours: n }), note: fillStr(`semester.${kind}.hours.note`, { hours: n }) }));
    const { title, caption } = gradePrompt(grade, night, room);
    this.cards(labels, title, caption, (i) => done(hours[i]!));
  }

  private askWalk(done: (walk: boolean) => void): void {
    const { title, caption, options } = walkPrompt();
    this.cards(options, title, caption, (i) => done(i === 1));
  }

  /** How many of the hours the assignment still needs to write go to it today. */
  private askWrite(hw: HomeworkView, done: (hours: number) => void): void {
    const hours = Array.from({ length: WRITE_HOURS - hw.written + 1 }, (_, n) => n);
    const labels = hours.map((n) => (n === 0
      ? { label: str('semester.write.none'), note: str('semester.write.none.note') }
      : { label: fillStr('semester.write.hours', { hours: n }), note: fillStr('semester.write.hours.note', { hours: n }) }));
    this.cards(labels, fillStr('semester.write.title', { n: hw.n, due: hw.due }), fillStr('semester.write.caption', { written: hw.written, total: WRITE_HOURS }), (i) => done(hours[i]!));
  }

  private askEvent(view: DayView, id: string, options: readonly string[]): void {
    this.banner(view, 'event');
    const labels = options.map((o) => ({ label: str(`semester.event.${id}.${o}`), note: str(`semester.event.${id}.${o}.note`) }));
    this.cards(labels, str(`semester.event.${id}.title`), servesAlcohol(id) ? str('semester.alcohol.notice') : undefined, (i) => {
      this.answer({ kind: 'event', option: options[i]! });
    });
  }

  /** The elevator, then the rooms of the floor chosen, and only after those the offer of overtime, so it is made knowing how the first went (design doc 8.4). */
  private askFloor(view: DayView, tags: TagState, liverLoad: number): void {
    this.banner(view, 'floor');
    // The rules take the highlighter's reading only with the whole floor answer, so the screens until then show it from here.
    const read = (result: PatrolResult | null): void => {
      if (result?.liverRead === true) this.showReading({ day: view.day, by: 'highlighter', load: liverLoad });
    };
    // 主動健檢 puts the liver's work-order tray in the lobby (design doc 8.6, 8.14).
    const progress = this.registry.get('progress') as ProgressData | undefined;
    const details = this.career.includes('order_details') ? view.workOrders : undefined;
    const tray = hasAchievement(progress, 'active_checkup') ? workOrderTray(view.liverClues.orders, details) : undefined;
    const pickFloor = () => this.panel(view, str('semester.floor.title'), undefined, tray, (patrol) => {
      this.playPatrol(patrol, tags, liverLoad, view.day * 2, view.welfare.kit, (first) => {
        read(first);
        this.askCard(view, patrol, first, (card, reroll) => {
          this.cards(
            [
              { label: str('semester.overtime.none'), note: str('semester.overtime.none.note') },
              { label: str('semester.overtime.yes'), note: str('semester.overtime.yes.note') },
            ],
            str('semester.floor.overtime.title'), first === null ? undefined : patrolResultLine(patrol, first),
            (i) => {
              if (i === 0) return this.answer({ kind: 'floor', choice: floorChoice(patrol, undefined, [first], card, reroll) });
              this.panel(view, str('semester.floor.overtime.again'), patrol, tray, (overtime) => {
                this.playPatrol(overtime, tags, liverLoad, view.day * 2 + 1, kitWith(view, card), (second) => {
                  read(second);
                  this.answer({ kind: 'floor', choice: floorChoice(patrol, overtime, [first, second], card, reroll) });
                });
              });
            },
          );
        });
      });
    });
    if (view.liverClues.elevatorStops) this.showLiverStop(pickFloor);
    else pickFloor();
  }

  private showLiverStop(go: () => void): void {
    this.clear();
    const cx = this.scale.width / 2;
    const scale = this.textScale;
    this.lines.push(
      drawLiverStop(this),
      addText(this, cx, 120, str('semester.floor.liver_stop'), { role: 'hand', weight: 700, size: 36 * scale, color: PAPER }).setOrigin(0.5),
      addText(this, cx, 478, str('semester.floor.liver_typing'), { role: 'print', weight: 400, size: 26 * scale, color: PAPER }).setOrigin(0.5),
      addText(this, cx, 536, str('semester.floor.liver_continue'), { role: 'print', weight: 700, size: 20 * scale, color: DIM }).setOrigin(0.5),
    );
    this.onContinue = go;
    playCue(this, UI.liverTyping);
  }

  /**
   * The welfare cards a rated patrol offers (design doc 8.8): one is picked and kept to the end of the semester. No offer, no
   * screen. With 開局重抽 the offer ends in a card that draws it again once a semester, and the card is then picked from that.
   */
  private askCard(view: DayView, floor: FloorId, first: PatrolResult | null, done: (card: string | undefined, reroll: boolean) => void): void {
    const offer = patrolOffer(view, this.ctx, floor, first);
    if (first === null || offer.length === 0) return done(undefined, false);
    const caption = [patrolResultLine(floor, first), welfareCaption(view.welfare.held)].join('\n');
    const again = rerollOffer(view, this.ctx, floor, first, offer);
    const reroll = again.length > 0 ? [{ label: str('semester.welfare.reroll'), note: str('semester.welfare.reroll.note') }] : [];
    this.cards([...offer.map(welfareText), ...reroll], str('semester.welfare.title'), caption, (i) => {
      if (i < offer.length) return done(offer[i]!, false);
      this.cards(again.map(welfareText), str('semester.welfare.title'), caption, (j) => done(again[j]!, true));
    });
  }

  /**
   * The rooms of a floor's patrol, played on the World and the HUD while the semester sleeps (as the evidence wall is). A floor with
   * no rooms of its own, or rooms that cannot be built, hands back null and the rules draw its rating from the skill.
   */
  private playPatrol(floor: FloorId, tags: TagState, liverLoad: number, salt: number, kit: PatrolKit, done: (result: PatrolResult | null) => void): void {
    const base = patrolChapter(this.registry.get('chapters') as ReadonlyMap<string, ChapterContent>, floor);
    if (base === undefined) return done(null);
    let play: ReturnType<typeof patrolLoop>;
    try {
      play = patrolLoop(base, floor, tags, this.seed + salt, undefined, kit);
    } catch (err) {
      console.error('patrol skipped:', err);
      return done(null);
    }
    this.registry.set('loop', play.loop);
    this.registry.set('patrol', {
      floor,
      play,
      liverLoad,
      done: (result) => {
        this.registry.set('loop', undefined);
        this.events.once(Phaser.Scenes.Events.WAKE, () => {
          this.music();
          // Held input: the key that closed the rooms must not also pick the first card.
          this.busy = true;
          this.escGuardUntil = performance.now() + ESC_GUARD_MS;
          this.time.delayedCall(CHOSEN_MS, () => {
            this.busy = false;
          });
          done(result);
        });
        this.scene.wake();
      },
    } satisfies PatrolSession);
    this.scene.sleep();
    this.scene.launch('World');
    this.scene.launch('Hud');
  }

  private panel(view: DayView, title: string, disabled: FloorId | undefined, tray: string | undefined, pick: (floor: FloorId) => void): void {
    this.clear();
    const panel = new ElevatorPanelView(this, view.panel, { title, ...(tray === undefined ? {} : { tray }) }, disabled, (i) => this.choose(i), (i) => this.select(i));
    this.menu = {
      n: view.panel.buttons.length,
      paint: (c) => panel.paint(c),
      destroy: () => panel.destroy(),
      allowed: (i) => !panel.isDisabled(i),
      choose: (i) => pick(panel.floorAt(i)!),
    };
    this.start(Math.max(0, view.panel.buttons.findIndex((b) => b.floor !== disabled)));
  }

  private askNight(view: DayView): void {
    this.banner(view, 'night');
    const ids = Object.keys(NIGHT_PLANS) as NightPlanId[];
    const title = str(view.examTomorrow ? 'semester.night.exam.title' : 'semester.night.title');
    this.cards(ids.map((id) => ({ label: str(`semester.night.${id}`), note: str(`semester.night.${id}.note`) })), title, undefined, (i) => {
      const bed = ids[i]!;
      // Debugging is asked once the writing is done, which is also when its length is told (design doc 8.3); the grading and the contest follow on their nights.
      const debugging = view.homework.find((h) => h.debug !== undefined);
      // Each only offers the hours that still fit before the clock stops (nightRoom), so a card never promises a delay the night cannot give.
      const room = (spent: number): number => nightRoom(this.ctx.params, NIGHT_PLANS[bed].bed, view.bedDelay + spent);
      const finish = (debug: number, grade: number): void => {
        const most = Math.min(MAX_RANK_HOURS, room(debug + grade));
        if (!view.rank?.open || most === 0) return this.answer({ kind: 'night', plan: nightPlan(bed, debug, 0, grade) });
        this.askRank(view, most, (hours) => this.answer({ kind: 'night', plan: nightPlan(bed, debug, hours, grade) }));
      };
      const afterDebug = (debug: number): void => {
        const grading = view.grade;
        const most = grading?.night === true ? Math.min(grading.need - grading.done, room(debug)) : 0;
        if (grading === undefined || most === 0) return finish(debug, 0);
        this.askGrade(grading, true, most, (grade) => finish(debug, grade));
      };
      const most = debugging?.debug === undefined ? 0 : Math.min(MAX_DEBUG_PER_NIGHT, debugging.debug - debugging.debugged, room(0));
      if (debugging?.debug === undefined || most === 0) return afterDebug(0);
      this.askDebug(debugging, debugging.debug, most, afterDebug);
    });
  }

  private askRank(view: DayView, most: number, done: (hours: number) => void): void {
    const hours = Array.from({ length: most + 1 }, (_, n) => n);
    const labels = hours.map((n) => (n === 0
      ? { label: str('semester.rank.none'), note: str('semester.rank.none.note') }
      : { label: fillStr('semester.rank.hours', { hours: n }), note: fillStr('semester.rank.hours.note', { hours: n, gain: rankGain(n, view.S).toFixed(1) }) }));
    const caption = fillStr('semester.rank.caption', { score: (view.rank?.score ?? 0).toFixed(1), full: RANK_FULL, share: rankSharePercent });
    this.cards(labels, str('semester.rank.title'), caption, (i) => done(hours[i]!));
  }

  private askDebug(hw: HomeworkView, total: number, most: number, done: (hours: number) => void): void {
    const hours = Array.from({ length: most + 1 }, (_, n) => n);
    const labels = hours.map((n) => (n === 0
      ? { label: str('semester.debug.none'), note: str('semester.debug.none.note') }
      : { label: fillStr('semester.debug.hours', { hours: n }), note: fillStr('semester.debug.hours.note', { hours: n }) }));
    this.cards(labels, fillStr('semester.debug.title', { n: hw.n }), fillStr('semester.debug.caption', { debug: total, spent: hw.debugged }), (i) => done(hours[i]!));
  }

  private select(i: number): void {
    if (this.busy || !this.menu?.allowed(i)) return;
    this.cursor = i;
    this.menu.paint(i);
  }

  /**
   * Puts the cursor on the first card of a menu just built. Unlike `select` it does not wait for `busy`: the page that goes on to
   * a question is still busy then, and a cursor left where the last menu had it could point past the cards of this one.
   */
  private start(i: number): void {
    this.cursor = i;
    this.menu?.paint(i);
  }

  private move(step: number): void {
    const menu = this.menu;
    if (!menu) return;
    for (let k = 1; k <= menu.n; k++) {
      const next = (this.cursor + step * k + menu.n * k) % menu.n;
      if (menu.allowed(next)) return this.select(next);
    }
  }

  private choose(i: number): void {
    const menu = this.menu;
    if (this.busy || !menu?.allowed(i)) return;
    this.select(i);
    menu.choose(i);
  }

  private clear(): void {
    this.menu?.destroy();
    this.menu = undefined;
    this.lines.forEach((o) => o.destroy());
    this.lines = [];
  }

  /** A screen of text lines, left until Enter. The lines close up when there are too many for the prompt to stay on the canvas. */
  private page(title: string, lines: readonly string[], next: string, go: () => void): void {
    this.clear();
    const step = Math.min(48, Math.floor((this.scale.height - 230 - 80) / Math.max(1, lines.length)));
    this.lines.push(addText(this, this.scale.width / 2, 130, title, { role: 'hand', weight: 700, size: 44, color: PAPER }).setOrigin(0.5, 0));
    lines.forEach((line, i) => {
      this.lines.push(addText(this, this.scale.width / 2, 230 + i * step, line, { role: 'print', weight: 400, size: 26, color: PAPER }).setOrigin(0.5, 0));
    });
    this.lines.push(addText(this, this.scale.width / 2, 230 + lines.length * step + 40, next, { role: 'print', weight: 700, size: 22, color: DIM }).setOrigin(0.5, 0));
    this.onContinue = go;
  }

  /**
   * A report of the emergency room as a paper sheet, over as many pages as the text needs at the
   * current text size. The handbook page it unlocks is kept when the sheet is first shown.
   */
  private report(doc: ReportDocument, progress: ProgressData, saves: SaveStore, go: () => void): void {
    this.clear();
    const scale = this.textScale;
    const size = 18 * scale;
    const sheetX = (this.scale.width - SHEET.w) / 2;
    const textX = sheetX + SHEET.binding + SHEET.pad;
    const width = SHEET.w - SHEET.binding - 2 * SHEET.pad;
    const limit = SHEET.y + SHEET.h - SHEET.footer * scale;
    const own = (o: Phaser.GameObjects.GameObject) => {
      this.lines.push(o);
      return o;
    };
    own(this.add.rectangle(sheetX + SHEET.shadow, SHEET.y + SHEET.shadow, SHEET.w, SHEET.h, 0x000000, 0.45).setOrigin(0, 0));
    own(this.add.rectangle(sheetX, SHEET.y, SHEET.w, SHEET.h, 0xf4efe4).setOrigin(0, 0).setStrokeStyle(2, 0x0c2d5e));
    own(this.add.rectangle(sheetX + SHEET.binding, SHEET.y + 12, 2, SHEET.h - 24, 0x0c2d5e, 0.35).setOrigin(0, 0));
    for (const hy of [SHEET.y + SHEET.h * 0.25, SHEET.y + SHEET.h * 0.75]) own(this.add.circle(sheetX + SHEET.binding / 2, hy, 9, 0x2a3a52));

    // Every paragraph is made first and measured, then dealt onto pages, so a page break never cuts a paragraph
    // unless one alone is taller than a page; that one is cut between its own lines.
    const pages: Phaser.GameObjects.Text[][] = [[]];
    const top = SHEET.y + SHEET.top;
    const capacity = limit - top;
    let y = top;
    const make = (line: string, i: number): Phaser.GameObjects.Text => {
      const t = own(addText(this, textX, 0, line, {
        role: i === 0 ? 'hand' : 'print', weight: i === 0 ? 700 : 400, size: i === 0 ? size * 1.2 : size, color: INK, maxWidth: width, lineHeight: 1.45,
      })) as Phaser.GameObjects.Text;
      return t.setVisible(false);
    };
    const place = (t: Phaser.GameObjects.Text): void => {
      if (y + t.height > limit && pages[pages.length - 1]!.length > 0) {
        pages.push([]);
        y = top;
      }
      t.setY(y);
      y += t.height + 6 * scale;
      pages[pages.length - 1]!.push(t);
    };
    doc.lines.forEach((line, i) => {
      if (line === '') {
        y += size * 0.7;
        return;
      }
      const t = make(line, i);
      if (t.height <= capacity) return place(t);
      // Fill what is left of this page first, then whole pages; the rows are already wrapped, so wrapping again keeps them as they are.
      const rows = t.text.split('\n');
      const rowHeight = t.height / rows.length;
      for (let from = 0; from < rows.length;) {
        let room = Math.floor((limit - y) / rowHeight);
        if (room < 1) {
          pages.push([]);
          y = top;
          room = Math.floor(capacity / rowHeight);
        }
        const part = from === 0 ? t : make('　', i);
        updateText(part, rows.slice(from, from + room).join('\n'));
        place(part);
        from += room;
      }
    });
    const foot = own(addText(this, sheetX + SHEET.w - SHEET.pad, SHEET.y + SHEET.h - 14, str('semester.sum.next'), {
      role: 'print', weight: 700, size: 18 * scale, color: INK,
    }).setOrigin(1, 1)) as Phaser.GameObjects.Text;
    const showPage = (n: number): void => {
      pages.forEach((p, i) => p.forEach((t) => t.setVisible(i === n)));
      const last = n === pages.length - 1;
      updateText(foot, last ? str('semester.sum.next') : fillStr('semester.report.more', { n: n + 1, total: pages.length }));
      this.onContinue = last ? go : () => showPage(n + 1);
    };
    showPage(0);
    this.keepReportPage(doc.unlock, progress, saves);
  }

  private keepReportPage(id: string, progress: ProgressData, saves: SaveStore): void {
    const kept = keepPage(saves, progress, id);
    if (kept.issues.length > 0) this.game.events.emit('save-issues', kept.issues);
    this.registry.set('progress', kept.progress);
  }

  /**
   * Written when the player goes on from a day's pages, not when the day is played: the close-out
   * report and the page it unlocks come before it, so a reload during them replays the day instead
   * of skipping them.
   */
  private persist(semester: SemesterRun | null): void {
    const saves = this.registry.get('saves') as SaveStore | undefined;
    if (!this.keep || saves === undefined) return;
    const run: RunData = { semester };
    const issues = saves.save(RUN, run);
    if (issues.length > 0) this.game.events.emit('save-issues', issues);
    this.registry.set('run', run);
  }

  /**
   * A semester fixed from the URL does not count, so looking at the rules never ends the scripted first week and earns nothing.
   * Gives the clause level the clear just unlocked, if it did, and the achievements earned for the first time.
   */
  private countSemester(after: SemesterState): { opened?: number; commended: AchievementId[]; pages: number } {
    const progress = this.registry.get('progress') as ProgressData | undefined;
    const saves = this.registry.get('saves') as SaveStore | undefined;
    if (!this.keep || progress === undefined || saves === undefined) return { commended: [], pages: 0 };
    // A semester resumed from its save counts only the pages found since, which is short by the ones found before the break.
    const pages = Math.max(0, progress.handbook.length - this.pagesAtStart);
    const points = yearEndPoints(after, this.ctx, pages);
    this.banked = points;
    const done = finishSemester(saves, progress, { level: this.ctx.clause ?? 0, cleared: semesterCleared(after, this.ctx) }, earnedAchievements(after, this.ctx), points);
    if (done.issues.length > 0) this.game.events.emit('save-issues', done.issues);
    this.registry.set('progress', done.progress);
    const unlocked = done.progress.clauseUnlocked ?? 0;
    return { ...(unlocked > (progress.clauseUnlocked ?? 0) ? { opened: unlocked } : {}), commended: done.commended, pages };
  }

  /**
   * The pages the semester found by now, with the points it banked topped up for any found since it was counted: the year-end
   * review wall hands one over after the count, which is made first so a page closed on the wall still keeps the semester's points.
   */
  private pagesFound(after: SemesterState, counted: number): number {
    const progress = this.registry.get('progress') as ProgressData | undefined;
    const saves = this.registry.get('saves') as SaveStore | undefined;
    if (!this.keep || progress === undefined || saves === undefined) return counted;
    const pages = Math.max(counted, progress.handbook.length - this.pagesAtStart);
    const more = yearEndPoints(after, this.ctx, pages) - this.banked;
    if (more <= 0) return pages;
    const done = bankPoints(saves, progress, more);
    if (done.issues.length > 0) this.game.events.emit('save-issues', done.issues);
    this.registry.set('progress', done.progress);
    this.banked += more;
    return pages;
  }

  /** The career tree (design doc 8.14): a node bought is saved at once and the tree shown again; the last card leaves. */
  private careerTree(done: () => void): void {
    const saves = this.registry.get('saves') as SaveStore | undefined;
    const progress = this.registry.get('progress') as ProgressData | undefined;
    this.escape = undefined;
    if (!this.keep || saves === undefined || progress === undefined) return done();
    const { title, caption, cards } = careerCards(progress);
    this.cards(cards, title, caption, (i) => {
      const node = cards[i]?.node;
      if (node === undefined) return done();
      const bought = buyCareerNode(saves, progress, node);
      if ('refused' in bought) return this.careerTree(done);
      if (bought.issues.length > 0) this.game.events.emit('save-issues', bought.issues);
      this.registry.set('progress', bought.progress);
      this.careerTree(done);
    });
    const menu = this.menu;
    if (menu === undefined) return;
    this.menu = { ...menu, allowed: (i) => cards[i]?.allowed === true };
    this.start(Math.max(0, cards.findIndex((c) => c.allowed)));
  }

  /** One commendation per achievement just earned, as the square-cornered document of art direction 9 with the company's seal. */
  private commend(ids: readonly AchievementId[], done: () => void): void {
    const [id, ...rest] = ids;
    if (id === undefined) return done();
    this.clear();
    const { title, lines } = commendation(id);
    const [name, why, unlock] = lines;
    const x = (this.scale.width - COMMEND.w) / 2;
    const y = (this.scale.height - COMMEND.h) / 2 - 24;
    const own = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      this.lines.push(o);
      return o;
    };
    own(this.add.rectangle(x + SHEET.shadow, y + SHEET.shadow, COMMEND.w, COMMEND.h, 0x000000, 0.45).setOrigin(0, 0));
    own(this.add.rectangle(x, y, COMMEND.w, COMMEND.h, 0xf4efe4).setOrigin(0, 0).setStrokeStyle(2, 0x0c2d5e));
    own(this.add.rectangle(x + COMMEND.pad, y + 84, COMMEND.w - 2 * COMMEND.pad, 2, 0x0c2d5e, 0.35).setOrigin(0, 0));
    own(addText(this, x + COMMEND.w / 2, y + 28, title, { role: 'hand', weight: 700, size: 32, color: INK }).setOrigin(0.5, 0));
    const width = COMMEND.w - 2 * COMMEND.pad;
    let at = y + 108;
    for (const [text, spec] of [
      [name, { role: 'hand', weight: 700, size: 26, color: INK }],
      [why, { role: 'print', weight: 400, size: 20, color: INK, maxWidth: width, lineHeight: 1.5 }],
      [unlock, { role: 'print', weight: 400, size: 18, color: INK, maxWidth: width - COMMEND.seal, lineHeight: 1.5 }],
    ] as const) {
      if (text === undefined) continue;
      at += own(addText(this, x + COMMEND.pad, at, text, spec)).height + 14;
    }
    const seal = own(this.add.container(x + COMMEND.w - COMMEND.pad - COMMEND.seal / 2, y + COMMEND.h - COMMEND.pad - COMMEND.seal / 2));
    const cell = (COMMEND.seal - 16) / 3;
    seal.add(this.add.rectangle(0, 0, COMMEND.seal, COMMEND.seal).setStrokeStyle(5, STAMP_RED));
    sealColumns().forEach((column, c) => column.forEach((ch, r) => {
      seal.add(addText(this, (1 - c) * cell, (r - 1) * cell, ch, { role: 'hand', weight: 700, size: Math.floor(cell * 0.86), color: STAMP_RED_CSS }).setOrigin(0.5));
    }));
    seal.setAngle(-6).setAlpha(0.86);
    own(addText(this, this.scale.width / 2, y + COMMEND.h + 28, str('semester.commend.back'), { role: 'print', weight: 700, size: 22, color: DIM }).setOrigin(0.5, 0));
    this.onContinue = () => this.commend(rest, done);
  }

  private endOfDay(after: SemesterState): void {
    const before = this.state;
    const lines = daySummary(before, after, this.ctx);
    const title = fillStr('semester.sum.title', { n: before.day });
    this.head?.destroy();
    this.head = undefined;
    this.readingLine?.destroy();
    this.readingLine = undefined;
    const next = (): void => {
      if (!after.ended) {
        this.state = after;
        this.finished.push(this.answers);
        this.answers = [];
        this.persist({
          seed: this.seed, ...(this.ctx.courses ? { courses: [...this.ctx.courses] } : {}), ...(this.ctx.clause ? { clause: this.ctx.clause } : {}),
          ...(this.career.length > 0 ? { career: [...this.career] } : {}), ...(this.setting !== undefined ? { setting: this.setting } : {}), days: this.finished,
        });
        this.ask();
        return;
      }
      this.persist(null);
      const { opened, commended, pages } = this.countSemester(after);
      const toEnd = (): void => {
        const found = this.pagesFound(after, pages);
        const leave = this.keep ? () => this.careerTree(() => this.leave()) : () => this.leave();
        // Esc from the commendation or the end page still passes through the career tree: nothing else opens it.
        this.escape = leave;
        this.commend(commended, () => this.page(str('semester.end.title'), endSummary(after, this.ctx, opened, found), str(this.keep ? 'semester.end.next' : 'semester.end.back'), leave));
      };
      let review: Wall | undefined;
      try {
        review = reviewWall(after, this.ctx, REPORT, str);
      } catch (err) {
        console.error('year-end review skipped:', err);
      }
      if (review === undefined) return toEnd();
      const wall = review;
      this.showWall(() => wall, toEnd, () => void this.pagesFound(after, pages));
    };
    // The report is an addition to the day summary: if it cannot be written, or there is nowhere to keep the page it
    // unlocks (Boot always sets both), the day goes on without it instead of leaving the screen half cleared.
    const progress = this.registry.get('progress') as ProgressData | undefined;
    const saves = this.registry.get('saves') as SaveStore | undefined;
    let doc: ReportDocument | undefined;
    if (progress !== undefined && saves !== undefined) {
      try {
        doc = visitReport(after, this.ctx, this.seed, new Set(progress.handbook));
      } catch (err) {
        console.error('close-out report skipped:', err);
      }
    }
    this.page(
      title, lines, str('semester.sum.next'),
      doc === undefined || progress === undefined || saves === undefined
        ? next
        : () => this.showWall(() => buildWall(doc, REPORT, str, after.liverOrders), () => this.report(doc, (this.registry.get('progress') as ProgressData | undefined) ?? progress, saves, next)),
    );
  }
}
