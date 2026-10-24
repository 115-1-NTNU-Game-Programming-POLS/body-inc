import type { EnemiesFile, Enemy } from '../content/generated.ts';
import { schemaProblems } from '../content/read.ts';
import { schemaProblemText } from '../content/schema.ts';
import { OBJECT_CLASSES } from '../rooms/classes.ts';

/**
 * Enemy categories and solutions (design doc 5.5). Solving a non-defeatable enemy is a flag on
 * the data, never a large health pool, so no upgrade or assist can route around it (5.1).
 * A solution may name the object class that carries it in a map (sleep needs a Bed); solutions
 * that are partner skills or player verbs (guards, refuse) need no object.
 * The field shapes come from content/schema/enemies.schema.json; this file checks references.
 */
export type Category = Enemy['category'];
/** The five shared archetypes of design doc 5.3; reskinned per chapter. */
export type Archetype = NonNullable<Enemy['archetype']>;
export type EnemyDef = Enemy;

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

export function loadEnemyTable(raw: unknown): EnemyTable {
  const shape = schemaProblems('enemies', raw);
  if (shape.length > 0) throw new EnemyTableError(shape.map(schemaProblemText));
  const file = raw as EnemiesFile;

  const problems: string[] = [];
  const solutions = new Map<string, SolutionDef>();
  for (const [id, s] of Object.entries(file.solutions)) {
    if (s.object !== undefined && !(s.object in OBJECT_CLASSES)) {
      problems.push(`solution "${id}": object must be a Tiled class, got ${JSON.stringify(s.object)}`);
      continue;
    }
    solutions.set(id, s.object === undefined ? { id } : { id, object: s.object });
  }
  const enemies = new Map<string, EnemyDef>();
  for (const e of file.enemies) {
    const where = `enemy "${e.id}"`;
    if (e.category === 'defeatable' && e.solution !== undefined) problems.push(`${where}: a defeatable enemy has no solution`);
    if (e.category !== 'defeatable' && (e.solution === undefined || !solutions.has(e.solution))) {
      problems.push(`${where}: a ${e.category} enemy needs a solution from the solutions table`);
    }
    if (e.performance !== undefined && e.category !== 'defeatable') problems.push(`${where}: only defeatable enemies have a performance`);
    if (e.clings === true && e.category !== 'reforming') problems.push(`${where}: only reforming enemies cling`);
    if (enemies.has(e.id)) problems.push(`${where}: defined twice`);
    enemies.set(e.id, e);
  }
  if (problems.length > 0) throw new EnemyTableError(problems);
  return { enemies, solutions };
}
