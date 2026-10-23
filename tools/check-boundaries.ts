/**
 * Boundary check for src/core (docs/architecture.md section 9). The core tsconfig already
 * rejects DOM and Phaser types; this catches what the compiler allows but the architecture
 * forbids: imports that leave core, Node built-ins, and nondeterministic sources.
 *
 *   node tools/check-boundaries.ts [coreDir]     exit 1 on any violation
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORBIDDEN_CALLS: ReadonlyArray<[RegExp, string]> = [
  [/\bMath\.random\s*\(/, 'Math.random (use core/rng.ts so replays stay deterministic)'],
  [/\bDate\.now\s*\(/, 'Date.now (rule time is ticks, not wall-clock time)'],
  [/\bnew\s+Date\s*\(/, 'new Date (rule time is ticks, not wall-clock time)'],
  [/\bperformance\.now\s*\(/, 'performance.now (rule time is ticks, not wall-clock time)'],
];

const IMPORT_RE = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Removes comments while leaving string and template literals intact ('src/*' is not a comment). */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
      out += ' ';
    } else if (c === '"' || c === "'" || c === '`') {
      const start = i++;
      while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
      out += src.slice(start, ++i);
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const SOURCE = /\.(?:[cm]?ts|[cm]?js)$/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : SOURCE.test(p) ? [p] : [];
  });
}

export function findViolations(coreDir: string): string[] {
  const root = resolve(coreDir);
  const out: string[] = [];
  for (const file of walk(root)) {
    const src = stripComments(readFileSync(file, 'utf8'));
    const where = relative(process.cwd(), file);
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2] ?? '';
      if (spec.startsWith('.')) {
        const target = resolve(dirname(file), spec);
        if (target !== root && !target.startsWith(root + sep)) out.push(`${where}: imports ${spec}, which is outside core`);
      } else {
        out.push(`${where}: imports package "${spec}"; core may only import other core modules`);
      }
    }
    for (const [re, why] of FORBIDDEN_CALLS) if (re.test(src)) out.push(`${where}: uses ${why}`);
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'core');
  const violations = findViolations(dir);
  for (const v of violations) console.log(v);
  console.log(`core boundary: ${violations.length} violation(s) in ${relative(process.cwd(), resolve(dir)) || '.'}`);
  process.exit(violations.length ? 1 : 0);
}
