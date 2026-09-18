// Default parameter values (roadmap 0.3 item T7, design #92, §14). `function tint(c: vec3,
// k: f32 = 0.5)` is ordinary TypeScript, and `tint(c)` is how it is then called. Measured on
// `main` before this: every such call was `TS8019 "tint" expects 2 argument(s), got 1`, since
// the signature parsed the parameter and nothing filled the argument in. What is pinned here:
// the fill at the call site on all four signature shapes, a default lowered once and read from
// the module's scope, the order-independence of one default that calls another, the cycle a
// filled default can close, both CPU paths agreeing, and the shapes that have no value to fill.

import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { compileTsSource } from './source-file.js'
import { TS_CODES } from './codes.js'
import { compileModule } from '../../core/oracle.js'
import { compileModuleJs } from '../../core/cpu-codegen.js'

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`)

const file = (head: string, body: string) => `"use typeshade"
${head}@fragment
export function fs(): vec4 {
${body}
}
`

/** Both CPU paths on the module's entry, which is what proves the fill is in the IR and not in
 *  one backend's text. */
const agree = (r: ReturnType<typeof compile>, expected: number[]): void => {
  for (const make of [compileModule, compileModuleJs]) {
    expect(make(r.module).fns['fs']!(), make.name).toEqual(expected)
  }
}

describe('a default fills itself in at the call site', () => {
  it('on a plain function, once per omitted argument, written or not', () => {
    const r = compile(
      file(
        `function f(a: f32, b: f32 = 2., c: f32 = 3.): f32 {
  return a + b + c
}
`,
        `  return vec4(f(1.), f(1., 10.), f(1., 10., 100.), 1.)`,
      ),
    )
    expect(r.diagnostics).toEqual([])
    // The emitted function keeps every parameter: WGSL has no default arguments.
    expect(r.wgsl).toContain('fn f(a: f32, b: f32, c: f32) -> f32 {')
    expect(r.wgsl).toContain('f(1.0, 2.0, 3.0)')
    expect(r.wgsl).toContain('f(1.0, 10.0, 3.0)')
    expect(r.wgsl).toContain('f(1.0, 10.0, 100.0)')
    expect(r.glsl?.fragment).toContain('float f(float a, float b, float c) {')
    agree(r, [6, 14, 111, 1])
  })

  it('on a method, a static and a constructor', () => {
    const r = compile(
      file(
        `class Ray {
  o: f32
  d: f32
  at(t: f32 = 2.): f32 {
    return this.o + this.d * t
  }
  static of(o: f32, d: f32 = 4.): Ray {
    return { o: o, d: d }
  }
}
class P {
  x: f32
  y: f32
  constructor(x: f32, y: f32 = 9.) {
    this.x = x
    this.y = y
  }
}
`,
        `  const r = Ray.of(1.)\n  const p = new P(5.)\n  return vec4(r.at(), r.at(10.), p.x, p.y)`,
      ),
    )
    expect(r.diagnostics).toEqual([])
    // A method's stub carries `self_` first, so its defaults sit one index along.
    expect(r.wgsl).toContain('Ray_at(r, 2.0)')
    expect(r.wgsl).toContain('Ray_at(r, 10.0)')
    expect(r.wgsl).toContain('Ray_of(1.0, 4.0)')
    expect(r.wgsl).toContain('P_new(5.0, 9.0)')
    agree(r, [9, 41, 5, 9])
  })

  it('reads the module scope, and an integer default takes the parameter kind', () => {
    const r = compile(
      file(
        `const K: f32 = 0.25
namespace N {
  export const H: f32 = 0.5
  export function f(a: f32, b: f32 = H): f32 {
    return a + b
  }
}
function g(a: f32, b: f32 = K * 2.): f32 {
  return a + b
}
function n(a: i32, b: i32 = 3): i32 {
  return a + b
}
`,
        `  return vec4(g(1.), N.f(1.), f32(n(1)), 1.)`,
      ),
    )
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('g(1.0, (K * 2.0))')
    expect(r.wgsl).toContain('N_f(1.0, N_H)')
    // `3`, not `3.0`: the default takes the parameter's kind the way a written argument does.
    expect(r.wgsl).toContain('n(1, 3)')
    agree(r, [1.5, 1.5, 4, 1])
  })

  it('resolves a default that calls a function with a default, in either order', () => {
    const later = compile(
      file(
        `function f(a: f32 = g()): f32 {
  return a * 2.
}
function g(b: f32 = 3.): f32 {
  return b + 1.
}
`,
        `  return vec4(f(), 0., 0., 1.)`,
      ),
    )
    const earlier = compile(
      file(
        `function g(b: f32 = 3.): f32 {
  return b + 1.
}
function f(a: f32 = g()): f32 {
  return a * 2.
}
`,
        `  return vec4(f(), 0., 0., 1.)`,
      ),
    )
    for (const r of [later, earlier]) {
      expect(r.diagnostics).toEqual([])
      expect(r.wgsl).toContain('f(g(3.0))')
      agree(r, [8, 0, 0, 1])
    }
  })

  it('closes a call cycle the source never writes, and says so', () => {
    // `g`'s body is `return f()`, which the fill turns into `f(g())`: `g` calls itself. The
    // recursion check walks the syntax tree, where that call is not written, so before this it
    // emitted WGSL Tint refuses and a CPU run that overflows.
    expect(
      errorsOf(`"use typeshade"
function g(): f32 {
  return f()
}
function f(a: f32 = g()): f32 {
  return a * 2.
}
@fragment
export function fs(): vec4 {
  return vec4(g(), 0., 0., 1.)
}
`),
    ).toEqual([
      `${TS_CODES.RECURSION} Recursive call: "g" -> "g". WGSL has no call stack, so a function must not take part in a call cycle.`,
    ])
  })
})

describe('what a default has no value to fill from', () => {
  it('a parameter of its own function, or "this"', () => {
    expect(
      errorsOf(
        file(
          `function f(a: f32, b: f32 = a * 2.): f32 {
  return a + b
}
`,
          `  return vec4(f(1.), 0., 0., 1.)`,
        ),
      )[0],
    ).toBe(
      `${TS_CODES.FUNCTION_SHAPE} A default cannot read the parameter "a": the default is filled in where the function is called, and "a" is an expression there, which would then run a second time. Give "b" a default that stands on its own and compute from "a" in the body.`,
    )
    expect(
      errorsOf(
        file(
          `class R {
  o: f32
  at(t: f32 = this.o): f32 {
    return this.o + t
  }
}
`,
          `  const r: R = { o: 1. }\n  return vec4(r.at(), 0., 0., 1.)`,
        ),
      )[0],
    ).toContain('A default cannot read "this"')
    // A name that is a FIELD and not a read is not a parameter reference.
    expect(
      compile(
        file(
          `class P {
  a: f32
}
function f(a: f32, p: P = { a: 7. }): f32 {
  return a + p.a
}
`,
          `  return vec4(f(1.), 0., 0., 1.)`,
        ),
      ).diagnostics,
    ).toEqual([])
  })

  it('an entry parameter, which comes from the pipeline', () => {
    expect(
      errorsOf(`"use typeshade"
@fragment
export function fs(@location(0) uv: vec2 = vec2(0.)): vec4 {
  return vec4(uv, 0., 1.)
}
`),
    ).toEqual([
      `${TS_CODES.FUNCTION_SHAPE} An entry's parameters come from the pipeline, not from a call, so "uv" cannot have a default.`,
    ])
  })

  it('a default of the wrong type, reported once and not again at the call', () => {
    expect(
      errorsOf(
        file(
          `function f(a: f32, b: vec2 = 1.): f32 {
  return a + b.x
}
`,
          `  return vec4(f(1.), 0., 0., 1.)`,
        ),
      ),
    ).toEqual([
      `${TS_CODES.TYPE_MISMATCH} The default for "b" is f32, and the parameter is vec2<f32>.`,
    ])
  })

  it('a default that waits on itself', () => {
    expect(
      errorsOf(
        file(
          `function f(a: f32 = f()): f32 {
  return a * 2.
}
`,
          `  return vec4(f(), 0., 0., 1.)`,
        ),
      ),
    ).toEqual([
      `${TS_CODES.FUNCTION_SHAPE} The default for "a" calls a function whose own default waits on this one, so neither has a value. Write the value out here.`,
    ])
  })

  it('an optional parameter names the default to write instead', () => {
    expect(
      errorsOf(
        file(
          `function f(a: f32, b?: f32): f32 {
  return a
}
`,
          `  return vec4(f(1.), 0., 0., 1.)`,
        ),
      )[0],
    ).toBe(
      `${TS_CODES.FUNCTION_SHAPE} Optional parameter "b" is not supported: a shader value is always present, so there is no "absent" for the body to test. Give it a default instead, "b: T = ...", which a call that omits it fills in.`,
    )
  })
})

describe('the arity message counts the defaults', () => {
  const HEAD = `function f(a: f32, b: f32, c: f32 = 3.): f32 {
  return a + b + c
}
`
  it('names the range when some parameters have one, and not when none do', () => {
    expect(errorsOf(file(HEAD, `  return vec4(f(1.), 0., 0., 1.)`))[0]).toBe(
      `${TS_CODES.ARITY_MISMATCH} "f" takes 2 to 3 argument(s), got 1.`,
    )
    expect(errorsOf(file(HEAD, `  return vec4(f(1., 2., 3., 4.), 0., 0., 1.)`))[0]).toBe(
      `${TS_CODES.ARITY_MISMATCH} "f" takes 2 to 3 argument(s), got 4.`,
    )
    expect(
      errorsOf(
        file(
          `function h(a: f32, b: f32): f32 {
  return a + b
}
`,
          `  return vec4(h(1.), 0., 0., 1.)`,
        ),
      )[0],
    ).toBe(`${TS_CODES.ARITY_MISMATCH} "h" expects 2 argument(s), got 1.`)
  })

  it('a default before a required parameter fills nothing, as in TypeScript', () => {
    const r = compile(
      file(
        `function f(a: f32 = 1., b: f32): f32 {
  return a + b
}
`,
        `  return vec4(f(1., 2.), 0., 0., 1.)`,
      ),
    )
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('f(1.0, 2.0)')
    expect(
      errorsOf(
        file(
          `function f(a: f32 = 1., b: f32): f32 {\n  return a + b\n}\n`,
          `  return vec4(f(1.), 0., 0., 1.)`,
        ),
      )[0],
    ).toBe(`${TS_CODES.ARITY_MISMATCH} "f" expects 2 argument(s), got 1.`)
  })
})
