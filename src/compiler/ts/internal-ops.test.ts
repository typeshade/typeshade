// The compiler-internal operations of the libm's source are not names of the language (change
// 0042, Amendment A1; OD-3). An author's file that calls one is refused, and both halves say
// so in the same words: `compile()` and the language service (Rule 12.7).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileLibmSource } from './libm-source.js';
import { INTERNAL_OPS } from './internal-ops.js';
import { LIBM_F32 } from '../../core/passes/precision.js';
import { BUILTINS } from '../../core/cpu-runtime.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { SHADE_DTS } from '../../language-service/ambient.js';

/** A call of each internal operation with arguments of its types. */
const CALLS: Readonly<Record<string, string>> = {
  __f64Hi: '__f64Hi(x)',
  __f64Lo: '__f64Lo(x)',
  __f64FromWords: '__f64FromWords(u32(1), u32(2))',
  __f64ToI32: '__f64ToI32(x)',
  __u32ToF64: '__u32ToF64(u32(1))',
};

const program = (call: string): string =>
  `"use typeshade";\nexport function f(x: f64): f64 {\n  const y = ${call};\n  return x;\n}\n`;

const editorDiagnostics = (source: string): string[] => {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', source);
  return service.getDiagnostics('a.ts').map((d) => `${String(d.code)} ${String(d.message)}`);
};

const compilerDiagnostics = (source: string): string[] =>
  compile(source).diagnostics.map((d) => `${d.code} ${d.message}`);

describe('an author cannot write a compiler-internal operation', () => {
  it('the test names every internal operation', () => {
    expect(Object.keys(CALLS).sort()).toEqual(Object.keys(INTERNAL_OPS).sort());
  });

  // The ids the CPU engines alone carry: the internal operations, the libm's f32 routines and
  // the rounding step.
  const names = [...Object.keys(CALLS), ...Object.values(LIBM_F32), '__fround'];

  for (const name of names) {
    it(`${name}: compile() and the language service refuse it as a name nothing declares`, () => {
      const source = program(CALLS[name] ?? `${name}(f32(x))`);
      const sentence = `TS8004 Unknown function "${name}". Declare it in this file, or import it from another shader module.`;
      expect(compilerDiagnostics(source)).toEqual([sentence]);
      expect(editorDiagnostics(source)).toEqual([sentence]);
      // No shader text and no oracle for the refused program.
      const result = compile(source);
      expect(result.wgsl).toBeUndefined();
      expect(() => result.eval('f', [1])).toThrow();
    });

    it(`${name}: the ambient library does not declare it`, () => {
      expect(SHADE_DTS).not.toContain(name);
    });
  }

  it('the valid neighbour compiles on both halves', () => {
    const source = program('f64(f32(x))');
    expect(compilerDiagnostics(source)).toEqual([]);
    expect(editorDiagnostics(source)).toEqual([]);
  });

  it('what the libm source does without stays refused for an author on both halves', () => {
    // The f64 forms that sin and cos did not need (change 0042, Amendment A1): not added.
    for (const call of ['i32(x)', 'u32(x)', 'trunc(x)', 'ceil(x)', 'x % x', 'ldexp(x, 2)']) {
      const source = program(call);
      const fromCompiler = compilerDiagnostics(source);
      expect([call, fromCompiler.length]).toEqual([call, 1]);
      expect(editorDiagnostics(source)).toEqual(fromCompiler);
    }
    // The bits of an f64 are not a bitcast.
    const source = program('bitcast<u32>(x)');
    expect(compilerDiagnostics(source)[0]).toMatch(/^TS8003 bitcast<u32> reads the bits of an f32/);
    expect(editorDiagnostics(source)).toEqual(compilerDiagnostics(source));
  });

  it('an author who declares a function under an internal name calls that function', () => {
    const source = `"use typeshade";
function __f64Hi(x: f32): f32 { return x + 1.0; }
function __sinF32(x: f32): f32 { return x * 2.0; }
export function f(x: f32): f32 { return __f64Hi(x) + __sinF32(x) + sin(x); }
`;
    expect(compilerDiagnostics(source)).toEqual([]);
    expect(editorDiagnostics(source)).toEqual([]);
    const module = compile(source).module;
    const expected = Math.fround(
      Math.fround(Math.fround(0.5 + 1) + Math.fround(0.5 * 2)) +
        (BUILTINS['__sinF32']!(0.5) as number),
    );
    for (const build of [compileModule, compileModuleJs]) {
      const f = build(module, { precision: 'f32' }).fns['f'] as (x: number) => number;
      expect(f(0.5)).toBe(expected);
    }
  });
});

describe('the libm compile lowers the internal operations', () => {
  const SOURCE = `"use typeshade";
export function hi(x: f64): u32 { return __f64Hi(x); }
export function lo(x: f64): u32 { return __f64Lo(x); }
export function make(h: u32, l: u32): f64 { return __f64FromWords(h, l); }
export function toInt(x: f64): i32 { return __f64ToI32(x); }
export function fromUint(n: u32): f64 { return __u32ToF64(n); }
`;
  const compiled = compileLibmSource(SOURCE, 'internal.shade.ts');

  it('with no diagnostic', () => {
    expect(compiled.diagnostics).toEqual([]);
  });

  it('the interpreter and the generated JavaScript compute each one alike', () => {
    for (const build of [compileModule, compileModuleJs]) {
      const fns = build(compiled.module, { precision: 'f32' }).fns as Record<
        string,
        (...a: number[]) => number
      >;
      // pi is 0x400921FB 0x54442D18.
      expect(fns['hi']!(Math.PI)).toBe(0x400921fb);
      expect(fns['lo']!(Math.PI)).toBe(0x54442d18);
      expect(fns['hi']!(-0)).toBe(0x80000000);
      expect(fns['make']!(0x400921fb, 0x54442d18)).toBe(Math.PI);
      expect(fns['make']!(0x7ff00000, 0)).toBe(Infinity);
      expect(Object.is(fns['make']!(0x80000000, 0), -0)).toBe(true);
      // Truncation toward zero; a NaN is 0; a value past the range is the nearest bound.
      expect(
        [-3.9, 3.9, -0.5, NaN, 1e300, -1e300, 2147483647.5].map((v) => fns['toInt']!(v)),
      ).toEqual([-3, 3, 0, 0, 2147483647, -2147483648, 2147483647]);
      expect(fns['fromUint']!(4294967295)).toBe(4294967295);
    }
  });

  it('refuses a wrong argument type and a wrong count', () => {
    const wrong = compileLibmSource(
      `"use typeshade";
export function a(x: f32): u32 { return __f64Hi(x); }
export function b(x: f64): u32 { return __f64Hi(x, x); }
`,
      'wrong.shade.ts',
    );
    expect(wrong.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([
      'TS8003 __f64Hi takes f64 as argument 1; got f32.',
      'TS8019 __f64Hi takes 1 argument(s); got 2.',
    ]);
  });

  it('leaves the author compile as it was after the libm compile ran', () => {
    expect(compilerDiagnostics(program('__f64Hi(x)'))).toHaveLength(1);
  });
});
