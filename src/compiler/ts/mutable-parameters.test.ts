// Verifies: Rule 8.8, Rule 8.17 (docs/language-design.md; traced in reqs/).
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { startDebugSession } from '../../core/debug/session.js';
import { optimize } from '../../core/passes/opt/optimize.js';
import { autoVars } from '../../core/passes/opt/index.js';

function check(body: string, expected: number) {
  const r = compile(
    `"use typeshade";\n${body}\n@fragment export function fs(): vec4 { return vec4(run(), 0., 0., 1.); }`,
  );
  expect(r.diagnostics).toEqual([]);
  for (const precision of ['f64', 'f32'] as const) {
    expect(compileModule(r.module, { precision }).fns.run!()).toBe(expected);
    expect(compileModuleJs(r.module, { precision }).fns.run!()).toBe(expected);
  }
  expect(compileModule(optimize(autoVars(r.module))).fns.run!()).toBe(expected);
  const session = startDebugSession(r.module, 'run', []);
  session.continue();
  expect(session.result).toBe(expected);
  expect(r.wgsl).toBeDefined();
  expect(r.glsl?.fragment).toBeDefined();
  return r;
}

describe('value parameter rebinding', () => {
  it('reads the input before a conditional write, and leaves its caller unchanged', () => {
    const r = check(
      `function f(a: f32, change: bool): f32 { const before = a; if (change) { a += 3.; } return before + a; }
export function run(): f32 { let a = 2.; return f(a, true) + f(a, false) + a; }`,
      13,
    );
    expect(r.module.funcs.find((f) => f.name === 'f')!.params.map((p) => p.name)).toEqual([
      'a',
      'change',
    ]);
    expect(r.wgsl).toContain('var a_1: f32 = a;');
    expect(r.wgsl).not.toContain('var change');
  });

  it('reserves input names before copies and handles lexical shadowing', () => {
    const r = check(
      `function f(a: f32, a_1: f32): f32 { { let a = 7.; a += 1.; } a += a_1; return a; }
function untouched(a: f32): f32 { { let a = 5.; a++; } return a; }
export function run(): f32 { return f(2., 3.) + untouched(4.); }`,
      9,
    );
    expect(r.wgsl).toContain('var a_2: f32 = a;');
    expect(
      r.module.funcs
        .find((f) => f.name === 'untouched')!
        .body.some((s) => s.s === 'var' && s.init?.op === 'varref' && s.init.name === 'a'),
    ).toBe(false);
  });

  it('supports integer prefix/postfix and compound loop updates', () => {
    check(
      `function f(a: i32): i32 { a++; ++a; a--; for (let i = 0; i < 3; i++) { a += 2; } return a; }
export function run(): f32 { return f32(f(2)); }`,
      9,
    );
  });

  it('does not hide module functions or struct constructors behind generated locals', () => {
    const r = check(
      `function a_1(): f32 { return 3.; }
function f(a: f32): f32 { a += a_1(); return a; }
export function run(): f32 { return f(2.); }`,
      5,
    );
    expect(r.wgsl).toContain('var a_2: f32 = a;');
  });

  it('shares a copied parameter with read and write closures', () => {
    check(
      `function f(a: f32): f32 { const get = (): f32 => a; const write = (): void => { a += 3.; }; write(); a += 1.; return get(); }
export function run(): f32 { const a = 2.; return f(a) + a; }`,
      8,
    );
  });

  it('copies whole vectors, structs and fixed arrays, including later component writes', () => {
    check(
      `class P { x: f32; }
function v(a: vec2): f32 { a = a + vec2(1.); a.x = 8.; return a.x + a.y; }
function p(a: P): f32 { a = { x: a.x + 1. }; a.x += 3.; return a.x; }
function xs(a: array<f32, 2>): f32 { a = [a[1], a[0]]; a[0] += 2.; return a[0] + a[1]; }
export function run(): f32 { const a = vec2(2., 3.); const b: P = { x: 2. }; const c: array<f32, 2> = [2., 3.]; return v(a) + a.x + p(b) + b.x + xs(c) + c[0]; }`,
      31,
    );
  });

  it('lowers constructors, parameter properties, getters/setters and methods', () => {
    check(
      `class P { constructor(public x: f32) { x += 2.; this.x += x; }
set value(v: f32) { v += 1.; this.x = v; }
method(v: f32): f32 { v += this.x; return v; } }
export function run(): f32 { const p = new P(2.); const before = p.x; p.value = 3.; return before + p.method(2.); }`,
      12,
    );
  });

  it('handles generic copies and a callback with inferred parameter types', () => {
    check(
      `function id<T>(x: T, y: T): T { x = y; return x; }
function apply(f: (x: f32) => f32, x: f32): f32 { x += 1.; return f(x); }
export function run(): f32 { return id(2., 3.) + apply((x) => { x *= 2.; return x; }, 4.); }`,
      13,
    );
  });

  it('preserves entry input attributes and authored parameter names', () => {
    const r = compile(`"use typeshade";
@fragment export function fs(@location(0) uv: vec2): vec4 { uv = uv + vec2(0.25); return vec4(uv, 0., 1.); }`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('@location(0) uv: vec2<f32>');
    expect(r.wgsl).toContain('var uv_1: vec2<f32> = uv;');
    expect(r.eval('fs', [[0.25, 0.5]])).toEqual([0.5, 0.75, 0, 1]);
  });

  it('retains refusal of writes through parameters without whole rebinding', () => {
    const r = compile(`"use typeshade"; export function f(a: vec2): vec2 { a.x = 1.; return a; }`);
    expect(r.diagnostics.some((d) => d.category === 'error')).toBe(true);
  });

  it('diagnoses duplicate parameter declarations instead of duplicating a hidden input', () => {
    const r = compile(
      `"use typeshade"; export function f(a: f32, a: f32): f32 { a = 1.; return a; }`,
    );
    expect(r.diagnostics.some((d) => d.code === 'TS8023')).toBe(true);
    expect(r.wgsl).toBeUndefined();
  });
});
