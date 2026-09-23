// grad (roadmap 0.7 item 18): forward-mode differentiation as an IR pass. Every derivative the
// pass builds is checked the way the roadmap asks, against a central finite difference of the
// original function on the CPU oracle, and on both CPU modules (the tree-walk oracle and the
// codegen), so a rule that is wrong, or a tangent that goes missing through a branch, a loop or
// a call, fails by the number it gets wrong.

import { describe, expect, it } from 'vitest'
import { compile } from '../../compiler/ts/compile.js'
import { compileModule } from '../oracle.js'
import { compileModuleJs } from '../cpu-codegen.js'
import { emitModule } from '../backends/wgsl.js'
import { emitGlslModule } from '../backends/glsl.js'
import { TypeShadeError } from '../diagnostics/error.js'
import { grad } from './grad.js'
import type { Expr, FuncDecl, ModuleDecl } from '../ir/nodes.js'

function moduleOf(src: string): ModuleDecl {
  const r = compile(`"use typeshade"\n${src}`)
  expect(r.diagnostics).toEqual([])
  return r.module
}

type Fn = (...args: unknown[]) => unknown
const flat = (v: unknown): number[] =>
  Array.isArray(v) ? (v as unknown[]).flatMap(flat) : [v as number]

/** Check `d/d param` of `fn` at each point against a central difference on both CPU modules. */
function checkAgainstFiniteDifference(
  m: ModuleDecl,
  fn: string,
  param: string,
  points: readonly (readonly (number | readonly number[])[])[],
  direction?: readonly number[],
): void {
  const d = grad(m, fn, param, direction ? { direction } : undefined)
  const f0 = m.funcs.find((f) => f.name === fn)!
  const at = f0.params.findIndex((p) => p.name === param)
  for (const make of [compileModule, compileModuleJs]) {
    const cm = make(d.module)
    const f = cm.fns[fn] as Fn
    const df = cm.fns[d.name] as Fn
    for (const pt of points) {
      const h = 1e-5
      const shift = (s: number) => {
        const args: unknown[] = [...pt]
        const v = args[at]
        args[at] = Array.isArray(v)
          ? (v as number[]).map((c, i) => c + s * direction![i]!)
          : (v as number) + s
        return args
      }
      const hi = flat(f(...shift(h)))
      const lo = flat(f(...shift(-h)))
      const expected = hi.map((x, i) => (x - lo[i]!) / (2 * h))
      const got = flat(df(...pt))
      expect(got.length, `${make.name} ${fn} at ${JSON.stringify(pt)}`).toBe(expected.length)
      got.forEach((g, i) => {
        const tol = 1e-4 * Math.max(1, Math.abs(expected[i]!))
        expect(
          Math.abs(g - expected[i]!),
          `${make.name} d${fn}/d${param} at ${JSON.stringify(pt)}[${i}]: got ${g}, finite difference ${expected[i]}`,
        ).toBeLessThan(tol)
      })
    }
  }
}

const refusal = (thunk: () => unknown): TypeShadeError => {
  try {
    thunk()
  } catch (e) {
    expect(e).toBeInstanceOf(TypeShadeError)
    expect((e as TypeShadeError).code).toBe('SD0118')
    return e as TypeShadeError
  }
  throw new Error('expected SD0118')
}

describe('grad: each builtin rule agrees with a finite difference', () => {
  // `k` is the parameter; `x` is a second argument that stays fixed. Each point keeps the
  // builtin inside its domain and away from a kink.
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
      'tan(k)',
      [
        [0, 0.3],
        [0, -1.1],
      ],
    ],
    [
      'asin(k)',
      [
        [0, 0.3],
        [0, -0.6],
      ],
    ],
    [
      'acos(k)',
      [
        [0, 0.3],
        [0, -0.6],
      ],
    ],
    [
      'atan(k)',
      [
        [0, 0.3],
        [0, -2.5],
      ],
    ],
    [
      'sinh(k)',
      [
        [0, 0.3],
        [0, -1.5],
      ],
    ],
    [
      'cosh(k)',
      [
        [0, 0.3],
        [0, -1.5],
      ],
    ],
    [
      'tanh(k)',
      [
        [0, 0.3],
        [0, -1.5],
      ],
    ],
    [
      'asinh(k)',
      [
        [0, 0.3],
        [0, -1.5],
      ],
    ],
    [
      'acosh(k)',
      [
        [0, 1.3],
        [0, 4],
      ],
    ],
    [
      'atanh(k)',
      [
        [0, 0.3],
        [0, -0.6],
      ],
    ],
    [
      'exp(k * x)',
      [
        [0.5, 1.2],
        [-1, 0.2],
      ],
    ],
    [
      'exp2(k)',
      [
        [0, 1.2],
        [0, -0.7],
      ],
    ],
    [
      'log(k)',
      [
        [0, 1.2],
        [0, 0.3],
      ],
    ],
    [
      'log2(k)',
      [
        [0, 1.2],
        [0, 0.3],
      ],
    ],
    [
      'sqrt(k)',
      [
        [0, 1.2],
        [0, 0.3],
      ],
    ],
    [
      'inverseSqrt(k)',
      [
        [0, 1.2],
        [0, 0.3],
      ],
    ],
    [
      'abs(k)',
      [
        [0, 1.2],
        [0, -0.3],
      ],
    ],
    [
      'fract(k)',
      [
        [0, 1.2],
        [0, -0.3],
      ],
    ],
    ['radians(k)', [[0, 30]]],
    ['degrees(k)', [[0, 0.5]]],
    ['floor(k) + ceil(k) + round(k) + trunc(k) + sign(k) + step(0.5, k)', [[0, 1.3]]],
    [
      'saturate(k)',
      [
        [0, 0.3],
        [0, 1.7],
        [0, -0.4],
      ],
    ],
    [
      'clamp(k, x, 2.)',
      [
        [0.5, 1.3],
        [0.5, 0.2],
        [0.5, 2.5],
      ],
    ],
    [
      'clamp(x, k, 2.)',
      [
        [0.5, 1.3],
        [0.5, 0.2],
      ],
    ],
    [
      'min(k, x) + max(k * 2., x)',
      [
        [0.5, 0.3],
        [0.5, 0.9],
      ],
    ],
    [
      'mix(k, x, k * 0.5)',
      [
        [2, 0.3],
        [-1, 0.9],
      ],
    ],
    [
      'smoothstep(0.2, 1.4, k)',
      [
        [0, 0.5],
        [0, 1.1],
        [0, -1],
      ],
    ],
    ['smoothstep(k, 2., x)', [[1, 0.5]]],
    [
      'pow(k, x)',
      [
        [2.5, 1.3],
        [0.5, 0.4],
      ],
    ],
    [
      'pow(x, k)',
      [
        [2.5, 1.3],
        [0.5, 0.4],
      ],
    ],
    [
      'atan(k, x)',
      [
        [2.5, 1.3],
        [-0.5, 0.4],
      ],
    ],
    [
      'mod(k * 3., x)',
      [
        [1.1, 1.3],
        [0.7, -0.4],
      ],
    ],
    [
      'k % x + x % k',
      [
        [1.1, 1.3],
        [0.7, 2.4],
      ],
    ],
    [
      'k / x + x / k',
      [
        [1.1, 1.3],
        [0.7, -2.4],
      ],
    ],
    ['-k * x - k', [[1.1, 1.3]]],
    [
      'k > x ? k * k : x * k',
      [
        [0.5, 1.3],
        [0.5, 0.2],
      ],
    ],
  ]
  for (const [expr, points] of cases) {
    it(expr, () => {
      const m = moduleOf(`export function f(x: f32, k: f32): f32 {\n  return ${expr}\n}`)
      checkAgainstFiniteDifference(m, 'f', 'k', points)
    })
  }
})

describe('grad: fma, whose f32 rounding a finite difference cannot resolve', () => {
  it('is x + 2k for fma(k, x, k * k)', () => {
    // The oracle rounds fma to f32 (a single rounding, as the GPU does), so a central
    // difference at h = 1e-5 is off in the third digit; the analytic value is exact.
    const m = moduleOf(`export function f(x: f32, k: f32): f32 {\n  return fma(k, x, k * k)\n}`)
    const d = grad(m, 'f', 'k')
    expect(compileModule(d.module).fns[d.name]!(2.5, 1.25)).toBe(2.5 + 2 * 1.25)
  })
})

describe('grad: vectors and matrices', () => {
  it('dot, cross, length, distance, normalize and reflect', () => {
    const m = moduleOf(`export function f(x: f32, k: f32): vec3 {
  const a = vec3(k, x, k * x)
  const b = vec3(1., k * k, -x)
  const n = normalize(vec3(k, 1., 0.5))
  return cross(a, b) * dot(a, b) + normalize(a) * length(b) + reflect(a, n) + vec3(distance(a, b))
}`)
    checkAgainstFiniteDifference(m, 'f', 'k', [
      [0.3, 1.2],
      [-1.4, 0.5],
    ])
  })

  it('a swizzle, a component write and a vector the parameter only partly reaches', () => {
    const m = moduleOf(`export function f(x: f32, k: f32): vec2 {
  let v = vec3(x, 2., 3.)
  v.y = k * v.x
  v.z += sin(k)
  return v.zy * k
}`)
    checkAgainstFiniteDifference(m, 'f', 'k', [[0.3, 1.2]])
  })

  it('a matrix times a vector, and a transpose', () => {
    const m = moduleOf(`export function f(x: f32, k: f32): vec2 {
  const r = mat2(cos(k), sin(k), -sin(k), cos(k))
  return transpose(r) * (r * vec2(x, k))
}`)
    checkAgainstFiniteDifference(m, 'f', 'k', [[0.3, 1.2]])
  })

  it('a vector parameter, along a direction', () => {
    const m = moduleOf(`export function f(p: vec2, s: f32): f32 {
  return sin(p.x * s) * p.y + length(p)
}`)
    checkAgainstFiniteDifference(m, 'f', 'p', [[[0.3, 1.1], 2]], [1, 0])
    checkAgainstFiniteDifference(m, 'f', 'p', [[[0.3, 1.1], 2]], [0.6, -0.8])
  })
})

describe('grad: control flow and calls', () => {
  it('a loop accumulating into a variable, an if, and an early return', () => {
    const m = moduleOf(`export function f(x: f32, k: f32): f32 {
  if (x < 0.) {
    return k * k * x
  }
  let acc: f32 = 0.
  for (let i: i32 = 0; i < 5; i++) {
    acc += sin(k * x + f32(i)) * k
    if (acc > 1.) {
      acc = acc * 0.5 + k
    }
  }
  return acc * exp(k)
}`)
    checkAgainstFiniteDifference(m, 'f', 'k', [
      [0.7, 0.4],
      [0.2, 1.3],
      [-0.5, 0.9],
    ])
  })

  it('a switch', () => {
    const m = moduleOf(`export function f(x: f32, k: f32): f32 {
  let r: f32 = 0.
  switch (i32(x)) {
    case 0:
      r = k * k
      break
    case 1:
      r = sin(k)
      break
    default:
      r = k
  }
  return r
}`)
    checkAgainstFiniteDifference(m, 'f', 'k', [
      [0.5, 0.4],
      [1.5, 0.4],
      [2.5, 0.4],
    ])
  })

  it('an integer a helper computes from the parameter has a zero derivative', () => {
    const m = moduleOf(`function steps(a: f32): i32 {
  return i32(floor(a * 4.))
}
export function f(x: f32, k: f32): f32 {
  return f32(steps(k)) * x + k * k
}`)
    checkAgainstFiniteDifference(m, 'f', 'k', [[0.5, 0.3]])
  })

  it('calls through two helpers, each differentiated once', () => {
    const m = moduleOf(`function g(a: f32, v: vec2): f32 {
  return dot(v, vec2(a, a * a)) + h(a)
}
function h(a: f32): f32 {
  return smoothstep(0., 1., a) * a
}
export function f(x: f32, k: f32): f32 {
  return g(k, vec2(x, k)) + g(x, vec2(1., 2.)) + h(k * 2.)
}`)
    const d = grad(m, 'f', 'k')
    const names = d.module.funcs.map((f) => f.name)
    expect(names.slice(m.funcs.length)).toEqual(['h_jvp', 'g_jvp', 'f_d_k'])
    checkAgainstFiniteDifference(m, 'f', 'k', [
      [0.3, 0.4],
      [1.2, 0.8],
    ])
  })
})

/** `m` with its fragment entry replaced by one that returns `vec4(fn(p.x, p.y))`: the GLSL
 *  writer emits only what an entry reaches, so the derivative needs a caller to be emitted. */
function withFragmentCalling(m: ModuleDecl, fn: string): ModuleDecl {
  const vec4f = { kind: 'vec', n: 4, elem: 'f32' } as const
  const f32 = { kind: 'scalar', scalar: 'f32' } as const
  const p: Expr = { op: 'param', type: vec4f, name: 'p' }
  const lane = (field: string): Expr => ({ op: 'member', type: f32, base: p, field })
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
          args: [{ op: 'call', type: f32, fn, args: [lane('x'), lane('y')] }],
        },
      },
    ],
  }
  return { ...m, funcs: [...m.funcs.filter((f) => f.name !== 'fs'), fs] }
}

describe('grad: the generated function is ordinary IR on every target', () => {
  it('emits WGSL and GLSL ES 3.00, and leaves the rest of the module as it was', () => {
    const m = moduleOf(`function g(a: f32): f32 {
  return a * a
}
export function f(x: f32, k: f32): f32 {
  return sin(g(k) * x) + smoothstep(0., 1., k) * length(vec2(x, k))
}`)
    const d = grad(m, 'f', 'k')
    expect(d.module.funcs.slice(0, m.funcs.length)).toEqual(m.funcs)
    const withEntry = withFragmentCalling(d.module, d.name)
    const wgsl = emitModule(withEntry)
    expect(wgsl).toContain('fn f_d_k(x: f32, k: f32) -> f32')
    expect(wgsl).toContain('fn g_jvp(a: f32, d_a: f32) -> f32')
    const glsl = emitGlslModule(withEntry, 'fragment')
    expect(glsl).toContain('float f_d_k(float x, float k)')
    expect(glsl).toContain('float g_jvp(float a, float d_a)')
  })
})

describe('grad: what a caller does with it', () => {
  it('fits a function to samples by gradient descent, back to the parameters that made them', () => {
    // The roadmap's use (item 18): parameter estimation. The samples come from a = 1.7,
    // k = 2.3; descent from a = 1, k = 2 has to land on them, which it does only if both
    // partial derivatives are right at every step. The rate is small because the first
    // step's dk is about -132: at 0.01 it jumps k by 1.3 into another minimum of the sine.
    const m = moduleOf(`export function wave(x: f32, a: f32, k: f32): f32 {
  return a * sin(k * x) * exp(-0.1 * x)
}`)
    const da = grad(m, 'wave', 'a')
    const dk = grad(da.module, 'wave', 'k')
    const cpu = compileModuleJs(dk.module)
    const f = cpu.fns.wave as (x: number, a: number, k: number) => number
    const fa = cpu.fns[da.name] as typeof f
    const fk = cpu.fns[dk.name] as typeof f
    const xs = Array.from({ length: 64 }, (_, i) => i * 0.1)
    const ys = xs.map((x) => f(x, 1.7, 2.3))
    let a = 1
    let k = 2
    for (let step = 0; step < 1000; step++) {
      let ga = 0
      let gk = 0
      xs.forEach((x, i) => {
        const r = f(x, a, k) - ys[i]!
        ga += 2 * r * fa(x, a, k)
        gk += 2 * r * fk(x, a, k)
      })
      a -= 0.001 * ga
      k -= 0.001 * gk
    }
    expect(a).toBeCloseTo(1.7, 6)
    expect(k).toBeCloseTo(2.3, 6)
  })
})

describe('grad: what it refuses, by name', () => {
  it('a function or a parameter that is not there', () => {
    const m = moduleOf(`export function f(x: f32, k: f32): f32 {\n  return x * k\n}`)
    expect(refusal(() => grad(m, 'nope', 'k')).message).toContain('no function "nope"')
    expect(refusal(() => grad(m, 'f', 'q')).message).toContain('it takes x, k')
  })

  it('a result or a parameter of a type with no derivative', () => {
    const m = moduleOf(`export function f(x: f32, n: i32): i32 {\n  return n\n}
export function g(v: vec2, k: f32): f32 {\n  return v.x * k\n}`)
    expect(refusal(() => grad(m, 'f', 'x')).message).toContain('returns i32')
    expect(refusal(() => grad(m, 'g', 'v')).message).toContain('pass opts.direction with 2 numbers')
    expect(refusal(() => grad(m, 'g', 'k', { direction: [1] })).message).toContain('is an f32')
  })

  it('a builtin with no derivative rule, only when the parameter reaches it', () => {
    const m = moduleOf(`export function f(x: f32, k: f32): f32 {
  return refract(vec3(k, 0., 1.), vec3(0., 0., 1.), x).x + refract(vec3(x), vec3(1.), 1.).x
}`)
    expect(refusal(() => grad(m, 'f', 'k')).message).toContain(
      'refract(), which has no derivative rule',
    )
    expect(() => grad(m, 'f', 'x')).toThrow('refract(), which has no derivative rule')
  })

  it('a struct that would carry the derivative', () => {
    const m = moduleOf(`interface P {
  a: f32
  b: f32
}
export function f(x: f32, k: f32): f32 {
  const p: P = { a: k, b: x }
  return p.a * p.b
}`)
    expect(refusal(() => grad(m, 'f', 'k')).message).toContain('builds a P')
  })

  it('a name that is already taken', () => {
    const m = moduleOf(`export function f(x: f32, k: f32): f32 {\n  return x * k\n}
export function f_d_k(x: f32): f32 {\n  return x\n}`)
    expect(refusal(() => grad(m, 'f', 'k')).message).toContain('already has a function "f_d_k"')
    expect(grad(m, 'f', 'k', { name: 'df' }).name).toBe('df')
  })
})
