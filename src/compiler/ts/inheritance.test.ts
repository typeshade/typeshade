// Inheritance (roadmap 0.3 item T5, design #92, §26). `class Derived extends Base`,
// `interface B extends A`, `abstract class`, `implements`, an override, and `super`. Measured
// on `main` before this: every `extends` was `TS8010 "Derived" extends another type. A
// TypeShade struct is exactly the members written here, so the inherited ones would be
// dropped; write them out.`, and an `abstract` method was `"Shape" has no method "area"`.
//
// The shape of the answer: a struct is flat, with the base's fields first, and dispatch is
// static. A class inherits a method by lowering the base's node again with `this` typed as
// itself, so an inherited body calls the override, as it does in TypeScript; a base-typed name
// cannot hold a derived value, which is what makes the two dispatches agree.

import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { compileTsSource } from './source-file.js'
import { TS_CODES } from './codes.js'
import { compileModule } from '../../core/oracle.js'
import { compileModuleJs } from '../../core/cpu-codegen.js'

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`)

const agree = (r: ReturnType<typeof compile>, expected: number[]): void => {
  for (const make of [compileModule, compileModuleJs]) {
    expect(make(r.module).fns['fs']!(), make.name).toEqual(expected)
  }
}

const file = (head: string, body: string) => `"use typeshade"
${head}@fragment
export function fs(): vec4 {
${body}
}
`

describe('a derived struct is its base plus its own', () => {
  it('base fields first, on a class and through a chain of three', () => {
    const r = compile(
      file(
        `class A {
  a: f32
}
class B extends A {
  b: f32
}
class C extends B {
  c: f32
}
`,
        `  const v: C = { a: 1., b: 2., c: 3. }\n  return vec4(v.a, v.b, v.c, 1.)`,
      ),
    )
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('struct C {\n  a: f32,\n  b: f32,\n  c: f32,\n}')
    expect(r.glsl?.fragment).toContain('struct C {\n  float a;\n  float b;\n  float c;\n};')
    agree(r, [1, 2, 3, 1])
  })

  it('on an interface, on several bases at once, and across the two spellings', () => {
    const r = compile(
      file(
        `interface HasX {
  x: f32
}
interface HasY {
  y: f32
}
interface Both extends HasX, HasY {
  z: f32
}
class FromInterface extends Both {
  w: f32
}
`,
        `  const v: FromInterface = { x: 1., y: 2., z: 3., w: 4. }\n  return vec4(v.x, v.y, v.z, v.w)`,
      ),
    )
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain(
      'struct FromInterface {\n  x: f32,\n  y: f32,\n  z: f32,\n  w: f32,\n}',
    )
    agree(r, [1, 2, 3, 4])
  })

  it('and "implements" carries no layout, as before', () => {
    const r = compile(
      file(
        `interface HasX {
  x: f32
}
class P implements HasX {
  x: f32
}
`,
        `  const p: P = { x: 5. }\n  return vec4(p.x, 0., 0., 1.)`,
      ),
    )
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('struct P {\n  x: f32,\n}')
    agree(r, [5, 0, 0, 1])
  })
})

describe('a method is inherited by being lowered again', () => {
  it('into the derived class, and an override wins', () => {
    const r = compile(
      file(
        `class Base {
  x: f32
  twice(): f32 {
    return this.x * 2.
  }
  v(): f32 {
    return this.x
  }
}
class Derived extends Base {
  y: f32
  v(): f32 {
    return this.x + this.y
  }
}
`,
        `  const d: Derived = { x: 1., y: 2. }\n  return vec4(d.twice(), d.v(), 0., 1.)`,
      ),
    )
    expect(r.diagnostics).toEqual([])
    // One function per class, each typed on its own struct: WGSL has no vtable.
    expect(r.wgsl).toContain('fn Derived_twice(self_: Derived) -> f32 {')
    expect(r.wgsl).toContain('fn Base_twice(self_: Base) -> f32 {')
    agree(r, [2, 3, 0, 1])
  })

  it('so an inherited body calls the override, which is what TypeScript does', () => {
    const r = compile(
      file(
        `abstract class Shape {
  k: f32
  abstract area(): f32
  scaled(): f32 {
    return this.area() * this.k
  }
}
class Square extends Shape {
  s: f32
  area(): f32 {
    return this.s * this.s
  }
}
class Circle extends Shape {
  r: f32
  area(): f32 {
    return 3. * this.r * this.r
  }
}
`,
        `  const q: Square = { k: 2., s: 3. }\n  const c: Circle = { k: 1., r: 2. }\n  return vec4(q.scaled(), c.scaled(), 0., 1.)`,
      ),
    )
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('return (Square_area(self_) * self_.k);')
    expect(r.wgsl).toContain('return (Circle_area(self_) * self_.k);')
    // An abstract class is a base and never a value: no instance method of its own.
    expect(r.wgsl).not.toContain('fn Shape_scaled')
    agree(r, [18, 12, 0, 1])
  })

  it('and a static function and a field initializer come down too', () => {
    const r = compile(
      file(
        `class Base {
  x: f32 = 4.
  static unit(): f32 {
    return 1.
  }
}
class Derived extends Base {
  y: f32
}
`,
        `  const d = new Derived()\n  return vec4(Derived.unit(), Base.unit(), d.x, 1.)`,
      ),
    )
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('fn Derived_unit() -> f32 {')
    agree(r, [1, 1, 4, 1])
  })
})

describe('super', () => {
  it("in a constructor runs the base's and copies its fields in", () => {
    const r = compile(
      file(
        `class Base {
  x: f32
  constructor(x: f32) {
    this.x = x * 10.
  }
}
class Derived extends Base {
  y: f32
  constructor(x: f32, y: f32) {
    super(x)
    this.y = y
  }
}
`,
        `  const d = new Derived(1., 2.)\n  return vec4(d.x, d.y, 0., 1.)`,
      ),
    )
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('let _sup = Base_new(x);')
    expect(r.wgsl).toContain('self_.x = _sup.x;')
    agree(r, [10, 2, 0, 1])
  })

  it('through an abstract base, whose constructor is emitted for it', () => {
    const r = compile(
      file(
        `abstract class Shape {
  k: f32
  constructor(k: f32) {
    this.k = k
  }
  abstract area(): f32
}
class Square extends Shape {
  s: f32
  constructor(k: f32, s: f32) {
    super(k)
    this.s = s
  }
  area(): f32 {
    return this.s * this.s * this.k
  }
}
`,
        `  const q = new Square(2., 3.)\n  return vec4(q.area(), q.k, q.s, 1.)`,
      ),
    )
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('let _sup = Shape_new(k);')
    agree(r, [18, 2, 3, 1])
  })

  it('bare, where nothing above declares a constructor, is nothing', () => {
    const r = compile(
      file(
        `class Base {
  x: f32 = 4.
}
class Derived extends Base {
  y: f32
  constructor(y: f32) {
    super()
    this.y = y
  }
}
`,
        `  const d = new Derived(2.)\n  return vec4(d.x, d.y, 0., 1.)`,
      ),
    )
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).not.toContain('_sup')
    agree(r, [4, 2, 0, 1])
  })

  it("on a method runs the base's body on this object, two deep and finite", () => {
    const r = compile(
      file(
        `class A {
  a: f32
  at(t: f32): f32 {
    return this.a * t
  }
}
class B extends A {
  b: f32
  at(t: f32): f32 {
    return super.at(t) + this.b
  }
}
class C extends B {
  c: f32
  at(t: f32): f32 {
    return super.at(t) + this.c
  }
}
`,
        `  const v: C = { a: 2., b: 3., c: 4. }\n  return vec4(v.at(5.), 0., 0., 1.)`,
      ),
    )
    expect(r.diagnostics).toEqual([])
    // The base is named as well as the class, so `super` inside a re-lowered body still counts
    // from where that body was written and the chain terminates.
    expect(r.wgsl).toContain('fn C_super_B_at(self_: C, t: f32) -> f32 {')
    expect(r.wgsl).toContain('fn C_super_A_at(self_: C, t: f32) -> f32 {')
    expect(r.wgsl).toContain('return (C_super_A_at(self_, t) + self_.b);')
    agree(r, [17, 0, 0, 1])
  })

  it('names no body, or no object, and says so', () => {
    expect(
      errorsOf(
        file(
          `class Base {
  x: f32
}
class Derived extends Base {
  y: f32
  v(): f32 {
    return super.v() + this.y
  }
}
`,
          `  const d: Derived = { x: 1., y: 2. }\n  return vec4(d.v(), 0., 0., 1.)`,
        ),
      )[0],
    ).toBe(
      `${TS_CODES.CLASS_MEMBER} Nothing above this class declares a method "v", so "super.v" names no body.`,
    )
    expect(
      errorsOf(`"use typeshade"
function f(): f32 {
  return super.v()
}
@fragment
export function fs(): vec4 {
  return vec4(f(), 0., 0., 1.)
}
`)[0],
    ).toContain('"super" names the base of a method\'s class')
  })
})

describe('what inheritance refuses, and why', () => {
  it('a base this file does not declare, a cycle, and a field that changes type', () => {
    expect(
      errorsOf(
        file(
          `class D extends Missing {\n  y: f32\n}\n`,
          `  const d: D = { y: 1. }\n  return vec4(d.y, 0., 0., 1.)`,
        ),
      )[0],
    ).toBe(
      `${TS_CODES.STRUCT_FIELD} "D" extends "Missing", which this file does not declare as a struct. A base has to be a class or an interface whose fields are shader types.`,
    )
    expect(
      errorsOf(
        file(
          `class A extends B {\n  a: f32\n}\nclass B extends A {\n  b: f32\n}\n`,
          `  const v: A = { a: 1. }\n  return vec4(v.a, 0., 0., 1.)`,
        ),
      )[0],
    ).toContain('extends itself, through')
    expect(
      errorsOf(
        file(
          `class A {\n  x: i32\n}\nclass B extends A {\n  x: f32\n}\n`,
          `  const v: B = { x: 1. }\n  return vec4(v.x, 0., 0., 1.)`,
        ),
      )[0],
    ).toBe(
      `${TS_CODES.STRUCT_FIELD} "B" declares "x" as f32, and "A" declares it as i32. A struct has one layout, so a field cannot change type on the way down.`,
    )
  })

  it('a base-typed name holding a derived value, with the reason', () => {
    const HEAD = `class Base {\n  x: f32\n}\nclass Derived extends Base {\n  y: f32\n}\n`
    const note =
      ' "Derived" extends "Base", and a name typed as the base cannot hold a derived value ' +
      'here: method dispatch is static, so a call through it would run "Base"\'s body. Write ' +
      '"Derived" as the type.'
    expect(
      errorsOf(
        file(
          HEAD,
          `  const d: Derived = { x: 1., y: 2. }\n  const b: Base = d\n  return vec4(b.x, 0., 0., 1.)`,
        ),
      )[0],
    ).toContain(note)
    expect(
      errorsOf(`"use typeshade"
${HEAD}function take(b: Base): f32 {
  return b.x
}
@fragment
export function fs(): vec4 {
  const d: Derived = { x: 1., y: 2. }
  return vec4(take(d), 0., 0., 1.)
}
`)[0],
    ).toContain(note)
  })

  it('a generic base and a base that is an expression, each naming its own item', () => {
    expect(
      errorsOf(
        file(
          `class Box<T> {\n  v: f32\n}\nclass D extends Box<f32> {\n  y: f32\n}\n`,
          `  const d: D = { v: 1., y: 2. }\n  return vec4(d.v, 0., 0., 1.)`,
        ),
      ).join(' '),
    ).toContain('extends a type with type arguments')
    expect(
      errorsOf(
        file(
          `class Base {\n  x: f32\n}\nfunction mix2(b: f32): f32 {\n  return b\n}\nclass D extends mix2(1.) {\n  y: f32\n}\n`,
          `  const d: D = { y: 2. }\n  return vec4(d.y, 0., 0., 1.)`,
        ),
      ).join(' '),
    ).toContain('extends an expression')
  })
})
