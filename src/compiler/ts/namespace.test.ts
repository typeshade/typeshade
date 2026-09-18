// `namespace` (roadmap 0.3 item T4, design #92, §26). A namespace is a named group of
// functions and constants, and the module already holds both: the members flatten to
// `Ns_member`, the joining a class's method and a class's static field already take. Measured
// on `main` before this: a namespace was TS8014 "Unsupported top-level "ModuleDeclaration"",
// followed by an unknown identifier at every use. What is pinned here: the flattened names on
// both targets and both CPU paths, TypeScript's own lookup inside a namespace body, nesting in
// both spellings, the cycle check reaching a dotted call, and the refusals.

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
export function fs(@location(0) uv: vec2): vec4 {
${body}
}
`
const agree = (r: ReturnType<typeof compile>, expected: number[]): void => {
  for (const make of [compileModule, compileModuleJs]) {
    expect(make(r.module).fns['fs']!([0.5, 0.5]), make.name).toEqual(expected)
  }
}

describe('a namespace is a group of functions and constants', () => {
  it('flattens its members to Ns_member, on both targets', () => {
    const r = compile(
      file(
        `namespace Palette {
  export const WARM: vec3 = vec3(0.9, 0.5, 0.1)
  export function tint(c: vec3): vec3 {
    return c * WARM
  }
}
`,
        `  return vec4(Palette.tint(vec3(1., 1., 1.)), 1.)`,
      ),
    )
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('const Palette_WARM: vec3<f32> = vec3<f32>(0.9, 0.5, 0.1);')
    expect(r.wgsl).toContain('fn Palette_tint(c: vec3<f32>) -> vec3<f32> {')
    expect(r.glsl?.fragment).toContain('vec3 Palette_tint(vec3 c) {')
    agree(r, [0.9, 0.5, 0.1, 1])
  })

  it('looks a name up as TypeScript does: the body first, then the namespace, then the file', () => {
    const r = compile(
      file(
        `function half(x: f32): f32 {
  return x * 0.5
}
namespace A {
  export const K: f32 = 2.
  export function shadowed(): f32 {
    const K: f32 = 3.
    return K
  }
  export function member(): f32 {
    return K
  }
  export function outer(x: f32): f32 {
    return half(x)
  }
}
`,
        `  return vec4(A.shadowed(), A.member(), A.outer(1.), 1.)`,
      ),
    )
    expect(r.diagnostics).toEqual([])
    // A local wins over the member, the member over nothing, and a top-level function is
    // reachable from inside.
    agree(r, [3, 2, 0.5, 1])
  })

  it('nests, in both spellings, and a member namespace takes its short name inside the parent', () => {
    const nested = compile(
      file(
        `namespace A {
  export namespace B {
    export function two(): f32 {
      return 2.
    }
  }
  export function four(): f32 {
    return B.two() * 2.
  }
}
`,
        `  return vec4(A.four(), A.B.two(), 0., 1.)`,
      ),
    )
    expect(nested.diagnostics).toEqual([])
    expect(nested.wgsl).toContain('fn A_B_two() -> f32 {')
    agree(nested, [4, 2, 0, 1])
    const dotted = compile(
      file(
        `namespace A.B {\n  export function two(): f32 {\n    return 2.\n  }\n}\n`,
        `  return vec4(A.B.two(), 0., 0., 1.)`,
      ),
    )
    expect(dotted.diagnostics).toEqual([])
    expect(dotted.wgsl).toContain('fn A_B_two() -> f32 {')
  })
})

describe('a namespace does not hide a cycle', () => {
  it('a call through a dotted name is in the recursion graph', () => {
    // The check walked identifier calls only, so `A.f()` calling itself was invisible to it
    // and compiled; Tint refuses the WGSL and the CPU oracle overflows its stack.
    expect(
      errorsOf(
        file(
          `namespace A {\n  export function f(): f32 {\n    return A.f()\n  }\n}\n`,
          `  return vec4(A.f(), 0., 0., 1.)`,
        ),
      ),
    ).toEqual([
      `${TS_CODES.RECURSION} Recursive call: "A_f" -> "A_f". WGSL has no call stack, so a function must not take part in a call cycle.`,
    ])
    expect(
      errorsOf(
        file(
          `namespace A {\n  export function f(): f32 {\n    return B.g()\n  }\n}\nnamespace B {\n  export function g(): f32 {\n    return A.f()\n  }\n}\n`,
          `  return vec4(A.f(), 0., 0., 1.)`,
        ),
      ),
    ).toEqual([
      `${TS_CODES.RECURSION} Recursive call: "A_f" -> "B_g" -> "A_f". WGSL has no call stack, so a function must not take part in a call cycle.`,
    ])
  })
})

describe('what a namespace does not hold', () => {
  it('an enum, a type or a variable says where to declare it', () => {
    // A class inside a namespace was refused here too, until #107 gave it the same flattening
    // its functions and constants take; `namespace-class.test.ts` pins that.
    expect(
      errorsOf(
        file(`namespace A {\n  export enum E {\n    X,\n  }\n}\n`, `  return vec4(1., 0., 0., 1.)`),
      )[0],
    ).toContain('an enum inside "A" has no flattened form')
    expect(
      errorsOf(
        file(`namespace A {\n  export let x: f32 = 1.\n}\n`, `  return vec4(1., 0., 0., 1.)`),
      )[0],
    ).toContain('a variable inside "A" has no flattened form')
  })

  it('a declare namespace, and a member the namespace does not have', () => {
    expect(
      errorsOf(
        file(
          `declare namespace A {\n  export function f(): f32\n}\n`,
          `  return vec4(1., 0., 0., 1.)`,
        ),
      )[0],
    ).toBe(
      `${TS_CODES.TOP_LEVEL} "declare namespace A" has no members to emit; declare the namespace in this file.`,
    )
    expect(
      errorsOf(
        file(
          `namespace A {\n  export function f(): f32 {\n    return 1.\n  }\n}\n`,
          `  return vec4(A.g(), 0., 0., 1.)`,
        ),
      )[0],
    ).toBe(`${TS_CODES.CLASS_MEMBER} "A" has no function "g".`)
  })

  it('a top-level name that collides with a flattened one is reported', () => {
    expect(
      errorsOf(
        file(
          `function A_f(): f32 {\n  return 1.\n}\nnamespace A {\n  export function f(): f32 {\n    return 2.\n  }\n}\n`,
          `  return vec4(A.f(), 0., 0., 1.)`,
        ),
      )[0],
    ).toBe(`${TS_CODES.DUPLICATE_SYMBOL} Duplicate function "A_f".`)
  })
})
