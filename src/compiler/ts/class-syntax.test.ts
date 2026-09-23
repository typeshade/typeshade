// The class syntax an ordinary TypeScript class is written in (§26, Rules 8.10 to 8.15):
// getters and setters, private names, parameter properties, a field typed by its initializer,
// a static field the file writes and `this` in a static member, and `readonly`; then `super` on
// an accessor and on a base method that writes its object, statics through a class that
// extends, `new this()` and `super` in a static member, `private` and `protected`, and a chain of
// calls on one object.
//
// Measured on the branch before this: a getter or a setter was TS8035 "write it as a method",
// `#x` was TS8010 "Field names must be plain identifiers", a parameter property declared no
// field, a field without a type was dropped from the struct and every use of it was "Unknown
// field", a static block was passed over in silence, a write to a static field was "Cannot
// assign to unknown name", and a write to a `readonly` field compiled.
//
// What is pinned here: what each form lowers to on WGSL and GLSL ES 3.00, the oracle, the CPU
// codegen and the debugger agreeing on one program that uses them all, and every refusal with
// its code and its text (Rule 12.5), each one diagnostic for one mistake (Rule 12.4).

import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { TS_CODES } from './codes.js'
import { compileModuleJs } from '../../core/cpu-codegen.js'
import { startDebugSession } from '../../core/debug/session.js'

const TAIL = `\n@fragment\nexport function fs(): vec4 { return vec4(1.) }\n`
/** A tail whose entry calls `run`: the GLSL writer emits only what an entry reaches. */
const RUN_TAIL = `\n@fragment\nexport function fs(): vec4 { return vec4(run(), 0., 0., 1.) }\n`

const errorsOf = (src: string): string[] =>
  compile(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`)

/** The one error `src` has, which the test then pins by code and text (Rule 12.4, 12.5). */
const only = (src: string): string => {
  const errors = errorsOf(src)
  expect(errors, src).toHaveLength(1)
  return errors[0]!
}

/** `actual` against `expected`, a number within an `f32`'s precision: the debugger keeps an
 *  `f32` as one, where the oracle and the codegen carry it in a double, so the two agree to the
 *  last bit of an `f32` and no further. */
function expectClose(actual: unknown, expected: unknown): void {
  if (typeof expected === 'number') {
    expect(typeof actual).toBe('number')
    expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(
      1e-6 * Math.max(1, Math.abs(expected)),
    )
    return
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).toBe(true)
    expected.forEach((e, i) => expectClose((actual as unknown[])[i], e))
    return
  }
  if (expected !== null && typeof expected === 'object') {
    for (const [k, e] of Object.entries(expected)) {
      expectClose((actual as Record<string, unknown>)[k], e)
    }
    return
  }
  expect(actual).toEqual(expected)
}

/** `fn(...args)` on the oracle, the CPU codegen and the debugger, which must agree. */
function runAll(src: string, args: unknown[] = [], fn = 'run'): unknown {
  const r = compile(src)
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
  const oracle = r.eval(fn, args)
  expect(compileModuleJs(r.module).fns[fn]!(...(args as never[]))).toEqual(oracle)
  const s = startDebugSession(r.module, fn, args as never[])
  s.continue()
  expect(s.done).toBe(true)
  expectClose(s.result, oracle)
  return oracle
}

const M = TS_CODES.CLASS_MEMBER
const F = TS_CODES.STRUCT_FIELD

describe('getters and setters (Rule 8.11)', () => {
  const TEMP = `"use typeshade"
class Temperature {
  #celsius: f32 = 0.
  get celsius(): f32 { return this.#celsius }
  set celsius(v: f32) { this.#celsius = max(v, -200.) }
  get fahrenheit(): f32 { return this.#celsius * 1.8 + 32. }
  set fahrenheit(v) { this.celsius = (v - 32.) / 1.8 }
}
export function run(f: f32): f32 {
  let t = new Temperature()
  t.fahrenheit = f
  t.celsius += 5.
  t.celsius++
  return t.celsius
}
@fragment
export function fs(): vec4 { return vec4(run(212.), 0., 0., 1.) }
`

  it('each half is a function: the getter reads its object, the setter writes through it', () => {
    const r = compile(TEMP)
    expect(r.diagnostics).toEqual([])
    const w = r.wgsl!
    expect(w).toContain('fn Temperature_get_celsius(self_: Temperature) -> f32 {')
    expect(w).toContain(
      'fn Temperature_set_celsius(self_: ptr<function, Temperature>, v: f32) {\n  (*self_).celsius = max(v, -200.0);\n}',
    )
    // `set fahrenheit(v)` takes the getter's type, and its `this.celsius = …` is the other
    // setter, handed the reference it holds.
    expect(w).toContain(
      'fn Temperature_set_fahrenheit(self_: ptr<function, Temperature>, v: f32) {\n  Temperature_set_celsius(self_, ((v - 32.0) / 1.8));\n}',
    )
    expect(w).toContain('Temperature_set_fahrenheit(&t, f);')
    expect(w).toContain('Temperature_set_celsius(&t, (Temperature_get_celsius(t) + 5.0));')
    expect(w).toContain('Temperature_set_celsius(&t, (Temperature_get_celsius(t) + 1.0));')
    expect(w).toContain('return Temperature_get_celsius(t);')
    const g = r.glsl!.fragment
    expect(g).toContain('void Temperature_set_celsius(inout Temperature self_, float v) {')
    expect(g).toContain('float Temperature_get_celsius(Temperature self_) {')
  })

  it('the oracle, the codegen and the debugger agree', () => {
    // 212 °F is 100 °C; then += 5 and ++.
    expect(runAll(TEMP, [212])).toBeCloseTo(106, 5)
    // The setter clamps, and the compound forms go through it.
    expect(runAll(TEMP, [-1000])).toBe(-194)
  })

  it('a static accessor is read and written on the class, over a private static', () => {
    // `static #gain` and the accessor `gain` are two members: `Cfg.gain = 10.` is the setter,
    // which clamps, and never the variable the private field became.
    const src = `"use typeshade"
class Cfg {
  static #gain = 1.
  static get gain(): f32 { return this.#gain }
  static set gain(v: f32) { this.#gain = clamp(v, 0., 4.) }
}
export function run(): f32 {
  Cfg.gain = 10.
  Cfg.gain -= 1.
  return Cfg.gain
}${TAIL}`
    const r = compile(src)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('var<private> Cfg_gain: f32 = 1.0;')
    expect(r.wgsl).toContain('fn Cfg_set_gain(v: f32) {\n  Cfg_gain = clamp(v, 0.0, 4.0);\n}')
    expect(r.wgsl).toContain('Cfg_set_gain(10.0);\n  Cfg_set_gain((Cfg_get_gain() - 1.0));')
    expect(runAll(src)).toBe(3)
  })

  it('a getter that fills a cache takes its object by reference, and runs in source order', () => {
    const src = `"use typeshade"
class Lazy {
  x: f32 = 3.
  #cache: f32 = -1.
  #reads: f32 = 0.
  get square(): f32 {
    this.#reads += 1.
    if (this.#cache < 0.) { this.#cache = this.x * this.x }
    return this.#cache
  }
  get reads(): f32 { return this.#reads }
}
export function run(): f32 {
  let l = new Lazy()
  const a = l.square + l.square
  return a * 10. + l.reads
}${TAIL}`
    const r = compile(src)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('fn Lazy_get_square(self_: ptr<function, Lazy>) -> f32 {')
    expect(r.wgsl).toContain('let _seq0 = Lazy_get_square(&l);')
    expect(runAll(src)).toBe(182)
  })

  it('an accessor is inherited, and the class that declares either half owns both', () => {
    const src = `"use typeshade"
class Base {
  #v: f32 = 1.
  get v(): f32 { return this.#v }
  set v(x: f32) { this.#v = x }
  bump(): void { this.#v = this.#v + 1. }
}
class Derived extends Base {
  w: f32 = 10.
  get v(): f32 { return 100. + this.w }
}
export function run(): f32 {
  let b = new Base()
  b.v = 5.
  b.bump()
  let d = new Derived()
  d.bump()
  return b.v + d.v
}${TAIL}`
    expect(runAll(src)).toBe(116)
    // Derived overrides the getter alone, so it has no setter, as in TypeScript.
    expect(only(src.replace('return b.v + d.v', 'd.v = 1.\n  return d.v'))).toBe(
      `${M} "Derived.v" has a getter and no setter, so it cannot be assigned. Declare "set v(value)" beside the getter.`,
    )
  })

  it('an abstract getter is implemented by the class that extends it', () => {
    const src = `"use typeshade"
abstract class Shape {
  scale: f32 = 2.
  abstract get area(): f32
  describe(): f32 { return this.area * this.scale }
}
class Sq extends Shape {
  constructor(public side: f32) { super() }
  get area(): f32 { return this.side * this.side }
}
export function run(): f32 { return new Sq(3.).describe() }${TAIL}`
    expect(runAll(src)).toBe(18)
  })

  it('what is refused, and the fix', () => {
    const C = (members: string, use = '') =>
      `"use typeshade"\nclass C {\n  x: f32\n${members}\n}\n${use}${TAIL}`
    expect(
      only(
        C(
          '  get y(): f32 { return this.x }',
          'export function run(): f32 { let c = new C(); c.y = 2.; return c.x }',
        ),
      ),
    ).toBe(
      `${M} "C.y" has a getter and no setter, so it cannot be assigned. Declare "set y(value)" beside the getter.`,
    )
    expect(
      only(
        C(
          '  set y(v: f32) { this.x = v }',
          'export function run(): f32 { let c = new C(); c.y = 2.; return c.y }',
        ),
      ),
    ).toBe(
      `${M} "C.y" has a setter and no getter, so there is nothing to read. Declare "get y()" beside the setter.`,
    )
    expect(
      only(
        C(
          '  set y(v: f32) { this.x = v }',
          'export function run(): f32 { let c = new C(); c.y += 2.; return c.x }',
        ),
      ),
    ).toBe(
      `${M} "C.y" has a setter and no getter, so there is nothing for this assignment to read. Declare "get y()" beside the setter, or assign it with "=".`,
    )
    expect(only(C('  get y() { return this.x }'))).toBe(
      `${TS_CODES.UNKNOWN_TYPE} The getter "C.y" needs a return type: write "get y(): T".`,
    )
    expect(only(C('  set y(v) { this.x = v }'))).toBe(
      `${TS_CODES.UNKNOWN_TYPE} The setter "C.y" needs a type for "v": write "set y(v: T)", or give the getter a return type.`,
    )
    expect(
      only(
        C('  get y(): f32 { return this.x }', 'export function run(): f32 { return new C().y() }'),
      ),
    ).toBe(`${M} "C.y" is an accessor, not a method; read or assign it without the call: v.y.`)
    expect(only(C('  get y(): f32 { return 1. }\n  get y(): f32 { return 2. }'))).toBe(
      `${M} "C.y" has two getters; an accessor has one body.`,
    )
    expect(only(C('  get y(): f32 { return 1. }\n  get_y(): f32 { return 2. }'))).toBe(
      `${M} "C.get y" and "C.get_y" would both be the function "C_get_y". Rename one of them.`,
    )
    expect(only(C('  y: f32\n  get y(): f32 { return 2. }'))).toBe(
      `${M} "C.y" is declared as a field and as an accessor; a class member has one kind. Rename one of them.`,
    )
  })

  it('a write into what a getter returns is refused: it would change a copy', () => {
    const src = `"use typeshade"
class C {
  #p: vec3 = vec3(0.)
  get p(): vec3 { return this.#p }
  set p(v: vec3) { this.#p = v }
}
export function run(): f32 { let c = new C(); c.p.x = 2.; return c.p.x }${TAIL}`
    expect(only(src)).toBe(
      `${TS_CODES.ASSIGN_TARGET} "c.p.x" writes into what the getter "C.p" returns, which is a copy, so the write would be lost. Assign the whole property, or add a method that changes the field.`,
    )
  })

  it('a compound assignment through an accessor evaluates its object once or is refused', () => {
    const src = `"use typeshade"
class C {
  #v: f32 = 0.
  get v(): f32 { return this.#v }
  set v(x: f32) { this.#v = x }
}
function pick(i: i32): i32 { return i }
export function run(): f32 {
  let cs = array<C, 2>(new C(), new C())
  cs[pick(1)].v += 1.
  return cs[1].v
}${TAIL}`
    expect(only(src)).toBe(
      `${M} "cs[pick(1)].v" reads through the getter and writes through the setter, so "cs[pick(1)]" would run twice. Bind it to a let first.`,
    )
  })
})

describe('private names (Rule 8.12)', () => {
  const COUNTER = `"use typeshade"
class Counter {
  #count: u32 = 0
  static #limit = 3
  get count(): u32 { return this.#count }
  increment(): void { this.#count = this.#clamped(this.#count + 1) }
  #clamped(n: u32): u32 { return min(n, u32(Counter.#limit)) }
}
export function run(): f32 {
  let c = new Counter()
  c.increment()
  c.increment()
  c.increment()
  c.increment()
  return f32(c.count)
}${TAIL}`

  it('a private member is emitted without its "#", beside a public accessor of the same name', () => {
    const r = compile(COUNTER)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('struct Counter {\n  count: u32,\n}')
    expect(r.wgsl).toContain('const Counter_limit: f32 = 3.0;')
    expect(r.wgsl).toContain('fn Counter_clamped(self_: Counter, n: u32) -> u32 {')
    expect(r.wgsl).toContain('fn Counter_get_count(self_: Counter) -> u32 {')
    expect(runAll(COUNTER)).toBe(3)
  })

  it('only the class that declares a private name may use it', () => {
    expect(
      only(`"use typeshade"
class C { #x: f32 = 1. }
export function run(c: C): f32 { return c.#x }${TAIL}`),
    ).toBe(
      `${M} "#x" is private to "C", and this code is outside its class body. Reach it through a member "C" declares without the "#".`,
    )
    expect(
      only(`"use typeshade"
class C { #x: f32 = 1. }
class D { y: f32; read(c: C): f32 { return c.#x } }${TAIL}`),
    ).toBe(
      `${M} "#x" is private to "C", and this code is outside its class body. Reach it through a member "C" declares without the "#".`,
    )
    // A public name never reaches a private member: `c.x` is not `#x`.
    expect(
      only(`"use typeshade"
class C { #x: f32 = 1. }
export function run(c: C): f32 { return c.x }${TAIL}`),
    ).toBe(`${TS_CODES.UNKNOWN_NAME} Unknown field "x" on struct:C.`)
  })

  it('a body inherited from the class that declares it may use it', () => {
    const src = `"use typeshade"
class Base {
  #hits: f32 = 0.
  hit(): void { this.#hits = this.#next(this.#hits) }
  #next(n: f32): f32 { return n + 1. }
  get hits(): f32 { return this.#hits }
}
class Derived extends Base { bonus: f32 = 5. }
export function run(): f32 { let d = new Derived(); d.hit(); d.hit(); return d.hits + d.bonus }${TAIL}`
    const r = compile(src)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('fn Derived_hit(self_: ptr<function, Derived>) {')
    expect(runAll(src)).toBe(7)
  })

  it('two members of one chain on one emitted name are refused, once', () => {
    expect(only(`"use typeshade"\nclass C { #v: f32 = 1.; v: f32 = 2. }${TAIL}`)).toBe(
      `${F} "C" declares "#v" and "v", which would both be the struct member "v": a private name is emitted without its "#". Rename one of them.`,
    )
    expect(
      only(`"use typeshade"
class Base { #v: f32 = 1.; get bv(): f32 { return this.#v } }
class Derived extends Base { #v: f32 = 2.; get dv(): f32 { return this.#v } }${TAIL}`),
    ).toBe(
      `${F} "Base" declares "#v" and "Derived" declares "#v", which would both be the struct member "v": a private name is emitted without its "#". Rename one of them.`,
    )
    expect(
      only(`"use typeshade"
class Base { x: f32; #h(): f32 { return 1. } run(): f32 { return this.#h() } }
class Derived extends Base { h(): f32 { return 2. } }${TAIL}`),
    ).toBe(
      `${M} "Derived.h" and "Base.#h" would both be the function "Derived_h": a private name is emitted without its "#". Rename one of them.`,
    )
    expect(only(`"use typeshade"\nclass C { static #n = 1.; static n = 2.; x: f32 }${TAIL}`)).toBe(
      `${M} "C.#n" and "C.n" would both be the module constant "C_n": a private name is emitted without its "#". Rename one of them.`,
    )
  })

  it('a literal cannot build a class with a private field; a spread and a pattern leave it out', () => {
    expect(
      only(`"use typeshade"
class C { #x: f32 = 1.; y: f32 = 2. }
export function run(): f32 { const c: C = { y: 1. }; return 1. }${TAIL}`),
    ).toBe(
      `${F} "C" has the private field "#x", which an object literal cannot set. Build it with "new C(...)".`,
    )
    expect(
      runAll(`"use typeshade"
class C { #x: f32 = 1.; y: f32 = 2.; get x(): f32 { return this.#x } }
interface D { y: f32 }
export function run(): f32 { const c = new C(); const d: D = { ...c }; const { y } = c; return d.y + y + c.x }${TAIL}`),
    ).toBe(5)
    expect(
      errorsOf(`"use typeshade"
class C { #x: f32 = 1.; y: f32 = 2. }
export function run(): f32 { const c = new C(); const { x } = c; return 1. }${TAIL}`),
    ).toEqual([`${TS_CODES.UNKNOWN_NAME} "C" has no field "x".`])
  })

  it('a destructuring pattern reads a getter by calling it', () => {
    expect(
      runAll(`"use typeshade"
class R { w: f32 = 2.; h: f32 = 3.; get area(): f32 { return this.w * this.h } }
export function run(): f32 { const r = new R(); const { area, w } = r; return area + w }${TAIL}`),
    ).toBe(8)
  })
})

describe('statics: a static field the file writes, and this in a static member (Rule 8.13)', () => {
  const STATS = `"use typeshade"
class Stats {
  static hits = 0.
  static readonly WEIGHT = 0.5
  static made = 0.
  v: f32
  constructor(v: f32) { this.v = v; Stats.made++ }
  static record(v: f32): void { this.hits += v * this.WEIGHT }
  static total(): f32 { return this.hits + this.made }
}
export function run(): f32 {
  Stats.record(4.)
  Stats.record(2.)
  const a = new Stats(10.)
  return Stats.total() + a.v
}${TAIL}`

  it('a written static is a module variable, an unwritten one a constant', () => {
    const r = compile(STATS)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('var<private> Stats_hits: f32 = 0.0;')
    expect(r.wgsl).toContain('var<private> Stats_made: f32 = 0.0;')
    expect(r.wgsl).toContain('const Stats_WEIGHT: f32 = 0.5;')
    expect(r.wgsl).toContain('Stats_hits += (v * Stats_WEIGHT);')
    expect(r.glsl?.fragment).toContain('float Stats_hits = 0.0;')
    // hits = 2 + 1, made = 1, plus the value.
    expect(runAll(STATS)).toBe(14)
  })

  it('a write to a readonly static, and new on this outside a static member, are refused', () => {
    expect(
      only(`"use typeshade"
class C { static readonly K = 3.; x: f32 }
export function run(): f32 { C.K = 4.; return C.K }${TAIL}`),
    ).toBe(`${TS_CODES.CONST_ASSIGN} Cannot assign to "C.K" — it is static readonly.`)
    // `new this()` builds the class in a static member; in a method `this` is the object.
    expect(
      only(`"use typeshade"
class A { x: f32 = 1.; clone(): A { return new this() } }${TAIL}`),
    ).toBe(
      `${TS_CODES.HOST_STMT} "this" here is an object, not a class, so "new" cannot build one from it. Name the class, "new A(...)"; "new this()" builds the class in a static member.`,
    )
  })
})

describe('parameter properties, a field typed by its initializer, readonly (Rule 8.14)', () => {
  it('a parameter property is a field, assigned before the initializers run', () => {
    const src = `"use typeshade"
class V {
  twice: f32 = this.x * 2.
  constructor(public x: f32, readonly y: f32, private z: f32 = 3.) {}
  sum(): f32 { return this.x + this.y + this.z + this.twice }
}
class W extends V {
  constructor(public w: f32) { super(1., 2.) }
}
export function run(): f32 {
  const v = new V(1., 2.)
  const w = new W(4.)
  return v.sum() * 100. + w.w * 10. + w.sum()
}${TAIL}`
    const r = compile(src)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('struct V {\n  twice: f32,\n  x: f32,\n  y: f32,\n  z: f32,\n}')
    expect(r.wgsl).toContain(
      'self_.x = x;\n  self_.y = y;\n  self_.z = z;\n  self_.twice = (self_.x * 2.0);',
    )
    expect(runAll(src)).toBe(848)
  })

  it('a field written without a type takes the one its initializer names', () => {
    const src = `"use typeshade"
class P { x: f32; y: f32 }
class C {
  hits = 0
  on = false
  v = vec3(1., 2., 3.)
  n = u32(4)
  neg = -2.5
  p = new P()
}
export function run(): f32 {
  const c = new C()
  return c.hits + select(0., 1., !c.on) + c.v.y + f32(c.n) + c.neg + c.p.x
}${TAIL}`
    const r = compile(src)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain(
      'struct C {\n  hits: f32,\n  on: bool,\n  v: vec3<f32>,\n  n: u32,\n  neg: f32,\n  p: P,\n}',
    )
    expect(runAll(src)).toBe(4.5)
  })

  it('a field whose initializer names no type is refused once, with the fix', () => {
    expect(
      errorsOf(`"use typeshade"
function k(): f32 { return 1. }
class C { a = k(); b; c = this.a }
export function run(): f32 { return new C().a }${TAIL}`),
    ).toEqual([
      `${F} Field "a" on "C" needs a type, which "k()" does not name. Write "a: T = ...".`,
      `${F} Field "b" on "C" needs a type: write "b: T".`,
      `${F} Field "c" on "C" needs a type, which "this.a" does not name. Write "c: T = ...".`,
    ])
  })

  it('a readonly field is assigned in its constructor and nowhere else; it is shallow', () => {
    expect(
      runAll(`"use typeshade"
class P {
  readonly id: u32
  readonly pos: vec3
  constructor(id: u32, readonly w: f32) { this.id = id; this.pos = vec3(1.) }
  nudge(): void { this.pos.x += 1. }
}
export function run(): f32 { let p = new P(3, 2.); p.nudge(); p.pos.y = 5.; return f32(p.id) + p.w + p.pos.x + p.pos.y }${TAIL}`),
    ).toBe(12)
    const RO = TS_CODES.CONST_ASSIGN
    expect(
      only(`"use typeshade"\nclass P { readonly id: u32 = 0; bump(): void { this.id++ } }${TAIL}`),
    ).toBe(
      `${RO} Cannot assign to "this.id" — "id" is readonly, so only the constructor of "P" may assign it.`,
    )
    expect(
      only(`"use typeshade"
class P { constructor(readonly w: f32) {} }
export function run(): f32 { let p = new P(1.); p.w += 2.; return p.w }${TAIL}`),
    ).toBe(
      `${RO} Cannot assign to "p.w" — "w" is readonly, so only the constructor of "P" may assign it.`,
    )
    expect(
      only(`"use typeshade"
class A { readonly v: f32 = 1. }
class B extends A { constructor() { super(); this.v = 2. } }${TAIL}`),
    ).toBe(
      `${RO} Cannot assign to "this.v" — "v" is readonly, so only the constructor of "A" may assign it.`,
    )
  })

  it('a static block is refused, with the fix', () => {
    expect(only(`"use typeshade"\nclass C { static K = 1.; static { } x: f32 }${TAIL}`)).toBe(
      `${M} A static block runs when the class is defined, and a shader has no such moment. Give each static field its value where it is declared.`,
    )
  })
})

describe('super on an accessor, and on a base method that writes its object (Rules 8.10, 8.11)', () => {
  const COUNTER = `"use typeshade"
class Counter {
  n: f32 = 0.
  get value(): f32 { return this.n }
  set value(v: f32) { this.n = v }
  bump(): void { this.n += 1. }
}
class Clamped extends Counter {
  set value(v: f32) { super.value = min(v, 10.) }
  get value(): f32 { return super.value }
  bump(): void {
    super.bump()
    this.value = this.value * 2.
  }
  twice(): void { super.value *= 2. }
}
export function run(): f32 {
  let c = new Clamped()
  c.value = 2.5
  c.bump()
  let d = new Clamped()
  d.value = 3.
  d.twice()
  d.twice()
  return c.value * 100. + d.value
}${RUN_TAIL}`

  it("super.x runs the base's half lowered for this class, on this body's object", () => {
    const r = compile(COUNTER)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain(
      'fn Clamped_set_value(self_: ptr<function, Clamped>, v: f32) {\n  Clamped_super_Counter_set_value(self_, min(v, 10.0));',
    )
    expect(r.wgsl).toContain(
      'fn Clamped_get_value(self_: Clamped) -> f32 {\n  return Clamped_super_Counter_get_value(self_);',
    )
    // A compound assignment through `super` reads through the base's getter and writes through
    // its setter.
    expect(r.wgsl).toContain(
      'Clamped_super_Counter_set_value(self_, (Clamped_super_Counter_get_value((*self_)) * 2.0));',
    )
    expect(r.glsl?.fragment).toContain(
      'void Clamped_super_Counter_set_value(inout Clamped self_, float v)',
    )
  })

  it('a base body called through super that writes its object takes it by reference', () => {
    const r = compile(COUNTER)
    expect(r.wgsl).toContain(
      'fn Clamped_super_Counter_bump(self_: ptr<function, Clamped>) {\n  (*self_).n += 1.0;',
    )
    expect(r.wgsl).toContain('Clamped_super_Counter_bump(self_);')
    // c: 2.5, bumped to 3.5, doubled to 7; d: 3, doubled twice to 12 through the base's
    // setter, which `super.value *= 2.` reaches directly and which does not clamp.
    expect(runAll(COUNTER)).toBe(712)
  })

  it('what is refused, and the fix', () => {
    const BASE = `"use typeshade"
class A { x: f32 = 1.; get g(): f32 { return this.x } set s(v: f32) { this.x = v } }
`
    expect(only(BASE + `class B extends A { get y(): f32 { return super.x } }${TAIL}`)).toBe(
      `${M} "super.x" names a field, and a field is the object's own, which "super" does not reach. Write "this.x".`,
    )
    expect(only(BASE + `class B extends A { get y(): f32 { return super.nope } }${TAIL}`)).toBe(
      `${M} Nothing above this class declares an accessor "nope", so "super.nope" names nothing.`,
    )
    expect(only(BASE + `class B extends A { get y(): f32 { return super.s } }${TAIL}`)).toBe(
      `${M} "super.s" has a setter and no getter above this class, so there is nothing to read.`,
    )
    expect(only(BASE + `class B extends A { set y(v: f32) { super.g = v } }${TAIL}`)).toBe(
      `${M} "super.g" has a getter and no setter above this class, so it cannot be assigned.`,
    )
    expect(
      only(`"use typeshade"
export function run(): f32 { return super.x }${TAIL}`),
    ).toBe(
      `${M} "super" names the class above the one whose body it is written in; a top-level function has none.`,
    )
  })
})

describe('statics through a class that extends, this, new this() and super in a static member (Rule 8.13)', () => {
  it('a class reads the statics it inherits, and this is the class the call names', () => {
    const src = `"use typeshade"
class Base {
  x: f32 = 1.
  static K = 1.
  static get k(): f32 { return this.K }
  static a(): f32 { return this.b() }
  static b(): f32 { return this.K }
}
class Mid extends Base { static K = 2. }
class Leaf extends Mid { static K = 3.; static b(): f32 { return this.K * 100. } }
class Plain extends Base { y: f32 = 0. }
export function run(): f32 {
  return Base.a() + Mid.a() * 10. + Leaf.a() + Plain.K * 1000. + Leaf.k * 10000.
}${TAIL}`
    const r = compile(src)
    expect(r.diagnostics).toEqual([])
    // `Base.b`'s body lowered for `Mid`, with `this` as `Mid`: it reads `Mid`'s own `K`.
    expect(r.wgsl).toContain('fn Mid_b() -> f32 {\n  return Mid_K;')
    // `Leaf` overrides `b`, and `Base.a` lowered for `Leaf` calls `Leaf`'s.
    expect(r.wgsl).toContain('fn Leaf_a() -> f32 {\n  return Leaf_b();')
    // 1 + 2 * 10 + 300 + 1 * 1000 + 3 * 10000, as TypeScript computes it.
    expect(runAll(src)).toBe(31321)
  })

  it('a class of statics alone keeps its base: a struct over one with fields, else a namespace', () => {
    const src = `"use typeshade"
class U { static K = 3.; static a(): f32 { return this.K } }
class V extends U { static K = 4.; static b(): f32 { return U.a() + 1. } }
class B { x: f32 = 1. }
class D extends B { static k(): f32 { return 2. } }
export function run(): f32 { return V.a() + U.a() * 10. + V.b() * 100. + D.k() * 1000. + new D().x }${TAIL}`
    const r = compile(src)
    expect(r.diagnostics).toEqual([])
    // `V` extends a namespace and is one, so no struct; `D` has `B`'s field and is a struct.
    expect(r.wgsl).not.toContain('struct V')
    expect(r.wgsl).toContain('struct D {\n  x: f32,\n}')
    expect(r.wgsl).toContain('fn V_a() -> f32 {\n  return V_K;')
    // 4 + 30 + 400 + 2000 + 1.
    expect(runAll(src)).toBe(2435)
  })

  it('new this() builds the class the call names, and returns it', () => {
    const src = `"use typeshade"
class Base {
  x: f32 = 1.
  static make(): Base { return new this() }
  d(): f32 { return 1. }
}
class Derived extends Base {
  constructor() { super(); this.x = 5. }
  d(): f32 { return 2. }
}
export function run(): f32 {
  return Derived.make().x * 100. + Derived.make().d() * 10. + Base.make().d()
}${TAIL}`
    const r = compile(src)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('fn Derived_make() -> Derived {\n  return Derived_new();')
    expect(runAll(src)).toBe(521)
  })

  it("a static a class inherits writes that class's own static through this", () => {
    const src = `"use typeshade"
class Base { x: f32 = 1.; static hits = 0.; static record(): void { this.hits += 1. } }
class Derived extends Base { static hits = 10. }
export function run(): f32 {
  Derived.record()
  Base.record()
  return Base.hits * 100. + Derived.hits
}${TAIL}`
    const r = compile(src)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('var<private> Derived_hits: f32 = 10.0;')
    expect(r.wgsl).toContain('fn Derived_record() {\n  Derived_hits += 1.0;')
    expect(runAll(src)).toBe(111)
  })

  it("super in a static member runs the class above's static, with this the class the call names", () => {
    const src = `"use typeshade"
class A {
  x: f32 = 1.
  static K = 2.
  static #s = 1.
  static k(): f32 { return this.K }
  static get s(): f32 { return A.#s }
  static set s(v: f32) { A.#s = v }
}
class B extends A {
  static K = 5.
  static k(): f32 { return super.k() * 10. + A.k() }
  static both(): f32 { super.s = 4.; super.s += 1.; return super.K * 100. + super.s }
}
class C extends B { }
export function run(): f32 { return C.k() + B.both() * 1000. }${TAIL}`
    const r = compile(src)
    expect(r.diagnostics).toEqual([])
    // `super.k()` in `B.k`, run for `C`, is `A.k` with `this` as `C`, whose `K` is `B`'s.
    expect(r.wgsl).toContain('fn C_super_A_k() -> f32 {\n  return B_K;')
    // 5 * 10 + 2, and (2 * 100 + 5) * 1000.
    expect(runAll(src)).toBe(205052)
  })

  it('a write through a class that does not declare the static is refused, where it is written', () => {
    const BASE = `"use typeshade"
class Base { x: f32 = 1.; static count = 0.; static record(): void { this.count += 1. } }
class Derived extends Base { y: f32 = 0. }
`
    const WRITE =
      `${TS_CODES.CONST_ASSIGN} "Derived.count" is a static "Base" declares, and assigning it ` +
      `through "Derived" would give "Derived" a copy of its own in TypeScript. Write "Base.count".`
    expect(only(BASE + `export function run(): f32 { Derived.count++; return 1. }${TAIL}`)).toBe(
      WRITE,
    )
    // `Base.record` run for `Derived` writes through `this`, which is `Derived`: said once a
    // call makes it happen, and not at all while nothing does.
    expect(only(BASE + `export function run(): f32 { Derived.record(); return 1. }${TAIL}`)).toBe(
      WRITE,
    )
    expect(
      errorsOf(BASE + `export function run(): f32 { Base.record(); return Base.count }${TAIL}`),
    ).toEqual([])
    expect(
      only(`"use typeshade"
class Base { x: f32 = 1.; static K = 2. }
class Derived extends Base { static bump(): void { super.K = 3. } }${TAIL}`),
    ).toBe(
      `${M} Assigning "super.K" writes the static "K" of "this" in TypeScript, not the one "Base" declares. Write "this.K" or "Base.K".`,
    )
    expect(
      only(`"use typeshade"
class Base { x: f32 = 1. }
class Derived extends Base { static f(): f32 { return super.nope() } }${TAIL}`),
    ).toBe(
      `${M} Nothing above this class declares a static function "nope", so "super.nope" names no body.`,
    )
  })

  it('a private static reached through a class that extends its own is refused', () => {
    const MISS =
      `${M} "Derived" has no "#k": a private static is the class's own, and TypeScript throws ` +
      `where a body "Derived" inherits reaches it through "this". Name the class that declares ` +
      `it, "Base.#k".`
    const of = (body: string, call: string): string =>
      only(`"use typeshade"
class Base { x: f32 = 1.; static #k = 2.; ${body} static get(): f32 { return Base.#k } }
class Derived extends Base { y: f32 = 0. }
export function run(): f32 { ${call}; return Base.get() }${TAIL}`)
    expect(of('static n(): f32 { return this.#k }', 'Derived.n()')).toBe(MISS)
    expect(of('static bump(): void { this.#k += 1. }', 'Derived.bump()')).toBe(MISS)
    expect(
      of('static #h(): f32 { return 3. } static n(): f32 { return this.#h() }', 'Derived.n()'),
    ).toBe(MISS.replaceAll('#k', '#h'))
    // Named through the class that declares it, it is that class's, whoever runs the body.
    expect(
      runAll(`"use typeshade"
class Base { x: f32 = 1.; static #k = 2.; static n(): f32 { return Base.#k } }
class Derived extends Base { y: f32 = 0. }
export function run(): f32 { return Derived.n() }${TAIL}`),
    ).toBe(2)
  })

  it('an error in a body a class inherits is said once', () => {
    for (const member of ['d(): f32 { return nope }', 'static d(): f32 { return nope }']) {
      expect(
        only(`"use typeshade"
class Base { x: f32 = 1.; ${member} }
class Derived extends Base { y: f32 = 2. }${TAIL}`),
      ).toBe(`${TS_CODES.UNKNOWN_NAME} Unknown identifier "nope".`)
    }
  })

  it('a static field beside a function of its name is refused (Rule 8.12)', () => {
    expect(
      only(`"use typeshade"
class A { x: f32 = 1.; static #n = 2.; static n(): f32 { return A.#n } }${TAIL}`),
    ).toBe(
      `${M} The static field "A.#n" and the function "A.n" would both be "A_n": a private name is emitted without its "#". Rename one of them.`,
    )
    expect(
      only(`"use typeshade"
class A { x: f32 = 1.; static k = 2.; k(): f32 { return this.x } }${TAIL}`),
    ).toBe(
      `${M} The static field "A.k" and the function "A.k" would both be "A_k", where a class names its functions and its statics alike. Rename one of them.`,
    )
  })
})

describe('private and protected (Rule 8.15)', () => {
  const C = `"use typeshade"
class C {
  private x: f32 = 1.
  protected p: f32 = 2.
  y: f32 = 3.
  private pm(): f32 { return this.x }
  protected get pg(): f32 { return this.p }
  get mixed(): f32 { return this.y }
  private set mixed(v: f32) { this.y = v }
  private static ps = 4.
  protected static qs = 5.
  sum(): f32 { return this.x + this.p + this.pm() + this.pg + C.ps }
}
`
  it('each is named where TypeScript allows it, and is emitted as a public member is', () => {
    const src =
      C +
      `class D extends C {
  f(d: D): f32 { return this.p + this.pg + d.p + C.qs + D.qs }
}
export function run(): f32 { const c = new C(); const d = new D(); return c.sum() + c.y + c.mixed + d.f(d) }${TAIL}`
    const r = compile(src)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('struct C {\n  x: f32,\n  p: f32,\n  y: f32,\n}')
    expect(r.wgsl).toContain('fn C_pm(self_: C) -> f32')
    // 1 + 2 + 1 + 2 + 4, 3, 3, and 2 + 2 + 2 + 5 + 5.
    expect(runAll(src)).toBe(32)
  })

  it('each refusal names the member to reach it through', () => {
    const PRIVATE = (m: string): string =>
      `${M} "C.${m}" is private, so only the body of "C" may name it. Reach it through a public member of "C".`
    const PROTECTED = (m: string): string =>
      `${M} "C.${m}" is protected, so only "C" and the classes that extend it may name it. Reach it through a public member of "C".`
    expect(only(C + `export function run(c: C): f32 { return c.x }${TAIL}`)).toBe(PRIVATE('x'))
    expect(only(C + `class D extends C { g(): f32 { return this.x } }${TAIL}`)).toBe(PRIVATE('x'))
    expect(only(C + `export function run(c: C): f32 { return c.pm() }${TAIL}`)).toBe(PRIVATE('pm'))
    expect(
      only(
        C + `export function run(): f32 { let c = new C(); c.mixed = 3.; return c.mixed }${TAIL}`,
      ),
    ).toBe(PRIVATE('mixed'))
    expect(only(C + `export function run(): f32 { return C.ps }${TAIL}`)).toBe(PRIVATE('ps'))
    expect(only(C + `class D extends C { sum(): f32 { return super.pm() } }${TAIL}`)).toBe(
      PRIVATE('pm'),
    )
    expect(only(C + `export function run(c: C): f32 { return c.p }${TAIL}`)).toBe(PROTECTED('p'))
    expect(only(C + `export function run(c: C): f32 { return c.pg }${TAIL}`)).toBe(PROTECTED('pg'))
    expect(only(C + `export function run(): f32 { return C.qs }${TAIL}`)).toBe(PROTECTED('qs'))
    // TypeScript's TS2446: a class that extends "C" reaches "p" on its own kind of object only.
    expect(only(C + `class D extends C { f(o: C): f32 { return o.p } }${TAIL}`)).toBe(
      `${M} "C.p" is protected, and "D" may name it only on a "D"; this object is a "C". Reach it through a public member of "C".`,
    )
    expect(
      only(
        C + `export function run(): f32 { const c = new C(); const { x } = c; return 1. }${TAIL}`,
      ),
    ).toBe(PRIVATE('x'))
    expect(
      only(C + `export function run(): f32 { const c: C = { y: 1. }; return 1. }${TAIL}`),
    ).toBe(
      `${F} "C" has the private field "x", which an object literal cannot set. Build it with "new C(...)".`,
    )
    expect(
      only(`"use typeshade"
class V { constructor(private a: f32, protected b: f32) {} get s(): f32 { return this.a + this.b } }
export function run(v: V): f32 { return v.a }${TAIL}`),
    ).toBe(
      `${M} "V.a" is private, so only the body of "V" may name it. Reach it through a public member of "V".`,
    )
  })
})

describe('a chain of calls on one object (Rule 8.10)', () => {
  const V = `"use typeshade"
class V {
  x: f32 = 0.
  y: f32 = 0.
  setX(x: f32): this { this.x = x; return this }
  setY(y: f32): V { this.y = y; return this }
  scale(k: f32): this { this.x = this.x * k; this.y = this.y * k; return this }
  len(): f32 { return sqrt(this.x * this.x + this.y * this.y) }
}
`
  it('a chain that is a whole statement runs each call on the object it starts from', () => {
    const src =
      V +
      `export function run(): f32 { let v = new V(); v.setX(3.).setY(4.).scale(2.); return v.len() }${RUN_TAIL}`
    const r = compile(src)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('  V_setX(&v, 3.0);\n  V_setY(&v, 4.0);\n  V_scale(&v, 2.0);')
    expect(r.glsl?.fragment).toContain('  V_setX(v, 3.0);\n  V_setY(v, 4.0);\n  V_scale(v, 2.0);')
    expect(runAll(src)).toBe(10)
  })

  it('a new at the root is held in a temporary, in a declaration and in a return', () => {
    const src =
      V +
      `class W extends V {
  reset(): this { return this.setX(0.).setY(0.) }
}
export function run(): f32 {
  const v = new V().setX(3.).setY(4.)
  let w = new W()
  w.setX(5.)
  w.reset()
  let u = new V()
  const l = u.setX(6.).len()
  return v.len() * 100. + w.x + w.y + l + u.x
}${RUN_TAIL}`
    const r = compile(src)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain(
      '  var _chain: V = V_new();\n  V_setX(&_chain, 3.0);\n  let v = V_setY(&_chain, 4.0);',
    )
    // A chain that is a `return` runs its first call ahead of it, on the same object.
    expect(r.wgsl).toContain(
      'fn W_reset(self_: ptr<function, W>) -> W {\n  W_setX(self_, 0.0);\n  return W_setY(self_, 0.0);',
    )
    expect(r.glsl?.fragment).toContain('  V_setX(u, 6.0);\n  float l = V_len(u);')
    // 5 * 100, `w` reset to nothing, and `u` set to 6 before its length is read.
    expect(runAll(src)).toBe(512)
  })

  it('a read on what a chain returns inside an expression reads the copy; an inherited setter keeps its type', () => {
    expect(
      runAll(
        V +
          `export function run(): f32 { let v = new V(); return v.setX(3.).len() * 2. + v.x }${TAIL}`,
      ),
    ).toBe(9)
    expect(
      runAll(
        V +
          `class P extends V {
  init(): void { this.setX(1.).setY(2.) }
}
export function run(): f32 { let p = new P(); p.init(); return p.x * 10. + p.y }${TAIL}`,
      ),
    ).toBe(12)
  })

  it('a call that writes the copy inside a larger expression is refused, with the fix', () => {
    expect(
      only(
        V +
          `export function run(): f32 { let v = new V(); return v.setX(3.).setY(4.).len() + v.y }${TAIL}`,
      ),
    ).toBe(
      `${M} "V.setY" changes its object, and inside this expression it would change the copy "v.setX(3.)" hands back. Make the chain a statement of its own, or call each method on the object itself.`,
    )
    expect(
      only(
        V +
          `export function run(): f32 { const v = new V(); v.setX(3.).setY(4.); return v.x }${TAIL}`,
      ),
    ).toBe(`${M} "V.setX" changes its object, and "v" is declared with const; declare it with let.`)
  })
})

describe('what a review of the class surface found, each pinned', () => {
  it('a static super call that writes a static the derived class declares writes it (Rule 8.13)', () => {
    const src = `"use typeshade"
class Base { static hits = 0.; static record(): void { this.hits += 1. } }
class Mid extends Base { static record(): void { super.record() } }
class Derived extends Mid { static hits = 10. }
export function run(): f32 { Derived.record(); return Derived.hits * 100. + Base.hits }${RUN_TAIL}`
    expect(compile(src).wgsl).toContain('var<private> Derived_hits: f32 = 10.0;')
    expect(runAll(src)).toBe(1100)
    // Through `Mid`, which declares no `hits`, TypeScript would give `Mid` one of its own.
    expect(
      only(
        src.replace(
          'Derived.record(); return Derived.hits * 100. + Base.hits',
          'Mid.record(); return Base.hits',
        ),
      ),
    ).toBe(
      `${TS_CODES.CONST_ASSIGN} "Mid.hits" is a static "Base" declares, and assigning it through "Mid" would give "Mid" a copy of its own in TypeScript. Write "Base.hits".`,
    )
  })

  it('an inherited body that fails only for the class that inherits it is said where it is called', () => {
    // `Derived.next` writes `this.count` through `Derived`, which is refused; nothing calls it,
    // so it is dropped, and so is `Derived.twice`, which calls it: no call is left without its
    // function.
    const src = `"use typeshade"
class Base {
  static count = 0.
  static next(): f32 { this.count += 1.; return this.count }
  static twice(): f32 { return this.next() + this.next() }
}
class Derived extends Base { x: f32 = 1. }
export function run(): f32 { return Base.twice() }${RUN_TAIL}`
    const r = compile(src)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).not.toContain('Derived_next')
    expect(r.wgsl).not.toContain('Derived_twice')
    expect(runAll(src)).toBe(3)
    // An instance body is the same: `weigh(this)` takes a `Material`, and a `Presets` is not one.
    const PRESETS = `"use typeshade"
class Material { rough: f32 = 0.5; score(): f32 { return weigh(this) } }
function weigh(m: Material): f32 { return m.rough * 2. }
class Presets extends Material { static SHINY = 0.1 }
`
    expect(
      runAll(
        PRESETS +
          `export function run(): f32 { return new Material().score() + Presets.SHINY }${RUN_TAIL}`,
      ),
    ).toBeCloseTo(1.1, 6)
    expect(
      only(PRESETS + `export function run(): f32 { return new Presets().score() }${RUN_TAIL}`),
    ).toBe(
      `${TS_CODES.TYPE_MISMATCH} Argument 1 of "weigh" type mismatch. "Presets" extends "Material", and a name typed as the base cannot hold a derived value here: method dispatch is static, so a call through it would run "Material"'s body. Write "Presets" as the type.`,
    )
  })

  it('a write into a static a base declares changes the one object both classes read', () => {
    const src = `"use typeshade"
class P { x: f32 = 0.; bump(): void { this.x += 1. } }
class Base {
  y: f32 = 1.
  static origin = vec2(0.)
  static p: P = { x: 0. }
  static shift(d: f32): void { this.origin.x += d }
  static reset(): void { Base.p = { x: 0. } }
}
class Derived extends Base { z: f32 = 0. }
export function run(): f32 {
  Derived.origin.y = 5.
  Derived.shift(2.)
  Derived.p.bump()
  return Base.origin.x * 10. + Base.origin.y + Base.p.x * 100.
}${RUN_TAIL}`
    expect(runAll(src)).toBe(125)
  })

  it('statics reached through a generic base are the generic class own, one for every instance', () => {
    const src = `"use typeshade"
class Pair<T> { a: T; static K = 2.; static twice(): f32 { return this.K * 2. } constructor(a: T) { this.a = a } }
class FPair extends Pair<f32> {
  static total = 1.
  static g(): void { this.total = super.K * 3. }
}
export function run(): f32 { FPair.g(); return FPair.K + FPair.twice() * 10. + FPair.total * 100. }${RUN_TAIL}`
    expect(runAll(src)).toBe(642)
  })

  it('a class with no name compiles, and a private static accessor is its own class alone', () => {
    expect(
      errorsOf(`"use typeshade"
export default class { static count = 0.; static bump(): void { this.count += 1. } }${TAIL}`),
    ).toEqual([])
    const BASE = `"use typeshade"
class Base { x: f32 = 1.; static #v = 5.; static get #w(): f32 { return Base.#v } static read(): f32 { return this.#w } }
class Derived extends Base { y: f32 = 0. }
`
    expect(only(BASE + `export function run(): f32 { return Derived.read() }${RUN_TAIL}`)).toBe(
      `${M} "Derived" has no "#w": a private static is the class's own, and TypeScript throws where a body "Derived" inherits reaches it through "this". Name the class that declares it, "Base.#w".`,
    )
    expect(runAll(BASE + `export function run(): f32 { return Base.read() }${RUN_TAIL}`)).toBe(5)
  })

  it('a local the body names as its own class, built with new this(), is the class the call names', () => {
    const src = `"use typeshade"
class Shape {
  size: f32 = 1.
  static SCALE = 1.
  static unit(): Shape { let s: Shape = new this(); s.size = this.SCALE; return s }
  static pick(c: bool): Shape { if (c) { return new this() } return new Shape() }
}
class Big extends Shape { static SCALE = 4. }
export function run(): f32 { return Big.unit().size + Shape.unit().size * 10. + Shape.pick(true).size * 100. }${RUN_TAIL}`
    expect(runAll(src)).toBe(114)
  })

  it('an override is checked against the declaration the class that wrote the code sees (Rule 8.15)', () => {
    const src = `"use typeshade"
abstract class Material {
  base: f32 = 1.
  protected abstract weight(): f32
  shade(x: f32): f32 { return x * this.weight() * this.base }
}
class Metal extends Material { protected weight(): f32 { return 3. } }
class A { protected limit: f32 = 1.; get lim(): f32 { return this.limit } }
class B extends A { protected limit: f32 = 5. }
class C extends A { limit: f32 = 7. }
export function run(): f32 { return new Metal().shade(2.) + new B().lim * 10. + new C().limit * 100. }${RUN_TAIL}`
    // A public redeclaration of a protected field makes it public, as TypeScript allows.
    expect(runAll(src)).toBe(756)
    expect(
      only(`"use typeshade"
class A { protected limit: f32 = 1. }
class B extends A { y: f32 = 5. }
export function run(): f32 { return new B().limit }${RUN_TAIL}`),
    ).toBe(
      `${M} "A.limit" is protected, so only "A" and the classes that extend it may name it. Reach it through a public member of "A".`,
    )
  })

  it('the place a chain starts from is found once, before its first call (Rule 8.10)', () => {
    const src = `"use typeshade"
let cursor: i32 = 0
class Slot {
  x: f32 = 0.
  y: f32 = 0.
  claim(x: f32): Slot { this.x = x; cursor += 1; return this }
  tag(y: f32): Slot { this.y = y; return this }
}
export function run(): f32 {
  let slots = array(new Slot(), new Slot())
  slots[cursor].claim(1.).tag(2.)
  return slots[0].x + slots[0].y * 10. + slots[1].x * 100. + slots[1].y * 1000.
}${RUN_TAIL}`
    const r = compile(src)
    expect(r.wgsl).toContain(
      '  let _at = cursor;\n  Slot_claim(&slots[_at], 1.0);\n  Slot_tag(&slots[_at], 2.0);',
    )
    // `claim` moves `cursor`, and `tag` still tags the slot it claimed, as in TypeScript.
    expect(runAll(src)).toBe(21)
  })

  it('field initializers run in TypeScript order, a derived one last (Rule 8.14)', () => {
    const src = `"use typeshade"
class A { limit: f32 = 1.; constructor() { this.limit = this.limit + 1. } }
class B extends A { limit: f32 = 5.; doubled: f32 = this.limit * 2.; constructor() { super(); this.limit *= 10. } }
class C extends A { limit: f32 = 7. }
class D { x: f32 = 1. }
class E extends D { x: f32 = 3. }
export function run(): f32 {
  const b = new B()
  return b.limit + b.doubled * 1000. + new C().limit * 100000. + new E().x * 10000000. + new A().limit * 0.1
}${RUN_TAIL}`
    // B: A's initializer (1) and body (2), then B's own (5, and doubled 10), then B's body (50).
    // C inherits A's constructor: 1, 2, then its own 7. E has no constructor at all: 1, then 3.
    expect(runAll(src)).toBeCloseTo(50 + 10000 + 700000 + 30000000 + 0.2, 1)
  })
})

describe('the example', () => {
  it('examples/class-syntax.shade.ts renders the two rings on every CPU path', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const src = readFileSync(
      fileURLToPath(new URL('../../../examples/class-syntax.shade.ts', import.meta.url)),
      'utf8',
    )
    // On the unit ring's band: full gold, the counter having run twice.
    const input = { pos: [0, 0, 0, 1], uv: [0.5, 0] }
    expect(runAll(src, [input], 'fs')).toEqual({ color: [0.95, 0.74, 0.32, 1] })
    // Between the rings: the background, scaled the same way.
    expect(runAll(src, [{ pos: [0, 0, 0, 1], uv: [0, 0] }], 'fs')).toEqual({
      color: [0.07, 0.08, 0.14, 1],
    })
  })

  it('examples/class-builder.shade.ts renders the three discs on every CPU path', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const src = readFileSync(
      fileURLToPath(new URL('../../../examples/class-builder.shade.ts', import.meta.url)),
      'utf8',
    )
    const at = (uv: number[], color: number[]): void =>
      expectClose(runAll(src, [{ pos: [0, 0, 0, 1], uv }], 'fs'), { color })
    // The centre of each disc is its tint.
    at([-0.45, 0], [0.95, 0.74, 0.32, 1])
    at([0.4, 0], [0.3, 0.6, 0.95, 1])
    at([0, 0.55], [0.9, 0.3, 0.4, 1])
    // 0.32 from the blue disc's centre: outside, since its setter clamped `SIZE` and the doubling
    // to 0.3, where either unclamped would cover it.
    at([0.72, 0], [0.07, 0.08, 0.14, 1])
  })
})
