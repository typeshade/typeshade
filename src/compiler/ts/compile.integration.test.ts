// End-to-end: "use typeshade" source -> FuncDecl (Phase 1-5)

import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';
import { TS_CODES } from './codes.js';
import { typeKey } from '../../core/ir/types.js';

describe('compileTsSource integration', () => {
  it('lowers the Phase-1 milestone transform function', () => {
    const source = `
      "use typeshade";
      export function transform(a: f32, b: f32): f32 {
        const x = a + b;
        return x * 2;
      }
    `;
    const result = compileTsSource(source);
    expect(result.hasDirective).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.funcs).toHaveLength(1);

    const fn = result.funcs[0]!;
    expect(fn.name).toBe('transform');
    expect(fn.params).toHaveLength(2);
    expect(fn.params[0]!.name).toBe('a');
    expect(typeKey(fn.params[0]!.type)).toBe('f32');
    expect(typeKey(fn.ret)).toBe('f32');
    expect(fn.body.length).toBe(2);
    expect(fn.body[0]!.s).toBe('let');
    expect(fn.body[1]!.s).toBe('return');
    if (fn.body[0]!.s === 'let') {
      expect(fn.body[0].expr.op).toBe('binop');
    }
    if (fn.body[1]!.s === 'return' && fn.body[1]!.expr) {
      expect(fn.body[1].expr.op).toBe('binop');
    }
  });

  it('lowers assignment and if', () => {
    const source = `
      "use typeshade";
      export function step(x: f32, flag: bool): f32 {
        let y = x;
        if (flag) {
          y = y + 1;
        }
        return y;
      }
    `;
    const result = compileTsSource(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.funcs).toHaveLength(1);
    const body = result.funcs[0]!.body;
    expect(body.some((s) => s.s === 'var')).toBe(true);
    expect(body.some((s) => s.s === 'if')).toBe(true);
    expect(body.some((s) => s.s === 'return')).toBe(true);
  });

  it('reports diagnostics for bad types without throwing', () => {
    const source = `
      "use typeshade";
      export function bad(a: string): f32 {
        return 1;
      }
    `;
    const result = compileTsSource(source);
    expect(result.hasDirective).toBe(true);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it('returns empty funcs and a MISSING_DIRECTIVE error when directive is absent', () => {
    const result = compileTsSource('export function f(): void {}');
    expect(result.hasDirective).toBe(false);
    expect(result.funcs).toEqual([]);
    expect(result.wgsl).toBeUndefined();
    expect(result.diagnostics.map((d) => d.code)).toEqual([TS_CODES.MISSING_DIRECTIVE]);
  });

  it('returns empty funcs and no diagnostic when the directive is absent and not required', () => {
    const result = compileTsSource('export function f(): void {}', { requireDirective: false });
    expect(result.hasDirective).toBe(false);
    expect(result.funcs).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it('collects multiple top-level functions', () => {
    const result = compileTsSource(`
      "use typeshade";
      function helper(x: f32): f32 { return x; }
      export function main(x: f32): f32 { return x; }
    `);
    expect(result.funcs.map((f) => f.name).sort()).toEqual(['helper', 'main']);
  });

  it('const reassignment produces diagnostic', () => {
    const result = compileTsSource(`
      "use typeshade";
      export function f(): f32 {
        const x = 1.;
        x = 2.;
        return x;
      }
    `);
    expect(result.diagnostics.some((d) => /const|immutable/i.test(d.message))).toBe(true);
  });

  it('mod() lowers to a floor-mod call', () => {
    const result = compileTsSource(`
      "use typeshade";
      export function f(a: f32, b: f32): f32 {
        return mod(a, b);
      }
    `);
    expect(result.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const ret = result.funcs[0]!.body[0];
    expect(ret!.s).toBe('return');
    if (ret!.s === 'return' && ret.expr?.op === 'call') expect(ret.expr.fn).toBe('mod');
  });

  it('unknown identifier is diagnosed with location', () => {
    const result = compileTsSource(`
      "use typeshade";
      export function f(): f32 {
        return missing;
      }
    `);
    const d = result.diagnostics.find((x) => /Unknown identifier/i.test(x.message));
    expect(d).toBeDefined();
    expect(d!.line).toBeGreaterThanOrEqual(1);
    expect(d!.category).toBe('error');
  });

  it('non-strict equality is rejected', () => {
    const result = compileTsSource(`
      "use typeshade";
      export function f(a: f32, b: f32): bool {
        return a == b;
      }
    `);
    expect(result.diagnostics.some((d) => /strict equality/i.test(d.message))).toBe(true);
  });

  it('allows vector constructors to compose scalar and vector arguments', () => {
    const result = compileTsSource(`
      "use typeshade";
      export function f(): vec4 {
        const xy = vec2(1., 2.);
        const zw = vec2(3., 4.);
        return vec4(xy, zw);
      }
    `);
    expect(result.diagnostics).toEqual([]);
    const ret = result.funcs[0]!.body[2];
    expect(ret!.s).toBe('return');
    if (ret!.s === 'return' && ret.expr) {
      expect(typeKey(ret.expr.type)).toBe('vec4<f32>');
      expect(ret.expr.op).toBe('construct');
    }
  });

  it('rejects vector constructors whose component count does not match', () => {
    const result = compileTsSource(`
      "use typeshade";
      export function f(): vec3 {
        const xy = vec2(1., 2.);
        return vec3(xy, 3., 4.);
      }
    `);
    expect(result.diagnostics.some((d) => /component count mismatch/i.test(d.message))).toBe(true);
  });

  it('lowers f64 vector constructors and composes vec64 arguments', () => {
    const result = compileTsSource(`
      "use typeshade";
      export function f(a: f64, b: f64, c: f64, d: f64): vec4f64 {
        const xy = vec2f64(a, b);
        const zw = vec2f64(c, d);
        return vec4f64(xy, zw);
      }
    `);
    expect(result.diagnostics).toEqual([]);
    const ret = result.funcs[0]!.body[2];
    expect(ret!.s).toBe('return');
    if (ret!.s === 'return' && ret.expr) {
      expect(typeKey(ret.expr.type)).toBe('vec4<f64>');
      expect(ret.expr.op).toBe('construct');
    }
  });

  it('rejects mixed element types in f64 vector constructors', () => {
    const result = compileTsSource(`
      "use typeshade";
      export function f(a: f64, b: f32): vec2f64 {
        return vec2f64(a, b);
      }
    `);
    expect(result.diagnostics.some((d) => /element type mismatch/i.test(d.message))).toBe(true);
  });
});
