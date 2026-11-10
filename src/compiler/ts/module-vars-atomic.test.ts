// Verifies: Rule 6.5, Rule 12.4, Rule 12.6, Rule 12.7 (docs/language-design.md; traced in reqs/).
// #321 control#16: Tint in Chromium 156.0.8078.4/SwiftShader reports:
// "'atomic' variables must have 'storage' or 'workgroup' address space".
// This includes private structs and arrays. The same shapes in workgroup and
// read_write storage memory pass shader validation (measured 2026-11-07).
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { compile } from './compile.js';
import { collectModuleVars } from './module-vars.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import type { StructDecl } from '../../core/ir/nodes.js';
import type { TsCompilerDiagnostic } from './source-file.js';

const FILE = '/module-atomic.shade.ts';
const REASON = 'an atomic lives in storage or workgroup memory, not in a per-invocation variable';
const ENTRY = '@compute([1]) export function main() {}';

function paired(source: string, refusal?: { text: string; message: string }) {
  const result = compile(source, { fileName: FILE });
  const service = createTypeshadeLanguageService();
  service.openDocument(FILE, source);
  try {
    const editor = service.getDiagnostics(FILE);
    if (refusal === undefined) {
      expect(result.diagnostics).toEqual([]);
      expect(editor).toEqual([]);
      expect(result.wgsl).toBeDefined();
      expect(service.getCompiledOutput(FILE, 'wgsl')?.text).toBe(result.wgsl);
    } else {
      const start = source.lastIndexOf(refusal.text);
      expect(start).toBeGreaterThanOrEqual(0);
      const before = source.slice(0, start).split('\n');
      const line = before.length;
      const character = before.at(-1)!.length + 1;
      expect(result.diagnostics).toEqual([
        {
          code: 'TS8033',
          message: refusal.message,
          category: 'error',
          fileName: FILE,
          start,
          length: refusal.text.length,
          line,
          character,
          endLine: line,
          endCharacter: character + refusal.text.length,
        },
      ]);
      expect(
        editor.map(({ code, message, severity, uri, range }) => ({
          code,
          message,
          severity,
          uri,
          range,
        })),
      ).toEqual([
        {
          code: 'TS8033',
          message: refusal.message,
          severity: 'error',
          uri: FILE,
          range: {
            start: { line: line - 1, character: character - 1 },
            end: { line: line - 1, character: character - 1 + refusal.text.length },
          },
        },
      ]);
      expect(result.wgsl).toBeUndefined();
    }
    return result;
  } finally {
    service.closeDocument(FILE);
  }
}

const SHAPES = [
  { name: 'direct u32', prefix: '', type: 'atomic<u32>', shown: 'atomic<u32>' },
  {
    name: 'direct i32 array',
    prefix: '',
    type: 'array<atomic<i32>, 2>',
    shown: 'array<atomic<i32>, 2>',
  },
  { name: 'class', prefix: 'class S { value: atomic<u32>; }', type: 'S', shown: 'S' },
  { name: 'interface', prefix: 'interface S { value: atomic<u32>; }', type: 'S', shown: 'S' },
  { name: 'object alias', prefix: 'type S = { value: atomic<u32> };', type: 'S', shown: 'S' },
  {
    name: 'array of structs',
    prefix: 'class S { value: atomic<u32>; }',
    type: 'array<S, 2>',
    shown: 'array<S, 2>',
  },
  {
    name: 'nested struct and array',
    prefix: 'class S { value: atomic<u32>; } class O { inner: array<S, 2>; }',
    type: 'O',
    shown: 'O',
  },
  {
    name: 'type alias',
    prefix: 'class S { value: atomic<u32>; } type A = S;',
    type: 'A',
    shown: 'S',
  },
  {
    name: 'inherited i32 field',
    prefix: 'class S { value: atomic<i32>; } class D extends S { other: u32; }',
    type: 'D',
    shown: 'D',
  },
  {
    name: 'readonly field',
    prefix: 'class S { readonly value: atomic<u32>; }',
    type: 'S',
    shown: 'S',
  },
  {
    name: 'namespace struct',
    prefix: 'namespace N { export class S { value: atomic<u32>; } }',
    type: 'N.S',
    shown: 'N.S',
  },
  {
    name: 'generic struct',
    prefix: 'class Box<T> { value: T; }',
    type: 'Box<atomic<u32>>',
    shown: 'Box<atomic<u32>>',
  },
] as const;

describe('atomic-containing module variables', () => {
  for (const shape of SHAPES) {
    it(`refuses private ${shape.name} at its complete type annotation`, () => {
      paired(`"use typeshade";\n${shape.prefix}\nlet s: ${shape.type};\n${ENTRY}`, {
        text: shape.type,
        message: `"s" cannot be ${shape.shown}: ${REASON}.`,
      });
    });
    for (const space of ['workgroup', 'storage'] as const) {
      it(`preserves ${space} ${shape.name}`, () => {
        const declaration =
          space === 'workgroup'
            ? `let s: workgroup<${shape.type}>;`
            : `declare const s: storage<${shape.type}, "read_write">;`;
        const result = paired(`"use typeshade";\n${shape.prefix}\n${declaration}\n${ENTRY}`);
        expect(result.wgsl).toContain(
          space === 'workgroup' ? 'var<workgroup> s:' : 'var<storage, read_write> s:',
        );
      });
    }
  }

  it('keeps ordinary nested private values', () => {
    paired(
      `"use typeshade";\nclass S { value: u32; }\nclass O { inner: array<S, 2>; }\nlet s: O;\n${ENTRY}`,
    );
  });

  it('does not offer a private variable as the remedy for an atomic-containing workgroup initializer', () => {
    paired(
      `"use typeshade";\nclass S { value: atomic<u32>; }\ndeclare const source: storage<S, "read_write">;\nlet s: workgroup<S> = source;\n${ENTRY}`,
      {
        text: 'source',
        message:
          '"s" is workgroup memory and takes no initializer: it is zero at the start of each workgroup. Assign it inside the entry.',
      },
    );
  });

  for (const use of ['atomicAdd(s.value, 1);', 'const value = s.value;', 's.value = s.value;']) {
    it(`does not cascade after the refused declaration: ${use}`, () => {
      paired(
        `"use typeshade";\nclass S { value: atomic<u32>; }\nlet s: S;\n@compute([1]) export function main() { ${use} }`,
        {
          text: 'S',
          message: `"s" cannot be S: ${REASON}.`,
        },
      );
    });
  }

  it('terminates a cyclic struct lookup and still finds an atomic after the back edge', () => {
    const source = ts.createSourceFile(
      FILE,
      '"use typeshade"; class S {} let s: S;',
      ts.ScriptTarget.Latest,
      true,
    );
    const diagnostics: TsCompilerDiagnostic[] = [];
    const structs: StructDecl[] = [
      {
        name: 'S',
        fields: [
          { name: 'next', type: { kind: 'struct', name: 'S' } },
          { name: 'value', type: { kind: 'atomic', elem: 'u32' } },
        ],
      },
    ];
    expect(collectModuleVars(source, diagnostics, undefined, [], structs)).toEqual([]);
    expect(diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      { code: 'TS8033', message: `"s" cannot be S: ${REASON}.` },
    ]);
  });

  it('terminates an atomic-free cycle without inventing an atomic refusal', () => {
    // Only the collector is under test: a cyclic struct is not a valid emitted shader.
    const source = ts.createSourceFile(
      FILE,
      '"use typeshade"; class S {} let s: S;',
      ts.ScriptTarget.Latest,
      true,
    );
    const diagnostics: TsCompilerDiagnostic[] = [];
    const structs: StructDecl[] = [
      { name: 'S', fields: [{ name: 'next', type: { kind: 'struct', name: 'S' } }] },
    ];
    expect(collectModuleVars(source, diagnostics, undefined, [], structs)).toEqual([
      { name: 's', space: 'private', type: { kind: 'struct', name: 'S' } },
    ]);
    expect(diagnostics).toEqual([]);
  });
});
