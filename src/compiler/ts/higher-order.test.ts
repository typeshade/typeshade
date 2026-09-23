// A function whose parameter has a function type takes a function (Rule 8.18, surface §14): it
// is compiled once for each function its calls hand it, and a call hands one over by its name
// or as an arrow function written there, which is a local function of the calling body (Rule
// 8.17). Before this, `f: (x: f32) => f32` was `TS8002 Unsupported type syntax`, and an arrow
// function written as an argument `TS8099 Unsupported expression`.
//
// What is pinned here: the copy each form makes, on WGSL and GLSL ES 3.00; one value for each
// form on the CPU oracle and codegen at both precisions, on the debugger, and on the oracle over
// the optimized module; every refusal by code and text; and the editor agreeing, with no
// diagnostic on the same program.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile } from './compile.js';
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

const APPLY = `function apply(f: (x: f32) => f32, x: f32): f32 {
  return f(x);
}
function sq(x: f32): f32 {
  return x * x;
}
`;

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
 *  the debugger (f32), and the oracle over the optimized module the targets are written from. */
function run(src: string, arg = 2): unknown {
  const r = compile(src);
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
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

describe('a call hands a function over by its name (Rule 8.18)', () => {
  it('a module function: one copy for it, made once however many calls hand it over', () => {
    const src = RUN(`${APPLY}export function run(k: f32): f32 {
  return apply(sq, k) + apply(sq, 1.);
}`);
    expect(run(src)).toBe(5);
    const r = compile(src);
    expect(r.wgsl).toContain('fn apply_sq(x: f32) -> f32 {\n  return sq(x);\n}');
    expect(r.wgsl!.match(/fn apply_sq\(/g)).toHaveLength(1);
    expect(r.wgsl).toContain('(apply_sq(k) + apply_sq(1.0))');
    expect(r.glsl!.fragment).toContain('float apply_sq(float x) {');
  });

  it('a local function, whose captures the copy takes and passes on', () => {
    const src = RUN(`${APPLY}export function run(k: f32): f32 {
  const scale = (x: f32): f32 => x * k;
  return apply(scale, 3.);
}`);
    expect(run(src)).toBe(6);
    expect(compile(src).wgsl).toContain(
      'fn apply_run_scale(k: f32, x: f32) -> f32 {\n  return run_scale(k, x);\n}',
    );
  });

  it('a parameter that takes a function, handed on to another', () => {
    const src = RUN(`${APPLY}function twice(f: (x: f32) => f32, x: f32): f32 {
  return apply(f, apply(f, x));
}
export function run(k: f32): f32 {
  return twice((x) => x + k, 1.);
}`);
    expect(run(src)).toBe(5);
    const r = compile(src);
    expect(r.wgsl).toContain(
      'fn twice_run_f(k: f32, x: f32) -> f32 {\n  return apply_run_f(k, apply_run_f(k, x));\n}',
    );
  });

  it('through a type alias, two at once, and the same one twice', () => {
    expect(
      run(
        RUN(`type Op = (a: f32, b: f32) => f32;
function fold3(op: Op, a: f32, b: f32, c: f32): f32 {
  return op(op(a, b), c);
}
export function run(k: f32): f32 {
  return fold3((a, b) => a * b, k, 3., 4.);
}`),
      ),
    ).toBe(24);
    const both = RUN(`function both(f: (x: f32) => f32, g: (x: f32) => f32, x: f32): f32 {
  return g(f(x));
}
function sq(x: f32): f32 {
  return x * x;
}
export function run(k: f32): f32 {
  return both(sq, (x) => x + k, 3.) + both(sq, sq, k);
}`);
    expect(run(both)).toBe(27);
    expect(compile(both).wgsl).toContain('fn both_sq_sq(x: f32) -> f32 {');
    // Two sets whose names join to one spelling are two copies, the second renamed.
    const joined = RUN(`function both(f: (x: f32) => f32, g: (x: f32) => f32, x: f32): f32 {
  return g(f(x));
}
function a_b(x: f32): f32 {
  return x + 1.;
}
function c(x: f32): f32 {
  return x * 10.;
}
function a(x: f32): f32 {
  return x + 100.;
}
function b_c(x: f32): f32 {
  return x * 1000.;
}
export function run(k: f32): f32 {
  return both(a_b, c, k) + both(a, b_c, k);
}`);
    expect(run(joined)).toBe(102030);
    expect(compile(joined).wgsl).toContain('fn both_a_b_c_1(x: f32) -> f32 {');
  });
});

describe('an arrow function written in the call is a local function of the calling body', () => {
  it('typed by the parameter where it writes no types, in each spelling', () => {
    expect(
      run(
        RUN(`${APPLY}export function run(k: f32): f32 {
  return apply((x) => x * k, 5.);
}`),
      ),
    ).toBe(10);
    expect(
      run(
        RUN(`${APPLY}export function run(k: f32): f32 {
  return apply((x: f32): f32 => x + k, 1.);
}`),
      ),
    ).toBe(3);
    expect(
      run(
        RUN(`${APPLY}export function run(k: f32): f32 {
  return apply((x) => {
    const y = x + 1.;
    return y * k;
  }, 2.);
}`),
      ),
    ).toBe(6);
    expect(
      run(
        RUN(`${APPLY}export function run(k: f32): f32 {
  return apply(function (x) {
    return x - k;
  }, 5.);
}`),
      ),
    ).toBe(3);
  });

  it('leaving parameters off at the end, which the call still passes', () => {
    const src = RUN(`${APPLY}export function run(k: f32): f32 {
  return apply(() => k * 10., 1.);
}`);
    expect(run(src)).toBe(20);
    expect(compile(src).wgsl).toContain('fn run_f(k: f32, _1: f32) -> f32 {');
  });

  it('writing what it captures by reference, through the copy', () => {
    const src = RUN(`function repeat3(body: () => void): void {
  for (let i = 0; i < 3; i++) {
    body();
  }
}
export function run(k: f32): f32 {
  let s = 0.;
  repeat3(() => {
    s += k;
  });
  return s;
}`);
    expect(run(src)).toBe(6);
    const r = compile(src);
    expect(r.wgsl).toContain('fn run_body(s: ptr<function, f32>, k: f32) {\n  (*s) += k;\n}');
    expect(r.wgsl).toContain('fn repeat3_run_body(s: ptr<function, f32>, k: f32) {');
    expect(r.wgsl).toContain('repeat3_run_body(&s, k);');
    expect(r.glsl!.fragment).toContain('void repeat3_run_body(inout float s, float k) {');
    // Handed on through a second copy, it is still the caller's variable that is written.
    expect(
      run(
        RUN(`function repeat3(body: () => void): void {
  for (let i = 0; i < 3; i++) {
    body();
  }
}
function twice(body: () => void): void {
  repeat3(body);
  repeat3(body);
}
export function run(k: f32): f32 {
  let n = 0.;
  twice(() => {
    n += k;
  });
  return n;
}`),
      ),
    ).toBe(12);
  });

  it('whose expression body runs as a statement where the type returns void', () => {
    const repeat3 = `function repeat3(body: () => void): void {
  for (let i = 0; i < 3; i++) {
    body();
  }
}
`;
    expect(
      run(
        RUN(`${repeat3}export function run(k: f32): f32 {
  let s = 1.;
  repeat3(() => s *= k);
  return s;
}`),
      ),
    ).toBe(8);
    expect(
      run(
        RUN(`class V {
  x: f32 = 0.;
  setX(v: f32): V {
    this.x = v;
    return this;
  }
}
${repeat3}export function run(k: f32): f32 {
  let v = new V();
  repeat3(() => v.setX(v.x + k));
  return v.x;
}`),
      ),
    ).toBe(6);
  });

  it('reading this of the method around it, and writing it', () => {
    expect(
      run(
        RUN(`${APPLY}class A {
  g: f32 = 3.;
  m(x: f32): f32 {
    return apply((y) => y * this.g, x);
  }
}
export function run(k: f32): f32 {
  return new A().m(k);
}`),
      ),
    ).toBe(6);
    const src = RUN(`function each3(f: (i: i32) => void): void {
  for (let i = 0; i < 3; i++) {
    f(i);
  }
}
class A {
  t: f32 = 0.;
  m(x: f32): f32 {
    each3((i) => {
      this.t += f32(i) * x;
    });
    return this.t;
  }
}
export function run(k: f32): f32 {
  let a = new A();
  return a.m(k);
}`);
    expect(run(src)).toBe(6);
    expect(compile(src).wgsl).toContain('fn each3_A_m_f(self_: ptr<function, A>, x: f32) {');
    expect(
      run(
        RUN(`${APPLY}class M {
  static K: f32 = 4.;
  static f(x: f32): f32 {
    return apply((y) => y * this.K, x);
  }
}
export function run(k: f32): f32 {
  return M.f(k);
}`),
      ),
    ).toBe(8);
  });

  it('inside another, a local function, a generic function and a namespace', () => {
    expect(
      run(
        RUN(`${APPLY}export function run(k: f32): f32 {
  return apply((x) => apply((y) => y + k, x) * 2., 1.);
}`),
      ),
    ).toBe(6);
    expect(
      run(
        RUN(`${APPLY}export function run(k: f32): f32 {
  const g = (y: f32): f32 => apply((x) => x * k, y);
  return g(3.);
}`),
      ),
    ).toBe(6);
    expect(
      run(
        RUN(`${APPLY}function viaT<T>(a: T, k: f32): f32 {
  return apply((x) => x * k, 2.);
}
export function run(k: f32): f32 {
  return viaT(1., k);
}`),
      ),
    ).toBe(4);
    expect(
      run(
        RUN(`namespace N {
  export function apply(f: (x: f32) => f32, x: f32): f32 {
    return f(x);
  }
}
export function run(k: f32): f32 {
  return N.apply((x) => x * k, 3.);
}`),
      ),
    ).toBe(6);
  });

  it('whose own local function calls the parameter, passing what it captures', () => {
    const src = RUN(`function twice(f: (x: f32) => f32, x: f32): f32 {
  const g = (y: f32): f32 => f(y) * 2.;
  return g(g(x));
}
export function run(k: f32): f32 {
  return twice((x) => x + k, 1.);
}`);
    expect(run(src)).toBe(16);
    expect(compile(src).wgsl).toContain(
      'fn twice_run_f_g(k: f32, y: f32) -> f32 {\n  return (run_f(k, y) * 2.0);\n}',
    );
  });
});

describe('a generic function that takes a function (Rules 8.9, 8.18)', () => {
  it('reads its type arguments off the values, or off the function handed over', () => {
    expect(
      run(
        RUN(`function mapTwo<T>(f: (x: T) => T, a: T): T {
  return f(f(a));
}
export function run(k: f32): f32 {
  return mapTwo((x) => x * k, 1.);
}`),
      ),
    ).toBe(4);
    expect(
      run(
        RUN(`function via<T>(f: (x: T) => T, a: T): T {
  return f(a);
}
function inc(x: f32): f32 {
  return x + 1.;
}
export function run(k: f32): f32 {
  return via(inc, k);
}`),
      ),
    ).toBe(3);
  });

  it('including one a namespace declares, called by its qualified name', () => {
    expect(
      run(
        RUN(`namespace N {
  export function pick<T>(a: T, b: T): T {
    return b;
  }
}
export function run(k: f32): f32 {
  return N.pick(1., k);
}`),
      ),
    ).toBe(2);
  });
});

describe('a fold takes an arrow function written in the call (Rule 8.18)', () => {
  it('any, all and none, typed by the array', () => {
    const XS = 'const xs = array<f32, 3>(1., 3., 5.);';
    expect(
      run(
        RUN(`export function run(k: f32): f32 {
  ${XS}
  return any(xs, (x) => x > k * 2.) ? 1. : 0.;
}`),
      ),
    ).toBe(1);
    expect(
      run(
        RUN(`export function run(k: f32): f32 {
  ${XS}
  return all(xs, (x: f32): bool => x > k) ? 1. : 0.;
}`),
      ),
    ).toBe(0);
    expect(
      run(
        RUN(`export function run(k: f32): f32 {
  ${XS}
  return none(xs, (x) => x > 10. * k) ? 1. : 0.;
}`),
      ),
    ).toBe(1);
    // `any` stops at the first match: two calls write `n`, not three.
    expect(
      run(
        RUN(`export function run(k: f32): f32 {
  let n = 0.;
  ${XS}
  const hit = any(xs, (x) => {
    n += 1.;
    return x > k;
  });
  return hit ? n : -n;
}`),
      ),
    ).toBe(2);
  });

  it('zip, whose function returns what its body does', () => {
    const src = RUN(`export function run(k: f32): f32 {
  const xs = array<f32, 2>(1., 3.);
  const ys = array<f32, 2>(2., 4.);
  const z = zip(xs, ys, (a, b) => a * b + k);
  return z[0] + z[1];
}`);
    expect(run(src)).toBe(18);
    expect(compile(src).wgsl).toContain('fn run_zip(k: f32, a: f32, b: f32) -> f32 {');
    expect(
      run(
        RUN(`export function run(k: f32): f32 {
  const xs = array<f32, 2>(1., 3.);
  const ys = array<f32, 2>(2., 4.);
  const z = zip(xs, ys, (a, b) => {
    return vec2(a, b * k);
  });
  return z[1].y;
}`),
      ),
    ).toBe(8);
  });
});

describe('what a function that takes a function may not be handed, or be (Rule 8.18)', () => {
  const F = TS_CODES;
  it('a function that does not fit the parameter', () => {
    expect(
      only(
        RUN(`${APPLY}function add(a: f32, b: f32): f32 {
  return a + b;
}
export function run(k: f32): f32 {
  return apply(add, k);
}`),
      ),
    ).toBe(
      `${F.TYPE_MISMATCH} "add" takes 2 argument(s), and "(x: f32) => f32" passes 1, so it cannot be "f" of "apply".`,
    );
    expect(
      only(
        RUN(`${APPLY}function flag(x: f32): bool {
  return x > 1.;
}
export function run(k: f32): f32 {
  return apply(flag, k);
}`),
      ),
    ).toBe(
      `${F.TYPE_MISMATCH} "flag" returns bool, where "(x: f32) => f32" returns f32, so it cannot be "f" of "apply".`,
    );
  });

  it('a choice made at run time, a value, a builtin, or nothing', () => {
    expect(
      only(
        RUN(`${APPLY}function cube(x: f32): f32 {
  return x * x * x;
}
export function run(k: f32): f32 {
  return apply(k > 1. ? sq : cube, k);
}`),
      ),
    ).toBe(
      `${F.UNSUPPORTED} "f" of "apply" takes a function, which a call hands over by its name or as an arrow function written there; "k > 1. ? sq : cube" would choose one at run time, and a shader has no function value to choose with.`,
    );
    expect(
      only(
        RUN(`${APPLY}export function run(k: f32): f32 {
  return apply(k, k);
}`),
      ),
    ).toBe(
      `${F.TYPE_MISMATCH} "k" is a value, and "f" of "apply" takes a function: hand one over by its name, or write it here as an arrow function.`,
    );
    expect(
      only(
        RUN(`${APPLY}export function run(k: f32): f32 {
  return apply(sin, k);
}`),
      ),
    ).toBe(
      `${F.TYPE_MISMATCH} "sin" is no function this file declares, and "f" of "apply" takes one: hand over one the file declares, or write an arrow function that calls it here, "(…) => sin(…)".`,
    );
    expect(
      only(
        RUN(`${APPLY}export function run(k: f32): f32 {
  return apply();
}`),
      ),
    ).toBe(
      `${F.ARITY_MISMATCH} "apply" takes a function for "f", "(x: f32) => f32": hand one over by its name, or write it here as an arrow function.`,
    );
  });

  it('a parameter of function type held, or a function type anywhere but a parameter', () => {
    expect(
      errorsOf(
        RUN(`function keep(f: (x: f32) => f32, x: f32): f32 {
  const g = f;
  return x;
}
function sq(x: f32): f32 {
  return x * x;
}
export function run(k: f32): f32 {
  return keep(sq, k);
}`),
      )[0],
    ).toBe(
      `${F.UNSUPPORTED} "f" is a function, and a shader has no function values: nothing at run time can hold one, return one or choose between two. Call it where its value is needed, "f(...)", or hand it to a parameter that takes a function (Rule 8.18).`,
    );
    const fnType = `${F.UNKNOWN_TYPE} "(x: f32) => f32" is a function type, and nothing a shader holds is a function: a function takes one as a parameter, "f: (x: f32) => f32", and a call hands it a function by its name or as an arrow function written there (Rule 8.18).`;
    expect(
      only(
        RUN(`function make(): (x: f32) => f32 {
  return (x) => x;
}
export function run(k: f32): f32 {
  return k;
}`),
      ),
    ).toBe(fnType);
    expect(
      only(
        RUN(`class C {
  f: (x: f32) => f32;
}
export function run(k: f32): f32 {
  return k;
}`),
      ),
    ).toBe(fnType);
  });

  it('a parameter of function type on a method, a local function or an entry', () => {
    expect(
      only(
        RUN(`class G {
  n: f32 = 1.;
  each(f: (i: i32) => void): void {
    f(0);
  }
}
export function run(k: f32): f32 {
  return k;
}`),
      ),
    ).toBe(
      `${F.FUNCTION_SHAPE} "f" takes a function, which only a function declared at the top of the file or of a namespace may take (Rule 8.18): declare one there that takes it, and call that from "G.each".`,
    );
    expect(
      only(
        RUN(`export function run(k: f32): f32 {
  const apply = (f: (x: f32) => f32, x: f32): f32 => f(x);
  return k;
}`),
      ),
    ).toBe(
      `${F.FUNCTION_SHAPE} "f" takes a function, which only a function declared at the top of the file or of a namespace may take (Rule 8.18): declare one there that takes it, and call that from "apply" in "run".`,
    );
    expect(
      only(`"use typeshade";
@fragment
export function fs(f: (x: f32) => f32): vec4 {
  return vec4(1.);
}
`),
    ).toBe(
      `${F.FUNCTION_SHAPE} An entry's parameters come from the pipeline, and a function is nothing the pipeline can supply: take the function in a helper the entry calls (Rule 8.18).`,
    );
  });

  it('a copy that would call itself with a function made anew for each call', () => {
    expect(
      errorsOf(
        RUN(`function rep(n: i32, f: () => f32): f32 {
  if (n <= 0) {
    return f();
  }
  return rep(n - 1, () => f() + 1.);
}
export function run(k: f32): f32 {
  return rep(2, () => k);
}`),
      )[0],
    ).toBe(
      `${F.RECURSION} "rep" calls itself, through the functions it is handed, with a function made anew for each call, so there is no last copy of it to compile. WGSL has no call stack, so a function must not take part in a call cycle (Rule 8.4).`,
    );
  });

  it('an arrow function that reads a variable not declared yet where it runs', () => {
    expect(
      errorsOf(
        RUN(`${APPLY}export function run(k: f32): f32 {
  const r = apply((x) => x * later, k);
  const later = 2.;
  return r;
}`),
      )[0],
    ).toBe(
      `${F.UNKNOWN_NAME} The function written here reads "later", which is not declared yet where it runs: a let or a const is not there before its declaration, and TypeScript throws. Declare "later" above this call.`,
    );
  });
});

describe('examples/higher-order.shade.ts', () => {
  it('renders the disc, the petals, the glow and the rings on every CPU path', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../../../examples/higher-order.shade.ts', import.meta.url)),
      'utf8',
    );
    const r = compile(src);
    expect(r.diagnostics).toEqual([]);
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
    // The disc `cover` was handed by its name, lit by the glow the arrow wrote into `glow`.
    expect(at([0, 0])).toEqual([0.959, 0.706, 0.318, 1]);
    // A petal: `around4` handed the local `petal`, inside the arrow `cover` was handed.
    expect(at([0.5, 0])).toEqual([0.32, 0.714, 0.991, 1]);
    expect(at([0, 0.5])).toEqual([0.32, 0.714, 0.991, 1]);
    // A ring the fold's arrow found, and the background between.
    expect(at([0.62, 0.62])).toEqual([1, 1, 1, 1]);
    expect(at([0.3, 0.1])).toEqual([0.107, 0.098, 0.214, 1]);
  });
});

describe('the editor agrees', () => {
  it('reports nothing on a program that hands functions over, to a function and to a fold', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument(
      'a.ts',
      `"use typeshade";
type Op = (a: f32, b: f32) => f32;
function fold3(op: Op, a: f32, b: f32, c: f32): f32 {
  return op(op(a, b), c);
}
function repeat3(body: () => void): void {
  for (let i = 0; i < 3; i++) {
    body();
  }
}
export function run(k: f32): f32 {
  let s = 0.;
  repeat3(() => {
    s += k;
  });
  const xs = array<f32, 3>(1., 2., 3.);
  const z = zip(xs, xs, (a, b) => a * b);
  const hit = any(xs, (x) => x > k) || none(xs, (x) => x < 0.);
  return fold3((a, b) => a * b, k, 3., 4.) + s + sum(z) + min(xs) + max(xs) + (hit ? 1. : 0.);
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

describe('a parameter that takes a function, named after a builtin (Rule 9.5)', () => {
  it('is the function the call handed over, not the builtin', () => {
    const src = RUN(`function sixteen(step: (i: i32) => void): void {
  for (let i = 0; i < 16; i++) {
    step(i);
  }
}
export function run(k: f32): f32 {
  let s = 0.;
  sixteen((i) => {
    s += f32(i) * k;
  });
  return s;
}`);
    // WGSL's `step(edge, x)` takes two arguments, and was what `step(i)` reached.
    expect(run(src)).toBe(240);
    expect(compile(src).wgsl).toContain('fn sixteen_run_step(s: ptr<function, f32>, k: f32) {');
  });
});
