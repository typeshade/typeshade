// The deprecation window before an integer-written literal types as i32 (§13, #148).
//
// STEP ONE ONLY, which is the whole of this change: the diagnostic exists, it is off by
// default, and the default typing has not moved. The flip is a breaking change to every module
// that leans on `let i = 0` being an `f32`, and it gets its own release, its own golden review
// and its own entry.

import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { TS_CODES } from './codes.js'

const SRC = `"use typeshade";
export function f(xs: array<f32, 4>): f32 {
  let i = 0;
  const K = 5;
  const n = 2 + 3;
  let x = 5.;
  let y: f32 = 7;
  return xs[i32(i)] + K + f32(n) + x + y;
}`

const warnings = (source: string, deprecations: boolean) =>
  compile(source, { deprecations }).diagnostics.filter((d) => d.category === 'warning')

describe('the integer-literal deprecation, behind its flag', () => {
  it('says nothing at all by default', () => {
    expect(warnings(SRC, false)).toEqual([])
    // And nothing is an error either: the program compiles today exactly as it did.
    expect(compile(SRC).diagnostics.filter((d) => d.category === 'error')).toEqual([])
  })

  it('names the declaration and the fix while the flag is on', () => {
    const found = warnings(SRC, true)
    expect(found.map((d) => d.code)).toEqual([
      TS_CODES.INT_LITERAL_DEPRECATION,
      TS_CODES.INT_LITERAL_DEPRECATION,
      TS_CODES.INT_LITERAL_DEPRECATION,
    ])
    expect(found[0]!.message).toBe(
      '"i" is written as an integer and types as f32 today; it will type as i32 ' +
        '(§13, #148). Write "i = 0." to keep f32, or leave it and take i32.',
    )
    // A TREE of integer literals has no one-character fix, so it is told to annotate.
    expect(found[2]!.message).toContain('Annotate it — "n: f32 = 2 + 3"')
    // It points at the declaration the author wrote, not at the file.
    expect(found.map((d) => d.line)).toEqual([3, 4, 5])
  })

  it('leaves a float-written literal and an annotated declaration alone', () => {
    // `let x = 5.` is an f32 today and an f32 after the flip; `let y: f32 = 7` declares its
    // type, so the literal is already decided and the flip does not move it.
    for (const name of ['"x"', '"y"']) {
      expect(
        warnings(SRC, true).some((d) => d.message.includes(name)),
        name,
      ).toBe(false)
    }
  })

  it('moves no emitted byte, which is what makes it safe to turn on', () => {
    const off = compile(SRC)
    const on = compile(SRC, { deprecations: true })
    expect(on.wgsl).toBe(off.wgsl)
    expect(on.glsl).toEqual(off.glsl)
  })

  it('reaches a module-scope const as well as a local', () => {
    const found = warnings(
      `"use typeshade";
const LEVELS = 4;
export function f(): f32 { return LEVELS; }`,
      true,
    )
    expect(found).toHaveLength(1)
    expect(found[0]!.message).toContain('"LEVELS"')
  })
})
