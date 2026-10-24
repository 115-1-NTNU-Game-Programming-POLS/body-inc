/**
 * A JSON Schema subset for content files (docs/architecture.md section 7). It is written here
 * rather than taken from a library so core stays dependency-free and problems come back as
 * codes that tools can phrase in Chinese. A keyword outside the subset throws instead of being
 * ignored, so a schema can never look stricter than the check it gets.
 */
export interface Schema {
  readonly $schema?: string;
  readonly title?: string;
  readonly description?: string;
  readonly $defs?: Readonly<Record<string, Schema>>;
  readonly $ref?: string;
  readonly type?: SchemaType | readonly SchemaType[];
  readonly const?: unknown;
  readonly enum?: readonly unknown[];
  readonly anyOf?: readonly Schema[];
  readonly properties?: Readonly<Record<string, Schema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | Schema;
  readonly items?: Schema;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly uniqueItems?: boolean;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly exclusiveMinimum?: number;
  readonly minLength?: number;
  readonly pattern?: string;
}

export type SchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';

export const SCHEMA_KEYWORDS: readonly string[] = [
  '$schema', 'title', 'description', '$defs', '$ref', 'type', 'const', 'enum', 'anyOf', 'properties', 'required',
  'additionalProperties', 'items', 'minItems', 'maxItems', 'uniqueItems', 'minimum', 'maximum', 'exclusiveMinimum',
  'minLength', 'pattern',
];

export type SchemaProblemCode =
  | 'type' | 'required' | 'unknown-field' | 'const' | 'enum' | 'any-of' | 'min-items' | 'max-items'
  | 'unique-items' | 'minimum' | 'maximum' | 'exclusive-minimum' | 'min-length' | 'pattern';

export interface SchemaProblem {
  /** Where in the file, e.g. `enemies[2].category` or `strings["stamp.case_closed"]`; '' is the root. */
  readonly path: string;
  readonly code: SchemaProblemCode;
  /** What the schema allows, already formatted (a type list, enum values, a bound). */
  readonly expected: string;
  /** The offending value or field name, JSON-formatted and shortened. */
  readonly got: string;
}

export class SchemaDefinitionError extends Error {}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const join = (path: string, key: string): string =>
  IDENT.test(key) ? (path ? `${path}.${key}` : key) : `${path}[${JSON.stringify(key)}]`;

function show(v: unknown): string {
  const s = JSON.stringify(v) ?? String(v);
  return s.length > 40 ? `${s.slice(0, 37)}...` : s;
}

function typeOf(v: unknown): SchemaType | 'other' {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : Number.isFinite(v) ? 'number' : 'other';
  if (typeof v === 'string' || typeof v === 'boolean' || typeof v === 'object') return typeof v as SchemaType;
  return 'other';
}

const matchesType = (v: unknown, t: SchemaType): boolean => {
  const actual = typeOf(v);
  return actual === t || (t === 'number' && actual === 'integer');
};

export const isRecord = (v: unknown): v is Record<string, unknown> => typeOf(v) === 'object';

function resolveRef(root: Schema, ref: string): Schema {
  const m = /^#\/\$defs\/(.+)$/.exec(ref);
  const target = m ? root.$defs?.[m[1]!] : undefined;
  if (!target) throw new SchemaDefinitionError(`cannot resolve $ref "${ref}"; only "#/$defs/<name>" is supported`);
  return target;
}

function walk(root: Schema, s: Schema, v: unknown, path: string, out: SchemaProblem[]): void {
  for (const k of Object.keys(s)) {
    if (!SCHEMA_KEYWORDS.includes(k)) throw new SchemaDefinitionError(`unsupported schema keyword "${k}" at ${path || 'the root'}`);
  }
  if (s.$ref !== undefined) return walk(root, resolveRef(root, s.$ref), v, path, out);
  const push = (code: SchemaProblemCode, expected: string, got: string = show(v)) => out.push({ path, code, expected, got });

  if (s.type !== undefined) {
    const types = typeof s.type === 'string' ? [s.type] : s.type;
    // A wrong type makes every other keyword meaningless, so stop at the first problem.
    if (!types.some((t) => matchesType(v, t))) {
      push('type', types.join(' | '));
      return;
    }
  }
  if (s.const !== undefined && JSON.stringify(v) !== JSON.stringify(s.const)) push('const', show(s.const));
  if (s.enum && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(v))) push('enum', s.enum.map(show).join(', '));
  if (s.anyOf && !s.anyOf.some((sub) => validateAt(root, sub, v, path).length === 0)) {
    push('any-of', s.anyOf.map((sub) => describe(root, sub)).join(' | '));
  }

  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum) push('minimum', String(s.minimum));
    if (s.maximum !== undefined && v > s.maximum) push('maximum', String(s.maximum));
    if (s.exclusiveMinimum !== undefined && v <= s.exclusiveMinimum) push('exclusive-minimum', String(s.exclusiveMinimum));
  }
  if (typeof v === 'string') {
    if (s.minLength !== undefined && v.length < s.minLength) push('min-length', String(s.minLength));
    if (s.pattern !== undefined && !new RegExp(s.pattern, 'u').test(v)) push('pattern', s.pattern);
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) push('min-items', String(s.minItems), String(v.length));
    if (s.maxItems !== undefined && v.length > s.maxItems) push('max-items', String(s.maxItems), String(v.length));
    if (s.uniqueItems && new Set(v.map((x) => JSON.stringify(x))).size !== v.length) push('unique-items', 'no repeats');
    if (s.items) v.forEach((x, i) => walk(root, s.items!, x, `${path}[${i}]`, out));
  }
  if (isRecord(v)) {
    for (const k of s.required ?? []) {
      if (!(k in v)) out.push({ path: join(path, k), code: 'required', expected: k, got: '' });
    }
    for (const [k, x] of Object.entries(v)) {
      const prop = s.properties?.[k];
      if (prop) walk(root, prop, x, join(path, k), out);
      else if (s.additionalProperties === false) out.push({ path: join(path, k), code: 'unknown-field', expected: Object.keys(s.properties ?? {}).join(', '), got: k });
      else if (typeof s.additionalProperties === 'object') walk(root, s.additionalProperties, x, join(path, k), out);
    }
  }
}

function validateAt(root: Schema, s: Schema, v: unknown, path: string): SchemaProblem[] {
  const out: SchemaProblem[] = [];
  walk(root, s, v, path, out);
  return out;
}

/** A short type-like description, used for anyOf alternatives. */
function describe(root: Schema, s: Schema): string {
  if (s.$ref) return s.$ref.replace('#/$defs/', '');
  if (s.const !== undefined) return show(s.const);
  if (s.enum) return s.enum.map(show).join(' | ');
  if (s.type === 'array' && s.items) return `${describe(root, s.items)}[]`;
  if (s.type) return typeof s.type === 'string' ? s.type : s.type.join(' | ');
  return 'any';
}

export function validate(schema: Schema, value: unknown): SchemaProblem[] {
  return validateAt(schema, schema, value, '');
}

/** English form for loaders' exceptions; tools phrase the same codes in Chinese. */
export function schemaProblemText(p: SchemaProblem): string {
  const at = p.path || '(root)';
  switch (p.code) {
    case 'required': return `${at}: missing required field`;
    case 'unknown-field': return `${at}: unknown field "${p.got}"`;
    case 'type': return `${at}: expected ${p.expected}, got ${p.got}`;
    default: return `${at}: ${p.code} ${p.expected}, got ${p.got}`;
  }
}
