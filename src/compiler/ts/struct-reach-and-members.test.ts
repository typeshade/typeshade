import { describe, expect, it } from 'vitest';
import { bothHalves, bothTake } from '../../core/testing/both-halves.js';
import { uninlined } from '../../core/testing/keep-helpers.js';
import { compileModule } from '../../core/oracle.js';

const fragment = (declarations: string, body: string, result: string): string =>
  `"use typeshade"\n${declarations}\n@fragment export function fs(): vec4 { ${body} return vec4(${result}, 0., 0., 1.); }\n`;

const wgsl = (source: string): string => uninlined(() => bothTake(source).result.wgsl ?? '');

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

describe('a place that consumes a type makes its interface a struct', () => {
  const reached = (declarations: string, body: string, result: string): string[] =>
    structNames(wgsl(fragment(`interface I { a: f32 }\n${declarations}`, body, result)));

  it('a parameter annotation', () => {
    expect(
      reached(`function f(i: I): f32 { return i.a; }`, 'const i: I = { a: 1. };', 'f(i)'),
    ).toEqual(['I']);
  });

  it('a return annotation', () => {
    expect(reached(`function f(): I { return { a: 1. }; }`, '', 'f().a')).toEqual(['I']);
  });

  it('a local annotation', () => {
    expect(reached('', 'const i: I = { a: 1. };', 'i.a')).toEqual(['I']);
  });

  it('a module const annotation', () => {
    expect(reached(`const K: I = { a: 1. };`, '', 'K.a')).toEqual(['I']);
  });

  it('the argument of a uniform binding', () => {
    expect(reached(`declare const u: uniform<I>;`, '', 'u.a')).toEqual(['I']);
  });

  it('the element of a storage binding', () => {
    expect(reached(`declare const u: storage<array<I>>;`, '', 'u[0].a')).toEqual(['I']);
  });

  it('a type declaration that mentions it, without a consumer, does not', () => {
    expect(reached(`type Alias = I; type List = I[];`, '', '1.')).toEqual([]);
  });
});

describe('a base written with type arguments', () => {
  it('is the instance struct, and the derived struct keeps its fields first', () => {
    const text = wgsl(
      fragment(
        `class Box<T> { v: T; constructor(v: T) { this.v = v; } }
class Small extends Box<f32> { w: f32 = 1.; }`,
        'const s = new Small(2.);',
        's.v + s.w',
      ),
    );
    expect(structNames(text)).toEqual(['Box_f32', 'Small']);
    expect(structBody(text, 'Small')).toEqual(['v: f32,', 'w: f32,']);
  });
});

describe('a mixin', () => {
  it('puts its members after the base fields and before the class own', () => {
    const text = wgsl(
      fragment(
        `function Tint<T extends new (...a: any[]) => {}>(B: T) { return class extends B { t: f32 = 1.; }; }
class Base { b: f32 = 1.; }
class D extends Tint(Base) { d: f32 = 2.; }`,
        'const d = new D();',
        'd.b + d.t + d.d',
      ),
    );
    expect(structBody(text, 'D')).toEqual(['b: f32,', 't: f32,', 'd: f32,']);
  });
});

describe('a field written without a type', () => {
  it('takes f32 where its uses do not decide, and the type its uses give where they do', () => {
    const f32Text = wgsl(
      fragment(`class C { hits = 0; }`, 'const c = new C(); c.hits = c.hits + 1.;', 'c.hits'),
    );
    expect(structBody(f32Text, 'C')).toEqual(['hits: f32,']);
    const u32Text = wgsl(
      fragment(`class C { hits = 0; }`, 'const c = new C(); const n: u32 = c.hits;', '1.'),
    );
    expect(structBody(u32Text, 'C')).toEqual(['hits: u32,']);
  });
});

describe('readonly, private and protected members', () => {
  const readonlyLine = (owner: string): string =>
    `typeshade TS8005: Cannot assign to "this.x" — "x" is readonly, so only the constructor of "${owner}" may assign it.`;

  it('only the constructor of the declaring class may assign a readonly field', () => {
    const halves = bothHalves(
      fragment(
        `class A { readonly x: f32; constructor() { this.x = 1.; } set(): void { this.x = 2.; } }`,
        'const a = new A(); a.set();',
        'a.x',
      ),
    );
    expect(halves.compiler).toEqual([readonlyLine('A')]);
    expect(halves.editor).toContain(readonlyLine('A'));
  });

  it('the constructor of a derived class may not assign the readonly field of its base', () => {
    const halves = bothHalves(
      fragment(
        `class A { readonly x: f32 = 1.; }
class D extends A { constructor() { super(); this.x = 2.; } }`,
        'const a = new D();',
        'a.x',
      ),
    );
    expect(halves.compiler).toEqual([readonlyLine('A')]);
    expect(halves.editor).toContain(readonlyLine('A'));
  });

  it('a private name is refused outside the class body that declares it', () => {
    const line =
      'typeshade TS8035: "#x" is private to "A", and this code is outside its class body. Reach it through a member "A" declares without the "#".';
    const halves = bothHalves(
      fragment(
        `class A { #x: f32 = 1.; }
class B { get(a: A): f32 { return a.#x; } y: f32 = 1.; }`,
        'const b = new B();',
        'b.get(new A())',
      ),
    );
    expect(halves.compiler).toEqual([line]);
    expect(halves.editor).toContain(line);
  });

  it('a derived struct finds the private name of its base inside the base body', () => {
    const text = wgsl(
      fragment(
        `class A { #n: f32 = 1.; get(): f32 { return this.#n; } }
class B extends A { }`,
        'const b = new B();',
        'b.get()',
      ),
    );
    expect(structBody(text, 'B')).toEqual(['n: f32,']);
  });

  it('a private field is refused outside its class, and a public member reaches it', () => {
    const line =
      'typeshade TS8035: "A.p" is private, so only the body of "A" may name it. Reach it through a public member of "A".';
    const halves = bothHalves(
      fragment(
        `class A { private p: f32 = 1.; }
class B extends A { get(): f32 { return this.p; } }`,
        'const b = new B();',
        'b.get()',
      ),
    );
    expect(halves.compiler).toEqual([line]);
    expect(halves.editor).toContain(line);
  });

  it('a field redeclared public over a protected one is public', () => {
    const halves = bothHalves(
      fragment(
        `class A { protected limit: f32 = 1.; }
class B extends A { limit: f32 = 5.; }`,
        'const b = new B();',
        'b.limit',
      ),
    );
    expect(halves.compiler).toEqual([]);
    expect(halves.editor).toEqual([]);
  });
});

describe('a field that holds a function is a method', () => {
  it('an arrow function field reads its own parameters, in both halves', () => {
    const halves = bothTake(
      fragment(`class A { f = (p: f32) => p * 2.; }`, 'const a = new A();', 'a.f(3.)'),
    );
    expect(compileModule(halves.result.module).fns['fs']!()).toEqual([6, 0, 0, 1]);
  });

  it('an arrow function field whose body assigns runs it as a statement', () => {
    const text = wgsl(
      fragment(
        `class A { v: f32 = 0.; bump = () => this.v++; }`,
        'const a = new A(); a.bump();',
        'a.v',
      ),
    );
    expect(text).toContain('fn A_bump(self_: ptr<function, A>) {');
    expect(text).toContain('(*self_).v += 1.0;');
  });

  it('a function expression with a this parameter does not take it as a parameter', () => {
    const halves = bothTake(
      fragment(
        `class A { f = function (this: A, p: f32) { return p; }; }`,
        'const a = new A();',
        'a.f(5.)',
      ),
    );
    expect(compileModule(halves.result.module).fns['fs']!()).toEqual([5, 0, 0, 1]);
  });
});
