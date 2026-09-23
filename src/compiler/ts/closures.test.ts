// A local function reads and writes the variables of the functions around it, as a TypeScript
// closure does (Rule 8.17, surface §14). Before this, a local function that read a name from the
// body around it was refused (`"f" reads "k" from the function around it. … Pass "k" as a
// parameter.`), and a `function` declaration inside a body was "Unsupported statement".
//
// What is pinned here: the emitted function for each form (a variable read is a parameter every
// call passes, a written one a pointer in WGSL and an `inout` in GLSL ES 3.00), one value for
// each form on the CPU oracle and codegen at both precisions, on the debugger, and on the oracle
// over the optimized module the targets are written from, and every refusal by code and text.

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
 *  the debugger (f32), and the oracle over the optimized module the WGSL and GLSL are written
 *  from, so an optimizer that moved a read across a call that writes it would show here. */
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

describe('a variable a local function reads is a parameter every call passes (Rule 8.17)', () => {
  it('by value, when nothing writes it', () => {
    const src = RUN(`export function run(k: f32): f32 {
  const s = k * 2.;
  const f = (x: f32): f32 => x * s;
  return f(3.);
}`);
    expect(run(src)).toBe(12);
    const r = compile(src);
    expect(r.wgsl).toContain('fn run_f(s: f32, x: f32) -> f32 {\n  return (x * s);\n}');
    expect(r.glsl!.fragment).toContain('float run_f(float s, float x) {');
  });

  it('at the call, so a write between the declaration and the call is seen', () => {
    expect(
      run(
        RUN(`export function run(k: f32): f32 {
  let n = 1.;
  const get = (): f32 => n;
  n = 5.;
  return get();
}`),
      ),
    ).toBe(5);
  });

  it('under its own name, unless a parameter of the function takes the name first', () => {
    // The parameter `n` shadows the variable `n`, so `k` is the one capture.
    const src = RUN(`export function run(k: f32): f32 {
  let n = 5.;
  const f = (n: f32): f32 => n * k;
  return f(1.) + n;
}`);
    expect(run(src)).toBe(7);
    expect(compile(src).wgsl).toContain('fn run_f(k: f32, n: f32) -> f32 {');
  });

  it('a const keeping its value, so a loop it bounds is still counted (Rule 7.5)', () => {
    expect(
      run(
        RUN(`export function run(k: f32): f32 {
  const n: i32 = 4;
  const f = (): f32 => {
    let s = 0.;
    for (let i = 0; i < n; i++) {
      s += k;
    }
    return s;
  };
  return f();
}`),
      ),
    ).toBe(8);
  });

  it('declared in a loop body, from the loop variable', () => {
    expect(
      run(
        RUN(`export function run(k: f32): f32 {
  let s = 0.;
  for (let i = 0; i < 3; i++) {
    const f = (): f32 => f32(i) * k;
    s += f();
  }
  return s;
}`),
      ),
    ).toBe(6);
  });
});

describe('a variable a local function writes is passed by reference (Rules 8.8, 8.17)', () => {
  const WRITE = RUN(`export function run(k: f32): f32 {
  let n = 0.;
  const inc = (): void => {
    n += k;
  };
  inc();
  inc();
  return n;
}`);

  it('a pointer in WGSL and an inout parameter in GLSL ES 3.00', () => {
    expect(run(WRITE)).toBe(4);
    const r = compile(WRITE);
    expect(r.wgsl).toContain('fn run_inc(n: ptr<function, f32>, k: f32) {\n  (*n) += k;\n}');
    expect(r.wgsl).toContain('  var n: f32 = 0.0;\n  run_inc(&n, k);\n  run_inc(&n, k);\n');
    expect(r.glsl!.fragment).toContain('void run_inc(inout float n, float k) {\n  n += k;\n}');
  });

  it('and handed on by a local function that calls one that writes it', () => {
    const src = RUN(`export function run(k: f32): f32 {
  let n = 0.;
  const add = (v: f32): void => {
    n += v;
  };
  const twice = (v: f32): void => {
    add(v);
    add(v);
  };
  twice(k);
  return n;
}`);
    expect(run(src)).toBe(4);
    const r = compile(src);
    expect(r.wgsl).toContain(
      'fn run_twice(n: ptr<function, f32>, v: f32) {\n  run_add(n, v);\n  run_add(n, v);\n}',
    );
    expect(r.wgsl).toContain('run_twice(&n, k);');
    // GLSL ES 3.00 wants a function declared above its first call.
    const glsl = r.glsl!.fragment;
    expect(glsl.indexOf('void run_add(')).toBeLessThan(glsl.indexOf('void run_twice('));
    expect(glsl.indexOf('void run_twice(')).toBeLessThan(glsl.indexOf('float run(float k)'));
  });

  it('through a local function declared inside another', () => {
    expect(
      run(
        RUN(`export function run(k: f32): f32 {
  let n = 0.;
  const outer = (m: f32): void => {
    const inner = (): void => {
      n += m;
    };
    inner();
  };
  outer(k);
  outer(1.);
  return n;
}`),
      ),
    ).toBe(3);
  });

  it('whatever it holds: a vector written whole and by component, an array element', () => {
    const vec = RUN(`export function run(k: f32): f32 {
  let v = vec2(0.);
  const f = (): void => {
    v.x += k;
    v = v * 2.;
  };
  f();
  return v.x;
}`);
    expect(run(vec)).toBe(4);
    expect(compile(vec).wgsl).toContain(
      'fn run_f(v: ptr<function, vec2<f32>>, k: f32) {\n  (*v).x += k;\n  (*v) = ((*v) * 2.0);\n}',
    );
    expect(
      run(
        RUN(`export function run(k: f32): f32 {
  let a = array<f32, 3>(1., 2., 3.);
  const f = (i: i32): void => {
    a[i] *= k;
  };
  f(0);
  f(2);
  return a[0] + a[1] + a[2];
}`),
      ),
    ).toBe(10);
  });

  it('and an object, through a field or a method that changes it', () => {
    expect(
      run(
        RUN(`class V {
  x: f32 = 1.;
  bump(): void {
    this.x += 1.;
  }
}
export function run(k: f32): f32 {
  let v = new V();
  const f = (): void => {
    v.bump();
  };
  f();
  f();
  return v.x;
}`),
      ),
    ).toBe(3);
    // A const that built its object may be written through (Rule 6.10), from a closure too.
    expect(
      run(
        RUN(`class V {
  x: f32 = 1.;
}
export function run(k: f32): f32 {
  const v = new V();
  const f = (): void => {
    v.x += k;
  };
  f();
  return v.x;
}`),
      ),
    ).toBe(3);
  });

  it('in an expression, each call in source order', () => {
    expect(
      run(
        RUN(`export function run(k: f32): f32 {
  let n = 1.;
  const f = (): f32 => {
    n *= 2.;
    return n;
  };
  const r = f() + f();
  return r + n * k;
}`),
      ),
    ).toBe(14);
    expect(
      run(
        RUN(`export function run(k: f32): f32 {
  let n = 1.;
  const inc = (): void => {
    n += k;
  };
  const a = n;
  inc();
  const b = n * k;
  inc();
  return a + b + n;
}`),
      ),
    ).toBe(12);
  });
});

describe('a function declaration in a body (Rule 8.17)', () => {
  it('is hoisted, so it may be called above its statement, and captures as an arrow does', () => {
    expect(
      run(
        RUN(`export function run(k: f32): f32 {
  const r = sq(k);
  function sq(x: f32): f32 {
    return x * x;
  }
  return r;
}`),
      ),
    ).toBe(4);
    const src = RUN(`export function run(k: f32): f32 {
  let n = 1.;
  bump();
  bump();
  return n;
  function bump(): void {
    n += k;
  }
}`);
    expect(run(src)).toBe(5);
    expect(compile(src).wgsl).toContain('fn run_bump(n: ptr<function, f32>, k: f32) {');
  });
});

describe('`this` in an arrow function is the object of the method around it (Rule 8.17)', () => {
  it('read, and written, which makes the method take its object by reference (Rule 8.10)', () => {
    expect(
      run(
        RUN(`class A {
  g: f32 = 3.;
  m(x: f32): f32 {
    const f = (y: f32): f32 => y * this.g;
    return f(x);
  }
}
export function run(k: f32): f32 {
  return new A().m(k);
}`),
      ),
    ).toBe(6);
    const src = RUN(`class A {
  g: f32 = 3.;
  m(x: f32): f32 {
    const f = (y: f32): void => {
      this.g += y;
    };
    f(x);
    f(x);
    return this.g;
  }
}
export function run(k: f32): f32 {
  let a = new A();
  return a.m(k);
}`);
    expect(run(src)).toBe(7);
    const r = compile(src);
    expect(r.wgsl).toContain(
      'fn A_m(self_: ptr<function, A>, x: f32) -> f32 {\n  A_m_f(self_, x);',
    );
    expect(r.wgsl).toContain('fn A_m_f(self_: ptr<function, A>, y: f32) {\n  (*self_).g += y;\n}');
    expect(r.glsl!.fragment).toContain('void A_m_f(inout A self_, float y) {');
  });

  it('beside a variable of the method, and in a body a class inherits', () => {
    expect(
      run(
        RUN(`class A {
  g: f32 = 3.;
  m(x: f32): f32 {
    let acc = 0.;
    const add = (v: f32): void => {
      acc += v * this.g;
    };
    add(x);
    add(1.);
    return acc;
  }
}
export function run(k: f32): f32 {
  const a = new A();
  return a.m(k);
}`),
      ),
    ).toBe(9);
    expect(
      run(
        RUN(`class B {
  g: f32 = 1.;
  m(x: f32): f32 {
    let t = 0.;
    const h = (): void => {
      t += x * this.g;
    };
    h();
    h();
    return t;
  }
}
class D extends B {}
export function run(k: f32): f32 {
  const d = new D();
  const b = new B();
  return d.m(k) + b.m(k);
}`),
      ),
    ).toBe(8);
  });

  it('in a static member, the class the call names (Rule 8.13)', () => {
    expect(
      run(
        RUN(`class B {
  static K: f32 = 1.;
  static f(x: f32): f32 {
    const g = (y: f32): f32 => y + this.K;
    return g(x);
  }
}
class D extends B {
  static K: f32 = 10.;
}
export function run(k: f32): f32 {
  return D.f(k) + B.f(k);
}`),
      ),
    ).toBe(15);
  });
});

describe('where a local function may stand', () => {
  it('in a generic function, once for each instance', () => {
    const src = RUN(`function pick<T>(a: T, b: T): T {
  let r = a;
  const swap = (): void => {
    r = b;
  };
  swap();
  return r;
}
export function run(k: f32): f32 {
  return pick(1., k) + f32(pick(1, 3));
}`);
    expect(run(src)).toBe(5);
    expect(compile(src).wgsl).toContain('fn pick_f32_swap(r: ptr<function, f32>, b: f32) {');
  });

  it('in a namespace, and in a branch', () => {
    expect(
      run(
        RUN(`namespace N {
  export function h(k: f32): f32 {
    let n = 1.;
    const f = (): void => {
      n *= k;
    };
    f();
    f();
    return n;
  }
}
export function run(k: f32): f32 {
  return N.h(k);
}`),
      ),
    ).toBe(4);
    expect(
      run(
        RUN(`export function run(k: f32): f32 {
  let n = 0.;
  if (k > 1.) {
    const f = (): void => {
      n = k * 3.;
    };
    f();
  }
  return n;
}`),
      ),
    ).toBe(6);
  });

  it('as the callback of a fold, which passes what it captures to every call', () => {
    expect(
      run(
        RUN(`export function run(k: f32): f32 {
  const xs = array<f32, 3>(1., 3., 5.);
  const big = (x: f32): bool => x > k * 2.;
  const small = (x: f32): bool => x < k;
  return (any(xs, big) ? 1. : 0.) + (all(xs, small) ? 10. : 0.);
}`),
      ),
    ).toBe(1);
    // `any` stops at the first match, as `Array.prototype.some` does: two calls, not three.
    expect(
      run(
        RUN(`export function run(k: f32): f32 {
  let n = 0.;
  const xs = array<f32, 3>(1., 3., 5.);
  const seen = (x: f32): bool => {
    n += 1.;
    return x > k;
  };
  const hit = any(xs, seen);
  return hit ? n : -n;
}`),
      ),
    ).toBe(2);
    expect(
      run(
        RUN(`export function run(k: f32): f32 {
  const xs = array<f32, 2>(1., 3.);
  const ys = array<f32, 2>(2., 4.);
  const f = (a: f32, b: f32): f32 => a * b + k;
  const z = zip(xs, ys, f);
  return z[0] + z[1];
}`),
      ),
    ).toBe(18);
  });
});

describe('what a local function may not do (Rule 8.17)', () => {
  it('run before a variable it reads is declared, where TypeScript throws', () => {
    expect(
      errorsOf(
        RUN(`export function run(k: f32): f32 {
  const f = (): f32 => y;
  const r = f();
  const y = 2.;
  return r;
}`),
      )[0],
    ).toBe(
      `${TS_CODES.UNKNOWN_NAME} "f" reads "y", which is not declared yet where "f" is called: a let or a const is not there before its declaration, and TypeScript throws. Call "f" after "y" is declared.`,
    );
    expect(
      only(
        RUN(`export function run(k: f32): f32 {
  bump();
  let n = 1.;
  return n;
  function bump(): void {
    n += k;
  }
}`),
      ),
    ).toBe(
      `${TS_CODES.UNKNOWN_NAME} "bump" reads "n", which is not declared yet where "bump" is called: a let or a const is not there before its declaration, and TypeScript throws. Call "bump" after "n" is declared.`,
    );
  });

  it('say a variable is not declared yet when its declaration was refused, which said why', () => {
    const errors = errorsOf(
      RUN(`export function run(k: f32): f32 {
  let a: f32[] = [1., 2.];
  const f = (): void => {
    a[0] *= k;
  };
  f();
  return k;
}`),
    );
    expect(errors[0]).toBe(`${TS_CODES.UNKNOWN_TYPE} T[] is a JS array type. Use array<T, N>.`);
    expect(errors.join('\n')).not.toContain('not declared yet');
  });

  it('write a parameter or a const of the function around it, as the body itself may not', () => {
    expect(
      only(
        RUN(`export function run(k: f32): f32 {
  const f = (): void => {
    k = 1.;
  };
  f();
  return k;
}`),
      ),
    ).toBe(
      `${TS_CODES.ASSIGN_TARGET} Cannot assign to "k" — a parameter is a value, not a variable. Copy it into a local first: "let k_ = k;", then write that.`,
    );
    expect(
      only(
        RUN(`export function run(k: f32): f32 {
  const c = 1.;
  const f = (): void => {
    c = 2.;
  };
  f();
  return c;
}`),
      ),
    ).toBe(`${TS_CODES.CONST_ASSIGN} Cannot assign to "c" — it is declared with const.`);
  });

  it('be said twice: a mistake in a body a class inherits is said once (Rule 12.4)', () => {
    const inherited = (fn: string): string =>
      RUN(`class B {
  g: f32 = 1.;
  m(x: f32): f32 {
    ${fn}
    return h(x);
  }
}
class D extends B {}
export function run(k: f32): f32 {
  const d = new D();
  return d.m(k);
}`);
    expect(only(inherited('const h = (y: number): f32 => y;'))).toBe(
      `${TS_CODES.UNKNOWN_TYPE} A number on the GPU has a width. Write f32 for a float, i32 or u32 for an integer.`,
    );
    expect(only(inherited('const h = (y: f32): f32 => nope;'))).toBe(
      `${TS_CODES.UNKNOWN_NAME} Unknown identifier "nope".`,
    );
  });

  it('be a value: held, returned or chosen at run time', () => {
    const asValue = (name: string): string =>
      `${TS_CODES.UNSUPPORTED} "${name}" is a function, and a shader has no function values: nothing at run time can hold one, return one or choose between two. Call it where its value is needed, "${name}(...)", or hand it to a parameter that takes a function (Rule 8.18).`;
    expect(
      only(
        RUN(`export function run(k: f32): f32 {
  const f = (x: f32): f32 => x;
  const g = f;
  return k;
}`),
      ),
    ).toBe(asValue('f'));
    expect(
      errorsOf(
        RUN(`function sq(x: f32): f32 {
  return x * x;
}
export function run(k: f32): f32 {
  const f = k > 1. ? sq : sq;
  return k;
}`),
      )[0],
    ).toBe(asValue('sq'));
  });
});

describe('examples/closures.shade.ts', () => {
  it('renders the rings, the dabs and the spots on every CPU path', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../../../examples/closures.shade.ts', import.meta.url)),
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
    // On each of the three rings `rings` draws through `ring`, whose writes land in `glow`.
    expect(at([0.3, 0])).toEqual([0.95, 0.75, 0.35, 1]);
    expect(at([0.55, 0])).toEqual([0.95, 0.75, 0.35, 1]);
    expect(at([0, 0.8])).toEqual([0.95, 0.75, 0.35, 1]);
    // Between two rings: the background `tone` gives for no glow.
    expect(at([0.4, 0])).toEqual([0.05, 0.06, 0.1, 1]);
    // A dab the brush's arrow function painted into `this.paint`.
    expect(at([-0.5, 0.35])).toEqual([0.35, 0.66, 1.05, 1]);
    // A spot `near` found through the fold.
    expect(at([0, -0.75])).toEqual([1, 1, 1, 1]);
  });
});

describe('a local function named after a builtin is the one its name means (Rule 9.5)', () => {
  it('the body declares it, so its calls reach it, as TypeScript looks the name up', () => {
    const src = RUN(`export function run(k: f32): f32 {
  const log = (x: f32): f32 => x * 100.;
  function mix(a: f32, b: f32): f32 {
    return a + b;
  }
  return log(k) + mix(k, 1.);
}`);
    // WGSL's `log(2.)` is 0.693 and its `mix` takes three arguments.
    expect(run(src)).toBe(203);
    const r = compile(src);
    expect(r.wgsl).toContain('(run_log(k) + run_mix(k, 1.0))');
    expect(r.glsl!.fragment).toContain('float run_log(float x) {');
  });

  it('a fold is handed it by its name', () => {
    expect(
      run(
        RUN(`export function run(k: f32): f32 {
  const step = (x: f32): bool => x > k;
  const xs = array<f32, 3>(1., 3., 5.);
  return any(xs, step) ? 1. : 0.;
}`),
      ),
    ).toBe(1);
  });

  it('a function of the module keeps the precedence Rule 9.5 records, and a block hides nothing outside it', () => {
    // `log` of the module is WGSL's `log` at its calls; the local `sign` is declared in a block
    // the call is outside of, so the call is WGSL's `sign`.
    expect(
      run(
        RUN(`function log(x: f32): f32 {
  return x * 100.;
}
export function run(k: f32): f32 {
  if (k > 100.) {
    const sign = (x: f32): f32 => x * 10.;
    return sign(k);
  }
  return log(1.) + sign(-k);
}`),
      ),
    ).toBe(-1);
  });
});
