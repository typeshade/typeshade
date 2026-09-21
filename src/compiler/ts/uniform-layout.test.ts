// The WGSL uniform layout rules (§51, #156) — the BLOCKER the spec audit called L15.
//
// A `uniform` buffer's array elements must start on 16-byte boundaries. The compiler emitted
// `array<f32, 4>` into a `var<uniform>` struct with zero diagnostics, while `reflect()` had
// always reported that array at stride 16 — so the emit and the reflection described different
// bytes, and GLSL ES 3.00's std140 block linked on WebGL2 with the layout reflect() described.
//
// THIS FILE RUNS IN NODE. It asserts the emitted text and `reflect()`; it launches no browser
// and calls no WebGPU. The real-compiler half was hand-measured on Chromium 141
// (`chromium_headless_shell-1194`), which lacks the optional `uniform_buffer_standard_layout`
// language feature and therefore refuses the unpadded module with `'uniform' storage requires
// that array elements are aligned to 16 bytes…`, and which reports the emitted struct's
// offsets as the ones `reflect()` gives. Chromium 153 — what `gate:compile` launches with no
// `TYPESHADE_CHROMIUM`, and what CI installs — HAS that feature and accepts the unpadded form,
// so the compile gate is not what pins this. These assertions are.
//
// The other half is the rules a struct HIDES, which the type map cannot see and the backend
// meets only as emitted text: a `bool` field, an empty list, and the two runtime-array rules.

import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { compileTsSource } from './source-file.js'
import { TS_CODES } from './codes.js'
import { reflect } from '../../core/reflect.js'

function compiled(source: string) {
  const c = compile(`"use typeshade"\n${source}`)
  expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([])
  return c
}

function diagnose(source: string): { code?: string; message: string } {
  const r = compileTsSource(`"use typeshade"\n${source}`)
  const first = r.diagnostics.find((d) => d.category === 'error')
  expect(first, 'expected a diagnostic, got none').toBeDefined()
  return { code: first!.code, message: first!.message }
}

const SCALAR_ARRAY = `interface U { xs: array<f32, 4>; k: f32 }
declare const U_: uniform<U>
@fragment
export function fs(): vec4 { return vec4(U_.xs[1] * U_.k) }`

describe('a uniform array is padded to a 16-byte element stride', () => {
  it('pads a scalar array in a uniform to stride 16 and reflect() agrees', () => {
    const c = compiled(SCALAR_ARRAY)
    // The wrapper struct, and the member that now holds it.
    expect(c.wgsl).toContain('struct _Pad16_f32 {\n  @size(16) v: f32,\n}')
    expect(c.wgsl).toContain('@align(16) xs: array<_Pad16_f32, 4>,')
    // …and every read through it reaches one field deeper.
    expect(c.wgsl).toContain('U_.xs[1].v')
    expect(c.wgsl).not.toContain('U_.xs[1] ')
    // 4 elements × 16 + an f32 = 68, rounded to the struct's 16-byte alignment.
    const u = reflect(c.module).uniforms[0]!
    expect(u.size).toBe(80)
    expect(u.fields.map((f) => [f.name, f.offset, f.size])).toEqual([
      ['xs', 0, 64],
      ['k', 64, 4],
    ])
  })

  it('aligns the member as well as the element, so a scalar may precede the array', () => {
    // The half a wrapper cannot supply. A struct's alignment comes from its members, and
    // `@size` does not raise it, so with the stride alone the array lands at offset 4 — which
    // is exactly the offset `reflect()` does NOT report. With `@align(16)` it sits at 16 on
    // Chromium 141's own layout note, which is what reflect has always said.
    const c = compiled(`interface U { k: f32; xs: array<f32, 3> }
declare const U_: uniform<U>
@fragment
export function fs(): vec4 { return vec4(U_.k * U_.xs[2]) }`)
    expect(c.wgsl).toContain('@align(16) xs: array<_Pad16_f32, 3>,')
    const u = reflect(c.module).uniforms[0]!
    expect(u.fields.map((f) => [f.name, f.offset])).toEqual([
      ['k', 0],
      ['xs', 16],
    ])
    expect(u.size).toBe(64)
  })

  it('pads a struct element whose own stride is under 16, and sizes the wrapper after it', () => {
    // A struct's alignment is the max of its members', not 16 — the 16-byte round-up belongs
    // to the address space. Reading it as 16 let `array<{a: f32, b: f32}, 3>` through with a
    // stride of 8. And the wrapper's `@size` must be computed from the element AS EMITTED:
    // with `Item` holding a padded array of its own, sizing the wrapper from the authored
    // `Item` gave `@size(16)` over a 48-byte type, which BOTH Chromium builds reject with
    // `'@size' must be at least as big as the type's size (48)`.
    const flat = compiled(`interface P { a: f32; b: f32 }
interface U { ps: array<P, 3>; k: f32 }
declare const U_: uniform<U>
@fragment
export function fs(): vec4 { return vec4(U_.ps[1].a * U_.k) }`)
    expect(flat.wgsl).toContain('@size(16) v: P,')
    expect(flat.wgsl).toContain('@align(16) ps: array<_Pad16_struct_P, 3>,')
    expect(flat.wgsl).toContain('U_.ps[1].v.a')
    expect(reflect(flat.module).uniforms[0]!.fields.map((f) => [f.name, f.offset])).toEqual([
      ['ps', 0],
      ['k', 48],
    ])

    // …and a struct that has already grown to a multiple of 16 needs no wrapper at all.
    const nested = compiled(`interface Item { xs: array<f32, 2>; n: f32 }
interface U { items: array<Item, 2>; k: f32 }
declare const U_: uniform<U>
@fragment
export function fs(): vec4 { return vec4(U_.items[1].xs[0] * U_.k) }`)
    expect(nested.wgsl).toContain('items: array<Item, 2>,')
    expect(nested.wgsl).not.toContain('_Pad16_struct_Item')
    expect(nested.wgsl).toContain('@align(16) xs: array<_Pad16_f32, 2>,')
    expect(reflect(nested.module).uniforms[0]!.fields.map((f) => [f.name, f.offset])).toEqual([
      ['items', 0],
      ['k', 96],
    ])
  })

  it('pads a vec2 array too, and leaves a vec4 array alone', () => {
    // vec2 is 8 bytes, so its natural stride is 8 and the uniform rule rounds it to 16. vec4
    // is already 16, so it needs no wrapper — which is what keeps this from padding
    // everything in sight.
    const c = compiled(`interface U { ws: array<vec2, 3>; vs: array<vec4, 2> }
declare const U_: uniform<U>
@fragment
export function fs(): vec4 { return U_.vs[1] * U_.ws[2].x }`)
    expect(c.wgsl).toContain('struct _Pad16_vec2_f32_ {\n  @size(16) v: vec2<f32>,\n}')
    expect(c.wgsl).toContain('@align(16) ws: array<_Pad16_vec2_f32_, 3>,')
    expect(c.wgsl).toContain('vs: array<vec4<f32>, 2>,')
    expect(c.wgsl).toContain('U_.ws[2].v.x')
    expect(c.wgsl).not.toContain('_Pad16_vec4')
  })

  it('leaves a storage array unpadded, where WGSL has no such rule', () => {
    // std430 uses the natural stride, so padding a storage buffer would move every byte the
    // host packs for no reason. The rule is the uniform address space's alone.
    const c = compiled(`interface S { xs: array<f32, 4> }
declare const S_: storage<S>
@fragment
export function fs(): vec4 { return vec4(S_.xs[1]) }`)
    expect(c.wgsl).toContain('xs: array<f32, 4>,')
    expect(c.wgsl).not.toContain('_Pad16')
    expect(reflect(c.module).storage[0]!.size).toBe(16)
  })

  it('leaves a uniform with no array byte-identical', () => {
    const c = compiled(`interface U { k: f32; v: vec4 }
declare const U_: uniform<U>
@fragment
export function fs(): vec4 { return U_.v * U_.k }`)
    expect(c.wgsl).not.toContain('_Pad16')
    expect(c.wgsl).toContain('struct U {\n  k: f32,\n  v: vec4<f32>,\n}')
  })

  it('leaves the GLSL std140 block as it was', () => {
    // GLSL ES 3.00 gives `float[4]` a 16-byte stride natively, which is why the program Tint
    // refuses links on WebGL2. The wrapper is a WGSL-only lowering and must not reach here.
    const c = compiled(SCALAR_ARRAY)
    expect(c.glsl!.fragment).toContain('float[4] xs;')
    expect(c.glsl!.fragment).not.toContain('_Pad16')
    expect(c.glsl!.fragment).toContain('U_.xs[1]')
  })
})

describe('a padded array reached any other way keeps the type the author wrote', () => {
  const U = `interface U { xs: array<f32, 4>; k: f32 }
declare const U_: uniform<U>`

  it.each([
    [
      'an alias',
      `@fragment export function fs(): vec4 { const w = U_.xs; return vec4(w[1] * U_.k) }`,
    ],
    [
      'a helper argument',
      `export function pick(a: array<f32, 4>): f32 { return a[2] }
@fragment export function fs(): vec4 { return vec4(pick(U_.xs) * U_.k) }`,
    ],
    [
      'a helper return',
      `export function grab(): array<f32, 4> { return U_.xs }
@fragment export function fs(): vec4 { return vec4(grab()[1] * U_.k) }`,
    ],
  ])('materialises the array where it is used as a value: %s', (_what, body) => {
    // The member's ELEMENT type changed, so the padded array must not leak into a local, an
    // argument or a return — Tint answers `no matching overload for 'operator + (_Pad16_f32,
    // _Pad16_f32)'` and `expected 'array<f32, 4>', got 'array<_Pad16_f32, 4>'`. Rebuilding
    // the authored array from its elements costs the loads the copy was going to do anyway.
    const c = compiled(`${U}\n${body}`)
    expect(c.wgsl).toContain('array<f32, 4>(U_.xs[0].v, U_.xs[1].v, U_.xs[2].v, U_.xs[3].v)')
    expect(c.wgsl).not.toMatch(/let \w+ = U_\.xs;/)
  })

  it('wraps each element when the struct is built by value', () => {
    const c = compiled(`interface U { k: f32; xs: array<f32, 2> }
declare const U_: uniform<U>
export function mk(): U { return { k: 1., xs: [0., 1.] } }
@fragment export function fs(): vec4 { return vec4(mk().xs[1] + U_.k) }`)
    expect(c.wgsl).toContain('_Pad16_f32(')
    expect(c.wgsl).toContain('mk().xs[1].v')
  })
})

describe('what the padding cannot reach is refused, not emitted', () => {
  it.each([
    [
      'a list of lists',
      `interface U { g: array<array<f32, 2>, 3> }
declare const U_: uniform<U>
@fragment export function fs(): vec4 { return vec4(U_.g[1][0]) }`,
      /list of lists would need that at both levels/,
    ],
    [
      'a bare list as the whole uniform',
      `declare const U_: uniform<array<f32, 4>>
@fragment export function fs(): vec4 { return vec4(U_[1]) }`,
      /a bare list has no member to carry that/,
    ],
    [
      'one struct bound to both address spaces',
      `interface U { xs: array<f32, 4> }
declare const A_: uniform<U>
declare const B_: storage<U>
@fragment export function fs(): vec4 { return vec4(A_.xs[1] + B_.xs[2]) }`,
      /bound as a uniform AND as storage/,
    ],
  ])('refuses %s', (_what, source, match) => {
    // Each is a shape the emit could only get wrong: the first has two levels to pad and one
    // place to put an attribute, the second has no member at all (and `reflect().uniforms` is
    // empty for it), and the third would move the bytes a host packs for the storage half,
    // which `reflect()` still reports unpadded. Each was measured as Tint-refused before.
    const r = compileTsSource(`"use typeshade"\n${source}`)
    const d = r.diagnostics.find((x) => x.category === 'error')
    expect(d?.message, `expected a refusal for ${_what}`).toMatch(match)
  })

  it('leaves the shapes that need no padding alone', () => {
    // A list of vec4 is already 16 bytes an element, bare or in a struct, so none of the
    // refusals above may fire for it — that is what keeps them from being a blanket ban.
    const bare = compiled(`declare const U_: uniform<array<vec4, 4>>
@fragment export function fs(): vec4 { return U_[1] }`)
    expect(bare.wgsl).toContain('var<uniform> U_: array<vec4<f32>, 4>;')
    expect(bare.wgsl).not.toContain('_Pad16')
  })
})

describe('the rules a struct hides from the type map', () => {
  it.each([
    [
      'a bool in a uniform struct',
      `interface U { flag: bool; k: f32 }
declare const U_: uniform<U>
@fragment export function fs(): vec4 { return vec4(U_.k) }`,
      TS_CODES.LAYOUT,
      '"U.flag" is a bool; a uniform struct holds numeric scalars only ' +
        "(WGSL's host-shareable rule). Use u32.",
    ],
    [
      'a bool in a storage struct',
      `interface S { flag: bool }
declare let S_: storage<array<S>>
@compute export function cs(@builtin("global_invocation_id") g: vec3u): void {
  S_[g.x].flag = true
}`,
      TS_CODES.LAYOUT,
      '"S.flag" is a bool; a storage struct holds numeric scalars only ' +
        "(WGSL's host-shareable rule). Use u32.",
    ],
    [
      'a runtime array that is not last',
      `interface S { xs: array<f32>; k: f32 }
declare const S_: storage<S>
@fragment export function fs(): vec4 { return vec4(S_.k) }`,
      TS_CODES.LAYOUT,
      '"S.xs" is a list of no fixed length and is not the last field of "S": nothing after ' +
        'it has an offset. Move it last, or give it a length.',
    ],
    [
      'a runtime array in a uniform',
      `interface U { xs: array<f32> }
declare const U_: uniform<U>
@fragment export function fs(): vec4 { return vec4(U_.xs[0]) }`,
      TS_CODES.LAYOUT,
      '"U.xs" is a list of no fixed length, which a uniform cannot hold: a uniform buffer ' +
        'has one size. Give it a length, array<T, N>, or declare "U_" as storage<T>.',
    ],
    [
      'an empty list',
      `interface U { xs: array<f32, 0> }
declare const U_: uniform<U>
@fragment export function fs(): vec4 { return vec4(U_.xs[0]) }`,
      TS_CODES.UNKNOWN_TYPE,
      "array<T, 0> is not a list. A list's length is a whole number of 1 or more; a list " +
        'whose length the shader does not know is array<T> in storage.',
    ],
  ])('refuses %s in one sentence', (_what, source, code, message) => {
    const d = diagnose(source)
    expect(d.code).toBe(code)
    expect(d.message).toBe(message)
  })

  it('keeps the shapes the rules allow', () => {
    // A runtime array LAST in a storage struct, and a bool everywhere a bool is fine: a local,
    // a parameter and an entry's own return. The rules are about host-shared BYTES.
    const c = compiled(`interface S { k: f32; xs: array<f32> }
declare const S_: storage<S>
export function pick(on: bool): f32 { return on ? 1. : 0. }
@fragment
export function fs(): vec4 { const on = S_.k > 0.; return vec4(pick(on) * S_.xs[0]) }`)
    expect(c.wgsl).toContain('xs: array<f32>,')
  })
})

describe('the padding and the matrix layout rule compose (#149 × §51)', () => {
  it('pads the array and leaves every matrix whose stride is already 16 alone', () => {
    // A matCxR is C columns of vecR and its column stride is AlignOf(vecR), so every shape
    // with three or four rows is already a multiple of 16 an element and needs no wrapper.
    // The leaf numbers come from `reflect.ts`'s own layout engine rather than a second copy,
    // which is what keeps this true after #149 rewrote that arm.
    const c = compiled(`class U {
  count: f32
  weights: array<f32, 3>
  m: mat3x3
  n: mat2x4
}
declare const u: uniform<U>
@vertex export function vs(): vec4 { return vec4(u.count, 0., 0., 1.) }
@fragment export function fs(): vec4 {
  return vec4(u.weights[1] + u.m[0].x + u.n[0].x, 0., 0., 1.)
}`)
    expect(c.wgsl).toContain('@size(16) v: f32,')
    expect(c.wgsl).toContain('@align(16) weights: array<_Pad16_f32, 3>,')
    expect(c.wgsl).toContain('  m: mat3x3<f32>,')
    expect(c.wgsl).toContain('  n: mat2x4<f32>,')
    expect(c.wgsl).not.toContain('_Pad16_mat')
    // The emit and the reflection describe one layout, which is the whole point of §51.
    const u = reflect(c.module).bindGroups[0]!.entries[0]!
    expect(u.structName).toBe('U')
  })

  it('leaves an ARRAY of matrices alone for the same reason', () => {
    const c = compiled(`class U { ms: array<mat3x4, 2> }
declare const u: uniform<U>
@vertex export function vs(): vec4 { return vec4(u.ms[0][0].x, 0., 0., 1.) }
@fragment export function fs(): vec4 { return vec4(u.ms[1][0].x, 0., 0., 1.) }`)
    expect(c.wgsl).toContain('ms: array<mat3x4<f32>, 2>,')
    expect(c.wgsl).not.toContain('_Pad16_')
  })
})
