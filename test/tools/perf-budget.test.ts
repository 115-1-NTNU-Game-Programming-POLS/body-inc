import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkPerfBudget, COLD_LIMIT_KB, coldPath, cssFontFiles, htmlRefs } from '../../tools/check-perf-budget.ts';

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});

/**
 * A dist directory made of the real public assets without what Boot does not load (music,
 * portraits, the font slices of fonts-extra.css) and a bundle of `bundleKb` kB. Random bytes do
 * not compress, so the bundle counts as its size.
 */
function fakeDist(bundleKb: number): string {
  const dist = mkdtempSync(join(tmpdir(), 'body-inc-perf-'));
  temps.push(dist);
  cpSync('public', dist, { recursive: true, filter: (src) => !/[\\/](audio|portraits|extra)([\\/]|$)/.test(src) });
  writeFileSync(join(dist, 'assets', 'index-test.js'), randomBytes(bundleKb * 1000));
  const html = readFileSync('index.html', 'utf8')
    .replace(/<script type="module" src="[^"]+"><\/script>/, '<script type="module" crossorigin src="./assets/index-test.js"></script>')
    .replace(/(href|src)="\//g, '$1="./');
  writeFileSync(join(dist, 'index.html'), html);
  return dist;
}

describe('cold start budget (issue #72)', () => {
  it('reads the files an index.html and a font stylesheet name', () => {
    expect(htmlRefs('<link rel="preload" href="./assets/fonts/A.woff2" /><script type="module" src="./assets/x.js"></script><link href="https://fonts.example/css">'))
      .toEqual(['assets/fonts/A.woff2', 'assets/x.js']);
    expect(cssFontFiles('@font-face{src:url(A.woff2) format("woff2")}@font-face{src:url("B.woff2")}', 'assets/fonts/fonts.css'))
      .toEqual(['assets/fonts/A.woff2', 'assets/fonts/B.woff2']);
  });

  it('counts the four base faces and the scene atlases, and leaves out portraits, music and font slices', () => {
    const { files, problems } = coldPath(fakeDist(400));
    const paths = files.map((f) => f.path);
    expect(problems).toEqual([]);
    for (const face of ['NotoSansTC-Regular', 'NotoSansTC-Bold', 'LXGWWenKaiTC-Regular', 'LXGWWenKaiTC-Bold']) expect(paths).toContain(`assets/fonts/${face}.woff2`);
    for (const key of ['atlas-brain', 'atlas-common', 'atlas-exam', 'atlas-liver']) expect(paths).toContain(`assets/atlases/${key}.png`);
    expect(paths.some((p) => /portraits|audio|fonts\/extra|fonts-extra/.test(p))).toBe(false);
  });

  it('passes with a bundle of ordinary size', () => {
    const { problems, path } = checkPerfBudget(fakeDist(400));
    expect(problems).toEqual([]);
    expect(path.totalBytes).toBeLessThan(COLD_LIMIT_KB * 1000);
  });

  it('fails when the bundle grows past the limit, and says by how much the cold path stands', () => {
    const { problems } = checkPerfBudget(fakeDist(900));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/the cold path is \d+\.\d kB, over the 1750 kB limit/);
  });

  it('fails on a lower limit, so a limit that is never reached is not what keeps it green', () => {
    expect(checkPerfBudget(fakeDist(400), 1000).problems).toHaveLength(1);
  });

  it('fails naming a file the cold path needs and the build lacks, instead of counting it as 0 bytes', () => {
    const dist = fakeDist(400);
    rmSync(join(dist, 'assets', 'fonts', 'NotoSansTC-Bold.woff2'));
    const { problems } = checkPerfBudget(dist);
    expect(problems.some((p) => p.startsWith('assets/fonts/NotoSansTC-Bold.woff2:'))).toBe(true);
  });
});
