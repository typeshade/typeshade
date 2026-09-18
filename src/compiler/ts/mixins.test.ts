// The mixin pattern (roadmap 0.3 item T8, #92): `class Body extends Aged(Particle) { … }`, a
// class whose base is decided by running a function.
//
// TypeScript runs that function at run time and gets a constructor. There is no run time here,
// so it runs when the file is compiled and gives a list of members. What makes that work is
// what T5 settled: a TypeShade struct is flat, and dispatch is static. `Aged(Particle)` has no
// layout a value can have and no method anything calls through, so it is not a struct of its
// own; its members are spliced into the class that applied it, behind the base's and ahead of
// that class's own — the order TypeScript's own mixin produces.
//
// Before this, `extends Aged(Particle)` was "a base has to be a declared class or interface
// here", and the mixin function itself was "TS8099 Unsupported expression" on its class.
//
// The mixins below are written the way `tsc` accepts one — `<TBase extends AnyClass>` — because
// that is the way a developer has to write it. `AnyClass` is the ambient lib's name for the
// constructor type TypeScript needs to take `class extends Base`; a mixin declaring its own,
// as the TypeScript handbook does, reads the same to this compiler, which never looks at the
// constraint. `ambient.test.ts` is what checks the spelling against `tsc`, through
// `examples/mixin-surface.shade.ts`.

import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { compileTsSource } from './source-file.js'

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => d.message)

const FS = `@fragment
export function fs(): vec4 {
  return vec4(1.)
}
`

describe('a mixin is a function that returns a class, run when the file is compiled', () => {
  it('splices its fields behind the base and ahead of the class that applied it', () => {
    const r = compile(`"use typeshade"
class Particle {
  pos: vec3
}
function Aged<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    age: f32
    faded(): f32 {
      return 1. - this.age
    }
  }
}
class Body extends Aged(Particle) {
  mass: f32
}
@fragment
export function fs(): vec4 {
  const b = new Body()
  return vec4(b.pos, b.faded() + b.mass)
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain(
      'struct Body {\n  pos: vec3<f32>,\n  age: f32,\n  mass: f32,\n}',
    )
    // The mixin's method is the applying class's, named for it: there is no
    // `Aged(Particle)` for a function to belong to.
    expect(r.wgsl).toContain('fn Body_faded(self_: Body) -> f32 {')
    expect(r.wgsl).not.toContain('fn Aged')
  })

  it('chains, innermost first', () => {
    const r = compile(`"use typeshade"
class Particle {
  pos: vec3
}
function Aged<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    age: f32
  }
}
function Named<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    tag: u32
  }
}
class Body extends Named(Aged(Particle)) {
  mass: f32
}
@fragment
export function fs(): vec4 {
  const b = new Body()
  return vec4(b.pos.x, b.age, f32(b.tag), b.mass)
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain(
      'struct Body {\n  pos: vec3<f32>,\n  age: f32,\n  tag: u32,\n  mass: f32,\n}',
    )
  })

  it('takes no base at all, which is a mixin that only adds', () => {
    const r = compile(`"use typeshade"
function Tagged() {
  return class {
    tag: u32
  }
}
class Body extends Tagged() {
  mass: f32
}
@fragment
export function fs(): vec4 {
  const b = new Body()
  return vec4(f32(b.tag), b.mass, 0., 1.)
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('struct Body {\n  tag: u32,\n  mass: f32,\n}')
  })

  it('is applied through a const, the spelling the TypeScript handbook uses', () => {
    const r = compile(`"use typeshade"
class Particle {
  pos: vec3
}
function Aged<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    age: f32
  }
}
const AgedParticle = Aged(Particle)
class Body extends AgedParticle {
  mass: f32
}
@fragment
export function fs(): vec4 {
  const b = new Body()
  return vec4(b.pos.x, b.age, b.mass, 1.)
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('struct Body {\n  pos: vec3<f32>,\n  age: f32,\n  mass: f32,\n}')
    // The const holds a class, not a value: it is no module constant.
    expect(r.wgsl).not.toContain('AgedParticle')
  })

  it('reads the mixin wherever it is written, above or below its use', () => {
    const r = compile(`"use typeshade"
class Body extends Aged(Particle) {
  mass: f32
}
class Particle {
  pos: vec3
}
function Aged<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    age: f32
  }
}
@fragment
export function fs(): vec4 {
  const b = new Body()
  return vec4(b.pos.x, b.age, b.mass, 1.)
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('struct Body {\n  pos: vec3<f32>,\n  age: f32,\n  mass: f32,\n}')
  })
})

describe('what a mixin may carry', () => {
  it('a constructor, including one that calls super over a base that has one', () => {
    const r = compile(`"use typeshade"
class Particle {
  pos: vec3
  constructor(p: vec3) {
    this.pos = p
  }
}
function Aged<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    age: f32
    constructor(p: vec3, a: f32) {
      super(p)
      this.age = a
    }
  }
}
class Body extends Aged(Particle) {}
@fragment
export function fs(): vec4 {
  const b = new Body(vec3(1.), 0.5)
  return vec4(b.pos, b.age)
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('fn Body_new(p: vec3<f32>, a: f32) -> Body {')
    expect(r.wgsl).toContain('let _sup = Particle_new(p);')
  })

  it('a static function, which belongs to the applying class', () => {
    const r = compile(`"use typeshade"
class Particle {
  pos: vec3
}
function Scaled<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    k: f32
    static unit(): f32 {
      return 1.
    }
  }
}
class Body extends Scaled(Particle) {}
@fragment
export function fs(): vec4 {
  const b = new Body()
  return vec4(b.pos, Body.unit() + b.k)
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('fn Body_unit() -> f32 {')
  })

  it('a field with a decorator, which reaches entry I/O as any other field does', () => {
    const r = compile(`"use typeshade"
function WithUv() {
  return class {
    @location(0) uv: vec2
  }
}
class Varyings extends WithUv() {
  @builtin("position") pos: vec4
}
@vertex
export function vs(): Varyings {
  return { pos: vec4(0., 0., 0., 1.), uv: vec2(0.) }
}
@fragment
export function fs(v: Varyings): vec4 {
  return vec4(v.uv, 0., 1.)
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('@location(0) uv: vec2<f32>,')
    expect(r.wgsl).toContain('@builtin(position) pos: vec4<f32>,')
  })

  it('a method reading a field of the base it was mixed over', () => {
    const r = compile(`"use typeshade"
class Particle {
  pos: vec3
}
function Aged<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    age: f32
    faded(): vec3 {
      return this.pos * (1. - this.age)
    }
  }
}
class Body extends Aged(Particle) {
  mass: f32
}
@fragment
export function fs(): vec4 {
  const b = new Body()
  return vec4(b.faded(), b.mass)
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('return (self_.pos * (1.0 - self_.age));')
  })

  it('applies over an abstract base, whose abstract method the class supplies', () => {
    const r = compile(`"use typeshade"
abstract class Shape {
  k: f32
  abstract area(): f32
}
function Scaled<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    s: f32
  }
}
class Disc extends Scaled(Shape) {
  r: f32
  area(): f32 {
    return this.r * this.r * this.s
  }
}
@fragment
export function fs(): vec4 {
  const d = new Disc()
  return vec4(d.area(), d.k, d.s, 1.)
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('struct Disc {\n  k: f32,\n  s: f32,\n  r: f32,\n}')
  })
})

describe('a name declared twice in the chain is an override, closest to the value winning', () => {
  it('the applying class overrides a mixin method, silently', () => {
    const r = compile(`"use typeshade"
class Particle {
  pos: vec3
}
function Aged<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    age: f32
    faded(): f32 {
      return 1. - this.age
    }
  }
}
class Body extends Aged(Particle) {
  mass: f32
  faded(): f32 {
    return 0.5
  }
}
@fragment
export function fs(): vec4 {
  const b = new Body()
  return vec4(b.faded(), b.mass, 0., 1.)
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('fn Body_faded(self_: Body) -> f32 {\n  return 0.5;\n}')
  })

  it('an outer mixin overrides an inner one', () => {
    const r = compile(`"use typeshade"
class Particle {
  pos: vec3
}
function A<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    v: f32
    pick(): f32 {
      return 1.
    }
  }
}
function B<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    pick(): f32 {
      return 2.
    }
  }
}
class Body extends B(A(Particle)) {}
@fragment
export function fs(): vec4 {
  const b = new Body()
  return vec4(b.pick(), b.v, 0., 1.)
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('fn Body_pick(self_: Body) -> f32 {\n  return 2.0;\n}')
  })

  it('says so when two mixins give one field two types', () => {
    // The one collision that is not an override but a change of layout: picking either
    // silently would change what the other's code reads.
    expect(
      errorsOf(`"use typeshade"
class Particle {
  pos: vec3
}
function A<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    v: f32
  }
}
function B<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    v: vec3
  }
}
class Body extends B(A(Particle)) {
  mass: f32
}
${FS}`),
    ).toEqual([
      '"Body" gets the field "v" twice through its mixins, written "f32" in one and "vec3" ' +
        'in another. One of them decides the layout, and picking either silently would ' +
        'change what the other\'s code reads. Give them one type, or two names.',
    ])
  })
})

describe('what a mixin is not, each in one sentence', () => {
  it('a function whose body is more than one return of a class', () => {
    expect(
      errorsOf(`"use typeshade"
class Particle {
  pos: vec3
}
function Aged<TBase extends AnyClass>(Base: TBase) {
  const k: f32 = 1.
  return class extends Base {
    age: f32
  }
}
class Body extends Aged(Particle) {
  mass: f32
}
${FS}`),
    ).toEqual([
      '"Aged" is applied as a mixin by "Body", so its body has to be one "return class … ' +
        '{ … }". There is no run time here for anything else in it to happen in.',
    ])
  })

  it('a call to a function this file does not declare', () => {
    expect(
      errorsOf(`"use typeshade"
class Particle {
  pos: vec3
}
class Body extends Nowhere(Particle) {
  mass: f32
}
${FS}`)[0],
    ).toContain('this file declares no function "Nowhere"')
  })

  it('a mixin applied to itself', () => {
    expect(
      errorsOf(`"use typeshade"
function Aged<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    age: f32
  }
}
class Body extends Aged(Aged(Aged)) {
  mass: f32
}
${FS}`)[0],
    ).toContain('Mixin "Aged" is applied to itself')
  })

  it('a base passed to a mixin that has nowhere to put it', () => {
    expect(
      errorsOf(`"use typeshade"
class Particle {
  pos: vec3
}
function Tagged() {
  return class {
    tag: u32
  }
}
class Body extends Tagged(Particle) {
  mass: f32
}
${FS}`)[0],
    ).toContain('so the base would go nowhere')
  })

  it('a mixin that extends its parameter and is given nothing', () => {
    expect(
      errorsOf(`"use typeshade"
function Aged<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    age: f32
  }
}
class Body extends Aged() {
  mass: f32
}
${FS}`)[0],
    ).toContain('so it needs the base to extend')
  })

  it('a base that is neither a name nor a call, which never reaches the mixin evaluation', () => {
    expect(
      errorsOf(`"use typeshade"
class Body extends (1 + 2) {
  mass: f32
}
${FS}`)[0],
    ).toBe(
      '"Body" extends an expression. A base has to be a declared class or interface here, or ' +
        'a mixin: a call to a function of this file whose body is one "return class … { … }".',
    )
  })
})
