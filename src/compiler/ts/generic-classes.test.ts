// A generic CLASS by monomorphisation (roadmap 0.3 item T9, #92), the half of that item the
// generic functions in `generics.test.ts` are the other of.
//
// Neither target has a generic struct: a WGSL or GLSL struct is ONE layout, its fields' types
// fixed. So a generic class is collected once per set of type arguments the file WRITES it
// with — read off the source rather than discovered as the lowering runs, because a struct has
// to exist before anything is lowered against it: its methods are functions of the module, its
// fields decide every layout that holds it, and the inheritance splice runs over the collected
// list. Every use is a type node, an `extends`, or a `new`, and all three are syntactic.
//
// Every spelling below type-checks under `tsc` with the ambient lib as well as compiling here,
// which is the lesson T8 taught; `examples/generic-class.shade.ts` carries the same surface and
// `src/language-service/ambient.test.ts` runs tsc over it. What tsc will NOT take is arithmetic
// on an unconstrained type parameter, so a generic class here holds, selects, indexes and
// returns, and the arithmetic happens on what it gives back.

import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { compileTsSource } from './source-file.js'
import { TS_CODES } from './codes.js'

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`)

const wgslOf = (src: string): string => {
  const r = compile(src)
  const errors = r.diagnostics.filter((d) => d.category === 'error')
  expect(errors.map((d) => d.message)).toEqual([])
  return r.wgsl ?? ''
}

describe('one struct per set of type arguments the file writes', () => {
  it('emits a struct and a method per instance, and nothing under the generic name', () => {
    const wgsl = wgslOf(`"use typeshade";
class Pair<T> {
  a: T;
  b: T;
  first(): T {
    return this.a;
  }
}
@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  const s = new Pair<f32>();
  const v = new Pair<vec3>();
  return vec4(v.first() * s.first(), 1.);
}
`)
    expect(wgsl).toContain('struct Pair_f32 {')
    expect(wgsl).toContain('struct Pair_vec3 {')
    expect(wgsl).toContain('fn Pair_f32_first(self_: Pair_f32) -> f32 {')
    expect(wgsl).toContain('fn Pair_vec3_first(self_: Pair_vec3) -> vec3<f32> {')
    // A generic is not a struct the module has; its instances are.
    expect(wgsl).not.toMatch(/struct Pair \{/)
    expect(wgsl).not.toMatch(/fn Pair_first\b/)
  })

  it('takes the fields at the bound type', () => {
    const wgsl = wgslOf(`"use typeshade";
class Box<T> {
  v: T;
}
@fragment
export function fs(): vec4 {
  const a: Box<f32> = { v: 0.5 };
  const b: Box<vec2> = { v: vec2(0.25) };
  return vec4(b.v, a.v, 1.);
}
`)
    expect(wgsl).toContain('struct Box_f32 {\n  v: f32,\n}')
    expect(wgsl).toContain('struct Box_vec2 {\n  v: vec2<f32>,\n}')
  })

  it('writes one struct for one set however many times the file writes it', () => {
    const wgsl = wgslOf(`"use typeshade";
class Box<T> {
  v: T;
}
function one(b: Box<f32>): f32 {
  return b.v;
}
function two(b: Box<f32>): f32 {
  return b.v;
}
@fragment
export function fs(): vec4 {
  const b: Box<f32> = { v: 0.5 };
  return vec4(one(b), two(b), 0., 1.);
}
`)
    expect(wgsl.match(/struct Box_f32 \{/g)).toHaveLength(1)
  })

  it('emits nothing for a generic class nothing writes', () => {
    const wgsl = wgslOf(`"use typeshade";
class Unused<T> {
  a: T;
}
@fragment
export function fs(): vec4 {
  return vec4(1.);
}
`)
    expect(wgsl).not.toContain('Unused')
  })

  it('carries a constructor per instance', () => {
    const wgsl = wgslOf(`"use typeshade";
class Span<T> {
  lo: T;
  hi: T;
  constructor(lo: T, hi: T) {
    this.lo = lo;
    this.hi = hi;
  }
}
@fragment
export function fs(): vec4 {
  const s = new Span<f32>(0., 1.);
  const t = new Span<vec2>(vec2(0.), vec2(1.));
  return vec4(t.hi, s.lo, s.hi);
}
`)
    expect(wgsl).toContain('fn Span_f32_new(lo: f32, hi: f32) -> Span_f32 {')
    expect(wgsl).toContain('fn Span_vec2_new(lo: vec2<f32>, hi: vec2<f32>) -> Span_vec2 {')
  })

  it('takes a type parameter wherever a type is written, array<T, N> included', () => {
    const wgsl = wgslOf(`"use typeshade";
class Bag<T> {
  xs: array<T, 3>;
  nth(i: i32): T {
    return this.xs[i];
  }
}
@fragment
export function fs(): vec4 {
  const b: Bag<f32> = { xs: [1., 2., 3.] };
  return vec4(b.nth(0), b.nth(2), 0., 1.);
}
`)
    expect(wgsl).toContain('xs: array<f32, 3>')
    expect(wgsl).toContain('fn Bag_f32_nth(self_: Bag_f32, i: i32) -> f32 {')
  })

  it('nests: the argument may be another instance', () => {
    const wgsl = wgslOf(`"use typeshade";
class Box<T> {
  v: T;
}
@fragment
export function fs(): vec4 {
  const b: Box<Box<f32>> = { v: { v: 0.5 } };
  return vec4(b.v.v, 0., 0., 1.);
}
`)
    expect(wgsl).toContain('struct Box_f32 {')
    expect(wgsl).toContain('struct Box_Box_f32 {\n  v: Box_f32,\n}')
  })

  it('reaches a class declared inside a namespace, by its dotted name', () => {
    const wgsl = wgslOf(`"use typeshade";
namespace N {
  export class Pair<T> {
    a: T;
    b: T;
    constructor(a: T, b: T) {
      this.a = a;
      this.b = b;
    }
  }
}
@fragment
export function fs(): vec4 {
  const p = new N.Pair<f32>(1., 2.);
  const q: N.Pair<vec2> = { a: vec2(0.), b: vec2(1.) };
  return vec4(q.a, p.a, p.b);
}
`)
    expect(wgsl).toContain('struct N_Pair_f32 {')
    expect(wgsl).toContain('struct N_Pair_vec2 {')
    expect(wgsl).toContain('fn N_Pair_f32_new(a: f32, b: f32) -> N_Pair_f32 {')
  })

  it('carries an instance through a uniform binding', () => {
    const wgsl = wgslOf(`"use typeshade";
class Span<T> {
  lo: T;
  hi: T;
}
@group(0) @binding(0) declare const u: uniform<Span<f32>>;
@fragment
export function fs(): vec4 {
  return vec4(u.lo, u.hi, 0., 1.);
}
`)
    expect(wgsl).toContain('struct Span_f32 {')
    expect(wgsl).toContain('var<uniform> u: Span_f32;')
  })
})

describe('a method that changes its object, once per instance', () => {
  it('takes each instance by reference', () => {
    const wgsl = wgslOf(`"use typeshade";
class Acc<T> {
  v: T;
  put(k: T): void {
    this.v = k;
  }
}
@fragment
export function fs(): vec4 {
  let a: Acc<f32> = { v: 0. };
  let b: Acc<vec3> = { v: vec3(0.) };
  a.put(1.);
  b.put(vec3(0.5));
  return vec4(b.v * a.v, 1.);
}
`)
    expect(wgsl).toContain('fn Acc_f32_put(self_: ptr<function, Acc_f32>, k: f32) {')
    expect(wgsl).toContain('fn Acc_vec3_put(self_: ptr<function, Acc_vec3>, k: vec3<f32>) {')
  })
})

describe('a type parameter default, read the way TypeScript reads it', () => {
  it('lets the bare name stand for the instance the defaults give', () => {
    const wgsl = wgslOf(`"use typeshade";
class Grid<T = f32> {
  v: T;
}
function read(g: Grid): f32 {
  return g.v;
}
@fragment
export function fs(): vec4 {
  const g: Grid<f32> = { v: 0.5 };
  return vec4(read(g), 0., 0., 1.);
}
`)
    // `Grid` and `Grid<f32>` are ONE struct, so the file writes one instance and not two.
    expect(wgsl.match(/struct Grid_f32 \{/g)).toHaveLength(1)
    expect(wgsl).toContain('fn read(g: Grid_f32) -> f32 {')
  })

  it('fills only the parameters left out', () => {
    const wgsl = wgslOf(`"use typeshade";
class Cell<A, B = i32> {
  a: A;
  b: B;
}
@fragment
export function fs(): vec4 {
  const c: Cell<f32> = { a: 1., b: 2 };
  return vec4(c.a, f32(c.b), 0., 1.);
}
`)
    expect(wgsl).toContain('struct Cell_f32_i32 {')
  })

  it('answers a `new` with no type arguments from the defaults', () => {
    const wgsl = wgslOf(`"use typeshade";
class Level<T = f32> {
  edge: T;
  constructor(edge: T) {
    this.edge = edge;
  }
}
@fragment
export function fs(): vec4 {
  const l = new Level(0.25);
  return vec4(l.edge, 0., 0., 1.);
}
`)
    expect(wgsl).toContain('fn Level_f32_new(edge: f32) -> Level_f32 {')
  })
})

describe('a `new` that leaves its type arguments to inference', () => {
  it('takes the one instance the file writes', () => {
    const wgsl = wgslOf(`"use typeshade";
class Pair<T> {
  a: T;
  b: T;
  constructor(a: T, b: T) {
    this.a = a;
    this.b = b;
  }
}
@fragment
export function fs(): vec4 {
  const p: Pair<f32> = new Pair(1., 2.);
  return vec4(p.a, p.b, 0., 1.);
}
`)
    expect(wgsl).toContain('let p = Pair_f32_new(1.0, 2.0);')
  })

  it('says which to write when the file writes several', () => {
    const errors = errorsOf(`"use typeshade";
class Pair<T> {
  a: T;
  b: T;
  constructor(a: T, b: T) {
    this.a = a;
    this.b = b;
  }
}
@fragment
export function fs(): vec4 {
  const p = new Pair<f32>(1., 2.);
  const q = new Pair<vec3>(vec3(0.), vec3(1.));
  const r = new Pair(3., 4.);
  return vec4(q.a * p.a * r.b, 1.);
}
`)
    expect(errors[0]).toBe(
      `${TS_CODES.CLASS_MEMBER} "Pair" is generic and this file writes it at 2 sets of type ` +
        `arguments (Pair_f32, Pair_vec3), so "new Pair(…)" does not say which one to build. ` +
        `Write the type argument: "new Pair<f32>(…)".`,
    )
  })

  it('says what to write when the file writes none', () => {
    const errors = errorsOf(`"use typeshade";
class Pair<T> {
  a: T;
  b: T;
  constructor(a: T, b: T) {
    this.a = a;
    this.b = b;
  }
}
@fragment
export function fs(): vec4 {
  const p = new Pair(1., 2.);
  return vec4(p.a, p.b, 0., 1.);
}
`)
    expect(errors[0]).toContain('nothing in this file says what to build it at')
    expect(errors[0]).toContain('new Pair<f32>(…)')
  })
})

describe('a static belongs to the class, not to an instance', () => {
  it("emits one function under the class's own name", () => {
    const wgsl = wgslOf(`"use typeshade";
class Op<T> {
  v: T;
  static unit(): f32 {
    return 1.;
  }
  get(): T {
    return this.v;
  }
}
@fragment
export function fs(): vec4 {
  const a: Op<f32> = { v: 0.5 };
  const b: Op<vec2> = { v: vec2(0.25) };
  return vec4(b.get(), Op.unit() * a.get(), 1.);
}
`)
    // TypeScript refuses a static that mentions `T` (TS2302), so a static is the same function
    // however many instances there are: one copy, under the name the call site writes.
    expect(wgsl).toContain('fn Op_unit() -> f32 {')
    expect(wgsl.match(/fn Op_unit\b/g)).toHaveLength(1)
    expect(wgsl).not.toContain('Op_f32_unit')
    expect(wgsl).not.toContain('Op_vec2_unit')
    // …while every method still has one copy per instance.
    expect(wgsl).toContain('fn Op_f32_get(self_: Op_f32) -> f32 {')
    expect(wgsl).toContain('fn Op_vec2_get(self_: Op_vec2) -> vec2<f32> {')
  })
})

describe('a base written with type arguments is the instance it names', () => {
  it('inherits the instance struct, its fields and its methods', () => {
    const wgsl = wgslOf(`"use typeshade";
class Box<T> {
  v: T;
  get(): T {
    return this.v;
  }
}
class FBox extends Box<f32> {
  w: f32;
}
@fragment
export function fs(): vec4 {
  const b: FBox = { v: 1., w: 2. };
  return vec4(b.get(), b.w, 0., 1.);
}
`)
    expect(wgsl).toContain('struct Box_f32 {')
    expect(wgsl).toContain('struct FBox {\n  v: f32,\n  w: f32,\n}')
    // Its inherited body reads `T` as the base's instance bound it, not as an unknown name.
    expect(wgsl).toContain('fn FBox_get(self_: FBox) -> f32 {')
  })
})

describe('what it refuses, and in how many sentences', () => {
  it('refuses a type argument that is itself a type parameter, with the reason', () => {
    const errors = errorsOf(`"use typeshade";
class Pair<T> {
  a: T;
  b: T;
}
function relay<U>(p: Pair<U>): U {
  return p.a;
}
@fragment
export function fs(): vec4 {
  const p: Pair<f32> = { a: 1., b: 2. };
  return vec4(relay(p), 0., 0., 1.);
}
`)
    expect(errors[0]).toContain('"Pair<U>" is written with the type parameter "U"')
    expect(errors[0]).toContain('names no layout until the declaration around it is instantiated')
    expect(errors[0]).toContain('write "Pair<f32>"')
  })

  it('reports too many type arguments once, and still collects the instance', () => {
    // The whole of T10 (#111) in one case: the surplus argument is a mistake, the ones the class
    // declares are still read, and the struct exists — so there is no second refusal at the
    // annotation and no "Unknown identifier" at every read of the binding.
    const errors = errorsOf(`"use typeshade";
class Pair<T> {
  a: T;
  b: T;
}
@fragment
export function fs(): vec4 {
  const p: Pair<f32, f32> = { a: 1., b: 2. };
  return vec4(p.a, p.b, 0., 1.);
}
`)
    expect(errors).toEqual([`${TS_CODES.ARITY_MISMATCH} "Pair" takes 1 type argument(s), got 2.`])
  })

  it('names the range when a default makes some of them optional', () => {
    const errors = errorsOf(`"use typeshade";
class Cell<A, B = i32> {
  a: A;
  b: B;
}
@fragment
export function fs(): vec4 {
  const c: Cell<f32, i32, i32> = { a: 1., b: 2 };
  return vec4(c.a, 0., 0., 1.);
}
`)
    expect(errors[0]).toBe(
      `${TS_CODES.ARITY_MISMATCH} "Cell" takes 1 to 2 type argument(s), got 3.`,
    )
  })

  it('reports too few, which no reading recovers', () => {
    const errors = errorsOf(`"use typeshade";
class Two<A, B> {
  a: A;
  b: B;
}
@fragment
export function fs(): vec4 {
  const p: Two<f32> = { a: 1., b: 2. };
  return vec4(p.a, 0., 0., 1.);
}
`)
    expect(errors[0]).toBe(`${TS_CODES.ARITY_MISMATCH} "Two" takes 2 type argument(s), got 1.`)
  })
})
