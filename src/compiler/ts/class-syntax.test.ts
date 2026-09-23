// The class syntax an ordinary TypeScript class is written in (§26, Rules 8.10 to 8.15):
// getters and setters, private names, parameter properties, a field typed by its initializer,
// a static field the file writes and `this` in a static member, and `readonly`; then `super` on
// an accessor and on a base method that writes its object, statics through a class that
// extends, `new this()` and `super` in a static member, `private` and `protected`, and a chain of
// calls on one object; then a method that changes an object its object holds, a `const` that
// holds an object, a field that holds a function, an interface with methods, and a call cycle
// through methods (Rules 6.9, 6.10, 8.4, 8.10 and 8.16).
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
//
// Verifies: Rule 8.1 (docs/language-design.md; traced in reqs/).
//
// Verifies: Rule 8.9 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { TS_CODES } from './codes.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { startDebugSession } from '../../core/debug/session.js';

const TAIL = `\n@fragment\nexport function fs(): vec4 { return vec4(1.) }\n`;
/** A tail whose entry calls `run`: the GLSL writer emits only what an entry reaches. */
const RUN_TAIL = `\n@fragment\nexport function fs(): vec4 { return vec4(run(), 0., 0., 1.) }\n`;

const errorsOf = (src: string): string[] =>
  compile(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`);

/** The one error `src` has, which the test then pins by code and text (Rule 12.4, 12.5). */
const only = (src: string): string => {
  const errors = errorsOf(src);
  expect(errors, src).toHaveLength(1);
  return errors[0]!;
};

/** `actual` against `expected`, a number within an `f32`'s precision: the debugger keeps an
 *  `f32` as one, where the oracle and the codegen carry it in a double, so the two agree to the
 *  last bit of an `f32` and no further. */
function expectClose(actual: unknown, expected: unknown): void {
  if (typeof expected === 'number') {
    expect(typeof actual).toBe('number');
    expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(
      1e-6 * Math.max(1, Math.abs(expected)),
    );
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).toBe(true);
    expected.forEach((e, i) => expectClose((actual as unknown[])[i], e));
    return;
  }
  if (expected !== null && typeof expected === 'object') {
    for (const [k, e] of Object.entries(expected)) {
      expectClose((actual as Record<string, unknown>)[k], e);
    }
    return;
  }
  expect(actual).toEqual(expected);
}

/** `fn(...args)` on the oracle, the CPU codegen and the debugger, which must agree. */
function runAll(src: string, args: unknown[] = [], fn = 'run'): unknown {
  const r = compile(src);
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const oracle = r.eval(fn, args);
  expect(compileModuleJs(r.module).fns[fn]!(...(args as never[]))).toEqual(oracle);
  const s = startDebugSession(r.module, fn, args as never[]);
  s.continue();
  expect(s.done).toBe(true);
  expectClose(s.result, oracle);
  return oracle;
}

const M = TS_CODES.CLASS_MEMBER;
const F = TS_CODES.STRUCT_FIELD;

describe('getters and setters (Rule 8.11)', () => {
  const TEMP = `"use typeshade";
class Temperature {
  #celsius: f32 = 0.;
  get celsius(): f32 { return this.#celsius; }
  set celsius(v: f32) { this.#celsius = max(v, -200.); }
  get fahrenheit(): f32 { return this.#celsius * 1.8 + 32.; }
  set fahrenheit(v) { this.celsius = (v - 32.) / 1.8; }
}
export function run(f: f32): f32 {
  let t = new Temperature();
  t.fahrenheit = f;
  t.celsius += 5.;
  t.celsius++;
  return t.celsius;
}
@fragment
export function fs(): vec4 { return vec4(run(212.), 0., 0., 1.); }
`;

  it('each half is a function: the getter reads its object, the setter writes through it', () => {
    const r = compile(TEMP);
    expect(r.diagnostics).toEqual([]);
    const w = r.wgsl!;
    expect(w).toContain('fn Temperature_get_celsius(self_: Temperature) -> f32 {');
    expect(w).toContain(
      'fn Temperature_set_celsius(self_: ptr<function, Temperature>, v: f32) {\n  (*self_).celsius = max(v, -200.0);\n}',
    );
    // `set fahrenheit(v)` takes the getter's type, and its `this.celsius = …` is the other
    // setter, handed the reference it holds.
    expect(w).toContain(
      'fn Temperature_set_fahrenheit(self_: ptr<function, Temperature>, v: f32) {\n  Temperature_set_celsius(self_, ((v - 32.0) / 1.8));\n}',
    );
    expect(w).toContain('Temperature_set_fahrenheit(&t, f);');
    expect(w).toContain('Temperature_set_celsius(&t, (Temperature_get_celsius(t) + 5.0));');
    expect(w).toContain('Temperature_set_celsius(&t, (Temperature_get_celsius(t) + 1.0));');
    expect(w).toContain('return Temperature_get_celsius(t);');
    const g = r.glsl!.fragment;
    expect(g).toContain('void Temperature_set_celsius(inout Temperature self_, float v) {');
    expect(g).toContain('float Temperature_get_celsius(Temperature self_) {');
  });

  it('the oracle, the codegen and the debugger agree', () => {
    // 212 °F is 100 °C; then += 5 and ++.
    expect(runAll(TEMP, [212])).toBeCloseTo(106, 5);
    // The setter clamps, and the compound forms go through it.
    expect(runAll(TEMP, [-1000])).toBe(-194);
  });

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
}${TAIL}`;
    const r = compile(src);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('var<private> Cfg_gain: f32 = 1.0;');
    expect(r.wgsl).toContain('fn Cfg_set_gain(v: f32) {\n  Cfg_gain = clamp(v, 0.0, 4.0);\n}');
    expect(r.wgsl).toContain('Cfg_set_gain(10.0);\n  Cfg_set_gain((Cfg_get_gain() - 1.0));');
    expect(runAll(src)).toBe(3);
  });

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
}${TAIL}`;
    const r = compile(src);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn Lazy_get_square(self_: ptr<function, Lazy>) -> f32 {');
    expect(r.wgsl).toContain('let _seq0 = Lazy_get_square(&l);');
    expect(runAll(src)).toBe(182);
  });

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
}${TAIL}`;
    expect(runAll(src)).toBe(116);
    // Derived overrides the getter alone, so it has no setter, as in TypeScript.
    expect(only(src.replace('return b.v + d.v', 'd.v = 1.\n  return d.v'))).toBe(
      `${M} "Derived.v" has a getter and no setter, so it cannot be assigned. Declare "set v(value)" beside the getter.`,
    );
  });

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
export function run(): f32 { return new Sq(3.).describe() }${TAIL}`;
    expect(runAll(src)).toBe(18);
  });

  it('what is refused, and the fix', () => {
    const C = (members: string, use = '') =>
      `"use typeshade"\nclass C {\n  x: f32\n${members}\n}\n${use}${TAIL}`;
    expect(
      only(
        C(
          '  get y(): f32 { return this.x }',
          'export function run(): f32 { let c = new C(); c.y = 2.; return c.x }',
        ),
      ),
    ).toBe(
      `${M} "C.y" has a getter and no setter, so it cannot be assigned. Declare "set y(value)" beside the getter.`,
    );
    expect(
      only(
        C(
          '  set y(v: f32) { this.x = v }',
          'export function run(): f32 { let c = new C(); c.y = 2.; return c.y }',
        ),
      ),
    ).toBe(
      `${M} "C.y" has a setter and no getter, so there is nothing to read. Declare "get y()" beside the setter.`,
    );
    expect(
      only(
        C(
          '  set y(v: f32) { this.x = v }',
          'export function run(): f32 { let c = new C(); c.y += 2.; return c.x }',
        ),
      ),
    ).toBe(
      `${M} "C.y" has a setter and no getter, so there is nothing for this assignment to read. Declare "get y()" beside the setter, or assign it with "=".`,
    );
    // A getter that writes no type says it in its body, and a setter's value that writes none
    // takes what the getter returns (Rule 8.19); with no getter, nothing says its type, and an
    // assignment to it adds nothing to the one refusal (Rule 12.4).
    expect(errorsOf(C('  get y() { return this.x }'))).toEqual([]);
    expect(errorsOf(C('  get y() { return this.x }\n  set y(v) { this.x = v }'))).toEqual([]);
    expect(
      only(
        C(
          '  set y(v) { this.x = v }',
          'export function run(): f32 { let c = new C(); c.y = 2.; return c.x }',
        ),
      ),
    ).toBe(`${TS_CODES.UNKNOWN_TYPE} The setter "C.y" needs a type for "v": write "set y(v: T)".`);
    expect(
      only(
        C('  get y(): f32 { return this.x }', 'export function run(): f32 { return new C().y() }'),
      ),
    ).toBe(`${M} "C.y" is an accessor, not a method; read or assign it without the call: v.y.`);
    expect(only(C('  get y(): f32 { return 1. }\n  get y(): f32 { return 2. }'))).toBe(
      `${M} "C.y" has two getters; an accessor has one body.`,
    );
    expect(only(C('  get y(): f32 { return 1. }\n  get_y(): f32 { return 2. }'))).toBe(
      `${M} "C.get y" and "C.get_y" would both be the function "C_get_y". Rename one of them.`,
    );
    expect(only(C('  y: f32\n  get y(): f32 { return 2. }'))).toBe(
      `${M} "C.y" is declared as a field and as an accessor; a class member has one kind. Rename one of them.`,
    );
  });

  it('a write into what a getter returns is refused: it would change a copy', () => {
    const src = `"use typeshade"
class C {
  #p: vec3 = vec3(0.)
  get p(): vec3 { return this.#p }
  set p(v: vec3) { this.#p = v }
}
export function run(): f32 { let c = new C(); c.p.x = 2.; return c.p.x }${TAIL}`;
    expect(only(src)).toBe(
      `${TS_CODES.ASSIGN_TARGET} "c.p.x" writes into what the getter "C.p" returns, which is a copy, so the write would be lost. Assign the whole property, or add a method that changes the field.`,
    );
  });

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
}${TAIL}`;
    expect(only(src)).toBe(
      `${M} "cs[pick(1)].v" reads through the getter and writes through the setter, so "cs[pick(1)]" would run twice. Bind it to a let first.`,
    );
  });
});

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
}${TAIL}`;

  it('a private member is emitted without its "#", beside a public accessor of the same name', () => {
    const r = compile(COUNTER);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('struct Counter {\n  count: u32,\n}');
    expect(r.wgsl).toContain('const Counter_limit: f32 = 3.0;');
    expect(r.wgsl).toContain('fn Counter_clamped(self_: Counter, n: u32) -> u32 {');
    expect(r.wgsl).toContain('fn Counter_get_count(self_: Counter) -> u32 {');
    expect(runAll(COUNTER)).toBe(3);
  });

  it('only the class that declares a private name may use it', () => {
    expect(
      only(`"use typeshade"
class C { #x: f32 = 1. }
export function run(c: C): f32 { return c.#x }${TAIL}`),
    ).toBe(
      `${M} "#x" is private to "C", and this code is outside its class body. Reach it through a member "C" declares without the "#".`,
    );
    expect(
      only(`"use typeshade"
class C { #x: f32 = 1. }
class D { y: f32; read(c: C): f32 { return c.#x } }${TAIL}`),
    ).toBe(
      `${M} "#x" is private to "C", and this code is outside its class body. Reach it through a member "C" declares without the "#".`,
    );
    // A public name never reaches a private member: `c.x` is not `#x`.
    expect(
      only(`"use typeshade"
class C { #x: f32 = 1. }
export function run(c: C): f32 { return c.x }${TAIL}`),
    ).toBe(`${TS_CODES.UNKNOWN_NAME} Unknown field "x" on struct:C.`);
  });

  it('a body inherited from the class that declares it may use it', () => {
    const src = `"use typeshade"
class Base {
  #hits: f32 = 0.
  hit(): void { this.#hits = this.#next(this.#hits) }
  #next(n: f32): f32 { return n + 1. }
  get hits(): f32 { return this.#hits }
}
class Derived extends Base { bonus: f32 = 5. }
export function run(): f32 { let d = new Derived(); d.hit(); d.hit(); return d.hits + d.bonus }${TAIL}`;
    const r = compile(src);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn Derived_hit(self_: ptr<function, Derived>) {');
    expect(runAll(src)).toBe(7);
  });

  it('two members of one chain on one emitted name are refused, once', () => {
    expect(only(`"use typeshade"\nclass C { #v: f32 = 1.; v: f32 = 2. }${TAIL}`)).toBe(
      `${F} "C" declares "#v" and "v", which would both be the struct member "v": a private name is emitted without its "#". Rename one of them.`,
    );
    expect(
      only(`"use typeshade"
class Base { #v: f32 = 1.; get bv(): f32 { return this.#v } }
class Derived extends Base { #v: f32 = 2.; get dv(): f32 { return this.#v } }${TAIL}`),
    ).toBe(
      `${F} "Base" declares "#v" and "Derived" declares "#v", which would both be the struct member "v": a private name is emitted without its "#". Rename one of them.`,
    );
    expect(
      only(`"use typeshade"
class Base { x: f32; #h(): f32 { return 1. } run(): f32 { return this.#h() } }
class Derived extends Base { h(): f32 { return 2. } }${TAIL}`),
    ).toBe(
      `${M} "Derived.h" and "Base.#h" would both be the function "Derived_h": a private name is emitted without its "#". Rename one of them.`,
    );
    expect(only(`"use typeshade"\nclass C { static #n = 1.; static n = 2.; x: f32 }${TAIL}`)).toBe(
      `${M} "C.#n" and "C.n" would both be the module constant "C_n": a private name is emitted without its "#". Rename one of them.`,
    );
  });

  it('a literal cannot build a class with a private field; a spread and a pattern leave it out', () => {
    expect(
      only(`"use typeshade"
class C { #x: f32 = 1.; y: f32 = 2. }
export function run(): f32 { const c: C = { y: 1. }; return 1. }${TAIL}`),
    ).toBe(
      `${F} "C" has the private field "#x", which an object literal cannot set. Build it with "new C(...)".`,
    );
    expect(
      runAll(`"use typeshade"
class C { #x: f32 = 1.; y: f32 = 2.; get x(): f32 { return this.#x } }
interface D { y: f32 }
export function run(): f32 { const c = new C(); const d: D = { ...c }; const { y } = c; return d.y + y + c.x }${TAIL}`),
    ).toBe(5);
    expect(
      errorsOf(`"use typeshade"
class C { #x: f32 = 1.; y: f32 = 2. }
export function run(): f32 { const c = new C(); const { x } = c; return 1. }${TAIL}`),
    ).toEqual([`${TS_CODES.UNKNOWN_NAME} "C" has no field "x".`]);
  });

  it('a destructuring pattern reads a getter by calling it', () => {
    expect(
      runAll(`"use typeshade"
class R { w: f32 = 2.; h: f32 = 3.; get area(): f32 { return this.w * this.h } }
export function run(): f32 { const r = new R(); const { area, w } = r; return area + w }${TAIL}`),
    ).toBe(8);
  });
});

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
}${TAIL}`;

  it('a written static is a module variable, an unwritten one a constant', () => {
    const r = compile(STATS);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('var<private> Stats_hits: f32 = 0.0;');
    expect(r.wgsl).toContain('var<private> Stats_made: f32 = 0.0;');
    expect(r.wgsl).toContain('const Stats_WEIGHT: f32 = 0.5;');
    expect(r.wgsl).toContain('Stats_hits += (v * Stats_WEIGHT);');
    expect(r.glsl?.fragment).toContain('float Stats_hits = 0.0;');
    // hits = 2 + 1, made = 1, plus the value.
    expect(runAll(STATS)).toBe(14);
  });

  it('a write to a readonly static, and new on this outside a static member, are refused', () => {
    expect(
      only(`"use typeshade"
class C { static readonly K = 3.; x: f32 }
export function run(): f32 { C.K = 4.; return C.K }${TAIL}`),
    ).toBe(`${TS_CODES.CONST_ASSIGN} Cannot assign to "C.K" — it is static readonly.`);
    // `new this()` builds the class in a static member; in a method `this` is the object.
    expect(
      only(`"use typeshade"
class A { x: f32 = 1.; clone(): A { return new this() } }${TAIL}`),
    ).toBe(
      `${TS_CODES.HOST_STMT} "this" here is an object, not a class, so "new" cannot build one from it. Name the class, "new A(...)"; "new this()" builds the class in a static member.`,
    );
  });
});

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
}${TAIL}`;
    const r = compile(src);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('struct V {\n  twice: f32,\n  x: f32,\n  y: f32,\n  z: f32,\n}');
    expect(r.wgsl).toContain(
      'self_.x = x;\n  self_.y = y;\n  self_.z = z;\n  self_.twice = (self_.x * 2.0);',
    );
    expect(runAll(src)).toBe(848);
  });

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
}${TAIL}`;
    const r = compile(src);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain(
      'struct C {\n  hits: f32,\n  on: bool,\n  v: vec3<f32>,\n  n: u32,\n  neg: f32,\n  p: P,\n}',
    );
    expect(runAll(src)).toBe(4.5);
  });

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
    ]);
  });

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
    ).toBe(12);
    const RO = TS_CODES.CONST_ASSIGN;
    expect(
      only(`"use typeshade"\nclass P { readonly id: u32 = 0; bump(): void { this.id++ } }${TAIL}`),
    ).toBe(
      `${RO} Cannot assign to "this.id" — "id" is readonly, so only the constructor of "P" may assign it.`,
    );
    expect(
      only(`"use typeshade"
class P { constructor(readonly w: f32) {} }
export function run(): f32 { let p = new P(1.); p.w += 2.; return p.w }${TAIL}`),
    ).toBe(
      `${RO} Cannot assign to "p.w" — "w" is readonly, so only the constructor of "P" may assign it.`,
    );
    expect(
      only(`"use typeshade"
class A { readonly v: f32 = 1. }
class B extends A { constructor() { super(); this.v = 2. } }${TAIL}`),
    ).toBe(
      `${RO} Cannot assign to "this.v" — "v" is readonly, so only the constructor of "A" may assign it.`,
    );
  });

  it('a static block is refused, with the fix', () => {
    expect(only(`"use typeshade"\nclass C { static K = 1.; static { } x: f32 }${TAIL}`)).toBe(
      `${M} A static block runs when the class is defined, and a shader has no such moment. Give each static field its value where it is declared.`,
    );
  });
});

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
}${RUN_TAIL}`;

  it("super.x runs the base's half lowered for this class, on this body's object", () => {
    const r = compile(COUNTER);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain(
      'fn Clamped_set_value(self_: ptr<function, Clamped>, v: f32) {\n  Clamped_super_Counter_set_value(self_, min(v, 10.0));',
    );
    expect(r.wgsl).toContain(
      'fn Clamped_get_value(self_: Clamped) -> f32 {\n  return Clamped_super_Counter_get_value(self_);',
    );
    // A compound assignment through `super` reads through the base's getter and writes through
    // its setter.
    expect(r.wgsl).toContain(
      'Clamped_super_Counter_set_value(self_, (Clamped_super_Counter_get_value((*self_)) * 2.0));',
    );
    expect(r.glsl?.fragment).toContain(
      'void Clamped_super_Counter_set_value(inout Clamped self_, float v)',
    );
  });

  it('a base body called through super that writes its object takes it by reference', () => {
    const r = compile(COUNTER);
    expect(r.wgsl).toContain(
      'fn Clamped_super_Counter_bump(self_: ptr<function, Clamped>) {\n  (*self_).n += 1.0;',
    );
    expect(r.wgsl).toContain('Clamped_super_Counter_bump(self_);');
    // c: 2.5, bumped to 3.5, doubled to 7; d: 3, doubled twice to 12 through the base's
    // setter, which `super.value *= 2.` reaches directly and which does not clamp.
    expect(runAll(COUNTER)).toBe(712);
  });

  it('what is refused, and the fix', () => {
    const BASE = `"use typeshade";
class A { x: f32 = 1.; get g(): f32 { return this.x; } set s(v: f32) { this.x = v; } }
`;
    expect(only(BASE + `class B extends A { get y(): f32 { return super.x } }${TAIL}`)).toBe(
      `${M} "super.x" names a field, and a field is the object's own, which "super" does not reach. Write "this.x".`,
    );
    expect(only(BASE + `class B extends A { get y(): f32 { return super.nope } }${TAIL}`)).toBe(
      `${M} Nothing above this class declares an accessor "nope", so "super.nope" names nothing.`,
    );
    expect(only(BASE + `class B extends A { get y(): f32 { return super.s } }${TAIL}`)).toBe(
      `${M} "super.s" has a setter and no getter above this class, so there is nothing to read.`,
    );
    expect(only(BASE + `class B extends A { set y(v: f32) { super.g = v } }${TAIL}`)).toBe(
      `${M} "super.g" has a getter and no setter above this class, so it cannot be assigned.`,
    );
    expect(
      only(`"use typeshade"
export function run(): f32 { return super.x }${TAIL}`),
    ).toBe(
      `${M} "super" names the class above the one whose body it is written in; a top-level function has none.`,
    );
  });
});

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
}${TAIL}`;
    const r = compile(src);
    expect(r.diagnostics).toEqual([]);
    // `Base.b`'s body lowered for `Mid`, with `this` as `Mid`: it reads `Mid`'s own `K`.
    expect(r.wgsl).toContain('fn Mid_b() -> f32 {\n  return Mid_K;');
    // `Leaf` overrides `b`, and `Base.a` lowered for `Leaf` calls `Leaf`'s.
    expect(r.wgsl).toContain('fn Leaf_a() -> f32 {\n  return Leaf_b();');
    // 1 + 2 * 10 + 300 + 1 * 1000 + 3 * 10000, as TypeScript computes it.
    expect(runAll(src)).toBe(31321);
  });

  it('a class of statics alone keeps its base: a struct over one with fields, else a namespace', () => {
    const src = `"use typeshade"
class U { static K = 3.; static a(): f32 { return this.K } }
class V extends U { static K = 4.; static b(): f32 { return U.a() + 1. } }
class B { x: f32 = 1. }
class D extends B { static k(): f32 { return 2. } }
export function run(): f32 { return V.a() + U.a() * 10. + V.b() * 100. + D.k() * 1000. + new D().x }${TAIL}`;
    const r = compile(src);
    expect(r.diagnostics).toEqual([]);
    // `V` extends a namespace and is one, so no struct; `D` has `B`'s field and is a struct.
    expect(r.wgsl).not.toContain('struct V');
    expect(r.wgsl).toContain('struct D {\n  x: f32,\n}');
    expect(r.wgsl).toContain('fn V_a() -> f32 {\n  return V_K;');
    // 4 + 30 + 400 + 2000 + 1.
    expect(runAll(src)).toBe(2435);
  });

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
}${TAIL}`;
    const r = compile(src);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn Derived_make() -> Derived {\n  return Derived_new();');
    expect(runAll(src)).toBe(521);
  });

  it("a static a class inherits writes that class's own static through this", () => {
    const src = `"use typeshade"
class Base { x: f32 = 1.; static hits = 0.; static record(): void { this.hits += 1. } }
class Derived extends Base { static hits = 10. }
export function run(): f32 {
  Derived.record()
  Base.record()
  return Base.hits * 100. + Derived.hits
}${TAIL}`;
    const r = compile(src);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('var<private> Derived_hits: f32 = 10.0;');
    expect(r.wgsl).toContain('fn Derived_record() {\n  Derived_hits += 1.0;');
    expect(runAll(src)).toBe(111);
  });

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
export function run(): f32 { return C.k() + B.both() * 1000. }${TAIL}`;
    const r = compile(src);
    expect(r.diagnostics).toEqual([]);
    // `super.k()` in `B.k`, run for `C`, is `A.k` with `this` as `C`, whose `K` is `B`'s.
    expect(r.wgsl).toContain('fn C_super_A_k() -> f32 {\n  return B_K;');
    // 5 * 10 + 2, and (2 * 100 + 5) * 1000.
    expect(runAll(src)).toBe(205052);
  });

  it('a write through a class that does not declare the static is refused, where it is written', () => {
    const BASE = `"use typeshade";
class Base { x: f32 = 1.; static count = 0.; static record(): void { this.count += 1.; } }
class Derived extends Base { y: f32 = 0.; }
`;
    const WRITE =
      `${TS_CODES.CONST_ASSIGN} "Derived.count" is a static "Base" declares, and assigning it ` +
      `through "Derived" would give "Derived" a copy of its own in TypeScript. Write "Base.count".`;
    expect(only(BASE + `export function run(): f32 { Derived.count++; return 1. }${TAIL}`)).toBe(
      WRITE,
    );
    // `Base.record` run for `Derived` writes through `this`, which is `Derived`: said once a
    // call makes it happen, and not at all while nothing does.
    expect(only(BASE + `export function run(): f32 { Derived.record(); return 1. }${TAIL}`)).toBe(
      WRITE,
    );
    expect(
      errorsOf(BASE + `export function run(): f32 { Base.record(); return Base.count }${TAIL}`),
    ).toEqual([]);
    expect(
      only(`"use typeshade"
class Base { x: f32 = 1.; static K = 2. }
class Derived extends Base { static bump(): void { super.K = 3. } }${TAIL}`),
    ).toBe(
      `${M} Assigning "super.K" writes the static "K" of "this" in TypeScript, not the one "Base" declares. Write "this.K" or "Base.K".`,
    );
    expect(
      only(`"use typeshade"
class Base { x: f32 = 1. }
class Derived extends Base { static f(): f32 { return super.nope() } }${TAIL}`),
    ).toBe(
      `${M} Nothing above this class declares a static function "nope", so "super.nope" names no body.`,
    );
  });

  it('a private static reached through a class that extends its own is refused', () => {
    const MISS =
      `${M} "Derived" has no "#k": a private static is the class's own, and TypeScript throws ` +
      `where a body "Derived" inherits reaches it through "this". Name the class that declares ` +
      `it, "Base.#k".`;
    const of = (body: string, call: string): string =>
      only(`"use typeshade"
class Base { x: f32 = 1.; static #k = 2.; ${body} static get(): f32 { return Base.#k } }
class Derived extends Base { y: f32 = 0. }
export function run(): f32 { ${call}; return Base.get() }${TAIL}`);
    expect(of('static n(): f32 { return this.#k }', 'Derived.n()')).toBe(MISS);
    expect(of('static bump(): void { this.#k += 1. }', 'Derived.bump()')).toBe(MISS);
    expect(
      of('static #h(): f32 { return 3. } static n(): f32 { return this.#h() }', 'Derived.n()'),
    ).toBe(MISS.replaceAll('#k', '#h'));
    // Named through the class that declares it, it is that class's, whoever runs the body.
    expect(
      runAll(`"use typeshade"
class Base { x: f32 = 1.; static #k = 2.; static n(): f32 { return Base.#k } }
class Derived extends Base { y: f32 = 0. }
export function run(): f32 { return Derived.n() }${TAIL}`),
    ).toBe(2);
  });

  it('an error in a body a class inherits is said once', () => {
    for (const member of ['d(): f32 { return nope }', 'static d(): f32 { return nope }']) {
      expect(
        only(`"use typeshade"
class Base { x: f32 = 1.; ${member} }
class Derived extends Base { y: f32 = 2. }${TAIL}`),
      ).toBe(`${TS_CODES.UNKNOWN_NAME} Unknown identifier "nope".`);
    }
  });

  it('a static field beside a function of its name is refused (Rule 8.12)', () => {
    expect(
      only(`"use typeshade"
class A { x: f32 = 1.; static #n = 2.; static n(): f32 { return A.#n } }${TAIL}`),
    ).toBe(
      `${M} The static field "A.#n" and the function "A.n" would both be "A_n": a private name is emitted without its "#". Rename one of them.`,
    );
    expect(
      only(`"use typeshade"
class A { x: f32 = 1.; static k = 2.; k(): f32 { return this.x } }${TAIL}`),
    ).toBe(
      `${M} The static field "A.k" and the function "A.k" would both be "A_k", where a class names its functions and its statics alike. Rename one of them.`,
    );
  });
});

describe('private and protected (Rule 8.15)', () => {
  const C = `"use typeshade";
class C {
  private x: f32 = 1.;
  protected p: f32 = 2.;
  y: f32 = 3.;
  private pm(): f32 { return this.x; }
  protected get pg(): f32 { return this.p; }
  get mixed(): f32 { return this.y; }
  private set mixed(v: f32) { this.y = v; }
  private static ps = 4.;
  protected static qs = 5.;
  sum(): f32 { return this.x + this.p + this.pm() + this.pg + C.ps; }
}
`;
  it('each is named where TypeScript allows it, and is emitted as a public member is', () => {
    const src =
      C +
      `class D extends C {
  f(d: D): f32 { return this.p + this.pg + d.p + C.qs + D.qs }
}
export function run(): f32 { const c = new C(); const d = new D(); return c.sum() + c.y + c.mixed + d.f(d) }${TAIL}`;
    const r = compile(src);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('struct C {\n  x: f32,\n  p: f32,\n  y: f32,\n}');
    expect(r.wgsl).toContain('fn C_pm(self_: C) -> f32');
    // 1 + 2 + 1 + 2 + 4, 3, 3, and 2 + 2 + 2 + 5 + 5.
    expect(runAll(src)).toBe(32);
  });

  it('each refusal names the member to reach it through', () => {
    const PRIVATE = (m: string): string =>
      `${M} "C.${m}" is private, so only the body of "C" may name it. Reach it through a public member of "C".`;
    const PROTECTED = (m: string): string =>
      `${M} "C.${m}" is protected, so only "C" and the classes that extend it may name it. Reach it through a public member of "C".`;
    expect(only(C + `export function run(c: C): f32 { return c.x }${TAIL}`)).toBe(PRIVATE('x'));
    expect(only(C + `class D extends C { g(): f32 { return this.x } }${TAIL}`)).toBe(PRIVATE('x'));
    expect(only(C + `export function run(c: C): f32 { return c.pm() }${TAIL}`)).toBe(PRIVATE('pm'));
    expect(
      only(
        C + `export function run(): f32 { let c = new C(); c.mixed = 3.; return c.mixed }${TAIL}`,
      ),
    ).toBe(PRIVATE('mixed'));
    expect(only(C + `export function run(): f32 { return C.ps }${TAIL}`)).toBe(PRIVATE('ps'));
    expect(only(C + `class D extends C { sum(): f32 { return super.pm() } }${TAIL}`)).toBe(
      PRIVATE('pm'),
    );
    expect(only(C + `export function run(c: C): f32 { return c.p }${TAIL}`)).toBe(PROTECTED('p'));
    expect(only(C + `export function run(c: C): f32 { return c.pg }${TAIL}`)).toBe(PROTECTED('pg'));
    expect(only(C + `export function run(): f32 { return C.qs }${TAIL}`)).toBe(PROTECTED('qs'));
    // TypeScript's TS2446: a class that extends "C" reaches "p" on its own kind of object only.
    expect(only(C + `class D extends C { f(o: C): f32 { return o.p } }${TAIL}`)).toBe(
      `${M} "C.p" is protected, and "D" may name it only on a "D"; this object is a "C". Reach it through a public member of "C".`,
    );
    expect(
      only(
        C + `export function run(): f32 { const c = new C(); const { x } = c; return 1. }${TAIL}`,
      ),
    ).toBe(PRIVATE('x'));
    expect(
      only(C + `export function run(): f32 { const c: C = { y: 1. }; return 1. }${TAIL}`),
    ).toBe(
      `${F} "C" has the private field "x", which an object literal cannot set. Build it with "new C(...)".`,
    );
    expect(
      only(`"use typeshade"
class V { constructor(private a: f32, protected b: f32) {} get s(): f32 { return this.a + this.b } }
export function run(v: V): f32 { return v.a }${TAIL}`),
    ).toBe(
      `${M} "V.a" is private, so only the body of "V" may name it. Reach it through a public member of "V".`,
    );
  });
});

describe('a chain of calls on one object (Rule 8.10)', () => {
  const V = `"use typeshade";
class V {
  x: f32 = 0.;
  y: f32 = 0.;
  setX(x: f32): this { this.x = x; return this; }
  setY(y: f32): V { this.y = y; return this; }
  scale(k: f32): this { this.x = this.x * k; this.y = this.y * k; return this; }
  len(): f32 { return sqrt(this.x * this.x + this.y * this.y); }
}
`;
  it('a chain that is a whole statement runs each call on the object it starts from', () => {
    const src =
      V +
      `export function run(): f32 { let v = new V(); v.setX(3.).setY(4.).scale(2.); return v.len() }${RUN_TAIL}`;
    const r = compile(src);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('  V_setX(&v, 3.0);\n  V_setY(&v, 4.0);\n  V_scale(&v, 2.0);');
    expect(r.glsl?.fragment).toContain('  V_setX(v, 3.0);\n  V_setY(v, 4.0);\n  V_scale(v, 2.0);');
    expect(runAll(src)).toBe(10);
  });

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
}${RUN_TAIL}`;
    const r = compile(src);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain(
      '  var _chain: V = V_new();\n  V_setX(&_chain, 3.0);\n  let v = V_setY(&_chain, 4.0);',
    );
    // A chain that is a `return` runs its first call ahead of it, on the same object.
    expect(r.wgsl).toContain(
      'fn W_reset(self_: ptr<function, W>) -> W {\n  W_setX(self_, 0.0);\n  return W_setY(self_, 0.0);',
    );
    expect(r.glsl?.fragment).toContain('  V_setX(u, 6.0);\n  float l = V_len(u);');
    // 5 * 100, `w` reset to nothing, and `u` set to 6 before its length is read.
    expect(runAll(src)).toBe(512);
  });

  it('a read on what a chain returns inside an expression reads the copy; an inherited setter keeps its type', () => {
    expect(
      runAll(
        V +
          `export function run(): f32 { let v = new V(); return v.setX(3.).len() * 2. + v.x }${TAIL}`,
      ),
    ).toBe(9);
    expect(
      runAll(
        V +
          `class P extends V {
  init(): void { this.setX(1.).setY(2.) }
}
export function run(): f32 { let p = new P(); p.init(); return p.x * 10. + p.y }${TAIL}`,
      ),
    ).toBe(12);
  });

  it('a call that writes the copy inside a larger expression is refused, with the fix', () => {
    expect(
      only(
        V +
          `export function run(): f32 { let v = new V(); return v.setX(3.).setY(4.).len() + v.y }${TAIL}`,
      ),
    ).toBe(
      `${M} "V.setY" changes its object, and inside this expression it would change the copy "v.setX(3.)" hands back. Make the chain a statement of its own, or call each method on the object itself.`,
    );
    expect(
      only(
        V +
          `export function run(): f32 { let a = new V(); const v = a; v.setX(3.).setY(4.); return v.x }${TAIL}`,
      ),
    ).toBe(
      `${M} "V.setX" changes its object, and "v" is a const whose value may be one something else holds, which TypeScript would change with it and a copy here would not. Declare it with let to change a copy, or call it on the value itself.`,
    );
  });
});

describe('what a review of the class surface found, each pinned', () => {
  it('a static super call that writes a static the derived class declares writes it (Rule 8.13)', () => {
    const src = `"use typeshade"
class Base { static hits = 0.; static record(): void { this.hits += 1. } }
class Mid extends Base { static record(): void { super.record() } }
class Derived extends Mid { static hits = 10. }
export function run(): f32 { Derived.record(); return Derived.hits * 100. + Base.hits }${RUN_TAIL}`;
    expect(compile(src).wgsl).toContain('var<private> Derived_hits: f32 = 10.0;');
    expect(runAll(src)).toBe(1100);
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
    );
  });

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
export function run(): f32 { return Base.twice() }${RUN_TAIL}`;
    const r = compile(src);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).not.toContain('Derived_next');
    expect(r.wgsl).not.toContain('Derived_twice');
    expect(runAll(src)).toBe(3);
    // An instance body is the same: `weigh(this)` takes a `Material`, and a `Presets` is not one.
    const PRESETS = `"use typeshade";
class Material { rough: f32 = 0.5; score(): f32 { return weigh(this); } }
function weigh(m: Material): f32 { return m.rough * 2.; }
class Presets extends Material { static SHINY = 0.1; }
`;
    expect(
      runAll(
        PRESETS +
          `export function run(): f32 { return new Material().score() + Presets.SHINY }${RUN_TAIL}`,
      ),
    ).toBeCloseTo(1.1, 6);
    expect(
      only(PRESETS + `export function run(): f32 { return new Presets().score() }${RUN_TAIL}`),
    ).toBe(
      `${TS_CODES.TYPE_MISMATCH} Argument 1 of "weigh" type mismatch. "Presets" extends "Material", and a name typed as the base cannot hold a derived value here: method dispatch is static, so a call through it would run "Material"'s body. Write "Presets" as the type.`,
    );
  });

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
}${RUN_TAIL}`;
    expect(runAll(src)).toBe(125);
  });

  it('statics reached through a generic base are the generic class own, one for every instance', () => {
    const src = `"use typeshade"
class Pair<T> { a: T; static K = 2.; static twice(): f32 { return this.K * 2. } constructor(a: T) { this.a = a } }
class FPair extends Pair<f32> {
  static total = 1.
  static g(): void { this.total = super.K * 3. }
}
export function run(): f32 { FPair.g(); return FPair.K + FPair.twice() * 10. + FPair.total * 100. }${RUN_TAIL}`;
    expect(runAll(src)).toBe(642);
  });

  it('a class with no name compiles, and a private static accessor is its own class alone', () => {
    expect(
      errorsOf(`"use typeshade"
export default class { static count = 0.; static bump(): void { this.count += 1. } }${TAIL}`),
    ).toEqual([]);
    const BASE = `"use typeshade";
class Base { x: f32 = 1.; static #v = 5.; static get #w(): f32 { return Base.#v; } static read(): f32 { return this.#w; } }
class Derived extends Base { y: f32 = 0.; }
`;
    expect(only(BASE + `export function run(): f32 { return Derived.read() }${RUN_TAIL}`)).toBe(
      `${M} "Derived" has no "#w": a private static is the class's own, and TypeScript throws where a body "Derived" inherits reaches it through "this". Name the class that declares it, "Base.#w".`,
    );
    expect(runAll(BASE + `export function run(): f32 { return Base.read() }${RUN_TAIL}`)).toBe(5);
  });

  it('a local the body names as its own class, built with new this(), is the class the call names', () => {
    const src = `"use typeshade"
class Shape {
  size: f32 = 1.
  static SCALE = 1.
  static unit(): Shape { let s: Shape = new this(); s.size = this.SCALE; return s }
  static pick(c: bool): Shape { if (c) { return new this() } return new Shape() }
}
class Big extends Shape { static SCALE = 4. }
export function run(): f32 { return Big.unit().size + Shape.unit().size * 10. + Shape.pick(true).size * 100. }${RUN_TAIL}`;
    expect(runAll(src)).toBe(114);
  });

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
export function run(): f32 { return new Metal().shade(2.) + new B().lim * 10. + new C().limit * 100. }${RUN_TAIL}`;
    // A public redeclaration of a protected field makes it public, as TypeScript allows.
    expect(runAll(src)).toBe(756);
    expect(
      only(`"use typeshade"
class A { protected limit: f32 = 1. }
class B extends A { y: f32 = 5. }
export function run(): f32 { return new B().limit }${RUN_TAIL}`),
    ).toBe(
      `${M} "A.limit" is protected, so only "A" and the classes that extend it may name it. Reach it through a public member of "A".`,
    );
  });

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
}${RUN_TAIL}`;
    const r = compile(src);
    expect(r.wgsl).toContain(
      '  let _at = cursor;\n  Slot_claim(&slots[_at], 1.0);\n  Slot_tag(&slots[_at], 2.0);',
    );
    // `claim` moves `cursor`, and `tag` still tags the slot it claimed, as in TypeScript.
    expect(runAll(src)).toBe(21);
  });

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
}${RUN_TAIL}`;
    // B: A's initializer (1) and body (2), then B's own (5, and doubled 10), then B's body (50).
    // C inherits A's constructor: 1, 2, then its own 7. E has no constructor at all: 1, then 3.
    expect(runAll(src)).toBeCloseTo(50 + 10000 + 700000 + 30000000 + 0.2, 1);
  });
});

describe('a method that changes an object its object holds (Rule 8.10)', () => {
  const SHIP = `"use typeshade"
class Body {
  pos: vec2 = vec2(0.)
  vel: vec2 = vec2(1., 0.5)
  step(dt: f32): void { this.pos += this.vel * dt }
}
class Ship {
  hull: Body = new Body()
  drift(dt: f32): vec2 {
    this.hull.step(dt)
    return this.hull.pos
  }
}
export function run(): f32 {
  let ship = new Ship()
  const at = ship.drift(0.5)
  ship.drift(1.)
  return at.x * 100. + ship.hull.pos.y
}${RUN_TAIL}`;

  it('a changing call on a field of this takes this by reference, whichever class it is', () => {
    const r = compile(SHIP);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain(
      'fn Ship_drift(self_: ptr<function, Ship>, dt: f32) -> vec2<f32> {\n  Body_step(&(*self_).hull, dt);\n  return (*self_).hull.pos;\n}',
    );
    expect(r.glsl!.fragment).toContain('vec2 Ship_drift(inout Ship self_, float dt) {');
    // 0.5 from the first drift, then 0.25 + 0.5 on y.
    expect(runAll(SHIP)).toBeCloseTo(50.75, 5);
  });

  it('at any depth, through an element, a getter and a chain, and before the class is declared', () => {
    // Three levels: Top.run calls Mid.go, which calls Leaf.bump.
    expect(
      runAll(`"use typeshade"
class Leaf { v: f32 = 1.; bump(): void { this.v *= 2. } }
class Mid { leaf: Leaf = new Leaf(); go(): void { this.leaf.bump() } }
class Top { mid: Mid = new Mid(); run(): f32 { this.mid.go(); this.mid.leaf.bump(); return this.mid.leaf.v } }
export function run(): f32 { let t = new Top(); const r = t.run(); return r + t.mid.leaf.v * 10. }${RUN_TAIL}`),
    ).toBe(44);
    // An element of a field.
    expect(
      runAll(`"use typeshade"
class Leaf { v: f32 = 1.; bump(): void { this.v *= 2. } }
class Pool { items: array<Leaf, 2> = [new Leaf(), new Leaf()]; bumpAt(i: i32): void { this.items[i].bump() } }
export function run(): f32 { let p = new Pool(); p.bumpAt(1); p.bumpAt(1); return p.items[0].v + p.items[1].v * 10. }${RUN_TAIL}`),
    ).toBe(41);
    // The class that holds the field is declared first.
    expect(
      runAll(`"use typeshade"
class Outer { inner: Inner = new Inner(); step(): f32 { return this.inner.next() } }
class Inner { v: f32 = 0.; next(): f32 { this.v += 1.; return this.v } }
export function run(): f32 { let o = new Outer(); o.step(); return o.step() }${RUN_TAIL}`),
    ).toBe(2);
    // A chain of return-this methods on a field.
    expect(
      runAll(`"use typeshade"
class V { x: f32 = 0.; y: f32 = 0.; setX(v: f32): V { this.x = v; return this } setY(v: f32): V { this.y = v; return this } }
class Holder { v: V = new V(); init(): void { this.v.setX(1.).setY(2.) } }
export function run(): f32 { let h = new Holder(); h.init(); return h.v.x * 10. + h.v.y }${RUN_TAIL}`),
    ).toBe(12);
    // A getter that writes its object, read on a field.
    expect(
      runAll(`"use typeshade"
class Cache { hits: f32 = 0.; get value(): f32 { this.hits += 1.; return this.hits } }
class User { c: Cache = new Cache(); read(): f32 { return this.c.value + this.c.value } }
export function run(): f32 { let u = new User(); return u.read() * 10. + u.c.hits }${RUN_TAIL}`),
    ).toBe(32);
  });

  it("a method that reads a field's object only keeps its object by value", () => {
    const src = `"use typeshade"
class Inner { v: f32 = 1.; get(): f32 { return this.v } }
class Outer { inner: Inner = new Inner(); peek(): f32 { return this.inner.get() } }
export function run(): f32 { const o = new Outer(); return o.peek() }${RUN_TAIL}`;
    expect(compile(src).wgsl).toContain('fn Outer_peek(self_: Outer) -> f32 {');
    expect(runAll(src)).toBe(1);
  });
});

describe('a const that holds an object (Rule 6.10)', () => {
  const V = `"use typeshade";
class V { x: f32 = 0.; y: f32 = 0.; setX(v: f32): V { this.x = v; return this; } bump(): void { this.x += 1.; } }
`;

  it('a write through a const that built its value changes it, and the const is a var from then', () => {
    const src = `${V}export function run(): f32 { const v = new V(); v.bump(); v.bump(); return v.x }${RUN_TAIL}`;
    const r = compile(src);
    expect(r.wgsl).toContain('var v: V = V_new();\n  V_bump(&v);\n  V_bump(&v);');
    expect(runAll(src)).toBe(2);
    const cases: [string, number][] = [
      [`${V}export function run(): f32 { const v = new V(); v.x = 3.; return v.x }`, 3],
      [`${V}export function run(): f32 { const v: V = { x: 5., y: 0. }; v.bump(); return v.x }`, 6],
      [
        `"use typeshade"\nexport function run(): f32 { const v = vec3(0.); v.x = 4.; return v.x }`,
        4,
      ],
      [
        `"use typeshade"\nexport function run(): f32 { const xs: array<f32, 3> = [1., 2., 3.]; xs[1] = 9.; return xs[1] }`,
        9,
      ],
      [`${V}export function run(): f32 { const v = new V().setX(2.); v.bump(); return v.x }`, 3],
      [`${V}export function run(): f32 { const v = new V(); v.setX(2.).bump(); return v.x }`, 3],
      [
        `"use typeshade"\nclass In { v: f32 = 1.; bump(): void { this.v += 1. } }\nclass Out { i: In = new In() }\nexport function run(): f32 { const o = new Out(); o.i.bump(); o.i.v *= 10.; return o.i.v }`,
        20,
      ],
      [
        `${V}export function run(): f32 { let s = 0.; for (let k = 0; k < 3; k++) { const v = new V(); v.x = f32(k); s += v.x } return s }`,
        3,
      ],
    ];
    for (const [body, want] of cases) expect(runAll(body + RUN_TAIL), body).toBe(want);
  });

  it('a const nothing writes through stays a let', () => {
    const src = `${V}export function run(): f32 { const v = new V(); return v.x + 1. }${RUN_TAIL}`;
    expect(compile(src).wgsl).toContain('let v = V_new();');
    expect(runAll(src)).toBe(1);
  });

  it('a const whose value something else may hold is refused, with both fixes', () => {
    expect(
      only(
        `${V}export function run(): f32 { let a = new V(); const b = a; b.x = 5.; return a.x }${RUN_TAIL}`,
      ),
    ).toBe(
      `${TS_CODES.CONST_ASSIGN} "b" is a const whose value may be one something else holds, which TypeScript would change with it and a copy here would not. Declare it with let to write a copy, or write through the value itself.`,
    );
    expect(
      only(
        `${V}export function run(): f32 { let a = new V(); const b = a; b.bump(); return a.x }${RUN_TAIL}`,
      ),
    ).toBe(
      `${M} "V.bump" changes its object, and "b" is a const whose value may be one something else holds, which TypeScript would change with it and a copy here would not. Declare it with let to change a copy, or call it on the value itself.`,
    );
    // A function's result may be a value something else holds.
    expect(
      only(
        `${V}function mk(): V { return new V() }\nexport function run(): f32 { const b = mk(); b.bump(); return b.x }${RUN_TAIL}`,
      ),
    ).toContain(`${M} "V.bump" changes its object, and "b" is a const whose value may be`);
    // The name itself is still bound once.
    expect(
      only(
        `${V}export function run(): f32 { const v = new V(); v = new V(); return v.x }${RUN_TAIL}`,
      ),
    ).toBe(`${TS_CODES.CONST_ASSIGN} Cannot assign to "v" — it is declared with const.`);
  });
});

describe('a field that holds a function (Rule 8.16)', () => {
  it("is a method under the field's name, with this the object", () => {
    const cases: [string, number][] = [
      [
        `class A { x: f32 = 2.; double = (): f32 => this.x * 2. }\nexport function run(): f32 { return new A().double() }`,
        4,
      ],
      [
        `class A { x: f32 = 2.; bump = (by: f32): void => { this.x += by } }\nexport function run(): f32 { let a = new A(); a.bump(3.); return a.x }`,
        5,
      ],
      [
        `class A { x: f32 = 2.; triple = function (this: A): f32 { return this.x * 3. } }\nexport function run(): f32 { return new A().triple() }`,
        6,
      ],
      [
        `class A { x: f32 = 2.; #half = (): f32 => this.x * 0.5; get h(): f32 { return this.#half() } }\nexport function run(): f32 { return new A().h }`,
        1,
      ],
      // An override by another field, and one of a method, as TypeScript lets a property stand
      // where a method was.
      [
        `class A { x: f32 = 2.; f = (): f32 => this.x; g(): f32 { return this.f() * 10. } }\nclass B extends A { f = (): f32 => this.x + 1. }\nexport function run(): f32 { return new B().g() + new A().g() }`,
        50,
      ],
      [
        `class A { x: f32 = 1.; f(): f32 { return 1. } g(): f32 { return this.f() } }\nclass B extends A { f = (): f32 => 2. }\nexport function run(): f32 { return new B().g() + new A().g() * 10. }`,
        12,
      ],
      [
        `abstract class A { x: f32 = 1.; abstract f(): f32; g(): f32 { return this.f() * 10. } }\nclass B extends A { f = (): f32 => 2. }\nexport function run(): f32 { return new B().g() }`,
        20,
      ],
    ];
    for (const [body, want] of cases) {
      expect(runAll(`"use typeshade"\n${body}${RUN_TAIL}`), body).toBe(want);
    }
    const w = compile(
      `"use typeshade"\nclass A { x: f32 = 2.; bump = (by: f32): void => { this.x += by } }\nexport function run(): f32 { let a = new A(); a.bump(3.); return a.x }${RUN_TAIL}`,
    ).wgsl;
    expect(w).toContain('fn A_bump(self_: ptr<function, A>, by: f32) {');
    expect(w).toContain('A_bump(&a, 3.0);');
  });

  it('what is refused, with the fix', () => {
    const C = (member: string): string =>
      `"use typeshade"\nclass A { x: f32 = 1.; ${member} }\nexport function run(): f32 { return 1. }${RUN_TAIL}`;
    expect(only(C('static f = (): f32 => 1.'))).toBe(
      `${M} A static field holding a function is a static method: write "static f(...) { ... }".`,
    );
    expect(only(C('f = <T>(v: T): T => v'))).toBe(
      `${M} "A.f" takes type parameters, and a method does not; write it as a generic function of the module.`,
    );
    // An expression body with no return type returns its value, whose type it is (Rule 8.19).
    expect(errorsOf(C('f = () => this.x'))).toEqual([]);
    // The sentence a method of the same shape gets, beside the one its `Promise` gets.
    expect(errorsOf(C('f = async (): Promise<f32> => 1.'))).toContain(
      `${M} "A.f" is a plain method or nothing: no async, no generator.`,
    );
  });

  it('a member keeps its kind down a class chain, as TypeScript requires', () => {
    const R = (classes: string): string =>
      only(`"use typeshade"\n${classes}\nexport function run(): f32 { return 1. }${RUN_TAIL}`);
    // TS2425, through a class that does not declare it.
    expect(
      R(
        `class A { x: f32 = 1.; f = (): f32 => 1. }\nclass B extends A { }\nclass C extends B { f(): f32 { return 2. } }`,
      ),
    ).toBe(
      `${M} "C.f" is a method, and the "A.f" it overrides is a field that holds a function; TypeScript refuses an override of another kind. Declare it as a field that holds a function, or rename it.`,
    );
    // TS2425 on a field of a shader type, TS2426, TS2423, TS2610: each compiled before, to the
    // derived class's member.
    expect(
      R(`class A { x: f32 = 1.; f: f32 = 1. }\nclass B extends A { f(): f32 { return 2. } }`),
    ).toBe(
      `${M} "B.f" is a method, and the "A.f" it overrides is a field; TypeScript refuses an override of another kind. Declare it as a field, or rename it.`,
    );
    expect(
      R(
        `class A { x: f32 = 1.; get f(): f32 { return 1. } }\nclass B extends A { f(): f32 { return 2. } }`,
      ),
    ).toBe(
      `${M} "B.f" is a method, and the "A.f" it overrides is an accessor; TypeScript refuses an override of another kind. Declare it as an accessor, or rename it.`,
    );
    // A getter and a setter are one member, said once.
    expect(
      R(
        `class A { x: f32 = 1.; f(): f32 { return 1. } }\nclass B extends A { get f(): f32 { return 2. } set f(v: f32) { this.x = v } }`,
      ),
    ).toBe(
      `${M} "B.f" is an accessor, and the "A.f" it overrides is a method; TypeScript refuses an override of another kind. Declare it as a method, or rename it.`,
    );
    expect(
      R(
        `class A { x: f32 = 1.; get f(): f32 { return 1. } }\nclass B extends A { f = (): f32 => 2. }`,
      ),
    ).toBe(
      `${M} "B.f" is a field that holds a function, and the "A.f" it overrides is an accessor; TypeScript refuses an override of another kind. Declare it as an accessor, or rename it.`,
    );
    // A parameter property is a field.
    expect(
      R(`class A { constructor(public f: f32) {} }\nclass B extends A { f(): f32 { return 2. } }`),
    ).toContain(`${M} "B.f" is a method, and the "A.f" it overrides is a field;`);
    // TS2855: a field is the object's own.
    expect(
      R(
        `class A { x: f32 = 1.; f = (): f32 => 1. }\nclass B extends A { g(): f32 { return super.f() } }`,
      ),
    ).toBe(
      `${M} "super.f" names a field that holds a function, and a field is the object's own, which "super" does not reach. Declare "A.f" as a method, or write "this.f".`,
    );
    // TypeScript takes this one; a struct here cannot mean it.
    expect(
      R(
        `abstract class A { x: f32 = 1.; abstract f: f32; g(): f32 { return this.f * 10. } }\nclass B extends A { get f(): f32 { return 2. } }`,
      ),
    ).toBe(
      `${M} "B.f" is an accessor, and the "A.f" it overrides is an abstract field, which every struct below "A" holds as a member, so a read of it would never reach the accessor. Declare it in "A" as "abstract get f(): f32".`,
    );
    // What TypeScript allows compiles: a field over an abstract accessor, and the fix above.
    expect(
      runAll(`"use typeshade"
abstract class A { x: f32 = 1.; abstract get f(): f32; g(): f32 { return this.f * 10. } }
class B extends A { f: f32 = 2. }
export function run(): f32 { return new B().g() }${RUN_TAIL}`),
    ).toBe(20);
    expect(
      runAll(`"use typeshade"
abstract class A { x: f32 = 1.; abstract get f(): f32; g(): f32 { return this.f * 10. } }
class B extends A { get f(): f32 { return 2. } }
export function run(): f32 { return new B().g() }${RUN_TAIL}`),
    ).toBe(20);
  });
});

describe('an interface with methods is a contract (Rule 6.9)', () => {
  const I = `"use typeshade";
interface HasArea { area(): f32 }
class Sq implements HasArea { s: f32 = 2.; area(): f32 { return this.s * this.s; } }
class Ci implements HasArea { r: f32 = 1.; area(): f32 { return 3. * this.r * this.r; } }
`;

  it('implements and a type parameter it constrains compile, one function per class', () => {
    expect(runAll(`${I}export function run(): f32 { return new Sq().area() }${RUN_TAIL}`)).toBe(4);
    const src = `${I}function total<T extends HasArea>(a: T): f32 { return a.area() }\nexport function run(): f32 { return total(new Sq()) + total(new Ci()) }${RUN_TAIL}`;
    const w = compile(src).wgsl!;
    expect(w).toContain('fn total_Sq(a: Sq) -> f32 {\n  return Sq_area(a);\n}');
    expect(w).toContain('fn total_Ci(a: Ci) -> f32 {');
    expect(w).not.toContain('struct HasArea');
    expect(runAll(src)).toBe(7);
  });

  it('a value of its own type is refused once, where it declares the method, with the fix', () => {
    const refusal = `${F} "HasArea" declares a method, so it is a contract a class implements and not a value a shader holds: take the class that implements it, or a type parameter it constrains, "<T extends HasArea>(v: T)".`;
    expect(
      only(
        `${I}function total(a: HasArea): f32 { return a.area() }\nexport function run(): f32 { return total(new Sq()) }${RUN_TAIL}`,
      ),
    ).toBe(refusal);
    expect(
      only(
        `${I}class Holder { shape: HasArea; x: f32 = 1. }\nexport function run(): f32 { return 1. }${RUN_TAIL}`,
      ),
    ).toBe(refusal);
  });

  it('an interface of fields alone is a struct, as it was', () => {
    expect(
      runAll(`"use typeshade"
interface P { x: f32; y: f32 }
function len(p: P): f32 { return p.x + p.y }
export function run(): f32 { const p: P = { x: 1., y: 2. }; return len(p) }${RUN_TAIL}`),
    ).toBe(3);
  });
});

describe('a call cycle through methods (Rule 8.4)', () => {
  const cycle = (names: string): string =>
    `${TS_CODES.RECURSION} Recursive call: ${names}. WGSL has no call stack, so a function must not take part in a call cycle.`;
  const R = (body: string): string => only(`"use typeshade"\n${body}${RUN_TAIL}`);

  it('is said at the call that closes it, named as written', () => {
    const src = `"use typeshade"
class N { x: f32 = 1.; f(n: i32): f32 { return n <= 0 ? this.x : this.g(n - 1) } g(n: i32): f32 { return this.f(n) } }
export function run(): f32 { return new N().f(2) }${RUN_TAIL}`;
    const d = compile(src).diagnostics.filter((x) => x.category === 'error');
    expect(d.map((x) => `${x.code} ${x.message}`)).toEqual([cycle('"N.f" -> "N.g" -> "N.f"')]);
    expect(src.slice(d[0]!.start, d[0]!.start + d[0]!.length)).toBe('this.f(n)');
    expect(
      R(`class N { x: f32 = 1.; f(n: i32): f32 { return n <= 0 ? this.x : this.f(n - 1) } }
export function run(): f32 { return new N().f(2) }`),
    ).toBe(cycle('"N.f" -> "N.f"'));
    // Through a top-level function, a getter, a setter and new.
    expect(
      R(`class N { x: f32 = 1.; f(n: i32): f32 { return top(this, n) } }
function top(o: N, n: i32): f32 { return n <= 0 ? o.x : o.f(n - 1) }
export function run(): f32 { return new N().f(2) }`),
    ).toBe(cycle('"N.f" -> "top" -> "N.f"'));
    expect(
      R(`class N { x: f32 = 1.; get a(): f32 { return this.b } get b(): f32 { return this.a } }
export function run(): f32 { return new N().a }`),
    ).toBe(cycle('"N.a" -> "N.b" -> "N.a"'));
    expect(
      R(`class N { x: f32 = 1.; set v(a: f32) { this.x = a; this.w = a } set w(a: f32) { this.v = a } }
export function run(): f32 { let n = new N(); n.v = 2.; return n.x }`),
    ).toBe(cycle('"N.v" -> "N.w" -> "N.v"'));
    expect(
      R(`class N { x: f32 = 1.; constructor() { this.x = new N().x } }
export function run(): f32 { return new N().x }`),
    ).toBe(cycle('"new N" -> "new N"'));
    // In a branch the optimizer would drop, as a call written by name is (Rule 8.4).
    expect(
      R(`class N { x: f32 = 1.; f(n: i32): f32 { if (false) { return this.f(n) } return this.x } }
export function run(): f32 { return new N().f(2) }`),
    ).toBe(cycle('"N.f" -> "N.f"'));
  });

  it('once for a body a class inherits, once for a generic, and a static by its written name', () => {
    expect(
      R(`class A { x: f32 = 1.; f(n: i32): f32 { return n <= 0 ? this.x : this.g(n - 1) } g(n: i32): f32 { return this.f(n) } }
class B extends A { y: f32 = 2. }
export function run(): f32 { return new B().f(2) + new A().f(1) }`),
    ).toBe(cycle('"A.f" -> "A.g" -> "A.f"'));
    expect(
      R(`function top<T>(n: i32, v: T): T { return n <= 0 ? v : top(n - 1, v) }
export function run(): f32 { return top(2, 1.) + f32(top(1, 2)) }`),
    ).toBe(cycle('"top" -> "top"'));
    expect(
      R(`class N { static f(n: i32): f32 { return n <= 0 ? 1. : N.f(n - 1) } }
export function run(): f32 { return N.f(2) }`),
    ).toBe(cycle('"N.f" -> "N.f"'));
    expect(
      R(`class N { static f(n: i32): f32 { return n <= 0 ? 1. : this.f(n - 1) } }
export function run(): f32 { return N.f(2) }`),
    ).toBe(cycle('"N.f" -> "N.f"'));
  });

  it('a method called twice is no cycle', () => {
    expect(
      runAll(`"use typeshade"
class A { x: f32 = 1.; f(): f32 { return this.x } g(): f32 { return this.f() + this.f() } }
export function run(): f32 { return new A().g() }${RUN_TAIL}`),
    ).toBe(2);
  });
});

describe('the example', () => {
  it('examples/class-syntax.shade.ts renders the two rings on every CPU path', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(
      fileURLToPath(new URL('../../../examples/class-syntax.shade.ts', import.meta.url)),
      'utf8',
    );
    // On the unit ring's band: full gold, the counter having run twice.
    const input = { pos: [0, 0, 0, 1], uv: [0.5, 0] };
    expect(runAll(src, [input], 'fs')).toEqual({ color: [0.95, 0.74, 0.32, 1] });
    // Between the rings: the background, scaled the same way.
    expect(runAll(src, [{ pos: [0, 0, 0, 1], uv: [0, 0] }], 'fs')).toEqual({
      color: [0.07, 0.08, 0.14, 1],
    });
  });

  it('examples/class-builder.shade.ts renders the three discs on every CPU path', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(
      fileURLToPath(new URL('../../../examples/class-builder.shade.ts', import.meta.url)),
      'utf8',
    );
    const at = (uv: number[], color: number[]): void =>
      expectClose(runAll(src, [{ pos: [0, 0, 0, 1], uv }], 'fs'), { color });
    // The centre of each disc is its tint.
    at([-0.45, 0], [0.95, 0.74, 0.32, 1]);
    at([0.4, 0], [0.3, 0.6, 0.95, 1]);
    at([0, 0.55], [0.9, 0.3, 0.4, 1]);
    // 0.32 from the blue disc's centre: outside, since its setter clamped `SIZE` and the doubling
    // to 0.3, where either unclamped would cover it.
    at([0.72, 0], [0.07, 0.08, 0.14, 1]);
  });

  it('examples/class-parts.shade.ts renders the ring and the dot on every CPU path', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(
      fileURLToPath(new URL('../../../examples/class-parts.shade.ts', import.meta.url)),
      'utf8',
    );
    const at = (uv: number[], color: number[]): void =>
      expectClose(runAll(src, [{ pos: [0, 0, 0, 1], uv }], 'fs'), { color });
    // On the ring, whose centre `advance` moved to (0.25, 0.1) through the `Mover` it holds: a
    // ring left at the origin would not reach this point.
    at([0.55, 0.1], [0.95, 0.7, 0.3, 1]);
    // The dot's centre, and the ring's, which neither covers.
    at([-0.45, -0.3], [0.3, 0.7, 0.95, 1]);
    at([0.25, 0.1], [0.06, 0.07, 0.12, 1]);
  });
});

describe('TS8035 refuses what its catalogue entry says, and nothing that compiles', () => {
  // The CLASS_MEMBER comment in codes.ts listed a getter or setter, an overload, a static field
  // and a method that assigns to `this` as refused; after #190 each of them compiles. The
  // comment is what a reader of the code catalogue takes as the contract, so it is pinned
  // against the compiler: each shape it says compiles, compiles, and each it says is refused
  // is TS8035.
  const COMPILES: Record<string, string> = {
    'a getter and a setter': `class A { x: f32; get y(): f32 { return this.x } set y(v: f32) { this.x = v } }
export function f(a: A): f32 { return a.y }`,
    'a static field': `class A { x: f32; static K: f32 = 2. }
export function f(a: A): f32 { return a.x * A.K }`,
    'a static method': `class A { x: f32; static k(): f32 { return 2. } }
export function f(a: A): f32 { return a.x * A.k() }`,
    'an overload signature': `class A { x: f32; m(a: f32): f32; m(a: f32): f32 { return a } }
export function f(a: A): f32 { return a.m(1.) }`,
    'an abstract member': `abstract class B { x: f32; abstract m(): f32 }
class A extends B { m(): f32 { return this.x } }
export function f(a: A): f32 { return a.m() }`,
    'a # private name': `class A { #x: f32; m(): f32 { return this.#x } }
export function f(a: A): f32 { return a.m() }`,
    'a method that changes its object': `class A { x: f32; bump(): void { this.x = this.x + 1. } }
export function f(): f32 { let a: A = { x: 1. }; a.bump(); return a.x }`,
    'a field holding a function': `class A { x: f32; m = (a: f32): f32 => a }
export function f(a: A): f32 { return a.m(a.x) }`,
    'a method that changes its object on a const that built it': `class A { x: f32; bump(): void { this.x = this.x + 1. } }
export function f(): f32 { const a: A = { x: 1. }; a.bump(); return a.x }`,
  };
  const REFUSED: Record<string, string> = {
    'a field holding a function when the field is static': `class A { x: f32; static m = (a: f32): f32 => a }
export function f(a: A): f32 { return a.x }`,
    'a name declared as another kind than the class it extends declares it': `class B { x: f32; m = (a: f32): f32 => a }
class A extends B { m(a: f32): f32 { return a } }
export function f(a: A): f32 { return a.x }`,
    'super naming a field holding a function': `class B { x: f32; m = (a: f32): f32 => a }
class A extends B { n(): f32 { return super.m(1.) } }
export function f(a: A): f32 { return a.x }`,
    'a static block': `class A { x: f32; static { } }
export function f(a: A): f32 { return a.x }`,
    'an index signature': `class A { x: f32; [k: string]: f32 }
export function f(a: A): f32 { return a.x }`,
    'a second constructor': `class A { x: f32; constructor(x: f32) { this.x = x } constructor(y: f32) { this.x = y } }
export function f(a: A): f32 { return a.x }`,
    'a decorator on a method': `class A { x: f32; @vertex m(): f32 { return this.x } }
export function f(a: A): f32 { return a.x }`,
    'an async method': `class A { x: f32; async m(): f32 { return 1. } }
export function f(a: A): f32 { return a.x }`,
    'one name as two kinds': `class A { x: f32; x(): f32 { return 1. } }
export function f(a: A): f32 { return a.x }`,
    'a parameter named self_': `class A { x: f32; m(self_: f32): f32 { return self_ } }
export function f(a: A): f32 { return a.x }`,
    'this outside a method': `class A { x: f32 }
export function f(a: A): f32 { return this.x }`,
    'an instance method on the class': `class A { x: f32; m(): f32 { return this.x } }
export function f(a: A): f32 { return A.m() }`,
    'a static method on a value': `class A { x: f32; static k(): f32 { return 2. } }
export function f(a: A): f32 { return a.k() }`,
    'a # member outside its class': `class A { #x: f32; m(): f32 { return this.#x } }
export function f(a: A): f32 { return a.#x }`,
    'a getter with no setter assigned': `class A { x: f32; get y(): f32 { return this.x } }
export function f(): f32 { let a: A = { x: 1. }; a.y = 2.; return a.x }`,
    'a mutating method on a parameter': `class A { x: f32; bump(): void { this.x = this.x + 1. } }
export function f(a: A): f32 { a.bump(); return a.x }`,
    'a mutating method on a const that copies': `class A { x: f32; bump(): void { this.x = this.x + 1. } }
export function f(a: A): f32 { const b = a; b.bump(); return b.x }`,
    'new on a class of statics only': `class A { static k(): f32 { return 1. } }
export function f(): f32 { const a = new A(); return 1. }`,
  };

  it.each(Object.entries(COMPILES))('compiles %s', (_what, body) => {
    expect(compile(`"use typeshade"\n${body}`).diagnostics).toEqual([]);
  });

  it.each(Object.entries(REFUSED))('refuses %s as TS8035', (_what, body) => {
    const codes = compile(`"use typeshade"\n${body}`).diagnostics.map((d) => d.code);
    expect(codes[0]).toBe(TS_CODES.CLASS_MEMBER);
  });

  it('does not list a shape that compiles among the refused ones', () => {
    const CODES_TS = fileURLToPath(new URL('./codes.ts', import.meta.url));
    const src = readFileSync(CODES_TS, 'utf8');
    const doc = src.slice(
      src.lastIndexOf('/**', src.indexOf("CLASS_MEMBER: 'TS8035'")),
      src.indexOf("CLASS_MEMBER: 'TS8035'"),
    );
    const refused = doc.slice(doc.indexOf('What is refused'));
    expect(doc).toContain('What is refused');
    for (const phrase of [
      'a static field',
      'a getter or setter',
      'an overload',
      'assigns to `this`',
    ]) {
      expect(refused.replace(/\s*\*\s*/g, ' ')).not.toContain(phrase);
    }
  });
});
