// `new` on a class the file declares (#86, and the DX note on it). A shader has no heap, and
// for a while the diagnostic said so first: "`new` allocates a JS object. Use struct types and
// vec constructors, or a class the file declares." A reader met that on the first `new` they
// wrote and concluded `new` was out, which it is not. This file pins the opposite: every
// ordinary `new` on a declared class compiles, and each thing that is refused says its own
// reason rather than blaming the allocation.

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileTsSource } from './source-file.js';
import { compileTsSources } from './module.js';
import { TS_CODES } from './codes.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`);

const file = (head: string, body: string) => `"use typeshade"
${head}@fragment
export function fs(): vec4 {
${body}
}
`;
const agree = (r: ReturnType<typeof compile>, expected: number[]): void => {
  for (const make of [compileModule, compileModuleJs]) {
    expect(make(r.module).fns['fs']!(), make.name).toEqual(expected);
  }
};

describe('a class the file declares is built with new', () => {
  it('with a constructor, and without one', () => {
    const withCtor = compile(
      file(
        `class P {
  x: f32
  y: f32
  constructor(x: f32, y: f32) {
    this.x = x
    this.y = y
  }
}
`,
        `  const p = new P(1., 2.)\n  return vec4(p.x, p.y, 0., 1.)`,
      ),
    );
    expect(withCtor.diagnostics).toEqual([]);
    expect(withCtor.wgsl).toContain('let p = P_new(1.0, 2.0);');
    agree(withCtor, [1, 2, 0, 1]);
    // No constructor: TypeScript's implicit one, which takes nothing and zeroes the fields.
    const without = compile(
      file(
        `class P {\n  x: f32\n  y: f32\n}\n`,
        `  const p = new P()\n  return vec4(p.x, p.y, 0., 1.)`,
      ),
    );
    expect(without.diagnostics).toEqual([]);
    agree(without, [0, 0, 0, 1]);
  });

  it('with field initializers, in a method, as an argument, and on a derived class', () => {
    const inits = compile(
      file(
        `class P {\n  x: f32 = 3.\n  y: f32 = 4.\n}\n`,
        `  const p = new P()\n  return vec4(p.x, p.y, 0., 1.)`,
      ),
    );
    expect(inits.diagnostics).toEqual([]);
    agree(inits, [3, 4, 0, 1]);
    const inMethod = compile(
      file(
        `class V {
  x: f32
  constructor(x: f32) {
    this.x = x
  }
  scaled(k: f32): V {
    return new V(this.x * k)
  }
}
function take(v: V): f32 {
  return v.x
}
`,
        `  const v = new V(2.)\n  return vec4(v.scaled(3.).x, take(new V(5.)), 0., 1.)`,
      ),
    );
    expect(inMethod.diagnostics).toEqual([]);
    expect(inMethod.wgsl).toContain('return V_new((self_.x * k));');
    expect(inMethod.wgsl).toContain('take(V_new(5.0))');
    agree(inMethod, [6, 5, 0, 1]);
    const derived = compile(
      file(
        `class B {\n  x: f32 = 1.\n}\nclass D extends B {\n  y: f32 = 2.\n}\n`,
        `  const d = new D()\n  return vec4(d.x, d.y, 0., 1.)`,
      ),
    );
    expect(derived.diagnostics).toEqual([]);
    agree(derived, [1, 2, 0, 1]);
  });
});

describe('what a new is refused on says its own reason', () => {
  const TAIL = `\n@fragment\nexport function fs(): vec4 {\n  return vec4(1.)\n}\n`;

  /** One body that builds something with `new` and returns without reading it. */
  const built = (head: string, target: string) =>
    `"use typeshade"\n${head}function g(): f32 {\n  const d = ${target}\n  return 1.\n}${TAIL}`;

  it('a name nothing declares is an unknown name, said once (Rule 2.1)', () => {
    // It was TS8013 "…is not one of them. "new" on anything else allocates a JS object, which a
    // shader has no heap for." and, for a name on the host list, TS8012 as well. `new P(1., 2.)`
    // on the file's own class is `P_new(1.0, 2.0)` and allocates nothing either.
    for (const [target, name] of [
      ['new Date()', 'Date'],
      ['new Map()', 'Map'],
      ['new Float32Array(4)', 'Float32Array'],
      ['new Intl.NumberFormat()', 'Intl'],
    ]) {
      expect(errorsOf(built('', target!)), target).toEqual([
        `${TS_CODES.UNKNOWN_NAME} Unknown identifier "${name}".`,
      ]);
    }
    // A namespace's class is reached through the namespace outside it, as TypeScript reads it.
    expect(
      errorsOf(built('namespace N {\n  export class P {\n    x: f32 = 1.\n  }\n}\n', 'new P()')),
    ).toEqual([`${TS_CODES.UNKNOWN_NAME} Unknown identifier "P".`]);
    expect(
      errorsOf(built('namespace N {\n  export class P {\n    x: f32 = 1.\n  }\n}\n', 'new N.Q()')),
    ).toEqual([`${TS_CODES.UNKNOWN_NAME} "N" has no member "Q".`]);
  });

  it('what a target that is no class is, with what to write (Rule 8.13)', () => {
    const one = (head: string, target: string, message: string) =>
      expect(errorsOf(built(head, target)), target).toEqual([
        `${TS_CODES.CLASS_MEMBER} ${message}`,
      ]);
    one(
      '',
      'new vec3f(1., 2., 3.)',
      '"vec3f" is a WGSL constructor, which is called without "new": vec3f(1., 2., 3.).',
    );
    one('', 'new f32(1)', '"f32" is a WGSL constructor, which is called without "new": f32(1).');
    one(
      '',
      'new mat2x2(1., 0., 0., 1.)',
      '"mat2x2" is a WGSL constructor, which is called without "new": mat2x2(1., 0., 0., 1.).',
    );
    one('', 'new sin(1.)', '"sin" is a function, which is called without "new": sin(1.).');
    one(
      'function F(): f32 {\n  return 1.\n}\n',
      'new F()',
      '"F" is a function, which is called without "new": F().',
    );
    one(
      'enum E {\n  A = 1,\n  B,\n}\n',
      'new E()',
      '"E" is an enum, whose values are its members: E.A.',
    );
    one(
      'namespace N {\n  export const k: f32 = 1.\n}\n',
      'new N()',
      '"N" is a namespace, not a class.',
    );
    one('const K: f32 = 2.\n', 'new K()', '"K" is a value, not a class.');
  });

  it('each remedy it names compiles', () => {
    // The spelling each sentence offers, written in its place (Rule 12.1).
    for (const [head, target] of [
      ['', 'vec3f(1., 2., 3.)'],
      ['', 'f32(1)'],
      ['', 'mat2x2(1., 0., 0., 1.)'],
      ['function F(): f32 {\n  return 1.\n}\n', 'F()'],
      ['enum E {\n  A = 1,\n  B,\n}\n', 'E.A'],
    ]) {
      expect(errorsOf(built(head!, target!)), target).toEqual([]);
    }
  });

  it('a local, a parameter and a type parameter are no class either', () => {
    expect(
      errorsOf(
        `"use typeshade"\nclass C {\n  a: f32 = 1.\n}\nfunction g(c: C): f32 {\n  const d = new c()\n  return 1.\n}${TAIL}`,
      ),
    ).toEqual([`${TS_CODES.CLASS_MEMBER} "c" is a value, not a class.`]);
    expect(
      errorsOf(
        `"use typeshade"\nclass B {\n  a: f32 = 1.\n}\nfunction mk<T>(x: T): f32 {\n  const v = new T()\n  return 1.\n}\nfunction g(): f32 {\n  return mk(new B())\n}${TAIL}`,
      ),
    ).toEqual([`${TS_CODES.CLASS_MEMBER} "T" is a type parameter, not a class.`]);
  });

  it('an interface or a type alias, which carry no constructor', () => {
    const message = (name: string) =>
      `${TS_CODES.CLASS_MEMBER} "${name}" is a type, not a value: an interface and a type alias declare a shape and carry no constructor. Write the object literal, { field: value }, or declare "${name}" as a class to give it one.`;
    expect(
      errorsOf(
        file(`interface P {\n  x: f32\n}\n`, `  const p = new P()\n  return vec4(p.x, 0., 0., 1.)`),
      )[0],
    ).toBe(message('P'));
    expect(
      errorsOf(
        file(`type Q = {\n  x: f32\n}\n`, `  const q = new Q()\n  return vec4(q.x, 0., 0., 1.)`),
      )[0],
    ).toBe(message('Q'));
  });

  it('an abstract class, once and not twice', () => {
    expect(
      errorsOf(
        file(
          `abstract class S {
  k: f32
  abstract area(): f32
}
class Q extends S {
  s: f32
  area(): f32 {
    return this.s
  }
}
`,
          `  const q = new S()\n  return vec4(q.k, 0., 0., 1.)`,
        ),
      )[0],
    ).toBe(
      `${TS_CODES.CLASS_MEMBER} "S" is abstract, so there is no instance of it to build. Construct a class that extends it.`,
    );
  });

  it('a class of statics alone, which emits no struct to build', () => {
    // Before this it emitted `fn U_new() -> U` with no `struct U` anywhere, which Tint refuses,
    // and reported nothing at all.
    expect(
      errorsOf(
        file(
          `class U {\n  static half(x: f32): f32 {\n    return x * 0.5\n  }\n}\n`,
          `  const u = new U()\n  return vec4(U.half(2.), 0., 0., 1.)`,
        ),
      )[0],
    ).toBe(
      `${TS_CODES.CLASS_MEMBER} "U" declares only static members, so it is a group of functions and there is no value of it to build. Call "U.f(...)" directly.`,
    );
  });

  it('arguments to a class that declares no constructor, naming both ways to write it', () => {
    expect(
      errorsOf(
        file(
          `class P {\n  x: f32\n  y: f32\n}\n`,
          `  const p = new P(1., 2.)\n  return vec4(p.x, p.y, 0., 1.)`,
        ),
      )[0],
    ).toBe(
      `${TS_CODES.ARITY_MISMATCH} "P" declares no constructor, so "new P()" takes no arguments, as it does in TypeScript. Declare a constructor to pass values, or write the fields: { x: ..., y: ... }.`,
    );
  });
});

describe('a namespace class and a parenthesized class are built as a top-level one is', () => {
  // Measured on main: `new N.P()` on a class with no written constructor was TS8035 '"N_P" has
  // no constructor here' (the constructor was registered under `P`, never `N_P`), and
  // `new (C)()` was refused as '"(C)" is not one of them' although TypeScript takes it.
  it('new N.P(), and a bare new P() inside the namespace', () => {
    const r = compile(
      file(
        `namespace N {
  export class P {
    x: f32 = 2.
  }
  export function mk(): f32 {
    const p = new P()
    return p.x
  }
}
class C {
  a: f32 = 3.
}
`,
        `  const p = new N.P()\n  const c = new (C)()\n  return vec4(p.x, N.mk(), c.a, 1.)`,
      ),
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn N_P_new() -> N_P {');
    agree(r, [2, 2, 3, 1]);
  });

  it('a bare new P() in another block of the same namespace, which TypeScript merges', () => {
    const r = compile(
      file(
        `namespace N {
  export class P {
    x: f32 = 5.
  }
}
namespace N {
  export function mk(): f32 {
    const p = new P()
    return p.x
  }
}
`,
        `  return vec4(N.mk())`,
      ),
    );
    expect(r.diagnostics).toEqual([]);
    agree(r, [5, 5, 5, 5]);
  });

  it('names the class as written, N.P, in what it refuses', () => {
    const ns = (members: string, body: string) =>
      errorsOf(file(`namespace N {\n${members}}\n`, body));
    expect(
      ns(
        `  export class P {\n    x: f32 = 1.\n  }\n`,
        `  const p = new N.P(2.)\n  return vec4(1.)`,
      ),
    ).toEqual([
      `${TS_CODES.ARITY_MISMATCH} "N.P" declares no constructor, so "new N.P()" takes no arguments, as it does in TypeScript. Declare a constructor to pass values, or write the fields: { x: ... }.`,
    ]);
    expect(
      ns(
        `  export class P {\n    x: f32\n    constructor(a: f32) {\n      this.x = a\n    }\n  }\n`,
        `  const p = new N.P()\n  return vec4(1.)`,
      ),
    ).toEqual([`${TS_CODES.ARITY_MISMATCH} "new N.P" expects 1 argument(s), got 0.`]);
    expect(
      ns(
        `  export class U {\n    static f(): f32 {\n      return 1.\n    }\n  }\n`,
        `  const u = new N.U()\n  return vec4(1.)`,
      ),
    ).toEqual([
      `${TS_CODES.CLASS_MEMBER} "N.U" declares only static members, so it is a group of functions and there is no value of it to build. Call "N.U.f(...)" directly.`,
    ]);
  });

  it('a constructor refused where it is written is not refused again at the new', () => {
    // Each was the declaration's sentence and then TS8035 '"C" has no constructor here', a
    // second diagnostic about one mistake (Rule 12.4).
    expect(
      errorsOf(
        file(
          `class C {\n  x: f32\n  constructor(...a: f32[]) {\n    this.x = 1.\n  }\n}\n`,
          `  const c = new C()\n  return vec4(1.)`,
        ),
      ),
    ).toEqual([`${TS_CODES.FUNCTION_SHAPE} Rest parameter "a" is not supported.`]);
    for (const ctor of ['constructor(a: f32) {\n    this.x = a\n  }\n', '']) {
      expect(
        errorsOf(
          file(
            `class P {\n  x: f32 = 1.\n  ${ctor}}\nfunction P_new(a: f32): f32 {\n  return a\n}\n`,
            `  const c = new P(${ctor === '' ? '' : '1.'})\n  return vec4(P_new(1.))`,
          ),
        ),
      ).toEqual([
        `${TS_CODES.DUPLICATE_SYMBOL} "P_new" is both the function "P_new" and the emitted name of "new P"; rename one of them.`,
      ]);
    }
  });
});

describe('a value built at module scope is refused once, by its own declaration', () => {
  // Measured on main: TS8004 'Unknown function "g()". Declare it in this file, …' about a function
  // the file declares, or TS8035 '"P" has no constructor here' about a class that has one, and
  // then TS8022 at every read of K. Tint refuses the WGSL too: "user-declared functions cannot be
  // called at module-scope".
  const head = `function g(): f32 {\n  return 1.\n}\nclass P {\n  a: f32\n  constructor(a: f32) {\n    this.a = a\n  }\n}\n`;
  const constant = (name: string, call: string, what: string) =>
    `${TS_CODES.TYPE_MISMATCH} Module const "${name}" must be constant, and "${call}" ${what} this file declares. A module constant is folded before any function exists, so build the value inside the function that reads it.`;

  it('a module const that calls a function or builds a class', () => {
    expect(errorsOf(file(`${head}const K: f32 = g()\n`, `  return vec4(K)`))).toEqual([
      constant('K', 'g()', 'calls a function'),
    ]);
    expect(errorsOf(file(`${head}const K = new P(2.)\n`, `  return vec4(K.a)`))).toEqual([
      constant('K', 'new P(2.)', 'builds a class'),
    ]);
    // A constant built from the refused one is refused with it, and says nothing more.
    expect(
      errorsOf(file(`${head}const K: f32 = g()\nconst J: f32 = K * 2.\n`, `  return vec4(J)`)),
    ).toEqual([constant('K', 'g()', 'calls a function')]);
  });

  it('a static field, a module let and an enum member each say it in their own words', () => {
    expect(
      errorsOf(file(`${head}class S {\n  static K: f32 = g()\n}\n`, `  return vec4(S.K)`)),
    ).toEqual([
      `${TS_CODES.TYPE_MISMATCH} Static field "S.K" must be constant, and "g()" calls a function this file declares. A static field no code writes is a module constant, folded before any function exists, so build the value inside the function that reads it.`,
    ]);
    expect(errorsOf(file(`${head}let K = new P(2.)\n`, `  return vec4(K.a)`))).toEqual([
      `${TS_CODES.MODULE_VAR} "K" needs a constant initializer (a literal, a module const, arithmetic or a math builtin over those); "new P(2.)" is not one. Assign it inside the entry.`,
    ]);
    expect(
      errorsOf(
        file(
          `function h(): i32 {\n  return 1\n}\nenum E {\n  A = h(),\n}\n`,
          `  return vec4(f32(E.A))`,
        ),
      ),
    ).toEqual([
      `${TS_CODES.TYPE_MISMATCH} Enum member "E.A" needs a value this can compute: a whole number, or arithmetic over numbers and members declared before it.`,
    ]);
  });

  it('built inside the function, the same value compiles', () => {
    const r = compile(file(head, `  const K = new P(g() * 2.)\n  return vec4(K.a)`));
    expect(r.diagnostics).toEqual([]);
    agree(r, [2, 2, 2, 2]);
  });
});

describe('each thing a new is refused on is named for what it is (Rule 8.13, Rule 12.1)', () => {
  const TAIL = `\n@fragment\nexport function fs(): vec4 {\n  return vec4(1.)\n}\n`;
  const built = (head: string, target: string) =>
    `"use typeshade"\n${head}function g(): f32 {\n  const d = ${target}\n  return 1.\n}${TAIL}`;
  const one = (
    head: string,
    target: string,
    message: string,
    code: string = TS_CODES.CLASS_MEMBER,
  ) => expect(errorsOf(built(head, target)), target).toEqual([`${code} ${message}`]);

  it('a WGSL type with no constructor is a type, not a value', () => {
    // Each was TS8022 'Unknown identifier "sampler"', although the file can write the type; the
    // editor says TS2693, "only refers to a type".
    for (const [target, name] of [
      ['new sampler()', 'sampler'],
      ['new texture_2d<f32>()', 'texture_2d'],
      ['new atomic<i32>()', 'atomic'],
    ]) {
      one('', target!, `"${name}" is a type, not a value, and WGSL gives it no constructor.`);
    }
  });

  it('a name the ambient library gives is what it is: a constant, a function, a member', () => {
    one('', 'new PI()', '"PI" is a value, not a class.');
    one('', 'new Math.PI()', '"Math.PI" is a value, not a class.');
    one(
      '',
      'new Math.sin(1.)',
      '"Math.sin" is a function, which is called without "new": Math.sin(1.).',
    );
    one(
      '',
      'new console.log(1.)',
      '"console.log" is a function, which is called without "new": console.log(1.).',
    );
    one('', 'new Math.Foo()', '"Math" has no member "Foo".', TS_CODES.UNKNOWN_NAME);
    one('', 'new console.foo()', '"console" has no member "foo".', TS_CODES.UNKNOWN_NAME);
    // The remedies compile: `Math.sin(1.)` where the `new` stood, and `console.log(1.)`, which
    // returns nothing, on its own line.
    expect(errorsOf(built('', 'Math.sin(1.)'))).toEqual([]);
    expect(errorsOf(file('', '  console.log(1.)\n  return vec4(1.)'))).toEqual([]);
  });

  it('a member of an enum or a class, and a target that is no name', () => {
    const head =
      `enum E {\n  A = 1,\n}\nenum Z {}\nclass C {\n  a: f32 = 1.\n  static k: f32 = 2.\n` +
      `  static make(): C {\n    return new C()\n  }\n}\n`;
    one(head, 'new E.A()', '"E.A" is a value, not a class.');
    one(head, 'new E.B()', '"E" has no member "B".', TS_CODES.UNKNOWN_NAME);
    one(head, 'new Z()', '"Z" is an enum, whose values are its members.');
    one(head, 'new C.k()', '"C.k" is a value, not a class.');
    one(head, 'new C.make()', '"C.make" is a function, which is called without "new": C.make().');
    one(head, 'new C.q()', '"C" has no static member "q".', TS_CODES.UNKNOWN_NAME);
    one(
      `namespace N {\n  export class Q {\n    x: f32 = 1.\n  }\n}\n`,
      'new N.Q.x()',
      '"N.Q" has no static member "x".',
      TS_CODES.UNKNOWN_NAME,
    );
    one(
      `class B {\n  a: f32 = 1.\n}\nclass D {\n  a: f32 = 2.\n}\nconst k = true\n`,
      'new (k ? B : D)()',
      'A class this file declares is built with "new", and "k ? B : D" is not one of them.',
    );
  });

  it('a mixin applied and named is built through a class that extends it, which compiles', () => {
    const head =
      `class B {\n  a: f32 = 1.\n}\nfunction Tinted<TBase extends AnyClass>(Base: TBase) {\n` +
      `  return class extends Base {\n    t: f32 = 2.\n  }\n}\nconst M = Tinted(B)\n`;
    one(
      head,
      'new M()',
      '"M" is a mixin applied to a class, and is built through a class that extends it: class C extends M {}, then new C().',
    );
    const r = compile(
      file(`${head}class C extends M {}\n`, `  const c = new C()\n  return vec4(c.a, c.t, 0., 1.)`),
    );
    expect(r.diagnostics).toEqual([]);
    agree(r, [1, 2, 0, 1]);
  });

  it('new this() in a static member of an abstract class, which builds no instance of it', () => {
    expect(
      errorsOf(
        file(
          `abstract class S {\n  a: f32 = 1.\n  static make(): f32 {\n    const s = new this()\n    return 1.\n  }\n}\n`,
          `  return vec4(S.make())`,
        ),
      ),
    ).toEqual([
      `${TS_CODES.CLASS_MEMBER} "S" is abstract, so there is no instance of it to build. Construct a class that extends it.`,
    ]);
  });

  it('once, in a generic body lowered for two type arguments and in one no call lowers', () => {
    // Each was said once per instance, the same sentence at the same span, and not at all in a
    // body no call reached (Rule 12.4).
    const generic = (calls: string) =>
      `"use typeshade"\nfunction mk<T>(x: T): f32 {\n  const d = new vec3f(1.)\n  const e = new Date()\n  return 1.\n}\n` +
      `@fragment\nexport function fs(): vec4 {\n  return vec4(${calls})\n}\n`;
    const said = [
      `${TS_CODES.CLASS_MEMBER} "vec3f" is a WGSL constructor, which is called without "new": vec3f(1.).`,
      `${TS_CODES.UNKNOWN_NAME} Unknown identifier "Date".`,
    ];
    expect(errorsOf(generic('mk(1.) + mk(vec2f(1.)) + mk(2)'))).toEqual(said);
    expect(errorsOf(generic('1.'))).toEqual(said);
  });

  it('names a namespace class as written in a copied constructor and in a generic one', () => {
    // Both named the emitted struct: '"new N_P" takes a function for "g"' and
    // '(N_P_f32, N_P_i32)'.
    expect(
      errorsOf(
        file(
          `namespace N {\n  export class P {\n    x: f32\n    constructor(g: (a: f32) => f32) {\n      this.x = g(1.)\n    }\n  }\n}\n`,
          `  const p = new N.P()\n  return vec4(1.)`,
        ),
      )[0],
    ).toBe(
      `${TS_CODES.ARITY_MISMATCH} "new N.P" takes a function for "g", "(a: f32) => f32": hand one over by its name, or write it here as an arrow function.`,
    );
    expect(
      errorsOf(
        file(
          `namespace N {\n  export class P<T> {\n    v: T\n    constructor(v: T) {\n      this.v = v\n    }\n  }\n}\n`,
          `  const a = new N.P<f32>(1.)\n  const b = new N.P<i32>(1)\n  const c = new N.P(2.)\n  return vec4(a.v)`,
        ),
      ),
    ).toEqual([
      `${TS_CODES.CLASS_MEMBER} "N.P" is generic and this file writes it at 2 sets of type arguments (N.P<f32>, N.P<i32>), so "new N.P(…)" does not say which one to build. Write the type argument: "new N.P<f32>(…)".`,
    ]);
  });
});

describe('a short name inside a namespace is the namespace’s, for a new and a type alike', () => {
  // TypeScript resolves `P` inside `namespace N` to `N.P`, ahead of a top-level `P`, in a `new`
  // and in a type annotation, and across the blocks of a merged namespace. Measured before this:
  // the `new` built the top-level `P` (7) while the one below builds `N.P` (1); an annotation `P`
  // there meant the top-level one, so `const p: P = new P()` was refused as a type mismatch;
  // and a second block of `N` built the top-level `P` with no diagnostic at all.
  const TOP = `class P {\n  a: f32 = 7.\n}\n`;
  const values = (src: string, expected: number[]) => {
    const r = compile(src);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('N_P_new()');
    agree(r, expected);
  };

  it('a bare new P(), a const p: P, a parameter p: P and a return type P', () => {
    values(
      file(
        `${TOP}namespace N {\n  export class P {\n    a: f32 = 1.\n  }\n  export function f(): f32 {\n    const p = new P()\n    return p.a\n  }\n}\n`,
        `  return vec4(N.f())`,
      ),
      [1, 1, 1, 1],
    );
    values(
      file(
        `${TOP}namespace N {\n  export class P {\n    a: f32 = 1.\n  }\n  export function f(): f32 {\n    const p: P = new P()\n    return p.a\n  }\n}\n`,
        `  return vec4(N.f())`,
      ),
      [1, 1, 1, 1],
    );
    values(
      file(
        `${TOP}namespace N {\n  export class P {\n    a: f32 = 1.\n  }\n  export function f(p: P): f32 {\n    return p.a\n  }\n  export function g(): f32 {\n    return f(new P())\n  }\n}\n`,
        `  return vec4(N.g())`,
      ),
      [1, 1, 1, 1],
    );
    values(
      file(
        `${TOP}namespace N {\n  export class P {\n    a: f32 = 1.\n  }\n  export function mk(): P {\n    return new P()\n  }\n}\n`,
        `  return vec4(N.mk().a + new P().a)`,
      ),
      [8, 8, 8, 8],
    );
  });

  it('in another block of the namespace, ahead of a top-level class of the name', () => {
    values(
      file(
        `${TOP}namespace N {\n  export class P {\n    a: f32 = 1.\n  }\n}\nnamespace N {\n  export function mk(): P {\n    return new P()\n  }\n}\n`,
        `  return vec4(N.mk().a)`,
      ),
      [1, 1, 1, 1],
    );
  });

  it('a field initializer that builds a sibling class of the namespace', () => {
    // The initializer was dropped: `N_B_new` assigned nothing to `a`, and `new N.B().a.x` read 0.
    const r = compile(
      file(
        `namespace N {\n  export class A {\n    x: f32 = 1.\n  }\n  export class B {\n    a: A = new A()\n  }\n}\n`,
        `  return vec4(new N.B().a.x)`,
      ),
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('self_.a = N_A_new();');
    agree(r, [1, 1, 1, 1]);
  });
});

describe('a new with no constructor to call is never dropped without a word', () => {
  // A multi-file program lowers no class function, so a class with a written constructor has no
  // `P_new`. Before this the `new` lowered to nothing and said nothing: `c.x = new P(2.).a` was
  // gone from the WGSL, and a function returning one failed in the backend.
  const LIB = `"use typeshade";\nclass P {\n  a: f32;\n  constructor(a: f32) {\n    this.a = a;\n  }\n}\n`;
  const sentence = `${TS_CODES.CLASS_MEMBER} "P" has no constructor here; build it as an object literal, { field: value }.`;

  it('in a statement and in a return', () => {
    for (const body of [
      `@fragment\nexport function fs(): vec4 {\n  let c = vec4(0.);\n  c.x = new P(2.).a;\n  return c;\n}\n`,
      `export function mk(): P {\n  return new P(1.);\n}\n`,
    ]) {
      const r = compileTsSources([{ fileName: 'lib.ts', source: LIB + body }]);
      expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([sentence]);
      expect(r.wgsl).toBeUndefined();
    }
  });
});

describe('a module-scope value, and every read and write of it, says one sentence', () => {
  const head = `function g(): f32 {\n  return 1.\n}\n`;
  const fs = (body: string) => `@fragment\nexport function fs(): vec4 {\n${body}\n}\n`;
  const notConstant = (name: string, init: string) =>
    `${TS_CODES.MODULE_VAR} "${name}" needs a constant initializer (a literal, a module const, arithmetic or a math builtin over those); "${init}" is not one. Assign it inside the entry.`;

  it('a static initializer that calls through this', () => {
    // It was '"S" has no static function "f"' and '"S" has no static field "K"', both untrue.
    expect(
      errorsOf(
        `"use typeshade"\nclass S {\n  a: f32 = 0.\n  static f(): f32 {\n    return 2.\n  }\n  static K: f32 = this.f()\n}\n${fs('  return vec4(S.K)')}`,
      ),
    ).toEqual([
      `${TS_CODES.TYPE_MISMATCH} Static field "S.K" must be constant, and "this.f()" calls a function this file declares. A static field no code writes is a module constant, folded before any function exists, so build the value inside the function that reads it.`,
    ]);
  });

  it('a write to a refused module let or written static', () => {
    // Each write was TS8022 'Cannot assign to unknown name "K"', or "S", which the file declares.
    expect(
      errorsOf(
        `"use typeshade"\n${head}let K: f32 = g()\n${fs('  K = 2.\n  K += 1.\n  K++\n  return vec4(K)')}`,
      ),
    ).toEqual([notConstant('K', 'g()')]);
    expect(
      errorsOf(
        `"use typeshade"\n${head}class S {\n  a: f32 = 0.\n  static K: f32 = g()\n  static bump(): void {\n    S.K += 1.\n  }\n}\n${fs('  S.K = 2.\n  S.bump()\n  return vec4(S.K)')}`,
      ),
    ).toEqual([notConstant('S.K', 'g()')]);
  });

  it('a module let built from a refused constant or a refused let', () => {
    // Each was the declaration's sentence, then TS8022 at the let's initializer and at its use.
    expect(
      errorsOf(
        `"use typeshade"\n${head}const K: f32 = g()\nlet L: f32 = K\n${fs('  return vec4(L)')}`,
      ),
    ).toEqual([
      `${TS_CODES.TYPE_MISMATCH} Module const "K" must be constant, and "g()" calls a function this file declares. A module constant is folded before any function exists, so build the value inside the function that reads it.`,
    ]);
    expect(
      errorsOf(
        `"use typeshade"\n${head}let K: f32 = g()\nlet L: f32 = K\n${fs('  return vec4(L)')}`,
      ),
    ).toEqual([notConstant('K', 'g()')]);
  });

  it('a static field that is not constant is named as written, and a read adds nothing', () => {
    // Both named the emitted `S_K`, and a read added '"S" has no static field "K"'.
    expect(
      errorsOf(
        `"use typeshade"\nclass S {\n  static K: f32 = dpdx(1.)\n}\n${fs('  return vec4(S.K)')}`,
      ),
    ).toEqual([
      `${TS_CODES.TYPE_MISMATCH} Static field "S.K" must be constant: a literal, a whole earlier module const, a constructor over those, or arithmetic over those with a non-zero divisor. It may call a math builtin over those, but not a declared function or a derivative, and it cannot read a resource or take a component, field or element.`,
    ]);
    expect(
      errorsOf(
        `"use typeshade"\nclass S {\n  static K: f32 = dpdx(1.)\n}\n${fs('  S.K = 2.\n  return vec4(S.K)')}`,
      ),
    ).toEqual([notConstant('S.K', 'dpdx(1.)')]);
  });

  it('a module const that calls a function another file declares', () => {
    const r = compileTsSources(
      [
        {
          fileName: 'lib.ts',
          source: `"use typeshade";\nexport function g(): f32 {\n  return 1.;\n}\n`,
        },
        {
          fileName: 'main.ts',
          source: `"use typeshade";\nimport { g } from "./lib";\nconst K: f32 = g();\n@fragment\nexport function fs(): vec4 {\n  return vec4(K);\n}\n`,
        },
      ],
      'main.ts',
    );
    expect(r.diagnostics.map((d) => `${d.fileName} ${d.code} ${d.message}`)).toEqual([
      `main.ts ${TS_CODES.TYPE_MISMATCH} Module const "K" must be constant, and "g()" calls a function this file imports. A module constant is folded before any function exists, so build the value inside the function that reads it.`,
    ]);
  });
});

describe('a new finds what TypeScript finds, and names it as the file writes it', () => {
  const said = (src: string) => errorsOf(src);

  it('a class another block of the namespace does not export is not its short name there', () => {
    // TypeScript merges what a block exports. The first block's `P` is not exported, so in the
    // second block `P` is the top-level class (7), in the `new` and in the annotation alike;
    // the second block built `N_P` (1), and a parameter `p: P` there refused the top-level `P`
    // handed to it as a type mismatch.
    const head =
      `class P {\n  a: f32 = 7.\n}\nnamespace N {\n  class P {\n    a: f32 = 1.\n  }\n` +
      `  export function g(): f32 {\n    return new P().a\n  }\n}\n`;
    const r = compile(
      file(
        `${head}namespace N {\n  export function f(): f32 {\n    const p: P = new P()\n    return p.a\n  }\n}\n`,
        `  return vec4(N.f() + N.g() * 10.)`,
      ),
    );
    expect(r.diagnostics).toEqual([]);
    agree(r, [17, 17, 17, 17]);
    const passed = compile(
      file(
        `${head}namespace N {\n  export function f(p: P): f32 {\n    return p.a\n  }\n}\n`,
        `  return vec4(N.f(new P()))`,
      ),
    );
    expect(passed.diagnostics).toEqual([]);
    agree(passed, [7, 7, 7, 7]);
    // With nothing else of the name, it is unknown there, as the editor says (TS2304); exported,
    // it is the namespace's.
    const other = (exported: string) =>
      file(
        `namespace N {\n  ${exported}class P {\n    a: f32 = 1.\n  }\n}\nnamespace N {\n  export function f(): f32 {\n    return new P().a\n  }\n}\n`,
        `  return vec4(N.f())`,
      );
    expect(said(other(''))).toEqual([`${TS_CODES.UNKNOWN_NAME} Unknown identifier "P".`]);
    const exported = compile(other('export '));
    expect(exported.diagnostics).toEqual([]);
    agree(exported, [1, 1, 1, 1]);
  });

  it('a generic instance by the type arguments the file writes, never by its emitted name', () => {
    // They were `Pair<N_Q>`, `Pair<Box_f32>` and `new Pair<Box_f32>`, the structs the module
    // emits.
    const box = `class Box<T> {\n  v: T\n  constructor(v: T) {\n    this.v = v\n  }\n}\n`;
    const pair = `class Pair<T> {\n  a: T\n  constructor(a: T) {\n    this.a = a\n  }\n}\n`;
    const ambiguous = (instances: string) =>
      `${TS_CODES.CLASS_MEMBER} "Pair" is generic and this file writes it at 2 sets of type arguments (${instances}), so "new Pair(…)" does not say which one to build. Write the type argument: "new Pair<f32>(…)".`;
    expect(
      said(
        file(
          `${pair}namespace N {\n  export class Q {\n    x: f32 = 1.\n  }\n}\n`,
          `  const p = new Pair<N.Q>(new N.Q())\n  const q = new Pair<f32>(1.)\n  const r = new Pair(2.)\n  return vec4(q.a)`,
        ),
      ),
    ).toEqual([ambiguous('Pair<N.Q>, Pair<f32>')]);
    expect(
      said(
        file(
          `${box}${pair}`,
          `  const p = new Pair<Box<f32>>(new Box<f32>(1.))\n  const q = new Pair<vec3f>(vec3f(1.))\n  const r = new Pair(2.)\n  return vec4(1.)`,
        ),
      ),
    ).toEqual([ambiguous('Pair<Box<f32>>, Pair<vec3f>')]);
    expect(
      said(
        file(
          `${box}class Pair<T> {\n  a: f32\n  constructor(g: (a: f32) => f32) {\n    this.a = g(1.)\n  }\n}\n`,
          `  const p = new Pair<Box<f32>>()\n  return vec4(1.)`,
        ),
      ),
    ).toEqual([
      `${TS_CODES.ARITY_MISMATCH} "new Pair<Box<f32>>" takes a function for "g", "(a: f32) => f32": hand one over by its name, or write it here as an arrow function.`,
    ]);
  });

  it('Math and console are objects, and a type alias of a WGSL type names its constructor', () => {
    // `new Math()` was 'Unknown identifier "Math"', although `Math.sin` resolves; `new S()` on
    // `type S = vec3` was told to write an object literal, which a vector has no fields for.
    const at = (head: string, target: string) =>
      said(`"use typeshade"\n${head}function g(): f32 {\n  const d = ${target}\n  return 1.\n}\n`);
    expect(at('', 'new Math()')).toEqual([
      `${TS_CODES.CLASS_MEMBER} "Math" is an object of functions, not a class. Call one of them, Math.sin(x).`,
    ]);
    expect(at('', 'new console()')).toEqual([
      `${TS_CODES.CLASS_MEMBER} "console" is an object of functions, not a class. Call one of them, console.log(x).`,
    ]);
    for (const [alias, target, message] of [
      ['vec3', 'new S(1., 2., 3.)', 'vec3(1., 2., 3.)'],
      ['f32', 'new S(1.)', 'f32(1.)'],
      ['array<f32, 2>', 'new S(1., 2.)', 'array<f32, 2>(1., 2.)'],
    ]) {
      expect(at(`type S = ${alias!}\n`, target!), alias).toEqual([
        `${TS_CODES.CLASS_MEMBER} "S" is a type alias of ${alias!}, which is built without "new": ${message!}.`,
      ]);
      expect(at(`type S = ${alias!}\n`, `${message!} as S`), message).toEqual([]);
    }
  });

  it('a value that holds a class adds nothing to the refusal of its declaration', () => {
    // Each said '"A" is a value, not a class.' beside the declaration's own refusal, and a value
    // that holds a class is no value that is not one.
    for (const [head, first] of [
      [
        `class B {\n  a: f32 = 1.\n}\nconst A = B\n`,
        `${TS_CODES.UNKNOWN_NAME} Unknown identifier "B".`,
      ],
      [
        `const A = class {\n  a: f32 = 1.\n}\n`,
        `${TS_CODES.UNSUPPORTED} Unsupported expression "class {\n  a: f32 = 1.\n}".`,
      ],
    ]) {
      expect(said(file(head!, `  return vec4(new A().a)`))).toEqual([first]);
    }
  });

  it('a name another file declares is what that file makes it', () => {
    // `compileTsSources` imports functions alone. `new g()` on one was told to build a class,
    // in a body and in a module constant, and said nothing in a file that is not the entry,
    // whose constants are never lowered; a class the import refused added a second sentence.
    const LIB = {
      fileName: 'lib.ts',
      source: `"use typeshade";\nexport function g(): f32 {\n  return 1.;\n}\nexport class P {\n  a: f32 = 1.;\n}\n`,
    };
    const FS = `@fragment\nexport function fs(): vec4 {\n  return vec4(1.);\n}\n`;
    const multi = (files: { fileName: string; source: string }[], entry = 'main.ts') =>
      compileTsSources([...files, LIB], entry).diagnostics.map(
        (d) => `${d.fileName}:${d.line} ${d.code} ${d.message}`,
      );
    const fn = `${TS_CODES.CLASS_MEMBER} "g" is a function, which is called without "new": g().`;
    const main = (body: string) => ({
      fileName: 'main.ts',
      source: `"use typeshade";\nimport { g, P } from "./lib";\n${body}${FS}`,
    });
    expect(
      multi([main(`export function f(): f32 {\n  const d = new g();\n  return 1.;\n}\n`)]),
    ).toEqual([
      `main.ts:2 ${TS_CODES.UNSUPPORTED} "lib.ts" has no function "P".`,
      `main.ts:4 ${fn}`,
    ]);
    expect(
      multi([
        {
          fileName: 'main.ts',
          source: `"use typeshade";\nimport { g } from "./lib";\nconst K = new g();\nexport function f(): f32 {\n  return K;\n}\n${FS}`,
        },
      ]),
    ).toEqual([`main.ts:3 ${fn}`]);
    expect(
      multi([
        { fileName: 'main.ts', source: `"use typeshade";\nimport { h } from "./util";\n${FS}` },
        {
          fileName: 'util.ts',
          source: `"use typeshade";\nimport { g } from "./lib";\nconst K = new g();\nexport function h(): f32 {\n  return 1.;\n}\n`,
        },
      ]),
    ).toEqual([`util.ts:3 ${fn}`]);
    expect(
      multi([main(`export function f(): f32 {\n  const p = new P();\n  return p.a;\n}\n`)]),
    ).toEqual([`main.ts:2 ${TS_CODES.UNSUPPORTED} "lib.ts" has no function "P".`]);
    // A file compiled on its own sees no other file: the name is unknown, as a call of it is.
    expect(
      said(
        `"use typeshade"\nimport { g } from "./lib"\nexport function f(): f32 {\n  const d = new g()\n  return 1.\n}\n`,
      ),
    ).toEqual([`${TS_CODES.UNKNOWN_NAME} Unknown identifier "g".`]);
  });
});
