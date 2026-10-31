import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildWall, readContent, runSemester, semesterReports, SLOTS_PER_LANE,
  type IncidentLine, type ReportDocument, type ReportFile, type StringsFile,
} from '../../src/core/index.ts';
import { ARCHETYPES } from '../../sim/semester/archetypes.ts';
import { bingeTwice, bingeWeek, contextFor, crunchWeek } from '../../sim/semester/scenario.ts';

const readJson = (f: string): unknown => JSON.parse(readFileSync(`content/${f}`, 'utf8').replace(/^﻿/, ''));
const CFG: ReportFile = readContent('report', readJson('report.json'));
const STRINGS: StringsFile = readContent('strings', readJson('strings/zh-TW.json'));
const text = (k: string): string => {
  const s = STRINGS.strings[k];
  if (!s) throw new Error(`no string ${k}`);
  return s.text;
};

const line = (key: string, day: number, at: number, t: string, scope?: string): IncidentLine => ({
  key, ...(scope !== undefined ? { scope } : {}), form: 'single', text: t, firstDay: day, lastDay: day, at, generic: false,
});

const doc = (incident: IncidentLine[], struck: string[] = ['liver'], number = '0602'): ReportDocument => ({
  kind: 'bankruptcy', number, lines: [], incident, unlock: 'alcohol', theme: 'alcohol', generic: 0, struck,
});

describe('the evidence wall of a synthetic report', () => {
  it('puts a choice on the upper track and a tag on the lower one, on the day it began', () => {
    const wall = buildWall(doc([line('choice:coffee', 3, 100, 'a'), line('tag:sleep_debt', 4, 200, 'b')], []), CFG, text);
    expect(wall.nodes.map((n) => [n.kind, n.lane, n.day])).toEqual([['event', 'upper', 3], ['tag', 'lower', 4]]);
    expect(wall.links).toEqual([[0, 1]]);
  });

  it('puts an unanswered warning and an operations note in the operations colour on the upper track', () => {
    const wall = buildWall(doc([line('warning', 5, 1, 'w', 'stomach'), line('ops:poor_patrol', 5, 2, 'p', 'liver')], []), CFG, text);
    expect(wall.nodes.map((n) => [n.kind, n.lane])).toEqual([['ops', 'upper'], ['ops', 'upper']]);
  });

  it('ends at the floor that struck, on the day of the emergency room, linked from the last node before it', () => {
    const wall = buildWall(doc([line('choice:drink', 5, 10, 'x'), line('choice:coffee', 6, 20, 'y')], ['liver']), CFG, text);
    const floor = wall.nodes.at(-1)!;
    expect([floor.kind, floor.lane, floor.day]).toEqual(['floor', 'lower', 6]);
    expect(floor.text).toBe('肝臟部門罷工，營運長送急診');
    expect(wall.links).toEqual([[0, 1], [1, 2]]);
  });

  it('hangs every floor that struck on the one before it, so none is left loose', () => {
    const wall = buildWall(doc([line('choice:drink', 5, 10, 'x')], ['liver', 'stomach']), CFG, text);
    expect(wall.links).toEqual([[0, 1], [0, 2]]);
  });

  it('draws one floor per struck scope and none for a strike the incident already states', () => {
    const wall = buildWall(doc([line('strike', 6, 5, 'liver struck earlier', 'liver')], ['liver', 'stomach'], '0602'), CFG, text);
    expect(wall.nodes.filter((n) => n.kind === 'floor').map((n) => n.text)).toEqual(['liver struck earlier', '物流部罷工，營運長送急診']);
  });

  it('keeps time order across days even when the sentences arrive out of order', () => {
    const wall = buildWall(doc([line('choice:coffee', 6, 5, 'late'), line('choice:drink', 2, 5, 'early')], []), CFG, text);
    expect(wall.nodes.map((n) => n.text)).toEqual(['early', 'late']);
  });

  it(`folds the sentences past ${SLOTS_PER_LANE} of one day and track into one note that still holds their words`, () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((t, i) => line('choice:coffee', 4, i, t));
    const wall = buildWall(doc(many, []), CFG, text);
    expect(wall.nodes).toHaveLength(SLOTS_PER_LANE);
    const folded = wall.nodes.at(-1)!;
    expect(folded.folded).toBe(3);
    expect(folded.text.split('\n')).toEqual(['另有 3 件', 'c', 'd', 'e']);
  });

  it('does not fold two tracks of one day into each other', () => {
    const mixed = [line('choice:coffee', 4, 1, 'a'), line('choice:drink', 4, 2, 'b'), line('tag:sleep_debt', 4, 3, 'c'), line('tag:sleep_debt', 4, 4, 'd')];
    const wall = buildWall(doc(mixed, []), CFG, text);
    expect(wall.nodes.every((n) => n.folded === undefined)).toBe(true);
    expect(wall.nodes).toHaveLength(4);
  });

  it('refuses a struck scope the bank does not know', () => {
    expect(() => buildWall(doc([], ['spleen']), CFG, text)).toThrow(/spleen/);
  });
});

describe('the evidence wall of every report a semester can write', () => {
  const scenarios = [
    ['binge week', bingeWeek(1)], ['twice', bingeTwice(1)], ['crunch', crunchWeek(1)],
  ] as const;
  const docs: { name: string; doc: ReportDocument }[] = [];
  for (const [name, scenario] of scenarios) {
    const ctx = contextFor(0.5, 1, { scenario });
    for (const [who, strategy] of Object.entries(ARCHETYPES)) {
      for (const seed of [1, 2, 3]) {
        const end = runSemester(ctx, strategy, seed);
        for (const d of semesterReports(end, ctx, { cfg: CFG, text, seed })) docs.push({ name: `${name}/${who}/${seed}/${d.kind}`, doc: d });
      }
    }
  }

  it('has reports to build walls from', () => {
    expect(docs.length).toBeGreaterThan(20);
  });

  it('holds every sentence of the report, its floors, and no more than a track has room for', () => {
    for (const { name, doc: d } of docs) {
      const wall = buildWall(d, CFG, text);
      const said = wall.nodes.map((n) => n.text).join('\n');
      for (const l of d.incident) expect(said, `${name}: "${l.text}" is on the wall`).toContain(l.text);
      for (const s of d.struck) expect(said, `${name}: ${s} struck`).toContain(text(CFG.scopes[s]!.dept));
      const perCell = new Map<string, number>();
      for (const n of wall.nodes) perCell.set(`${n.day}/${n.lane}`, (perCell.get(`${n.day}/${n.lane}`) ?? 0) + 1);
      for (const [cell, n] of perCell) expect(n, `${name}: ${cell}`).toBeLessThanOrEqual(SLOTS_PER_LANE);
      expect(wall.unlock).toBe(d.unlock);
    }
  });

  it('numbers the nodes in time order and draws every red line forward between two of them', () => {
    for (const { name, doc: d } of docs) {
      const wall = buildWall(d, CFG, text);
      wall.nodes.forEach((n, i) => {
        expect(n.id, name).toBe(i);
        if (i > 0) expect(n.day, name).toBeGreaterThanOrEqual(wall.nodes[i - 1]!.day);
        expect(n.day, name).toBeGreaterThanOrEqual(1);
      });
      for (const [from, to] of wall.links) {
        expect(from, name).toBeLessThan(to);
        expect(wall.nodes[to], name).toBeDefined();
      }
      // Every node but the first is the end of some line, so the wall reads as one chain.
      const ends = new Set(wall.links.map(([, to]) => to));
      for (const n of wall.nodes.slice(1)) expect(ends.has(n.id), `${name}: node ${n.id} is joined`).toBe(true);
    }
  });

  it('builds the same wall twice from the same report', () => {
    for (const { doc: d } of docs.slice(0, 10)) expect(buildWall(d, CFG, text)).toEqual(buildWall(d, CFG, text));
  });
});
