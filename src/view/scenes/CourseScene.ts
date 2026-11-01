import Phaser from 'phaser';
import { fillStr, str } from '../../app/content.ts';
import { clauseName, clauseNote, courseNote } from '../../app/semester.ts';
import { burdenOf, CLAUSE_CREDIT_CAP, clauseProblem, creditsOf, MAX_CLAUSE, OPEN_COURSES, selectionProblem, thresholdMult, type ProgressData } from '../../core/index.ts';
import { addText, updateText } from '../text/fonts.ts';
import type { SemesterData } from './SemesterScene.ts';

const PAPER = '#f4efe4';
const INK = '#0c2d5e';
const DIM = '#6b7a94';
const ROW_Y = 100;
const ROW_H = 72;
/** Below the row's own line and its padding, so the highlight does not cover the note. */
const NOTE_DY = 46;

/**
 * The course selection that opens a semester (design doc 8.3): the open cards as rows to tick, the overtime clause row
 * that picks among the levels the player has unlocked, the credits and burden of the picks, and the start row, which only works when the
 * picks break no rule and sit with the clause. The scripted first week skips this scene; its list is fixed.
 */
export class CourseScene extends Phaser.Scene {
  private picked = new Set<string>();
  private index = 0;
  private level = 0;
  private unlocked = 0;
  private rows: { name: Phaser.GameObjects.Text; note: Phaser.GameObjects.Text | undefined }[] = [];
  private summary: Phaser.GameObjects.Text | undefined;
  private starting = false;

  constructor() {
    super('Courses');
  }

  /** The row of the clause, between the cards and the start row. */
  private get clauseRow(): number {
    return OPEN_COURSES.length;
  }

  create(): void {
    this.picked = new Set();
    this.index = 0;
    this.level = 0;
    this.unlocked = Math.min(MAX_CLAUSE, (this.registry.get('progress') as ProgressData | undefined)?.clauseUnlocked ?? 0);
    this.rows = [];
    this.starting = false;
    const w = this.scale.width;
    addText(this, w / 2, 56, str('course.pick.title'), { role: 'hand', weight: 700, size: 44, color: PAPER }).setOrigin(0.5);

    OPEN_COURSES.forEach((c, i) => {
      const y = ROW_Y + i * ROW_H;
      const name = addText(this, w / 2 - 330, y, '', { role: 'print', weight: 700, size: 28, color: PAPER, padding: { x: 14, y: 4 } });
      const note = addText(this, w / 2 - 316, y + NOTE_DY, courseNote(c.id), { role: 'print', weight: 400, size: 18, color: DIM });
      this.rows.push({ name, note });
      name.setInteractive({ useHandCursor: true });
      name.on('pointerover', () => this.select(i));
      name.on('pointerup', () => this.toggle(i));
    });
    const clauseY = ROW_Y + this.clauseRow * ROW_H;
    const clause = addText(this, w / 2 - 330, clauseY, '', { role: 'print', weight: 700, size: 28, color: PAPER, padding: { x: 14, y: 4 } });
    const clauseText = addText(this, w / 2 - 316, clauseY + NOTE_DY, '', { role: 'print', weight: 400, size: 18, color: DIM });
    this.rows.push({ name: clause, note: clauseText });
    clause.setInteractive({ useHandCursor: true });
    clause.on('pointerover', () => this.select(this.clauseRow));
    clause.on('pointerup', () => this.shift(1));

    const startY = ROW_Y + (this.clauseRow + 1) * ROW_H + 8;
    const start = addText(this, w / 2 - 330, startY, str('course.pick.start'), { role: 'print', weight: 700, size: 28, color: PAPER, padding: { x: 14, y: 4 } });
    this.rows.push({ name: start, note: undefined });
    start.setInteractive({ useHandCursor: true });
    start.on('pointerover', () => this.select(this.rows.length - 1));
    start.on('pointerup', () => this.begin());
    this.summary = addText(this, w / 2 - 330, startY + 56, '', { role: 'print', weight: 400, size: 20, color: PAPER, maxWidth: 660 });
    addText(this, w / 2, this.scale.height - 40, str('course.pick.hint'), { role: 'print', weight: 400, size: 18, color: DIM }).setOrigin(0.5, 1);

    this.paint();
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'KeyW' || e.code === 'ArrowUp') this.select((this.index + this.rows.length - 1) % this.rows.length);
      else if (e.code === 'KeyS' || e.code === 'ArrowDown') this.select((this.index + 1) % this.rows.length);
      else if ((e.code === 'KeyA' || e.code === 'ArrowLeft') && this.index === this.clauseRow) this.shift(-1);
      else if ((e.code === 'KeyD' || e.code === 'ArrowRight') && this.index === this.clauseRow) this.shift(1);
      else if (['Enter', 'NumpadEnter', 'KeyJ', 'Space'].includes(e.code) && !e.repeat) this.confirm();
      else if (e.code === 'Escape') this.back();
    };
    this.input.keyboard?.on('keydown', onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.input.keyboard?.off('keydown', onKey));
  }

  private select(i: number): void {
    this.index = i;
    this.paint();
  }

  private confirm(): void {
    if (this.index === this.rows.length - 1) this.begin();
    else if (this.index === this.clauseRow) this.shift(1);
    else this.toggle(this.index);
  }

  private toggle(i: number): void {
    const id = OPEN_COURSES[i]!.id;
    if (this.picked.has(id)) this.picked.delete(id);
    else this.picked.add(id);
    this.select(i);
  }

  /** The next unlocked level in the direction `by`, wrapping round. */
  private shift(by: number): void {
    const n = this.unlocked + 1;
    this.level = (this.level + by + n) % n;
    this.select(this.clauseRow);
  }

  /** The picks in the order of the pool, which is the order the save keeps them in. */
  private picks(): string[] {
    return OPEN_COURSES.map((c) => c.id).filter((id) => this.picked.has(id));
  }

  /** The rule the picks break, or the one they break with the clause; the start row waits for neither. */
  private problem(picks: readonly string[]): string | undefined {
    return selectionProblem(picks) ?? (clauseProblem(this.level, creditsOf(picks)) === undefined ? undefined : 'clause');
  }

  private paint(): void {
    const picks = this.picks();
    const problem = this.problem(picks);
    this.rows.forEach((row, i) => {
      const on = i === this.index;
      const course = OPEN_COURSES[i];
      const isClause = i === this.clauseRow;
      const mark = course === undefined ? '' : this.picked.has(course.id) ? '[x] ' : '[ ] ';
      let label: string;
      if (course !== undefined) label = `${mark}${str(`course.name.${course.id}`)}　${fillStr('course.pick.credits', { n: course.credits })}`;
      else if (isClause) label = `${this.unlocked > 0 ? '< ' : ''}${fillStr('course.clause.row', { level: this.level, name: clauseName(this.level) })}${this.unlocked > 0 ? ' >' : ''}`;
      else label = str('course.pick.start');
      updateText(row.name, label);
      if (isClause && row.note) updateText(row.note, clauseNote(this.level));
      // The start row stays grey while the picks break a rule, even under the cursor, so Enter on it visibly cannot work.
      row.name.setColor(!isClause && course === undefined && problem !== undefined ? DIM : on ? INK : PAPER).setBackgroundColor(on ? PAPER : 'rgba(0, 0, 0, 0)');
    });
    const credits = creditsOf(picks);
    // The burden and the threshold only mean something for a selection that has enough cards and credits.
    const head = problem === 'few' || problem === 'low_credits' ? fillStr('course.pick.count', { n: picks.length, credits }) : fillStr('course.pick.summary', { n: picks.length, credits, burden: str(`semester.burden.${burdenOf(credits)}`), mult: thresholdMult(credits).toFixed(2) });
    const why = problem === 'clause' ? fillStr('course.pick.problem.clause', { level: this.level, cap: CLAUSE_CREDIT_CAP[this.level]! }) : problem === undefined ? undefined : str(`course.pick.problem.${problem}`);
    if (this.summary) updateText(this.summary, why === undefined ? head : `${head}\n${why}`);
  }

  private begin(): void {
    const picks = this.picks();
    if (this.starting || this.problem(picks) !== undefined) return;
    this.starting = true;
    const data: SemesterData = { courses: picks, ...(this.level > 0 ? { clause: this.level } : {}) };
    // Deferred so the confirming key is not also read by the first screen of the semester.
    window.setTimeout(() => this.scene.start('Semester', data), 0);
  }

  private back(): void {
    if (this.starting) return;
    this.starting = true;
    window.setTimeout(() => this.scene.start('Title'), 0);
  }
}
