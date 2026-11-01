import Phaser from 'phaser';
import { fillStr, str } from '../../app/content.ts';
import { courseNote } from '../../app/semester.ts';
import { burdenOf, creditsOf, OPEN_COURSES, selectionProblem, thresholdMult } from '../../core/index.ts';
import { addText, updateText } from '../text/fonts.ts';
import type { SemesterData } from './SemesterScene.ts';

const PAPER = '#f4efe4';
const INK = '#0c2d5e';
const DIM = '#6b7a94';
const ROW_Y = 130;
const ROW_H = 84;
/** Below the row's own line and its padding, so the highlight does not cover the note. */
const NOTE_DY = 52;

/**
 * The course selection that opens a semester (design doc 8.3): the open cards as rows to tick, the
 * credits and burden of the picks, and the start row, which only works when the picks break no
 * rule. The scripted first week skips this scene; its list is fixed.
 */
export class CourseScene extends Phaser.Scene {
  private picked = new Set<string>();
  private index = 0;
  private rows: { name: Phaser.GameObjects.Text; note: Phaser.GameObjects.Text | undefined }[] = [];
  private summary: Phaser.GameObjects.Text | undefined;
  private starting = false;

  constructor() {
    super('Courses');
  }

  create(): void {
    this.picked = new Set();
    this.index = 0;
    this.rows = [];
    this.starting = false;
    const w = this.scale.width;
    addText(this, w / 2, 64, str('course.pick.title'), { role: 'hand', weight: 700, size: 44, color: PAPER }).setOrigin(0.5);

    OPEN_COURSES.forEach((c, i) => {
      const y = ROW_Y + i * ROW_H;
      const name = addText(this, w / 2 - 330, y, '', { role: 'print', weight: 700, size: 28, color: PAPER, padding: { x: 14, y: 4 } });
      const note = addText(this, w / 2 - 316, y + NOTE_DY, courseNote(c.id), { role: 'print', weight: 400, size: 18, color: DIM });
      this.rows.push({ name, note });
      name.setInteractive({ useHandCursor: true });
      name.on('pointerover', () => this.select(i));
      name.on('pointerup', () => this.toggle(i));
    });
    const start = addText(this, w / 2 - 330, ROW_Y + OPEN_COURSES.length * ROW_H + 10, str('course.pick.start'), { role: 'print', weight: 700, size: 28, color: PAPER, padding: { x: 14, y: 4 } });
    this.rows.push({ name: start, note: undefined });
    start.setInteractive({ useHandCursor: true });
    start.on('pointerover', () => this.select(this.rows.length - 1));
    start.on('pointerup', () => this.begin());
    this.summary = addText(this, w / 2 - 330, ROW_Y + OPEN_COURSES.length * ROW_H + 70, '', { role: 'print', weight: 400, size: 20, color: PAPER, maxWidth: 660 });
    addText(this, w / 2, this.scale.height - 40, str('course.pick.hint'), { role: 'print', weight: 400, size: 18, color: DIM }).setOrigin(0.5, 1);

    this.paint();
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'KeyW' || e.code === 'ArrowUp') this.select((this.index + this.rows.length - 1) % this.rows.length);
      else if (e.code === 'KeyS' || e.code === 'ArrowDown') this.select((this.index + 1) % this.rows.length);
      else if (['Enter', 'NumpadEnter', 'KeyJ', 'Space'].includes(e.code) && !e.repeat) (this.index === this.rows.length - 1 ? this.begin() : this.toggle(this.index));
      else if (e.code === 'Escape') this.back();
    };
    this.input.keyboard?.on('keydown', onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.input.keyboard?.off('keydown', onKey));
  }

  private select(i: number): void {
    this.index = i;
    this.paint();
  }

  private toggle(i: number): void {
    const id = OPEN_COURSES[i]!.id;
    if (this.picked.has(id)) this.picked.delete(id);
    else this.picked.add(id);
    this.select(i);
  }

  /** The picks in the order of the pool, which is the order the save keeps them in. */
  private picks(): string[] {
    return OPEN_COURSES.map((c) => c.id).filter((id) => this.picked.has(id));
  }

  private paint(): void {
    const picks = this.picks();
    const problem = selectionProblem(picks);
    this.rows.forEach((row, i) => {
      const on = i === this.index;
      const course = OPEN_COURSES[i];
      const mark = course === undefined ? '' : this.picked.has(course.id) ? '[x] ' : '[ ] ';
      const label = course === undefined ? str('course.pick.start') : `${mark}${str(`course.name.${course.id}`)}　${fillStr('course.pick.credits', { n: course.credits })}`;
      updateText(row.name, label);
      // The start row stays grey while the picks break a rule, even under the cursor, so Enter on it visibly cannot work.
      row.name.setColor(course === undefined && problem !== undefined ? DIM : on ? INK : PAPER).setBackgroundColor(on ? PAPER : 'rgba(0, 0, 0, 0)');
    });
    const credits = creditsOf(picks);
    // The burden and the threshold only mean something for a selection that has enough cards and credits.
    const head = problem === 'few' || problem === 'low_credits' ? fillStr('course.pick.count', { n: picks.length, credits }) : fillStr('course.pick.summary', { n: picks.length, credits, burden: str(`semester.burden.${burdenOf(credits)}`), mult: thresholdMult(credits).toFixed(2) });
    if (this.summary) updateText(this.summary, problem === undefined ? head : `${head}\n${str(`course.pick.problem.${problem}`)}`);
  }

  private begin(): void {
    const picks = this.picks();
    if (this.starting || selectionProblem(picks) !== undefined) return;
    this.starting = true;
    const data: SemesterData = { courses: picks };
    // Deferred so the confirming key is not also read by the first screen of the semester.
    window.setTimeout(() => this.scene.start('Semester', data), 0);
  }

  private back(): void {
    if (this.starting) return;
    this.starting = true;
    window.setTimeout(() => this.scene.start('Title'), 0);
  }
}
