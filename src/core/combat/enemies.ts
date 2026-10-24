import { OBJECT_CLASSES } from '../rooms/classes.ts';

/**
 * Enemy categories and solutions (design doc 5.5). Solving a non-defeatable enemy is a flag on
 * the data, never a large health pool, so no upgrade or assist can route around it (5.1).
 * A solution may name the object class that carries it in a map (sleep needs a Bed); solutions
 * that are partner skills or player verbs (guards, refuse) need no object.
 */
export type Category = 'defeatable' | 'reforming' | 'immune';

export interface EnemyDef {
  readonly id: string;
  readonly category: Category;
  readonly solution?: string;
}

export interface SolutionDef {
  readonly id: string;
  readonly object?: string;
}

export interface EnemyTable {
  readonly enemies: ReadonlyMap<string, EnemyDef>;
  readonly solutions: ReadonlyMap<string, SolutionDef>;
}

export class EnemyTableError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`enemy table is invalid:\n  ${problems.join('\n  ')}`);
    this.problems = problems;
  }
}

const CATEGORIES: readonly string[] = ['defeatable', 'reforming', 'immune'];
type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

export function loadEnemyTable(raw: unknown): EnemyTable {
  if (!isObj(raw) || raw['version'] !== 1 || !isObj(raw['solutions']) || !Array.isArray(raw['enemies'])) {
    throw new EnemyTableError(['expected { "version": 1, "solutions": {...}, "enemies": [...] }']);
  }
  const problems: string[] = [];
  const solutions = new Map<string, SolutionDef>();
  for (const [id, s] of Object.entries(raw['solutions'])) {
    if (!isObj(s)) { problems.push(`solution "${id}": not an object`); continue; }
    const { object, ...rest } = s;
    for (const k of Object.keys(rest)) problems.push(`solution "${id}": unknown field "${k}"`);
    if (object !== undefined && (typeof object !== 'string' || !(object in OBJECT_CLASSES))) {
      problems.push(`solution "${id}": object must be a Tiled class, got ${JSON.stringify(object)}`);
      continue;
    }
    solutions.set(id, object === undefined ? { id } : { id, object });
  }
  const enemies = new Map<string, EnemyDef>();
  raw['enemies'].forEach((e, i) => {
    if (!isObj(e)) return void problems.push(`enemies[${i}]: not an object`);
    const { id, category, solution, ...rest } = e;
    const where = typeof id === 'string' ? `enemy "${id}"` : `enemies[${i}]`;
    for (const k of Object.keys(rest)) problems.push(`${where}: unknown field "${k}"`);
    if (typeof id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(id)) return void problems.push(`${where}: id must be lower_snake_case`);
    if (typeof category !== 'string' || !CATEGORIES.includes(category)) return void problems.push(`${where}: category must be ${CATEGORIES.join(', ')}`);
    if (category === 'defeatable' && solution !== undefined) problems.push(`${where}: a defeatable enemy has no solution`);
    if (category !== 'defeatable' && (typeof solution !== 'string' || !solutions.has(solution))) {
      problems.push(`${where}: a ${category} enemy needs a solution from the solutions table`);
    }
    if (enemies.has(id)) problems.push(`${where}: defined twice`);
    enemies.set(id, { id, category: category as Category, ...(typeof solution === 'string' ? { solution } : {}) });
  });
  if (problems.length > 0) throw new EnemyTableError(problems);
  return { enemies, solutions };
}
