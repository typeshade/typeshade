import { describe, expect, it } from 'vitest';
import { bothTake } from '../../core/testing/both-halves.js';
import { compileModule } from '../../core/oracle.js';
import { optimizeAt, type OptLevel } from '../../core/passes/opt/optimize.js';
import { emitModule } from '../../core/backends/wgsl.js';
import { emitGlslModule } from '../../core/backends/glsl.js';

const LEVELS: readonly OptLevel[] = ['O0', 'O1', 'O2'];

const valuesAt = (source: string, args: readonly unknown[]): unknown[] => {
  const { result } = bothTake(source);
  return LEVELS.map((level) => {
    const cpu = compileModule(optimizeAt(result.module, level), { precision: 'f32' });
    return (cpu.fns['t'] as (...a: readonly unknown[]) => unknown)(...args);
  });
};

const emitsAt = (source: string): { wgsl: string; glsl: string }[] => {
  const { result } = bothTake(source);
  return LEVELS.map((level) => {
    const m = optimizeAt(result.module, level);
    return { wgsl: emitModule(m), glsl: emitGlslModule(m, 'fragment') };
  });
};

const DIV0 = `"use typeshade";
function passi(v: i32) { return v; }
function __opt_div0_i32_i32(x: i32, y: i32): i32 { return x + y + 1000; }
export function t(ii: i32, jj: i32): i32 {
  let a = passi(ii); let b = passi(jj);
  return i32(a / b) + __opt_div0_i32_i32(ii, jj);
}
`;

const WIDEN = `"use typeshade";
function g(x: f32): f32 | undefined { return x > 0 ? x : undefined; }
function __opt_widen_struct___opt_f32(a: f32): f32 { return a + 1000; }
export function t(x: f32): f32 {
  const v: f32 | undefined | null = g(x);
  return (v ?? 7) + __opt_widen_struct___opt_f32(x);
}
`;

describe("an author's function named like an optional-values helper (issue 1362)", () => {
  it('a __opt_div0_* function and the integer quotient helper are kept apart', () => {
    expect(valuesAt(DIV0, [-7, 0])).toEqual(LEVELS.map(() => 0 + (-7 + 0 + 1000)));
    expect(valuesAt(DIV0, [-8, 1])).toEqual(LEVELS.map(() => -8 + (-8 + 1 + 1000)));
    for (const { wgsl, glsl } of emitsAt(DIV0)) {
      expect(wgsl).toContain('_opt_div0_i32_i32_(ii, jj)');
      expect(wgsl).toContain('return ((x + y) + 1000);');
      expect(wgsl).toContain('_opt_div0_i32_i32_1_(a, b)');
      expect(glsl).toContain('_opt_div0_i32_i32_1_(a, b)');
    }
  });

  it('a __opt_widen_* function and the widening helper are kept apart', () => {
    expect(valuesAt(WIDEN, [2])).toEqual(LEVELS.map(() => 2 + (2 + 1000)));
    expect(valuesAt(WIDEN, [-8])).toEqual(LEVELS.map(() => 7 + (-8 + 1000)));
  });

  it('a helper an earlier compile made is not emitted for a call to the author function', () => {
    valuesAt(DIV0, [1, 1]);
    const source = `"use typeshade";
function __opt_div0_i32_i32(x: i32, y: i32): i32 { return x + y + 1000; }
export function t(ii: i32, jj: i32): i32 { return __opt_div0_i32_i32(ii, jj); }
`;
    expect(valuesAt(source, [3, 4])).toEqual(LEVELS.map(() => 1007));
    expect(bothTake(source).result.module.funcs.map((f) => f.name)).toEqual([
      '__opt_div0_i32_i32',
      't',
    ]);
  });
});
