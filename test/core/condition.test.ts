import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ConditionError, compileCondition, evaluateCondition, loadDictionary, parseCondition, type ConditionProblemCode,
} from '../../src/core/index.ts';

const dict = loadDictionary(JSON.parse(readFileSync('content/tags.json', 'utf8')));
const values = (v: Record<string, number | boolean>) => (n: string) => v[n];
const evalText = (text: string, v: Record<string, number | boolean>) => evaluateCondition(parseCondition(text), values(v));

const code = (fn: () => unknown): ConditionProblemCode | undefined => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ConditionError) return e.problem.code;
    throw e;
  }
  return undefined;
};

describe('when conditions: every operator of design doc 13.3', () => {
  it.each([
    ['sleep_debt>=2', 2, true], ['sleep_debt>=2', 1.5, false],
    ['sleep_debt<=2', 2, true], ['sleep_debt<=2', 3, false],
    ['sleep_debt>2', 3, true], ['sleep_debt>2', 2, false],
    ['sleep_debt<2', 1, true], ['sleep_debt<2', 2, false],
    ['sleep_debt==2', 2, true], ['sleep_debt==2', 2.5, false],
    ['sleep_debt!=2', 3, true], ['sleep_debt!=2', 2, false],
  ] as const)('%s with sleep_debt=%s is %s', (text, v, want) => {
    expect(evalText(text, { sleep_debt: v })).toBe(want);
  });

  it('a bare name is true only when the flag is on', () => {
    expect(evalText('breakfast', { breakfast: true })).toBe(true);
    expect(evalText('breakfast', {})).toBe(false);
  });

  it('! negates a flag', () => {
    expect(evalText('!breakfast', {})).toBe(true);
    expect(evalText('!breakfast', { breakfast: true })).toBe(false);
  });

  it(', means and', () => {
    expect(evalText('alcohol>0,fasting', { alcohol: 2, fasting: true })).toBe(true);
    expect(evalText('alcohol>0,fasting', { alcohol: 2 })).toBe(false);
    expect(evalText('alcohol>0,fasting', { fasting: true })).toBe(false);
  });

  it('absent number tags read as 0', () => {
    expect(evalText('caffeine<15', {})).toBe(true);
  });

  it('tolerates spaces and decimals', () => {
    expect(evalText(' caffeine >= 12.5 , !fasting ', { caffeine: 12.5 })).toBe(true);
  });
});

describe('when conditions: rejected input', () => {
  it.each([
    ['', 'empty'],
    ['breakfast,', 'empty-term'],
    ['sleep_debt=2', 'syntax'],
    ['sleep_debt>=', 'syntax'],
    ['Breakfast', 'syntax'],
    ['breakfast|fasting', 'syntax'],
    ['!sleep_debt>=2', 'negated-compare'],
  ] as const)('parse rejects %j with %s', (text, want) => {
    expect(code(() => parseCondition(text))).toBe(want);
  });

  it.each([
    ['sleepdebt>=2', 'unknown-tag'],
    ['caffeine', 'not-boolean'],
    ['breakfast>0', 'not-number'],
    ['mod.caffeine_cloak>1', 'not-number'],
  ] as const)('the dictionary rejects %j with %s', (text, want) => {
    expect(code(() => compileCondition(dict, text))).toBe(want);
  });

  it('accepts dictionary tags and modifier aliases', () => {
    expect(() => compileCondition(dict, 'sleep_debt>=2,!breakfast,mod.caffeine_cloak')).not.toThrow();
  });
});

describe('modifier aliases', () => {
  const alias = (n: string) => dict.aliases.get(n)?.condition;
  it('evaluate through their definition, including negation', () => {
    const cloak = parseCondition('mod.caffeine_cloak');
    expect(evaluateCondition(cloak, values({ caffeine: 30 }), alias)).toBe(true);
    expect(evaluateCondition(cloak, values({ caffeine: 20 }), alias)).toBe(false);
    const notLocked = parseCondition('!mod.warehouse_locked');
    expect(evaluateCondition(notLocked, values({ alcohol: 1 }), alias)).toBe(true);
    expect(evaluateCondition(notLocked, values({ alcohol: 1, fasting: true }), alias)).toBe(false);
  });
});
