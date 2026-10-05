// Verifies: Rule 8.25, Rule 8.8, Rule 8.10, Rule 8.17, Rule 6.10, Rule 7.9, Rule 2.1, Rule 12.7
// (docs/language-design.md; traced in reqs/).
//
// A reference parameter (proposal 0040): `p: Ref<T>` on a function of the file, `ref(x)` at the
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
      `function swap(a: Ref<f32>, b: Ref<f32>): void { const t = a; a = b; b = t; }
export function run(): f32 { let x: f32 = 1.; let y: f32 = 2.; swap(ref(x), ref(y)); return x * 10. + y; }`,
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
function advance(r: Ref<Ray>, t: f32): void { r.origin = r.origin + r.dir * t; }
function bumpAll(xs: Ref<array<f32, 3>>): void { for (let i = 0; i < 3; i++) { xs[i] += 1.; } }
function reset(xs: Ref<array<f32, 3>>): void { xs = array<f32, 3>(7., 8., 9.); }
export function run(): f32 {
  let r = new Ray(); r.dir = vec3(1., 0., 0.);
  advance(ref(r), 3.);
  let xs = array<f32, 3>(1., 2., 3.);
  bumpAll(ref(xs));
  let ys = array<f32, 3>(1., 2., 3.);
  reset(ref(ys));
  return r.origin.x + xs[0] + xs[1] + xs[2] + ys[1];
}`,
      20,
    );
  });

  it('passes a field or an element, which is stored back on every CPU path', () => {
    check(
      `class P { v: f32; w: f32; }
function addOne(v: Ref<f32>): void { v += 1.; }
function setP(p: Ref<P>): void { let q = new P(); q.v = 5.; p = q; }
export function run(): f32 {
  let xs = array<f32, 3>(1., 2., 3.);
  addOne(ref(xs[1]));
  let o = new P();
  addOne(ref(o.w));
  let ps = array<P, 2>(new P(), new P());
  setP(ref(ps[1]));
  return xs[1] * 100. + o.w * 10. + ps[1].v;
}`,
      315,
    );
  });

  it("passes a matrix's column, a place on every target", () => {
    const r = check(
      `function setCol(c: Ref<vec2>): void { c = vec2(9., 8.); }
export function run(): f32 {
  let m = mat2(1., 2., 3., 4.); let i: i32 = 1;
  setCol(ref(m[i]));
  return m[1].x * 10. + m[0].y;
}`,
      92,
    );
    expect(r.wgsl).toContain('setCol(&m[i]);');
    expect(r.glsl!.fragment).toContain('setCol(m[i]);');
  });

  it('names the place the call was made with, whatever the call does to an index', () => {
    // WGSL takes `&xs[i]` once, before the body runs; the CPU paths resolve it once too.
    check(
      `function bumpAndMove(v: Ref<f32>, i: Ref<i32>): void { i = 2; v += 10.; }
export function run(): f32 {
  let xs = array<f32, 3>(1., 2., 3.); let i: i32 = 0;
  bumpAndMove(ref(xs[i]), ref(i));
  return xs[0] * 100. + xs[2] + f32(i);
}`,
      1105,
    );
  });

  it('hands a reference it holds on, written bare or as ref of it', () => {
    const r = check(
      `function addOne(v: Ref<f32>): void { v += 1.; }
function twice(v: Ref<f32>): void { addOne(v); addOne(ref(v)); }
export function run(): f32 { let x: f32 = 1.; twice(ref(x)); return x; }`,
      3,
    );
    expect(r.wgsl).toContain('addOne(v);');
  });

  it('writes a module variable through a reference, and a `const` that built its value', () => {
    check(
      `class P { v: f32; }
let total: f32 = 1.;
function addOne(v: Ref<f32>): void { v += 1.; }
export function run(): f32 { const p = new P(); addOne(ref(p.v)); addOne(ref(total)); return p.v * 10. + total; }`,
      12,
    );
  });

  it('runs a call that writes the variable before the call that takes its reference', () => {
    // Rule 7.9: the call that writes `x` is bound ahead of the statement, so every target reads
    // its write through the reference.
    const r = check(
      `function addTo(a: Ref<f32>, b: f32): void { a = a + b; }
export function run(): f32 { let x: f32 = 1.; const f = (): f32 => { x += 1.; return x; }; addTo(ref(x), f()); return x; }`,
      4,
    );
    expect(r.wgsl).toContain('addTo(&x, _seq0);');
  });

  it('takes a reference to a storage element as a pointer into storage on WGSL', () => {
    const r = compile(`"use typeshade";
class Ray { origin: vec3; dir: vec3; }
declare const rays: storage<array<Ray>, "read_write">;
function advance(r: Ref<Ray>, t: f32): void { r.origin = r.origin + r.dir * t; }
@compute([64, 1, 1])
export function main(@builtin("global_invocation_id") id: vec3u): void { advance(ref(rays[id.x]), 2.); }`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn advance(r: ptr<storage, Ray, read_write>, t: f32)');
    expect(r.wgsl).toContain('advance(&rays[id.x], 2.0);');
  });

  it('keeps a kernel loop that hands each element over by reference parallel', () => {
    const r = compile(`"use typeshade";
function bump(v: Ref<f32>): void { v += 1.; }
export function k(out: array<f32>, n: i32): void { for (let i = 0; i < n; i++) { bump(ref(out[i])); } }
export function onOne(out: array<f32>, n: i32): void { for (let i = 0; i < n; i++) { bump(ref(out[0])); } }`);
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
      `namespace N { export function inc(v: Ref<f32>): void { v += 2.; } }
export function run(): f32 { let x: f32 = 1.; N.inc(ref(x)); return x; }`,
      3,
    );
  });
});

describe('what a reference parameter and ref(...) may not be', () => {
  const pre = `class Ob { a: f32; b: f32; }
declare const src: storage<array<f32>>;
function swap(a: Ref<f32>, b: Ref<f32>): void { const t = a; a = b; b = t; }
function bump(v: Ref<f32>): void { v += 1.; }
function take(v: f32): f32 { return v; }
`;
  const cases: readonly (readonly [string, string, string])[] = [
    [
      'a value where a reference is taken',
      `export function r(): f32 { let x: f32 = 1.; let y: f32 = 2.; swap(x, y); return x; }`,
      'TS8073 "swap" takes "a" by reference, Ref<f32>: pass the place with ref(x), which marks at the call that "swap" may change it.',
    ],
    [
      'a literal',
      `export function r(): f32 { bump(ref(1.0)); return 0.; }`,
      'TS8073 "bump" takes "v" by reference, Ref<f32>, and "1.0" is a value nothing holds, so there is no place to pass. Keep it in a let and pass ref of that.',
    ],
    [
      'a const scalar',
      `export function r(): f32 { const c: f32 = 1.; bump(ref(c)); return c; }`,
      'TS8073 "bump" takes "v" by reference, Ref<f32>, and "c" is declared with const; declare it with let.',
    ],
    [
      'a value parameter, through a field',
      `function g(o: Ob): void { bump(ref(o.a)); } export function r(): f32 { return 0.; }`,
      'TS8073 "bump" takes "v" by reference, Ref<f32>, and "o" is a parameter that holds a copy of its caller\'s value, which this function cannot hand on as a place. Declare it "o: Ref<Ob>" to pass its caller\'s place on, or copy it into a let.',
    ],
    [
      'a read-only binding',
      `export function r(): f32 { bump(ref(src[0])); return 0.; }`,
      'TS8073 "bump" takes "v" by reference, Ref<f32>, and "src" is a read-only resource. Write "declare const src: storage<array<f32>, "read_write">" to write to it.',
    ],
    [
      "a vector's component",
      `export function r(): f32 { let v = vec3(1.); bump(ref(v.x)); return v.x; }`,
      'TS8073 "bump" takes "v" by reference, Ref<f32>, and "v.x" is a component of the vector vec3, which no target takes the address of. Pass the whole vector, or copy the component into a let and pass ref of that.',
    ],
    [
      'ref(...) handed to a value parameter',
      `export function r(): f32 { let x: f32 = 1.; return take(ref(x)); }`,
      'TS8073 "take" takes "v" as a value, and ref(...) passes a place, which only a parameter declared Ref<T> takes. Pass the value itself, or declare the parameter "v: Ref<f32>" to change the caller\'s (Rule 8.25).',
    ],
    [
      'ref(...) kept as a value',
      `export function r(): f32 { let x: f32 = 1.; const y = ref(x); return y; }`,
      'TS8073 ref(x) passes a place to a parameter declared Ref<T>, and is written only as that argument: it is no value to keep, return or compute with (Rule 8.25). Write the value itself here.',
    ],
    [
      'Ref<T> on a local',
      `export function r(): f32 { let x: f32 = 1.; const y: Ref<f32> = x; return y; }`,
      'TS8073 Ref<T> is the type of a reference parameter, written on a parameter of a function declared at the top of the file or of a namespace: a reference names the place a call hands over, for that call, so nothing returns, stores or keeps one (Rule 8.25). Take or hold the value itself here.',
    ],
    [
      "Ref<T> on a method's parameter",
      `class C { v: f32; m(p: Ref<f32>): void { p = 1.; } } export function r(): f32 { return 0.; }`,
      'TS8073 "p" takes a reference, and "C.m", a member of a class, takes its parameters by value. A reference parameter belongs to a function declared at the top of the file or of a namespace (Rule 8.25): move the code that changes the caller\'s value into one, or take the value and return the result.',
    ],
    [
      'Ref<T> on a generic function, called or not',
      `function g<T>(v: Ref<T>): void { } export function r(): f32 { return 0.; }`,
      'TS8073 "v" takes a reference, and a generic function, whose instance is made from its arguments, takes its parameters by value. A reference parameter belongs to a function declared at the top of the file or of a namespace (Rule 8.25): move the code that changes the caller\'s value into one, or take the value and return the result.',
    ],
    [
      "a component of a matrix's column",
      `export function r(): f32 { let m = mat2(1., 2., 3., 4.); bump(ref(m[1].x)); return 0.; }`,
      'TS8073 "bump" takes "v" by reference, Ref<f32>, and "m[1].x" is a component of the vector vec2, which no target takes the address of. Pass the whole vector, or copy the component into a let and pass ref of that.',
    ],
    [
      'a type of the wrong kind',
      `export function r(): f32 { let x: i32 = 1; bump(ref(x)); return 0.; }`,
      'TS8073 "bump" takes "v" by reference, Ref<f32>, and "x" is i32. A reference names a place of exactly its type.',
    ],
    [
      'a local function that captures a reference',
      `function g(p: Ref<f32>): void { const f = (): f32 => p; p = f(); } export function r(): f32 { let x: f32 = 1.; g(ref(x)); return x; }`,
      'TS8073 "f" reads "p", a reference parameter, which a local function does not capture in this version (Rule 8.25). Copy it into a let for "f" to read, and assign the let back to "p" after the call if "f" changes it.',
    ],
    [
      'one variable twice',
      `export function r(): f32 { let x: f32 = 1.; swap(ref(x), ref(x)); return x; }`,
      'TS8074 This call hands "x" to "swap" by reference twice, as two places it may change: one variable reached two ways, which WGSL refuses and which GLSL\'s copy-in and copy-out would settle in no fixed order (Rule 8.25). Pass distinct variables, or copy one into a let and pass ref of that.',
    ],
    [
      'two fields of one variable',
      `export function r(): f32 { let o = new Ob(); swap(ref(o.a), ref(o.b)); return o.a; }`,
      'TS8074 This call hands "o" to "swap" by reference twice, as two places it may change: one variable reached two ways, which WGSL refuses and which GLSL\'s copy-in and copy-out would settle in no fixed order (Rule 8.25). Pass distinct variables, or copy one into a let and pass ref of that.',
    ],
    [
      'a module variable the callee also writes',
      `let counter: f32 = 0.; function bumpC(v: Ref<f32>): void { v += counter; } export function r(): f32 { bumpC(ref(counter)); return counter; }`,
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

  it('accepts two references to one variable when the callee writes neither', () => {
    // Measured on Tint: `f(&o.a, &o.b)` with `f` reading both compiles (references.ts).
    check(
      `class Ob { a: f32; b: f32; }
function addUp(a: Ref<f32>, b: Ref<f32>): f32 { return a + b; }
export function run(): f32 { let o = new Ob(); o.a = 1.; o.b = 2.; return addUp(ref(o.a), ref(o.b)); }`,
      3,
    );
  });

  it('keeps a function the file declares under the name ref its own', () => {
    const r = compile(`"use typeshade";
namespace N { export function ref(x: f32): f32 { return x * 2.; } export function run(): f32 { return ref(2.); } }`);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  });
});

describe('the editor shows a reference parameter as the compiler reads it', () => {
  it('hovers a Ref<T> parameter with the place it names', () => {
    const source = `"use typeshade";
function bump(v: Ref<f32>): void { v += 1.; }
export function run(): f32 { let x: f32 = 1.; bump(ref(x)); return x; }
`;
    const service = createTypeshadeLanguageService();
    service.openDocument('h.ts', source);
    const at = service.positionAt('h.ts', source.indexOf('v += 1.'));
    const hover = service.getHover('h.ts', at)?.contents ?? '';
    expect(hover).toContain('(parameter) v: Ref<f32>');
    expect(hover).toContain("Names the caller's place");
    expect(hover).toContain('ptr<function, f32>');
  });

  it('documents Ref and ref where they are written', () => {
    const source = `"use typeshade";
function bump(v: Ref<f32>): void { v += 1.; }
export function run(): f32 { let x: f32 = 1.; bump(ref(x)); return x; }
`;
    const service = createTypeshadeLanguageService();
    service.openDocument('d.ts', source);
    const onType = service.getHover('d.ts', service.positionAt('d.ts', source.indexOf('Ref<') + 1));
    expect(onType?.contents).toContain('A reference parameter');
    const onCall = service.getHover(
      'd.ts',
      service.positionAt('d.ts', source.indexOf('ref(x)') + 1),
    );
    expect(onCall?.contents).toContain('Passes a place to a parameter declared `Ref<T>`');
  });
});
