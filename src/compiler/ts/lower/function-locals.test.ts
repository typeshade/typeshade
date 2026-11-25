import { describe, expect, it } from 'vitest';
import { bothHalves } from '../../../core/testing/both-halves.js';
import { uninlined } from '../../../core/testing/keep-helpers.js';

const entry = (head: string, value: string): string =>
  `"use typeshade"\n${head}\n@fragment export function fs(): vec4 { return vec4(${value}, 0., 0., 1.); }\n`;

const read = (source: string) => uninlined(() => bothHalves(source));

const wgslOf = (source: string): string => {
  const h = read(source);
  expect(h.compiler).toEqual([]);
  expect(h.editor).toEqual([]);
  return h.result.wgsl ?? '';
};

describe('a local function is a function of the module', () => {
  it('is named after the body that declares it, so two bodies can each declare one', () => {
    const wgsl = wgslOf(
      entry(
        `function a(v: f32): f32 { const add = (x: f32) => x + v; return add(1.) }
function b(v: f32): f32 { const add = (x: f32) => x * 5.; return add(v) }`,
        'a(1.) + b(1.)',
      ),
    );
    expect(wgsl).toContain('fn a_add(v: f32, x: f32) -> f32 {');
    expect(wgsl).toContain('fn b_add(x: f32) -> f32 {');
  });

  it('may call a sibling declared after it, and hold a local function of its own', () => {
    const wgsl = wgslOf(
      entry(
        `function run(v: f32): f32 {
  const twice = (x: f32) => add(add(x))
  const add = (x: f32) => x + v
  function nest(y: f32): f32 { const inner = (z: f32) => z * 2.; return inner(y) }
  return twice(1.) + nest(v)
}`,
        'run(1.)',
      ),
    );
    expect(wgsl).toContain('return run_add(v, run_add(v, x));');
    expect(wgsl).toContain('fn run_nest_inner(z: f32) -> f32 {');
    expect(wgsl).toContain('return run_nest_inner(y);');
  });

  it('takes the flattened name of a namespace and is called by it inside the namespace', () => {
    const wgsl = wgslOf(
      entry(
        `namespace N {
  export const f = (x: f32) => x * 2.
  export const g = (x: f32) => f(x) + 1.
}`,
        'N.g(1.)',
      ),
    );
    expect(wgsl).toContain('fn N_f(x: f32) -> f32 {');
    expect(wgsl).toContain('return (N_f(x) + 1.0);');
  });

  it('is refused when its emitted name is a function of the module', () => {
    const sentence =
      'typeshade TS8023: "run_add" is both a function of this module and the emitted name of the local "add"; rename one of them.';
    const h = read(
      entry(
        `function run_add(x: f32): f32 { return x }
function run(v: f32): f32 { const add = (x: f32) => x + v; return add(1.) + run_add(1.) }`,
        'run(1.)',
      ),
    );
    expect(h.compiler).toEqual([sentence]);
    expect(h.editor).toEqual([sentence]);
  });

  it('is copied with its owner by each call that hands the owner a function', () => {
    const wgsl = wgslOf(
      entry(
        `function each(f: (x: f32) => f32, v: f32): f32 {
  const wrap = (x: f32) => f(x) + 1.
  return wrap(v)
}
function sq(x: f32): f32 { return x * x }
function cu(x: f32): f32 { return x * x * x }`,
        'each(sq, 1.) + each(cu, 1.)',
      ),
    );
    expect(wgsl).toContain('fn each_sq_wrap(x: f32) -> f32 {\n  return (sq(x) + 1.0);');
    expect(wgsl).toContain('fn each_cu_wrap(x: f32) -> f32 {\n  return (cu(x) + 1.0);');
  });

  it('is copied by each call that hands a local function a function', () => {
    const wgsl = wgslOf(
      entry(
        `function run(): f32 {
  const ap = (g: (x: f32) => f32, v: f32) => g(v)
  const inc = (x: f32) => x + 1.
  const dbl = (x: f32) => x * 2.
  return ap(inc, 1.) + ap(dbl, 2.)
}`,
        'run()',
      ),
    );
    expect(wgsl).toContain('fn run_ap_run_inc(v: f32) -> f32 {\n  return run_inc(v);');
    expect(wgsl).toContain('fn run_ap_run_dbl(v: f32) -> f32 {\n  return run_dbl(v);');
    expect(wgsl).toContain('(run_ap_run_inc(1.0) + run_ap_run_dbl(2.0))');
  });

  it('takes the object of a method as this, and nothing in a static member', () => {
    const wgsl = wgslOf(
      entry(
        `class C {
  n: f32 = 2.
  run(v: f32): f32 { const f = (x: f32) => x * this.n; return f(v) }
  static k(v: f32): f32 { const f = (x: f32) => x * 3.; return f(v) }
}`,
        'new C().run(1.) + C.k(1.)',
      ),
    );
    expect(wgsl).toContain('fn C_run_f(self_: C, x: f32) -> f32 {');
    expect(wgsl).toContain('fn C_k_f(x: f32) -> f32 {');
  });
});

describe('a function handed over captures what it reads', () => {
  it('is passed ahead of the callee own parameters, by reference where the callee writes it', () => {
    const wgsl = wgslOf(`"use typeshade";
class T { total: f32 = 0.; each(f: (i: f32) => void) { f(1.); } }
@fragment export function fs(): vec4 {
  const t = new T();
  t.each((i: f32) => { t.total += i; });
  return vec4(t.total, 0., 0., 1.);
}
`);
    expect(wgsl).toContain('fn fs_f(t: ptr<function, T>, i: f32) {');
    expect(wgsl).toContain('fn T_each_fs_f(self_: ptr<function, T>) {');
    expect(wgsl).toContain('fs_f(self_, 1.0);');
  });

  it('puts what a method copy captures ahead of its object, and reads the object by value when nothing writes it', () => {
    const wgsl = wgslOf(`"use typeshade";
class T { total: f32 = 0.; each(f: (i: f32) => void) { f(1.); } }
function ro(t: T): f32 {
  let s = 0.;
  t.each((i: f32) => { s += i; });
  return s;
}
@fragment export function fs(): vec4 { const t = new T(); return vec4(ro(t), 0., 0., 1.); }
`);
    expect(wgsl).toContain('fn ro_f(s: ptr<function, f32>, i: f32) {');
    expect(wgsl).toContain('fn T_each_ro_f(s: ptr<function, f32>, self_: ptr<function, T>) {');
    expect(wgsl).toContain('ro_f(s, 1.0);');
  });

  it('names the object of the calling body this_ beside the copy own object', () => {
    const wgsl = wgslOf(`"use typeshade";
class T { n: f32 = 1.; each(f: (i: f32) => f32): f32 { return f(1.); } }
class U { m: f32 = 2.; run(): f32 { const t = new T(); return t.each((j: f32) => j + this.m); } }
@fragment export function fs(): vec4 { return vec4(new U().run(), 0., 0., 1.); }
`);
    expect(wgsl).toContain('fn U_run_f(self_: U, j: f32) -> f32 {');
    expect(wgsl).toContain('fn T_each_U_run_f(this_: U, self_: T) -> f32 {');
  });

  it('says a function written as an argument reads a variable declared below the call', () => {
    const sentence =
      'typeshade TS8022: The function written here reads "later", which is not declared yet where it runs: a let or a const is not there before its declaration, and TypeScript throws. Declare "later" above this call.';
    const h = read(
      entry(
        `function ap(g: (x: f32) => f32): f32 { return g(1.) }
function run(): f32 {
  const r = ap((x: f32) => x + later)
  const later = 2.
  return r
}`,
        'run()',
      ),
    );
    expect(h.compiler).toEqual([sentence]);
    expect(h.editor).toEqual([sentence]);
  });

  it('says a captured variable that is declared below the call, once', () => {
    const sentence =
      'typeshade TS8022: "early" reads "k", which is not declared yet where "early" is called: a let or a const is not there before its declaration, and TypeScript throws. Call "early" after "k" is declared.';
    const h = read(
      entry(
        `function outer(): f32 {
  const r = early()
  const k = 2.
  function early() { return k }
  return r
}`,
        'outer()',
      ),
    );
    expect(h.compiler).toEqual([sentence]);
    expect(h.editor).toEqual([sentence]);
  });
});
