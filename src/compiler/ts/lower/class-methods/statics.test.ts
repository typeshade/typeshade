import { describe, expect, it } from 'vitest';
import { emitModuleAt } from '../../../../core/backends/wgsl.js';
import { bothHalves, bothRefuse, bothTake } from '../../../../core/testing/both-halves.js';
import { uninlined } from '../../../../core/testing/keep-helpers.js';

const o1 = (source: string): string =>
  emitModuleAt(uninlined(() => bothTake(source)).result.module, 'O1');

const functionsOf = (wgsl: string): string[] =>
  [...wgsl.matchAll(/^fn (\w+)\(/gm)].map((m) => m[1]!).sort();

describe('this and super in a static member', () => {
  const source = `"use typeshade";
class A {
  static K: f32 = 1.;
  static f(): f32 { return this.K; }
  static g(): f32 { return this.f() + 1.; }
}
class B extends A {
  static K: f32 = 2.;
  static f(): f32 { return super.f() + 1.; }
}
@fragment export function fs(): vec4 { return vec4(A.f(), B.f(), B.g(), 1.); }
`;

  it('is the class the call names, and an inherited static is lowered for each class', () => {
    const w = o1(source);
    expect(w).toContain('fn A_f() -> f32 {\n  return A_K;\n}');
    expect(w).toContain('fn B_g() -> f32 {\n  return (B_f() + 1.0);\n}');
  });

  it('names the class above the one that wrote the body, lowered for the class that calls', () => {
    const w = o1(source);
    expect(w).toContain('fn B_f() -> f32 {\n  return (B_super_A_f() + 1.0);\n}');
    expect(w).toContain('fn B_super_A_f() -> f32 {\n  return B_K;\n}');
  });

  it('reads a static field of the class above through super, as the module value', () => {
    const w = o1(`"use typeshade";
class A { static K: f32 = 1.; }
class B extends A { static f(): f32 { return super.K + 1.; } }
@fragment export function fs(): vec4 { return vec4(B.f(), 0., 0., 1.); }
`);
    expect(w).toContain('fn B_f() -> f32 {\n  return (A_K + 1.0);');
  });

  it('does not reach a private static of the base through this in an inherited body', () => {
    bothRefuse(
      `"use typeshade";
class A { static #s(): f32 { return 3.; } static t(): f32 { return this.#s(); } }
class B extends A { }
@fragment export function fs(): vec4 { return vec4(B.t(), 0., 0., 1.); }
`,
      'TS8035',
      '"B" has no "#s": a private static is the class\'s own, and TypeScript throws where a body "B" inherits reaches it through "this". Name the class that declares it, "A.#s".',
    );
  });
});

describe('a static that builds its value with new this()', () => {
  it('is lowered for each class that extends it, with the this parameter left out', () => {
    const w = o1(`"use typeshade";
class Disc {
  static SIZE: f32 = 2.;
  static unit<C extends Disc>(this: { new (): C; SIZE: f32 }): C { return new this(); }
  v: f32 = 1.;
}
class Big extends Disc { static SIZE: f32 = 9.; }
@fragment export function fs(): vec4 {
  const b = Big.unit();
  const d = Disc.unit();
  return vec4(b.v, d.v, 0., 1.);
}
`);
    expect(w).toContain('fn Disc_unit_into(_dst: ptr<function, Disc>) {\n  Disc_new_into(_dst);');
    expect(w).toContain('fn Big_unit_into(_dst: ptr<function, Big>) {\n  Big_new_into(_dst);');
  });

  it('gives the constructor it needs to each class that inherits it, initializers or none', () => {
    const names = functionsOf(
      o1(`"use typeshade";
class Base { k: f32; static make<C extends Base>(this: { new (): C }): C { return new this(); } }
class D1 extends Base { }
class D2 extends D1 { }
@fragment export function fs(): vec4 {
  const a = D2.make();
  const b = D1.make();
  return vec4(a.k + b.k, 0., 0., 1.);
}
`),
    );
    expect(names).toContain('Base_new');
    expect(names).toContain('D1_new_into');
    expect(names).toContain('D2_new_into');
    expect(names).toContain('D1_make_into');
    expect(names).toContain('D2_make_into');
  });

  it('is refused when it is declared to return the class that declares it', () => {
    bothRefuse(
      `"use typeshade";
class Disc { v: f32 = 1.; static make(): Disc { return new this(); } }
class Big extends Disc { w: f32 = 2.; }
@fragment export function fs(): vec4 { const b = Big.make(); return vec4(b.v, 0., 0., 1.); }
`,
      'TS8035',
      '"Disc.make" builds its value with "new this()", so "Big.make()" returns a Big, but it is declared to return a Disc, which is the type the editor gives the call. Declare the class the call names: static make<C extends Disc>(this: { new (): C }): C',
    );
  });

  it('is refused also when it returns a name that the body declared from new this()', () => {
    bothRefuse(
      `"use typeshade";
class Disc { v: f32 = 1.; static make(): Disc { const d = new this(); return d; } }
class Big extends Disc { w: f32 = 2.; }
@fragment export function fs(): vec4 { const b = Big.make(); return vec4(b.v, 0., 0., 1.); }
`,
      'TS8035',
      '"Disc.make" builds its value with "new this()", so "Big.make()" returns a Big, but it is declared to return a Disc, which is the type the editor gives the call. Declare the class the call names: static make<C extends Disc>(this: { new (): C }): C',
    );
  });

  it('is not refused when another return of it gives the declared class', () => {
    o1(`"use typeshade";
class Disc {
  v: f32 = 1.;
  static make(flag: bool): Disc { if (flag) { return new this(); } return new Disc(); }
}
class Big extends Disc { w: f32 = 2.; }
@fragment export function fs(): vec4 { const b = Big.make(true); return vec4(b.v, 0., 0., 1.); }
`);
  });

  const abstractSource = `"use typeshade";
abstract class Shape {
  v: f32 = 1.;
  static unit<C extends Shape>(this: { new (): C }): C { return new this(); }
  static half(): f32 { return 0.5; }
}
class Sq extends Shape { }
`;

  it('is not a function of an abstract class, and the call through it is refused', () => {
    bothRefuse(
      `${abstractSource}@fragment export function fs(): vec4 { const b = Shape.unit(); return vec4(b.v, 0., 0., 1.); }`,
      'TS8035',
      '"Shape.unit()" builds its value with "new this()", and "Shape" is abstract, so there is no instance of it to build. Call it through a class that extends it, "Sq.unit()".',
    );
  });

  it('leaves the other statics of an abstract class, and lowers it for the concrete class', () => {
    const w = o1(
      `${abstractSource}@fragment export function fs(): vec4 { const b = Sq.unit(); return vec4(b.v + Shape.half(), 0., 0., 1.); }`,
    );
    const names = functionsOf(w);
    expect(names).toContain('Shape_half');
    expect(names).toContain('Sq_unit_into');
    expect(names).not.toContain('Shape_unit_into');
    expect(names).not.toContain('Shape_unit');
  });
});

describe('a generic class', () => {
  const source = `"use typeshade";
class Slot<T> {
  v: T;
  constructor(v: T) { this.v = v; }
  static zero(): f32 { return 0.; }
  get(): T { return this.v; }
}
@fragment export function fs(): vec4 {
  const a = new Slot<f32>(1.);
  const b = new Slot<u32>(2);
  return vec4(a.get() + Slot.zero(), f32(b.get()), 0., 1.);
}
`;

  it('constructs the instance struct of each set of type arguments', () => {
    const names = functionsOf(o1(source));
    expect(names).toContain('Slot_f32_new_into');
    expect(names).toContain('Slot_u32_new_into');
    expect(names).toContain('Slot_f32_get');
    expect(names).toContain('Slot_u32_get');
  });

  it('registers the constructor of a class that writes none under the instance name', () => {
    const names = functionsOf(
      o1(`"use typeshade";
class Box<T> { v: T; }
@fragment export function fs(): vec4 {
  const a = new Box<f32>();
  const b = new Box<u32>();
  return vec4(a.v + f32(b.v), 0., 0., 1.);
}
`),
    );
    expect(names).toContain('Box_f32_new_into');
    expect(names).toContain('Box_u32_new_into');
  });

  it('carries a static once under the class name, not once for each instance', () => {
    const names = functionsOf(o1(source));
    expect(names.filter((n) => /zero/.test(n))).toEqual(['Slot_zero']);
  });

  it('is refused a static called on a value, naming the class form', () => {
    const halves = bothHalves(`"use typeshade";
class Slot<T> { v: T; constructor(v: T) { this.v = v; } static zero(): f32 { return 0.; } }
@fragment export function fs(): vec4 { const a = new Slot<f32>(1.); return vec4(a.zero(), 0., 0., 1.); }
`);
    const line = 'typeshade TS8035: "Slot.zero" is static; call it on the class: Slot.zero(...).';
    expect(halves.compiler).toEqual([line]);
    expect(halves.editor).toContain(line);
  });

  it('builds the instance its constraint names from a static that builds with new this()', () => {
    const w = o1(`"use typeshade";
class Base<T> {
  v: T;
  constructor(v: T) { this.v = v; }
  static make<C extends Base<f32>>(this: { new (v: f32): C }): C { return new this(1.); }
}
@fragment export function fs(): vec4 { const b = Base.make(); return vec4(b.v, 0., 0., 1.); }
`);
    expect(w).toContain('fn Base_make_into(_dst: ptr<function, Base_f32>) {');
  });

  it('builds the one instance the file writes for a bare new of it', () => {
    const w = o1(`"use typeshade";
class Pair<T> { a: T; constructor(a: T) { this.a = a; } }
@fragment export function fs(): vec4 {
  const p = new Pair<f32>(1.);
  const q = new Pair(2.);
  return vec4(p.a + q.a, 0., 0., 1.);
}
`);
    expect(w).toContain('Pair_f32_new_into(&q, 2.0);');
  });

  it('refuses a bare new where the file writes two instances, and says which to write', () => {
    bothRefuse(
      `"use typeshade";
class Pair<T> { a: T; constructor(a: T) { this.a = a; } }
@fragment export function fs(): vec4 {
  const p = new Pair<f32>(1.);
  const q = new Pair<u32>(2);
  const r = new Pair(2.);
  return vec4(p.a, 0., 0., 1.);
}
`,
      'TS8035',
      '"Pair" is generic and this file writes it at 2 sets of type arguments (Pair<f32>, Pair<u32>), so "new Pair(…)" does not say which one to build. Write the type argument: "new Pair<f32>(…)".',
    );
  });

  it('keeps a derived class of an instance in the terms of the base type arguments', () => {
    const w = o1(`"use typeshade";
class Box<T> { v: T; constructor(v: T) { this.v = v; } get(): T { return this.v; } }
class Small extends Box<f32> { }
class Smaller extends Small { }
@fragment export function fs(): vec4 {
  const s = new Small(1.);
  const t = new Smaller(2.);
  return vec4(s.get(), t.get(), 0., 1.);
}
`);
    expect(w).toContain('fn Small_get(self_: ptr<function, Small>) -> f32 {');
    expect(w).toContain('fn Smaller_get(self_: ptr<function, Smaller>) -> f32 {');
  });

  it('is named as the author writes it in a refusal', () => {
    const halves = bothHalves(`"use typeshade";
class Slot<T> { v: T; constructor(v: T) { this.v = v; } }
@fragment export function fs(): vec4 { const a = new Slot<f32>(1.); return vec4(a.nope(), 0., 0., 1.); }
`);
    const line = 'typeshade TS8035: "Slot<f32>" has no method "nope".';
    expect(halves.compiler).toEqual([line]);
    expect(halves.editor).toContain(line);
  });
});
