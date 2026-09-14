// === #46 (first half): `.length` on a runtime-sized array is an error, never a folded 0 ===
//
// The bug this pins is the worst-behaved kind in this repository: it compiled with zero
// diagnostics, emitted valid WGSL, passed Tint, and ran on a real GPU producing NOTHING.
//
//   if (gid.x >= u32(src.length)) { return }     // authored
//   if ((gid.x >= 0u)) { return; }               // emitted
//
// `gid.x >= 0u` is true for every unsigned invocation, so the kernel returned at once and
// wrote nothing. `base.type.size ?? 0` was the whole of it: a runtime-sized array carries no
// `size`, and 0 is not a length — it is the absence of one.
//
// `examples/PORTING.md` predicted this under "Hazards a twin will hit that are not blockers"
// before anyone hit it, which is why it is worth a test that states the emitted text.

import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import { TS_CODES } from './codes.js'

const KERNEL = `"use typeshade";
declare const src: storage<array<f32>>;
declare let dst: storage<array<f32>>;
@compute([64, 1, 1])
export function main_k(@builtin("global_invocation_id") gid: vec3u): void {
  if (gid.x >= u32(src.length)) { return }
  dst[gid.x] = src[gid.x] * 2.
}
`

describe('#46 — a runtime-sized array has no compile-time length', () => {
  it('reports it rather than folding 0', () => {
    const r = compileTsSource(KERNEL)
    const errors = r.diagnostics.filter((d) => d.category === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]?.code).toBe(TS_CODES.UNSIZED_ARRAY_LENGTH)
    // The message has to carry the way out, because there is no spelling for it yet.
    expect(errors[0]?.message).toContain('arrayLength')
  })

  it('emits nothing — the point is that this kernel never reaches a GPU', () => {
    // Before: a complete, valid, Tint-accepted module whose guard was `gid.x >= 0u`.
    expect(compileTsSource(KERNEL).wgsl).toBeUndefined()
  })

  it('the diagnostic underlines the `.length` read, not the whole statement', () => {
    // This replaced a `not.toContain('>= 0u')` assertion that ran after `wgsl` was already
    // asserted undefined — it could not fail while the arm above passed. The span is the thing
    // nothing else pins.
    const d = compileTsSource(KERNEL).diagnostics.filter((x) => x.category === 'error')[0]
    expect(d).toBeDefined()
    expect(KERNEL.slice(d!.start, d!.start + d!.length)).toBe('src.length')
  })

  it('the for-loop shape too — it emitted a loop body that never ran', () => {
    // `for (let i: i32 = 0; i < src.length; i++)` emitted `(i < 0)` on main: zero diagnostics,
    // valid WGSL, a loop that never executes. Same silent class as the `>= 0u` guard.
    const r = compileTsSource(`"use typeshade";
declare const src: storage<array<f32>>;
declare let dst: storage<array<f32>>;
@compute([64, 1, 1])
export function main_k(@builtin("global_invocation_id") gid: vec3u): void {
  for (let i: i32 = 0; i < src.length; i++) { dst[gid.x] = src[gid.x] }
}
`)
    const errors = r.diagnostics.filter((d) => d.category === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]?.code).toBe(TS_CODES.UNSIZED_ARRAY_LENGTH)
    expect(r.wgsl).toBeUndefined()
  })

  it('a storage array read WITHOUT .length still compiles and emits', () => {
    // The error is about `.length`, not about runtime-sized storage: a kernel that indexes the
    // buffer without asking its length is unaffected, and most of the corpus does exactly that.
    const r = compileTsSource(`"use typeshade";
declare const src: storage<array<f32>>;
declare let dst: storage<array<f32>>;
@compute([64, 1, 1])
export function main_k(@builtin("global_invocation_id") gid: vec3u): void {
  dst[gid.x] = src[gid.x] * 2.
}
`)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.wgsl).toContain('dst[gid.x]')
  })
})

describe('#46 — the message tells each shape the truth about its own fix', () => {
  // The guard is `base.type.size === undefined`, which is four shapes, not one. `arrayLength`
  // takes `ptr<storage, array<E>, AM>` and exists for nothing else, so naming it to a local or
  // a uniform author sends them to an intrinsic Tint would refuse on their program. All four
  // were already invalid GPU code before this check; only the advice has to be true.
  const messageFor = (src: string): string => {
    const errors = compileTsSource(src).diagnostics.filter((d) => d.category === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]?.code).toBe(TS_CODES.UNSIZED_ARRAY_LENGTH)
    return errors[0]!.message
  }

  it('a storage binding is told about arrayLength', () => {
    expect(messageFor(KERNEL)).toContain('arrayLength')
  })

  it('a field of a storage binding is too — the root is what decides', () => {
    expect(
      messageFor(`"use typeshade";
class Buf { xs: array<f32> }
declare const b: storage<Buf>;
@fragment
export function fs(): vec4 { return vec4(f32(b.xs.length), 0., 0., 1.) }
`),
    ).toContain('arrayLength')
  })

  it('a local array with no N is told to give it a size', () => {
    const m = messageFor(`"use typeshade";
@fragment
export function fs(): vec4 {
  const xs = array<f32>(1., 2., 3.)
  return vec4(f32(xs.length), 0., 0., 1.)
}
`)
    expect(m).toContain('array<f32, 3>')
    expect(m).not.toContain('arrayLength')
  })

  it('a uniform array is told to give it a size, NOT about arrayLength', () => {
    // Tint on the merge base: `var<uniform> u: array<f32>;` is "runtime-sized arrays can only
    // be used in the <storage> address space". `arrayLength` would not help this author.
    const m = messageFor(`"use typeshade";
declare const u: uniform<array<f32>>;
@fragment
export function fs(): vec4 { return vec4(f32(u.length), 0., 0., 1.) }
`)
    expect(m).toContain('array<f32, 3>')
    expect(m).not.toContain('arrayLength')
  })

  it('a parameter is told to give it a size', () => {
    const m = messageFor(`"use typeshade";
export function n(xs: array<f32>): i32 { return xs.length }
@fragment
export function fs(): vec4 { return vec4(0., 0., 0., 1.) }
`)
    expect(m).toContain('array<f32, 3>')
    expect(m).not.toContain('arrayLength')
  })
})

describe('#46 — a SIZED array still folds its length, exactly as before', () => {
  it('a fixed-size array literal', () => {
    const r = compileTsSource(`"use typeshade";
@fragment
export function fs(): vec4 {
  const xs = array<f32, 4>(1., 2., 3., 4.)
  return vec4(f32(xs.length), 0., 0., 1.)
}
`)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    // The whole folded expression, not just `4.0`: `xs` is dead-code-eliminated in this
    // shader, so a bare `toContain('4.0')` would pass on almost any emit.
    expect(r.wgsl).toContain('vec4<f32>(4.0, 0.0, 0.0, 1.0)')
  })

  it('a sized storage binding keeps its length', () => {
    const r = compileTsSource(`"use typeshade";
declare const src: storage<array<f32, 8>>;
declare let dst: storage<array<f32, 8>>;
@compute([64, 1, 1])
export function main_k(@builtin("global_invocation_id") gid: vec3u): void {
  if (gid.x >= u32(src.length)) { return }
  dst[gid.x] = src[gid.x] * 2.
}
`)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    // The guard is real here: 8 is the declared length, not a stand-in for a missing one.
    expect(r.wgsl).toContain('>= 8u')
  })
})
