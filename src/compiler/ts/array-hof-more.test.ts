import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';
import { compile } from './compile.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';

// `any(xs, pred)` and `all(xs, pred)` were removed (change 0112); `xs.some(pred)` and `xs.every(pred)`
// answer the same. `zip` stays.
describe('some / every / zip', () => {
  it('xs.some(pred) is true when one element passes', () => {
    const r = compile(`
      "use typeshade";
      function pos(x: f32): bool { return x > 0.; }
      export function f(xs: array<f32, 3>): bool {
        return xs.some(pos);
      }
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    for (const make of [compileModule, compileModuleJs]) {
      const f = make(r.module).fns['f']!;
      expect([f([-1, -2, 3]), f([-1, -2, -3])], make.name).toEqual([true, false]);
    }
  });

  it('xs.every(pred) is true when every element passes', () => {
    const r = compile(`
      "use typeshade";
      function pos(x: f32): bool { return x > 0.; }
      export function f(xs: array<f32, 2>): bool {
        return xs.every(pos);
      }
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    for (const make of [compileModule, compileModuleJs]) {
      const f = make(r.module).fns['f']!;
      expect([f([1, 2]), f([1, -2])], make.name).toEqual([true, false]);
    }
  });

  it('unrolls zip(xs, ys, add)', () => {
    const r = compileTsSource(`
      "use typeshade";
      function add(a: f32, b: f32): f32 { return a + b; }
      export function f(xs: array<f32, 2>, ys: array<f32, 2>): f32 {
        const zs = zip(xs, ys, add);
        return 0.;
      }
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const letS = r.funcs.find((fn) => fn.name === 'f')!.body.find((s) => s.s === 'let');
    if (letS && letS.s === 'let' && letS.expr.op === 'construct') {
      expect(letS.expr.args).toHaveLength(2);
    }
  });

  it('rejects zip length mismatch', () => {
    const r = compileTsSource(`
      "use typeshade";
      function add(a: f32, b: f32): f32 { return a + b; }
      export function f(xs: array<f32, 2>, ys: array<f32, 3>): f32 {
        const zs = zip(xs, ys, add);
        return 0.;
      }
    `);
    expect(r.diagnostics.some((d) => /length mismatch/.test(d.message))).toBe(true);
  });
});
