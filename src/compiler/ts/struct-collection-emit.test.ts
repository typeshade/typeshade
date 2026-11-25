import { describe, expect, it } from 'vitest';
import { bothTake } from '../../core/testing/both-halves.js';
import { uninlined } from '../../core/testing/keep-helpers.js';
import { compile } from './compile.js';

const program = (declarations: string, body = ''): string =>
  `"use typeshade"\n${declarations}\n@compute([1]) export function main(): void { ${body} }\n`;

const wgsl = (source: string): string => uninlined(() => bothTake(source).result.wgsl ?? '');

const live = (declarations: string, body: string, result: string): string =>
  `"use typeshade"\n${declarations}\n@fragment export function fs(): vec4 { ${body} return vec4(${result}, 0., 0., 1.); }\n`;

const structNames = (text: string): string[] =>
  [...text.matchAll(/^struct (\w+) \{/gm)].map((m) => m[1]!);

const structBody = (text: string, name: string): string[] => {
  const match = new RegExp(`^struct ${name} \\{\\n([^}]*)\\}`, 'm').exec(text);
  if (match === null) throw new Error(`no struct ${name}`);
  return match[1]!
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
};

describe('which declarations become structs', () => {
  it('a class is emitted whether or not anything refers to it', () => {
    expect(structNames(wgsl(program(`class Lonely { x: f32 = 1.; }`)))).toContain('Lonely');
  });

  it('a host-shaped interface, alias and dead alias chain are not collected', () => {
    const text = wgsl(
      program(`type P = { seed: number };
interface Q { cb: () => f32 }
type Params = P;
type List = P[];
type Maybe = P | undefined;`),
    );
    expect(structNames(text)).toEqual([]);
  });

  it('an interface or alias is emitted once a field of a struct uses it', () => {
    const text = wgsl(
      program(
        `interface Inner { a: f32 }
type Other = { b: f32 };
class Holder { i: Inner = { a: 1. }; o: Other = { b: 2. }; }`,
        'const h = new Holder();',
      ),
    );
    expect(structNames(text).sort()).toEqual(['Holder', 'Inner', 'Other']);
  });

  it('an interface used only by a declaration that nothing uses stays out', () => {
    const text = wgsl(
      program(`interface Inner { a: f32 }
type Alias = { b: Inner };`),
    );
    expect(structNames(text)).toEqual([]);
  });

  it('an entry with no return type that returns an object literal collects the struct it matches', () => {
    const text = wgsl(
      `"use typeshade";
type Only = { x: f32; y: f32 };
@fragment export function fs() { return { x: 1., y: 2. }; }
`,
    );
    expect(structNames(text)).toContain('Only');
  });

  it('a class in a namespace is the struct Ns_P', () => {
    const text = wgsl(
      program(`namespace N { export class P { x: f32 = 1.; } }`, 'const u = new N.P();'),
    );
    expect(structNames(text)).toEqual(['N_P']);
  });

  it('a generic class is one struct for each set of type arguments the file writes', () => {
    const text = wgsl(
      program(
        `class Pair<T> { a: T; constructor(a: T) { this.a = a; } }
class Never<T> { a: T; }`,
        'const u = new Pair<f32>(1.); const v = new Pair<vec3>(vec3(1.));',
      ),
    );
    expect(structNames(text)).toEqual(['Pair_f32', 'Pair_vec3']);
    expect(structBody(text, 'Pair_vec3')).toEqual(['a: vec3<f32>,']);
  });
});

describe('static-only classes', () => {
  it('a class of statics alone has no struct, and its functions and constants stay', () => {
    const text = wgsl(
      live(
        `class Util { static k: f32 = 2.; static half(v: f32): f32 { return v * 0.5; } }`,
        '',
        'Util.half(Util.k)',
      ),
    );
    expect(structNames(text)).toEqual([]);
    expect(text).toContain('const Util_k: f32 = 2.0;');
    expect(text).toContain('fn Util_half(v: f32) -> f32');
  });

  it('a construction of a static-only class promotes it to a struct', () => {
    const text = wgsl(
      program(`class Util { static k: f32 = 2.; }`, 'const u = new Util(); const q: f32 = Util.k;'),
    );
    expect(structNames(text)).toEqual(['Util']);
  });

  it('a type position of a static-only class promotes it to a struct', () => {
    const text = wgsl(
      program(
        `class Util { static k: f32 = 2.; }
function f(u: Util): f32 { return Util.k; }`,
      ),
    );
    expect(structNames(text)).toEqual(['Util']);
  });

  it('a class of statics that extends a struct is a struct with its base fields', () => {
    const text = wgsl(
      program(
        `class A { a: f32 = 1.; }
class B extends A { static s: f32 = 1.; }`,
        'const b = new B();',
      ),
    );
    expect(structBody(text, 'B')).toEqual(['a: f32,']);
  });

  it('a class of statics that extends a class of statics stays a namespace', () => {
    const text = wgsl(
      program(
        `class A { static s: f32 = 1.; }
class B extends A { static t: f32 = 2.; }`,
        'const q: f32 = B.t + B.s;',
      ),
    );
    expect(structNames(text)).toEqual([]);
  });

  it('the statics of a generic class are one function however many instances are written', () => {
    const text = wgsl(
      live(
        `class Op<T> { v: T; static unit(): f32 { return 1.; } constructor(v: T) { this.v = v; } }`,
        'const a = new Op<f32>(1.); const b = new Op<vec3>(vec3(1.)); const c = new Op<vec2>(vec2(1.));',
        'Op.unit() + a.v + b.v.x + c.v.x',
      ),
    );
    expect(text.match(/fn Op_unit\(/g)).toHaveLength(1);
    expect(structNames(text)).toEqual(['Op_f32', 'Op_vec3', 'Op_vec2']);
  });
});

describe('the fields of a struct', () => {
  it('base fields stand ahead of the derived ones, and a redeclared one keeps the base place', () => {
    const text = wgsl(
      program(
        `class Base { x: f32 = 1.; y: f32 = 2.; }
class Derived extends Base { z: f32 = 3.; x: f32 = 5.; }`,
        'const d = new Derived();',
      ),
    );
    expect(structBody(text, 'Derived')).toEqual(['x: f32,', 'y: f32,', 'z: f32,']);
  });

  it('a chain of three inherits the whole prefix even when declared derived first', () => {
    const text = uninlined(
      () =>
        compile(
          live(
            `class C extends B { c: f32 = 3.; }
class B extends A { b: f32 = 2.; }
class A { a: f32 = 1.; }`,
            'const u = new C();',
            'u.c',
          ),
        ).wgsl ?? '',
    );
    expect(structBody(text, 'C')).toEqual(['a: f32,', 'b: f32,', 'c: f32,']);
    expect(structBody(text, 'B')).toEqual(['a: f32,', 'b: f32,']);
  });

  it('an abstract class is emitted as a struct, and its method body goes to each concrete class', () => {
    const text = wgsl(
      live(
        `abstract class Shape { abstract area(): f32; double(): f32 { return this.area() * 2.; } }
class Sq extends Shape { s: f32 = 2.; area(): f32 { return this.s * this.s; } }`,
        'const u = new Sq();',
        'u.double()',
      ),
    );
    expect(structNames(text)).toContain('Shape');
    expect(text).toContain('fn Sq_area(self_: Sq) -> f32');
    expect(text).toContain('Sq_area(');
    expect(text).not.toMatch(/fn Shape_\w+\(/);
  });

  it('a field written without a type takes the type of its initializer', () => {
    const text = wgsl(
      program(
        `class Q { x: f32 = 1.; }
class S { hits = 0; on = false; v = vec3(0.); p = new Q(); }`,
        'const u = new S();',
      ),
    );
    expect(structBody(text, 'S')).toEqual(['hits: f32,', 'on: bool,', 'v: vec3<f32>,', 'p: Q,']);
  });

  it('an optional field is the same struct member in all three spellings', () => {
    const text = wgsl(
      program(
        `class A { f?: f32 = 1.; }
interface B { g?: f32 }
type C = { h?: f32 }`,
        'const a = new A(); const b: B = {}; const c: C = {};',
      ),
    );
    expect(structBody(text, 'A')).toEqual(['f: _opt_f32_,']);
    expect(structBody(text, 'B')).toEqual(['g: _opt_f32_,']);
    expect(structBody(text, 'C')).toEqual(['h: _opt_f32_,']);
  });

  it('a parameter property is a field, and an optional one is an optional field', () => {
    const text = wgsl(
      program(`class A { constructor(public x: f32, public w?: f32) { } }`, 'const a = new A(1.);'),
    );
    expect(structBody(text, 'A')).toEqual(['x: f32,', 'w: _opt_f32_,']);
  });

  it('a private field is the member without its hash', () => {
    const text = wgsl(
      program(
        `class A { #count: f32 = 1.; inc(): f32 { return this.#count; } }`,
        'const a = new A(); const q: f32 = a.inc();',
      ),
    );
    expect(structBody(text, 'A')).toEqual(['count: f32,']);
  });

  it('a static field is the module constant Cls_Field', () => {
    const text = wgsl(
      program(
        `class K { static LIM: f32 = 3.; x: f32 = 1.; static twice(): f32 { return K.LIM * 2.; } }`,
        'const q: f32 = K.twice();',
      ),
    );
    expect(text).toContain('const K_LIM: f32 = 3.0;');
    expect(structBody(text, 'K')).toEqual(['x: f32,']);
  });
});
