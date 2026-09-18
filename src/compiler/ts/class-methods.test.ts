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
import { compileModule } from '../../core/oracle.js'
import { fnWrites } from '../../core/passes/effects.js'
import type { CpuValue } from '../../core/cpu-runtime.js'

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

  it('a method that changes its object may not also return a value', () => {
    expect(only(C('  bump(): f32 { this.x = this.x + 1.\n    return this.x }'))).toBe(
      `${M} A method that changes its object returns nothing (§26): declare this method void and call it on its own line, or keep this one reading and return the new value.`,
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

  it('new on anything but a class the file declares', () => {
    expect(
      errorsOf(`"use typeshade"\nfunction g(): f32 { const d = new Date(); return 1. }${TAIL}`)[0],
    ).toBe(
      `${TS_CODES.HOST_STMT} \`new\` allocates a JS object. Use struct types and vec constructors, or a class the file declares.`,
    )
    // A class of statics alone was refused here until roadmap 0.3 item T3 (#92) made it the
    // namespace of functions it is; `class-statics.test.ts` pins it, and an INSTANCE member on
    // a fieldless class keeps this refusal, which the same file pins.
    expect(errorsOf(`"use typeshade"\nclass M { static f(): f32 { return 1. } }${TAIL}`)).toEqual(
      [],
    )
  })
})

// Step 2 of #86: a method that changes its object. It takes and returns the struct, and a call
// of it is a statement that writes the receiver back. Measured on `main` (step 1) before this:
// such a method was TS8035 "not supported yet".
describe('class members: a method that changes its object', () => {
  const PARTICLES = `"use typeshade"
declare let ps: storage<array<Particle>>
class Particle {
  pos: vec2
  vel: vec2
  age: u32 = 0
  step(dt: f32): void {
    this.pos = this.pos + this.vel * dt
    this.age++
  }
  bounce(): void {
    if (this.pos.y < 0.) {
      this.vel.y = -this.vel.y
    }
  }
  tick(dt: f32): void {
    this.step(dt)
    this.bounce()
  }
  speed(): f32 {
    return length(this.vel)
  }
}
@compute([64, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  ps[gid.x].tick(0.5)
  let p = ps[gid.x]
  p.step(1.)
  ps[gid.x].vel = vec2(p.speed(), f32(p.age))
}
`

  it('takes the struct as self_in, works on the copy self_, and returns it', () => {
    const r = compile(PARTICLES)
    expect(r.diagnostics).toEqual([])
    const w = r.wgsl!
    expect(w).toContain(
      'fn Particle_step(self_in: Particle, dt: f32) -> Particle {\n  var self_: Particle = self_in;\n  self_.pos = (self_.pos + (self_.vel * dt));\n  self_.age += 1u;\n  return self_;\n}',
    )
    // A method that calls a changing method on `this` changes its object too, to a fixpoint.
    expect(w).toContain(
      'fn Particle_tick(self_in: Particle, dt: f32) -> Particle {\n  var self_: Particle = self_in;\n  self_ = Particle_step(self_, dt);\n  self_ = Particle_bounce(self_);\n  return self_;\n}',
    )
    // One that reads keeps the read-only parameter.
    expect(w).toContain('fn Particle_speed(self_: Particle) -> f32 {')
    // The call statement writes the receiver back: a storage element and a local alike.
    expect(w).toContain('  ps[gid.x] = Particle_tick(ps[gid.x], 0.5);')
    expect(w).toContain('  p = Particle_step(p, 1.0);')
  })

  it('the write-back on a storage element is a write in the effect table', () => {
    const r = compile(PARTICLES)
    expect([...fnWrites(r.module).get('k')!]).toEqual(['ps'])
    expect([...fnWrites(r.module).get('Particle_step')!]).toEqual([])
  })

  it('the oracle and the codegen agree on the particles', () => {
    const r = compile(PARTICLES)
    for (const make of [compileModule, compileModuleJs]) {
      const cm = make(r.module)
      const ps = [{ pos: [0, 1], vel: [1, -4], age: 0 }]
      cm.setBinding('ps', ps as unknown as CpuValue)
      cm.fns['k']!([0, 0, 0])
      // tick: pos (0.5, -1), age 1, then bounce flips vel.y to 4; the copy steps once more to
      // age 2 and its speed is |(1, 4)|.
      expect(ps, make.name).toEqual([{ pos: [0.5, -1], vel: [Math.sqrt(17), 2], age: 1 }])
    }
  })

  it('a let local, a module variable and this inside a constructor are places', () => {
    const r = compile(`"use typeshade"
class C {
  x: f32
  constructor(x: f32) {
    this.x = x
    this.bump()
  }
  bump(): void {
    this.x = this.x + 1.
  }
  twice(): f32 {
    return this.x * 2.
  }
}
let acc: C = { x: 10. }
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  let c = new C(uv.x)
  c.bump()
  acc.bump()
  return vec4(c.twice(), acc.x, 0., 1.)
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('  self_ = C_bump(self_);\n  return self_;')
    expect(r.wgsl).toContain('  c = C_bump(c);\n  acc = C_bump(acc);')
    // new C(1): x = 1, then the constructor bumps to 2; fs bumps to 3, twice is 6; acc 10 to 11.
    expect(r.eval('fs', [[1, 0]])).toEqual([6, 11, 0, 1])
  })

  it('refuses a receiver a function cannot write, and a call in expression position', () => {
    const C = `"use typeshade"\nclass C {\n  x: f32\n  bump(): void { this.x = this.x + 1. }\n}\n`
    const only = (src: string) => {
      const errors = errorsOf(src)
      expect(errors, src).toHaveLength(1)
      return errors[0]!
    }
    const M = TS_CODES.CLASS_MEMBER
    expect(
      only(`${C}function g(): f32 { const c: C = { x: 1. }\n  c.bump()\n  return c.x }${TAIL}`),
    ).toBe(`${M} "C.bump" changes its object, and "c" is declared with const; declare it with let.`)
    expect(only(`${C}function g(c: C): f32 { c.bump()\n  return c.x }${TAIL}`)).toBe(
      `${M} "C.bump" changes its object, and "c" is a parameter, which a function cannot write; copy it into a let first.`,
    )
    expect(only(`${C}function g(): f32 { new C().bump()\n  return 1. }${TAIL}`)).toBe(
      `${M} "C.bump" changes its object, and this one is a value that is dropped; keep it in a let and call the method on that.`,
    )
    expect(
      only(
        `${C}function g(): f32 { let c: C = { x: 1. }\n  const y = c.bump()\n  return c.x }${TAIL}`,
      ),
    ).toBe(`${M} "C.bump" changes its object and returns nothing; call it on its own line.`)
    expect(
      only(
        `"use typeshade"\nclass D {\n  x: f32\n  f(self_in: f32): void { this.x = self_in }\n}${TAIL}`,
      ),
    ).toBe(
      `${M} "self_in" is a name D.f gives its object in the emitted function; rename the parameter.`,
    )
  })
})
