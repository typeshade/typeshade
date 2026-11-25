import { describe, expect, it } from 'vitest';
import { emitModuleAt } from '../../../../core/backends/wgsl.js';
import { bothHalves, bothTake } from '../../../../core/testing/both-halves.js';
import { uninlined } from '../../../../core/testing/keep-helpers.js';

const refuses = (body: string, code: string, sentence: string): void => {
  const halves = bothHalves(`"use typeshade"\n${body}`);
  const line = `typeshade ${code}: ${sentence}`;
  expect(halves.compiler).toEqual([line]);
  expect(halves.editor).toContain(line);
};

const MEMBERS = `class A {
  x: f32 = 1.;
  at(t: f32): f32 { return t; }
  advance(t: f32): f32 { return t; }
  static up(): f32 { return 1.; }
  static origin(): f32 { return 0.; }
  get g(): f32 { return 1.; }
}`;

describe('a call through a class name or a value that names no member it could run', () => {
  it('names a method called on the class, and the form to write', () => {
    refuses(
      `${MEMBERS}\nexport function f(): f32 { return A.at(1.); }`,
      'TS8035',
      '"A.at" is a method; call it on a A value: v.at(...).',
    );
  });

  it('names a static called on a value, and the form to write', () => {
    refuses(
      `${MEMBERS}\nexport function f(): f32 { const a = new A(); return a.up(); }`,
      'TS8035',
      '"A.up" is static; call it on the class: A.up(...).',
    );
  });

  it('names an accessor called as a method', () => {
    refuses(
      `${MEMBERS}\nexport function f(): f32 { const a = new A(); return a.g(); }`,
      'TS8035',
      '"A.g" is an accessor, not a method; read or assign it without the call: v.g.',
    );
  });

  it('names a field called as a method', () => {
    refuses(
      `${MEMBERS}\nexport function f(): f32 { const a = new A(); return a.x(); }`,
      'TS8035',
      '"x" is a field of A, not a method.',
    );
  });

  it('names the method an unknown name is spelled like', () => {
    refuses(
      `${MEMBERS}\nexport function f(): f32 { const a = new A(); return a.advnace(1.); }`,
      'TS8035',
      '"A" has no method "advnace". Did you mean "advance"?',
    );
  });

  it('names the static an unknown name is spelled like', () => {
    refuses(
      `${MEMBERS}\nexport function f(): f32 { return A.orign(); }`,
      'TS8035',
      '"A" has no static function "orign". Did you mean "origin"?',
    );
  });

  it('names a class in a namespace as the author writes it', () => {
    refuses(
      `namespace N { export class P { x: f32 = 1.; } }
export function f(): f32 { const p = new N.P(); return p.nope(); }`,
      'TS8035',
      '"N.P" has no method "nope".',
    );
  });

  it('names a static of a class in a namespace called on a value', () => {
    refuses(
      `namespace N { export class P { x: f32 = 1.; static s(): f32 { return 1.; } } }
export function f(): f32 { const p = new N.P(); return p.s(); }`,
      'TS8035',
      '"N.P.s" is static, so a value of N.P does not have it.',
    );
  });
});

describe('a method that changes its object and returns nothing', () => {
  it('has no value to give, and says to call it on its own line', () => {
    refuses(
      `class A { x: f32 = 1.; bump(): void { this.x += 1.; } }
export function f(): f32 { const a = new A(); const y = a.bump(); return a.x; }`,
      'TS8035',
      '"A.bump" changes its object and returns nothing; call it on its own line.',
    );
  });

  it('needs a receiver that is a place, not a value that is dropped', () => {
    refuses(
      `class A { x: f32 = 1.; bump(): f32 { this.x += 1.; return this.x; } }
function make(): A { return new A(); }
export function f(): f32 { return make().bump(); }`,
      'TS8035',
      '"A.bump" changes its object, and this one is a value that is dropped; keep it in a let and call the method on that.',
    );
  });
});

describe('super', () => {
  it('names the class above a body, and a top-level function has none', () => {
    refuses(
      `export function f(): f32 { return super.go(); }`,
      'TS8035',
      '"super" names the class above the one whose body it is written in; a top-level function has none.',
    );
  });

  it('names no body where nothing above declares the method', () => {
    refuses(
      `class A { go(): f32 { return 1.; } }
class B extends A { go(): f32 { return super.nope(); } }
export function f(): f32 { return new B().go(); }`,
      'TS8035',
      'Nothing above this class declares a method "nope", so "super.nope" names no body.',
    );
  });

  it('names no body where nothing above declares the static function', () => {
    refuses(
      `class A { static s(): f32 { return 1.; } }
class B extends A { static s(): f32 { return super.q(); } }
export function f(): f32 { return B.s(); }`,
      'TS8035',
      'Nothing above this class declares a static function "q", so "super.q" names no body.',
    );
  });

  it('does not reach a private method of the base', () => {
    refuses(
      `class A { private p(): f32 { return 1.; } go(): f32 { return this.p(); } }
class B extends A { go(): f32 { return super.p(); } }
export function f(): f32 { return new B().go(); }`,
      'TS8035',
      '"A.p" is private, so only the body of "A" may name it. Reach it through a public member of "A".',
    );
  });
});

describe('this and new', () => {
  it('is the class, not a value, in a static member', () => {
    refuses(
      `class A { static k(): f32 { return this; } }
export function f(): f32 { return A.k(); }`,
      'TS8035',
      'In a static member, "this" is the class "A", which is not a value. Name one of its statics through it, "this.K" or "this.f()".',
    );
  });

  it('is nothing in a top-level function', () => {
    refuses(
      `export function f(): f32 { const a = this; return 1.; }`,
      'TS8035',
      '"this" names a method\'s object; a static function and a top-level function have none.',
    );
  });

  it('is an object, not a class, in new this() of an instance method', () => {
    refuses(
      `class A { v: f32 = 1.; m(): A { return new this(); } }
@fragment export function fs(): vec4 { const a = new A(); return vec4(a.m().v, 0., 0., 1.); }`,
      'TS8035',
      '"this" here is an object, not a class, so "new" cannot build one from it. Name the class, "new A(...)"; "new this()" builds the class in a static member.',
    );
  });

  it('is an object, not a class, in new this() of a top-level function', () => {
    refuses(
      `export function f(): f32 { const a = new this(); return 1.; }`,
      'TS8035',
      '"this" here is an object, not a class, so "new" cannot build one from it. Name the class, "new C(...)"; "new this()" builds the class in a static member.',
    );
  });

  it('takes no arguments for new this() of a class with no constructor', () => {
    refuses(
      `class A { v: f32 = 1.; static make(): A { return new this(1.); } }
@fragment export function fs(): vec4 { return vec4(A.make().v, 0., 0., 1.); }`,
      'TS8019',
      '"A" declares no constructor, so "new A()" takes no arguments, as it does in TypeScript. Declare a constructor to pass values, or write the fields: { v: ... }.',
    );
  });

  it('takes no arguments for a class with no constructor, and says what to write', () => {
    refuses(
      `class A { x: f32 = 1.; }
export function f(): f32 { return new A(1.).x; }`,
      'TS8019',
      '"A" declares no constructor, so "new A()" takes no arguments, as it does in TypeScript. Declare a constructor to pass values, or write the fields: { x: ... }.',
    );
  });

  it('needs the type arguments of a generic class that nothing in the file fixes', () => {
    refuses(
      `class Pair<T> { a: T; constructor(a: T) { this.a = a; } }
export function f(): f32 { return new Pair(1.).a; }`,
      'TS8035',
      '"Pair" is generic, and nothing in this file says what to build it at. A struct is one layout, so each set of type arguments is a struct of its own: write "new Pair<f32>(…)" with the type you mean, the way TypeScript lets you write it.',
    );
  });

  it('says an undeclared type argument once, where it is written', () => {
    refuses(
      `class Pair<T> { a: T; constructor(a: T) { this.a = a; } }
export function f(): f32 { return new Pair<Foo>(1.).a; }`,
      'TS8002',
      'Unknown type "Foo". Declare it in this file, or import it from another shader module.',
    );
  });
});

describe('a member refused where it is written', () => {
  it('adds nothing at the call of an async method', () => {
    refuses(
      `class A { x: f32 = 1.; async go(): f32 { return 1.; } }
@fragment export function fs(): vec4 { let a = new A(); return vec4(a.go(), 0., 0., 1.); }`,
      'TS8035',
      '"A.go" is async, and a shader function runs to completion in one call: there is no event loop to wait on. Remove "async" and each "await".',
    );
  });

  it('says a decorator once, however many classes inherit the method', () => {
    refuses(
      `class A { @Foo go(): f32 { return 1.; } }
class B extends A {}
class C extends A {}
@fragment export function fs(): vec4 { return vec4(new B().go(), new C().go(), 0., 1.); }`,
      'TS8035',
      'A decorator has no place on "A.go"; an entry is a function declaration with a stage attribute, "@vertex export function vs(…) { … }".',
    );
  });

  it('adds nothing at the new of a class whose constructor parameter type was refused', () => {
    refuses(
      `class A { x: f32 = 1.; constructor(p: Foo) { } }
@fragment export function fs(): vec4 { let a = new A(1.); return vec4(a.x, 0., 0., 1.); }`,
      'TS8002',
      'Unknown type "Foo". Declare it in this file, or import it from another shader module.',
    );
  });

  it('refuses a decorated parameter property once and assigns no field for it', () => {
    refuses(
      `class A { constructor(@Foo public x: f32, public y: f32) {} }
export function f(): f32 { return new A(1., 2.).y; }`,
      'TS8035',
      'A decorator on the parameter property "x" decorates the parameter, not the field. Declare "x" as a field of "A" to give it one.',
    );
  });
});

describe('a field the struct does not carry', () => {
  it('says nothing more for its initializer', () => {
    refuses(
      `class Node { next: Node = new Node(); v: f32 = 1.; }
@fragment export function fs(): vec4 { const n = new Node(); return vec4(n.v, 0., 0., 1.); }`,
      'TS8010',
      'Field "Node.next" makes "Node" contain itself, through "Node" -> "Node". A struct has a fixed size, so it cannot hold itself: hold an index into an array of "Node" instead, or remove the field.',
    );
  });
});

describe('an accessor whose type no half writes', () => {
  it('takes the type from the getter body, and a setter takes the type of its getter', () => {
    const source = `"use typeshade";
class A {
  x: f32 = 1.;
  get v() { return this.x; }
  set v(n) { this.x = n; }
  set z(n: f32) { this.x = n; }
  get z() { return this.x; }
}
@fragment export function fs(): vec4 {
  let a = new A();
  a.v = 2.;
  a.z = 4.;
  return vec4(a.v, a.z, 0., 1.);
}
`;
    const w = emitModuleAt(uninlined(() => bothTake(source)).result.module, 'O1');
    expect(w).toContain('fn A_get_v(self_: ptr<function, A>) -> f32 {');
    expect(w).toContain('fn A_set_v(self_: ptr<function, A>, n: f32) {');
    expect(w).toContain('fn A_get_z(self_: ptr<function, A>) -> f32 {');
  });

  it('refuses a setter with no getter once, and an assignment to it adds nothing', () => {
    refuses(
      `class A { x: f32 = 1.; set v(n) { this.x = 2.; } }
@fragment export function fs(): vec4 { let a = new A(); a.v = 1.; return vec4(a.x, 0., 0., 1.); }`,
      'TS8002',
      'The setter "A.v" needs a type for "n": write "set v(n: T)".',
    );
  });

  it('refuses a setter value named for the emitted object', () => {
    refuses(
      `class A { x: f32 = 1.; set v(self_) { this.x = 2.; } get v(): f32 { return this.x; } }
@fragment export function fs(): vec4 { let a = new A(); return vec4(a.v, 0., 0., 1.); }`,
      'TS8035',
      '"self_" is a name A.v gives its object in the emitted function; rename the parameter.',
    );
  });

  it('names the class as the author writes it when a constructor parameter takes the name', () => {
    refuses(
      `class Slot<T> { v: T; constructor(self_: T) { this.v = self_; } }
@fragment export function fs(): vec4 { const a = new Slot<f32>(1.); return vec4(a.v, 0., 0., 1.); }`,
      'TS8035',
      '"self_" is a name new Slot<f32> gives its object in the emitted function; rename the parameter.',
    );
    refuses(
      `namespace N { export class P { x: f32; constructor(self_: f32) { this.x = self_; } } }
@fragment export function fs(): vec4 { const a = new N.P(1.); return vec4(a.x, 0., 0., 1.); }`,
      'TS8035',
      '"self_" is a name new N.P gives its object in the emitted function; rename the parameter.',
    );
  });
});

describe('a call that adds nothing to a refusal said where the member is declared', () => {
  it('is a call of an async static function', () => {
    refuses(
      `class A { static async f(): f32 { return 1.; } }
export function f(): f32 { return A.f(); }`,
      'TS8035',
      '"A.f" is async, and a shader function runs to completion in one call: there is no event loop to wait on. Remove "async" and each "await".',
    );
  });

  it('is a call of a method whose name a private member took', () => {
    refuses(
      `class A { #m(): f32 { return 1.; } m(): f32 { return 2.; } }
export function f(): f32 { return new A().m(); }`,
      'TS8035',
      '"A.#m" and "A.m" would be emitted under one name. Rename one of them.',
    );
  });

  it('is a call of a method and of a static that share a name', () => {
    refuses(
      `class A { m(): f32 { return 1.; } static m(): f32 { return 2.; } }
export function f(): f32 { const a = new A(); return A.m() + a.m(); }`,
      'TS8035',
      '"A.m" and the static "A.m" would be emitted under one name. Rename one of them.',
    );
  });

  it('is a call of a method of an abstract class on a value of it, which has none', () => {
    refuses(
      `abstract class S { abstract area(): f32; double(): f32 { return this.area() * 2.; } }
export function f(s: S): f32 { return s.double(); }`,
      'TS8035',
      '"S" is abstract, so there is no instance of it on which "double" could run. Construct a concrete class that extends it and call "double" on that value.',
    );
  });
});
