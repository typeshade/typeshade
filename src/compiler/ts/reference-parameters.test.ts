// Verifies: Rule 8.25, Rule 8.8, Rule 8.10, Rule 8.17, Rule 6.10, Rule 7.9, Rule 2.1, Rule 12.7
// (docs/language-design.md; traced in reqs/).
//
// An object parameter that its function writes is the caller's object (change 0142, stage 1,
// which replaced proposal 0040's `@inout`): `p: T` on a function of the file, `x` at the call. A
// number or a vector is a value, so a function gives it back as a result. Both halves read each program, as a test of what an author can write must: the compiler
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

const FRAGMENT = `interface VsOut { pos: builtin<"position">; uv: location<0, vec2>; }
interface Color { color: location<0, vec4>; }
@vertex export function vs(vi: builtin<"vertex_index">): VsOut {
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

describe("an object parameter that its function writes is the caller's object", () => {
  it('gives two numbers back through a list, as JavaScript does (change 0142, decision 8)', () => {
    const r = check(
      `function swap(a: f32, b: f32): [f32, f32] { return [b, a]; }
export function run(): f32 { let x: f32 = 1.; let y: f32 = 2.; [x, y] = swap(x, y); return x * 10. + y; }`,
      21,
    );
    expect(r.wgsl).not.toContain('ptr<function, f32>');
  });

  it("writes a struct's fields and an array's elements through the place, and a whole value into a local", () => {
    check(
      `class Ray { origin: vec3; dir: vec3; }
function advance(r: Ray, t: f32): void { r.origin = r.origin + r.dir * t; }
function bumpAll(xs: array<f32, 3>): void { for (let i = 0; i < 3; i++) { xs[i] += 1.; } }
function reset(xs: array<f32, 3>): void { xs = array<f32, 3>(7., 8., 9.); }
export function run(): f32 {
  let r = new Ray(); r.dir = vec3(1., 0., 0.);
  advance(r, 3.);
  let xs = array<f32, 3>(1., 2., 3.);
  bumpAll(xs);
  let ys = array<f32, 3>(1., 2., 3.);
  reset(ys);
  return r.origin.x + xs[0] + xs[1] + xs[2] + ys[1];
}`,
      // `reset` assigns its parameter whole: from then on the name is a local, and the caller's
      // array keeps its values, as in JavaScript (Table 1).
      14,
    );
  });

  it('passes an element of an array, which is stored back on every CPU path', () => {
    check(
      `class P { v: f32; w: f32; }
function setV(p: P): void { p.v = 5.; }
function addOne(xs: array<f32, 3>): void { xs[1] += 1.; }
export function run(): f32 {
  let xs = array<f32, 3>(1., 2., 3.);
  addOne(xs);
  let o = new P();
  setV(o);
  let ps = array<P, 2>(new P(), new P());
  setV(ps[1]);
  return xs[1] * 100. + o.v * 10. + ps[1].v;
}`,
      355,
    );
  });

  it('makes a method that hands its object to a writing function one that writes it', () => {
    // Rule 8.10: `grow(this)` changes the object as `this.n += 10.` does, so the method takes
    // its object by reference; in an arrow function and through a second method too.
    const r = check(
      `function grow(c: C): void { c.n += 10.; }
class C {
  n: f32;
  constructor() { this.n = 1.; }
  tick(): void { this.n += 1.; }
  later(): void { const f = (): void => { grow(this); }; f(); }
  whole(): void { grow(this); }
  twice(): void { this.tick(); this.tick(); }
}
export function run(): f32 { let c = new C(); c.tick(); c.later(); c.whole(); c.twice(); return c.n; }`,
      24,
    );
    expect(r.wgsl).toContain('grow(self_);');
  });

  it('gives a result back to a local that has no value yet (Rule 7.6)', () => {
    const r = check(
      `function add(a: f32, b: f32): f32 { return a + b; }
export function run(): f32 { let s: f32; s = add(1., 2.); return s; }`,
      3,
    );
    const assigned = r.module.funcs
      .find((f) => f.name === 'run')!
      .body.flatMap((st) =>
        st.s === 'assign' && st.target.op === 'varref' && st.expr.op === 'call'
          ? [`${st.target.name} = ${st.expr.fn}`]
          : [],
      );
    expect(assigned).toEqual(['s = add']);
  });

  it('hands an object parameter it holds on as itself', () => {
    const r = check(
      `function addOne(xs: array<f32, 2>): void { xs[0] += 1.; }
function twice(xs: array<f32, 2>): void { addOne(xs); addOne(xs); }
export function run(): f32 { let xs = array<f32, 2>(1., 0.); twice(xs); return xs[0]; }`,
      3,
    );
    expect(r.wgsl).toContain('addOne(xs);');
  });

  it('writes a module variable through its parameter, and a `const` that built its value', () => {
    check(
      `let shared = array<f32, 2>(0., 0.);
function addOne(xs: array<f32, 2>): void { xs[0] += 1.; }
export function run(): f32 { const ys = array<f32, 2>(0., 0.); addOne(ys); addOne(shared); return ys[0] * 10. + shared[0]; }`,
      11,
    );
  });

  it('runs a call that writes the variable before the call that takes its object', () => {
    // Rule 7.9: the call that writes `a` is bound ahead of the statement, so every target reads
    // its write through the parameter.
    const r = check(
      `class Acc { v: f32; }
function addTo(a: Acc, b: f32): void { a.v = a.v + b; }
export function run(): f32 { let a = new Acc(); a.v = 1.; const f = (): f32 => { a.v += 1.; return a.v; }; addTo(a, f()); return a.v; }`,
      4,
    );
    expect(r.wgsl).toContain('addTo(&a, _seq0);');
  });

  it('takes an element of a storage binding as a pointer into storage on WGSL', () => {
    const r = compile(`"use typeshade";
class Ray { origin: vec3; dir: vec3; }
declare const rays: storage<array<Ray>, "read_write">;
function advance(r: Ray, t: f32): void { r.origin = r.origin + r.dir * t; }
@compute([64, 1, 1]) export function main(id: builtin<"global_invocation_id">): void { advance(rays[id.x], 2.); }`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn advance(r: ptr<storage, Ray, read_write>, t: f32)');
    expect(r.wgsl).toContain('advance(&rays[id.x], 2.0);');
  });

  it('keeps a kernel loop that hands each element over parallel', () => {
    const r = compile(`"use typeshade";
class Cell { v: f32; }
function bump(c: Cell): void { c.v += 1.; }
export function k(out: array<Cell>, n: i32): void { for (let i = 0; i < n; i++) { bump(out[i]); } }
export function onOne(out: array<Cell>, n: i32): void { for (let i = 0; i < n; i++) { bump(out[0]); } }`);
    expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([
      'TS8070 This loop runs on the CPU because line 5 writes "out[0]", an element two iterations can share. Write at an index made from "i".',
    ]);
  });

  it('a function of a namespace takes its object too', () => {
    check(
      `class C { v: f32; }
namespace N { export function inc(c: C): void { c.v += 2.; } }
export function run(): f32 { let c = new C(); c.v = 1.; N.inc(c); return c.v; }`,
      3,
    );
  });
});

describe('a local function captures an object parameter as any variable (Rule 8.17)', () => {
  const CELL = 'class Cell { v: f32; }\n';
  it('takes it by reference once it writes it, on every target and every CPU path', () => {
    const r = check(
      `${CELL}function scaleBoth(a: Cell, b: Cell, k: f32): void {
  const scale = (): void => { a.v = a.v * k; b.v = b.v * k; };
  scale();
}
export function run(): f32 { let x = new Cell(); x.v = 1.; let y = new Cell(); y.v = 2.; scaleBoth(x, y, 3.); return x.v * 10. + y.v; }`,
      36,
    );
    expect(r.wgsl).toContain('scaleBoth_scale(a, k, b);');
    expect(r.glsl!.fragment).toContain('scaleBoth_scale(a, k, b);');
  });

  it('takes it by value while it only reads it', () => {
    check(
      `${CELL}function twiceOf(p: Cell): f32 { const f = (): f32 => p.v * 2.; return f(); }
export function run(): f32 { let x = new Cell(); x.v = 3.; return twiceOf(x); }`,
      6,
    );
  });

  it('hands a captured object on as itself', () => {
    check(
      `${CELL}function bump(c: Cell): void { c.v += 10.; }
function g(p: Cell): void { const f = (): void => { bump(p); bump(p); }; f(); }
export function run(): f32 { let x = new Cell(); x.v = 1.; g(x); return x.v; }`,
      21,
    );
  });

  it('writes through a callback, a local function inside another and a method of the object', () => {
    check(
      `${CELL}function g(p: Cell): void { const xs = array<f32, 3>(1., 2., 3.); xs.forEach((v) => { p.v += v; }); }
export function run(): f32 { let x = new Cell(); x.v = 1.; g(x); return x.v; }`,
      7,
    );
    check(
      `${CELL}function g(p: Cell): void { const outer = (): void => { const inner = (): void => { p.v *= 3.; }; inner(); p.v += 1.; }; outer(); }
export function run(): f32 { let x = new Cell(); x.v = 2.; g(x); return x.v; }`,
      7,
    );
    check(
      `class R { o: f32; d: f32; step(): void { this.o += this.d; } }
function g(r: R): void { const f = (): void => { r.step(); r.o += 1.; }; f(); }
export function run(): f32 { let r = new R(); r.d = 2.; g(r); return r.o; }`,
      3,
    );
  });

  it('runs a local function that writes the object before the call that takes it', () => {
    // Rule 7.9, as for a captured let: `f()` is bound ahead of `addTo`, so `addTo` reads its write.
    check(
      `${CELL}function addTo(a: Cell, b: f32): void { a.v = a.v + b; }
function g(p: Cell): void { const f = (): f32 => { p.v += 1.; return p.v; }; addTo(p, f()); }
export function run(): f32 { let x = new Cell(); x.v = 1.; g(x); return x.v; }`,
      4,
    );
  });

  it('writes a storage element through a pointer into storage on WGSL', () => {
    const r = compile(`"use typeshade";
${CELL}declare const buf: storage<array<Cell>, "read_write">;
function g(p: Cell): void { const f = (): void => { p.v += 1.; }; f(); }
@compute([1, 1, 1]) export function main(): void { g(buf[0]); }`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn g_f(p: ptr<storage, Cell, read_write>)');
    expect(r.wgsl).toContain('g(&buf[0]);');
  });

  it('accepts one variable twice when nothing writes either object', () => {
    check(
      `${CELL}function g(a: Cell, b: Cell): f32 { const f = (): f32 => a.v + b.v; return f(); }
export function run(): f32 { let x = new Cell(); x.v = 1.; return g(x, x); }`,
      2,
    );
  });

  it('hovers a captured object with the object it names', () => {
    const source = `"use typeshade";
${CELL}function g(p: Cell): void { const f = (): void => { p.v += 1.; }; f(); }
export function run(): f32 { let x = new Cell(); g(x); return x.v; }
`;
    const service = createTypeshadeLanguageService();
    service.openDocument('c.ts', source);
    const hover = service.getHover('c.ts', service.positionAt('c.ts', source.indexOf('p.v += 1.')));
    expect(hover?.contents).toContain('(parameter) p: Cell');
    expect(hover?.contents).toContain("The caller's object: this function writes it");
  });
});

describe('what an object parameter that its function writes may not take', () => {
  const pre = `class Cell { v: f32; }
class Ob { a: Cell; b: Cell; }
declare const src: storage<array<Cell>>;
function swapV(a: Cell, b: Cell): void { const t = a.v; a.v = b.v; b.v = t; }
function bump(p: Cell): void { p.v += 1.; }
`;
  const cases: readonly (readonly [string, string, string])[] = [
    [
      'a read-only binding',
      `export function r(): f32 { bump(src[0]); return 0.; }`,
      'TS8073 "bump" writes its parameter "p", the caller\'s object (p: Cell), and "src" is a read-only resource. Write "declare const src: storage<array<Cell>, "read_write">" to write to it.',
    ],
    [
      'one variable twice',
      `export function r(): f32 { let x = new Cell(); swapV(x, x); return x.v; }`,
      'TS8074 This call hands "x" to "swapV" twice, and "swapV" writes one of the two: one object under two names inside "swapV", which is not supported yet (change 0142, stage 2). Pass two variables, or give "swapV" one parameter for it.',
    ],
    [
      'one variable twice to a function whose local function writes one of them',
      `function g(a: Cell, b: Cell): void { const f = (): void => { a.v = 1.; b.v = 2.; }; f(); } export function r(): f32 { let x = new Cell(); g(x, x); return x.v; }`,
      'TS8074 This call hands "x" to "g" twice, and "g" writes one of the two: one object under two names inside "g", which is not supported yet (change 0142, stage 2). Pass two variables, or give "g" one parameter for it.',
    ],
    [
      'one captured object twice, inside the local function',
      `function g(a: Cell): void { const f = (): void => { swapV(a, a); }; f(); } export function r(): f32 { let x = new Cell(); g(x); return x.v; }`,
      'TS8074 This call hands "a" to "swapV" twice, and "swapV" writes one of the two: one object under two names inside "swapV", which is not supported yet (change 0142, stage 2). Pass two variables, or give "swapV" one parameter for it.',
    ],
    [
      'two fields of one variable',
      `export function r(): f32 { let o = new Ob(); swapV(o.a, o.b); return 0.; }`,
      'TS8074 This call hands "o" to "swapV" twice, and "swapV" writes one of the two: one object under two names inside "swapV", which is not supported yet (change 0142, stage 2). Pass two variables, or give "swapV" one parameter for it.',
    ],
    [
      'a module variable the callee also writes',
      `let counter = array<f32, 1>(0.); function bumpC(c: array<f32, 1>): void { c[0] += counter[0]; } export function r(): f32 { bumpC(counter); return counter[0]; }`,
      'TS8074 This call hands "counter" to "bumpC", which writes its parameter, and "bumpC" also reads or writes "counter" by its name: one object under two names inside "bumpC", which is not supported yet (change 0142, stage 2). Use the parameter alone inside "bumpC", or the name alone.',
    ],
    [
      'a local read before it is assigned',
      `export function r(): f32 { let s: f32; return s; }`,
      'TS8075 "s" is read here before it is assigned on every path. Assign it before this read, or declare it with a value (Rule 7.6).',
    ],
  ];
  for (const [name, body, message] of cases) {
    it(`refuses ${name}, in the compiler and in the editor`, () => {
      const { compiler, editor: said } = refused(pre + body);
      expect(compiler).toEqual([message]);
      expect(said).toContain(message);
    });
  }

  it("hands a field of an object parameter on: the parameter is the caller's object (change 0142)", () => {
    const source = `"use typeshade";\n${pre}function g(o: Ob): void { bump(o.a); }
export function r(): f32 { let o = new Ob(); o.a = new Cell(); o.a.v = 1.; g(o); return o.a.v; }`;
    const r = compile(source);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(editor(source)).toEqual([]);
    expect(r.wgsl).toContain('fn g(o: ptr<function, Ob>)');
  });

  it('names no qualifier in TS8018: a number or a vector is a value (change 0142)', () => {
    const said = (body: string): string[] =>
      compile(`"use typeshade";\n${body}`).diagnostics.map((d) => d.message);
    expect(said(`export function f(v: vec2): f32 { v.x = 1.; return v.x; }`)[0]).toContain(
      'Cannot write through parameter',
    );
    expect(said(`export function f(v: vec2): f32 { v.x = 1.; return v.x; }`)[0]).not.toContain(
      '@inout',
    );
    expect(
      said(
        `export function f(): f32 { const g = (p: vec2): f32 => { p.x = 1.; return p.x; }; return g(vec2(0.)); }`,
      ),
    ).toEqual([
      'Cannot write through parameter "p" — parameters are not writable. Use a local or storage.',
    ]);
  });

  it('accepts two objects of one variable when the callee writes neither', () => {
    // Measured on Tint: `f(&o.a, &o.b)` with `f` reading both compiles (references.ts).
    check(
      `class Cell { v: f32; }
class Ob { a: Cell; b: Cell; }
function addUp(a: Cell, b: Cell): f32 { return a.v + b.v; }
export function run(): f32 { let o = new Ob(); o.a = new Cell(); o.b = new Cell(); o.a.v = 1.; o.b.v = 2.; return addUp(o.a, o.b); }`,
      3,
    );
  });

  it('keeps ref an ordinary name, which the library no longer declares', () => {
    const r = compile(`"use typeshade";
namespace N { export function ref(x: f32): f32 { return x * 2.; } export function run(): f32 { return ref(2.); } }`);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  });
});

describe('the qualifiers are removed, and so is their type form (change 0142, decision 8)', () => {
  /** Both halves' whole lists on `body`, as `code message`. */
  const halves = (body: string): { compiler: string[]; editor: string[] } => {
    const source = `"use typeshade";\n${body}`;
    return {
      compiler: compile(source).diagnostics.map((d) => `${d.code} ${d.message}`),
      editor: editor(source),
    };
  };
  const both = (said: string[]) => ({ compiler: said, editor: said });
  const tail = `\nexport function r(): f32 { return 0.; }`;
  const VERTEX = `interface VsOut { pos: builtin<"position">; }\n`;
  const object = (q: string): string =>
    `TS8073 "@${q}" was removed (change 0142): an object parameter is the caller's object with no mark. Delete "@${q}".`;
  const value = (q: string): string =>
    `TS8073 "@${q}" was removed (change 0142): a number, a bool, a vector and a matrix are values. Return the value, and write [a, b] = f(a, b) for more than one.`;
  const typeObject = (written: string, name: string, type: string): string =>
    `TS8028 "${written}" was removed (change 0142): an object parameter is the caller's object with no mark. Delete "${written.slice(0, written.indexOf('<'))}<>" and write the type: "${name}: ${type}".`;
  const typeValue = (written: string): string =>
    `TS8028 "${written}" was removed (change 0142): a number, a bool, a vector and a matrix are values. Return the value, and write [a, b] = f(a, b) for more than one.`;
  const elsewhere = (written: string, type: string): string =>
    `TS8028 "${written}" was removed (change 0142): it was the type form of a parameter qualifier, and here the type is "${type}". Write that type.`;

  const refusedForms: readonly (readonly [string, string, string])[] = [
    [
      'on a number parameter',
      `function swap(a: inout<f32>, b: f32): void { a = b; }`,
      typeValue('inout<f32>'),
    ],
    [
      'out<T> on a parameter, of a struct',
      `class Ray { o: vec3; } function put(r: out<Ray>): void { r = new Ray(); }`,
      typeObject('out<Ray>', 'r', 'Ray'),
    ],
    [
      "on an entry's parameter, as the one diagnostic",
      `${VERTEX}@vertex export function m(x: inout<location<0, f32>>): VsOut { return { pos: vec4(x) }; }`,
      typeValue('inout<location<0, f32>>'),
    ],
    [
      "on a method's parameter, as the one diagnostic",
      `class C { v: f32; m(p: inout<f32>): void { p = 1.; } }`,
      typeValue('inout<f32>'),
    ],
    [
      'on a local',
      `export function q(): f32 { let x: inout<f32> = 1.; return x; }`,
      elsewhere('inout<f32>', 'f32'),
    ],
    ['as a return type', `function q(): out<f32> { return 1.; }`, elsewhere('out<f32>', 'f32')],
    [
      'in a type alias a parameter names',
      `type R = inout<f32>; function q(a: R): f32 { return a; }`,
      elsewhere('inout<f32>', 'f32'),
    ],
    [
      'as a generic argument',
      `function q(a: array<out<f32>, 2>): f32 { return a[0]; }`,
      elsewhere('out<f32>', 'f32'),
    ],
    [
      'on a field',
      `class C { x: inout<f32>; } export function q(): f32 { let c = new C(); return c.x; }`,
      elsewhere('inout<f32>', 'f32'),
    ],
  ];
  for (const [name, body, message] of refusedForms) {
    it(`refuses the type form ${name}, once, in both halves (Rule 12.4)`, () => {
      expect(halves(body + tail)).toEqual(both([message]));
    });
  }

  const refusedQualifiers: readonly (readonly [string, string, string])[] = [
    [
      'a number of an entry',
      `${VERTEX}@vertex export function m(@out x: location<0, f32>): VsOut { return { pos: vec4(x) }; }`,
      value('out'),
    ],
    [
      'a number of a local function',
      `export function q(): f32 { function f(@inout p: f32): void { p = 1.; } return 0.; }`,
      value('inout'),
    ],
    [
      'a number of a constructor',
      `class C { v: f32; constructor(@inout p: f32) { this.v = p; } }`,
      value('inout'),
    ],
    [
      "a number of a method's",
      `class C { v: f32; m(@inout p: f32): void { p = 1.; } }`,
      value('inout'),
    ],
    ['a generic function', `function g<T>(@inout v: T): void { }`, object('inout')],
    ['a number with a default', `function h(@inout p: f32 = 1.): void { p = 1.; }`, value('inout')],
    [
      'a texture',
      `declare const tex: texture_2d<f32>; function look(@inout t: texture_2d<f32>): void { }`,
      value('inout'),
    ],
  ];
  for (const [name, body, message] of refusedQualifiers) {
    it(`refuses a qualifier on ${name} once, with no TS1206 beside it (Rule 12.4)`, () => {
      expect(halves(body + tail)).toEqual(both([message]));
    });
  }

  it('refuses each of two qualifiers on one parameter, and an overload signature and its implementation, at its own decorator', () => {
    expect(halves(`function h(@inout @out p: f32): void { p = 1.; }${tail}`)).toEqual(
      both([value('inout'), value('out')]),
    );
    expect(
      halves(
        `function h(@inout a: f32): void;\nfunction h(@inout a: f32): void { a = 1.; }${tail}`,
      ),
    ).toEqual(both([value('inout'), value('inout')]));
  });

  const SOURCE = `"use typeshade";
class Cell { v: f32; }
function swap(@inout a: f32, @inout b: f32): void { const t = a; a = b; b = t; }
function put(@out c: Cell): void { c.v = 1.; }
export function run(): f32 { let x: f32 = 1.; let y: f32 = 2.; swap(x, y); let s = new Cell(); put(s); return x + s.v; }
`;
  const opened = () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('q.ts', SOURCE);
    return {
      service,
      at: (offset: number) => service.positionAt('q.ts', offset),
    };
  };

  it('answers go-to-definition, prepare-rename and rename at a written @inout and @out, and does not throw', () => {
    const { service, at } = opened();
    for (const word of ['@inout a', '@out c']) {
      for (const offset of [SOURCE.indexOf(word) + 1, SOURCE.indexOf(word) + 3]) {
        expect(service.getDefinition('q.ts', at(offset))).toEqual([]);
        expect(service.prepareRename('q.ts', at(offset))).toBeUndefined();
        expect(service.rename('q.ts', at(offset), 'renamed')).toEqual({});
      }
    }
    // The parameter itself keeps TypeScript's references and rename.
    const edits = service.rename('q.ts', at(SOURCE.indexOf('a: f32, @inout b')), 'p');
    expect(edits['q.ts']).toHaveLength(3);
  });

  it('shows signature help with no qualifier', () => {
    const { service, at } = opened();
    const swap = service.getSignatureHelp('q.ts', at(SOURCE.indexOf('swap(x') + 5));
    expect(swap?.signatures[0]?.label).toBe('swap(a: f32, b: f32): void');
    expect(swap?.signatures[0]?.parameters.map((p) => p.label)).toEqual(['a: f32', 'b: f32']);
  });

  it('hovers a parameter that carries a written qualifier as one that carries none', () => {
    const { service, at } = opened();
    expect(service.getHover('q.ts', at(SOURCE.indexOf('a = b')))?.contents).toContain(
      '(parameter) a: f32',
    );
    expect(service.getHover('q.ts', at(SOURCE.indexOf('swap(x') + 1))?.contents).toContain(
      'function swap(a: f32, b: f32): void',
    );
    // The object parameter that `put` writes is the caller's object, written qualifier or not.
    const object = service.getHover('q.ts', at(SOURCE.indexOf('c.v = 1')))?.contents ?? '';
    expect(object).toContain('(parameter) c: Cell');
    expect(object).toContain("The caller's object: this function writes it");
  });

  it('offers neither inout nor out in a type position', () => {
    const source = `"use typeshade";\nfunction f(a: in): void { let y: ou = 1.; }\n`;
    const service = createTypeshadeLanguageService();
    service.openDocument('c.ts', source);
    for (const offset of [source.indexOf('in)') + 2, source.indexOf('ou =') + 2]) {
      const labels = service
        .getCompletions('c.ts', service.positionAt('c.ts', offset))
        .map((i) => i.label);
      expect(labels).not.toContain('inout');
      expect(labels).not.toContain('out');
    }
  });
});
