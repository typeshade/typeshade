// A function that writes no return type returns what its body does (Rule 8.19), as TypeScript
// infers it: a function of the file or of a namespace, a local function, a generic function, a
// method, an accessor and a field that holds a function. A call that needs the type before the
// body's turn lowers that body first. Before this, a helper with no annotation was `void` with a
// TS8021 warning, a local arrow function with an expression body was refused, and so were a
// getter and a field that holds a function with none.
//
// What is pinned here: the signature each form emits, on WGSL and GLSL ES 3.00; one value for
// each form on the CPU oracle and codegen at both precisions, on the debugger, and on the oracle
// over the optimized module; the same value as the annotated program; every refusal by code and
// text, each said once; the multi-file path; and the editor agreeing.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile } from './compile.js';
import { compileTsSources } from './module.js';
import { TS_CODES } from './codes.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { startDebugSession } from '../../core/debug/session.js';
import { optimize } from '../../core/passes/opt/optimize.js';
import { autoVars } from '../../core/passes/opt/index.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

/** `body` with an entry that calls `run(2.)`: the GLSL writer emits only what an entry reaches. */
const RUN = (body: string): string =>
  `"use typeshade";\n${body}\n@fragment\nexport function fs(): vec4 { return vec4(run(2.), 0., 0., 1.); }\n`;

const errorsOf = (src: string): string[] =>
  compile(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`);

/** The one error `src` has (Rule 12.4). */
const only = (src: string): string => {
  const errors = errorsOf(src);
  expect(errors, src).toHaveLength(1);
  return errors[0]!;
};

/** `run(2)` on every CPU path, which must agree: the oracle and the codegen at f64 and at f32,
 *  the debugger (f32), and the oracle over the optimized module the targets are written from.
 *  Nothing is said about the program, not even a warning. */
function run(src: string, arg = 2): unknown {
  const r = compile(src);
  expect(r.diagnostics).toEqual([]);
  const oracle = r.eval('run', [arg]);
  expect(compileModuleJs(r.module).fns['run']!(arg)).toEqual(oracle);
  expect(compileModule(r.module, { precision: 'f32' }).fns['run']!(arg)).toEqual(oracle);
  expect(compileModuleJs(r.module, { precision: 'f32' }).fns['run']!(arg)).toEqual(oracle);
  expect(compileModule(optimize(autoVars(r.module))).fns['run']!(arg)).toEqual(oracle);
  const s = startDebugSession(r.module, 'run', [arg]);
  s.continue();
  expect(s.done).toBe(true);
  expect(s.result).toEqual(oracle);
  return oracle;
}

/** The declarations of an emitted module, in no order: a function whose body is lowered at its
 *  first call is emitted ahead of the body that called it. */
const declarations = (text: string | undefined): string[] =>
  (text ?? '')
    .split('\n\n')
    .map((b) => b.trim())
    .filter((b) => b !== '')
    .sort();

/** `src` with every return type it writes on a function taken off by `strip`, compiled to the
 *  same WGSL and GLSL ES 3.00 declarations as `src`: what the body says is what the author would
 *  have written. */
function sameAsWritten(src: string, strip: (s: string) => string): void {
  const written = compile(src);
  const inferred = compile(strip(src));
  expect(written.diagnostics).toEqual([]);
  expect(inferred.diagnostics).toEqual([]);
  expect(strip(src)).not.toBe(src);
  expect(declarations(inferred.wgsl)).toEqual(declarations(written.wgsl));
  expect(declarations(inferred.glsl!.fragment)).toEqual(declarations(written.glsl!.fragment));
}

describe('a function that writes no return type returns what its body does (Rule 8.19)', () => {
  it('a function of the file, called above its declaration and through another', () => {
    const src = RUN(`export function run(k: f32): f32 {
  return twice(k) + thrice(1.);
}
function twice(x: f32) {
  return thrice(x) - x;
}
function thrice(x: f32) {
  return x * 3.;
}`);
    expect(run(src)).toBe(7);
    const r = compile(src);
    expect(r.wgsl).toContain('fn twice(x: f32) -> f32 {');
    expect(r.wgsl).toContain('fn thrice(x: f32) -> f32 {');
    expect(r.glsl!.fragment).toContain('float twice(float x) {');
  });

  it('a local function: an expression body, a block body and a declaration, capturing', () => {
    const src = RUN(`export function run(k: f32): f32 {
  const f = (x: f32) => x * k;
  const g = (x: f32) => {
    return f(x) + 1.;
  };
  function h(x: f32) {
    return g(x) * 2.;
  }
  return h(3.);
}`);
    expect(run(src)).toBe(14);
    const r = compile(src);
    expect(r.wgsl).toContain('fn run_f(k: f32, x: f32) -> f32 {');
    expect(r.wgsl).toContain('fn run_g(k: f32, x: f32) -> f32 {');
    expect(r.wgsl).toContain('fn run_h(k: f32, x: f32) -> f32 {');
  });

  it('an arrow function whose body is an assignment, ++ or a call of one that returns nothing runs it', () => {
    const src = RUN(`let total: f32 = 0.;
function add(x: f32) {
  total += x;
}
export function run(k: f32): f32 {
  let n = 0.;
  const inc = () => n += k;
  const bump = () => n++;
  const note = (x: f32) => add(x);
  inc();
  bump();
  note(n);
  note(1.);
  return total;
}`);
    expect(run(src)).toBe(4);
    const r = compile(src);
    expect(r.wgsl).toContain('fn run_inc(n: ptr<function, f32>, k: f32) {');
    expect(r.wgsl).toContain('fn run_note(x: f32) {\n  add(x);\n}');
  });

  it('a namespace function, each instance of a generic one, and one that takes a function', () => {
    const src = RUN(`namespace N {
  export function f(x: f32) {
    return x * 3.;
  }
}
function first<T>(a: T, b: T) {
  return a;
}
function apply(f: (x: f32) => f32, x: f32) {
  return f(x);
}
export function run(k: f32): f32 {
  return N.f(k) + first(k, 5.) + first(vec2(1., k), vec2(0.)).x + apply((x) => x * x, k);
}`);
    expect(run(src)).toBe(13);
    const r = compile(src);
    expect(r.wgsl).toContain('fn N_f(x: f32) -> f32 {');
    expect(r.wgsl).toContain('fn first_f32(a: f32, b: f32) -> f32 {');
    expect(r.wgsl).toContain('fn first_vec2(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {');
    expect(r.wgsl).toContain('fn apply_run_f(x: f32) -> f32 {');
  });

  it('the first return says the type, which the ones after it are typed against', () => {
    const src = RUN(`function pick(c: bool) {
  if (c) {
    return u32(7);
  }
  return 0;
}
function up() {
  return vec3(0., 1., 0.);
}
class P {
  x: f32 = 0.;
  constructor(x: f32) {
    this.x = x;
  }
}
function make(x: f32) {
  return new P(x);
}
export function run(k: f32): f32 {
  return f32(pick(true) + pick(false)) + up().y + make(k).x;
}`);
    expect(run(src)).toBe(10);
    const r = compile(src);
    expect(r.wgsl).toContain('fn pick(c: bool) -> u32 {');
    expect(r.wgsl).toContain('return 0u;');
    expect(r.wgsl).toContain('fn up() -> vec3<f32> {');
    expect(r.wgsl).toContain('fn make(x: f32) -> P {');
  });

  it('`return g()` of one that returns nothing calls it and returns nothing, written or not', () => {
    for (const ret of ['', ': void']) {
      const src = RUN(`let acc: f32 = 0.;
function g()${ret} {
  acc += 1.;
}
function f()${ret} {
  return g();
}
export function run(k: f32): f32 {
  f();
  f();
  return acc + k;
}`);
      expect(run(src), ret).toBe(4);
      expect(compile(src).wgsl, ret).toContain('fn f() {\n  g();\n  return;\n}');
    }
  });

  it('compiles to what the return types it leaves off would have', () => {
    sameAsWritten(
      RUN(`function lerp3(a: vec3, b: vec3, t: f32): vec3 {
  return a + (b - a) * t;
}
export function run(k: f32): f32 {
  const sq = (x: f32): f32 => x * x;
  const c = lerp3(vec3(0.), vec3(1., 2., 3.), 0.5);
  return sq(k) + c.z;
}`),
      (s) => s.replace('t: f32): vec3 {', 't: f32) {').replace('(x: f32): f32 =>', '(x: f32) =>'),
    );
  });
});

describe('a method, an accessor and a field that holds a function (Rule 8.19)', () => {
  it('a method, a static one, a getter, a static getter and a field', () => {
    const src = RUN(`class A {
  x: f32 = 2.;
  gain: f32 = 10.;
  twice() {
    return this.x * 2.;
  }
  static unit() {
    return 1.;
  }
  get half() {
    return this.x / 2.;
  }
  static get seven() {
    return 7.;
  }
  scale = (d: f32) => d * this.gain;
}
export function run(k: f32): f32 {
  const a = new A();
  return a.twice() + A.unit() + a.half + A.seven + a.scale(k);
}`);
    expect(run(src)).toBe(33);
    const r = compile(src);
    expect(r.wgsl).toContain('fn A_twice(self_: A) -> f32 {');
    expect(r.wgsl).toContain('fn A_unit() -> f32 {');
    expect(r.wgsl).toContain('fn A_get_half(self_: A) -> f32 {');
    expect(r.wgsl).toContain('fn A_scale(self_: A, d: f32) -> f32 {');
    expect(r.glsl!.fragment).toContain('float A_twice(A self_) {');
  });

  it('a method that changes its object and returns a value, as the one that writes its type', () => {
    const rng = (ret: string): string =>
      RUN(`class Rng {
  seed: u32 = u32(1);
  next()${ret} {
    this.seed = this.seed * u32(1664525) + u32(1013904223);
    return f32(this.seed >> u32(8)) / 16777216.;
  }
}
export function run(k: f32): f32 {
  let r = new Rng();
  const next = () => r.next();
  return next() + r.next() * k;
}`);
    expect(run(rng(''))).toBe(run(rng(': f32')));
    expect(compile(rng('')).wgsl).toContain('fn Rng_next(self_: ptr<function, Rng>) -> f32 {');
    sameAsWritten(rng(': f32'), (s) => s.replace('next(): f32 {', 'next() {'));
  });

  it('a method whose every return is `return this` chains, as one written `this` does', () => {
    const src = RUN(`class V {
  x: f32 = 0.;
  y: f32 = 0.;
  setX(x: f32) {
    this.x = x;
    return this;
  }
  setY(y: f32) {
    this.y = y;
    return this;
  }
}
export function run(k: f32): f32 {
  let v = new V();
  v.setX(k).setY(3.);
  return v.x + v.y;
}`);
    expect(run(src)).toBe(5);
    expect(compile(src).wgsl).toContain('V_setX(&v, k);\n  V_setY(&v, 3.0);');
  });

  it('through a class that extends: an inherited body, an override and super', () => {
    const src = RUN(`class B {
  v: f32 = 1.;
  area() {
    return this.v;
  }
  twice() {
    return this.area() * 2.;
  }
}
class D extends B {
  area() {
    return super.area() * 10.;
  }
}
export function run(k: f32): f32 {
  const d = new D();
  const b = new B();
  return d.twice() + b.twice() + k;
}`);
    expect(run(src)).toBe(24);
    expect(compile(src).wgsl).toContain('fn D_twice(self_: D) -> f32 {');
  });

  it('a field whose body is an assignment runs it, with a void type or none', () => {
    for (const ret of ['', ': void']) {
      const src = RUN(`class A {
  hp: f32 = 10.;
  hit = (d: f32)${ret} => this.hp -= d;
}
export function run(k: f32): f32 {
  let a = new A();
  a.hit(k);
  a.hit(1.);
  return a.hp;
}`);
      expect(run(src), ret).toBe(7);
    }
  });
});

describe('what is refused, each said once', () => {
  const RECURSION = (path: string): string =>
    `${TS_CODES.RECURSION} Recursive call: ${path}. WGSL has no call stack, so a function must not take part in a call cycle.`;

  it('a call cycle, whose return type would wait on itself', () => {
    expect(
      only(
        RUN(`function fact(n: i32) {
  if (n <= 1) {
    return 1;
  }
  return n * fact(n - 1);
}
export function run(k: f32): f32 {
  return f32(fact(3)) + k;
}`),
      ),
    ).toBe(RECURSION('"fact" -> "fact"'));
    expect(
      only(
        RUN(`function a(n: i32) {
  return b(n);
}
function b(n: i32) {
  return a(n);
}
export function run(k: f32): f32 {
  return f32(a(1)) + k;
}`),
      ),
    ).toBe(RECURSION('"a" -> "b" -> "a"'));
    expect(
      only(
        RUN(`export function run(k: f32): f32 {
  const a = (n: i32) => b(n);
  function b(n: i32) {
    return a(n);
  }
  return f32(a(1)) + k;
}`),
      ),
    ).toBe(RECURSION('"run_a" -> "run_b" -> "run_a"'));
    expect(
      only(
        RUN(`class A {
  n: f32 = 1.;
  f(k: i32) {
    return top(k);
  }
}
function top(k: i32) {
  const a = new A();
  return a.f(k);
}
export function run(k: f32): f32 {
  return f32(top(3)) + k;
}`),
      ),
    ).toBe(RECURSION('"A.f" -> "top" -> "A.f"'));
    expect(
      only(
        RUN(`class A {
  n: f32 = 1.;
  get v() {
    return this.w + 1.;
  }
  get w() {
    return this.v;
  }
}
export function run(k: f32): f32 {
  return new A().v + k;
}`),
      ),
    ).toBe(RECURSION('"A.v" -> "A.w" -> "A.v"'));
    expect(
      only(
        RUN(`function r<T>(a: T, k: i32) {
  if (k <= 0) {
    return a;
  }
  return r(a, k - 1);
}
export function run(k: f32): f32 {
  return r(k, 3);
}`),
      ),
    ).toBe(RECURSION('"r" -> "r"'));
  });

  it('a default that calls one, since a default is lowered before any body', () => {
    expect(
      only(
        RUN(`function h() {
  return 2.;
}
function g(x: f32 = h()): f32 {
  return x;
}
export function run(k: f32): f32 {
  return g() + k;
}`),
      ),
    ).toBe(
      `${TS_CODES.FUNCTION_SHAPE} "h" says what it returns in its body, and a default is lowered before any body: write the return type on "h" (Rule 8.19).`,
    );
  });

  it('returns of two types, and a bare return beside a value', () => {
    expect(
      only(
        RUN(`function f(c: bool) {
  if (c) {
    return 1.;
  }
  return vec2(0.);
}
export function run(k: f32): f32 {
  return k;
}`),
      ),
    ).toBe(
      `${TS_CODES.TYPE_MISMATCH} Function "f" returns f32 at its first "return" and vec2<f32> at another; a function returns one type (Rule 8.19): make them agree, or write the return type.`,
    );
    expect(
      only(
        RUN(`function f(c: bool) {
  if (c) {
    return;
  }
  return 1.;
}
export function run(k: f32): f32 {
  return k;
}`),
      ),
    ).toBe(`${TS_CODES.RETURN_SHAPE} Function "f" returns f32 but has a bare "return".`);
  });

  it('a body that does not lower says why, and a call of it nothing more', () => {
    expect(
      only(
        RUN(`function bad(x: f32) {
  return nope * x;
}
export function run(k: f32): f32 {
  return bad(k) + 1.;
}`),
      ),
    ).toBe(`${TS_CODES.UNKNOWN_NAME} Unknown identifier "nope".`);
  });

  it('a setter with no type beside a getter with none, and an entry that returns a value', () => {
    expect(
      only(
        RUN(`class A {
  _x: f32 = 2.;
  get x() {
    return this._x;
  }
  set x(v) {
    this._x = v;
  }
}
export function run(k: f32): f32 {
  return new A().x + k;
}`),
      ),
    ).toBe(
      `${TS_CODES.UNKNOWN_TYPE} The setter "A.x" needs a type for "v": write "set x(v: T)", or give the getter a return type.`,
    );
    expect(
      only(`"use typeshade";
@fragment
export function fs() {
  return vec4(1., 0., 0., 1.);
}
`),
    ).toBe(
      `${TS_CODES.RETURN_SHAPE} Entry function "fs" returns a value (inferred type vec4<f32>) but has no return type annotation; add ": vec4<f32>" to the signature.`,
    );
  });
});

describe('examples/inferred-returns.shade.ts', () => {
  it('renders the dots, the ring and the falloff on every CPU path', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../../../examples/inferred-returns.shade.ts', import.meta.url)),
      'utf8',
    );
    const r = compile(src);
    expect(r.diagnostics).toEqual([]);
    // Every function in it writes no return type, and each says the one its body returns.
    expect(r.wgsl).toContain('fn Rng_next(self_: ptr<function, Rng>) -> f32 {');
    expect(r.wgsl).toContain('fn Orbit_get_period(self_: Orbit) -> f32 {');
    expect(r.wgsl).toContain('fn Orbit_at(self_: Orbit, t: f32) -> vec2<f32> {');
    expect(r.wgsl).toContain('fn pick_vec2(c: bool, a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {');
    expect(r.wgsl).toContain('fn tint(glow: f32, lit: f32) -> vec3<f32> {');
    expect(r.wgsl).toContain('fn fs_falloff(d: f32) -> f32 {');
    expect(r.wgsl).toContain('fn ring(p: vec2<f32>, r: f32) -> f32 {');
    const at = (uv: number[]): number[] => {
      const arg = [{ pos: [0, 0, 0, 1], uv }];
      const oracle = r.eval('fs', arg) as { color: number[] };
      expect(compileModuleJs(r.module).fns['fs']!(...(arg as never[]))).toEqual(oracle);
      const s = startDebugSession(r.module, 'fs', arg as never[]);
      s.continue();
      const stepped = (s.result as { color: number[] }).color;
      stepped.forEach((c, i) => expect(c).toBeCloseTo(oracle.color[i]!, 5));
      return oracle.color.map((c) => Math.round(c * 1000) / 1000);
    };
    // The first dot, where the generator's first draw put it.
    expect(at([0.447, -0.053])).toEqual([0.611, 1, 1, 1]);
    // The ring, the falloff at the centre, and far from both.
    expect(at([0.27, 0])).toEqual([1, 0.9, 0.667, 1]);
    expect(at([0, 0])).toEqual([0.029, 0.059, 0.098, 1]);
    expect(at([0.9, 0.9])).toEqual([0.004, 0.008, 0.013, 1]);
  });
});

describe('the multi-file path', () => {
  it('a function another file imports returns what its body does', () => {
    const r = compileTsSources([
      {
        fileName: 'math.ts',
        source: `"use typeshade";
export function square(x: f32) {
  return x * x;
}
export function cube(x: f32) {
  return square(x) * x;
}
`,
      },
      {
        fileName: 'app.ts',
        source: `"use typeshade";
import { cube } from "./math";
export function foo(x: f32) {
  return cube(x) + 1.;
}
`,
      },
    ]);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn square(x: f32) -> f32 {');
    expect(r.wgsl).toContain('fn cube(x: f32) -> f32 {');
    expect(r.wgsl).toContain('fn foo(x: f32) -> f32 {');
  });
});

describe('the editor agrees', () => {
  it('reports nothing on a program that writes no return types', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument(
      'a.ts',
      `"use typeshade";
class Rng {
  seed: u32 = u32(1);
  next() {
    this.seed = this.seed * u32(1664525) + u32(1013904223);
    return f32(this.seed >> u32(8)) / 16777216.;
  }
  get unit() {
    return 1.;
  }
}
function twice(x: f32) {
  return x * 2.;
}
export function run(k: f32) {
  let r = new Rng();
  const next = () => r.next();
  const f = (x: f32) => twice(x) + k;
  return f(next()) + r.unit;
}
@fragment
export function fs(): vec4 {
  return vec4(run(2.), 0., 0., 1.);
}
`,
    );
    expect(
      service.getDiagnostics('a.ts').map((d) => `${d.source} ${d.code}: ${d.message}`),
    ).toEqual([]);
  });
});

describe('an arrow function whose body is a barrier', () => {
  it('runs it as a statement and returns nothing', () => {
    const r = compile(`"use typeshade";
declare let buf: storage<array<f32>>;
@compute([64])
export function cs(@builtin("local_invocation_index") li: u32) {
  const sync = () => workgroupBarrier();
  buf[li] = 1.;
  sync();
  buf[li] = buf[li] + 1.;
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn cs_sync() {\n  workgroupBarrier();\n}');
  });
});
