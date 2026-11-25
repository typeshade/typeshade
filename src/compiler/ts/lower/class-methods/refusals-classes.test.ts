import { describe, expect, it } from 'vitest';
import { bothHalves } from '../../../../core/testing/both-halves.js';

const refuses = (body: string, code: string, sentence: string): void => {
  const halves = bothHalves(`"use typeshade"\n${body}`);
  const line = `typeshade ${code}: ${sentence}`;
  expect(halves.compiler).toEqual([line]);
  expect(halves.editor).toContain(line);
};

describe('a call through a class that inherits the member', () => {
  it('names a static of the class above that the unknown name is spelled like', () => {
    refuses(
      `class A { static origin(): f32 { return 0.; } }
class B extends A { }
@fragment export function fs(): vec4 { return vec4(B.orign(), 0., 0., 1.); }`,
      'TS8035',
      '"B" has no static function "orign". Did you mean "origin"?',
    );
  });

  it('names the abstract class the call names, and the first class that extends it', () => {
    refuses(
      `abstract class Shape {
  v: f32 = 1.;
  static unit<C extends Shape>(this: { new (): C }): C { return new this(); }
}
abstract class Mid extends Shape { }
class Sq extends Mid { }
@fragment export function fs(): vec4 { const b = Mid.unit(); return vec4(b.v, 0., 0., 1.); }`,
      'TS8035',
      '"Mid.unit()" builds its value with "new this()", and "Mid" is abstract, so there is no instance of it to build. Call it through a class that extends it, "Sq.unit()".',
    );
  });
});

describe('an abstract class and a field that holds a function', () => {
  it('refuses an abstract member with a body once, and the override adds nothing', () => {
    refuses(
      `abstract class S { abstract area(): f32 { return 1.; } }
class Q extends S { area(): f32 { return 2.; } }
@fragment export function fs(): vec4 { return vec4(new Q().area(), 0., 0., 1.); }`,
      'TS8035',
      '"S.area" is abstract and has a body; remove "abstract", or remove the body and let each class that extends "S" write it.',
    );
  });

  it('refuses a new of an abstract class and adds no other sentence', () => {
    refuses(
      `abstract class S { v: f32 = 1.; }
@fragment export function fs(): vec4 { return vec4(new S().v, 0., 0., 1.); }`,
      'TS8035',
      '"S" is abstract, so there is no instance of it to build. Construct a class that extends it.',
    );
  });

  it('names a decorated field that holds a function by its own name', () => {
    refuses(
      `class A { @Foo f = (x: f32): f32 => x; }
@fragment export function fs(): vec4 { return vec4(new A().f(1.), 0., 0., 1.); }`,
      'TS8035',
      'A decorator has no place on "A.f"; an entry is a function declaration with a stage attribute, "@vertex export function vs(…) { … }".',
    );
  });
});

describe('a call of a method outside the classes that may name it', () => {
  it('refuses a private method', () => {
    refuses(
      `class A { private p(): f32 { return 1.; } go(): f32 { return this.p(); } }
@fragment export function fs(): vec4 { const a = new A(); return vec4(a.p(), a.go(), 0., 1.); }`,
      'TS8035',
      '"A.p" is private, so only the body of "A" may name it. Reach it through a public member of "A".',
    );
  });

  it('refuses a method whose name starts with a hash', () => {
    refuses(
      `class A { #m(): f32 { return 1.; } go(): f32 { return this.#m(); } }
@fragment export function fs(): vec4 { const a = new A(); return vec4(a.#m(), a.go(), 0., 1.); }`,
      'TS8035',
      '"#m" is private to "A", and this code is outside its class body. Reach it through a member "A" declares without the "#".',
    );
  });

  it('refuses a protected method', () => {
    refuses(
      `class A { protected p(): f32 { return 1.; } go(): f32 { return this.p(); } }
@fragment export function fs(): vec4 { const a = new A(); return vec4(a.p(), a.go(), 0., 1.); }`,
      'TS8035',
      '"A.p" is protected, so only "A" and the classes that extend it may name it. Reach it through a public member of "A".',
    );
  });
});
