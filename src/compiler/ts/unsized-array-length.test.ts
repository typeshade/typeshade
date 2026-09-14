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
    expect(errors[0]?.code).toBe('TS8032')
    // The message has to carry the way out, because there is no spelling for it yet.
    expect(errors[0]?.message).toContain('arrayLength')
  })

  it('emits nothing — the point is that this kernel never reaches a GPU', () => {
    // Before: a complete, valid, Tint-accepted module whose guard was `gid.x >= 0u`.
    expect(compileTsSource(KERNEL).wgsl).toBeUndefined()
  })

  it('the guard that used to fold away is the one that is now rejected', () => {
    const r = compileTsSource(KERNEL)
    expect(r.wgsl ?? '').not.toContain('>= 0u')
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
    // 4, folded — the length IS known here, and nothing about that changes.
    expect(r.wgsl).toContain('4.0')
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
