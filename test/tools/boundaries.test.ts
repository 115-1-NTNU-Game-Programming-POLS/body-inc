import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { findViolations } from '../../tools/check-boundaries.ts';

const F = 'test/fixtures/boundaries';

describe('core boundary check', () => {
  it('passes on the real core', () => {
    expect(findViolations('src/core')).toEqual([]);
  });

  it('passes on a clean fixture that mentions Math.random only in a comment', () => {
    expect(findViolations(`${F}/clean/core`)).toEqual([]);
  });

  it.each([
    ['phaser-import', 'imports package "phaser"'],
    ['view-import', 'outside core'],
    ['node-import', 'imports package "node:fs"'],
    ['math-random', 'Math.random'],
    ['date-now', 'Date.now'],
  ])('fails on %s', (name, message) => {
    const v = findViolations(`${F}/${name}/core`);
    expect(v.length).toBe(1);
    expect(v[0]).toContain(message);
  });

  it('the core tsconfig rejects DOM globals', () => {
    const tsc = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'test/fixtures/core-dom/tsconfig.json'], { encoding: 'utf8' });
    expect(tsc.status).not.toBe(0);
    expect(tsc.stdout).toContain("Cannot find name 'window'");
  });
});
