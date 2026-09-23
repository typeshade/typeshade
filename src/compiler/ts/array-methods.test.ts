// Verifies: Rule 8.18 (docs/language-design.md; traced in reqs/).
// An array's map, forEach, some, every and reduce (Rule 8.18, surface §63): each call is a call of
// a function of the module made for the array's type and the function handed over, a counted
// loop over the indices (Rule 7.5). Before this, every method of an array was `TS8099 JS Array
// method ".map" is not a shader op. Use sum/min/any/all/zip/fill.`
//
// What is pinned here: the loop each method makes, on WGSL and GLSL ES 3.00; one value for each
// on the CPU oracle and codegen at both precisions, on the debugger, and on the oracle over the
// optimized module, for a fixed-size array and for a runtime-sized storage array; what a
// function handed over captures, by value and by reference; a function that writes the array
// ahead of the loop, which the loop reads as TypeScript does; every refusal by code and text;
// and the editor agreeing, with no diagnostic on the programs the compiler accepts.

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { TS_CODES } from './codes.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import type { CpuValue } from '../../core/cpu-runtime.js';
import { startDebugSession } from '../../core/debug/session.js';
import { optimize } from '../../core/passes/opt/optimize.js';
import { autoVars } from '../../core/passes/opt/index.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const F = TS_CODES;

/** `body` with an entry that calls `run(2.)`: the GLSL writer emits only what an entry reaches. */
const RUN = (body: string): string =>
  `"use typeshade";\n${body}\n@fragment\nexport function fs(): vec4 { return vec4(run(2.), 0., 0., 1.); }\n`;

/** A `run(k)` whose body starts with `const xs = array<f32, 4>(1., 2., 3., 4.)`. */
const XS = (body: string, before = ''): string =>
  RUN(`${before}
export function run(k: f32): f32 {
  const xs = array<f32, 4>(1., 2., 3., 4.);
  ${body}
}`);

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

/** What the editor reports on `src`, which must be nothing on a program the compiler accepts. */
function editor(src: string): string[] {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.shade.ts', src);
  return service.getDiagnostics('a.shade.ts').map((d) => `${d.code} ${d.message}`);
}

/** `run(2)` on every CPU path, which must agree: the oracle and the codegen at f64 and at f32,
 *  the debugger (f32), and the oracle over the optimized module the targets are written from. */
function run(src: string, arg = 2): unknown {
  const r = compile(src);
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  expect(editor(src)).toEqual([]);
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

/** The compute entry `main` run once for each `gid.x` below `n`, on the oracle and the codegen
 *  at both precisions and on the debugger, each with its own copy of `bindings`; they must
 *  agree. What each left in the binding named `out`. */
function kernel(src: string, bindings: Record<string, unknown>, n: number): number[] {
  const r = compile(src);
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  expect(editor(src)).toEqual([]);
  const fresh = (): Record<string, unknown> =>
    JSON.parse(JSON.stringify(bindings)) as Record<string, unknown>;
  const results: number[][] = [];
  for (const make of [
    (m: typeof r.module) => compileModule(m),
    (m: typeof r.module) => compileModule(m, { precision: 'f32' }),
    (m: typeof r.module) => compileModuleJs(m),
    (m: typeof r.module) => compileModuleJs(m, { precision: 'f32' }),
  ]) {
    const cm = make(r.module);
    const b = fresh();
    for (const [name, value] of Object.entries(b)) cm.setBinding(name, value as CpuValue);
    for (let x = 0; x < n; x++) cm.fns['main']!([x, 0, 0]);
    results.push(b['out'] as number[]);
  }
  const b = fresh();
  for (let x = 0; x < n; x++) {
    const s = startDebugSession(r.module, 'main', [[x, 0, 0]], {
      bindings: b as Record<string, CpuValue>,
    });
    s.continue();
    expect(s.done).toBe(true);
  }
  results.push(b['out'] as number[]);
  for (const other of results.slice(1)) {
    expect(other.map((v) => Math.fround(v))).toEqual(results[0]!.map((v) => Math.fround(v)));
  }
  return results[0]!;
}

describe("each of an array's five methods is a loop the call runs (Rule 8.18, surface §63)", () => {
  it('map, forEach, some, every and reduce on a fixed-size array', () => {
    const src = XS(`const scaled = xs.map((x, i) => x * f32(i + 1));
  let glow = 0.;
  xs.forEach((x) => {
    glow += x * k;
  });
  const big = xs.some((x) => x > k);
  const pos = xs.every((x) => x > 0.);
  const total = scaled.reduce((acc, x) => acc + x, 0.);
  const most = xs.reduce((a, b) => max(a, b));
  return total + glow + (big ? 100. : 0.) + (pos ? 1000. : 0.) + most;`);
    // scaled = 1, 4, 9, 16: total 30; glow = 10 * 2 = 20; 3 > 2; all positive; most 4.
    expect(run(src)).toBe(1154);
    const r = compile(src);
    expect(r.wgsl).toContain(`fn array_map_run_f(xs: array<f32, 4>) -> array<f32, 4> {
  var out: array<f32, 4>;
  for (var i: i32 = 0; (i < 4); i = (i + 1)) {
    out[i] = run_f(xs[i], i);
  }
  return out;
}`);
    expect(r.wgsl).toContain(
      'fn array_forEach_run_f_1(glow: ptr<function, f32>, k: f32, xs: array<f32, 4>) {',
    );
    expect(r.wgsl).toContain(`fn array_some_run_p(k: f32, xs: array<f32, 4>) -> bool {
  for (var i: i32 = 0; (i < 4); i = (i + 1)) {
    if (run_p(k, xs[i])) {
      return true;
    }
  }
  return false;
}`);
    expect(r.wgsl).toContain('if ((run_p_1(xs[i]) == false)) {');
    expect(r.wgsl).toContain(`fn array_reduce_run_f_3(xs: array<f32, 4>) -> f32 {
  var acc: f32 = xs[0];
  for (var i: i32 = 1; (i < 4); i = (i + 1)) {`);
    expect(r.wgsl).toContain('let scaled = array_map_run_f(xs);');
    expect(r.glsl!.fragment).toContain('float[4] array_map_run_f(float[4] xs) {');
    expect(r.glsl!.fragment).toContain(
      'void array_forEach_run_f_1(inout float glow, float k, float[4] xs) {',
    );
  });

  it('a function handed over by its name, which may take fewer arguments than the method passes', () => {
    const src = XS(
      `const sqs = xs.map(sq);
  return xs.reduce(add, 0.) + sqs[3] + f32(xs.map(index)[2]);`,
      `function sq(x: f32): f32 {
  return x * x;
}
function add(acc: f32, x: f32): f32 {
  return acc + x;
}
function index(x: f32, i: i32): i32 {
  return i;
}`,
    );
    // 10 + 16 + 2.
    expect(run(src)).toBe(28);
    const r = compile(src);
    expect(r.wgsl).toContain('out[i] = sq(xs[i]);');
    expect(r.wgsl).toContain('fn array_reduce_add(xs: array<f32, 4>, init: f32) -> f32 {');
    expect(r.wgsl).toContain('fn array_map_index(xs: array<f32, 4>) -> array<i32, 4> {');
  });

  it('some stops at the first element that passes, every at the first that fails', () => {
    const src = XS(`let calls = 0.;
  const s = xs.some((x) => {
    calls += 1.;
    return x > 1.5;
  });
  const e = xs.every((x) => {
    calls += 10.;
    return x < 2.5;
  });
  return calls + (s ? 100. : 0.) + (e ? 1000. : 0.);`);
    // some calls twice and passes at 2; every calls three times and fails at 3.
    expect(run(src)).toBe(132);
  });

  it('reduce: the running value takes the type the function or the value to start from says', () => {
    const src = XS(`const v = xs.reduce((a: vec2, x) => a + vec2(x, 1.), vec2(0.));
  const n = xs.reduce((c: i32, x) => (x > k ? c + 1 : c), 0);
  const s = xs.reduce((a, x) => a + x, 0);
  return v.x + v.y + f32(n) + s;`);
    // v = (10, 4); two elements above 2; a written 0 nothing declares an integer is an f32.
    expect(run(src)).toBe(26);
    const r = compile(src);
    expect(r.wgsl).toContain(
      'fn array_reduce_run_f(xs: array<f32, 4>, init: vec2<f32>) -> vec2<f32> {',
    );
    expect(r.wgsl).toContain(
      'fn array_reduce_run_f_1(k: f32, xs: array<f32, 4>, init: i32) -> i32 {',
    );
    expect(r.wgsl).toContain('fn array_reduce_run_f_2(xs: array<f32, 4>, init: f32) -> f32 {');
  });

  it('a call stands wherever a call may: in an argument, beside &&, and inside another method', () => {
    const src = XS(`const inner = xs.map((x) => xs.reduce((a, y) => a + x * y, 0.));
  const both = k > 0. && xs.some((x) => x > k);
  return inner.reduce((a, b) => a + b, 0.) + (both ? 1. : 0.) + max(xs.reduce((a, b) => a + b, 0.), k);`);
    // inner sums to 10 * 10; 3 > 2; the sum is 10.
    expect(run(src)).toBe(111);
  });
});

describe('what the function handed over captures (Rules 8.17, 8.18)', () => {
  it('by value where nothing writes it, by reference where it writes, through a nested one too', () => {
    const src = XS(`let total = 0.;
  xs.forEach((x) => {
    xs.forEach((y) => {
      total += x * y * k;
    });
  });
  return total;`);
    // (1 + 2 + 3 + 4)^2 * 2.
    expect(run(src)).toBe(200);
    const r = compile(src);
    // The inner call's function writes `total`, so both loops take it by reference; the outer
    // function captures `xs` for the inner call, and the outer loop reads the array through it.
    expect(r.wgsl).toContain(
      'fn array_forEach_run_f_f(total: ptr<function, f32>, x: f32, k: f32, xs: array<f32, 4>) {',
    );
    expect(r.wgsl).toContain(
      'fn array_forEach_run_f(xs: array<f32, 4>, total: ptr<function, f32>, k: f32) {',
    );
    expect(r.glsl!.fragment).toContain(
      'void array_forEach_run_f(float[4] xs, inout float total, float k) {',
    );
  });

  it('a local function, and a parameter that takes a function, handed on to a method', () => {
    const src = RUN(`function apply(f: (x: f32) => f32, ys: array<f32, 4>): f32 {
  return ys.map(f)[3];
}
export function run(k: f32): f32 {
  const xs = array<f32, 4>(1., 2., 3., 4.);
  let total = 0.;
  function add(x: f32) {
    total += x * k;
  }
  xs.forEach(add);
  return total + apply((x) => x * k, xs);
}`);
    // total = 20; apply maps 4 to 8.
    expect(run(src)).toBe(28);
    const r = compile(src);
    expect(r.wgsl).toContain('fn array_map_run_f(k: f32, ys: array<f32, 4>) -> array<f32, 4> {');
    expect(r.wgsl).toContain('fn apply_run_f(k: f32, ys: array<f32, 4>) -> f32 {');
  });
});

describe('the array is read as it goes, as TypeScript reads it (Rule 8.18)', () => {
  it('a function that writes the array ahead of the loop: the loop reads what it wrote', () => {
    const src = RUN(`class Bag {
  items: array<f32, 3> = array<f32, 3>(1., 2., 3.);
  total: f32 = 0.;
  bump() {
    this.items.forEach((x, i) => {
      if (i < 2) {
        this.items[i + 1] += x;
      }
    });
  }
}
export function run(k: f32): f32 {
  let xs = array<f32, 4>(1., 2., 3., 4.);
  xs.forEach((x, i) => {
    if (i < 3) {
      xs[i + 1] += x;
    }
  });
  let b = new Bag();
  b.bump();
  return xs[3] + b.items[2] * k;
}`);
    // Running sums, each element read after the one before it was added in: 1, 3, 6, 10; and
    // 1, 3, 6 on the object's own array.
    expect(run(src)).toBe(22);
    const r = compile(src);
    // One reference, the one the function writes through.
    expect(r.wgsl).toContain(`fn array_forEach_run_f(xs: ptr<function, array<f32, 4>>) {
  for (var i: i32 = 0; (i < 4); i = (i + 1)) {
    run_f(xs, (*xs)[i], i);
  }
}`);
    expect(r.wgsl).toContain('Bag_bump_f(self_, (*self_).items[i], i);');
    expect(r.glsl!.fragment).toContain('void array_forEach_run_f(inout float[4] xs) {');
  });

  it('a module constant is read in place', () => {
    const src = RUN(`const W = array<f32, 3>(1., 2., 3.);
export function run(k: f32): f32 {
  return W.reduce((a, w) => a + w * k, 0.);
}`);
    expect(run(src)).toBe(12);
    expect(compile(src).wgsl).toContain('fn array_reduce_run_f(k: f32, init: f32) -> f32 {');
  });
});

describe('on a runtime-sized storage array, and on one a binding holds', () => {
  const LIGHTS = `"use typeshade";
class Light {
  pos: vec2;
  radius: f32;
  power: f32;
}
declare const lights: storage<array<Light>>;
declare const data: storage<array<f32>>;
declare const out: storage<array<f32>, "read_write">;
@compute([1])
export function main(@builtin("global_invocation_id") gid: vec3u) {
  const p = vec2(f32(gid.x), 0.);
  const lit = lights.some((l) => distance(l.pos, p) < l.radius);
  const dark = lights.every((l) => distance(l.pos, p) > l.radius);
  let glow = 0.;
  lights.forEach((l, i) => {
    glow += l.power / (1. + distance(l.pos, p)) + f32(i);
  });
  const total = data.reduce((a, x) => a + x, 0.);
  out[gid.x] = glow + total + (lit ? 100. : 0.) + (dark ? 1000. : 0.);
}
`;

  it('forEach, some, every and reduce read the binding in place, as long as the host bound it', () => {
    const got = kernel(
      LIGHTS,
      {
        lights: [
          { pos: [0, 0], radius: 0.5, power: 2 },
          { pos: [3, 0], radius: 1, power: 1 },
        ],
        data: [1, 2, 3.5],
        out: [0, 0],
      },
      2,
    );
    // gid 0: in the first light, glow 2 + (1/4 + 1); gid 1: in neither, glow 1 + (1/3 + 1).
    expect(got.map((v) => Math.fround(v))).toEqual(
      [3.25 + 6.5 + 100, 2 + 1 / 3 + 6.5 + 1000].map((v) => Math.fround(v)),
    );
    const r = compile(LIGHTS);
    expect(r.wgsl).toContain('fn array_forEach_main_f(glow: ptr<function, f32>, p: vec2<f32>) {');
    expect(r.wgsl).toContain('i32(arrayLength(&lights))');
    expect(r.wgsl).toContain('main_f(glow, p, lights[i], i);');
  });

  it('writes to a read_write binding ahead of the loop are read, and an index on the way is read once', () => {
    const src = `"use typeshade";
class Cell {
  xs: array<f32, 3>;
  w: f32;
}
declare const buf: storage<array<f32>, "read_write">;
declare const cells: storage<array<Cell>, "read_write">;
declare const out: storage<array<f32>, "read_write">;
@compute([1])
export function main(@builtin("global_invocation_id") gid: vec3u) {
  buf.forEach((x, i) => {
    if (i + 1 < i32(buf.length)) {
      buf[i + 1] += x;
    }
  });
  let j = gid.x;
  cells[j].xs.forEach((x, i) => {
    j = u32(1) - gid.x;
    if (i < 2) {
      cells[gid.x].xs[i + 1] += x;
    }
  });
  out[gid.x] = buf[3] + cells[gid.x].xs[2] * 100. + f32(j) * 1000.;
}
`;
    const got = kernel(
      src,
      {
        buf: [1, 2, 3, 4],
        cells: [
          { xs: [1, 1, 1], w: 0 },
          { xs: [2, 2, 2], w: 0 },
        ],
        out: [0, 0],
      },
      1,
    );
    // The running sums 1, 3, 6, 10; cell 0's own, 1, 2, 3, though `j` moved to 1 in the first
    // call; `j` is 1 after.
    expect(got).toEqual([10 + 300 + 1000, 0]);
    expect(compile(src).wgsl).toContain(
      'fn array_forEach_main_f_1(j: ptr<function, u32>, gid: vec3<u32>, at: u32) {',
    );
  });
});

describe('what an array method refuses, each with the fix (Rule 8.18)', () => {
  it('the other methods of Array.prototype', () => {
    expect(only(XS('return xs.filter((x) => x > k)[0];'))).toBe(
      `${F.UNSUPPORTED} ".filter" is not one of an array's methods here, which are map, forEach, some, every and reduce. An array's length is fixed, so a search, a copy or a change of length is a loop: "for (const x of xs) { … }".`,
    );
    expect(only(XS('const g = xs.map;\n  return 0.;'))).toBe(
      `${F.UNSUPPORTED} ".map" is a method of the array, and a shader has no function values: call it where its value is needed, "xs.map(…)".`,
    );
    expect(only(XS('const v = vec3(1.);\n  return v.some((c) => c > 0.) ? 1. : 0.;'))).toBe(
      `${F.TYPE_MISMATCH} "v" is a vec3<f32>, and ".some" is a method of an array.`,
    );
  });

  it('a call that passes what the method does not take', () => {
    expect(only(XS('return xs.some() ? 1. : 0.;'))).toBe(
      `${F.ARITY_MISMATCH} "xs.some" takes a function: hand one over by its name, or write it here as an arrow function.`,
    );
    expect(only(XS('return xs.map((x) => x * k, xs)[0];'))).toBe(
      `${F.ARITY_MISMATCH} "xs.map" takes one argument here, the function. A second one, "thisArg", says what "this" is inside a function written with "function", and an arrow function reads the "this" around it already.`,
    );
    expect(only(XS('return xs.reduce((a, x) => a + x, 0., 1.);'))).toBe(
      `${F.ARITY_MISMATCH} "xs.reduce" takes a function and the value to start from, and this call passes 3 arguments.`,
    );
    expect(only(XS('return xs.reduce((a: f32, x) => a + x, vec2(0.));'))).toBe(
      `${F.TYPE_MISMATCH} "xs.reduce" starts from "vec2(0.)", a vec2<f32>, and its function takes a f32 for the running value.`,
    );
  });

  it('a function that does not fit, or is no function the call can name', () => {
    const decls = `function half(x: i32): f32 {
  return f32(x) * 0.5;
}
function four(a: f32, b: i32, c: array<f32, 4>, d: f32): f32 {
  return a;
}
function sq(x: f32): f32 {
  return x * x;
}
function cube(x: f32): f32 {
  return x * x * x;
}
function id<T>(x: T): T {
  return x;
}`;
    expect(only(XS('return xs.map(half)[0];', decls))).toBe(
      `${F.TYPE_MISMATCH} "half" takes i32 for argument 1, where "(value: f32) => …" passes f32, so it cannot be "f" of "xs.map".`,
    );
    expect(only(XS('return xs.map(four)[0];', decls))).toBe(
      `${F.TYPE_MISMATCH} "four" takes 4 argument(s), and "xs.map" passes at most 3.`,
    );
    expect(only(XS('return xs.map((a, b, c, d) => a)[0];', decls))).toBe(
      `${F.ARITY_MISMATCH} This function takes 4 parameter(s), and "(value: f32, index: i32, array: array<f32, 4>) => …" passes 3.`,
    );
    expect(only(XS('return xs.map(abs)[0];', decls))).toBe(
      `${F.TYPE_MISMATCH} "abs" is no function this file declares, and "xs.map" takes one: hand over one the file declares, or write an arrow function that calls it here, "(…) => abs(…)".`,
    );
    expect(only(XS('return xs.map(id)[0];', decls))).toBe(
      `${F.TYPE_MISMATCH} "id" is generic, and which of its instances to hand to "xs.map" is written nowhere; write an arrow function that calls it here: "(…) => id(…)".`,
    );
    expect(only(XS('return xs.map(k)[0];', decls))).toBe(
      `${F.TYPE_MISMATCH} "k" is a value, and "xs.map" takes a function: hand one over by its name, or write it here as an arrow function.`,
    );
    expect(only(XS('return xs.map(k > 1. ? sq : cube)[0];', decls))).toBe(
      `${F.UNSUPPORTED} "f" of "xs.map" takes a function, which a call hands over by its name or as an arrow function written there; "k > 1. ? sq : cube" would choose one at run time, and a shader has no function value to choose with.`,
    );
    expect(only(XS('let n = 0.;\n  return xs.map((x) => { n += x; })[0];'))).toBe(
      `${F.TYPE_MISMATCH} The function "xs.map" is handed returns nothing, so there is no element to build: return one from it, or call "xs.forEach(…)" to run it for each element.`,
    );
    expect(only(XS('const r = xs.forEach((x) => x * k);\n  return 0.;'))).toBe(
      `${F.TYPE_MISMATCH} "xs.forEach((x) => x * k)" returns nothing, so it cannot initialize "r"; call it on its own line.`,
    );
  });

  it('what a runtime-sized array cannot do: be mapped, reduced from nothing, or handed to a function', () => {
    const K = (body: string): string => `"use typeshade";
declare const data: storage<array<f32>>;
declare const out: storage<array<f32>, "read_write">;
@compute([1])
export function main(@builtin("global_invocation_id") gid: vec3u) {
  ${body}
}
`;
    expect(only(K('out[0] = data.map((x) => x * 2.)[0];'))).toBe(
      `${F.UNSUPPORTED} "data.map" would build an array as long as "data", which has no size before the host binds it, and an array with none exists only in storage. Run "data.forEach(…)" instead and store each value into a storage binding.`,
    );
    expect(only(K('out[0] = data.reduce((a, b) => a + b);'))).toBe(
      `${F.ARITY_MISMATCH} "data.reduce" with no value to start from starts from the first element, and "data" may have none: TypeScript throws a TypeError there, and a shader cannot throw. Hand it the value to start from, "data.reduce(f, 0.)".`,
    );
    expect(only(K('data.forEach((x, i, all) => {\n    out[0] += x;\n  });'))).toBe(
      `${F.UNSUPPORTED} "data" has no size before the host binds it, and a function cannot take an array with none: read "data" by its name inside the function instead.`,
    );
  });
});
