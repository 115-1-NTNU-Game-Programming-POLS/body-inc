import Phaser from 'phaser';
import {
  COFFEE_PLANS, daySummary, endSummary, floorChoice, morningPlan, newSemester, NIGHT_PLANS, nightPlan, REST_PLANS, servesAlcohol, visitReport, weekdayOf,
  type CoffeePlanId, type NightPlanId, type RestPlanId,
} from '../../app/semester.ts';
import { fillStr, REPORT, str } from '../../app/content.ts';
import { keepPage } from '../../app/handbook.ts';
import type { SaveStore } from '../../app/storage.ts';
import {
  advanceDay, buildWall, pinWall, reviewWall, type Answer, type Ask, type ChapterContent, type DayView, type FloorId, type ProgressData, type ReportDocument, type SemesterContext,
  type SemesterState, type Settings, type Wall,
} from '../../core/index.ts';
import { WALL_CHAPTER, wallLoop, type WallSession } from '../../app/wall.ts';
import { addText, updateText } from '../text/fonts.ts';
import { CardTable } from '../ui/cardTable.ts';
import { ElevatorPanelView } from '../ui/elevatorPanel.ts';

const DIM = '#c9d3e3';
const PAPER = '#fbfaf6';
const INK = '#0c2d5e';
/** The report sheet of art direction 8.5: 720 wide, a 64 px binding margin on the left, 8 px hard shadow; at most 640 tall. */
const SHEET = { y: 24, w: 720, h: 624, binding: 64, pad: 24, top: 28, footer: 40, shadow: 8 };
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
 * patrol itself is not played yet; its grade is drawn from an abstract skill (app/semester.ts).
 */
export class SemesterScene extends Phaser.Scene {
  private ctx!: SemesterContext;
  private seed = 0;
  private state!: SemesterState;
  private answers: Answer[] = [];
  private menu: Menu | undefined;
  private cursor = 0;
  private busy = false;
  /** What Enter does when no menu is up: go on from the day or the semester summary. */
  private onContinue: (() => void) | undefined;
  private head: Phaser.GameObjects.Text | undefined;
  private lines: Phaser.GameObjects.GameObject[] = [];
  /** Until this time (scene clock) Esc does not leave the semester: the Esc that closed the wall must not also close this. */
  private escGuardUntil = 0;

  constructor() {
    super('Semester');
  }

  create(data: SemesterData): void {
    const seed = data.seed ?? (Date.now() % 2_147_483_647);
    const fresh = newSemester(seed, data.bbqDays);
    this.seed = seed;
    this.ctx = fresh.ctx;
    this.state = fresh.state;
    this.answers = [];
    this.menu = undefined;
    this.cursor = 0;
    this.busy = false;
    this.onContinue = undefined;
    this.lines = [];
    this.head = undefined;
    this.escGuardUntil = 0;
    addText(this, this.scale.width / 2, this.scale.height - 40, str('semester.hint'), { role: 'print', weight: 400, size: 18, color: DIM }).setOrigin(0.5, 1);

    const onKey = (e: KeyboardEvent) => {
      // The semester is not saved, so leaving drops it; the hint line says so.
      if (e.code === 'Escape') return performance.now() < this.escGuardUntil ? undefined : this.leave();
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
    const onClick = () => {
      if (this.menu === undefined && !this.busy) this.proceed();
    };
    this.input.keyboard?.on('keydown', onKey);
    this.input.on('pointerdown', onClick);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown', onKey);
      this.input.off('pointerdown', onClick);
      this.clear();
    });
    this.ask();
  }

  /**
   * The investigation wall of design doc 8.11, a room the player walks through before the report, or
   * the year-end review of a passed semester before the end page (build plan: evidence wall). The semester sleeps while the World and the HUD run the wall
   * chapter; taking the page from the report desk, or Esc, wakes it and goes on with `go`.
   */
  private showWall(make: () => Wall, go: () => void): void {
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
      done: () => {
        this.registry.set('loop', undefined);
        this.events.once(Phaser.Scenes.Events.WAKE, () => {
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
    const weekday = str(`semester.weekday.${weekdayOf(view.day)}`);
    const day = fillStr('semester.day', { n: view.day, weekday });
    const exam = view.exam === null ? '' : `　${str(`semester.exam.${view.exam}`)}`;
    this.head = addText(this, 32, 24, `${day}　${str(`semester.phase.${phase}`)}${exam}`, { role: 'print', weight: 700, size: 22, color: DIM });
  }

  private show(ask: Ask): void {
    switch (ask.kind) {
      case 'plan': return this.askCoffee(ask.view);
      case 'event': return this.askEvent(ask.view, ask.id, ask.options);
      case 'floor': return this.askFloor(ask.view);
      case 'night': return this.askNight(ask.view);
    }
  }

  private cards(labels: readonly { label: string; note: string }[], title: string, caption: string | undefined, pick: (i: number) => void): void {
    this.clear();
    const table = new CardTable(this, { ...(caption ? { caption } : {}), title, options: labels }, this.textScale, (i) => this.choose(i), (i) => this.select(i));
    this.menu = { n: labels.length, paint: (c) => table.paint(c), destroy: () => table.destroy(), allowed: () => true, choose: pick };
    this.select(0);
  }

  private askCoffee(view: DayView): void {
    this.banner(view, 'plan');
    const ids = Object.keys(COFFEE_PLANS) as CoffeePlanId[];
    this.cards(ids.map((id) => ({ label: str(`semester.coffee.${id}`), note: str(`semester.coffee.${id}.note`) })), str('semester.coffee.title'), undefined, (i) => {
      this.askRest(ids[i]!);
    });
  }

  private askRest(coffee: CoffeePlanId): void {
    const ids = Object.keys(REST_PLANS) as RestPlanId[];
    this.cards(ids.map((id) => ({ label: str(`semester.rest.${id}`), note: str(`semester.rest.${id}.note`) })), str('semester.rest.title'), undefined, (i) => {
      this.answer({ kind: 'plan', plan: morningPlan(coffee, ids[i]!) });
    });
  }

  private askEvent(view: DayView, id: string, options: readonly string[]): void {
    this.banner(view, 'event');
    const labels = options.map((o) => ({ label: str(`semester.event.${id}.${o}`), note: str(`semester.event.${id}.${o}.note`) }));
    this.cards(labels, str(`semester.event.${id}.title`), servesAlcohol(id) ? str('semester.alcohol.notice') : undefined, (i) => {
      this.answer({ kind: 'event', option: options[i]! });
    });
  }

  private askFloor(view: DayView): void {
    this.banner(view, 'floor');
    this.panel(view, str('semester.floor.title'), undefined, (patrol) => {
      this.cards(
        [
          { label: str('semester.overtime.none'), note: str('semester.overtime.none.note') },
          { label: str('semester.overtime.yes'), note: str('semester.overtime.yes.note') },
        ],
        str('semester.floor.overtime.title'), undefined,
        (i) => {
          if (i === 0) return this.answer({ kind: 'floor', choice: floorChoice(patrol) });
          this.panel(view, str('semester.floor.overtime.again'), patrol, (overtime) => this.answer({ kind: 'floor', choice: floorChoice(patrol, overtime) }));
        },
      );
    });
  }

  private panel(view: DayView, title: string, disabled: FloorId | undefined, pick: (floor: FloorId) => void): void {
    this.clear();
    const panel = new ElevatorPanelView(this, view.panel, { title }, disabled, (i) => this.choose(i), (i) => this.select(i));
    this.menu = {
      n: view.panel.buttons.length,
      paint: (c) => panel.paint(c),
      destroy: () => panel.destroy(),
      allowed: (i) => !panel.isDisabled(i),
      choose: (i) => pick(panel.floorAt(i)!),
    };
    this.select(Math.max(0, view.panel.buttons.findIndex((b) => b.floor !== disabled)));
  }

  private askNight(view: DayView): void {
    this.banner(view, 'night');
    const ids = Object.keys(NIGHT_PLANS) as NightPlanId[];
    const title = str(view.examTomorrow ? 'semester.night.exam.title' : 'semester.night.title');
    this.cards(ids.map((id) => ({ label: str(`semester.night.${id}`), note: str(`semester.night.${id}.note`) })), title, undefined, (i) => {
      this.answer({ kind: 'night', plan: nightPlan(ids[i]!) });
    });
  }

  private select(i: number): void {
    if (this.busy || !this.menu?.allowed(i)) return;
    this.cursor = i;
    this.menu.paint(i);
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

  /** A screen of text lines, left until Enter. */
  private page(title: string, lines: readonly string[], next: string, go: () => void): void {
    this.clear();
    this.lines.push(addText(this, this.scale.width / 2, 130, title, { role: 'hand', weight: 700, size: 44, color: PAPER }).setOrigin(0.5, 0));
    lines.forEach((line, i) => {
      this.lines.push(addText(this, this.scale.width / 2, 230 + i * 48, line, { role: 'print', weight: 400, size: 26, color: PAPER }).setOrigin(0.5, 0));
    });
    this.lines.push(addText(this, this.scale.width / 2, 230 + lines.length * 48 + 40, next, { role: 'print', weight: 700, size: 22, color: DIM }).setOrigin(0.5, 0));
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

  private endOfDay(after: SemesterState): void {
    const before = this.state;
    const lines = daySummary(before, after, this.ctx);
    const title = fillStr('semester.sum.title', { n: before.day });
    this.head?.destroy();
    this.head = undefined;
    const next = (): void => {
      if (!after.ended) {
        this.state = after;
        this.answers = [];
        this.ask();
        return;
      }
      const toEnd = (): void => this.page(str('semester.end.title'), endSummary(after, this.ctx), str('semester.end.back'), () => this.leave());
      let review: Wall | undefined;
      try {
        review = reviewWall(after, this.ctx, REPORT, str);
      } catch (err) {
        console.error('year-end review skipped:', err);
      }
      if (review === undefined) return toEnd();
      const wall = review;
      this.showWall(() => wall, toEnd);
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
