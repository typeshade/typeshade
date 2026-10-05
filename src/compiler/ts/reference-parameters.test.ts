// Verifies: Rule 8.25, Rule 8.8, Rule 8.10, Rule 8.17, Rule 6.10, Rule 7.9, Rule 2.1, Rule 12.7
// (docs/language-design.md; traced in reqs/).
//
// A reference parameter (proposal 0040): `@inout p: T` on a function of the file, `x` at the
// call. Both halves read each program, as a test of what an author can write must: the compiler
// (its diagnostics with their code and text, its WGSL and GLSL, and every CPU path: the oracle at
// both precisions, the generated JS at both, the optimized module and the debugger) and the
// language service (its diagnostics, and its hover where the type is the point).
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { startDebugSession } from '../../core/debug/session.js';
import { optimize } from '../../core/passes/opt/optimize.js';
import { autoVars } from '../../core/passes/opt/index.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const FRAGMENT = `class VsOut { @builtin("position") pos: vec4; @location(0) uv: vec2; }
class Color { @location(0) color: vec4; }
@vertex export function vs(@builtin("vertex_index") vi: u32): VsOut {
  return { pos: vec4(0., 0., 0., 1.), uv: vec2(0., 0.) };
}
@fragment export function fs(v: VsOut): Color { return { color: vec4(run(), v.uv.x, 0., 1.) }; }`;

/** The editor's diagnostics on `source`, as `code message`. */
function editor(source: string): string[] {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', source);
  return service.getDiagnostics('a.ts').map((d) => `${String(d.code)} ${d.message}`);
}

/** Compile `body` with a fragment entry that calls `run`, and hold every CPU path to `expected`. */
function check(body: string, expected: number) {
  const source = `"use typeshade";\n${body}\n${FRAGMENT}`;
  const r = compile(source);
  expect(r.diagnostics).toEqual([]);
  expect(editor(source)).toEqual([]);
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

/** The compiler's errors and the editor's diagnostics on `body`, which must agree. */
function refused(body: string): { compiler: string[]; editor: string[] } {
  const source = `"use typeshade";\n${body}`;
  const compiler = compile(source)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`);
  return { compiler, editor: editor(source) };
}

describe('a reference parameter changes its caller', () => {
  it('swaps two locals, on every target and every CPU path', () => {
    const r = check(
      `function swap(@inout a: f32, @inout b: f32): void { const t = a; a = b; b = t; }
export function run(): f32 { let x: f32 = 1.; let y: f32 = 2.; swap(x, y); return x * 10. + y; }`,
      21,
    );
    expect(r.wgsl).toContain('fn swap(a: ptr<function, f32>, b: ptr<function, f32>)');
    expect(r.wgsl).toContain('(*a) = (*b);');
    expect(r.wgsl).toContain('swap(&x, &y);');
    expect(r.glsl!.fragment).toContain('void swap(inout float a, inout float b)');
    expect(r.glsl!.fragment).toContain('swap(x, y);');
  });

  it("writes a struct's fields, an array's elements and a whole value through the place", () => {
    check(
      `class Ray { origin: vec3; dir: vec3; }
function advance(@inout r: Ray, t: f32): void { r.origin = r.origin + r.dir * t; }
function bumpAll(@inout xs: array<f32, 3>): void { for (let i = 0; i < 3; i++) { xs[i] += 1.; } }
function reset(@inout xs: array<f32, 3>): void { xs = array<f32, 3>(7., 8., 9.); }
export function run(): f32 {
  let r = new Ray(); r.dir = vec3(1., 0., 0.);
  advance(r, 3.);
  let xs = array<f32, 3>(1., 2., 3.);
  bumpAll(xs);
  let ys = array<f32, 3>(1., 2., 3.);
  reset(ys);
  return r.origin.x + xs[0] + xs[1] + xs[2] + ys[1];
}`,
      20,
    );
  });

  it('passes a field or an element, which is stored back on every CPU path', () => {
    check(
      `class P { v: f32; w: f32; }
function addOne(@inout v: f32): void { v += 1.; }
function setP(@inout p: P): void { let q = new P(); q.v = 5.; p = q; }
export function run(): f32 {
  let xs = array<f32, 3>(1., 2., 3.);
  addOne(xs[1]);
  let o = new P();
  addOne(o.w);
  let ps = array<P, 2>(new P(), new P());
  setP(ps[1]);
  return xs[1] * 100. + o.w * 10. + ps[1].v;
}`,
      315,
    );
  });

  it("passes a matrix's column, a place on every target", () => {
    const r = check(
      `function setCol(@inout c: vec2): void { c = vec2(9., 8.); }
export function run(): f32 {
  let m = mat2(1., 2., 3., 4.); let i: i32 = 1;
  setCol(m[i]);
  return m[1].x * 10. + m[0].y;
}`,
      92,
    );
    expect(r.wgsl).toContain('setCol(&m[i]);');
    expect(r.glsl!.fragment).toContain('setCol(m[i]);');
  });

  it('makes a method that hands a place of its object to @inout one that writes it', () => {
    // Rule 8.10: `bump(this.n)` changes the object as `this.n += 1.` does, so the method
    // takes its object by reference; in a constructor, an arrow function and through a second
    // method too.
    const r = check(
      `function bump(@inout v: f32): void { v += 1.; }
function grow(@inout c: C): void { c.n += 10.; }
class C {
  n: f32;
  constructor() { this.n = 1.; bump(this.n); }
  tick(): void { bump(this.n); }
  later(): void { const f = (): void => { bump(this.n); }; f(); }
  whole(): void { grow(this); }
  twice(): void { this.tick(); this.tick(); }
}
export function run(): f32 { let c = new C(); c.tick(); c.later(); c.whole(); c.twice(); return c.n; }`,
      16,
    );
    expect(r.wgsl).toContain('bump(&(*self_).n);');
    expect(r.wgsl).toContain('grow(self_);');
    expect(r.glsl!.fragment).toContain('bump(self_.n);');
  });

  it('writes a result into a local that has no value yet through @out (Rule 7.6)', () => {
    const r = check(
      `function add(a: f32, b: f32, @out c: f32): void { c = a + b; }
export function run(): f32 { let s: f32; add(1., 2., s); return s; }`,
      3,
    );
    expect(r.wgsl).toContain('fn add(a: f32, b: f32, c: ptr<function, f32>)');
    expect(r.wgsl).toContain('add(1.0, 2.0, &s);');
    expect(r.glsl!.fragment).toContain('float s = 0.0;');
  });

  it('names the place the call was made with, whatever the call does to an index', () => {
    // WGSL takes `&xs[i]` once, before the body runs; the CPU paths resolve it once too.
    check(
      `function bumpAndMove(@inout v: f32, @inout i: i32): void { i = 2; v += 10.; }
export function run(): f32 {
  let xs = array<f32, 3>(1., 2., 3.); let i: i32 = 0;
  bumpAndMove(xs[i], i);
  return xs[0] * 100. + xs[2] + f32(i);
}`,
      1105,
    );
  });

  it('hands an @inout parameter it holds on as itself', () => {
    const r = check(
      `function addOne(@inout v: f32): void { v += 1.; }
function twice(@inout v: f32): void { addOne(v); addOne(v); }
export function run(): f32 { let x: f32 = 1.; twice(x); return x; }`,
      3,
    );
    expect(r.wgsl).toContain('addOne(v);');
  });

  it('writes a module variable through a reference, and a `const` that built its value', () => {
    check(
      `class P { v: f32; }
let total: f32 = 1.;
function addOne(@inout v: f32): void { v += 1.; }
export function run(): f32 { const p = new P(); addOne(p.v); addOne(total); return p.v * 10. + total; }`,
      12,
    );
  });

  it('runs a call that writes the variable before the call that takes its reference', () => {
    // Rule 7.9: the call that writes `x` is bound ahead of the statement, so every target reads
    // its write through the reference.
    const r = check(
      `function addTo(@inout a: f32, b: f32): void { a = a + b; }
export function run(): f32 { let x: f32 = 1.; const f = (): f32 => { x += 1.; return x; }; addTo(x, f()); return x; }`,
      4,
    );
    expect(r.wgsl).toContain('addTo(&x, _seq0);');
  });

  it('takes a reference to a storage element as a pointer into storage on WGSL', () => {
    const r = compile(`"use typeshade";
class Ray { origin: vec3; dir: vec3; }
declare const rays: storage<array<Ray>, "read_write">;
function advance(@inout r: Ray, t: f32): void { r.origin = r.origin + r.dir * t; }
@compute([64, 1, 1])
export function main(@builtin("global_invocation_id") id: vec3u): void { advance(rays[id.x], 2.); }`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn advance(r: ptr<storage, Ray, read_write>, t: f32)');
    expect(r.wgsl).toContain('advance(&rays[id.x], 2.0);');
  });

  it('keeps a kernel loop that hands each element over by reference parallel', () => {
    const r = compile(`"use typeshade";
function bump(@inout v: f32): void { v += 1.; }
export function k(out: array<f32>, n: i32): void { for (let i = 0; i < n; i++) { bump(out[i]); } }
export function onOne(out: array<f32>, n: i32): void { for (let i = 0; i < n; i++) { bump(out[0]); } }`);
    expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([
      'TS8070 This loop runs on the CPU because line 4 writes "out[0]", an element two iterations can share. Write at an index made from "i".',
    ]);
    for (const make of [compileModule, compileModuleJs]) {
      const xs = [1, 2, 3, 4];
      (make(r.module).fns.k as (xs: number[], n: number) => void)(xs, 3);
      expect(xs).toEqual([2, 3, 4, 4]);
    }
  });

  it('a function of a namespace takes a reference too', () => {
    check(
      `namespace N { export function inc(@inout v: f32): void { v += 2.; } }
export function run(): f32 { let x: f32 = 1.; N.inc(x); return x; }`,
      3,
    );
  });
});

describe('a local function captures a reference as any variable (Rule 8.17)', () => {
  it('takes it by reference once it writes it, on every target and every CPU path', () => {
    const r = check(
      `function scaleBoth(@inout a: f32, @inout b: f32, k: f32): void {
  const scale = (): void => { a = a * k; b = b * k; };
  scale();
}
export function run(): f32 { let x: f32 = 1.; let y: f32 = 2.; scaleBoth(x, y, 3.); return x * 10. + y; }`,
      36,
    );
    expect(r.wgsl).toContain(
      'fn scaleBoth_scale(a: ptr<function, f32>, k: f32, b: ptr<function, f32>)',
    );
    expect(r.wgsl).toContain('scaleBoth_scale(a, k, b);');
    expect(r.glsl!.fragment).toContain(
      'void scaleBoth_scale(inout float a, float k, inout float b)',
    );
    expect(r.glsl!.fragment).toContain('scaleBoth_scale(a, k, b);');
  });

  it('takes it by value while it only reads it', () => {
    const r = check(
      `function twiceOf(@inout p: f32): f32 { const f = (): f32 => p * 2.; return f(); }
export function run(): f32 { let x: f32 = 3.; return twiceOf(x); }`,
      6,
    );
    expect(r.wgsl).toContain('fn twiceOf_f(p: f32) -> f32');
    expect(r.wgsl).toContain('return twiceOf_f((*p));');
    expect(r.glsl!.fragment).toContain('float twiceOf_f(float p)');
  });

  it('hands a captured reference on as itself', () => {
    const r = check(
      `function bump(@inout v: f32): void { v += 10.; }
function g(@inout p: f32): void { const f = (): void => { bump(p); bump(p); }; f(); }
export function run(): f32 { let x: f32 = 1.; g(x); return x; }`,
      21,
    );
    expect(r.wgsl).toContain('fn g_f(p: ptr<function, f32>)');
    expect(r.glsl!.fragment).toContain('void g_f(inout float p)');
  });

  it('writes through a callback, a local function inside another and a method of the place', () => {
    check(
      `function g(@inout p: f32): void { const xs = array<f32, 3>(1., 2., 3.); xs.forEach((v) => { p += v; }); }
export function run(): f32 { let x: f32 = 1.; g(x); return x; }`,
      7,
    );
    check(
      `function g(@inout p: f32): void { const outer = (): void => { const inner = (): void => { p *= 3.; }; inner(); p += 1.; }; outer(); }
export function run(): f32 { let x: f32 = 2.; g(x); return x; }`,
      7,
    );
    check(
      `class R { o: f32; d: f32; step(): void { this.o += this.d; } }
function g(@inout r: R): void { const f = (): void => { r.step(); r.o += 1.; }; f(); }
export function run(): f32 { let r = new R(); r.d = 2.; g(r); return r.o; }`,
      3,
    );
  });

  it('runs a local function that writes the reference before the call that takes it', () => {
    // Rule 7.9, as for a captured let: `f()` is bound ahead of `addTo`, so `addTo` reads its write.
    check(
      `function addTo(@inout a: f32, b: f32): void { a = a + b; }
function g(@inout p: f32): void { const f = (): f32 => { p += 1.; return p; }; addTo(p, f()); }
export function run(): f32 { let x: f32 = 1.; g(x); return x; }`,
      4,
    );
  });

  it('writes a storage element through a pointer into storage on WGSL', () => {
    const r = compile(`"use typeshade";
declare const buf: storage<array<f32>, "read_write">;
function g(@inout p: f32): void { const f = (): void => { p += 1.; }; f(); }
@compute([1, 1, 1]) export function main(): void { g(buf[0]); }`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn g_f(p: ptr<storage, f32, read_write>)');
    expect(r.wgsl).toContain('g(&buf[0]);');
  });

  it('accepts one variable twice when nothing writes either reference', () => {
    check(
      `function g(@inout a: f32, @inout b: f32): f32 { const f = (): f32 => a + b; return f(); }
export function run(): f32 { let x: f32 = 1.; return g(x, x); }`,
      2,
    );
  });

  it('hovers a captured reference with the place it names', () => {
    const source = `"use typeshade";
function g(@inout p: f32): void { const f = (): void => { p += 1.; }; f(); }
export function run(): f32 { let x: f32 = 1.; g(x); return x; }
`;
    const service = createTypeshadeLanguageService();
    service.openDocument('c.ts', source);
    const hover = service.getHover('c.ts', service.positionAt('c.ts', source.indexOf('p += 1.')));
    expect(hover?.contents).toContain('(parameter) @inout p: f32');
    expect(hover?.contents).toContain("Names the caller's place");
  });
});

describe('what an @inout or @out parameter may not take', () => {
  const pre = `class Ob { a: f32; b: f32; }
declare const src: storage<array<f32>>;
function swap(@inout a: f32, @inout b: f32): void { const t = a; a = b; b = t; }
function bump(@inout v: f32): void { v += 1.; }
function add(a: f32, b: f32, @out c: f32): void { c = a + b; }
`;
  const cases: readonly (readonly [string, string, string])[] = [
    [
      'a literal',
      `export function r(): f32 { bump(1.0); return 0.; }`,
      'TS8073 "bump" writes "v" back to the caller (@inout v: f32), and "1.0" is a value nothing holds, so there is no place to write. Keep it in a let and pass the let.',
    ],
    [
      'a computed value',
      `export function r(): f32 { let x: f32 = 1.; bump(x * 2.); return x; }`,
      'TS8073 "bump" writes "v" back to the caller (@inout v: f32), and "x * 2." is a value nothing holds, so there is no place to write. Keep it in a let and pass the let.',
    ],
    [
      'a const scalar',
      `export function r(): f32 { const c: f32 = 1.; bump(c); return c; }`,
      'TS8073 "bump" writes "v" back to the caller (@inout v: f32), and "c" is declared with const; declare it with let.',
    ],
    [
      'a value parameter, through a field',
      `function g(o: Ob): void { bump(o.a); } export function r(): f32 { return 0.; }`,
      'TS8073 "bump" writes "v" back to the caller (@inout v: f32), and "o" is a parameter that holds a copy of its caller\'s value, which this function cannot hand on as a place. Declare it "@inout o: Ob" to pass its caller\'s place on, or copy it into a let.',
    ],
    [
      'a read-only binding',
      `export function r(): f32 { bump(src[0]); return 0.; }`,
      'TS8073 "bump" writes "v" back to the caller (@inout v: f32), and "src" is a read-only resource. Write "declare const src: storage<array<f32>, "read_write">" to write to it.',
    ],
    [
      "a vector's component",
      `export function r(): f32 { let v = vec3(1.); bump(v.x); return v.x; }`,
      'TS8073 "bump" writes "v" back to the caller (@inout v: f32), and "v.x" is a component of the vector vec3, which no target takes the address of. Pass the whole vector, or copy the component into a let and pass the let.',
    ],
    [
      "a component of a matrix's column",
      `export function r(): f32 { let m = mat2(1., 2., 3., 4.); bump(m[1].x); return 0.; }`,
      'TS8073 "bump" writes "v" back to the caller (@inout v: f32), and "m[1].x" is a component of the vector vec2, which no target takes the address of. Pass the whole vector, or copy the component into a let and pass the let.',
    ],
    [
      'a type of the wrong kind',
      `export function r(): f32 { let x: i32 = 1; bump(x); return 0.; }`,
      'TS8073 "bump" writes "v" back to the caller (@inout v: f32), and "x" is i32. The place must be of exactly the parameter\'s type.',
    ],
    [
      'a const handed to @out',
      `export function r(): f32 { const c: f32 = 1.; add(1., 2., c); return c; }`,
      'TS8073 "add" writes "c" back to the caller (@out c: f32), and "c" is declared with const; declare it with let.',
    ],
    [
      "@inout on a method's parameter",
      `class C { v: f32; m(@inout p: f32): void { p = 1.; } } export function r(): f32 { return 0.; }`,
      'TS8073 "p" is @inout, and "C.m", a member of a class, takes its parameters by value. A parameter that names the caller\'s place belongs to a function declared at the top of the file or of a namespace (Rule 8.25): move the code that changes the caller\'s value into one, or take the value and return the result.',
    ],
    [
      '@inout on a generic function, called or not',
      `function g<T>(@inout v: T): void { } export function r(): f32 { return 0.; }`,
      'TS8073 "v" is @inout, and a generic function, whose instance is made from its arguments, takes its parameters by value. A parameter that names the caller\'s place belongs to a function declared at the top of the file or of a namespace (Rule 8.25): move the code that changes the caller\'s value into one, or take the value and return the result.',
    ],
    [
      '@out on an entry',
      `@compute([1, 1, 1]) export function m(@out x: f32): void { x = 1.; }`,
      'TS8073 "x" is @out, and an entry, whose parameters the pipeline supplies, takes its parameters by value. A parameter that names the caller\'s place belongs to a function declared at the top of the file or of a namespace (Rule 8.25): move the code that changes the caller\'s value into one, or take the value and return the result.',
    ],
    [
      '@inout on a local function',
      `export function r(): f32 { function f(@inout p: f32): void { p = 1.; } return 0.; }`,
      'TS8073 "p" is @inout, and "f" in "r", a local function, takes its parameters by value. A parameter that names the caller\'s place belongs to a function declared at the top of the file or of a namespace (Rule 8.25): move the code that changes the caller\'s value into one, or take the value and return the result.',
    ],
    [
      'two qualifiers on one parameter',
      `function h(@inout @out p: f32): void { p = 1.; } export function r(): f32 { return 0.; }`,
      'TS8073 "p" carries @inout and @out, and a parameter takes one qualifier. Keep the one that says what the function does with it.',
    ],
    [
      'a default on @inout',
      `function h(@inout p: f32 = 1.): void { p = 1.; } export function r(): f32 { return 0.; }`,
      'TS8073 "p" is @inout, which names the place a call hands over; a default is a value and names no place. Remove the default, and pass a variable at every call.',
    ],
    [
      '@out read before it is written',
      `function h(@out c: f32): void { c = c + 1.; } export function r(): f32 { return 0.; }`,
      'TS8075 "c" is @out, and is read here before h writes it: an @out parameter holds no value until the function writes it. Write "c" first, or declare it @inout (Rule 8.25).',
    ],
    [
      '@out left unwritten on a path',
      `function h(@out c: f32, k: bool): void { if (k) { c = 1.; } } export function r(): f32 { return 0.; }`,
      'TS8075 "h" returns here without writing "c", which is @out: the caller\'s variable would hold no value. Write "c" on every path (Rule 8.25).',
    ],
    [
      'a field of @out written before the whole',
      `function h(@out o: Ob): void { o.a = 1.; o = new Ob(); } export function r(): f32 { return 0.; }`,
      'TS8075 "o" is @out, and is read here before h writes it: an @out parameter holds no value until the function writes it. Write "o" first, or declare it @inout (Rule 8.25).',
    ],
    [
      'a local read before it is assigned',
      `export function r(): f32 { let s: f32; return s; }`,
      'TS8075 "s" is read here before it is assigned on every path. Assign it before this read, or declare it with a value (Rule 7.6).',
    ],
    [
      'one variable twice',
      `export function r(): f32 { let x: f32 = 1.; swap(x, x); return x; }`,
      'TS8074 This call hands "x" to "swap" by reference twice, as two places it may change: one variable reached two ways, which WGSL refuses and which GLSL\'s copy-in and copy-out would settle in no fixed order (Rule 8.25). Pass distinct variables, or copy one into a let and pass the let.',
    ],
    [
      'one variable twice to a function whose local function writes one of them',
      `function g(@inout a: f32, @inout b: f32): void { const f = (): void => { a = b; }; f(); } export function r(): f32 { let x: f32 = 1.; g(x, x); return x; }`,
      'TS8074 This call hands "x" to "g" by reference twice, as two places it may change: one variable reached two ways, which WGSL refuses and which GLSL\'s copy-in and copy-out would settle in no fixed order (Rule 8.25). Pass distinct variables, or copy one into a let and pass the let.',
    ],
    [
      'one captured reference twice, inside the local function',
      `function g(@inout a: f32): void { const f = (): void => { swap(a, a); }; f(); } export function r(): f32 { let x: f32 = 1.; g(x); return x; }`,
      'TS8074 This call hands "a" to "swap" by reference twice, as two places it may change: one variable reached two ways, which WGSL refuses and which GLSL\'s copy-in and copy-out would settle in no fixed order (Rule 8.25). Pass distinct variables, or copy one into a let and pass the let.',
    ],
    [
      'two fields of one variable',
      `export function r(): f32 { let o = new Ob(); swap(o.a, o.b); return o.a; }`,
      'TS8074 This call hands "o" to "swap" by reference twice, as two places it may change: one variable reached two ways, which WGSL refuses and which GLSL\'s copy-in and copy-out would settle in no fixed order (Rule 8.25). Pass distinct variables, or copy one into a let and pass the let.',
    ],
    [
      'a module variable the callee also writes',
      `let counter: f32 = 0.; function bumpC(@inout v: f32): void { v += counter; } export function r(): f32 { bumpC(counter); return counter; }`,
      'TS8074 This call hands "counter" to "bumpC" by reference, and "bumpC" also reads or writes "counter" by its name: one variable reached two ways, which WGSL refuses (Rule 8.25). Use the reference alone inside "bumpC", or pass a copy.',
    ],
  ];
  for (const [name, body, message] of cases) {
    it(`refuses ${name}, in the compiler and in the editor`, () => {
      const { compiler, editor: said } = refused(pre + body);
      expect(compiler).toEqual([message]);
      expect(said).toContain(message);
    });
  }

  it('names @inout in TS8018 only where a function may take one', () => {
    const said = (body: string): string[] =>
      compile(`"use typeshade";\n${body}`).diagnostics.map((d) => d.message);
    expect(said(`export function f(v: vec2): f32 { v.x = 1.; return v.x; }`)[0]).toContain(
      'To change the caller\'s value, declare "@inout v: vec2".',
    );
    expect(
      said(
        `class C { n: f32; m(p: C): void { p.n = 1.; } } export function f(): f32 { return 0.; }`,
      ),
    ).toEqual([
      'Cannot write through parameter "p" — parameters are not writable. Use a local or storage.',
    ]);
    expect(
      said(
        `export function f(): f32 { const g = (p: vec2): f32 => { p.x = 1.; return p.x; }; return g(vec2(0.)); }`,
      ),
    ).toEqual([
      'Cannot write through parameter "p" — parameters are not writable. Use a local or storage.',
    ]);
  });

  it('accepts two references to one variable when the callee writes neither', () => {
    // Measured on Tint: `f(&o.a, &o.b)` with `f` reading both compiles (references.ts).
    check(
      `class Ob { a: f32; b: f32; }
function addUp(@inout a: f32, @inout b: f32): f32 { return a + b; }
export function run(): f32 { let o = new Ob(); o.a = 1.; o.b = 2.; return addUp(o.a, o.b); }`,
      3,
    );
  });

  it('keeps ref an ordinary name, which the library no longer declares', () => {
    const r = compile(`"use typeshade";
namespace N { export function ref(x: f32): f32 { return x * 2.; } export function run(): f32 { return ref(2.); } }`);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  });
});

describe('the editor shows a reference parameter as the compiler reads it', () => {
  it('hovers an @inout parameter with the place it names', () => {
    const source = `"use typeshade";
function bump(@inout v: f32): void { v += 1.; }
export function run(): f32 { let x: f32 = 1.; bump(x); return x; }
`;
    const service = createTypeshadeLanguageService();
    service.openDocument('h.ts', source);
    const at = service.positionAt('h.ts', source.indexOf('v += 1.'));
    const hover = service.getHover('h.ts', at)?.contents ?? '';
    expect(hover).toContain('(parameter) @inout v: f32');
    expect(hover).toContain("Names the caller's place");
    expect(hover).toContain('ptr<function, f32>');
  });

  it('hovers a function with its qualifiers, where it is declared and where it is called', () => {
    // The function's line came from the recorded parameter types, which hold `f32` for
    // `@inout w: f32`, so the hover read `function lift(w: f32, k: f32): void`.
    const source = `"use typeshade";
function lift(@inout w: f32, k: f32): void { w = mix(w, 1., k); }
export function k2(out: array<f32>, n: i32): void { for (let i = 0; i < n; i++) { out[i] = 1.; } }
export function run(): f32 { let x: f32 = 0.; lift(x, 0.5); return x; }
`;
    const service = createTypeshadeLanguageService();
    service.openDocument('f.ts', source);
    const at = (offset: number): string =>
      service.getHover('f.ts', service.positionAt('f.ts', offset))?.contents ?? '';
    for (const offset of [source.indexOf('lift(') + 1, source.lastIndexOf('lift(') + 1]) {
      expect(at(offset)).toContain('function lift(@inout w: f32, k: f32): void');
    }
    // A kernel function's array is passed by reference too, and carries no qualifier (Rule 8.23).
    expect(at(source.indexOf('k2(') + 1)).toContain('function k2(out: array<f32>, n: i32): void');
  });

  it('documents @inout and @out where they are written', () => {
    const source = `"use typeshade";
function bump(@inout v: f32): void { v += 1.; }
function put(@out c: f32): void { c = 1.; }
export function run(): f32 { let x: f32 = 1.; bump(x); return x; }
`;
    const service = createTypeshadeLanguageService();
    service.openDocument('d.ts', source);
    const on = (word: string): string =>
      service.getHover('d.ts', service.positionAt('d.ts', source.indexOf(word) + 1))?.contents ??
      '';
    expect(on('inout')).toContain("the parameter names the caller's place");
    expect(on('out c')).toContain("names a place of the caller's that the function writes");
  });
});
