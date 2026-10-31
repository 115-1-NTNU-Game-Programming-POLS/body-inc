import { describe, expect, it } from 'vitest';
import { TAGS } from '../../src/app/content.ts';
import { chapterOfRoom, gaugeFromQuery, halvesFromQuery, QueryError, roomFromQuery, semesterFromQuery, tagsFromQuery } from '../../src/app/session.ts';
import { amount, flag, parseCondition, holds } from '../../src/core/index.ts';

describe('room from the URL', () => {
  it('is absent by default, accepts folder/map, and rejects anything that could leave assets/maps', () => {
    expect(roomFromQuery('')).toBeUndefined();
    expect(roomFromQuery('?room=greybox/brain-corridor')).toBe('greybox/brain-corridor');
    for (const bad of ['../secret', 'greybox', 'a/b/c', 'Greybox/x', 'greybox/x.tmj']) {
      expect(() => roomFromQuery(`?room=${encodeURIComponent(bad)}`), bad).toThrow(QueryError);
    }
  });
});

describe('chapter and hearts from the URL', () => {
  it('a room belongs to the chapter named by its folder', () => {
    expect(chapterOfRoom('greybox/rest-room')).toBe('greybox');
  });

  it('hearts are absent by default, take 1 to 12 and reject anything else', () => {
    expect(halvesFromQuery('')).toBeUndefined();
    expect(halvesFromQuery('?halves=2')).toBe(2);
    for (const bad of ['', '0', '13', '1.5', 'many']) expect(() => halvesFromQuery(`?halves=${bad}`), bad).toThrow(QueryError);
  });
});

describe('gauge from the URL', () => {
  it('is absent by default, takes 0 to 100 and rejects anything else', () => {
    expect(gaugeFromQuery('')).toBeUndefined();
    expect(gaugeFromQuery('?gauge=100')).toBe(100);
    expect(gaugeFromQuery('?gauge=0')).toBe(0);
    for (const bad of ['', 'full', '-1', '101', 'NaN']) expect(() => gaugeFromQuery(`?gauge=${bad}`), bad).toThrow(QueryError);
  });
});

describe('tags from the URL', () => {
  it('sets number and boolean tags with a causal source', () => {
    const t = tagsFromQuery('?tags=sleep_debt:2,breakfast', TAGS);
    expect(amount(t, TAGS, 'sleep_debt')).toBe(2);
    expect(flag(t, TAGS, 'breakfast')).toBe(true);
    expect(t.log.nodes[t.values['sleep_debt']!.node]!.causes.map((c) => t.log.nodes[c.node]!.key)).toEqual(['dev.query_tags']);
  });

  it('feeds conditions the way the room sees them', () => {
    const debt = parseCondition('sleep_debt>=2');
    expect(holds(tagsFromQuery('?tags=sleep_debt:2', TAGS), TAGS, debt)).toBe(true);
    expect(holds(tagsFromQuery('?tags=sleep_debt:1.5', TAGS), TAGS, debt)).toBe(false);
    expect(holds(tagsFromQuery('', TAGS), TAGS, debt)).toBe(false);
  });

  it.each(['sleepy:2', 'sleep_debt', 'sleep_debt:abc', 'sleep_debt:', 'breakfast:1', 'sleep_debt:2:3'])('rejects %s', (q) => {
    expect(() => tagsFromQuery(`?tags=${q}`, TAGS)).toThrow(QueryError);
  });
});

describe('semester from the URL', () => {
  it('is empty by default, takes a seed and barbecue days, and rejects anything else', () => {
    expect(semesterFromQuery('', 10)).toEqual({});
    expect(semesterFromQuery('?seed=7&bbq=2,3,4', 10)).toEqual({ seed: 7, bbqDays: [2, 3, 4] });
    expect(semesterFromQuery('?bbq=3,3', 10)).toEqual({ bbqDays: [3] });
    expect(semesterFromQuery('?bbq=', 10)).toEqual({ bbqDays: [] });
    for (const bad of ['0', '11', '2,x', '2,,3', '1.5', '0x3', '2e0', ' 2']) expect(() => semesterFromQuery(`?bbq=${bad}`, 10), bad).toThrow(QueryError);
    for (const bad of ['', '-1', '1.5', 'x', '0x10', '1e3', '9007199254740993']) expect(() => semesterFromQuery(`?seed=${bad}`, 10), bad).toThrow(QueryError);
  });
});
