import { describe, expect, it } from 'vitest';
import { bothHalves, bothTake } from '../../core/testing/both-halves.js';
import { compile } from './compile.js';
import { uninlined } from '../../core/testing/keep-helpers.js';

const header = `"use typeshade"\n`;
const entry = (declarations: string, body = ''): string =>
  `${header}${declarations}\n@fragment export function fs(): vec4 { ${body} return vec4(0.); }\n`;

const refuses = (source: string, lines: readonly string[]): void => {
  const halves = bothHalves(source);
  expect(halves.compiler).toEqual(lines);
  for (const line of lines) expect(halves.editor).toContain(line);
};

const twoBodies = (owner: string, name: string): string =>
  `typeshade TS8035: "${owner}.${name}" has two bodies; a method has one body, with overload ` +
  `signatures above it for each shape it takes.`;

const cycleSentence = (field: string, path: readonly string[]): string =>
  `typeshade TS8010: Field "${field}" makes "${path[0]}" contain itself, through ` +
  `${path.map((n) => `"${n}"`).join(' -> ')}. A struct has a fixed size, so it cannot hold ` +
  `itself: hold an index into an array of "${path[0]}" instead, or remove the field.`;

const wgsl = (source: string): string => uninlined(() => bothTake(source).result.wgsl ?? '');

describe('a sentence about how a member is written is said once, where it is written', () => {
  it('for a generic class, once however many instances the file writes', () => {
    refuses(
      entry(
        `class G<T> { v: T; m(): f32 { return 1.; } m(): f32 { return 2.; } }`,
        'const a = new G<f32>(); const b = new G<vec3>();',
      ),
      [twoBodies('G', 'm')],
    );
  });

  it('for a class that nothing instantiates', () => {
    refuses(entry(`class U { x: f32 = 1.; m(): f32 { return 1.; } m(): f32 { return 2.; } }`), [
      twoBodies('U', 'm'),
    ]);
  });

  it('for the class a mixin returns, named by the mixin call', () => {
    refuses(
      entry(
        `function Tinted<T extends new (...a: any[]) => {}>(B: T) { return class extends B { m(): f32 { return 1.; } m(): f32 { return 2.; } }; }
class Base { b: f32 = 1.; }
class D extends Tinted(Base) { d: f32 = 2.; }`,
      ),
      [twoBodies('Tinted(…)', 'm')],
    );
  });

  it('for a static function with two bodies, which does not also make an empty struct', () => {
    refuses(entry(`class A { static m(): f32 { return 1.; } static m(): f32 { return 2.; } }`), [
      twoBodies('A', 'm'),
    ]);
  });

  it('for a second constructor', () => {
    refuses(
      entry(`class A { x: f32 = 1.; constructor() { } constructor() { } }`, 'const a = new A();'),
      ['typeshade TS8035: "A" declares two constructors; a shader function has one body.'],
    );
  });

  it('for an abstract member that has an initializer', () => {
    refuses(
      entry(`abstract class A { abstract x: f32 = 1.; }
class D extends A { x: f32 = 2.; }`),
      [
        'typeshade TS8035: "A.x" is abstract and has an initializer; remove "abstract", or remove the initializer and let each class that extends "A" write it.',
      ],
    );
  });

  it('for an abstract signature beside a body of its name', () => {
    refuses(
      entry(
        `abstract class A { abstract m(): f32; m(): f32 { return 1.; } }
class D extends A { x: f32 = 1.; }`,
        'const d = new D(); d.m();',
      ),
      [
        'typeshade TS8035: A signature of "A.m" is abstract, and its body is not; remove "abstract".',
      ],
    );
  });

  it('for a generator, a generic arrow and an async function a field holds', () => {
    refuses(entry(`class A { f = function* () { }; x: f32 = 1.; }`, 'const a = new A();'), [
      'typeshade TS8035: "A.f" is a generator, and a shader function runs to completion in one call: nothing suspends it at a "yield". Remove the "*" and return one value.',
    ]);
    refuses(entry(`class A { f = <T>(p: T) => p; x: f32 = 1.; }`, 'const a = new A();'), [
      'typeshade TS8035: "A.f" takes type parameters, and a method does not; write it as a generic function of the module.',
    ]);
  });

  it('for new this() in a static factory that a derived class calls', () => {
    refuses(
      entry(
        `class A { x: f32 = 1.; static make(): A { return new this(); } }
class B extends A { y: f32 = 2.; }`,
        'const b = B.make();',
      ),
      [
        'typeshade TS8035: "A.make" builds its value with "new this()", so "B.make()" returns a B, but it is declared to return a A, which is the type the editor gives the call. Declare the class the call names: static make<C extends A>(this: { new (): C }): C',
      ],
    );
  });
});

describe('a refusal at a declaration that no value reaches', () => {
  it('a location written as a negative number, on an exported interface', () => {
    refuses(`${header}export interface V { a: location<-1, vec4> }\n`, [
      'typeshade TS8028: @location takes one non-negative integer literal: @location(0).',
    ]);
  });

  it('a location written as a negative number, on a generic class nothing instantiates', () => {
    refuses(`${header}class G<T> { a: location<-1, vec4>; t: T }\n`, [
      'typeshade TS8028: @location takes one non-negative integer literal: @location(0).',
    ]);
  });

  it('a builtin name that does not exist, on an exported interface', () => {
    const halves = bothHalves(`${header}export interface V { a: builtin<'nope'> }\n`);
    expect(halves.compiler).toHaveLength(1);
    expect(halves.compiler[0]).toContain('typeshade TS8024: Unknown builtin "nope".');
    expect(halves.editor).toContain(halves.compiler[0]);
  });

  it('a slot collision on an interface exported by a clause', () => {
    const line = `typeshade TS8010: Struct "V" puts "a" and "b" both at location<0, …>; each slot carries one value.`;
    refuses(
      `${header}interface V { a: location<0, vec4>; b: location<0, vec4> }\nexport { V };\n`,
      [line],
    );
    refuses(
      `${header}type V = { a: location<0, vec4>; b: location<0, vec4> };\nexport type { V as W };\n`,
      [line],
    );
  });

  it('a struct that holds itself, only when the file exports it or something uses it', () => {
    refuses(`${header}export interface R { r: R }\n`, [cycleSentence('R.r', ['R', 'R'])]);
    refuses(`${header}interface R { r: R }\n`, []);
  });

  it('a cycle of two structs is named from the struct declared first, and the field is cut', () => {
    const halves = bothHalves(
      entry(
        `class A { b: B; x: f32 = 1.; }
class B { a: A; y: f32 = 1.; }`,
        'const a = new A();',
      ).replace('return vec4(0.)', 'return vec4(a.x, a.b.y, 0., 1.)'),
    );
    expect(halves.compiler).toEqual([cycleSentence('B.a', ['A', 'B', 'A'])]);
    expect(halves.editor).toContain(cycleSentence('B.a', ['A', 'B', 'A']));
    const fields = halves.result.module.structs.map(
      (s) => `${s.name}:${s.fields.map((f) => f.name)}`,
    );
    expect(fields).toEqual(['A:b,x', 'B:y']);
  });

  it('an optional and an array of the struct itself are cycles too', () => {
    refuses(entry(`class R { r: R | undefined; }`), [cycleSentence('R.r', ['R', 'R'])]);
    refuses(entry(`class R { r: array<R, 2>; }`), [cycleSentence('R.r', ['R', 'R'])]);
  });
});

describe('what a use of a refused declaration adds nothing to', () => {
  it('a generic interface behind a plain alias is refused once', () => {
    refuses(
      entry(`interface G<T> { x: T }
type GF = G<f32>;
function f(g: GF): f32 { return 1.; }`),
      [
        'typeshade TS8010: "G" is a generic interface; a generic struct is written as a class, class G<T> { x: T } (surface §32).',
      ],
    );
  });

  it('a parameter property of an unknown type is refused once, at the parameter', () => {
    refuses(entry(`class A { constructor(public x: Foo) {} }`), [
      'typeshade TS8002: Unknown type "Foo". Declare it in this file, or import it from another shader module.',
    ]);
  });

  it('a call signature on an interface is refused where a use reaches it', () => {
    const halves = bothHalves(
      entry(`interface V { (a: f32): f32 }`, 'const v: V = (a: f32) => a;'),
    );
    const line =
      'typeshade TS8010: Data type "V" cannot be callable or constructable — a struct is data, and a signature has no layout.';
    expect(halves.compiler).toContain(line);
    expect(halves.editor).toContain(line);
    refuses(entry(`interface V { (a: f32): f32 }`), []);
  });

  it('two structs that an entry literal matches alike make the result unknown', () => {
    refuses(
      `${header}type P = { x: f32 };\ntype Q = { x: f32 };\n@fragment export function fs() { return { x: 1. }; }\n`,
      [
        'typeshade TS8022: Object literal { x } matches "P" and "Q" alike, so the entry\'s result is not known: write the return type.',
      ],
    );
  });
});

describe('what a declaration is and is not', () => {
  it('a type parameter constraint names a contract and collects nothing', () => {
    const text = wgsl(
      `${header}interface HasArea { area(): f32 }
function f<T extends HasArea>(t: T): f32 { return t.area(); }
class Sq implements HasArea { s: f32 = 1.; area(): f32 { return this.s; } }
@fragment export function fs(): vec4 { return vec4(f(new Sq())); }
`,
    );
    expect([...text.matchAll(/^struct (\w+) \{/gm)].map((m) => m[1])).toEqual(['Sq']);
  });

  it('an implements clause carries no layout and collects no interface', () => {
    const text = wgsl(
      entry(
        `interface I { x: f32 }
class A implements I { x: f32 = 1.; }`,
        'const a = new A();',
      ).replace('return vec4(0.)', 'return vec4(a.x)'),
    );
    expect([...text.matchAll(/^struct (\w+) \{/gm)].map((m) => m[1])).toEqual(['A']);
  });

  it('a nested namespace flattens a class to every name on the way', () => {
    const text = wgsl(
      entry(
        `namespace A { export namespace B { export class P { x: f32 = 1.; } } }`,
        'const p = new A.B.P();',
      ).replace('return vec4(0.)', 'return vec4(p.x)'),
    );
    expect(text).toContain('struct A_B_P {');
  });

  it('a static field that the file writes is a module variable', () => {
    const text = wgsl(
      entry(
        `class A { static n: f32 = 0.; x: f32 = 1.; bump(): void { A.n = A.n + 1.; } }`,
        'const a = new A(); a.bump();',
      ).replace('return vec4(0.)', 'return vec4(A.n)'),
    );
    expect(text).toContain('var<private> A_n: f32 = 0.0;');
  });

  it('a fieldless class with methods has a one-member representation', () => {
    const text = wgsl(entry(`class E { m(): f32 { return 1.; } }`, 'const e = new E();'));
    expect(text).toContain('struct E {\n  _empty: u32,\n}');
  });

  it('a refused interpolate type is no field attribute of the emitted struct', () => {
    const halves = bothHalves(
      entry(
        `class V { a: location<0, vec4, { interpolate: 'bogus' }> = vec4(0.); pos: builtin<'position'> = vec4(0.); }
@vertex export function vs(): V { return new V(); }`,
      ),
    );
    expect(halves.compiler).toEqual([
      'typeshade TS8028: interpolate type "bogus" is not one WGSL has: perspective, linear, flat.',
    ]);
    expect(halves.editor).toContain(halves.compiler[0]);
    expect(halves.result.wgsl ?? '').not.toContain('bogus');
  });

  it('an interpolate argument list keeps its sampling for both writers', () => {
    const halves = bothHalves(
      `${header}class V { a: location<0, vec4, { interpolate: ['perspective', 'centroid'] }> = vec4(0.); pos: builtin<'position'> = vec4(0.); }
@vertex export function vs(): V { return new V(); }
@fragment export function fs(i: V): vec4 { return i.a; }
`,
    );
    expect(halves.compiler).toEqual([]);
    expect(halves.editor).toEqual([]);
    expect(halves.result.wgsl).toContain(
      '@location(0) @interpolate(perspective, centroid) a: vec4<f32>,',
    );
    expect(halves.result.glsl?.vertex).toContain('smooth centroid out vec4 a;');
    expect(halves.result.glsl?.fragment).toContain('smooth centroid in vec4 a;');
  });

  it('a static-only class that builds itself with new this() becomes a struct', () => {
    const text = wgsl(
      entry(`class A { static make() { const a = new this(); return 1.; } }`).replace(
        'return vec4(0.)',
        'return vec4(A.make())',
      ),
    );
    expect([...text.matchAll(/^struct (\w+) \{/gm)].map((m) => m[1])).toEqual(['A']);
  });
});

describe('collection that follows a name written in an extends clause', () => {
  it('a class that extends an interface collects it and takes its fields first', () => {
    const result = uninlined(() =>
      compile(
        entry(
          `interface I { x: f32 }
class D extends I { y: f32 = 1.; }`,
          'const d = new D();',
        ).replace('return vec4(0.)', 'return vec4(d.y)'),
      ),
    );
    const text = result.wgsl ?? '';
    expect([...text.matchAll(/^struct (\w+) \{/gm)].map((m) => m[1])).toContain('I');
    expect(text).toMatch(/struct D \{\n  x: f32,\n  y: f32,\n\}/);
  });

  it('an inherited static factory that builds this promotes the derived class too', () => {
    const text = wgsl(
      entry(
        `class A { static n: f32 = 1.; static make<C extends A>(this: { new (): C }): C { return new this(); } }
class B extends A { static m: f32 = 2.; }`,
        'const b = B.make();',
      ).replace('return vec4(0.)', 'return vec4(B.m)'),
    );
    expect([...text.matchAll(/^struct (\w+) \{/gm)].map((m) => m[1])).toEqual(['A', 'B']);
  });

  it('two classes of one name are reported once, by the walk that collects both', () => {
    const halves = bothHalves(
      entry(`class A { x: f32 = 1.; }
class A { y: f32 = 1.; }`),
    );
    const duplicates = halves.compiler.filter((line) => line.startsWith('typeshade TS8023'));
    expect(duplicates).toHaveLength(1);
    expect(halves.editor).toContain(duplicates[0]);
  });
});
