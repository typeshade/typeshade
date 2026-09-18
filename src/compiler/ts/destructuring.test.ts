// `const { x, y } = v` (roadmap 0.3 item T7, design #92, §14). A destructuring declaration is
// the reads it stands for, so it lowers to one declaration per name. Measured on `main` before
// this: every form was "TS8099 Destructuring is not supported". What is pinned here: the reads
// it emits from a vector and from a struct, the renaming and nesting forms, the value on the
// right being lowered once, `let` staying mutable, and the shapes that have no form with the
// read to write instead.

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
/** Both CPU paths on the module, with `u` bound when the program declares it. */
const agree = (r: ReturnType<typeof compile>, u: unknown, expected: number[]): void => {
  for (const make of [compileModule, compileModuleJs]) {
    const cm = make(r.module)
    if (u !== undefined) cm.setBinding('u', u as never)
    expect(cm.fns['fs']!([0.5, 0.25]), make.name).toEqual(expected)
  }
}

describe('a destructuring declaration is the reads it stands for', () => {
  it('reads a vector by component and a struct by field, renaming where asked', () => {
    const v = compile(file('', `  const { x, y: b } = uv\n  return vec4(x, b, 0., 1.)`))
    expect(v.diagnostics).toEqual([])
    expect(v.wgsl).toContain('let x = uv.x;')
    expect(v.wgsl).toContain('let b = uv.y;')
    agree(v, undefined, [0.5, 0.25, 0, 1])
    const s = compile(
      file(
        `class P {
  a: f32
  b: f32
}
declare const u: uniform<P>
`,
        `  const { a, b } = u\n  return vec4(a, b, 0., 1.)`,
      ),
    )
    expect(s.diagnostics).toEqual([])
    expect(s.wgsl).toContain('let a = u.a;')
    expect(s.glsl?.fragment).toContain('float a = u.a;')
    agree(s, { a: 3, b: 4 }, [3, 4, 0, 1])
  })

  it('lowers the value on the right once, and reads a bare name again for free', () => {
    const expr = compile(file('', `  const { x, y } = uv * 2.\n  return vec4(x, y, 0., 1.)`))
    expect(expr.diagnostics).toEqual([])
    // One local for the product, then the two reads off it.
    expect(expr.wgsl).toContain('let _d = (uv * 2.0);')
    expect(expr.wgsl).toContain('let x = _d.x;')
    expect(expr.wgsl).toContain('let y = _d.y;')
    agree(expr, undefined, [1, 0.5, 0, 1])
    // A bare name names no new local.
    expect(
      compile(file('', `  const { x } = uv\n  return vec4(x, 0., 0., 1.)`)).wgsl,
    ).not.toContain('_d')
  })

  it('names the value it binds internally, so two in a block and a declared _d all stand', () => {
    const two = compile(
      file(
        '',
        `  const { x } = uv * 2.\n  const { y } = uv * 4.\n  const _d = 1.\n` +
          `  return vec4(x, y, _d, 1.)`,
      ),
    )
    expect(two.diagnostics).toEqual([])
    expect(two.wgsl).toContain('let _d = (uv * 2.0);')
    expect(two.wgsl).toContain('let _d_1 = (uv * 4.0);')
    expect(two.wgsl).toContain('let x = _d.x;')
    expect(two.wgsl).toContain('let y = _d_1.y;')
    agree(two, undefined, [1, 1, 1, 1])
  })

  it('nests, takes a swizzle name, and keeps let mutable', () => {
    const nested = compile(
      file(
        `class Inner {
  a: f32
}
class Outer {
  i: Inner
  k: f32
}
declare const u: uniform<Outer>
`,
        `  const { i: { a }, k } = u\n  return vec4(a, k, 0., 1.)`,
      ),
    )
    expect(nested.diagnostics).toEqual([])
    expect(nested.wgsl).toContain('let a = u.i.a;')
    agree(nested, { i: { a: 5 }, k: 6 }, [5, 6, 0, 1])
    const sw = compile(file('', `  const { xy } = uv\n  return vec4(xy, 0., 1.)`))
    expect(sw.diagnostics).toEqual([])
    expect(sw.wgsl).toContain('let xy = uv.xy;')
    const mut = compile(file('', `  let { x, y } = uv\n  x = x + 1.\n  return vec4(x, y, 0., 1.)`))
    expect(mut.diagnostics).toEqual([])
    expect(mut.wgsl).toContain('var x: f32 = uv.x;')
    agree(mut, undefined, [1.5, 0.25, 0, 1])
  })
})

describe('what a pattern has no form for', () => {
  it('a default, a rest, and an annotation on the pattern', () => {
    expect(errorsOf(file('', `  const { x = 1. } = uv\n  return vec4(x, 0., 0., 1.)`))[0]).toBe(
      `${TS_CODES.UNSUPPORTED} A default in a pattern has no shader form: every field of a struct is present, so there is nothing for it to stand in for.`,
    )
    expect(
      errorsOf(
        file(
          `class P {\n  a: f32\n  b: f32\n}\ndeclare const u: uniform<P>\n`,
          `  const { a, ...r } = u\n  return vec4(a, 0., 0., 1.)`,
        ),
      )[0],
    ).toBe(
      `${TS_CODES.UNSUPPORTED} A rest element has no shader form: a struct is exactly its fields, so there is no remainder to name. Read the fields you need.`,
    )
    expect(errorsOf(file('', `  const { x, y }: vec2 = uv\n  return vec4(x, y, 0., 1.)`))[0]).toBe(
      `${TS_CODES.UNSUPPORTED} A destructuring declaration takes no type annotation; each name takes the type of the field it reads.`,
    )
  })

  it('an array pattern names the read to write instead, and an unknown field is named', () => {
    expect(errorsOf(file('', `  const [a, b] = uv\n  return vec4(a, b, 0., 1.)`))[0]).toBe(
      `${TS_CODES.UNSUPPORTED} A list is not destructured here: a vector is read by component (v.x, v.y) and an array by index (xs[0]). Write "const x = v.x" or "const a = xs[0]".`,
    )
    expect(
      errorsOf(file('', `  const { nope } = uv\n  return vec4(nope, 0., 0., 1.)`))[0],
    ).toContain("'n' is not a component")
  })
})
