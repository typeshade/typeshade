// Verifies: Rule 12.6, Rule 12.7 (docs/language-design.md; traced in reqs/).
// #321 control#9, measured 2026-11-07 with Tint in Chromium 156.0.8078.4/SwiftShader:
// emitted module/local/static index 5 is refused as "index 5 out of bounds [0..3]", while
// index 3 is accepted. Float-derived indices and captured helper parameters below are
// accepted by Tint, so the bound proof must not use their CPU-only constant values.
import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';
import { TS_CODES } from './codes.js';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

describe('constant index OOB', () => {
  it('accepts xs[0] and xs[3] on array<f32, 4>', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function at(xs: array<f32, 4>): f32 {
        return xs[3];
      }
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  });

  it('rejects xs[4] on array<f32, 4>', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function at(xs: array<f32, 4>): f32 {
        return xs[4];
      }
    `);
    expect(r.diagnostics.some((d) => d.code === TS_CODES.INDEX_OOB)).toBe(true);
    expect(r.diagnostics.some((d) => /out of range/.test(d.message))).toBe(true);
  });

  it('rejects xs[-1]', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function at(xs: array<f32, 4>): f32 {
        return xs[-1];
      }
    `);
    expect(r.diagnostics.some((d) => d.code === TS_CODES.INDEX_OOB)).toBe(true);
  });

  it('rejects v[3] on vec3', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function at(v: vec3): f32 {
        return v[3];
      }
    `);
    expect(r.diagnostics.some((d) => d.code === TS_CODES.INDEX_OOB)).toBe(true);
  });

  it('leaves runtime xs[i] as a plain index (UB on the GPU)', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function at(xs: array<f32, 4>, i: i32): f32 {
        return xs[i];
      }
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const ret = r.funcs[0]!.body[0];
    if (ret!.s === 'return') expect(ret.expr?.op).toBe('index');
  });
});

const FILE = '/index-bounds.shade.ts';

function pairedIndex(source: string, access?: string, value?: number, bound = 4) {
  const compiled = compile(source, { fileName: FILE });
  const service = createTypeshadeLanguageService();
  service.openDocument(FILE, source);
  try {
    const editor = service.getDiagnostics(FILE);
    if (access === undefined) {
      expect(compiled.diagnostics).toEqual([]);
      expect(editor).toEqual([]);
      expect(compiled.wgsl).toBeDefined();
      expect(service.getCompiledOutput(FILE, 'wgsl')?.text).toBe(compiled.wgsl);
    } else {
      const start = source.lastIndexOf(access);
      expect(start).toBeGreaterThanOrEqual(0);
      const before = source.slice(0, start).split('\n');
      const line = before.length;
      const character = before[before.length - 1]!.length + 1;
      const message = `Index ${value} is out of range for length ${bound}.`;
      expect(compiled.diagnostics).toEqual([
        {
          code: 'TS8016',
          message,
          category: 'error',
          fileName: FILE,
          start,
          length: access.length,
          line,
          character,
          endLine: line,
          endCharacter: character + access.length,
        },
      ]);
      expect(
        editor.map((d) => ({
          code: d.code,
          message: d.message,
          severity: d.severity,
          uri: d.uri,
          range: d.range,
        })),
      ).toEqual([
        {
          code: 'TS8016',
          message,
          severity: 'error',
          uri: FILE,
          range: {
            start: { line: line - 1, character: character - 1 },
            end: { line: line - 1, character: character - 1 + access.length },
          },
        },
      ]);
      expect(compiled.wgsl).toBeUndefined();
    }
    return compiled;
  } finally {
    service.closeDocument(FILE);
  }
}

const indexed = (
  globals: string,
  locals: string,
  index: string,
  type = 'array<f32, 4>',
  result = 'f32',
) =>
  `"use typeshade";\n${globals}\nexport function at(a: ${type}): ${result} {\n  ${locals}\n  return a[${index}];\n}\n`;

describe('constant index bounds in the compiler and editor (#321 control#9)', () => {
  it.each([
    ['literal', '', '', '5', 5, 'array<f32, 4>', 'f32', 4],
    ['module const', 'const N: u32 = 5;', '', 'N', 5, 'array<f32, 4>', 'f32', 4],
    ['local const', '', 'const N: u32 = 5;', 'N', 5, 'array<f32, 4>', 'f32', 4],
    [
      'static readonly',
      'class C { static readonly N: u32 = 5; }',
      '',
      'C.N',
      5,
      'array<f32, 4>',
      'f32',
      4,
    ],
    [
      'namespace const',
      'namespace C { export const N: u32 = 5; }',
      '',
      'C.N',
      5,
      'array<f32, 4>',
      'f32',
      4,
    ],
    ['parenthesized arithmetic', 'const N: i32 = 3;', '', '(N + 2)', 5, 'array<f32, 4>', 'f32', 4],
    ['negative const', 'const N: i32 = -1;', '', 'N', -1, 'array<f32, 4>', 'f32', 4],
    ['vector', 'const N: u32 = 3;', '', 'N', 3, 'vec3', 'f32', 3],
    ['matrix column', 'const N: u32 = 2;', '', 'N', 2, 'mat2x3', 'vec3', 2],
  ] as const)(
    'refuses %s with the literal diagnostic and authored access span',
    (_name, globals, locals, index, value, type, result, bound) => {
      pairedIndex(indexed(globals, locals, index, type, result), `a[${index}]`, value, bound);
    },
  );

  it.each([0, 3])('accepts index %i through module, local and static constants', (value) => {
    for (const [globals, locals, index] of [
      [`const N: u32 = ${value};`, '', 'N'],
      ['', `const N: u32 = ${value};`, 'N'],
      [`class C { static readonly N: u32 = ${value}; }`, '', 'C.N'],
    ]) {
      const compiled = pairedIndex(indexed(globals!, locals!, index!));
      expect(compiled.eval('at', [[10, 20, 30, 40]])).toBe([10, 20, 30, 40][value]);
    }
  });

  it.each([
    ['integer alias', 'const N: u32 = 4;', 'const I: u32 = N + 1;', 'I', 5],
    ['integer builtin', 'const N: i32 = max(i32(3), i32(5));', '', 'N', 5],
    ['unsigned underflow', 'const N: u32 = 0;', '', 'N - 1', 4294967295],
    ['integer conversion', 'const N: u32 = 4294967295;', '', 'i32(N)', -1],
  ] as const)('proves %s using integer arithmetic', (_name, globals, locals, index, value) => {
    pairedIndex(indexed(globals, locals, index), `a[${index}]`, value);
  });

  it('preserves unsigned wrapping and integer division at valid indices', () => {
    for (const [globals, index, expected] of [
      ['const N: u32 = 4294967295;', 'N + 2', 20],
      ['const N: i32 = 7;', 'N / 2', 40],
    ]) {
      const result = pairedIndex(indexed(globals as string, '', index as string));
      expect(result.eval('at', [[10, 20, 30, 40]])).toBe(expected);
    }
  });

  it.each([
    ['parameter', 'export function at(a: array<f32, 4>, N: i32): f32 { return a[N]; }'],
    [
      'mutable',
      'export function at(a: array<f32, 4>): f32 { let N: i32 = 5; N = 0; return a[N]; }',
    ],
    [
      'mutable alias',
      'export function at(a: array<f32, 4>): f32 { let N: i32 = 5; const I: i32 = N; return a[I]; }',
    ],
    [
      'override',
      'const N: override<u32> = 5; export function at(a: array<f32, 4>): f32 { return a[N]; }',
    ],
    [
      'shadowed parameter',
      'const N: i32 = 5; export function at(a: array<f32, 4>, N: i32): f32 { return a[N]; }',
    ],
    [
      'declared function',
      'function index(): i32 { return 5; } export function at(a: array<f32, 4>): f32 { return a[index()]; }',
    ],
    [
      'captured const',
      'export function at(a: array<f32, 4>): f32 { const N: i32 = 5; function read(): f32 { return a[N]; } return read(); }',
    ],
    [
      'captured mutable',
      'export function at(a: array<f32, 4>): f32 { let N: i32 = 5; function read(): f32 { return a[N]; } N = 0; return read(); }',
    ],
    [
      'runtime-sized array',
      'const N: u32 = 5; declare const a: storage<array<f32>>; export function at(): f32 { return a[N]; }',
    ],
  ])('keeps %s indexing outside the constant proof', (_name, body) => {
    pairedIndex(`"use typeshade";\n${body}`);
  });

  it('resolves a local shadow instead of the module constant', () => {
    const result = pairedIndex(indexed('const N: i32 = 5;', 'const N: i32 = 1;', 'N'));
    expect(result.eval('at', [[10, 20, 30, 40]])).toBe(20);
  });

  it.each([
    [
      'module f32 arithmetic',
      'const A: f32 = 16777221.; const B: f32 = 16777216.;',
      '',
      'i32(A - B)',
      5,
    ],
    [
      'module builtin',
      'const A: f32 = 16777216.; const B: f32 = abs((A + 1.) - A);',
      '',
      'i32(B)',
      1,
    ],
    [
      'module integer alias',
      'const A: f32 = 16777216.; const B: f32 = abs((A + 1.) - A); const I: i32 = i32(B);',
      '',
      'I',
      1,
    ],
    [
      'local integer alias',
      'const A: f32 = 16777216.; const B: f32 = abs((A + 1.) - A);',
      'const I: i32 = i32(B);',
      'I',
      1,
    ],
  ] as const)(
    'does not use the CPU value of %s as a GPU bound proof',
    (_name, globals, locals, index, bound) => {
      const result = pairedIndex(indexed(globals, locals, index, `array<f32, ${bound}>`));
      expect(result.wgsl).toContain('i32(');
    },
  );
});
