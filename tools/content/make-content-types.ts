/**
 * Writes src/core/content/generated.ts from content/schema/*.schema.json: the schemas themselves
 * (core cannot import files outside src/core) and one TypeScript type per schema and $def, so a
 * field renamed in a schema and not in code fails to compile (docs/architecture.md section 7).
 *
 *   node tools/content/make-content-types.ts            write the file
 *   node tools/content/make-content-types.ts --check    exit 1 if it is out of date or a schema is invalid
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA_KEYWORDS, type Schema } from '../../src/core/content/schema.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SCHEMA_DIR = join(ROOT, 'content', 'schema');
const OUT = join(ROOT, 'src', 'core', 'content', 'generated.ts');

/** File stem to SCHEMAS key: schedule-cards.schema.json -> scheduleCards. */
export const schemaKey = (file: string): string =>
  file.replace(/\.schema\.json$/, '').replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/**
 * Problems that would make the schema mean less than it says: unsupported keywords, an object
 * without an explicit additionalProperties (unknown fields would pass silently), dangling refs.
 */
export function lintSchema(name: string, schema: Schema): string[] {
  const out: string[] = [];
  const defs = new Set(Object.keys(schema.$defs ?? {}));
  if (!schema.title || !/^[A-Z][A-Za-z]*File$/.test(schema.title)) out.push(`${name}: title must be a PascalCase type name ending in File`);
  const visit = (s: Schema, at: string) => {
    for (const k of Object.keys(s)) if (!SCHEMA_KEYWORDS.includes(k)) out.push(`${name} ${at}: unsupported keyword "${k}"`);
    const isObject = s.type === 'object' || (Array.isArray(s.type) && s.type.includes('object')) || s.properties !== undefined;
    if (isObject && s.additionalProperties === undefined) out.push(`${name} ${at}: object must set additionalProperties`);
    if (s.$ref !== undefined && !defs.has(s.$ref.replace('#/$defs/', ''))) out.push(`${name} ${at}: $ref "${s.$ref}" does not resolve`);
    for (const r of s.required ?? []) if (!s.properties?.[r]) out.push(`${name} ${at}: required "${r}" is not a property`);
    for (const [k, p] of Object.entries(s.properties ?? {})) visit(p, `${at}.${k}`);
    for (const [k, p] of Object.entries(s.$defs ?? {})) visit(p, `$defs.${k}`);
    if (typeof s.additionalProperties === 'object') visit(s.additionalProperties, `${at}.*`);
    if (s.items) visit(s.items, `${at}[]`);
    s.anyOf?.forEach((p, i) => visit(p, `${at}|${i}`));
  };
  visit(schema, '(root)');
  return out;
}

const pad = (n: number) => '  '.repeat(n);
const doc = (s: Schema, indent: number) => (s.description ? `${pad(indent)}/** ${s.description.replace(/\*\//g, '*\\/')} */\n` : '');
const wrap = (t: string) => (t.includes(' | ') ? `(${t})` : t);

function typeOf(s: Schema, indent: number): string {
  if (s.$ref) return s.$ref.replace('#/$defs/', '');
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.enum) return s.enum.map((e) => JSON.stringify(e)).join(' | ');
  if (s.anyOf) return s.anyOf.map((a) => typeOf(a, indent)).join(' | ');
  const types = s.type === undefined ? (s.properties ? ['object'] : []) : typeof s.type === 'string' ? [s.type] : [...s.type];
  if (types.length === 0) return 'unknown';
  return types.map((t) => {
    switch (t) {
      case 'string': return 'string';
      case 'number': case 'integer': return 'number';
      case 'boolean': return 'boolean';
      case 'null': return 'null';
      case 'array': return `readonly ${wrap(s.items ? typeOf(s.items, indent) : 'unknown')}[]`;
      default: return objectType(s, indent);
    }
  }).join(' | ');
}

function objectType(s: Schema, indent: number): string {
  const props = Object.entries(s.properties ?? {});
  const extra = typeof s.additionalProperties === 'object' ? `Readonly<Record<string, ${typeOf(s.additionalProperties, indent)}>>` : undefined;
  if (props.length === 0) return extra ?? 'Readonly<Record<string, never>>';
  const req = new Set(s.required ?? []);
  const body = props.map(([k, p]) => `${doc(p, indent + 1)}${pad(indent + 1)}readonly ${k}${req.has(k) ? '' : '?'}: ${typeOf(p, indent + 1)};`).join('\n');
  const obj = `{\n${body}\n${pad(indent)}}`;
  return extra ? `${obj} & ${extra}` : obj;
}

function declare(name: string, s: Schema): string {
  const t = typeOf(s, 0);
  return t.startsWith('{') && !t.includes('} & ') ? `${doc(s, 0)}export interface ${name} ${t}\n` : `${doc(s, 0)}export type ${name} = ${t};\n`;
}

export function generate(dir = SCHEMA_DIR): { text: string; problems: string[] } {
  const files = readdirSync(dir).filter((f) => f.endsWith('.schema.json')).sort();
  const problems: string[] = [];
  const schemas = new Map<string, Schema>();
  const names = new Map<string, string>();
  for (const f of files) {
    const schema = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Schema;
    problems.push(...lintSchema(f, schema));
    for (const n of [schema.title ?? '', ...Object.keys(schema.$defs ?? {})]) {
      if (names.has(n)) problems.push(`${f}: type name "${n}" is also used by ${names.get(n)}`);
      names.set(n, f);
    }
    schemas.set(schemaKey(f), schema);
  }
  const keys = [...schemas.keys()];
  const parts = [
    '// Generated by tools/content/make-content-types.ts from content/schema/*.schema.json. Do not edit;',
    '// change the schema and run `node tools/content/make-content-types.ts`.',
    "import type { Schema } from './schema.ts';",
    '',
    `export const SCHEMAS: { readonly [K in SchemaName]: Schema } = ${JSON.stringify(Object.fromEntries(schemas), null, 2)};`,
    '',
    `export type SchemaName = ${keys.map((k) => JSON.stringify(k)).join(' | ')};`,
    '',
    'export interface ContentTypes {',
    ...keys.map((k) => `  readonly ${k}: ${schemas.get(k)!.title};`),
    '}',
    '',
  ];
  for (const [, s] of schemas) {
    parts.push(declare(s.title!, s));
    for (const [n, d] of Object.entries(s.$defs ?? {})) parts.push(declare(n, d));
  }
  return { text: parts.join('\n').replace(/\n+$/, '\n'), problems };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { text, problems } = generate();
  for (const p of problems) console.log(p);
  const where = relative(process.cwd(), OUT);
  if (problems.length > 0) {
    console.log(`content schemas: ${problems.length} problem(s)`);
    process.exit(1);
  }
  if (process.argv.includes('--check')) {
    const current = existsSync(OUT) ? readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current !== text) {
      console.log(`content types: ${where} is out of date; run node tools/content/make-content-types.ts`);
      process.exit(1);
    }
    console.log('content types: up to date');
  } else {
    writeFileSync(OUT, text);
    console.log(`content types: wrote ${where}`);
  }
}
