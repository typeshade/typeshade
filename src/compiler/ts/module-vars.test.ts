// Module variables (roadmap 0.2 item 5, design #82, §24): `let tile: workgroup<array<f32, 64>>`
// is WGSL's `var<workgroup>`, `let seed: perInvocation<u32> = 7` is WGSL's `var<private>`.
// Measured on `main` before this: a top-level `let` was TS8014 whatever its type. What is
// pinned here: the WGSL and GLSL each declaration emits, the three CPU backends agreeing on a
// kernel that uses both spaces (a private variable starts over at every host-facing call, a
// workgroup one persists as one implicit workgroup's memory), the effect table counting a
// write to one, reflection ignoring them, workgroup atomics, and every refusal with its fix.

import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { compileTsSource } from './source-file.js'
import { TS_CODES } from './codes.js'
import { compileModule } from '../../core/oracle.js'
import { compileModuleJs } from '../../core/cpu-codegen.js'
import { startDebugSession } from '../../core/debug/session.js'
import { reflect } from '../../core/reflect.js'
import { fnWrites } from '../../core/passes/effects.js'
import type { CpuValue } from '../../core/cpu-runtime.js'

const KERNEL = `"use typeshade"
declare const src: storage<array<f32>>
declare let out: storage<array<f32>>
const SCALE: f32 = 2.
let tile: workgroup<array<f32, 64>>
let seed: perInvocation<u32> = 7
let acc: perInvocation<vec2> = vec2(SCALE, 0.)
let counters: workgroup<array<atomic<u32>, 4>>
function bump(): u32 {
  seed = seed + 1
  return seed
}
@compute([64, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u, @builtin("local_invocation_id") lid: vec3u): void {
  tile[lid.x] = src[gid.x] * SCALE
  bump()
  bump()
  acc.x = acc.x + tile[lid.x]
  atomicAdd(counters[0], 1)
  out[gid.x] = tile[lid.x] + f32(seed) + acc.x
}
`

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`)

const TAIL = `
@compute([64, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {}
`

describe('module variables: the WGSL', () => {
  it('declares var<workgroup> and var<private> between the consts and the bindings', () => {
    const r = compile(KERNEL)
    expect(r.diagnostics).toEqual([])
    const w = r.wgsl!
    expect(w).toContain('var<workgroup> tile: array<f32, 64>;')
    expect(w).toContain('var<private> seed: u32 = 7u;')
    expect(w).toContain('var<private> acc: vec2<f32> = vec2<f32>(SCALE, 0.0);')
    expect(w).toContain('var<workgroup> counters: array<atomic<u32>, 4>;')
    expect(w.indexOf('const SCALE')).toBeLessThan(w.indexOf('var<workgroup> tile'))
    expect(w.indexOf('var<workgroup> tile')).toBeLessThan(w.indexOf('@group(0) @binding(0)'))
    // A read and a write are plain names, and a workgroup atomic takes the pointer.
    expect(w).toContain('  tile[lid.x] = (src[gid.x] * SCALE);')
    expect(w).toContain('  seed = (seed + 1u);')
    expect(w).toContain('  _ = atomicAdd(&counters[0], 1u);')
  })

  it('a compute module with workgroup memory has no GLSL, and says nothing about it', () => {
    expect(compile(KERNEL).glsl).toBeUndefined()
  })
})

describe('module variables: the CPU backends', () => {
  it('a private variable starts over at every host call, a workgroup one persists', () => {
    for (const make of [compileModule, compileModuleJs]) {
      const r = compile(KERNEL)
      const cm = make(r.module)
      const out = [0, 0, 0]
      cm.setBinding('src', [1, 2, 3])
      cm.setBinding('out', out)
      for (let g = 0; g < 3; g++) cm.fns['k']!([g, 0, 0], [g, 0, 0])
      // tile[g] = src[g] * 2; seed 7 then two bumps make 9; acc.x = 2 + tile[g].
      expect(out, make.name).toEqual([15, 19, 23])
    }
  })

  it('workgroup memory is one implicit workgroup for the module, zero at creation', () => {
    const src = `"use typeshade"
declare let out: storage<array<u32>>
let hits: workgroup<u32>
@compute([64, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  hits = hits + 1
  out[gid.x] = hits
}
`
    for (const make of [compileModule, compileModuleJs]) {
      const r = compile(src)
      expect(r.diagnostics).toEqual([])
      expect(r.wgsl).toContain('var<workgroup> hits: u32;')
      const cm = make(r.module)
      const out = [0, 0, 0]
      cm.setBinding('out', out)
      for (let g = 0; g < 3; g++) cm.fns['k']!([g, 0, 0])
      expect(out, make.name).toEqual([1, 2, 3])
    }
  })

  it('the debugger runs one invocation with the same values', () => {
    const r = compile(KERNEL)
    const out = [0, 0, 0]
    const bindings: Record<string, CpuValue> = { src: [1, 2, 3], out }
    const s = startDebugSession(
      r.module,
      'k',
      [
        [1, 0, 0],
        [1, 0, 0],
      ],
      { bindings },
    )
    s.continue()
    expect(s.done).toBe(true)
    expect(out).toEqual([0, 19, 0])
  })

  it('a per-invocation variable on both targets, with the oracle agreeing', () => {
    const src = `"use typeshade"
let seed: perInvocation<u32> = 7
function next(): u32 {
  seed = seed * 3 + 1
  return seed
}
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  seed = u32(uv.x)
  const a = next()
  const b = next()
  return vec4(f32(a), f32(b), f32(seed), 1.)
}
`
    const r = compile(src)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('var<private> seed: u32 = 7u;')
    // A plain global in GLSL ES 3.00, which is per-invocation there; the initializer rides.
    expect(r.glsl?.fragment).toContain('uint seed = 7u;')
    // seed = 2, then 7, then 22.
    expect(r.eval('fs', [[2, 0]])).toEqual([7, 22, 22, 1])
    const cm = compileModuleJs(r.module)
    expect(cm.fns['fs']!([2, 0])).toEqual([7, 22, 22, 1])
  })
})

describe('module variables: the effect table and reflection', () => {
  it('a write to a module variable is a write, through a helper too', () => {
    const r = compile(KERNEL)
    const w = fnWrites(r.module)
    expect([...w.get('bump')!]).toEqual(['seed'])
    expect([...w.get('k')!].sort()).toEqual(['acc', 'counters', 'out', 'seed', 'tile'])
  })

  it('reflection reports nothing for a module variable: no group, no binding, no layout', () => {
    const r = compile(KERNEL)
    const text = JSON.stringify(reflect(r.module))
    expect(text).not.toContain('"tile"')
    expect(text).not.toContain('"seed"')
    expect(text).toContain('"src"')
  })
})

describe('module variables: what is refused, and what the fix is', () => {
  const only = (src: string) => {
    const errors = errorsOf(src)
    expect(errors).toHaveLength(1)
    return errors[0]!
  }

  it('a const with an address-space wrapper', () => {
    expect(
      only(`"use typeshade"\nconst t: workgroup<array<f32, 4>> = [1., 2., 3., 4.]${TAIL}`),
    ).toBe(
      `${TS_CODES.MODULE_VAR} "t" is a module variable and is declared with let, not const: let t: workgroup<T>. A const is a module constant (§12).`,
    )
  })

  it('a workgroup variable with an initializer', () => {
    expect(only(`"use typeshade"\nlet t: workgroup<f32> = 1.${TAIL}`)).toBe(
      `${TS_CODES.MODULE_VAR} "t" is workgroup memory and takes no initializer: it is zero at the start of each workgroup. Assign it inside the entry, or make it perInvocation<T>.`,
    )
  })

  it('a type the space cannot hold', () => {
    expect(only(`"use typeshade"\nlet t: workgroup<array<f32>>${TAIL}`)).toBe(
      `${TS_CODES.MODULE_VAR} "t" cannot be a workgroup<array<f32>>: a runtime-sized array lives in a storage binding only; give this one a size, array<f32, 64>.`,
    )
    expect(only(`"use typeshade"\nlet t: perInvocation<texture_2d<f32>>${TAIL}`)).toBe(
      `${TS_CODES.MODULE_VAR} "t" cannot be a perInvocation<texture_2d<f32>>: a texture is a resource, declared bare with "declare const".`,
    )
    expect(only(`"use typeshade"\nlet t: perInvocation<atomic<u32>>${TAIL}`)).toBe(
      `${TS_CODES.MODULE_VAR} "t" cannot be a perInvocation<atomic<u32>>: an atomic lives in storage or workgroup memory, not in a per-invocation variable.`,
    )
  })

  it('an initializer that is not a constant, or of another type', () => {
    expect(only(`"use typeshade"\nlet t: perInvocation<f32> = select(1., 2., true)${TAIL}`)).toBe(
      `${TS_CODES.MODULE_VAR} "t" needs a constant initializer (a literal, a module const, arithmetic or a math builtin over those); "select(1., 2., true)" is not one. Assign it inside the entry.`,
    )
    expect(only(`"use typeshade"\nlet t: perInvocation<u32> = 1.5${TAIL}`)).toBe(
      `${TS_CODES.MODULE_VAR} "t" is declared u32 but its initializer is f32.`,
    )
  })

  it('workgroup memory reached from a fragment entry', () => {
    expect(
      only(`"use typeshade"
let t: workgroup<f32>
@fragment
export function fs(): vec4 { return vec4(t, 0., 0., 1.) }
`),
    ).toBe(
      `${TS_CODES.MODULE_VAR} "t" is workgroup memory, which only a compute entry has; a fragment entry cannot read or write it.`,
    )
  })

  it('a repeated name, alone or against a const', () => {
    expect(only(`"use typeshade"\nlet t: workgroup<f32>\nlet t: perInvocation<f32>${TAIL}`)).toBe(
      `${TS_CODES.DUPLICATE_SYMBOL} Duplicate module variable "t".`,
    )
    expect(only(`"use typeshade"\nconst t: f32 = 1.\nlet t: perInvocation<f32>${TAIL}`)).toContain(
      'declared as a module const and as a module variable',
    )
  })

  it('the wrapper anywhere but on a top-level let', () => {
    const errors = errorsOf(
      `"use typeshade"\nfunction f(a: workgroup<f32>): f32 { return 1. }${TAIL}`,
    )
    expect(errors[0]).toBe(
      'TS8002 workgroup<T> declares a module variable and belongs at the top of the file: let name: workgroup<T>.',
    )
  })

  it('a struct type and a negative integer initializer are fine', () => {
    expect(
      errorsOf(`"use typeshade"\nclass P { a: f32; b: vec2 }\nlet t: workgroup<P>${TAIL}`),
    ).toEqual([])
    const r = compile(`"use typeshade"\nlet t: perInvocation<i32> = -3${TAIL}`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('var<private> t: i32 = -3;')
  })
})

// A plain top-level `let` is the per-invocation variable (§24, from review of #82): what a
// module-level `let` means to a TypeScript reader, a value this run of the program owns, and in a
// shader the run is the invocation. `perInvocation<T>` stays as the explicit spelling and
// `workgroup<T>` stays required. Measured on `main` before this: `let counter: f32 = 0.` at the
// top of a file was TS8014.
describe('a plain top-level let is the per-invocation variable', () => {
  it('spells the same var<private> as perInvocation<T>, and the CPU backends agree', () => {
    const plain = KERNEL.replace('let seed: perInvocation<u32> = 7', 'let seed: u32 = 7').replace(
      'let acc: perInvocation<vec2> = vec2(SCALE, 0.)',
      'let acc: vec2 = vec2(SCALE, 0.)',
    )
    expect(plain).not.toContain('perInvocation')
    const a = compile(KERNEL)
    const b = compile(plain)
    expect(b.diagnostics).toEqual([])
    expect(b.wgsl).toBe(a.wgsl)
    for (const make of [compileModule, compileModuleJs]) {
      const cm = make(b.module)
      const out = [0, 0, 0]
      cm.setBinding('src', [1, 2, 3])
      cm.setBinding('out', out)
      for (let g = 0; g < 3; g++) cm.fns['k']!([g, 0, 0], [g, 0, 0])
      expect(out, make.name).toEqual([15, 19, 23])
    }
  })

  it("without an annotation the type is the initializer's, by the rule a const follows", () => {
    const r = compile(`"use typeshade"
let v = 1.5
let n = 7
let on = true
let c = vec2(1., 2.)
${TAIL}`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('var<private> v: f32 = 1.5;')
    // A bare integer literal is f32, as `const N = 7` is; `let n: u32 = 7` is the integer.
    expect(r.wgsl).toContain('var<private> n: f32 = 7.0;')
    expect(r.wgsl).toContain('var<private> on: bool = true;')
    expect(r.wgsl).toContain('var<private> c: vec2<f32> = vec2<f32>(1.0, 2.0);')
  })

  it('no initializer is zero; an array and a struct take a constant one', () => {
    const src = `"use typeshade"
declare let out: storage<array<f32>>
class P { a: f32; b: vec2 }
let hits: u32
let a: array<f32, 2> = [1., 2.]
let z: array<f32, 2> = [0., 0.]
let p: P = { a: 1., b: vec2(2., 3.) }
@compute([64, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  z[0] = a[0] + a[1] + p.b.y
  out[gid.x] = z[0] + a[1] + f32(hits)
}
`
    const r = compile(src)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('var<private> hits: u32;')
    expect(r.wgsl).toContain('var<private> a: array<f32, 2> = array<f32, 2>(1.0, 2.0);')
    expect(r.wgsl).toContain('var<private> p: P = P(1.0, vec2<f32>(2.0, 3.0));')
    for (const make of [compileModule, compileModuleJs]) {
      const cm = make(r.module)
      const out = [0, 0]
      cm.setBinding('out', out)
      cm.fns['k']!([1, 0, 0])
      // 1 + 2 + 3, plus a[1], plus zero hits.
      expect(out, make.name).toEqual([0, 8])
    }
  })

  it('a math builtin over constants is a constant initializer, as it is for a const (#73)', () => {
    const r = compile(`"use typeshade"\nlet t: f32 = sin(1.)${TAIL}`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('var<private> t: f32 = sin(1.0);')
  })

  it('on GLSL ES 3.00 it is a plain global, and the oracle agrees', () => {
    const r = compile(`"use typeshade"
let seed: u32 = 7
function next(): u32 {
  seed = seed * 3 + 1
  return seed
}
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  seed = u32(uv.x)
  const a = next()
  const b = next()
  return vec4(f32(a), f32(b), f32(seed), 1.)
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('var<private> seed: u32 = 7u;')
    expect(r.glsl?.fragment).toContain('uint seed = 7u;')
    expect(r.eval('fs', [[2, 0]])).toEqual([7, 22, 22, 1])
  })

  it('what is refused, and what the fix is', () => {
    const only = (src: string) => {
      const errors = errorsOf(src)
      expect(errors, src).toHaveLength(1)
      return errors[0]!
    }
    expect(only(`"use typeshade"\nlet t${TAIL}`)).toBe(
      `${TS_CODES.MODULE_VAR} "t" needs a type or an initializer: let t: f32, or let t = 0.`,
    )
    expect(only(`"use typeshade"\nlet t = [1., 2.]${TAIL}`)).toBe(
      `${TS_CODES.MODULE_VAR} "t" needs an array type to take a list: let t: array<f32, 2> = [...].`,
    )
    expect(only(`"use typeshade"\nlet x: storage<array<f32>>${TAIL}`)).toBe(
      `${TS_CODES.MODULE_VAR} "x" is a storage binding the host provides, and needs declare: declare let x: storage<array<f32>>.`,
    )
    expect(only(`"use typeshade"\nlet u: uniform<vec4>${TAIL}`)).toBe(
      `${TS_CODES.MODULE_VAR} "u" is a uniform binding the host provides, and needs declare: declare let u: uniform<vec4>.`,
    )
    expect(only(`"use typeshade"\nlet t: texture_2d<f32>${TAIL}`)).toBe(
      `${TS_CODES.MODULE_VAR} "t" cannot be texture_2d<f32>: a texture is a resource, declared bare with "declare const".`,
    )
    expect(only(`"use typeshade"\nlet t: atomic<u32>${TAIL}`)).toBe(
      `${TS_CODES.MODULE_VAR} "t" cannot be atomic<u32>: an atomic lives in storage or workgroup memory, not in a per-invocation variable.`,
    )
    expect(only(`"use typeshade"\nlet t: u32 = 1.5${TAIL}`)).toBe(
      `${TS_CODES.MODULE_VAR} "t" is declared u32 but its initializer is f32.`,
    )
    expect(only(`"use typeshade"\nlet [a, b] = [1., 2.]${TAIL}`)).toBe(
      `${TS_CODES.MODULE_VAR} A module variable is one name with one type, let name: T = init; "[a, b]" has no shader form.`,
    )
    // An override is a const; overrides.ts says so and this collector stays out of its way.
    expect(only(`"use typeshade"\nlet q: override<f32> = 1.${TAIL}`)).toBe(
      `${TS_CODES.TOP_LEVEL} override "q" must be const, not let.`,
    )
    // A top-level var is still nothing.
    expect(errorsOf(`"use typeshade"\nvar t: f32 = 1.${TAIL}`)[0]).toBe(
      `${TS_CODES.TOP_LEVEL} Top-level var is not allowed. Use \`let\` for a per-invocation variable or \`const\` for a module constant.`,
    )
  })
})
