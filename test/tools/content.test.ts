import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SchemaDefinitionError, validate, type Schema } from '../../src/core/index.ts';
import { checkContent } from '../../tools/check-content.ts';
import { generate, lintSchema } from '../../tools/content/make-content-types.ts';

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});

/** A copy of the real content folder that a test may break. */
function contentCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), 'body-inc-content-'));
  temps.push(dir);
  cpSync('content', dir, { recursive: true });
  return dir;
}

const edit = (dir: string, file: string, patch: (j: any) => void) => {
  const p = join(dir, file);
  const j = JSON.parse(readFileSync(p, 'utf8'));
  patch(j);
  writeFileSync(p, JSON.stringify(j));
};

const withCards = (fixture: string) => {
  const dir = contentCopy();
  mkdirSync(join(dir, 'cards'));
  cpSync(`test/fixtures/content/${fixture}`, join(dir, 'cards', 'schedule.json'));
  return dir;
};

describe('content check (build plan S4)', () => {
  it('the real content passes', () => {
    expect(checkContent('content')).toEqual([]);
  });

  it('an unknown placeholder is reported; {host} and the per-caller ones are not', () => {
    const dir = contentCopy();
    edit(dir, 'strings/zh-TW.json', (j) => {
      j.strings['title.ended'].text = '{hots}今天的班到此結束。';
      j.strings['title.stale'].text = '{host}的舊存檔對不上。';
    });
    expect(checkContent(dir)).toEqual([expect.stringMatching(/zh-TW\.json「title\.ended」：不認得的佔位符「\{hots\}」/)]);
  });

  it('report wording may not use {host}: the report calls the host 宿主', () => {
    const dir = contentCopy();
    edit(dir, 'strings/zh-TW.json', (j) => { j.strings['report.dept.company'].text = '{host}公司'; });
    expect(checkContent(dir)).toEqual([expect.stringMatching(/「report\.dept\.company」：報告文字不能用 \{host\}/)]);
  });

  it('a schedule card in the spec format passes, and one with an unknown field fails', () => {
    expect(checkContent(withCards('schedule-good.json'))).toEqual([]);
    const problems = checkContent(withCards('schedule-unknown-field.json'));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/cards\/schedule\.json cards\[0\]\.deptDemand：不認得的欄位「deptDemand」/);
  });

  it('reports a file no schema claims and a file that is not JSON', () => {
    const dir = contentCopy();
    writeFileSync(join(dir, 'foods.json'), '{}');
    writeFileSync(join(dir, 'tags.json'), '{ "version": 1, ');
    const problems = checkContent(dir);
    expect(problems.some((p) => p.includes('foods.json：沒有對應的 schema'))).toBe(true);
    expect(problems.some((p) => p.includes('tags.json：不是有效的 JSON'))).toBe(true);
  });

  it('a misspelled parameter fails, and every parameter needs a provenance note', () => {
    const dir = contentCopy();
    edit(dir, 'params.json', (j) => { j.defaults.sleepNeeds = j.defaults.sleepNeed; delete j.defaults.sleepNeed; });
    const problems = checkContent(dir);
    expect(problems).toContainEqual(expect.stringMatching(/defaults\.sleepNeed：缺少必填欄位/));
    expect(problems).toContainEqual(expect.stringMatching(/defaults\.sleepNeeds：不認得的欄位/));

    const dir2 = contentCopy();
    edit(dir2, 'params.json', (j) => { delete j.notes.sleepNeed; j.notes.oldParam = 'DOC'; });
    expect(checkContent(dir2).filter((p) => p.includes('notes'))).toEqual([
      expect.stringMatching(/參數「sleepNeed」沒有來源說明/),
      expect.stringMatching(/「oldParam」不是 defaults 中的參數/),
    ]);
  });

  it('passes valid files on to the game loaders, which check references', () => {
    const dir = contentCopy();
    edit(dir, 'enemies.json', (j) => { j.enemies.find((e: { id: string }) => e.id === 'salesman').solution = 'sleep'; });
    expect(checkContent(dir)).toEqual([expect.stringMatching(/enemies\.json：enemy "salesman": a defeatable enemy has no solution/)]);
  });

  it('a chapter file must match its schema and be named after its id', () => {
    const dir = contentCopy();
    edit(dir, 'chapters/greybox.json', (j) => { j.links[0].a = 'greybox/greybox-room'; });
    expect(checkContent(dir)).toEqual([expect.stringMatching(/chapters\/greybox\.json links\[0\]\.a：格式不符/)]);
    const dir2 = contentCopy();
    edit(dir2, 'chapters/greybox.json', (j) => { j.id = 'brain'; });
    expect(checkContent(dir2)).toEqual([expect.stringMatching(/chapters\/greybox\.json：id「brain」必須與檔名「greybox」相同/)]);
    const dir3 = contentCopy();
    edit(dir3, 'chapters/greybox.json', (j) => { j.links[0].extra = true; });
    expect(checkContent(dir3)).toEqual([expect.stringMatching(/links\[0\]\.extra：不認得的欄位「extra」/)]);
  });

  it('a speaker needs a name tag string and a plain id, and the operator is not a speaker', () => {
    const dir = contentCopy();
    edit(dir, 'speakers.json', (j) => { j.speakers.ghost = { style: 'box', portrait: false }; });
    expect(checkContent(dir)).toEqual([expect.stringMatching(/speakers\.json：說話者「ghost」在 .*zh-TW\.json 沒有名牌文字，請新增「speaker\.ghost」/)]);

    const dir2 = contentCopy();
    edit(dir2, 'speakers.json', (j) => { j.speakers.Bad_Id = { style: 'box', portrait: false }; });
    edit(dir2, 'strings/zh-TW.json', (j) => { j.strings['speaker.Bad_Id'] = { text: '壞', fact: '' }; });
    expect(checkContent(dir2)).toEqual([expect.stringMatching(/說話者代號「Bad_Id」只能用小寫英文/)]);

    const dir3 = contentCopy();
    edit(dir3, 'speakers.json', (j) => { j.speakers.operator = { style: 'box', portrait: false }; });
    edit(dir3, 'strings/zh-TW.json', (j) => { j.strings['speaker.operator'] = { text: '營運長', fact: '' }; });
    expect(checkContent(dir3)).toEqual([expect.stringMatching(/「operator」是玩家回覆專用的代號/)]);
  });

  it('a speaker entry must match its schema', () => {
    const dir = contentCopy();
    edit(dir, 'speakers.json', (j) => { j.speakers.brain.style = 'bubble'; delete j.speakers.gut.portrait; });
    const problems = checkContent(dir);
    expect(problems).toContainEqual(expect.stringMatching(/speakers\.json speakers\.brain\.style：必須是/));
    expect(problems).toContainEqual(expect.stringMatching(/speakers\.json speakers\.gut\.portrait：缺少必填欄位「portrait」/));
  });

  it('checks feedback notes against every strings file', () => {
    const dir = contentCopy();
    edit(dir, 'strings/zh-TW.json', (j) => { delete j.strings['solution.guards']; });
    expect(checkContent(dir)).toEqual([expect.stringMatching(/note "solution\.guards" is not in content\/strings/)]);
  });
});

describe('schema validator', () => {
  const S: Schema = {
    type: 'object', additionalProperties: false, required: ['a'],
    properties: {
      a: { type: 'integer', minimum: 1, maximum: 3 },
      b: { type: 'array', minItems: 1, maxItems: 2, uniqueItems: true, items: { enum: ['x', 'y'] } },
      c: { type: 'string', minLength: 1, pattern: '^[a-z]+$' },
      d: { anyOf: [{ type: 'number', exclusiveMinimum: 0 }, { type: 'array', items: { type: 'number' } }] },
      e: { const: 1 },
      f: { type: 'object', additionalProperties: { $ref: '#/$defs/N' } },
    },
    $defs: { N: { type: 'number' } },
  };
  const codes = (v: unknown) => validate(S, v).map((p) => `${p.path}:${p.code}`);

  it('accepts a valid value', () => {
    expect(codes({ a: 2, b: ['x'], c: 'ok', d: [1], e: 1, f: { k: 1 } })).toEqual([]);
  });

  it('reports each kind of problem at its path', () => {
    expect(codes({})).toEqual(['a:required']);
    expect(codes({ a: 1.5 })).toEqual(['a:type']);
    expect(codes({ a: 0, z: 1 })).toEqual(['a:minimum', 'z:unknown-field']);
    expect(codes({ a: 4 })).toEqual(['a:maximum']);
    expect(codes({ a: 1, b: [] })).toEqual(['b:min-items']);
    expect(codes({ a: 1, b: ['x', 'x', 'y'] })).toEqual(['b:max-items', 'b:unique-items']);
    expect(codes({ a: 1, b: ['q'] })).toEqual(['b[0]:enum']);
    expect(codes({ a: 1, c: '' })).toEqual(['c:min-length', 'c:pattern']);
    expect(codes({ a: 1, d: 0 })).toEqual(['d:any-of']);
    expect(codes({ a: 1, e: 2 })).toEqual(['e:const']);
    expect(codes({ a: 1, f: { 'x.y': 'n' } })).toEqual(['f["x.y"]:type']);
    expect(codes([])).toEqual([':type']);
  });

  it('throws on a keyword it does not implement instead of ignoring it', () => {
    expect(() => validate({ type: 'string', format: 'email' } as Schema, 'a')).toThrow(SchemaDefinitionError);
    expect(() => validate({ $ref: '#/$defs/Missing' }, 1)).toThrow(SchemaDefinitionError);
  });
});

describe('schema lint and type generation', () => {
  it('flags an object that would let unknown fields through, and unsupported keywords', () => {
    expect(lintSchema('x.schema.json', { title: 'XFile', type: 'object', properties: { a: { type: 'string', format: 'uri' } as Schema } })).toEqual([
      'x.schema.json (root): object must set additionalProperties',
      'x.schema.json (root).a: unsupported keyword "format"',
    ]);
  });

  it('the committed types are what the schemas generate, and the real schemas lint clean', () => {
    const { text, problems } = generate();
    expect(problems).toEqual([]);
    expect(readFileSync('src/core/content/generated.ts', 'utf8').replace(/\r\n/g, '\n')).toBe(text);
  });

  it('a schema field becomes a typed readonly property', () => {
    const dir = mkdtempSync(join(tmpdir(), 'body-inc-schema-'));
    temps.push(dir);
    writeFileSync(join(dir, 'foo-bar.schema.json'), JSON.stringify({
      title: 'FooBarFile', type: 'object', additionalProperties: false, required: ['n'],
      properties: { n: { type: 'integer', description: 'Count.' }, k: { enum: ['a', 'b'] }, l: { type: 'array', items: { $ref: '#/$defs/Item' } } },
      $defs: { Item: { type: ['string', 'null'] } },
    }));
    const { text, problems } = generate(dir);
    expect(problems).toEqual([]);
    expect(text).toContain('readonly fooBar: FooBarFile;');
    expect(text).toContain('  /** Count. */\n  readonly n: number;\n  readonly k?: "a" | "b";\n  readonly l?: readonly Item[];');
    expect(text).toContain('export type Item = string | null;');
  });
});
