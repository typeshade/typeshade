import { describe, expect, it } from 'vitest';
import { bothHalves } from '../../core/testing/both-halves.js';

const program = (declarations: string, body = ''): string =>
  `"use typeshade"\n${declarations}\n@compute([1]) export function main(): void { ${body} }\n`;

const refuses = (source: string, lines: readonly string[]): void => {
  const halves = bothHalves(source);
  expect(halves.compiler).toEqual(lines);
  for (const line of lines) expect(halves.editor).toContain(line);
};

const T35 = (sentence: string): string => `typeshade TS8035: ${sentence}`;
const T10 = (sentence: string): string => `typeshade TS8010: ${sentence}`;

describe('abstract members, said once where they are written', () => {
  it('a concrete class that leaves an abstract method open is refused once, at the class', () => {
    refuses(
      program(
        `abstract class A { abstract m(): f32; }
class D extends A { x: f32 = 1.; }`,
        'const d = new D(); const p: f32 = d.m(); const q: f32 = d.m();',
      ),
      [T35('"D" does not implement "m", which "A" declares abstract; write "m" in "D".')],
    );
  });

  it('an abstract member with a body keeps the body and is refused at the member', () => {
    refuses(
      program(
        `abstract class A { abstract m(): f32 { return 1.; } }
class D extends A { x: f32 = 1.; }`,
        'const d = new D(); const q: f32 = d.m();',
      ),
      [
        T35(
          '"A.m" is abstract and has a body; remove "abstract", or remove the body and let each ' +
            'class that extends "A" write it.',
        ),
      ],
    );
  });

  it('an abstract member in a class that is not abstract is refused at the member', () => {
    refuses(program(`class A { abstract m(): f32; x: f32 = 1.; }`, 'const a = new A();'), [
      T35(
        '"A.m" is abstract, and "A" is not; mark "A" abstract, or remove "abstract" and give ' +
          '"m" a body.',
      ),
    ]);
  });

  it('an abstract field that holds a function is a field of function type', () => {
    const halves = bothHalves(program(`abstract class A { abstract m: () => f32; x: f32 = 1.; }`));
    expect(halves.compiler).toHaveLength(1);
    expect(halves.compiler[0]).toContain('"() => f32" is a function type');
    expect(halves.editor).toContain(halves.compiler[0]);
  });

  it('an accessor over an abstract field is refused, since a read never reaches it', () => {
    refuses(
      program(
        `abstract class A { abstract v: f32; read(): f32 { return this.v; } }
class D extends A { get v(): f32 { return 2.; } }`,
        'const d = new D(); const q: f32 = d.read();',
      ),
      [
        T35(
          '"D.v" is an accessor, and the "A.v" it overrides is an abstract field, which every ' +
            'struct below "A" holds as a member, so a read of it would never reach the ' +
            'accessor. Declare it in "A" as "abstract get v(): f32".',
        ),
      ],
    );
  });

  it('a field whose abstract base declares a getter is not refused', () => {
    const halves = bothHalves(
      program(
        `abstract class A { abstract get v(): f32; read(): f32 { return this.v; } }
class D extends A { get v(): f32 { return 2.; } }`,
        'const d = new D(); const q: f32 = d.read();',
      ),
    );
    expect(halves.compiler).toEqual([]);
    expect(halves.editor).toEqual([]);
  });
});

describe('a member declared again as another kind', () => {
  it('a field over a method is refused, as TypeScript refuses it', () => {
    const line = T35(
      '"D.m" is a field, and the "A.m" it overrides is a method; TypeScript refuses an ' +
        'override of another kind. Declare it as a method, or rename it.',
    );
    const halves = bothHalves(
      program(
        `class A { m(): f32 { return 1.; } }
class D extends A { m: f32 = 1.; }`,
        'const d = new D();',
      ),
    );
    expect(halves.compiler).toEqual([line]);
    expect(halves.editor).toContain(line);
  });

  it('super.f of a field that holds a function is refused, as TS2855 refuses it', () => {
    const line = T35(
      '"super.f" names a field that holds a function, and a field is the object\'s own, ' +
        'which "super" does not reach. Declare "A.f" as a method, or write "this.f".',
    );
    const halves = bothHalves(
      program(
        `class A { f: () => f32 = () => 1.; }
class D extends A { g(): f32 { return super.f(); } }`,
        'const d = new D(); const q: f32 = d.g();',
      ),
    );
    expect(halves.compiler).toEqual([line]);
    expect(halves.editor).toContain(line);
  });

  it('super.f of a method is not refused', () => {
    const halves = bothHalves(
      program(
        `class A { f(): f32 { return 1.; } }
class D extends A { g(): f32 { return super.f(); } }`,
        'const d = new D(); const q: f32 = d.g();',
      ),
    );
    expect(halves.compiler).toEqual([]);
    expect(halves.editor).toEqual([]);
  });

  it('a field over an abstract accessor, and a function field over a method, are taken', () => {
    const over = bothHalves(
      program(
        `abstract class A { abstract get v(): f32; read(): f32 { return this.v; } }
class D extends A { v: f32 = 2.; }`,
        'const d = new D(); const q: f32 = d.read();',
      ),
    );
    expect(over.compiler).toEqual([]);
    expect(over.editor).toEqual([]);
    const fn = bothHalves(
      program(
        `class A { m(): f32 { return 1.; } }
class D extends A { m = (): f32 => 2.; }`,
        'const d = new D(); const q: f32 = d.m();',
      ),
    );
    expect(fn.compiler).toEqual([]);
    expect(fn.editor).toEqual([]);
  });

  it('an accessor over a method, and a field over a concrete accessor, are refused', () => {
    const accessor = bothHalves(
      program(
        `class A { m(): f32 { return 1.; } }
class D extends A { get m(): f32 { return 2.; } }`,
        'const d = new D(); const q: f32 = d.m;',
      ),
    );
    expect(accessor.compiler).toEqual([
      T35(
        '"D.m" is an accessor, and the "A.m" it overrides is a method; TypeScript refuses an ' +
          'override of another kind. Declare it as a method, or rename it.',
      ),
    ]);
    expect(accessor.editor).toContain(accessor.compiler[0]);
    const field = bothHalves(
      program(
        `class A { get v(): f32 { return 1.; } }
class D extends A { v: f32 = 2.; }`,
        'const d = new D(); const q: f32 = d.v;',
      ),
    );
    expect(field.compiler).toEqual([
      T35(
        '"D.v" is a field, and the "A.v" it overrides is an accessor; TypeScript refuses an ' +
          'override of another kind. Declare it as an accessor, or rename it.',
      ),
    ]);
    expect(field.editor).toContain(field.compiler[0]);
  });

  it('a field redeclared with another type is refused, and with the same type is not', () => {
    refuses(
      program(
        `class A { x: f32 = 1.; }
class D extends A { x: vec3 = vec3(0.); }`,
        'const d = new D();',
      ),
      [
        T10(
          '"D" declares "x" as vec3, and "A" declares it as f32. A struct has one layout, so a ' +
            'field cannot change type on the way down.',
        ),
      ],
    );
    const same = bothHalves(
      program(
        `class A { x: f32 = 1.; }
class D extends A { x: f32 = 2.; }`,
        'const d = new D();',
      ),
    );
    expect(same.compiler).toEqual([]);
  });
});

describe('two members that reach one emitted name', () => {
  it('a private method and a public one of the same name', () => {
    refuses(
      program(
        `class A { #step(): f32 { return 1.; } step(): f32 { return 2.; } x: f32 = 1.; }`,
        'const a = new A(); const q: f32 = a.step();',
      ),
      [T35('"A.#step" and "A.step" would be emitted under one name. Rename one of them.')],
    );
  });

  it('a getter and a method named get_ plus the property', () => {
    refuses(
      program(
        `class A { get x(): f32 { return 1.; } get_x(): f32 { return 2.; } y: f32 = 1.; }`,
        'const a = new A(); const q: f32 = a.get_x();',
      ),
      [T35('The getter "A.x" and "A.get_x" would be emitted under one name. Rename one of them.')],
    );
  });

  it('a static and an instance method of one name', () => {
    refuses(
      program(
        `class A { static m(): f32 { return 1.; } m(): f32 { return 2.; } y: f32 = 1.; }`,
        'const a = new A(); const q: f32 = a.m();',
      ),
      [T35('The static "A.m" and "A.m" would be emitted under one name. Rename one of them.')],
    );
  });

  it('a private static field and a public one of the same name', () => {
    refuses(
      program(
        `class A { static #n: f32 = 1.; static n: f32 = 2.; x: f32 = 1.; }`,
        'const a = new A();',
      ),
      [
        T35(
          '"A.#n" and "A.n" would both be the module constant "A_n": a private name is emitted ' +
            'without its "#". Rename one of them.',
        ),
      ],
    );
  });

  it('a private field of a base and of the class that extends it', () => {
    refuses(
      program(
        `class A { #count: f32 = 1.; inc(): f32 { return this.#count; } }
class B extends A { #count: f32 = 2.; }`,
        'const b = new B();',
      ),
      [
        T10(
          '"A" declares "#count" and "B" declares "#count", which would both be the struct ' +
            'member "count": a private name is emitted without its "#". Rename one of them.',
        ),
      ],
    );
  });

  it('one name as a field and as a method', () => {
    refuses(program(`class A { m: f32 = 1.; m(): f32 { return 1.; } }`, 'const a = new A();'), [
      T35(
        '"A.m" is declared as a field and as a method; a class member has one kind. Rename one of them.',
      ),
    ]);
  });

  it('a second body of one method, once for the class', () => {
    refuses(
      program(
        `class A { x: f32 = 1.; m(): f32 { return 1.; } m(): f32 { return 2.; } }`,
        'const a = new A(); const q: f32 = a.m();',
      ),
      [
        T35(
          '"A.m" has two bodies; a method has one body, with overload signatures above it for ' +
            'each shape it takes.',
        ),
      ],
    );
  });
});

describe('what the class body says once, and what a use adds nothing to', () => {
  it('a static block is refused where it is written', () => {
    refuses(
      program(
        `class A { static v: f32 = 1.; static { A.v = 2.; } x: f32 = 1.; }`,
        'const a = new A(); const q: f32 = A.v;',
      ),
      [
        T35(
          'A static block runs when the class is defined, and a shader has no such moment. ' +
            'Give each static field its value where it is declared.',
        ),
      ],
    );
  });

  it('a static field that holds a function is a static method', () => {
    refuses(
      program(`class A { static f: () => f32 = () => 1.; x: f32 = 1.; }`, 'const a = new A();'),
      [T35('A static field holding a function is a static method: write "static f(...) { ... }".')],
    );
  });

  it('an async field function is refused once', () => {
    refuses(program(`class A { f = async () => 1.; x: f32 = 1.; }`, 'const a = new A();'), [
      T35(
        '"A.f" is async, and a shader function runs to completion in one call: there is no ' +
          'event loop to wait on. Remove "async" and each "await".',
      ),
    ]);
  });

  it('a field without a type is refused once, and a read of it says nothing more', () => {
    const halves = bothHalves(
      program(`class A { z; y: f32 = 1.; }`, 'const a = new A(); const q = a.z;'),
    );
    expect(halves.compiler).toEqual([T10('Field "z" on "A" needs a type: write "z: T".')]);
    expect(halves.editor).toContain(T10('Field "z" on "A" needs a type: write "z: T".'));
  });

  it('a field of a generic interface is withheld, and a read of it says nothing more', () => {
    refuses(
      program(
        `interface G<T> { x: T }
class A { g: G<f32>; y: f32 = 1.; }`,
        'const a = new A(); const q: f32 = a.g.x;',
      ),
      [
        T10(
          '"G" is a generic interface; a generic struct is written as a class, class G<T> ' +
            '{ x: T } (surface §32).',
        ),
      ],
    );
  });

  it('a generic base written with a type parameter is refused once for every instance', () => {
    const halves = bothHalves(
      program(
        `class B<T> { x: T; constructor(x: T) { this.x = x; } }
class D<T> extends B<T> { }`,
        'const d = new D<f32>(1.); const e = new D<vec3>(vec3(1.));',
      ),
    );
    const base = halves.compiler.filter((line) => line.includes('"B<T>" is written'));
    expect(base).toHaveLength(1);
    expect(halves.editor).toContain(base[0]);
    expect(halves.compiler.filter((line) => line.startsWith('typeshade TS8002'))).toHaveLength(1);
  });

  it('a base that nothing declares is said once, where it is written', () => {
    refuses(program(`class D extends Missing { x: f32 = 1.; }`, 'const d = new D();'), [
      'typeshade TS8002: Unknown type "Missing". Declare it in this file, or import it from another shader module.',
    ]);
  });

  it('@align on a field is refused where it is written', () => {
    refuses(program(`class A { @align(16) x: f32 = 1.; }`, 'const a = new A();'), [
      T10('@align on a field is not applied.'),
    ]);
  });

  it('an interface with no members is refused as an empty struct', () => {
    const halves = bothHalves(program(`interface E { }`, 'const e: E = {};'));
    const empty = T10(
      'Struct "E" has no fields. WGSL requires a struct to declare at least one member, so ' +
        'an empty one cannot be emitted.',
    );
    expect(halves.compiler).toContain(empty);
    expect(halves.editor).toContain(empty);
  });

  it('a struct that extends itself is refused once', () => {
    const line = T10(
      '"A" extends itself, through "A" -> "A". A struct cannot contain its own fields.',
    );
    const halves = bothHalves(program(`class A extends A { x: f32 = 1.; }`, 'const d = new A();'));
    expect(halves.compiler).toEqual([line]);
    expect(halves.editor).toContain(line);
  });
});
