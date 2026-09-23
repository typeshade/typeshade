// The class syntax an ordinary TypeScript class is written in (§26, Rules 8.11 to 8.14):
// getters and setters, private names, parameter properties, a field typed by its initializer,
// a static field the file writes and `this` in a static member, and `readonly`.
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

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { TS_CODES } from './codes.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { startDebugSession } from '../../core/debug/session.js';

const TAIL = `\n@fragment\nexport function fs(): vec4 { return vec4(1.) }\n`;

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
    expect(only(C('  get y() { return this.x }'))).toBe(
      `${TS_CODES.UNKNOWN_TYPE} The getter "C.y" needs a return type: write "get y(): T".`,
    );
    expect(only(C('  set y(v) { this.x = v }'))).toBe(
      `${TS_CODES.UNKNOWN_TYPE} The setter "C.y" needs a type for "v": write "set y(v: T)", or give the getter a return type.`,
    );
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
      `${F} "C" has private fields, which an object literal cannot name. Build it with "new C(...)".`,
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

  it('a write to a readonly static, and this as a value, are refused', () => {
    expect(
      only(`"use typeshade"
class C { static readonly K = 3.; x: f32 }
export function run(): f32 { C.K = 4.; return C.K }${TAIL}`),
    ).toBe(`${TS_CODES.CONST_ASSIGN} Cannot assign to "C.K" — it is static readonly.`);
    expect(
      only(`"use typeshade"
class V { x: f32; static zero(): V { return new this() } }${TAIL}`),
    ).toContain('"this" is not one of them');
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
  };
  const REFUSED: Record<string, string> = {
    'a field holding a function': `class A { x: f32; m = (a: f32): f32 => a }
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
