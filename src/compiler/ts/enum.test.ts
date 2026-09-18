// `enum` and `const enum` (roadmap 0.3 item T1, design #92, §12). A numeric enum is a set of
// named integer constants, which is a shape the language already had: each member is the module
// constant `Enum_Member`. Measured on `main` before this: an enum was TS8014 "Unsupported
// top-level "EnumDeclaration"", followed by an unknown identifier at every use. What is pinned
// here: the values TypeScript's own rule gives (auto-increment, explicit initializers,
// arithmetic over earlier members), the name as a type, the constants on both targets and both
// CPU paths, and the refusals that say why.

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
/** Both CPU paths on the module, which must agree with each other and with `expected`. */
const agree = (r: ReturnType<typeof compile>, expected: number[]): void => {
  for (const make of [compileModule, compileModuleJs]) {
    expect(make(r.module).fns['fs']!([0.5, 0.5]), make.name).toEqual(expected)
  }
}

describe('an enum member is a module constant', () => {
  it('counts from zero, and a const enum is the same', () => {
    const r = compile(
      file(
        `enum Mode {
  Flat,
  Shaded,
  Wire,
}
`,
        `  return vec4(f32(Mode.Flat), f32(Mode.Shaded), f32(Mode.Wire), 1.)`,
      ),
    )
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('const Mode_Flat: i32 = 0;')
    expect(r.wgsl).toContain('const Mode_Shaded: i32 = 1;')
    expect(r.wgsl).toContain('const Mode_Wire: i32 = 2;')
    expect(r.glsl?.fragment).toContain('const int Mode_Shaded = 1;')
    agree(r, [0, 1, 2, 1])
    const c = compile(
      file(
        `const enum Mode {\n  Flat = 2,\n  Shaded,\n}\n`,
        `  return vec4(f32(Mode.Shaded), 0., 0., 1.)`,
      ),
    )
    expect(c.diagnostics).toEqual([])
    expect(c.wgsl).toContain('const Mode_Shaded: i32 = 3;')
  })

  it('takes a bit flag, which is what a numeric enum is usually for', () => {
    const r = compile(
      file(
        `enum Flag {
  None = 0,
  Lit = 1 << 0,
  Shadow = 1 << 1,
  Both = Lit | Shadow,
  Next = 9,
}
`,
        `  return vec4(f32(Flag.Lit), f32(Flag.Shadow), f32(Flag.Both), f32(Flag.Next))`,
      ),
    )
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('const Flag_Both: i32 = 3;')
    agree(r, [1, 2, 3, 9])
  })

  it('a member may name one declared before it, and the count resumes from it', () => {
    const r = compile(
      file(
        `enum E {\n  A = 2,\n  B = A * 3,\n  C,\n}\n`,
        `  return vec4(f32(E.B), f32(E.C), 0., 1.)`,
      ),
    )
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('const E_B: i32 = 6;')
    expect(r.wgsl).toContain('const E_C: i32 = 7;')
    agree(r, [6, 7, 0, 1])
    // The bare name is the enum body's alone, as in TypeScript.
    expect(errorsOf(file(`enum E {\n  A = 2,\n}\n`, `  return vec4(f32(A), 0., 0., 1.)`))[0]).toBe(
      `${TS_CODES.UNKNOWN_NAME} Unknown identifier "A".`,
    )
  })

  it('the enum name is an i32 wherever a type stands, and a member bounds a loop', () => {
    const r = compile(
      file(
        `enum Mode {
  Flat,
  Shaded,
}
enum N {
  Count = 1 << 2,
}
function shade(m: Mode): f32 {
  switch (m) {
    case Mode.Flat: {
      return 0.25
    }
    case Mode.Shaded: {
      return 0.75
    }
    default: {
      return 0.
    }
  }
}
`,
        `  let s: f32 = 0.
  for (let i: i32 = 0; i < N.Count; i++) {
    s = s + shade(Mode.Shaded)
  }
  return vec4(s, 0., 0., 1.)`,
      ),
    )
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('fn shade(m: i32) -> f32 {')
    expect(r.wgsl).toContain('(i < N_Count)')
    agree(r, [3, 0, 0, 1])
  })
})

describe('what an enum still does not do', () => {
  it('a string member has no GPU type, and says what to write instead', () => {
    expect(errorsOf(file(`enum Name {\n  A = "a",\n}\n`, `  return vec4(1., 0., 0., 1.)`))[0]).toBe(
      `${TS_CODES.TYPE_MISMATCH} Enum member "Name.A" has a string value, which no GPU type holds. A numeric enum member is an i32 constant; give it a number, or drop the value and take the position.`,
    )
  })

  it('a value this cannot compute, one outside an i32, and a declare enum', () => {
    expect(
      errorsOf(file(`enum E {\n  A = 3.5,\n}\n`, `  return vec4(1., 0., 0., 1.)`))[0],
    ).toContain('needs a value this can compute')
    expect(
      errorsOf(file(`enum E {\n  A = 3000000000,\n}\n`, `  return vec4(1., 0., 0., 1.)`))[0],
    ).toBe(
      `${TS_CODES.TYPE_MISMATCH} Enum member "E.A" is 3000000000, which is outside an i32's [-2147483648, 2147483647].`,
    )
    expect(
      errorsOf(file(`declare enum Mode {\n  Flat,\n}\n`, `  return vec4(1., 0., 0., 1.)`))[0],
    ).toBe(
      `${TS_CODES.TOP_LEVEL} "declare enum Mode" has no members to emit; declare the enum in this file.`,
    )
  })

  it('an unknown member is named as one', () => {
    expect(
      errorsOf(file(`enum Mode {\n  Flat,\n}\n`, `  return vec4(f32(Mode.Nope), 0., 0., 1.)`))[0],
    ).toBe(`${TS_CODES.UNKNOWN_NAME} "Mode" has no member "Nope".`)
  })
})
