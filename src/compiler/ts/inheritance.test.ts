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
//
// Verifies: Rule 6.9 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileTsSource } from './source-file.js';
import { TS_CODES } from './codes.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`);

/** The compiler's errors for `src`, after asserting that the editor shows the same ones and
 *  nothing beside them: TypeScript's report of each mistake is merged into the compiler's
 *  (Rule 12.4). */
const bothHalves = (src: string): string[] => {
  const errors = errorsOf(src);
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', src);
  const editor = service
    .getDiagnostics('a.ts')
    .filter((d) => d.severity === 'error')
    .map((d) => `${d.code} ${d.message}`);
  expect(editor.sort(), `the editor, for\n${src}`).toEqual([...errors].sort());
  return errors;
};

const agree = (r: ReturnType<typeof compile>, expected: number[]): void => {
  for (const make of [compileModule, compileModuleJs]) {
    expect(make(r.module).fns['fs']!(), make.name).toEqual(expected);
  }
};

const file = (head: string, body: string) => `"use typeshade"
${head}@fragment
export function fs(): vec4 {
${body}
}
`;

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
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('struct C {\n  a: f32,\n  b: f32,\n  c: f32,\n}');
    expect(r.glsl?.fragment).toContain('struct C {\n  float a;\n  float b;\n  float c;\n};');
    agree(r, [1, 2, 3, 1]);
  });

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
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain(
      'struct FromInterface {\n  x: f32,\n  y: f32,\n  z: f32,\n  w: f32,\n}',
    );
    agree(r, [1, 2, 3, 4]);
  });

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
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('struct P {\n  x: f32,\n}');
    agree(r, [5, 0, 0, 1]);
  });
});

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
    );
    expect(r.diagnostics).toEqual([]);
    // One function per class, each typed on its own struct: WGSL has no vtable.
    expect(r.wgsl).toContain('fn Derived_twice(self_: Derived) -> f32 {');
    expect(r.wgsl).toContain('fn Base_twice(self_: Base) -> f32 {');
    agree(r, [2, 3, 0, 1]);
  });

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
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('return (Square_area(self_) * self_.k);');
    expect(r.wgsl).toContain('return (Circle_area(self_) * self_.k);');
    // An abstract class is a base and never a value: no instance method of its own.
    expect(r.wgsl).not.toContain('fn Shape_scaled');
    agree(r, [18, 12, 0, 1]);
  });

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
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn Derived_unit() -> f32 {');
    agree(r, [1, 1, 4, 1]);
  });
});

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
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('let _sup = Base_new(x);');
    expect(r.wgsl).toContain('self_.x = _sup.x;');
    agree(r, [10, 2, 0, 1]);
  });

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
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('let _sup = Shape_new(k);');
    agree(r, [18, 2, 3, 1]);
  });

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
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).not.toContain('_sup');
    agree(r, [4, 2, 0, 1]);
  });

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
    );
    expect(r.diagnostics).toEqual([]);
    // The base is named as well as the class, so `super` inside a re-lowered body still counts
    // from where that body was written and the chain terminates.
    expect(r.wgsl).toContain('fn C_super_B_at(self_: C, t: f32) -> f32 {');
    expect(r.wgsl).toContain('fn C_super_A_at(self_: C, t: f32) -> f32 {');
    expect(r.wgsl).toContain('return (C_super_A_at(self_, t) + self_.b);');
    agree(r, [17, 0, 0, 1]);
  });

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
    );
    expect(
      errorsOf(`"use typeshade";
function f(): f32 {
  return super.v();
}
@fragment
export function fs(): vec4 {
  return vec4(f(), 0., 0., 1.);
}
`)[0],
    ).toContain('"super" names the class above the one whose body it is written in');
  });
});

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
    );
    expect(
      errorsOf(
        file(
          `class A extends B {\n  a: f32\n}\nclass B extends A {\n  b: f32\n}\n`,
          `  const v: A = { a: 1. }\n  return vec4(v.a, 0., 0., 1.)`,
        ),
      )[0],
    ).toContain('extends itself, through');
    expect(
      errorsOf(
        file(
          `class A {\n  x: i32\n}\nclass B extends A {\n  x: f32\n}\n`,
          `  const v: B = { x: 1. }\n  return vec4(v.x, 0., 0., 1.)`,
        ),
      )[0],
    ).toBe(
      `${TS_CODES.STRUCT_FIELD} "B" declares "x" as f32, and "A" declares it as i32. A struct has one layout, so a field cannot change type on the way down.`,
    );
  });

  it('a base-typed name holding a derived value, with the reason', () => {
    const HEAD = `class Base {\n  x: f32\n}\nclass Derived extends Base {\n  y: f32\n}\n`;
    const note =
      ' "Derived" extends "Base", and a name typed as the base cannot hold a derived value ' +
      'here: method dispatch is static, so a call through it would run "Base"\'s body. Write ' +
      '"Derived" as the type.';
    expect(
      errorsOf(
        file(
          HEAD,
          `  const d: Derived = { x: 1., y: 2. }\n  const b: Base = d\n  return vec4(b.x, 0., 0., 1.)`,
        ),
      )[0],
    ).toContain(note);
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
    ).toContain(note);
  });

  it('a generic base is its instance, and a call is read as the mixin it looks like', () => {
    // Refused until T9 (#92) with "one declaration per argument set" as the reason. That is
    // now what a generic class IS, so `Box<f32>` is the struct `Box_f32` and `D` inherits it.
    expect(
      errorsOf(
        file(
          `class Box<T> {\n  v: f32\n}\nclass D extends Box<f32> {\n  y: f32\n}\n`,
          `  const d: D = { v: 1., y: 2. }\n  return vec4(d.v, 0., 0., 1.)`,
        ),
      ),
    ).toEqual([]);
    expect(
      errorsOf(
        file(
          `class Base {\n  x: f32\n}\nfunction mix2(b: f32): f32 {\n  return b\n}\nclass D extends mix2(1.) {\n  y: f32\n}\n`,
          `  const d: D = { y: 2. }\n  return vec4(d.y, 0., 0., 1.)`,
        ),
      ).join(' '),
      // A call in an `extends` is the mixin pattern now (T8, #92), so what this says is why
      // `mix2` is not one, rather than that a base may not be an expression at all.
    ).toContain('so its body has to be one "return class');
  });
});

describe('an abstract member is checked where it is declared', () => {
  // TypeScript refuses each of these too (TS1244, TS1245, TS1253, TS1267, TS1318, TS2515,
  // TS2654), and the editor shows the compiler's sentence in place of its report (`bothHalves`).
  const M = TS_CODES.CLASS_MEMBER;
  const FS = `@fragment
export function fs(): vec4 { return vec4(1.) }
`;

  it('one with a body, on the class that declares it, once', () => {
    // Until proposal 0008 the sentence was `"D.m" is abstract; a shader function has one body.`,
    // named for the class that inherits the member rather than the one that wrote it, said
    // nothing of the body, and was followed by `"D" has no method "m"` at the call. With an
    // override in `D` it was not said at all, and the program compiled (TS1245 in the editor).
    const body = `"B.m" is abstract and has a body; remove "abstract", or remove the body and let each class that extends "B" write it.`;
    const B = `abstract class B { x: f32; abstract m(): f32 { return 1. } }\n`;
    const call = `export function g(d: D): f32 { return d.m() }\n`;
    expect(bothHalves(`"use typeshade"\n${B}class D extends B { y: f32 }\n${call}${FS}`)).toEqual([
      `${M} ${body}`,
    ]);
    expect(
      bothHalves(
        `"use typeshade"\n${B}class D extends B { y: f32; m(): f32 { return 2. } }\n${call}${FS}`,
      ),
    ).toEqual([`${M} ${body}`]);
    // Nothing extends it, and a generic class says it once, whatever it is instantiated with.
    expect(bothHalves(`"use typeshade"\n${B}${FS}`)).toEqual([`${M} ${body}`]);
    expect(
      bothHalves(`"use typeshade"
abstract class B<T> { x: T; abstract m(): f32 { return 1. } }
class D extends B<f32> { y: f32 }
class E extends B<vec2> { y: f32 }
${FS}`),
    ).toEqual([`${M} ${body}`]);
    // An accessor is a member too (TS1318), beside a setter that is not abstract (TS2676) or
    // alone, and a class that is not abstract has one remedy.
    for (const setter of ['', ' set g(v: f32) { this.x = v }']) {
      expect(
        bothHalves(`"use typeshade"
abstract class B { x: f32; abstract get g(): f32 { return 1. }${setter} }
class D extends B { y: f32 }
export function g(d: D): f32 { return d.g }
${FS}`),
      ).toEqual([
        `${M} "B.g" is abstract and has a body; remove "abstract", or remove the body and let each class that extends "B" write it.`,
      ]);
    }
    expect(
      bothHalves(`"use typeshade"\nclass B { x: f32; abstract m(): f32 { return 1. } }\n${FS}`),
    ).toEqual([`${M} "B.m" is abstract and has a body; remove "abstract".`]);
  });

  it('and so is a class that leaves one unimplemented, whether or not anything calls it', () => {
    // TypeScript refuses the class (TS2515). Until proposal 0008 it compiled while nothing
    // called the member, and a call was `"D" has no method "m"`, at the call.
    const B = `abstract class B { x: f32; abstract m(): f32; abstract get g(): f32; n(): f32 { return this.m() } }\n`;
    const unimplemented = `${M} "D" does not implement "m" and "g", which "B" declares abstract; write each in "D".`;
    expect(bothHalves(`"use typeshade"\n${B}class D extends B { y: f32 }\n${FS}`)).toEqual([
      unimplemented,
    ]);
    // A call, a read and an inherited body that calls it add nothing.
    expect(
      bothHalves(`"use typeshade"
${B}class D extends B { y: f32 }
export function f(d: D): f32 { return d.m() + d.g + d.n() }
${FS}`),
    ).toEqual([unimplemented]);
    // Through a class between, which declares nothing of it.
    expect(
      bothHalves(`"use typeshade"
abstract class A { x: f32; abstract m(): f32 }
abstract class B extends A { y: f32 }
class D extends B { z: f32 }
${FS}`),
    ).toEqual([`${M} "D" does not implement "m", which "A" declares abstract; write "m" in "D".`]);
    // What TypeScript takes compiles: the member written in the class, in a class between, as
    // a field that holds a function, and a field over an abstract accessor.
    expect(
      bothHalves(`"use typeshade"
${B}class D extends B { y: f32; m(): f32 { return 2. } g: f32 = 1. }
abstract class C extends B { m = (): f32 => 3. }
class E extends C { get g(): f32 { return 4. } }
export function f(d: D, e: E): f32 { return d.n() + d.g + e.n() + e.g }
${FS}`),
    ).toEqual([]);
    // A class in a function body is refused whole, and the compiler says nothing more of it.
    expect(
      errorsOf(`"use typeshade"
abstract class B { x: f32; abstract m(): f32 }
function h(): f32 {
  class D extends B { y: f32 }
  return 1.
}
export function f(): f32 { return h() }
${FS}`),
    ).toEqual([`${TS_CODES.UNSUPPORTED} Unsupported statement "class D extends B { y: f32 }".`]);
  });

  it('a field that holds a function has its body too, and a field its initializer', () => {
    // TypeScript refuses both (TS1267). Until proposal 0008 each compiled, and the abstract field
    // that holds a function was called like any method. A field that holds a function is a
    // method (Rule 8.16), and without its function, `abstract m: () => f32`, it would be a field
    // of function type, which no struct holds, so it is told only the one remedy.
    const B = `abstract class B { x: f32; abstract m = (): f32 => this.x }\n`;
    const call = `export function g(d: D): f32 { return d.m() }\n`;
    const arrow = `${M} "B.m" is abstract and has a body; remove "abstract".`;
    expect(bothHalves(`"use typeshade"\n${B}class D extends B { y: f32 }\n${call}${FS}`)).toEqual([
      arrow,
    ]);
    expect(
      bothHalves(
        `"use typeshade"\n${B}class D extends B { y: f32; m = (): f32 => this.y }\n${call}${FS}`,
      ),
    ).toEqual([arrow]);
    expect(
      bothHalves(`"use typeshade"
abstract class B { abstract x: f32 = 1.; y: f32 }
class D extends B { x: f32 = 2. }
export function g(d: D): f32 { return d.x }
${FS}`),
    ).toEqual([
      `${M} "B.x" is abstract and has an initializer; remove "abstract", or remove the initializer and let each class that extends "B" write it.`,
    ]);
    // In a class that is not abstract (TS1253 beside TS1267), the same one sentence.
    expect(
      bothHalves(`"use typeshade"
class B { x: f32; abstract m = (): f32 => this.x }
export function g(b: B): f32 { return b.m() }
${FS}`),
    ).toEqual([arrow]);
  });

  it('one with no body in a class that is not abstract, at the member, once', () => {
    // TypeScript refuses it (TS1244). Until proposal 0008 it compiled while nothing called it,
    // and a call was `"B" has no method "m"` at the call, as was one through a class extending
    // it. The class withholds the member, so a call of it, and a class that extends this one
    // without writing it, add nothing (Rule 12.4); a class that writes it compiles.
    const shown = (m: string): string =>
      `${M} "B.${m}" is abstract, and "B" is not; mark "B" abstract, or remove "abstract" and give "${m}" a body.`;
    expect(
      bothHalves(`"use typeshade"
class B { x: f32; abstract m(): f32; abstract get g(): f32 }
class D extends B { y: f32 }
export function f(b: B, d: D): f32 { return b.m() + d.m() + b.g + d.g }
${FS}`),
    ).toEqual([shown('m'), shown('g')]);
    // Two overload signatures are one member.
    expect(
      bothHalves(`"use typeshade"
class B { x: f32; abstract m(a: f32): f32; abstract m(a: vec2): vec2 }
${FS}`),
    ).toEqual([shown('m')]);
    // A mixin's class expression cannot be abstract at all: said where it is written, once,
    // however many classes apply it.
    expect(
      bothHalves(`"use typeshade"
class Disc { r: f32 }
function Tinted<TBase extends AnyClass>(Base: TBase) {
  return class extends Base { tint: vec3; abstract lit(): f32 }
}
class TD extends Tinted(Disc) { s: f32 }
class TR extends Tinted(Disc) { w: f32 }
export function g(t: TD, u: TR): f32 { return t.lit() + u.lit() }
${FS}`),
    ).toEqual([
      `${M} "Tinted(…).lit" is abstract, and the class a mixin returns cannot be; remove "abstract" and give "lit" a body.`,
    ]);
  });

  it('one with a body in a mixin, where the mixin writes it, once', () => {
    // Until proposal 0008 this was said once for each class that applied the mixin, under that
    // class's name, `"TD.lit" is abstract; ...`, though neither class wrote the member.
    expect(
      bothHalves(`"use typeshade"
class Disc { r: f32 }
class Ring { r: f32; w: f32 }
function Tinted<TBase extends AnyClass>(Base: TBase) {
  return class extends Base { tint: vec3; abstract lit(): f32 { return 1. } }
}
class TD extends Tinted(Disc) { s: f32 }
class TR extends Tinted(Ring) { s: f32 }
export function g(t: TD, u: TR): f32 { return t.lit() + u.lit() }
${FS}`),
    ).toEqual([`${M} "Tinted(…).lit" is abstract and has a body; remove "abstract".`]);
    // Whether or not a class that applies it writes the member over it, or anything applies
    // it: TypeScript refuses it where it is written (TS1245, TS1244). Until proposal 0008 each
    // of these compiled.
    const tinted = (member: string, applied: string): string => `"use typeshade"
class Disc { r: f32 }
function Tinted<TBase extends AnyClass>(Base: TBase) {
  return class extends Base { tint: vec3; ${member} }
}
${applied}${FS}`;
    const over = `class TD extends Tinted(Disc) { s: f32; lit(): f32 { return 2. } }
export function g(t: TD): f32 { return t.lit() }
`;
    expect(bothHalves(tinted('abstract lit(): f32 { return 1. }', over))).toEqual([
      `${M} "Tinted(…).lit" is abstract and has a body; remove "abstract".`,
    ]);
    expect(bothHalves(tinted('abstract lit(): f32 { return 1. }', ''))).toEqual([
      `${M} "Tinted(…).lit" is abstract and has a body; remove "abstract".`,
    ]);
    expect(bothHalves(tinted('abstract lit(): f32', over))).toEqual([
      `${M} "Tinted(…).lit" is abstract, and the class a mixin returns cannot be; remove "abstract" and give "lit" a body.`,
    ]);
    // A generic class says it once whatever it is instantiated with, or when nothing is.
    const generic = `${M} "B.m" is abstract and has a body; remove "abstract", or remove the body and let each class that extends "B" write it.`;
    expect(
      bothHalves(`"use typeshade"
abstract class B<T> { v: T; abstract m(a: T): T { return a } }
${FS}`),
    ).toEqual([generic]);
  });

  it('says nothing of why a class has no field, which is said too', () => {
    // A base with no field is no struct, and a class that extends it has nothing of it. The
    // sentence about the member says nothing of that, and it stood in for the sentence that
    // does, so the class that extends was told only that its base is no struct.
    const noFields = (cls: string): string =>
      `${TS_CODES.STRUCT_FIELD} Struct "${cls}" has no fields. WGSL requires a struct to declare at least one member, so an empty one cannot be emitted.`;
    const notStruct = `${TS_CODES.STRUCT_FIELD} "Circle" extends "Shape", which this file does not declare as a struct. A base has to be a class or an interface whose fields are shader types.`;
    // A call of what the base would have given adds nothing to that.
    expect(
      bothHalves(`"use typeshade"
abstract class Shape { abstract sdf(p: vec2): f32 { return 0. } }
class Circle extends Shape { r: f32 }
export function g(c: Circle): f32 { return c.sdf(vec2(0.1, 0.2)) }
${FS}`),
    ).toEqual([
      `${M} "Shape.sdf" is abstract and has a body; remove "abstract", or remove the body and let each class that extends "Shape" write it.`,
      `${noFields('Shape')} A class holding only functions is not a struct; write them as functions.`,
      notStruct,
    ]);
    expect(
      bothHalves(`"use typeshade"
class Shape { abstract sdf(p: vec2): f32 }
class Circle extends Shape { r: f32; sdf(p: vec2): f32 { return length(p) - this.r } }
export function g(c: Circle): f32 { return c.sdf(vec2(0.1)) }
${FS}`),
    ).toEqual([
      `${M} "Shape.sdf" is abstract, and "Shape" is not; mark "Shape" abstract, or remove "abstract" and give "sdf" a body.`,
      noFields('Shape'),
      notStruct,
    ]);
  });

  it('a signature beside the body of its name is refused where it is written', () => {
    // TypeScript refuses an abstract overload signature of a method whose body is not
    // (TS2512). Until proposal 0008 the compiler took it, and a class that extends the one that
    // writes it was then told it does not implement the method, which its base does.
    const d = `class D extends C { }
export function g(d: D): f32 { return d.m() }
${FS}`;
    expect(
      bothHalves(`"use typeshade"
abstract class C { x: f32; abstract m(): f32; m(): f32 { return 1. } }
${d}`),
    ).toEqual([`${M} A signature of "C.m" is abstract, and its body is not; remove "abstract".`]);
    // Below the body a signature is none (TS2391), so it goes.
    expect(
      bothHalves(`"use typeshade"
abstract class C { x: f32; m(): f32 { return 1. } abstract m(): f32 }
${d}`),
    ).toEqual([
      `${M} A signature of "C.m" is abstract, and its body is not; remove the signature.`,
    ]);
    // In a class that is not abstract (TS1244 beside it) it is the same one mistake, and "C.m"
    // has the body a sentence about an abstract member would have told it to write.
    expect(
      bothHalves(`"use typeshade"
class C { x: f32; abstract m(): f32; m(): f32 { return 1. } }
export function g(c: C): f32 { return c.m() }
${FS}`),
    ).toEqual([`${M} A signature of "C.m" is abstract, and its body is not; remove "abstract".`]);
    // What the sentence offers compiles, with the body D inherits.
    const r = compile(`"use typeshade";
abstract class C { x: f32; m(): f32; m(): f32 { return this.x + 1.; } }
class D extends C { }
@fragment
export function fs(): vec4 { const d = new D(); d.x = 1.; return vec4(d.m()); }
`);
    expect(r.diagnostics).toEqual([]);
  });
});
