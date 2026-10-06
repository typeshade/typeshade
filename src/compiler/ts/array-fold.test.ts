import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';
import { compile } from './compile.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';

describe('sum / min / max / fill / none', () => {
  it('sums an array with +', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(xs: array<f32, 3>): f32 {
        return sum(xs);
      }
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const ret = r.funcs[0]!.body[0];
    if (ret!.s === 'return') expect(ret.expr?.op).toBe('binop');
  });

  it('mins an array via min(a, b) calls', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(xs: array<f32, 3>): f32 {
        return min(xs);
      }
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const ret = r.funcs[0]!.body[0];
    if (ret!.s === 'return') expect(ret.expr?.op).toBe('call');
  });

  it('keeps two-arg min as the scalar intrinsic', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(a: f32, b: f32): f32 {
        return min(a, b);
      }
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const ret = r.funcs[0]!.body[0];
    if (ret!.s === 'return' && ret.expr?.op === 'call') expect(ret.expr.args).toHaveLength(2);
  });

  it('constructs fill<f32, 4>(v)', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(v: f32): f32 {
        const xs = fill<f32, 4>(v);
        return 0.;
      }
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const letS = r.funcs[0]!.body.find((s) => s.s === 'let');
    if (letS && letS.s === 'let' && letS.expr.op === 'construct') {
      expect(letS.expr.args).toHaveLength(4);
    }
  });

  // #498: the value takes the element type, as `array<T, N>(…)` gives each element. The test
  // above read the IR only, on an `f32` element; `fill<u32, 4>(0)` compiled clean and emitted
  // four `0.0` into an `array<u32, 4>`, which Tint refuses ("cannot convert value of type
  // 'abstract-float' to type 'u32'"). This one reads the emit and both CPU paths.
  it('types its value to the element, on every target (#498)', () => {
    const r = compile(`"use typeshade";
@fragment
export function fs(): vec4 {
  let s: array<u32, 4> = fill<u32, 4>(0);
  s[1] = 7;
  const t = fill<i32, 3>(-1);
  const w = fill<vec2, 2>(vec2(1., 2.));
  return vec4(f32(s[0] + s[1]), f32(t[2]), w[1].y, 1.);
}
`);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.wgsl).toContain('array<u32, 4>(0u, 0u, 0u, 0u)');
    expect(r.wgsl).toContain('array<i32, 3>(-1, -1, -1)');
    expect(r.wgsl).not.toMatch(/array<u32, 4>\(0\.0/);
    expect(r.glsl?.fragment).toContain('uint[4](0u, 0u, 0u, 0u)');
    // A vector value fills a vector array: both elements are the one hoisted `vec2(1., 2.)`.
    expect(r.wgsl).toMatch(/array<vec2<f32>, 2>\((_cse\d+), \1\)/);
    expect(r.glsl?.fragment).toMatch(/vec2\[2\]\((_cse\d+), \1\)/);
    for (const make of [compileModule, compileModuleJs])
      expect(make(r.module).fns['fs']!()).toEqual([7, -1, 2, 1]);
  });

  it('refuses a value of another type with the element message (#498)', () => {
    const r = compile(`"use typeshade";
export function f(n: u32): u32 {
  const s = fill<u32, 4>(1.5);
  return n;
}
`);
    expect(
      r.diagnostics.filter((d) => d.category === 'error').map((d) => `${d.code} ${d.message}`),
    ).toEqual([
      'TS8003 array<u32, 4> element 0 must be u32, got f32. There is no implicit conversion; cast it.',
    ]);
    const v = compile(`"use typeshade";
export function f(n: u32): u32 {
  const w = fill<vec2, 2>(vec3(1., 2., 3.));
  return n;
}
`);
    expect(
      v.diagnostics.filter((d) => d.category === 'error').map((d) => `${d.code} ${d.message}`),
    ).toEqual([
      'TS8003 array<vec2, 2> element 0 must be vec2, got vec3. There is no implicit conversion; cast it.',
    ]);
  });

  it('none(xs, pred) is !any', () => {
    const r = compileTsSource(`
      "use typeshade";
      function pos(x: f32): bool { return x > 0.; }
      export function f(xs: array<f32, 2>): bool {
        return none(xs, pos);
      }
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const ret = r.funcs.find((fn) => fn.name === 'f')!.body[0];
    if (ret!.s === 'return') expect(ret.expr?.op).toBe('compare');
  });
});
