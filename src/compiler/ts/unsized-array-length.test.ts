// === #46: `.length` on a runtime-sized array reads the buffer, or says why it cannot ===
//
// The bug this pins is the worst-behaved kind in this repository: it compiled with zero
// diagnostics, emitted valid WGSL, passed Tint, and ran on a real GPU producing NOTHING.
//
//   if (gid.x >= u32(src.length)) { return }     // authored
//   if ((gid.x >= 0u)) { return; }               // emitted, before #50
//
// `gid.x >= 0u` is true for every unsigned invocation, so the kernel returned at once and
// wrote nothing. `base.type.size ?? 0` was the whole of it: a runtime-sized array carries no
// `size`, and 0 is not a length — it is the absence of one. #50 made the storage shape a hard
// error; the second half of #46 gives it the read it wanted, `arrayLength(&src)`, a `u32`. The
// shapes that have no runtime length (a uniform array, a local, a parameter) stay refused with
// the one fix that works for them.
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

describe('#46 — a runtime-sized storage array reads its length from the buffer', () => {
  it('emits arrayLength(&src), never a folded 0', () => {
    const r = compileTsSource(KERNEL)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.wgsl).toContain('arrayLength(&src)')
    expect(r.wgsl).not.toContain('>= 0u')
  })

  it('is a u32, so the guard needs no cast', () => {
    const r = compileTsSource(KERNEL.replace('u32(src.length)', 'src.length'))
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.wgsl).toContain('if ((gid.x >= arrayLength(&src))) {')
  })

  it('bounds a for loop, emitted as arrayLength (Rule 7.5, #203)', () => {
    // Before #50 this emitted `(i < 0)`, a loop body that never ran, with zero diagnostics.
    // Then the length was a runtime value and the `for` rule refused it; a runtime bound is
    // now a counted loop, and the length reaches the header as the buffer's own.
    const r = compileTsSource(`"use typeshade";
declare const src: storage<array<f32>>;
declare let dst: storage<array<f32>>;
@compute([64, 1, 1])
export function main_k(@builtin("global_invocation_id") gid: vec3u): void {
  for (let i: u32 = 0; i < src.length; i++) { dst[gid.x] = dst[gid.x] + src[i] }
}
`)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    // licm reads the length once, ahead of the loop, since nothing in the body resizes it.
    expect(r.wgsl).toContain('let _licm0 = arrayLength(&src);')
    expect(r.wgsl).toContain('for (var i: u32 = 0u; (i < _licm0); i = (i + 1u)) {')
  })

  it('a storage array read WITHOUT .length still compiles and emits', () => {
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
  // a uniform author sends them to an intrinsic Tint would refuse on their program. Those three
  // were already invalid GPU code before this check; only the advice has to be true.
  // This suite is about ONE code's message. A program may earn a second, independent
  // diagnostic — `declare const u: uniform<array<f32>>` is also a runtime-sized array in the
  // uniform address space, which WGSL refuses outright (`TS8051`, §51) — so the helper picks
  // the code under test rather than demanding the program have exactly one problem.
  const messageFor = (src: string): string => {
    const errors = compileTsSource(src).diagnostics.filter((d) => d.category === 'error')
    const mine = errors.filter((d) => d.code === TS_CODES.UNSIZED_ARRAY_LENGTH)
    expect(
      mine,
      `expected one ${TS_CODES.UNSIZED_ARRAY_LENGTH}, got: ${errors.map((d) => `${d.code ?? '—'} ${d.message}`).join(' | ')}`,
    ).toHaveLength(1)
    return mine[0]!.message
  }

  it('a field of a storage binding reads its length too — the root is what decides', () => {
    const r = compileTsSource(`"use typeshade";
class Buf { n: u32; xs: array<f32> }
declare const b: storage<Buf>;
@fragment
export function fs(): vec4 { return vec4(f32(b.xs.length), 0., 0., 1.) }
`)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.wgsl).toContain('arrayLength(&b.xs)')
  })

  it('a local that copies the binding denotes the binding', () => {
    // `storageRooted` once stopped at the local and told the author to size an array they could
    // not size. The alias is followed to what it copies.
    const r = compileTsSource(`"use typeshade";
declare const src: storage<array<f32>>;
@fragment
export function fs(): vec4 {
  const a = src
  const c = a
  return vec4(f32(c.length), 0., 0., 1.)
}
`)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.wgsl).toContain('arrayLength(&src)')
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
    const src = `"use typeshade";
declare const u: uniform<array<f32>>;
@fragment
export function fs(): vec4 { return vec4(f32(u.length), 0., 0., 1.) }
`
    const m = messageFor(src)
    expect(m).toContain('array<f32, 3>')
    expect(m).not.toContain('arrayLength')
    // The diagnostic underlines the `.length` read, not the whole statement.
    const d = compileTsSource(src).diagnostics.find((x) => x.code === TS_CODES.UNSIZED_ARRAY_LENGTH)
    expect(d).toBeDefined()
    expect(src.slice(d!.start, d!.start + d!.length)).toBe('u.length')
  })

  it('a parameter is told to give it a size', () => {
    const m = messageFor(`"use typeshade";
export function n(xs: array<f32>): i32 { return xs.length }
`)
    expect(m).toContain('array<f32, 3>')
    expect(m).not.toContain('arrayLength')
  })
})

describe('#46 — a sized array keeps the compile-time length it always had', () => {
  it('a fixed-size array literal', () => {
    const r = compileTsSource(`"use typeshade";
@fragment
export function fs(): vec4 {
  const xs: array<f32, 4> = [1., 2., 3., 4.]
  return vec4(f32(xs.length), 0., 0., 1.)
}
`)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
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
    expect(r.wgsl).not.toContain('arrayLength')
  })
})
