import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (f: string): string => readFileSync(f, 'utf8');

describe('the Python checks CI runs', () => {
  const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
  const inCi = read('.github/workflows/ci.yml').split(/\r?\n/).map((l) => /^\s*- run: (python .+)$/.exec(l)?.[1]).filter((c): c is string => c !== undefined);

  it('are the ones `npm run check:art` runs, in the same order, so verify cannot pass what CI fails', () => {
    expect(inCi.length).toBeGreaterThan(3);
    expect(scripts['check:art']!.split(' && ')).toEqual(inCi);
  });

  it('are part of verify, after the Node checks and before the build', () => {
    const steps = scripts['verify']!.split(' && ');
    expect(steps.indexOf('npm run check:art')).toBe(steps.indexOf('npm run check') + 1);
    expect(steps.at(-1)).toBe('npm run build');
  });
});