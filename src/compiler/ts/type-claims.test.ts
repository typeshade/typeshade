// TypeScript's type-level shapes, and a module const of a struct type (roadmap 0.3 item T7,
// design #92, §14 and §12). `x as T`, `<T>x`, `x as const`, `x satisfies T` and `x!` are
// claims about a type rather than conversions: each emits what its operand emits, which is
// what each does in TypeScript. Measured on `main` before this: every one was "TS8099
// Unsupported expression", and a module const of a struct type could not resolve the object
// literal its own annotation named. What is pinned here: the shapes that emit nothing, the one
// claim that is refused and why, and the annotation deciding a struct at module scope.

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
const agree = (r: ReturnType<typeof compile>, expected: number[]): void => {
  for (const make of [compileModule, compileModuleJs]) {
    expect(make(r.module).fns['fs']!(), make.name).toEqual(expected)
  }
}

describe('a claim about a type emits what its operand emits', () => {
  it('as const, an assertion in both spellings, satisfies, and the non-null one', () => {
    const r = compile(
      file(
        `class P {
  x: f32
  y: f32
}
const K = 3. as const
`,
        `  const half = 0.5 as f32
  const v = <vec2>vec2(1., 2.)
  const p = { x: 1., y: 2. } satisfies P
  return vec4(K * half, p.x, p.y, v.y)`,
      ),
    )
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('const K: f32 = 3.0;')
    // Nothing of the claims survives into the emit.
    expect(r.wgsl).not.toContain('as')
    expect(r.wgsl).not.toContain('satisfies')
    agree(r, [1.5, 1, 2, 2])
  })

  it('a non-null assertion on a binding read', () => {
    const r = compile(
      `"use typeshade";
class P {
  x: f32;
}
declare const u: uniform<P>;
@fragment
export function fs(): vec4 {
  return vec4(u!.x, 0., 0., 1.);
}
`,
    )
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('return vec4<f32>(u.x, 0.0, 0.0, 1.0);')
  })

  it('a claim of a type the operand does not have is refused, with the conversion to write', () => {
    // `as` emits nothing, so accepting this would send an f32 under an i32's name.
    expect(errorsOf(file('', `  const k = 0.5 as i32\n  return vec4(f32(k), 0., 0., 1.)`))[0]).toBe(
      `${TS_CODES.TYPE_MISMATCH} "as" states a type, it does not convert: "0.5 as i32" is f32, not i32. Write i32(...) to convert, or drop the "as".`,
    )
    expect(
      errorsOf(file('', `  const k = 0.5 as Nope\n  return vec4(k, 0., 0., 1.)`))[0],
    ).toContain('is f32, not Nope')
  })
})

describe('a module const takes the struct its annotation names', () => {
  it('resolves the object literal, nested, on both targets and both CPU paths', () => {
    const r = compile(
      file(
        `class Inner {
  a: f32
}
class Outer {
  i: Inner
  k: f32
}
const O: Outer = { i: { a: 2. }, k: 3. }
`,
        `  return vec4(O.i.a, O.k, 0., 1.)`,
      ),
    )
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('const O: Outer = Outer(Inner(2.0), 3.0);')
    expect(r.glsl?.fragment).toContain('const Outer O = Outer(Inner(2.0), 3.0);')
    agree(r, [2, 3, 0, 1])
  })

  it('the annotation decides between two structs of one shape', () => {
    // Field names alone cannot: matchStruct answers nothing when two structs share a shape.
    const r = compile(
      file(
        `class A {
  x: f32
  y: f32
}
class B {
  x: f32
  y: f32
}
const Q: B = { x: 3., y: 4. }
function useA(a: A): f32 {
  return a.x
}
`,
        `  return vec4(Q.x, Q.y, useA({ x: 1., y: 2. }), 1.)`,
      ),
    )
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('const Q: B = B(3.0, 4.0);')
    agree(r, [3, 4, 1, 1])
  })
})
