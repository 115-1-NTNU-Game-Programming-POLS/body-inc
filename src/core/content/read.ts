import { SCHEMAS, type ContentTypes, type SchemaName } from './generated.ts';
import { schemaProblemText, validate, type SchemaProblem } from './schema.ts';

export class ContentError extends Error {
  readonly problems: readonly SchemaProblem[];
  constructor(name: SchemaName, problems: readonly SchemaProblem[]) {
    super(`${name} content does not match its schema:\n  ${problems.map(schemaProblemText).join('\n  ')}`);
    this.problems = problems;
  }
}

export function schemaProblems(name: SchemaName, raw: unknown): SchemaProblem[] {
  return validate(SCHEMAS[name], raw);
}

/**
 * Checks raw JSON against its schema and returns it typed. Callers get the generated type, so
 * the cast below is the only place where untyped content becomes typed.
 */
export function readContent<N extends SchemaName>(name: N, raw: unknown): ContentTypes[N] {
  const problems = schemaProblems(name, raw);
  if (problems.length > 0) throw new ContentError(name, problems);
  return raw as ContentTypes[N];
}
