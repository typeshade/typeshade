// Verifies: Rule 6.3 (docs/language-design.md; traced in reqs/).
// Change 0123: compile-time double values with explicit f32 precision boundaries.

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { fp64Lower } from '../../core/passes/fp64-lower.js';
import { splitF64 } from '../../core/fp64/df64-lib.js';
import { F64_SCALAR_TWINS } from '../../core/fp64/twins.js';
import { emitModule } from '../../core/backends/wgsl.js';
import { emitGlslModule } from '../../core/backends/glsl.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { hostFace } from './host-face.js';
import { compileTsSource } from './source-file.js';

const OVERFLOW =
  'Module const "K" is f64, but its value cannot be represented by two finite f32 words. ' +
  "Use a finite value within the emulated double's f32 range.";

function both(source: string) {
  const result = compile(source);
  const service = createTypeshadeLanguageService();
  service.openDocument('a.shade.ts', source);
  return { result, service, editor: service.getDiagnostics('a.shade.ts') };
}

function valueOf(expr: string, want: number, before = '', inferred = false) {
  const source = `"use typeshade";
${before}
const K${inferred ? '' : ': f64'} = ${expr};
export function k(): f64 { return K; }
`;
  const { result, service, editor } = both(source);
  expect(result.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  expect(editor).toEqual([]);
  expect(
    service.getHover('a.shade.ts', service.positionAt('a.shade.ts', source.indexOf('const K') + 6))
      ?.contents,
  ).toContain('f64');
  const constant = result.module.consts.find((c) => c.name === 'K')!;
  expect(constant.type).toEqual({ kind: 'f64' });
  expect(constant.valueExpr).toBeUndefined();
  expect(constant.cpuValue).toBe(want);
  expect(compileModule(result.module).fns.k!()).toBe(want);
  expect(compileModuleJs(result.module).fns.k!()).toBe(want);
  for (const flavor of ['float', 'integer'] as const) {
    const lowered = fp64Lower(result.module, { flavor });
    const pair = compileModule(lowered, { precision: 'f32' }).fns.k!();
    expect(pair).toEqual(splitF64(want));
    const wgsl = emitModule(result.module, { fp64Flavor: flavor });
    const glsl = emitGlslModule(result.module, undefined, { fp64Flavor: flavor });
    expect(wgsl).toMatch(/const K: vec2<f32> = vec2<f32>\(/);
    expect(glsl).toMatch(/const vec2 K = vec2\(/);
    expect(wgsl).not.toMatch(/const K[^\n]*df64_/);
    expect(glsl).not.toMatch(/const vec2 K[^\n]*df64_/);
  }
  return result;
}

describe('f64 module constants', () => {
  it.each([
    ['0.1', 0.1],
    ['-0.1', -0.1],
    ['2 * Math.PI', 2 * Math.PI],
    ['f64(1 / 3)', 1 / 3],
    ['-0.', -0],
    ['1e-50', 1e-50],
    ['3.4028234663852886e38', 3.4028234663852886e38],
  ] as const)('keeps the double of %s and emits its literal pair', (expr, want) => {
    valueOf(expr, want);
  });

  it.each([
    ['f64(f32(0.1))', Math.fround(0.1)],
    ['f64((-f32(0.1)))', -Math.fround(0.1)],
    ['f64(f32(0.1) + f32(0.2))', Math.fround(Math.fround(0.1) + Math.fround(0.2))],
    ['f64(f32(f64(1 / 3)))', Math.fround(1 / 3)],
    ['f64(sin(0.1))', Math.fround(Math.sin(Math.fround(0.1)))],
    ['f64(ceil(0.1))', 1],
    ['f64(f32(firstLeadingBit(i32(-1))))', -1],
    ['f64(f32(firstLeadingBit(u32(4294967295))))', 31],
    ['f64(f32(u32(0) - u32(1)))', Math.fround(4294967295)],
    ['f64(f32((16777216 + 1) - 1))', 16777215],
    ['f64(f32(((16777216 + 1) - 1) + 0))', 16777215],
    ['f64(f32(i32(((16777216 + 1) - 1) + 0)))', 16777215],
  ] as const)('preserves typed subexpressions of %s', (expr, want) => {
    valueOf(expr, want);
  });

  it('widens an earlier f32 recorded value and rounds each subsequent f32 operation', () => {
    valueOf('f64(A)', Math.fround(0.1), 'const A: f32 = 0.1;');
    valueOf('f64((A + 1) - A)', 0, 'const A: f32 = 16777216;');
    // Prior builtin declarations retain their own old double fold and GPU expression.
    valueOf('f64(A)', Math.fround(Math.sin(0.1)), 'const A: f32 = sin(0.1);');
    valueOf('f64(B)', 1, 'const A: f32 = 16777216; const B: f32 = abs((A + 1) - A);');
    valueOf('A / 2', Math.PI, 'const A: f64 = 2 * Math.PI;');
    valueOf('f64(1 / ((A + 0.5) - A - 0.5))', -2, 'const A: f32 = 16777216;', true);
  });

  it.each([
    ['f64(0.1)', 0.1],
    ['f64(-f32(0.1))', -Math.fround(0.1)],
    ['A', 0.1],
    ['A * 2', 0.2],
    ['sqrt(A)', Math.sqrt(0.1)],
  ] as const)('infers f64 for %s without losing precision boundaries', (expr, want) => {
    valueOf(expr, want, 'const A: f64 = 0.1;', true);
  });

  it('folds exactly the existing ten f64 builtins through the oracle definitions', () => {
    const cases = [
      ['abs', 'abs(f64(-0.1))', 0.1],
      ['cos', 'cos(f64(0.1))', Math.cos(0.1)],
      ['floor', 'floor(f64(-0.1))', -1],
      ['fract', 'fract(f64(1.25))', 0.25],
      ['max', 'max(f64(0.1), f64(0.2))', 0.2],
      ['min', 'min(f64(0.1), f64(0.2))', 0.1],
      ['mix', 'mix(f64(2), f64(5), f32(0.1))', 2 + 3 * Math.fround(0.1)],
      ['round', 'round(f64(2.5))', 2],
      ['sin', 'sin(f64(0.1))', Math.sin(0.1)],
      ['sqrt', 'sqrt(f64(2))', Math.sqrt(2)],
    ] as const;
    expect(cases.map(([name]) => name)).toEqual(F64_SCALAR_TWINS);
    for (const [, expr, want] of cases) valueOf(expr, want);
  });

  it('keeps qualified namespace and unwritten static constants in source order', () => {
    valueOf(
      'N.B + C.B',
      0.5,
      `namespace N {
  export const A: f64 = 0.1;
  export const B = N.A * 2;
}
class C {
  static A: f64 = 0.1;
  static B = this.A * 3;
}`,
    );
  });

  it('preserves existing scalar declarations after an f64 initializer', () => {
    const result = valueOf(
      'f64(f32(0.1))',
      Math.fround(0.1),
      `const F: f32 = f32(0.1);
const I: i32 = 3;
const U: u32 = 4;
const B: bool = true;`,
    );
    expect(result.module.consts.slice(0, 4).map((c) => [c.cpuValue, c.valueExpr])).toEqual([
      [0.1, undefined],
      [3, undefined],
      [4, undefined],
      [1, undefined],
    ]);
    const after = both(`"use typeshade";
const K = f64(-f32(0.1));
const F: f32 = f32(0.1);
export function k(): f32 { return F; }
`);
    expect(after.editor).toEqual([]);
    expect(after.result.module.consts[1]).toMatchObject({ cpuValue: 0.1 });
    expect(after.result.module.consts[1]!.valueExpr).toBeUndefined();
  });

  it.each(['f64(1e38) * 4', 'sqrt(f64(-1))', 'f64(3.4028234663852886e38) * 1.000001'])(
    'refuses %s once at its declaration',
    (expr) => {
      const source = `"use typeshade";
const K: f64 = ${expr};
const L = K / 2;
export function k(): f64 { const x = L; return x; }
`;
      const { result, editor } = both(source);
      expect(result.diagnostics.map((d) => [d.code, d.message])).toEqual([['TS8003', OVERFLOW]]);
      expect(editor.map((d) => [d.code, d.message])).toEqual([['TS8003', OVERFLOW]]);
      expect(result.diagnostics[0]!.start).toBe(source.indexOf('K: f64'));
      expect(result.wgsl).toBeUndefined();
    },
  );

  it('restores precision and static context after a refused initializer', () => {
    const { result, editor } = both(`"use typeshade";
class C {
  static K: f64 = f64(1e38) * 4;
  static F: f32 = f32(0.1);
}
const F: f32 = f32(0.1);
export function k(): f32 { return C.F + F; }
`);
    expect(result.diagnostics).toHaveLength(1);
    expect(editor).toHaveLength(1);
    expect(result.module.consts.map((c) => [c.name, c.cpuValue, c.valueExpr])).toEqual([
      ['C_F', 0.1, undefined],
      ['F', 0.1, undefined],
    ]);
  });

  it.each(['i32(1)', 'I'])('does not implicitly widen integer initializer %s', (expr) => {
    const { result, editor } = both(`"use typeshade";
const I: i32 = 1;
const K: f64 = ${expr};
export function k(): f64 { return K; }
`);
    const message =
      'Module const "K" is f64, but its initializer is i32. ' +
      'Cast it, e.g. f64(f32(...)), or change the annotation.';
    expect(result.diagnostics.map((d) => [d.code, d.message])).toEqual([['TS8003', message]]);
    expect(editor.map((d) => [d.code, d.message])).toEqual([['TS8003', message]]);
  });

  it('uses typed f32 values for float-to-integer conversion range checks', () => {
    valueOf('f64(f32(i32(f32(-2147483649))))', -2147483648, '', true);
    for (const [kind, written, rounded, bounds, clamp] of [
      ['i32', '2147483647', '2147483648', '-2147483648 to 2147483647', '-2147483648., 2147483647.'],
      ['u32', '4294967295', '4294967296', '0 to 4294967295', '0., 4294967295.'],
    ] as const) {
      const { result, editor } = both(`"use typeshade";
const K = f64(f32(${kind}(f32(${written}))));
export function k(): f64 { return K; }
`);
      const message =
        `${kind}(${rounded}) is out of range: ${kind === 'u32' ? 'a' : 'an'} ${kind} ` +
        `holds ${bounds}, and the two targets compute different values for a float that does not. ` +
        'Measured: u32(-1.) is 0 on WGSL and 4294967295 on GLSL ES 3.00, and u32(4.3e9) ' +
        'is 4294967295 there and 5032960 here. Clamp it first if you want one answer, ' +
        `e.g. ${kind}(clamp(x, ${clamp})).`;
      expect(result.diagnostics.map((d) => [d.code, d.message])).toEqual([['TS8003', message]]);
      expect(editor.map((d) => [d.code, d.message])).toEqual([['TS8003', message]]);
    }
  });

  it('keeps original diagnostics and editor types when a typed retry is not f64', () => {
    const initializer = 'f32(i32(f32(-2147483649)))';
    const sources = ['', ': f32'].map(
      (annotation) => `"use typeshade";
const K${annotation} = ${initializer};
const NEXT: f32 = 0.1;
export function k(): f32 { return NEXT; }
`,
    );
    const observed = sources.map((source) => {
      const { result, service, editor } = both(source);
      const start = source.indexOf(initializer);
      const records = compileTsSource(source)
        .expressions.filter((e) => e.start >= start && e.start < start + initializer.length)
        .map((e) => ({ start: e.start - start, length: e.length, type: e.type }));
      return {
        diagnostics: result.diagnostics.map((d) => [d.code, d.message]),
        editor: editor.map((d) => [d.code, d.message]),
        hover: service.getHover(
          'a.shade.ts',
          service.positionAt('a.shade.ts', source.indexOf('return NEXT') + 7),
        )?.contents,
        records,
      };
    });
    expect(observed[0]).toEqual(observed[1]);
    expect(observed[0]!.diagnostics).toHaveLength(1);
    expect(observed[0]!.diagnostics[0]![1]).toContain('i32(-2147483649) is out of range');
    expect(observed[0]!.hover).toContain('f32');
    expect(observed[0]!.records.some((e) => e.start === 0 && e.length === initializer.length)).toBe(
      false,
    );
  });

  it('retains refusals for nonconstant shapes and unsupported operations on both halves', () => {
    const constant =
      'Module const "K" must be constant: a scalar literal, a whole earlier module ' +
      'const, or supported scalar arithmetic and math builtins over those with a non-zero ' +
      'divisor. It cannot call a declared function or read a resource, component, field or element.';
    for (const [before, expr, code, message] of [
      [
        '',
        'ceil(f64(1))',
        'TS8036',
        'ceil has no emulated-double form; got f64. On an f64 the pass lowers abs, cos, floor, fract, max, min, mix, round, sin and sqrt — narrow first, e.g. ceil(f32(x)).',
      ],
      [
        '',
        'f64(1) % 2',
        'TS8003',
        'Cannot % f64: the emulated double has no remainder — the fp64 pass has a df64 body for + - * / and the comparisons only. Narrow first, e.g. f32(x) % f32(y).',
      ],
      ['const V = vec3(1., 2., 3.);', 'f64(V.x)', 'TS8003', constant],
      ['const V: array<f32, 2> = [1., 2.];', 'f64(V[0])', 'TS8003', constant],
      [
        'const A: f32 = 16777216;',
        'f64(1) / f64((A + 1) - A)',
        'TS8003',
        'Division by zero: "f64((A + 1) - A)" is 0 on every invocation. WGSL refuses it and GLSL ES 3.00 leaves it undefined.',
      ],
      [
        'function f(): f64 { return 1.; }',
        'f()',
        'TS8003',
        'Module const "K" must be constant, and "f()" calls a function this file declares. A module constant is folded before any function exists, so build the value inside the function that reads it.',
      ],
      ['declare const U: uniform<f32>;', 'f64(U)', 'TS8022', 'Unknown identifier "U".'],
      ['let A: f32 = 1.;', 'f64(A)', 'TS8022', 'Unknown identifier "A".'],
      [
        '',
        'sin(0.1)',
        'TS8003',
        'Module const "K" is f64, but its initializer is f32. Cast it, e.g. f64(...), or change the annotation.',
      ],
      [
        'const B: bool = true;',
        'B',
        'TS8003',
        'Module const "K" is f64, but its initializer is bool. Change the annotation to bool.',
      ],
    ]) {
      const { result, editor } = both(`"use typeshade";
${before}
const K: f64 = ${expr};
const L = K;
export function k(): f64 { return L; }
`);
      expect(
        result.diagnostics.map((d) => [d.code, d.message]),
        expr,
      ).toEqual([[code, message]]);
      expect(
        editor.map((d) => [d.code, d.message]),
        expr,
      ).toEqual([[code, message]]);
    }
  });

  it('links imported f64 constants and exports a scalar host value', () => {
    const source = `"use typeshade";
import { A as BASE } from './a';
export const K = BASE * 2;
export function k(): f64 { return K; }
`;
    const dependency = '"use typeshade"; export const A: f64 = 0.1;';
    const readDocument = (name: string) => (name === '/app/a.ts' ? dependency : undefined);
    const result = compile(source, { fileName: '/app/m.shade.ts', readDocument });
    expect(result.diagnostics).toEqual([]);
    expect(compileModule(result.module).fns.k!()).toBe(0.2);
    const service = createTypeshadeLanguageService({ readDocument });
    service.openDocument('/app/m.shade.ts', source);
    expect(service.getDiagnostics('/app/m.shade.ts')).toEqual([]);
    const face = hostFace(source, { fileName: '/app/m.shade.ts', readDocument });
    expect(face.diagnostics).toEqual([]);
    expect(face.view).toContain('export declare const K: f64;');
    expect(face.code).toContain('0.2');
  });
});
