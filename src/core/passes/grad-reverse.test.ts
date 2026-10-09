// grad in reverse mode (change 0056, item 5). Each derivative the reverse pass builds is held
// two ways, on both CPU modules (the tree-walk oracle and the codegen) at f64:
//
//   - against a central finite difference of the original function, h = 1e-5, relative
//     tolerance 1e-4, as grad.test.ts holds forward mode;
//   - against forward mode by the transpose test: for random v and w, w · (J v) from forward
//     mode equals (Jᵀ w) · v from reverse mode, to rounding. This holds the two modes to each
//     other where a finite difference is ill-conditioned.

import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { compileModule } from '../oracle.js';
import { compileModuleJs } from '../cpu-codegen.js';
import { emitModule } from '../backends/wgsl.js';
import { emitGlslModule } from '../backends/glsl.js';
import { TypeShadeError } from '../diagnostics/error.js';
import { grad } from './grad.js';
import { gradCheck } from './grad-check.js';
import type { Expr, FuncDecl, ModuleDecl } from '../ir/nodes.js';

function moduleOf(src: string): ModuleDecl {
  const r = compile(`"use typeshade"\n${src}`);
  expect(r.diagnostics).toEqual([]);
  return r.module;
}

type Fn = (...args: unknown[]) => unknown;
type Value = number | Value[];
const flat = (v: unknown): number[] =>
  Array.isArray(v) ? (v as unknown[]).flatMap(flat) : [v as number];

/** `v` with its `c`-th number (in flattened order) moved by `s`. */
function shifted(v: Value, c: number, s: number): Value {
  let k = 0;
  const walk = (x: Value): Value => {
    if (Array.isArray(x)) return x.map(walk);
    return k++ === c ? x + s : x;
  };
  return walk(v);
}

/** `v`'s shape filled with the numbers of `xs` in order. */
function shaped(v: Value, xs: readonly number[]): Value {
  let k = 0;
  const walk = (x: Value): Value => (Array.isArray(x) ? x.map(walk) : xs[k++]!);
  return walk(v);
}

/** A small deterministic generator, so a failure reproduces. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32 - 0.5;
  };
}

const MODULES = [compileModule, compileModuleJs] as const;

/** Hold the reverse derivative of `fn` with respect to `wrt` against a central difference at
 *  each point, for a random seed `dy`, on both CPU modules. */
function checkReverse(
  m: ModuleDecl,
  fn: string,
  wrt: readonly string[],
  points: readonly (readonly Value[])[],
  checkpoints?: number,
): void {
  const d = grad(m, fn, wrt, { mode: 'reverse', ...(checkpoints ? { checkpoints } : {}) });
  const f0 = m.funcs.find((f) => f.name === fn)!;
  const next = rng(7);
  for (const make of MODULES) {
    const cm = make(d.module);
    const f = cm.fns[fn] as Fn;
    const df = cm.fns[d.name] as Fn;
    for (const pt of points) {
      const y0 = f(...pt) as Value;
      const dy = shaped(
        y0,
        flat(y0).map(() => next() * 2),
      );
      const dyFlat = flat(dy);
      const got = df(...pt, dy) as Record<string, unknown>;
      for (const w of wrt) {
        const at = f0.params.findIndex((p) => p.name === w);
        const g = flat(got[d.adjoints![w]!]);
        const n = flat(pt[at]!).length;
        expect(g.length, `${make.name} ${fn} adjoint of ${w}`).toBe(n);
        for (let c = 0; c < n; c++) {
          const h = 1e-5;
          const args = (s: number) => pt.map((v, i) => (i === at ? shifted(v, c, s) : v));
          const hi = flat(f(...args(h)));
          const lo = flat(f(...args(-h)));
          const expected = hi.reduce((acc, x, o) => acc + dyFlat[o]! * ((x - lo[o]!) / (2 * h)), 0);
          const tol = 1e-4 * Math.max(1, Math.abs(expected));
          expect(
            Math.abs(g[c]! - expected),
            `${make.name} d${fn}/d${w}[${c}] at ${JSON.stringify(pt)}: got ${g[c]}, finite difference ${expected}`,
          ).toBeLessThan(tol);
        }
      }
    }
  }
}

/** The transpose test: w · (J v) from forward mode against (Jᵀ w) · v from reverse mode, with
 *  `J` the Jacobian with respect to every float parameter named in `wrt`. */
function checkTranspose(
  m: ModuleDecl,
  fn: string,
  wrt: readonly string[],
  points: readonly (readonly Value[])[],
  checkpoints?: number,
): void {
  const f0 = m.funcs.find((f) => f.name === fn)!;
  const next = rng(11);
  const rev = grad(m, fn, wrt, { mode: 'reverse', ...(checkpoints ? { checkpoints } : {}) });
  for (const pt of points) {
    const v = wrt.map((w) =>
      shaped(
        pt[f0.params.findIndex((p) => p.name === w)]!,
        flat(pt[f0.params.findIndex((p) => p.name === w)]!).map(() => next()),
      ),
    );
    let mod = rev.module;
    const fwdNames: string[] = [];
    wrt.forEach((w, i) => {
      const p = f0.params.find((q) => q.name === w)!;
      const dir = flat(v[i]!);
      if (p.type.kind === 'mat') {
        // Forward mode takes a scalar or a vector parameter; a matrix is checked by reverse
        // mode's finite difference instead.
        fwdNames.push('');
        return;
      }
      const g = grad(mod, fn, w, {
        name: `${fn}_fwd_${w}`,
        ...(p.type.kind === 'vec' ? { direction: dir } : {}),
      });
      mod = g.module;
      fwdNames.push(g.name);
    });
    for (const make of MODULES) {
      const cm = make(mod);
      const y0 = (cm.fns[fn] as Fn)(...pt) as Value;
      const wv = shaped(
        y0,
        flat(y0).map(() => next()),
      );
      const jv = flat(y0).map(() => 0);
      fwdNames.forEach((name, i) => {
        if (name === '') return;
        const t = flat((cm.fns[name] as Fn)(...pt));
        // A scalar parameter's tangent is d f / d x; scale it by v here.
        const scale = Array.isArray(v[i]) ? 1 : (v[i] as number);
        t.forEach((x, o) => (jv[o]! += x * scale));
      });
      const lhs = flat(wv).reduce((acc, x, o) => acc + x * jv[o]!, 0);
      const adj = (cm.fns[rev.name] as Fn)(...pt, wv) as Record<string, unknown>;
      let rhs = 0;
      wrt.forEach((w, i) => {
        if (fwdNames[i] === '') return;
        const a = flat(adj[w]);
        flat(v[i]!).forEach((x, c) => (rhs += a[c]! * x));
      });
      expect(
        Math.abs(lhs - rhs),
        `${make.name} ${fn} at ${JSON.stringify(pt)}: w·(Jv) = ${lhs}, (Jᵀw)·v = ${rhs}`,
      ).toBeLessThan(1e-9 * Math.max(1, Math.abs(lhs)));
    }
  }
}

const refusal = (thunk: () => unknown): TypeShadeError => {
  try {
    thunk();
  } catch (e) {
    expect(e).toBeInstanceOf(TypeShadeError);
    expect((e as TypeShadeError).code).toBe('SD0118');
    return e as TypeShadeError;
  }
  throw new Error('expected SD0118');
};

describe('grad reverse: each builtin rule agrees with a finite difference and with forward mode', () => {
  // Both parameters are differentiated at once. Each point keeps the builtin inside its domain
  // and away from a kink.
  const cases: readonly [string, readonly (readonly number[])[]][] = [
    [
      'sin(k * x)',
      [
        [0.7, 1.3],
        [-2, 0.4],
      ],
    ],
    [
      'cos(k * x)',
      [
        [0.7, 1.3],
        [-2, 0.4],
      ],
    ],
    [
      'tan(k * x)',
      [
        [0.5, 0.3],
        [1, -1.1],
      ],
    ],
    [
      'asin(k * x)',
      [
        [0.5, 0.3],
        [1, -0.6],
      ],
    ],
    [
      'acos(k * x)',
      [
        [0.5, 0.3],
        [1, -0.6],
      ],
    ],
    [
      'atan(k * x)',
      [
        [0.5, 0.3],
        [1, -2.5],
      ],
    ],
    [
      'sinh(k * x)',
      [
        [0.5, 0.3],
        [1, -1.5],
      ],
    ],
    [
      'cosh(k * x)',
      [
        [0.5, 0.3],
        [1, -1.5],
      ],
    ],
    [
      'tanh(k * x)',
      [
        [0.5, 0.3],
        [1, -1.5],
      ],
    ],
    [
      'asinh(k * x)',
      [
        [0.5, 0.3],
        [1, -1.5],
      ],
    ],
    [
      'acosh(k * x)',
      [
        [2, 1.3],
        [1, 2.5],
      ],
    ],
    [
      'atanh(k * x)',
      [
        [0.5, 0.3],
        [1, -0.6],
      ],
    ],
    [
      'exp(k * x)',
      [
        [0.5, 0.3],
        [1, -1.5],
      ],
    ],
    [
      'exp2(k * x)',
      [
        [0.5, 0.3],
        [1, -1.5],
      ],
    ],
    [
      'log(k * x)',
      [
        [0.5, 0.3],
        [2, 1.5],
      ],
    ],
    [
      'log2(k * x)',
      [
        [0.5, 0.3],
        [2, 1.5],
      ],
    ],
    [
      'sqrt(k * x)',
      [
        [0.5, 0.3],
        [2, 1.5],
      ],
    ],
    [
      'inverseSqrt(k * x)',
      [
        [0.5, 0.3],
        [2, 1.5],
      ],
    ],
    [
      'abs(k - x)',
      [
        [0.5, 0.3],
        [-2, 1.5],
      ],
    ],
    [
      'fract(k * x)',
      [
        [0.5, 0.3],
        [2, 1.3],
      ],
    ],
    ['radians(k * x)', [[0.5, 0.3]]],
    ['degrees(k * x)', [[0.5, 0.3]]],
    [
      'floor(k * x) + k',
      [
        [0.5, 0.3],
        [2, 1.3],
      ],
    ],
    ['ceil(k * x) + k', [[0.5, 0.3]]],
    ['round(k * x) * x', [[0.5, 0.3]]],
    ['trunc(k * x) - k', [[0.5, 0.3]]],
    ['sign(k - x) * k', [[0.5, 0.3]]],
    [
      'step(x, k) + k * x',
      [
        [0.5, 0.3],
        [0.1, 0.3],
      ],
    ],
    [
      'saturate(k * x)',
      [
        [0.5, 0.3],
        [2, 1.3],
        [-1, 0.4],
      ],
    ],
    [
      'clamp(k, x, x * 2.)',
      [
        [0.5, 0.3],
        [0.5, 0.7],
        [0.5, 1.3],
      ],
    ],
    [
      'min(k, x * x)',
      [
        [0.5, 0.3],
        [0.5, 0.1],
      ],
    ],
    [
      'max(k, x * x)',
      [
        [0.5, 0.3],
        [0.5, 0.1],
      ],
    ],
    [
      'mix(x, k * k, k)',
      [
        [0.5, 0.3],
        [-1, 0.8],
      ],
    ],
    [
      'smoothstep(x, x + 2., k)',
      [
        [0.5, 0.9],
        [-1, 0.2],
      ],
    ],
    [
      'pow(k, x)',
      [
        [0.5, 0.3],
        [2, 1.5],
      ],
    ],
    [
      'atan2(k, x)',
      [
        [0.5, 0.3],
        [-2, 1.5],
      ],
    ],
    [
      'mod(k * 3., x)',
      [
        [0.7, 0.3],
        [1.3, 1.5],
      ],
    ],
    [
      '(k * 3.) % x',
      [
        [0.7, 0.3],
        [1.3, 1.5],
      ],
    ],
    [
      'k / x - x / k',
      [
        [0.7, 0.3],
        [1.3, 1.5],
      ],
    ],
    ['-k * x', [[0.7, 0.3]]],
  ];
  for (const [expr, points] of cases) {
    it(expr, () => {
      const m = moduleOf(`export function f(x: f32, k: f32): f32 {\n  return ${expr};\n}`);
      checkReverse(m, 'f', ['x', 'k'], points);
      checkTranspose(m, 'f', ['x', 'k'], points);
    });
  }

  it('fma, whose f32 rounding a finite difference cannot resolve, gives its exact partials', () => {
    const m = moduleOf(`export function f(x: f32, k: f32): f32 {\n  return fma(k, x, k * k);\n}`);
    const d = grad(m, 'f', ['x', 'k'], { mode: 'reverse' });
    for (const make of MODULES)
      expect(make(d.module).fns[d.name]!(2.5, 1.25, 1)).toEqual({ x: 1.25, k: 2.5 + 2 * 1.25 });
    checkTranspose(m, 'f', ['x', 'k'], [[2.5, 1.25]]);
  });
});

describe('grad reverse: vectors and matrices', () => {
  it('dot, cross, length, distance, normalize and reflect', () => {
    const m = moduleOf(`export function f(x: f32, k: f32): vec3 {
  const a = vec3(k, x, k * x);
  const b = vec3(1., k * k, -x);
  const n = normalize(vec3(k, 1., 0.5));
  return cross(a, b) * dot(a, b) + normalize(a) * length(b) + reflect(a, n) + vec3(distance(a, b));
}`);
    const pts = [
      [0.3, 1.2],
      [-1.4, 0.5],
    ];
    checkReverse(m, 'f', ['x', 'k'], pts);
    checkTranspose(m, 'f', ['x', 'k'], pts);
  });

  it('a swizzle, a component write and a vector the parameter only partly reaches', () => {
    const m = moduleOf(`export function f(x: f32, k: f32): vec2 {
  let v = vec3(x, 2., 3.);
  v.y = k * v.x;
  v.z += sin(k);
  return v.zy * k + v.xx;
}`);
    checkReverse(m, 'f', ['x', 'k'], [[0.3, 1.2]]);
    checkTranspose(m, 'f', ['x', 'k'], [[0.3, 1.2]]);
  });

  it('vector parameters, scalar broadcasts and a vector built from parts', () => {
    const m = moduleOf(`export function f(p: vec2, q: vec3, s: f32): vec4 {
  const u = vec4(p * s, q.z, s) + vec4(q, 1.) * p.y;
  return clamp(u, vec4(-1.), vec4(2.)) * mix(q.x, s, 0.25) + vec4(pow(abs(q), vec3(s)), 1.);
}`);
    const pts: Value[][] = [
      [[0.3, 1.1], [0.4, -0.5, 0.7], 1.3],
      [[-0.6, 0.2], [0.9, 0.5, -0.2], 0.7],
    ];
    checkReverse(m, 'f', ['p', 'q', 's'], pts);
    checkTranspose(m, 'f', ['p', 'q', 's'], pts);
  });

  it('a matrix times a vector, a vector times a matrix, a matrix product and a transpose', () => {
    const m = moduleOf(`export function f(x: f32, k: f32, v: vec2): vec2 {
  const r = mat2(cos(k), sin(k), -sin(k), cos(k));
  const s = mat2(vec2(x, k), vec2(1., x * k));
  return transpose(r) * (r * vec2(x, k)) + (v * s) + (s * r) * v + (r * 2.) * v;
}`);
    const pts: Value[][] = [
      [0.3, 1.2, [0.5, -0.7]],
      [-0.8, 0.4, [1.5, 0.2]],
    ];
    checkReverse(m, 'f', ['x', 'k', 'v'], pts);
    checkTranspose(m, 'f', ['x', 'k', 'v'], pts);
  });

  it('a matrix parameter', () => {
    const m = moduleOf(`export function f(a: mat2, v: vec2): f32 {
  const w = a * v;
  return dot(w, w) + a[1].x * v.y;
}`);
    checkReverse(
      m,
      'f',
      ['a', 'v'],
      [
        // A matrix crosses to the host as its columns, flattened.
        [
          [0.3, 1.2, -0.4, 0.5],
          [0.7, -1.1],
        ],
      ],
    );
  });
});

describe('grad reverse: control flow and calls', () => {
  it('an if, an else and an early return', () => {
    const m = moduleOf(`export function f(x: f32, k: f32): f32 {
  if (x < 0.) {
    return k * k * x;
  }
  let acc: f32 = sin(k * x);
  if (acc > 0.5) {
    acc = acc * 0.5 + k;
  } else if (acc > 0.) {
    acc = acc * acc;
  } else {
    acc -= x;
  }
  acc *= exp(k);
  return acc;
}`);
    const pts = [
      [0.7, 0.4],
      [0.2, 1.3],
      [-0.5, 0.9],
      [1.1, -0.9],
    ];
    checkReverse(m, 'f', ['x', 'k'], pts);
    checkTranspose(m, 'f', ['x', 'k'], pts);
  });

  it('a switch, and a variable overwritten in each arm', () => {
    const m = moduleOf(`export function f(x: f32, k: f32): f32 {
  let r: f32 = k;
  switch (i32(x)) {
    case 0:
      r = r * r;
      break;
    case 1:
      r = sin(r) * x;
      break;
    default:
      r = r + x;
  }
  r = r * r + k;
  return r;
}`);
    const pts = [
      [0.5, 0.4],
      [1.5, 0.4],
      [2.5, 0.4],
    ];
    checkReverse(m, 'f', ['x', 'k'], pts);
    checkTranspose(m, 'f', ['x', 'k'], pts);
  });

  it('a conditional expression, and a discontinuity whose derivative is zero on both sides', () => {
    const m = moduleOf(`export function f(x: f32, k: f32): f32 {
  const vis = x < k ? 1. : 0.;
  return vis + (x > 0.3 ? k * x : k * k);
}`);
    const pts = [
      [0.5, 0.49],
      [0.5, 0.51],
      [0.2, 0.4],
    ];
    checkReverse(m, 'f', ['x', 'k'], pts);
    checkTranspose(m, 'f', ['x', 'k'], pts);
  });

  it('calls through two helpers, each differentiated once', () => {
    const m = moduleOf(`function g(a: f32, v: vec2): f32 {
  return dot(v, vec2(a, a * a)) + h(a);
}
function h(a: f32): f32 {
  return smoothstep(0., 1., a) * a;
}
export function f(x: f32, k: f32): f32 {
  return g(k, vec2(x, k)) + g(x, vec2(1., 2.)) + h(k * 2.);
}`);
    const d = grad(m, 'f', ['x', 'k'], { mode: 'reverse' });
    expect(d.module.funcs.map((f) => f.name).slice(m.funcs.length)).toEqual([
      'h_vjp',
      'g_vjp',
      'f_vjp',
    ]);
    const pts = [
      [0.3, 0.4],
      [1.2, 0.8],
    ];
    checkReverse(m, 'f', ['x', 'k'], pts);
    checkTranspose(m, 'f', ['x', 'k'], pts);
  });

  it('an integer a helper computes from the parameter has a zero derivative', () => {
    const m = moduleOf(`function steps(a: f32): i32 {
  return i32(floor(a * 4.));
}
export function f(x: f32, k: f32): f32 {
  return f32(steps(k)) * x + k * k;
}`);
    checkReverse(m, 'f', ['x', 'k'], [[0.5, 0.3]]);
  });

  it('a parameter the body writes', () => {
    const m = moduleOf(`export function f(x: f32, k: f32): f32 {
  x = x * k;
  x += sin(x);
  return x * k;
}`);
    checkReverse(m, 'f', ['x', 'k'], [[0.5, 0.3]]);
    checkTranspose(m, 'f', ['x', 'k'], [[0.5, 0.3]]);
  });

  it('a name of wrt that the result does not reach has a zero adjoint', () => {
    const m = moduleOf(`export function f(x: f32, k: f32): f32 {\n  return x * x;\n}`);
    const d = grad(m, 'f', 'k', { mode: 'reverse' });
    expect(compileModule(d.module).fns[d.name]!(2, 3, 1)).toEqual({ k: 0 });
    expect(d.adjoints).toEqual({ k: 'k' });
  });
});

/** `m` with a fragment entry that calls the derivative, since the GLSL writer emits only what
 *  an entry reaches. */
function withFragmentCalling(m: ModuleDecl, fn: string, struct: string): ModuleDecl {
  const vec4f = { kind: 'vec', n: 4, elem: 'f32' } as const;
  const f32 = { kind: 'scalar', scalar: 'f32' } as const;
  const p: Expr = { op: 'param', type: vec4f, name: 'p' };
  const lane = (field: string): Expr => ({ op: 'member', type: f32, base: p, field });
  const r: Expr = {
    op: 'call',
    type: { kind: 'struct', name: struct },
    fn,
    args: [lane('x'), lane('y'), lane('z')],
  };
  const fs: FuncDecl = {
    name: 'fs',
    stage: 'fragment',
    attrs: ['@fragment'],
    params: [{ name: 'p', type: vec4f, builtin: 'position' }],
    ret: vec4f,
    retAttr: '@location(0)',
    body: [
      {
        s: 'return',
        expr: {
          op: 'construct',
          type: vec4f,
          args: [
            { op: 'member', type: f32, base: r, field: 'x' },
            { op: 'member', type: f32, base: r, field: 'k' },
            { op: 'lit', type: f32, value: 0 },
            { op: 'lit', type: f32, value: 1 },
          ],
        },
      },
    ],
  };
  return { ...m, funcs: [...m.funcs.filter((f) => f.name !== 'fs'), fs] };
}

describe('grad reverse: the generated function is ordinary IR on every target', () => {
  it('emits WGSL and GLSL ES 3.00, and leaves the rest of the module as it was', () => {
    const m = moduleOf(`function g(a: f32): f32 {
  return a * a;
}
export function f(x: f32, k: f32): f32 {
  if (x > 1.) {
    return x;
  }
  return sin(g(k) * x) + smoothstep(0., 1., k) * length(vec2(x, k));
}`);
    const d = grad(m, 'f', ['x', 'k'], { mode: 'reverse' });
    expect(d.module.funcs.slice(0, m.funcs.length)).toEqual(m.funcs);
    expect(d.module.structs.slice(0, m.structs.length)).toEqual(m.structs);
    const withEntry = withFragmentCalling(d.module, d.name, 'f_vjp_adjoints');
    const wgsl = emitModule(withEntry);
    expect(wgsl).toContain('fn f_vjp(x: f32, k: f32, dy: f32) -> f_vjp_adjoints');
    expect(wgsl).toContain('fn g_vjp(a: f32, dy: f32) -> g_vjp_adjoints');
    const glsl = emitGlslModule(withEntry, 'fragment');
    expect(glsl).toContain('f_vjp_adjoints f_vjp(float x, float k, float dy)');
    expect(glsl).toContain('g_vjp_adjoints g_vjp(float a, float dy)');
  });
});

describe('grad reverse: what a caller does with it', () => {
  it('fits a function to samples by gradient descent with one call per sample', () => {
    const m = moduleOf(`export function wave(x: f32, a: f32, k: f32): f32 {
  return a * sin(k * x) * exp(-0.1 * x);
}`);
    const d = grad(m, 'wave', ['a', 'k'], { mode: 'reverse' });
    const cpu = compileModuleJs(d.module);
    const f = cpu.fns.wave as (x: number, a: number, k: number) => number;
    const df = cpu.fns[d.name] as (
      x: number,
      a: number,
      k: number,
      dy: number,
    ) => { a: number; k: number };
    const xs = Array.from({ length: 64 }, (_, i) => i * 0.1);
    const ys = xs.map((x) => f(x, 1.7, 2.3));
    let a = 1;
    let k = 2;
    for (let step = 0; step < 1000; step++) {
      let ga = 0;
      let gk = 0;
      xs.forEach((x, i) => {
        const g = df(x, a, k, 2 * (f(x, a, k) - ys[i]!));
        ga += g.a;
        gk += g.k;
      });
      a -= 0.001 * ga;
      k -= 0.001 * gk;
    }
    expect(a).toBeCloseTo(1.7, 6);
    expect(k).toBeCloseTo(2.3, 6);
  });
});

describe('grad reverse: loops under the checkpoint schedule (change 0056, items 1 and 2)', () => {
  it('a counted loop with a constant bound, an if inside it and an early return before it', () => {
    const m = moduleOf(`export function f(x: f32, k: f32): f32 {
  if (x < 0.) {
    return k * k * x;
  }
  let acc: f32 = 0.;
  for (let i: i32 = 0; i < 5; i++) {
    acc += sin(k * x + f32(i)) * k;
    if (acc > 1.) {
      acc = acc * 0.5 + k;
    }
  }
  return acc * exp(k);
}`);
    const pts = [
      [0.7, 0.4],
      [0.2, 1.3],
      [-0.5, 0.9],
    ];
    checkReverse(m, 'f', ['x', 'k'], pts);
    checkTranspose(m, 'f', ['x', 'k'], pts);
  });

  // A counted loop with a run-time bound reads its trip count from the header. With C slots,
  // a count up to C² fits the second array of slots, and a larger one is reached again from
  // its segment's checkpoint. Each is checked on both sides of C².
  const counted = moduleOf(`export function f(x: f32, k: f32, n: i32): f32 {
  let s: f32 = x;
  let v = vec2(x, k);
  for (let i: i32 = 0; i < n; i++) {
    const w = sin(s * k + 0.01 * f32(i));
    s = s * 0.9 + w * 0.2;
    v = vec2(v.y * 0.5, v.x + w * k * 0.1);
  }
  return s + v.x * v.y;
}`);
  for (const [n, C] of [
    [0, 4],
    [1, 4],
    [10, 4],
    [16, 4],
    [17, 4],
    [40, 4],
    [50, 32],
    [1100, 32],
  ] as const) {
    it(`a counted loop with a run-time bound, ${n} iterations, ${C} slots (C² = ${C * C})`, () => {
      const pts = [
        [0.3, 0.8, n],
        [-0.6, 1.2, n],
      ];
      checkReverse(counted, 'f', ['x', 'k'], pts, C);
      checkTranspose(counted, 'f', ['x', 'k'], pts, C);
    });
  }

  it('a while loop, whose count the count sweep measures (probe 4: 4 · 1.5³)', () => {
    const m = moduleOf(`export function f(k: f32, n: i32): f32 {
  let x = k;
  let i: i32 = 0;
  while (i < n) {
    x = x * k;
    i++;
  }
  return x;
}`);
    const d = grad(m, 'f', ['k'], { mode: 'reverse' });
    for (const make of MODULES) expect(make(d.module).fns[d.name]!(1.5, 3, 1)).toEqual({ k: 13.5 });
    for (const [n, C] of [
      [3, 2],
      [7, 2],
      [30, 4],
    ] as const) {
      checkReverse(m, 'f', ['k'], [[0.9, n]], C);
      checkTranspose(m, 'f', ['k'], [[0.9, n]], C);
    }
  });

  it('front-to-back compositing that stops early, below and above C²', () => {
    const m = moduleOf(`export function shade(a0: f32, k: f32, n: i32): f32 {
  let t: f32 = 1.;
  let c: f32 = 0.;
  for (let i: i32 = 0; i < n; i++) {
    const a = a0 * exp(-k * f32(i) * 0.1);
    c += t * a * (0.5 + 0.1 * f32(i));
    t *= 1. - a;
    if (t < 0.02) {
      break;
    }
  }
  return c + t * k;
}`);
    for (const [a0, n, C] of [
      [0.3, 6, 2],
      [0.1, 40, 3],
      [0.05, 200, 32],
      [0.9, 200, 32],
    ] as const) {
      checkReverse(m, 'shade', ['a0', 'k'], [[a0, 0.2, n]], C);
      checkTranspose(m, 'shade', ['a0', 'k'], [[a0, 0.2, n]], C);
    }
  });

  it('a continue, a return from inside a loop, and nested loops', () => {
    const m = moduleOf(`export function f(x: f32, k: f32, n: i32): f32 {
  let acc: f32 = 0.;
  for (let i: i32 = 0; i < n; i++) {
    if (i % 3 == 1) {
      continue;
    }
    let row: f32 = 0.;
    for (let j: i32 = 0; j < i; j++) {
      row += sin(x * f32(j) + k) * 0.3;
    }
    acc = acc * 0.8 + row * k;
    if (acc > 4.) {
      return acc * x;
    }
  }
  return acc + x;
}`);
    const pts = [
      [0.4, 0.7, 9],
      [1.3, 2.1, 12],
      [0.2, -0.4, 5],
    ];
    checkReverse(m, 'f', ['x', 'k'], pts, 2);
    checkTranspose(m, 'f', ['x', 'k'], pts, 2);
    checkReverse(m, 'f', ['x', 'k'], pts);
  });

  it('reports the tape bytes the checkpoint slots take (M1)', () => {
    // The state of the loop is s (1 word), v (2 words) and i (1 word): 4 words, held in two
    // arrays of C slots, so each further slot costs 2 × 4 words = 32 bytes.
    const at = (C: number) =>
      grad(counted, 'f', ['x', 'k'], { mode: 'reverse', checkpoints: C }).tapeBytes!;
    expect(at(8) - at(4)).toBe(4 * 32);
    expect(at(32) - at(4)).toBe(28 * 32);
    expect(grad(counted, 'f', ['x', 'k'], { mode: 'reverse' }).tapeBytes).toBe(at(32));
    expect(refusal(() => at(0)).message).toContain('opts.checkpoints is 0');
  });

  it('emits the schedule as WGSL and GLSL ES 3.00 arrays in function memory', () => {
    const d = grad(counted, 'f', ['x', 'k'], { mode: 'reverse', checkpoints: 8 });
    const vec4f = { kind: 'vec', n: 4, elem: 'f32' } as const;
    const f32 = { kind: 'scalar', scalar: 'f32' } as const;
    const p: Expr = { op: 'param', type: vec4f, name: 'p' };
    const r: Expr = {
      op: 'call',
      type: { kind: 'struct', name: 'f_vjp_adjoints' },
      fn: d.name,
      args: [
        { op: 'member', type: f32, base: p, field: 'x' },
        { op: 'member', type: f32, base: p, field: 'y' },
        { op: 'lit', type: { kind: 'scalar', scalar: 'i32' }, value: 3 },
        { op: 'lit', type: f32, value: 1 },
      ],
    };
    const fs: FuncDecl = {
      name: 'fs',
      stage: 'fragment',
      attrs: ['@fragment'],
      params: [{ name: 'p', type: vec4f, builtin: 'position' }],
      ret: vec4f,
      retAttr: '@location(0)',
      body: [
        {
          s: 'return',
          expr: {
            op: 'construct',
            type: vec4f,
            args: [{ op: 'member', type: f32, base: r, field: 'k' }],
          },
        },
      ],
    };
    const withEntry = { ...d.module, funcs: [...d.module.funcs, fs] };
    expect(emitModule(withEntry)).toContain('array<f32, 8>');
    expect(emitGlslModule(withEntry, 'fragment')).toMatch(/float\[8\] \w+/);
  });
});

describe('grad reverse: what a loop refuses, by name', () => {
  it('a call whose effect would repeat when an iteration runs again', () => {
    const m = moduleOf(`export function f(x: f32, k: f32): f32 {
  let acc: f32 = 0.;
  for (let i: i32 = 0; i < 3; i++) {
    acc += x * k;
    console.log(acc);
  }
  return acc;
}`);
    expect(refusal(() => grad(m, 'f', ['k'], { mode: 'reverse' })).message).toContain(
      'would repeat when reverse mode runs the loop',
    );
  });
});

describe('grad reverse: author-written adjoints (opts.custom)', () => {
  const m = moduleOf(`interface Dg {
  a: f32;
  b: f32;
}
function g(a: f32, b: f32): f32 {
  return exp(a) * b;
}
function g_right(a: f32, b: f32, dy: f32): Dg {
  return { a: dy * exp(a) * b, b: dy * exp(a) };
}
function g_wrong(a: f32, b: f32, dy: f32): Dg {
  return { a: 0., b: dy * exp(a) };
}
function g_bad(a: f32, dy: f32): Dg {
  return { a: dy, b: dy };
}
export function f(x: f32, k: f32): f32 {
  return g(x * k, k) + x;
}`);
  const pts = [
    [0.3, 0.8],
    [-0.4, 1.3],
  ];

  it('replaces the generated adjoint of a function, and gradCheck holds it', () => {
    checkReverse(m, 'f', ['x', 'k'], pts);
    const right = grad(m, 'f', ['x', 'k'], { mode: 'reverse', custom: { g: 'g_right' } });
    expect(right.module.funcs.some((fn) => fn.name === 'g_vjp')).toBe(false);
    const auto = grad(m, 'f', ['x', 'k'], { mode: 'reverse' });
    for (const make of MODULES)
      for (const pt of pts)
        expect(make(right.module).fns[right.name]!(...pt, 1)).toEqual(
          make(auto.module).fns[auto.name]!(...pt, 1),
        );
    expect(
      gradCheck(m, 'f', { wrt: ['x', 'k'], at: pts, mode: 'reverse', custom: { g: 'g_right' } }).ok,
    ).toBe(true);
    const wrong = gradCheck(m, 'f', {
      wrt: ['x', 'k'],
      at: pts,
      mode: 'reverse',
      custom: { g: 'g_wrong' },
    });
    expect(wrong.ok).toBe(false);
  });

  it('refuses an adjoint of the wrong shape, by name', () => {
    const rev = (custom: Record<string, string>) => () =>
      grad(m, 'f', ['x', 'k'], { mode: 'reverse', custom });
    expect(refusal(rev({ g: 'g_bad' })).message).toContain('takes 2 parameters');
    expect(refusal(rev({ g: 'nope' })).message).toContain('"nope" as the adjoint of "g"');
    expect(refusal(rev({ h: 'g_right' })).message).toContain('names "h"');
  });
});

describe('grad reverse: what it refuses, by name', () => {
  it('a function, a parameter or a name of wrt that is not there or repeats', () => {
    const m = moduleOf(`export function f(x: f32, k: f32): f32 {\n  return x * k;\n}`);
    const rev = { mode: 'reverse' } as const;
    expect(refusal(() => grad(m, 'nope', ['k'], rev)).message).toContain('no function "nope"');
    expect(refusal(() => grad(m, 'f', ['k', 'q'], rev)).message).toContain('it takes x, k');
    expect(refusal(() => grad(m, 'f', ['k', 'k'], rev)).message).toContain('appears twice');
    expect(refusal(() => grad(m, 'f', [], rev)).message).toContain('at least one name');
  });

  it('a direction in reverse mode, and a list in forward mode', () => {
    const m = moduleOf(`export function f(x: f32, k: f32): f32 {\n  return x * k;\n}`);
    expect(
      refusal(() => grad(m, 'f', ['k'], { mode: 'reverse', direction: [1] })).message,
    ).toContain('reverse mode takes no direction');
    expect(refusal(() => grad(m, 'f', ['x', 'k'])).message).toContain("pass { mode: 'reverse' }");
    expect(grad(m, 'f', ['k']).name).toBe('f_d_k');
  });

  it('a result or a parameter of a type with no derivative', () => {
    const m = moduleOf(`export function f(x: f32, n: i32): i32 {\n  return n;\n}
export function g(n: i32, k: f32): f32 {\n  return f32(n) * k;\n}`);
    const rev = { mode: 'reverse' } as const;
    expect(refusal(() => grad(m, 'f', ['x'], rev)).message).toContain('returns i32');
    expect(refusal(() => grad(m, 'g', ['n'], rev)).message).toContain('"n" of "g" is i32');
  });

  it('a builtin with no derivative rule, only when the parameter reaches it', () => {
    const m = moduleOf(`export function f(x: f32, k: f32): f32 {
  return refract(vec3(k, 0., 1.), vec3(0., 0., 1.), x).x + refract(vec3(x), vec3(1.), 1.).x;
}`);
    expect(refusal(() => grad(m, 'f', ['k'], { mode: 'reverse' })).message).toContain(
      'refract(), which has no derivative rule',
    );
  });

  it('a struct that would carry the derivative', () => {
    const m = moduleOf(`interface P {
  a: f32;
  b: f32;
}
export function f(x: f32, k: f32): f32 {
  const p: P = { a: k, b: x };
  return p.a * p.b;
}`);
    expect(refusal(() => grad(m, 'f', ['k'], { mode: 'reverse' })).message).toContain(
      'in "p", a P',
    );
  });

  it('a name that is already taken', () => {
    const m = moduleOf(`export function f(x: f32, k: f32): f32 {\n  return x * k;\n}
export function f_vjp(x: f32): f32 {\n  return x;\n}`);
    expect(refusal(() => grad(m, 'f', ['k'], { mode: 'reverse' })).message).toContain(
      'already has a function "f_vjp"',
    );
    expect(grad(m, 'f', ['k'], { mode: 'reverse', name: 'df' }).name).toBe('df');
  });
});
