import Phaser from 'phaser';
import {
  COFFEE_PLANS, daySummary, endSummary, floorChoice, morningPlan, newSemester, NIGHT_PLANS, nightPlan, REST_PLANS, servesAlcohol, weekdayOf,
  type CoffeePlanId, type NightPlanId, type RestPlanId,
} from '../../app/semester.ts';
import { fillStr, str } from '../../app/content.ts';
import { advanceDay, type Answer, type Ask, type DayView, type FloorId, type SemesterContext, type SemesterState, type Settings } from '../../core/index.ts';
import { addText } from '../text/fonts.ts';
import { CardTable } from '../ui/cardTable.ts';
import { ElevatorPanelView } from '../ui/elevatorPanel.ts';

const DIM = '#c9d3e3';
const PAPER = '#fbfaf6';
/** How long a chosen card stays highlighted before the next question, so the choice is seen. */
const CHOSEN_MS = 220;
const CONFIRM = ['Enter', 'NumpadEnter', 'KeyJ', 'KeyE', 'Space'];
const PREV = ['KeyW', 'KeyA', 'ArrowUp', 'ArrowLeft'];
const NEXT = ['KeyS', 'KeyD', 'ArrowDown', 'ArrowRight'];
const PICK = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];
const PICK_PAD = ['Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5'];

export interface SemesterData {
  /** Fixes the semester's events; a new game takes it from the clock. */
  readonly seed?: number;
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
  private state!: SemesterState;
  private answers: Answer[] = [];
  private menu: Menu | undefined;
  private cursor = 0;
  private busy = false;
  /** What Enter does when no menu is up: go on from the day or the semester summary. */
  private onContinue: (() => void) | undefined;
  private head: Phaser.GameObjects.Text | undefined;
  private lines: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('Semester');
  }

  create(data: SemesterData): void {
    const seed = data.seed ?? (Date.now() % 2_147_483_647);
    const fresh = newSemester(seed);
    this.ctx = fresh.ctx;
    this.state = fresh.state;
    this.answers = [];
    this.menu = undefined;
    this.cursor = 0;
    this.busy = false;
    this.onContinue = undefined;
    this.lines = [];
    this.head = undefined;
    addText(this, this.scale.width / 2, this.scale.height - 40, str('semester.hint'), { role: 'print', weight: 400, size: 18, color: DIM }).setOrigin(0.5, 1);

    const onKey = (e: KeyboardEvent) => {
      // The semester is not saved, so leaving drops it; the hint line says so.
      if (e.code === 'Escape') return this.leave();
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

  private endOfDay(after: SemesterState): void {
    const before = this.state;
    const lines = daySummary(before, after, this.ctx);
    const title = fillStr('semester.sum.title', { n: before.day });
    this.head?.destroy();
    this.head = undefined;
    if (!after.ended) {
      return this.page(title, lines, str('semester.sum.next'), () => {
        this.state = after;
        this.answers = [];
        this.ask();
      });
    }
    this.page(title, lines, str('semester.sum.next'), () => {
      this.page(str('semester.end.title'), endSummary(after, this.ctx), str('semester.end.back'), () => this.leave());
    });
  }
}
