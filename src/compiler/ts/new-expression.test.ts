// `new` on a class the file declares (#86, and the DX note on it). A shader has no heap, and
// for a while the diagnostic said so first: "`new` allocates a JS object. Use struct types and
// vec constructors, or a class the file declares." A reader met that on the first `new` they
// wrote and concluded `new` was out, which it is not. This file pins the opposite: every
// ordinary `new` on a declared class compiles, and each thing that is refused says its own
// reason rather than blaming the allocation.

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileTsSource } from './source-file.js';
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
