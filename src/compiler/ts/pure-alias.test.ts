// Verifies: Rule 3.9 (docs/language-design.md; traced in reqs/).
// Change 0126: only a requested pure root retains its terminal target whole.
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { linkProgram } from './link.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const D = '"use typeshade";\n';
const TARGET = '/project/new/k.shade.ts';
const ALIAS = '/project/k.shade.ts';
const CHAIN = '/project/chain.shade.ts';
type Files = Record<string, string>;
const aliases = (source: string): Files => ({
  [TARGET]: source,
  [ALIAS]: D + 'export * from "./new/k.shade.ts";',
  [CHAIN]: D + 'export * from "./k.shade.ts";',
});
function checked(files: Files, file: string) {
  const readDocument = (name: string) => files[name];
  const result = compile(files[file]!, { fileName: file, readDocument });
  expect(result.diagnostics, file).toEqual([]);
  const service = createTypeshadeLanguageService({ readDocument });
  service.openDocument(file, files[file]!);
  try {
    expect(service.getDiagnostics(file), file).toEqual([]);
    expect(service.getCompiledOutput(file, 'wgsl')?.text, file).toBe(result.wgsl);
  } finally {
    service.closeDocument(file);
  }
  return result;
}

describe('pure shader root aliases (0126)', () => {
  it('preserves an unused first binding and an uncalled private helper through a chain', () => {
    const files = aliases(
      D +
        `
interface Params { gain: f32; }
declare const unused: uniform<Params>;
declare const live: uniform<Params>;
function uncalled(): f32 { return 3.; }
export const fs = fragment(function fs(): vec4 { return vec4(live.gain); });
`,
    );
    const direct = checked(files, TARGET);
    expect(direct.module.bindings.map((b) => [b.name, b.group, b.binding])).toEqual([
      ['unused', 0, 0],
      ['live', 0, 1],
    ]);
    expect(direct.module.funcs.map((f) => f.name)).toContain('uncalled');
    for (const file of [ALIAS, CHAIN]) {
      const result = checked(files, file);
      expect(result.module.bindings).toEqual(direct.module.bindings);
      expect(result.module.funcs).toEqual(direct.module.funcs);
      expect(result.wgsl).toBe(direct.wgsl);
      expect(result.glsl).toBeDefined();
      expect(result.glsl).toEqual(direct.glsl);
    }
  });

  it('retains a terminal directive even when no declaration unit is present', () => {
    const files = aliases(D + '"enable f16";\nexport {};');
    for (const file of [TARGET, ALIAS, CHAIN])
      expect(checked(files, file).module.enables).toEqual(['f16']);
  });
});

const SIMPLE =
  D +
  `
declare const unused: uniform<f32>;
function uncalled(): f32 { return 9.; }
export function answer(): f32 { return 7.; }
`;

describe('the retention boundary', () => {
  it.each([
    ['named', 'export { answer } from "./new/k.shade.ts";'],
    ['namespace', 'export * as ns from "./new/k.shade.ts";'],
    ['type-only', 'export type * from "./new/k.shade.ts";'],
    ['mixed', 'const local: f32 = 1.; export * from "./new/k.shade.ts";'],
    ['two-stars', 'export * from "./new/k.shade.ts"; export * from "./other.shade.ts";'],
    ['empty-statement', '; export * from "./new/k.shade.ts";'],
    ['extra-directive', '"use strict"; export * from "./new/k.shade.ts";'],
    ['attributes', 'export * from "./new/k.shade.ts" with { type: "json" };'],
    ['assertions', 'export * from "./new/k.shade.ts" assert { type: "json" };'],
    [
      'selected-import',
      'import { answer } from "./k.shade.ts"; export function get(): f32 { return answer(); }',
    ],
    [
      'namespace-import',
      'import * as ns from "./k.shade.ts"; export function get(): f32 { return ns.answer(); }',
    ],
  ])('%s remains selective', (_name, body) => {
    const files = {
      ...aliases(SIMPLE),
      '/project/other.shade.ts': D + 'export const extra: f32 = 1.;',
    };
    const file = '/project/control.shade.ts';
    files[file] = D + body;
    const result = compile(files[file]!, { fileName: file, readDocument: (name) => files[name] });
    expect(result.module.bindings).toEqual([]);
    expect(result.module.funcs.map((f) => f.name)).not.toContain('uncalled');
    // Attribute semantics and the existing type-star behavior are not changed here.
    if (_name === 'empty-statement') {
      const service = createTypeshadeLanguageService({ readDocument: (name) => files[name] });
      service.openDocument(file, files[file]!);
      expect(result.diagnostics.map((d) => [d.code, d.message])).toEqual(
        service.getDiagnostics(file).map((d) => [d.code, d.message]),
      );
      expect(result.diagnostics.map((d) => d.code)).toEqual(['TS8014']);
      service.closeDocument(file);
    } else if (_name === 'attributes' || _name === 'assertions') {
      const service = createTypeshadeLanguageService({ readDocument: (name) => files[name] });
      service.openDocument(file, files[file]!);
      expect(result.diagnostics).toEqual([]);
      // Existing editor limitation; the alias change grants no attribute support.
      expect(service.getDiagnostics(file).map((d) => [d.code, d.message])).toEqual([
        [2318, "Cannot find global type 'ImportAttributes'."],
      ]);
      service.closeDocument(file);
    } else checked(files, file);
  });

  it('ignores comments and optional terminators, but keeps a mixed terminal whole', () => {
    const files = aliases(SIMPLE);
    files[ALIAS] =
      '// retained path\n"use typeshade"\n/* alias */ export * from "./new/k.shade.ts"';
    files[TARGET] += '\nexport { extra } from "../other.shade.ts";';
    files['/project/other.shade.ts'] =
      D + 'function omitted(): f32 { return 2.; } export const extra: f32 = 1.;';
    const direct = checked(files, TARGET);
    for (const file of [ALIAS, CHAIN]) {
      const result = checked(files, file);
      expect(result.module.bindings).toEqual(direct.module.bindings);
      expect(result.module.funcs).toEqual(direct.module.funcs);
      expect(result.module.funcs.map((f) => f.name)).not.toContain('omitted');
      expect(result.module.consts).toEqual(direct.module.consts);
    }
  });

  it.each(['self', 'pair'] as const)('finishes a %s alias-only cycle without a target', (kind) => {
    const files = {
      [ALIAS]: D + `export * from "./${kind === 'self' ? 'k' : 'chain'}.shade.ts";`,
      [CHAIN]: D + 'export * from "./k.shade.ts";',
    };
    const reads: string[] = [];
    const linked = linkProgram([{ fileName: ALIAS, text: files[ALIAS] }], {
      readDocument: (name) => {
        reads.push(name);
        return files[name];
      },
    });
    expect(linked.diagnostics).toEqual([]);
    expect(linked.files.map((f) => f.name)).toEqual(kind === 'self' ? [ALIAS] : [ALIAS, CHAIN]);
    expect(reads.filter((name) => name.endsWith('.shade.ts'))).toEqual(
      kind === 'self' ? [] : [CHAIN],
    );
    const result = checked(files, ALIAS);
    expect(result.module.bindings).toEqual([]);
    expect(result.module.funcs).toEqual([]);
  });

  it('uses the canonical file identities already supplied by a custom resolver', () => {
    const files: Files = {
      'C:/project/alias.shade.ts': D + 'export * from "target";',
      'C:/project/target.shade.ts': SIMPLE,
    };
    const edges: string[] = [];
    const result = compile(files['C:/project/alias.shade.ts']!, {
      fileName: 'C:\\project\\alias.shade.ts',
      readDocument: (name) => files[name],
      resolveImport: (from, specifier) => {
        edges.push(`${from}:${specifier}`);
        return 'C:\\project\\target.shade.ts';
      },
    });
    expect(result.diagnostics).toEqual([]);
    expect(edges).toEqual(['C:/project/alias.shade.ts:target']);
    expect(result.module.bindings.map((b) => b.name)).toEqual(['unused']);
    expect(result.eval('answer')).toBe(7);
    const service = createTypeshadeLanguageService({
      readDocument: (name) => files[name],
      resolveImport: () => 'C:/project/target.shade.ts',
    });
    service.openDocument('C:/project/alias.shade.ts', files['C:/project/alias.shade.ts']!);
    expect(service.getDiagnostics('C:/project/alias.shade.ts')).toEqual([]);
    expect(service.getCompiledOutput('C:/project/alias.shade.ts', 'wgsl')?.text).toBe(result.wgsl);
    service.closeDocument('C:/project/alias.shade.ts');
  });
});

describe('complete target inventory and validation', () => {
  it('preserves every declaration kind, private entries, dependency collisions and explicit slots', () => {
    const files = aliases(
      D +
        `
import { fromDependency } from "./dep.shade.ts";
interface Params { gain: f32; }
interface PrivateType { value: f32; }
declare const unused: uniform<Params>;
const explicit = uniform<Params>({ group: 1, binding: 4 });
declare const live: uniform<Params>;
const secret: f32 = 3.;
const tuning: override<f32> = 2.;
let state: f32 = 0.;
function helper(): f32 { state += 1.; return secret + tuning + state; }
const hidden = compute([1], function hidden(): void { helper(); });
export function answer(): f32 { return fromDependency(); }
export const fs = fragment(function fs(): vec4 { return vec4(live.gain + explicit.gain); });
`,
    );
    files['/project/new/dep.shade.ts'] =
      D +
      `
function helper(): f32 { return 4.; }
function unrelated(): f32 { return 99.; }
export function fromDependency(): f32 { return helper(); }
`;
    const direct = checked(files, TARGET);
    expect(direct.module.bindings.map((b) => [b.name, b.group, b.binding])).toEqual([
      ['unused', 0, 0],
      ['explicit', 1, 4],
      ['live', 0, 5],
    ]);
    expect(direct.module.funcs.map((f) => f.name)).toEqual(
      expect.arrayContaining(['helper', 'dep_helper', 'hidden', 'fs']),
    );
    expect(direct.module.vars?.map((v) => v.name)).toContain('state');
    expect(direct.module.overrides?.map((o) => o.name)).toContain('tuning');
    expect(direct.module.consts.map((c) => c.name)).toContain('secret');
    for (const file of [ALIAS, CHAIN]) {
      const result = checked(files, file);
      for (const key of ['bindings', 'funcs', 'structs', 'consts', 'vars', 'overrides'] as const)
        expect(result.module[key], key).toEqual(direct.module[key]);
      expect(result.eval('answer')).toBe(4);
      expect(result.wgsl).toBe(direct.wgsl);
      const linked = linkProgram([{ fileName: file, text: files[file]! }], {
        readDocument: (name) => files[name],
      });
      expect(linked.source).toContain('interface PrivateType');
      expect(linked.source).not.toContain('function unrelated');
      expect(linked.exports.map((e) => e.name)).toEqual(['answer', 'fs']);
    }
  });

  it('retains package identities and existing private prefixes without changing slots', () => {
    const target = '/project/node_modules/lib/index.shade.ts';
    const files: Files = {
      [target]:
        D +
        `import { helper } from "./dep.shade.ts";
declare const unused: uniform<f32>;
function min(x: f32): f32 { return x; }
export function answer(x: f32): f32 { return min(x) + helper(x); }`,
      '/project/node_modules/lib/dep.shade.ts':
        D + 'export function helper(x: f32): f32 { return min(x, 0.); }',
      '/project/node_modules/lib/package.json': JSON.stringify({
        name: 'lib',
        version: '1.0.0',
        exports: { '.': { typeshade: './index.shade.ts' } },
      }),
      [ALIAS]: D + 'export * from "lib";',
      [CHAIN]: D + 'export * from "./k.shade.ts";',
    };
    const direct = checked(files, target);
    expect(direct.module.funcs.map((f) => f.name)).toContain('index_min');
    for (const file of [ALIAS, CHAIN]) {
      const result = checked(files, file);
      expect(result.module.funcs.map((f) => f.name)).toEqual(['helper', 'lib_index_min', 'answer']);
      expect(result.module.bindings).toEqual(direct.module.bindings);
      expect(result.eval('answer', [-2])).toBe(-4);
      expect(result.module.funcs.find((f) => f.name === 'lib_index_min')?.span?.file).toBe(target);
    }
  });

  it.each([
    ['private body', 'function bad(): f32 { return missing; }', 'TS8022'],
    ['anonymous default', 'export default function(): f32 { return 1.; }', 'TS8020'],
    ['default await expression', 'export default await 1;', 'TS8013'],
    ['default spread expression', 'export default [...[1]];', 'TS8013'],
    ['unnamed statement', '1 + 2;', 'TS8014'],
  ])('reports the original %s diagnostic through every alias', (_name, invalid, code) => {
    const files = aliases(D + invalid + '\nexport function ok(): f32 { return 1.; }');
    const options = { readDocument: (name: string) => files[name] };
    const direct = compile(files[TARGET]!, { ...options, fileName: TARGET });
    expect(direct.diagnostics.map((d) => d.code)).toEqual([code]);
    const service = createTypeshadeLanguageService(options);
    for (const [file, source] of Object.entries(files)) service.openDocument(file, source);
    try {
      for (const file of [ALIAS, CHAIN]) {
        const result = compile(files[file]!, { ...options, fileName: file });
        expect(result.diagnostics).toEqual(direct.diagnostics);
        expect(result.wgsl).toBeUndefined();
        expect(service.getDiagnostics(file)).toEqual([]);
      }
      const editor = service.getDiagnostics(TARGET);
      expect(editor.map((d) => [d.code, d.message])).toEqual(
        direct.diagnostics.map((d) => [d.code, d.message]),
      );
      expect(editor[0]!.range.start).toEqual({
        line: direct.diagnostics[0]!.line - 1,
        character: direct.diagnostics[0]!.character - 1,
      });
      expect(editor[0]!.uri).toBe(TARGET);
    } finally {
      for (const file of Object.keys(files)) service.closeDocument(file);
    }
  });

  it('invalidates the alias analysis after its private target declaration changes', () => {
    const files = aliases(SIMPLE);
    const service = createTypeshadeLanguageService({ readDocument: (file) => files[file] });
    for (const [file, source] of Object.entries(files)) service.openDocument(file, source);
    expect(service.getCompiledOutput(CHAIN, 'wgsl')?.text).toContain('fn uncalled');
    service.updateDocument(TARGET, SIMPLE.replace('return 9.;', 'return missing;'));
    const output = service.getCompiledOutput(CHAIN, 'wgsl');
    expect(output?.diagnostics.map((d) => [d.code, d.uri])).toEqual([['TS8022', TARGET]]);
    expect(service.getDiagnostics(CHAIN)).toEqual([]);
    expect(service.getDiagnostics(TARGET).map((d) => d.code)).toEqual(['TS8022']);
    for (const file of Object.keys(files)) service.closeDocument(file);
  });
});
