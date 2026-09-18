// Classes with methods, a constructor and static functions (design #86 step 1, §26). Measured
// on `main` before this: a method was TS8010 "Data class cannot have methods", `new` was
// TS8013 and a method call TS8099. What is pinned here: what each member lowers to on WGSL
// and GLSL ES 3.00, the three CPU paths agreeing on a ray class, the zero struct a class
// without a constructor starts from, a constructor with a bare return and a method call, the
// symbols the editor gets, and every refusal with its fix.

import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { compileTsSource } from './source-file.js'
import { TS_CODES } from './codes.js'
import { compileModuleJs } from '../../core/cpu-codegen.js'
import { startDebugSession } from '../../core/debug/session.js'

const RAY = `"use typeshade"
class Ray {
  origin: vec3
  dir: vec3
  hits: u32 = 0
  constructor(origin: vec3, dir: vec3) {
    this.origin = origin
    this.dir = normalize(dir)
  }
  at(t: f32): vec3 {
    return this.origin + this.dir * t
  }
  farther(t: f32): Ray {
    return new Ray(this.at(t), this.dir)
  }
  static up(): vec3 {
    return vec3(0., 1., 0.)
  }
}
class P { a: f32; b: vec2 }
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  const r = new Ray(vec3(uv, 0.), vec3(0., 0., 2.))
  const q = r.farther(1.)
  const p = new P()
  return vec4(q.at(1.) + Ray.up() + vec3(p.a), f32(r.hits))
}
`

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`)

const TAIL = `
@fragment
export function fs(): vec4 { return vec4(1.) }
`

describe('class members: what each one lowers to', () => {
  it('a method takes the struct first, a static function nothing, the constructor returns it', () => {
    const r = compile(RAY)
    expect(r.diagnostics).toEqual([])
    const w = r.wgsl!
    expect(w).toContain(
      'fn Ray_at(self_: Ray, t: f32) -> vec3<f32> {\n  return (self_.origin + (self_.dir * t));\n}',
    )
    expect(w).toContain('fn Ray_up() -> vec3<f32> {')
    // The zero struct first, so GLSL starts where WGSL does, then the field initializer and the
    // body's two assignments; the repeated zero vector is the emitter's common subexpression.
    expect(w).toContain(
      'fn Ray_new(origin: vec3<f32>, dir: vec3<f32>) -> Ray {\n  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);\n  var self_: Ray = Ray(_cse0, _cse0, 0u);\n  self_.hits = 0u;\n  self_.origin = origin;\n  self_.dir = normalize(dir);\n  return self_;\n}',
    )
    expect(w).toContain('return Ray_new(Ray_at(self_, t), self_.dir);')
    expect(w).toContain('let r = Ray_new(vec3<f32>(uv, 0.0), vec3<f32>(0.0, 0.0, 2.0));')
    expect(w).toContain('let q = Ray_farther(r, 1.0);')
    expect(w).toContain('Ray_at(q, 1.0) + Ray_up()')
    // A class with no constructor answers `new P()` with the zero struct, spelled out.
    expect(w).toContain(
      'fn P_new() -> P {\n  var self_: P = P(0.0, vec2<f32>(0.0, 0.0));\n  return self_;\n}',
    )
    const g = r.glsl!.fragment
    expect(g).toContain('vec3 Ray_at(Ray self_, float t) {')
    expect(g).toContain(
      'Ray Ray_new(vec3 origin, vec3 dir) {\n  vec3 _cse0 = vec3(0.0, 0.0, 0.0);\n  Ray self_ = Ray(_cse0, _cse0, 0u);\n  self_.hits = 0u;\n  self_.origin = origin;\n  self_.dir = normalize(dir);\n  return self_;\n}',
    )
    expect(g).toContain('P self_ = P(0.0, vec2(0.0, 0.0));')
    expect(g).toContain('Ray r = Ray_new(vec3(uv, 0.0), vec3(0.0, 0.0, 2.0));')
  })

  it('the oracle, the codegen and the debugger agree on the ray', () => {
    const r = compile(RAY)
    // origin (0.5, 0.25, 0), dir (0, 0, 1); one farther, then at(1): (0.5, 0.25, 2); plus up.
    const expected = [0.5, 1.25, 2, 0]
    expect(r.eval('fs', [[0.5, 0.25]])).toEqual(expected)
    expect(compileModuleJs(r.module).fns['fs']!([0.5, 0.25])).toEqual(expected)
    const s = startDebugSession(r.module, 'fs', [[0.5, 0.25]])
    s.continue()
    expect(s.done).toBe(true)
    expect(s.result).toEqual(expected)
  })

  it('the zero struct reaches every field kind, and a matrix falls back to the bare var', () => {
    const r = compile(`"use typeshade"
class Q { a: f32; b: vec2u; ok: bool; xs: array<i32, 2> }
class P { a: f32; q: Q; n: u32 = 3 }
class M { m: mat4 }
@fragment
export function fs(): vec4 {
  const p = new P()
  const q = new Q()
  const m = new M()
  return vec4(p.a + f32(p.n) + f32(q.xs[1]) + f32(p.q.b.y), 0., 0., 1.)
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain(
      'var self_: Q = Q(0.0, vec2<u32>(0u, 0u), false, array<i32, 2>(0, 0));',
    )
    expect(r.wgsl).toContain(
      'var self_: P = P(0.0, Q(0.0, vec2<u32>(0u, 0u), false, array<i32, 2>(0, 0)), 0u);\n  self_.n = 3u;',
    )
    expect(r.wgsl).toContain('fn M_new() -> M {\n  var self_: M;\n  return self_;\n}')
    expect(r.glsl?.fragment).toContain('Q self_ = Q(0.0, uvec2(0u, 0u), false, int[2](0, 0));')
    expect(r.eval('fs', [])).toEqual([3, 0, 0, 1])
  })

  it('a constructor may return early and call a method; both returns hand back self', () => {
    const r = compile(`"use typeshade"
class C {
  x: f32
  constructor(a: f32) {
    if (a > 1.) {
      this.x = this.twice(a)
      return
    }
    this.x = a
  }
  twice(a: f32): f32 { return a * 2. }
}
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  return vec4(new C(uv.x).x, 0., 0., 1.)
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain(
      'self_.x = C_twice(self_, a);\n    return self_;\n  }\n  self_.x = a;\n  return self_;',
    )
    expect(r.eval('fs', [[3, 0]])).toEqual([6, 0, 0, 1])
    expect(r.eval('fs', [[0.5, 0]])).toEqual([0.5, 0, 0, 1])
  })

  it('records a method for the editor under its class name, without self_', () => {
    const r = compileTsSource(RAY)
    const at = r.symbols.find((s) => s.name === 'Ray.at')
    expect(at?.kind).toBe('function')
    expect(at?.params?.map((p) => p.name)).toEqual(['t'])
    expect(r.symbols.find((s) => s.name === 'Ray.up')?.params).toEqual([])
  })

  it('access modifiers are accepted and mean nothing to the shader', () => {
    const r = compile(`"use typeshade"
class C {
  private x: f32
  readonly y: f32 = 2.
  public constructor(x: f32) { this.x = x }
  protected inner(): f32 { return this.x }
  public sum(): f32 { return this.inner() + this.y }
}
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  return vec4(new C(uv.x).sum(), 0., 0., 1.)
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.eval('fs', [[1, 0]])).toEqual([3, 0, 0, 1])
  })
})

describe('class members: what is refused, and what the fix is', () => {
  const C = (body: string) => `"use typeshade"\nclass C {\n  x: f32\n${body}\n}${TAIL}`
  const only = (src: string) => {
    const errors = errorsOf(src)
    expect(errors, src).toHaveLength(1)
    return errors[0]!
  }
  const M = TS_CODES.CLASS_MEMBER

  it('a method that assigns to this, until the next step', () => {
    expect(only(C('  bump(): void { this.x = this.x + 1. }'))).toBe(
      `${M} A method that assigns to this is not supported yet (#86, the next step); build the changed struct:C and return it, or assign the field in the constructor.`,
    )
  })

  it('this in a static function and at the top level', () => {
    expect(only(C('  static f(): f32 { return this.x }'))).toBe(
      `${M} "this" names a method's object; a static function and a top-level function have none.`,
    )
    expect(only(`"use typeshade"\nfunction f(): f32 { return this.x }${TAIL}`)).toBe(
      `${M} "this" names a method's object; a static function and a top-level function have none.`,
    )
  })

  it('member shapes with no shader form', () => {
    expect(only(C('  get y(): f32 { return this.x }'))).toBe(
      `${M} A getter has no shader form; write "y" as a method and call it.`,
    )
    expect(only(C('  static N: f32 = 1.'))).toBe(
      `${M} A static field has no shader form; declare "N" as a module const.`,
    )
    expect(only(C('  f = (): f32 => 1.'))).toBe(
      `${M} A field holding a function is a method: write "f(...) { ... }".`,
    )
    expect(only(C('  constructor() { this.x = 1. }\n  constructor(a: f32) { this.x = a }'))).toBe(
      `${M} "C" declares two constructors; a shader function has one body.`,
    )
    expect(only(C('  f(): f32 { return 1. }\n  f(a: f32): f32 { return a }'))).toContain(
      '"C.f" is declared twice; a method has one body and no overloads.',
    )
    expect(only(C('  @fragment\n  f(): vec4 { return vec4(1.) }'))).toBe(
      `${M} A decorator has no place on "C.f"; an entry is a top-level function.`,
    )
  })

  it('a call on the wrong side, a member the class lacks, a field called', () => {
    const cls = `"use typeshade"\nclass C {\n  x: f32\n  f(): f32 { return this.x }\n  static s(): f32 { return 1. }\n}\n`
    expect(only(`${cls}function g(): f32 { return C.f() }${TAIL}`)).toBe(
      `${M} "C.f" is a method; call it on a C value: v.f(...).`,
    )
    expect(only(`${cls}function g(c: C): f32 { return c.s() }${TAIL}`)).toBe(
      `${M} "C.s" is static; call it on the class: C.s(...).`,
    )
    expect(only(`${cls}function g(c: C): f32 { return c.nope() }${TAIL}`)).toBe(
      `${M} "C" has no method "nope".`,
    )
    expect(only(`${cls}function g(c: C): f32 { return c.x() }${TAIL}`)).toBe(
      `${M} "x" is a field of C, not a method.`,
    )
    expect(only(`${cls}function g(): f32 { return C.nope() }${TAIL}`)).toBe(
      `${M} "C" has no static function "nope".`,
    )
    expect(only(`${cls}function g(c: C, a: f32): f32 { return c.f(a) }${TAIL}`)).toBe(
      `${TS_CODES.ARITY_MISMATCH} "C.f" expects 0 argument(s), got 1.`,
    )
  })

  it('the emitted name clashes with a function the file declares', () => {
    expect(
      only(
        C('  f(): f32 { return this.x }').replace(
          TAIL,
          `\nfunction C_f(c: C): f32 { return c.x }${TAIL}`,
        ),
      ),
    ).toBe(
      `${TS_CODES.DUPLICATE_SYMBOL} "C_f" is both the function "C_f" and the emitted name of "C.f"; rename one of them.`,
    )
  })

  it('new on anything but a class the file declares, and a class of statics alone', () => {
    expect(
      errorsOf(`"use typeshade"\nfunction g(): f32 { const d = new Date(); return 1. }${TAIL}`)[0],
    ).toBe(
      `${TS_CODES.HOST_STMT} \`new\` allocates a JS object. Use struct types and vec constructors, or a class the file declares.`,
    )
    expect(only(`"use typeshade"\nclass M { static f(): f32 { return 1. } }${TAIL}`)).toBe(
      `${TS_CODES.STRUCT_FIELD} Struct "M" has no fields. WGSL requires a struct to declare at least one member, so an empty one cannot be emitted. A class holding only functions is not a struct; write them as functions.`,
    )
  })
})
