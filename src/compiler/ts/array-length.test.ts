// `arrayLength(xs)`, the explicit spelling of what `xs.length` reads on a runtime-sized storage
// array (#46, second half). What the operand may be is what WGSL's builtin accepts, measured on
// Tint: a pointer to a runtime-sized array in storage, the binding or a trailing struct field.
// `unsized-array-length.test.ts` covers the `.length` shapes; this file covers the call, the
// operand rules the two forms share, and what the CPU backends compute.

import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { compileTsSource } from './source-file.js'
import { TS_CODES } from './codes.js'
import { compileModule } from '../../core/oracle.js'
import { compileModuleJs } from '../../core/cpu-codegen.js'

const KERNEL = `"use typeshade"
declare const src: storage<array<f32>>
declare const dst: storage<array<f32>, "read_write">
@compute([64, 1, 1])
export function main_k(@builtin("global_invocation_id") gid: vec3u): void {
  if (gid.x >= arrayLength(src)) {
    return
  }
  dst[gid.x] = src[gid.x] * 2.
}
`

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`)

describe('arrayLength(xs)', () => {
  it('spells arrayLength(&xs) on WGSL and is a u32', () => {
    const r = compile(KERNEL)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('if ((gid.x >= arrayLength(&src))) {')
  })

  it('takes a trailing array field of a storage struct', () => {
    const r = compileTsSource(`"use typeshade"
class Buf { n: u32; xs: array<f32> }
declare const b: storage<Buf>
@fragment
export function fs(): vec4 { return vec4(f32(arrayLength(b.xs)), 0., 0., 1.) }
`)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.wgsl).toContain('arrayLength(&b.xs)')
  })

  it('follows a local that copies the binding', () => {
    const r = compileTsSource(`"use typeshade"
declare const src: storage<array<f32>>
@fragment
export function fs(): vec4 {
  const a = src
  return vec4(f32(arrayLength(a)), 0., 0., 1.)
}
`)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.wgsl).toContain('arrayLength(&src)')
  })

  it('refuses an element: the pointee must be the runtime-sized array', () => {
    // Tint: `arrayLength(&src[0])` has no matching call. The front end says what it got.
    expect(
      errorsOf(`"use typeshade"
declare const src: storage<array<f32>>
@fragment
export function fs(): vec4 { return vec4(f32(arrayLength(src[0])), 0., 0., 1.) }
`),
    ).toEqual([
      `${TS_CODES.TYPE_MISMATCH} arrayLength takes a runtime-sized storage array, not a f32.`,
    ])
  })

  it('refuses a sized array and names the size it has', () => {
    expect(
      errorsOf(`"use typeshade"
declare const src: storage<array<f32, 8>>
@fragment
export function fs(): vec4 { return vec4(f32(arrayLength(src)), 0., 0., 1.) }
`),
    ).toEqual([
      `${TS_CODES.TYPE_MISMATCH} arrayLength takes a runtime-sized array; this one has a fixed size of 8. Write 8, or read ".length".`,
    ])
  })

  it('refuses an unsized array outside storage with the fix that works for it', () => {
    const uniform = errorsOf(`"use typeshade"
declare const u: uniform<array<f32>>
@fragment
export function fs(): vec4 { return vec4(f32(arrayLength(u)), 0., 0., 1.) }
`)
    expect(uniform).toHaveLength(1)
    expect(uniform[0]).toContain(TS_CODES.UNSIZED_ARRAY_LENGTH)
    expect(uniform[0]).toContain('not in storage')
    expect(uniform[0]).toContain('array<f32, 3>')
    const param = errorsOf(`"use typeshade"
export function n(xs: array<f32>): u32 { return arrayLength(xs) }
`)
    expect(param).toHaveLength(1)
    expect(param[0]).toContain(TS_CODES.UNSIZED_ARRAY_LENGTH)
  })

  it('takes exactly one argument', () => {
    expect(
      errorsOf(`"use typeshade"
declare const src: storage<array<f32>>
@fragment
export function fs(): vec4 { return vec4(f32(arrayLength(src, 1)), 0., 0., 1.) }
`),
    ).toEqual([`${TS_CODES.ARITY_MISMATCH} arrayLength expects 1 argument, got 2.`])
  })

  it('a function the file declares with that name keeps winning the call', () => {
    // The additivity rule the §10 names follow: a new builtin name never changes what a program
    // that declared the name already meant.
    const r = compileTsSource(`"use typeshade"
function arrayLength(x: f32): f32 { return x * 2. }
@fragment
export function fs(): vec4 { return vec4(arrayLength(1.5), 0., 0., 1.) }
`)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.wgsl).toContain('fn arrayLength(x: f32) -> f32 {')
    expect(r.wgsl).toContain('arrayLength(1.5)')
    expect(r.wgsl).not.toContain('&')
  })

  it("the oracle and the CPU codegen read the bound buffer's length", () => {
    const r = compile(KERNEL)
    for (const make of [compileModule, compileModuleJs]) {
      const cm = make(r.module)
      const src = [1, 2, 3]
      const dst = [0, 0, 0, 0]
      cm.setBinding('src', src)
      cm.setBinding('dst', dst)
      for (let g = 0; g < 4; g++) cm.fns['main_k']!([g, 0, 0])
      // Three doubled, the fourth invocation guarded out by the length it read.
      expect(dst, make.name).toEqual([2, 4, 6, 0])
    }
  })

  it('the .length form and the call form lower to the same node', () => {
    const a = compile(KERNEL).wgsl
    const b = compile(KERNEL.replace('arrayLength(src)', 'src.length')).wgsl
    expect(b).toBe(a)
  })
})
