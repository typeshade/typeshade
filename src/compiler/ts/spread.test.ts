// Object spread into a struct literal (roadmap 0.3 item T7, design #92, §16). `{ ...p, y: 9. }`
// is the fields of `p` with `y` written over one of them. Measured on `main` before this: every
// form was `TS8013 Spread is a JS runtime operation`, which is true of `f(...args)` and `[...xs]`
// and is not true of this one. What is pinned here: the reads it emits, later winning as in
// TypeScript, the target decided by an annotation or by the field names, both CPU paths, and
// the three shapes a spread has no form for.

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

const P = `class P {
  x: f32
  y: f32
}
`
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

describe('a spread in an object literal is the reads it stands for', () => {
  it('with a field written over it, and alone', () => {
    const over = compile(
      file(
        P,
        `  const p: P = { x: 1., y: 2. }\n  const q: P = { ...p, y: 9. }\n  return vec4(q.x, q.y, 0., 1.)`,
      ),
    )
    expect(over.diagnostics).toEqual([])
    expect(over.wgsl).toContain('let q = P(p.x, 9.0);')
    expect(over.glsl?.fragment).toContain('P q = P(p.x, 9.0);')
    agree(over, [1, 9, 0, 1])
    const alone = compile(
      file(
        P,
        `  const p: P = { x: 1., y: 2. }\n  const q: P = { ...p }\n  return vec4(q.x, q.y, 0., 1.)`,
      ),
    )
    expect(alone.diagnostics).toEqual([])
    expect(alone.wgsl).toContain('let q = P(p.x, p.y);')
    agree(alone, [1, 2, 0, 1])
  })

  it('later wins, over a written field and over an earlier spread', () => {
    const after = compile(
      file(
        P,
        `  const p: P = { x: 1., y: 2. }\n  const q: P = { y: 9., ...p }\n  return vec4(q.x, q.y, 0., 1.)`,
      ),
    )
    expect(after.diagnostics).toEqual([])
    expect(after.wgsl).toContain('let q = P(p.x, p.y);')
    agree(after, [1, 2, 0, 1])
    const two = compile(
      file(
        P,
        `  const p: P = { x: 1., y: 2. }\n  const r: P = { x: 5., y: 6. }\n  const q: P = { ...p, ...r, x: 7. }\n  return vec4(q.x, q.y, 0., 1.)`,
      ),
    )
    expect(two.diagnostics).toEqual([])
    expect(two.wgsl).toContain('let q = P(7.0, r.y);')
    agree(two, [7, 6, 0, 1])
  })

  it('takes the struct from the annotation, from the field names, and from a nested read', () => {
    // No annotation: the names the spread brings in are what matches the struct.
    const inferred = compile(
      file(
        P,
        `  const p: P = { x: 1., y: 2. }\n  const q = { ...p, y: 9. }\n  return vec4(q.x, q.y, 0., 1.)`,
      ),
    )
    expect(inferred.diagnostics).toEqual([])
    expect(inferred.wgsl).toContain('let q = P(p.x, 9.0);')
    agree(inferred, [1, 9, 0, 1])
    const nested = compile(
      file(
        `class Inner {
  a: f32
  b: f32
}
class Outer {
  i: Inner
  k: f32
}
`,
        `  const o: Outer = { i: { a: 1., b: 2. }, k: 3. }\n  const q: Inner = { ...o.i, b: 9. }\n  return vec4(q.a, q.b, o.k, 1.)`,
      ),
    )
    expect(nested.diagnostics).toEqual([])
    expect(nested.wgsl).toContain('let q = Inner(o.i.a, 9.0);')
    agree(nested, [1, 9, 3, 1])
  })

  it('fills part of a bigger struct, the rest written', () => {
    const r = compile(
      file(
        `class Small {
  x: f32
}
class Big {
  x: f32
  y: f32
}
`,
        `  const s: Small = { x: 1. }\n  const b: Big = { ...s, y: 2. }\n  return vec4(b.x, b.y, 0., 1.)`,
      ),
    )
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('let b = Big(s.x, 2.0);')
    agree(r, [1, 2, 0, 1])
  })
})

describe('what a spread has no form for', () => {
  it('a value with no fields', () => {
    expect(
      errorsOf(
        file(
          P,
          `  const v: vec2 = vec2(1., 2.)\n  const q: P = { ...v }\n  return vec4(q.x, q.y, 0., 1.)`,
        ),
      )[0],
    ).toBe(
      `${TS_CODES.UNSUPPORTED} "..." spreads the fields of a struct, and vec2<f32> has none. Write the components by name.`,
    )
  })

  it('a value that is not a plain read, since it is read once per field', () => {
    expect(
      errorsOf(
        file(
          `${P}function make(): P {
  return { x: 1., y: 2. }
}
`,
          `  const q: P = { ...make(), y: 9. }\n  return vec4(q.x, q.y, 0., 1.)`,
        ),
      )[0],
    ).toBe(
      `${TS_CODES.UNSUPPORTED} "..." reads its value once per field, so it takes a name or a field of one; this would run again for every field. Bind it to a const first.`,
    )
  })

  it('a field the target struct has not got', () => {
    expect(
      errorsOf(
        file(
          `class Small {
  x: f32
}
class Big {
  x: f32
  y: f32
}
`,
          `  const b: Big = { x: 1., y: 2. }\n  const s: Small = { ...b }\n  return vec4(s.x, 0., 0., 1.)`,
        ),
      )[0],
    ).toBe(`${TS_CODES.STRUCT_FIELD} Struct Small has no field "y", which this spread brings in.`)
  })

  it('and every other spread is still a runtime operation', () => {
    expect(
      errorsOf(
        file(
          `${P}function take(a: f32, b: f32): f32 {
  return a + b
}
`,
          `  const xs: array<f32, 2> = [1., 2.]\n  return vec4(take(...xs), 0., 0., 1.)`,
        ),
      )[0],
    ).toBe(`${TS_CODES.HOST_STMT} Spread is a JS runtime operation.`)
  })
})
