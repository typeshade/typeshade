// A name is what declares it, not how it is spelled (proposal 0008 §1, Rule 2.1). The front end
// kept a list of 59 JavaScript globals and refused an identifier by its TEXT, as TS8012 "is a
// host/JS API": at the declaration and at every use of an `enum Status { Error }`, a `window`
// parameter or a `class Date` the file declares, and a second time, beside the unknown-name
// sentence, where nothing declared it. `Uint8Array` was not on the list and was already one plain
// TS8022. The list and TS8012 are gone. What is pinned here:
//
//   - a name the file declares compiles whatever its spelling, as TypeScript takes it;
//   - a name nothing declares is one diagnostic where it is used, from the code that owns the
//     position: TS8022 for a value, TS8004 for a callee (a string or a function handed to it says
//     nothing more), TS8002 for a type, in the words and with the remedy proposal 0007 gave
//     every unknown name;
//   - a declaration of the file wins over a §9.3 constant of the same name, as it does in the
//     editor: `enum E`, `namespace PI`, `class TAU` and `function PI` are never e, π or τ.
//
// Verifies: Rule 2.1, Rule 12.4 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { TS_CODES } from './codes.js';
import { SUPPORTED_TYPE_NAMES } from './type-map.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const diagnosticsOf = (src: string): string[] =>
  compile(src).diagnostics.map((d) => `${d.code} ${d.message}`);

/** The sentence a capitalized type name nothing declares gets. */
const unknownType = (name: string): string =>
  `${TS_CODES.UNKNOWN_TYPE} Unknown type "${name}". Declare it in this file, or import it from another shader module.`;

const FS = `@fragment
export function fs(): vec4 {
  return vec4(1.);
}
`;

/** A program whose `fs` returns `f()` in all four lanes, run on both CPU paths. */
const runs = (head: string, expected: number): void => {
  const r = compile(`"use typeshade";\n${head}@fragment
export function fs(): vec4 {
  const v = f();
  return vec4(v);
}
`);
  expect(r.diagnostics).toEqual([]);
  expect(r.wgsl).toBeDefined();
  for (const make of [compileModule, compileModuleJs]) {
    expect(make(r.module).fns['fs']!(), make.name).toEqual([
      expected,
      expected,
      expected,
      expected,
    ]);
  }
};

describe('a name the file declares is the file’s, whatever it spells', () => {
  it('an enum member Error, a parameter window, a class Date and a module let process', () => {
    runs(
      `enum Status {\n  Ok = 0,\n  Error = 1,\n}\nfunction f(): f32 {\n  return f32(Status.Error);\n}\n`,
      1,
    );
    runs(
      `function hann(window: f32, n: f32): f32 {\n  return n / window;\n}\nfunction f(): f32 {\n  return hann(4., 2.);\n}\n`,
      0.5,
    );
    runs(
      `class Date {\n  t: f32;\n  constructor(t: f32) {\n    this.t = t;\n  }\n}\nfunction f(): f32 {\n  const d = new Date(3.);\n  return d.t;\n}\n`,
      3,
    );
    runs(
      `let process: f32 = 1.;\nfunction f(): f32 {\n  process += 1.;\n  return process;\n}\n`,
      2,
    );
  });

  it('a generic Map, a local function self, and members named after host globals', () => {
    runs(
      `function id<Map>(x: Map): Map {\n  return x;\n}\nfunction f(): f32 {\n  return id(2.);\n}\n`,
      2,
    );
    runs(
      `function f(): f32 {\n  const self = (y: f32): f32 => y * 2.;\n  return self(2.);\n}\n`,
      4,
    );
    runs(
      `interface URL {\n  a: f32;\n}\nnamespace JSON {\n  export const k: f32 = 1.;\n}\nclass P {\n  Error: f32 = 1.;\n  get performance(): f32 {\n    return this.Error;\n  }\n  eval(): f32 {\n    return this.Error;\n  }\n}\nfunction fetch(u: URL): f32 {\n  return u.a;\n}\nfunction f(): f32 {\n  const p = new P();\n  const u: URL = { a: 1. };\n  return fetch(u) + JSON.k + p.performance + p.eval();\n}\n`,
      4,
    );
  });
});

describe('a type the file declares is the file’s, whatever the library calls its own', () => {
  // Each was TS8002 '"Mat" is not a shader type: the library declares it for TypeScript's own
  // use.' in every position a type is written, although TypeScript resolves the name to the
  // file's declaration, and main compiled each one (Rule 2.1).
  const MAT = `class Mat {\n  m: f32 = 1.;\n}\n`;

  it('a class Mat as a parameter, a local, a return and a field type', () => {
    runs(
      `${MAT}function g(x: Mat): f32 {\n  return x.m;\n}\nfunction f(): f32 {\n  return g(new Mat());\n}\n`,
      1,
    );
    runs(`${MAT}function f(): f32 {\n  const k: Mat = new Mat();\n  return k.m;\n}\n`, 1);
    runs(
      `${MAT}function mk(): Mat {\n  return new Mat();\n}\nfunction f(): f32 {\n  return mk().m;\n}\n`,
      1,
    );
    runs(
      `${MAT}class Holder {\n  k: Mat = new Mat();\n}\nfunction f(): f32 {\n  return new Holder().k.m + 1.;\n}\n`,
      2,
    );
  });

  it('a class String, and an interface Pick in a uniform', () => {
    runs(
      `class String {\n  a: f32 = 3.;\n}\nfunction g(x: String): f32 {\n  return x.a;\n}\nfunction f(): f32 {\n  return g(new String());\n}\n`,
      3,
    );
    const r =
      compile(`"use typeshade";\ninterface Pick {\n  p: f32;\n}\ndeclare const u: uniform<Pick>;\n@fragment
export function fs(): vec4 {
  return vec4(u.p);
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('struct Pick');
  });
});

describe('a name nothing declares is one diagnostic, where it is used', () => {
  const body = (line: string) => `"use typeshade";
function g(): f32 {
${line}
  return 1.;
}
${FS}`;

  it('a value is TS8022, once', () => {
    for (const [line, name] of [
      ['  const x = window;', 'window'],
      ['  const x = Date.now();', 'Date'],
      ['  const x = globalThis;', 'globalThis'],
      ['  const x = Uint8Array;', 'Uint8Array'],
    ]) {
      expect(diagnosticsOf(body(line!)), line).toEqual([
        `${TS_CODES.UNKNOWN_NAME} Unknown identifier "${name}".`,
      ]);
    }
    expect(diagnosticsOf(body('  Date = 1.;'))).toEqual([
      `${TS_CODES.UNKNOWN_NAME} Cannot assign to unknown name "Date".`,
    ]);
  });

  it('a callee is TS8004 on its name, and a string or a function handed to it says nothing', () => {
    // A string and a function handed to a callee that does not exist are there only because the
    // call is: the callee is the one mistake on the line. `fetch("x")` was TS8012 once while the
    // host list stood, and without it read as TS8004 beside a refusal of the string.
    for (const [call, name] of [
      ['fetch("x")', 'fetch'],
      ['parseFloat("1.5")', 'parseFloat'],
      ['structuredClone("x")', 'structuredClone'],
      ['map(xs, h)', 'map'],
    ]) {
      expect(
        diagnosticsOf(`"use typeshade";
function h(x: f32): f32 {
  return x;
}
function g(xs: array<f32, 2>): f32 {
  const x = ${call};
  return 1.;
}
${FS}`),
        call,
      ).toEqual([
        `${TS_CODES.UNKNOWN_FN} Unknown function "${name!}". Declare it in this file, or import it from another shader module.`,
      ]);
    }
  });

  it('a type is TS8002, and no longer a struct of its own name that Tint refuses', () => {
    // Measured on main: `x: Date` emitted `fn g(x: Date)` and Tint answered "unresolved type
    // 'Date'"; `x: Foo` did the same with no diagnostic at all.
    for (const name of ['Date', 'Float32Array', 'Foo']) {
      expect(
        diagnosticsOf(`"use typeshade";\nfunction g(x: ${name}): f32 {\n  return 1.;\n}\n${FS}`),
        name,
      ).toEqual([unknownType(name)]);
    }
    expect(
      diagnosticsOf(
        `"use typeshade";\ninterface P {\n  a: Foo;\n  b: f32;\n}\ndeclare const u: uniform<P>;\n${FS}`,
      ),
    ).toEqual([unknownType('Foo')]);
  });
});

describe('a declaration of the file wins over a §9.3 constant of its name', () => {
  // Measured on main: each compiled with no diagnostic, to `return 2.718281828459045;`, π or τ,
  // while the editor read the file's declaration (TS2322).
  it('an enum, a namespace and a class read as a value are the file’s, not e, π or τ', () => {
    for (const [head, name] of [
      ['enum E {\n  A = 1,\n}\n', 'E'],
      ['namespace PI {\n  export const a: f32 = 1.;\n}\n', 'PI'],
      ['class TAU {\n  a: f32 = 1.;\n}\n', 'TAU'],
    ]) {
      expect(
        diagnosticsOf(`"use typeshade";\n${head}function g(): f32 {\n  return ${name};\n}\n${FS}`),
        name,
      ).toEqual([`${TS_CODES.UNKNOWN_NAME} Unknown identifier "${name}".`]);
    }
  });

  it('a function read as a value is a function, generic or not', () => {
    for (const head of [
      'function PI(): f32 {\n  return 1.;\n}\n',
      'function PI<T>(x: T): T {\n  return x;\n}\n',
    ]) {
      expect(
        diagnosticsOf(`"use typeshade";\n${head}function g(): f32 {\n  return PI;\n}\n${FS}`),
      ).toEqual([
        `${TS_CODES.UNSUPPORTED} "PI" is a function, and a shader has no function values: nothing at run time can hold one, return one or choose between two. Call it where its value is needed, "PI(...)", or hand it to a parameter that takes a function (Rule 8.18).`,
      ]);
    }
  });

  it('an interface declares no value, so the constant still reads through it', () => {
    const r = compile(`"use typeshade";\ninterface LN2 {\n  a: f32;\n}\n@fragment
export function fs(): vec4 {
  return vec4(LN2);
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('0.693147');
  });
});

describe('a name the library declares for TypeScript is what it is, read or called', () => {
  // Each was 'Unknown identifier' or 'Unknown function … Declare it in this file', which the
  // editor contradicts (TypeScript's TS2693 says the library declares a type of the name), and a
  // `new` of the same name already said what it is.
  const body = (line: string) =>
    `"use typeshade";\nfunction g(x: f32): f32 {\n  const k = ${line};\n  return 1.;\n}\n${FS}`;
  const type = (name: string) =>
    `"${name}" is a type, not a value: the library declares it for TypeScript's own use.`;

  it('a type of its own, called or read, with the conversion to write where it is called', () => {
    for (const [line, message] of [
      ['Number("1")', `${TS_CODES.UNKNOWN_FN} ${type('Number')} Write f32(x), i32(x) or u32(x).`],
      ['Number(x)', `${TS_CODES.UNKNOWN_FN} ${type('Number')} Write f32(x), i32(x) or u32(x).`],
      ['Boolean(x)', `${TS_CODES.UNKNOWN_FN} ${type('Boolean')} Write bool(x).`],
      ['String(x)', `${TS_CODES.UNKNOWN_FN} ${type('String')}`],
      ['Array(4)', `${TS_CODES.UNKNOWN_FN} ${type('Array')}`],
      ['Object', `${TS_CODES.UNKNOWN_NAME} ${type('Object')}`],
      ['Object.keys(x)', `${TS_CODES.UNKNOWN_NAME} ${type('Object')}`],
    ]) {
      expect(diagnosticsOf(body(line!)), line).toEqual([message]);
    }
    // The conversions it names compile.
    expect(
      diagnosticsOf(body('f32(x) + f32(i32(x)) + f32(u32(x)) + select(0., 1., bool(x))')),
    ).toEqual([]);
  });

  it('Symbol, Math and console, which the library declares as values', () => {
    const symbol = (what: string) =>
      `"Symbol" is no ${what} a shader has: the library declares it for TypeScript's own use.`;
    for (const [line, message] of [
      ['Symbol', `${TS_CODES.UNKNOWN_NAME} ${symbol('value')}`],
      ['Symbol("k")', `${TS_CODES.UNKNOWN_FN} ${symbol('function')}`],
      ['new Symbol()', `${TS_CODES.CLASS_MEMBER} ${symbol('class')}`],
      [
        'Math',
        `${TS_CODES.UNKNOWN_NAME} "Math" is an object of functions, not a value. Call one of them, Math.sin(x).`,
      ],
      [
        'console',
        `${TS_CODES.UNKNOWN_NAME} "console" is an object of functions, not a value. Call one of them, console.log(x).`,
      ],
    ]) {
      expect(diagnosticsOf(body(line!)), line).toEqual([message]);
    }
  });
});

describe('a name nothing declares in a body no call lowers is said too', () => {
  // Each compiled with no diagnostic while the editor said TS2304 (Rule 12.7): an uncalled
  // generic, a function that takes a function, and a method of a class nothing builds are never
  // lowered. While the host list stood, `window` there was TS8012.
  it('a value, a callee and a target, in the words the lowering uses', () => {
    for (const [head, message] of [
      [
        'function mk<T>(x: T): f32 {\n  const d = window;\n  return 1.;\n}\n',
        `${TS_CODES.UNKNOWN_NAME} Unknown identifier "window".`,
      ],
      [
        'function mk<T>(x: T): f32 {\n  return fetch(x);\n}\n',
        `${TS_CODES.UNKNOWN_FN} Unknown function "fetch". Declare it in this file, or import it from another shader module.`,
      ],
      [
        'function run(f: (x: f32) => f32): f32 {\n  const d = window;\n  return f(1.);\n}\n',
        `${TS_CODES.UNKNOWN_NAME} Unknown identifier "window".`,
      ],
      [
        'function mk<T>(x: T): f32 {\n  Date = 1.;\n  return 1.;\n}\n',
        `${TS_CODES.UNKNOWN_NAME} Cannot assign to unknown name "Date".`,
      ],
      [
        'class G<T> {\n  v: T;\n  get(): f32 {\n    return self;\n  }\n}\n',
        `${TS_CODES.UNKNOWN_NAME} Unknown identifier "self".`,
      ],
      [
        'function mk<T>(x: T): f32 {\n  return Number(1.);\n}\n',
        `${TS_CODES.UNKNOWN_FN} "Number" is a type, not a value: the library declares it for TypeScript's own use. Write f32(x), i32(x) or u32(x).`,
      ],
    ]) {
      expect(diagnosticsOf(`"use typeshade";\n${head}${FS}`), head).toEqual([message]);
    }
  });

  it('once, where a body a call lowers says it as well', () => {
    expect(
      diagnosticsOf(`"use typeshade";\nfunction mk<T>(x: T): f32 {\n  const d = window;\n  return 1.;\n}\n@fragment
export function fs(): vec4 {
  return vec4(mk(1.) + mk(2));
}
`),
    ).toEqual([`${TS_CODES.UNKNOWN_NAME} Unknown identifier "window".`]);
  });

  it('nothing for a name the file or the library declares, in any scope', () => {
    const r = compile(
      `"use typeshade";\nconst K: f32 = 2.;\nfunction mk<T>(x: T, n: f32): f32 {\n  const a = PI + K + sin(n) + Math.cos(n);\n  let b = a;\n  b += select(0., 1., n > 0.);\n  _ = sin(b);\n  return b;\n}\n${FS}`,
    );
    expect(r.diagnostics).toEqual([]);
  });
});

describe('a type name nothing declares is TS8002 wherever it is written, once', () => {
  // Measured before this change: each was a single TS8012 while the host list stood, and then
  // nothing at all, since none of these positions is mapped by a body the compiler lowers: the
  // editor showed TS2304 alone (Rule 12.7).
  const lower = (name: string) =>
    `${TS_CODES.UNKNOWN_TYPE} Unknown type "${name}". Supported names: ${SUPPORTED_TYPE_NAMES.join(', ')}.`;

  it('in a position no body maps', () => {
    for (const head of [
      'class C implements Date {\n  a: f32 = 1.;\n}\n',
      'type A = Date;\n',
      'function id<T = Date>(x: T): T {\n  return x;\n}\n',
      'function h(x: Date): f32;\nfunction h(x: f32): f32 {\n  return x;\n}\n',
      'interface I {\n  m(x: Date): f32;\n}\n',
      'function apply(fn: (x: Date) => f32): f32 {\n  return 1.;\n}\n',
      'function mk<T>(x: T): Date {\n  return x;\n}\n',
    ]) {
      expect(diagnosticsOf(`"use typeshade";\n${head}${FS}`), head).toEqual([unknownType('Date')]);
    }
    expect(diagnosticsOf(`"use typeshade";\ntype A = window;\n${FS}`)).toEqual([lower('window')]);
  });

  it('in a claim, which claims nothing the program has, and leaves its value as it is', () => {
    for (const [claim, message] of [
      ['0.5 as window', lower('window')],
      ['1. as self', lower('self')],
      ['0.5 satisfies Date', unknownType('Date')],
    ]) {
      expect(
        diagnosticsOf(
          `"use typeshade";\nfunction g(): f32 {\n  const k = ${claim};\n  return k;\n}\n${FS}`,
        ),
        claim,
      ).toEqual([message]);
    }
  });

  it('as a type argument, of a type and of a new', () => {
    // `x: B<Date>` emitted `fn g(x: B)` with no struct B, and `new B<Foo>()` was told that nothing
    // in the file says what to build it at, although the file writes `B<Foo>`.
    const head = 'class B<T> {\n  v: T;\n}\n';
    for (const [line, name] of [
      ['function g(x: B<Date>): f32 {\n  return 1.;\n}\n', 'Date'],
      ['function g(x: B<Foo>): f32 {\n  return 1.;\n}\n', 'Foo'],
      ['function g(): f32 {\n  const b = new B<Foo>();\n  return 1.;\n}\n', 'Foo'],
    ]) {
      expect(diagnosticsOf(`"use typeshade";\n${head}${line}${FS}`), line).toEqual([
        unknownType(name!),
      ]);
    }
  });

  it('inside a WGSL generic that is itself a type argument of a class', () => {
    // `x: B<vec3<Foo>>` compiled with no diagnostic to `fn g(x: B)` with no struct B, which Tint
    // refuses ("unresolved type 'B'"), and `new B<vec3<Foo>>()` was told the file writes no type
    // argument. `B` collects no instance from `vec3<Foo>` and says nothing of it, so `vec3`'s own
    // sentence is never said there: the name is.
    const head = 'class B<T> {\n  v: T;\n}\n';
    for (const [line, message] of [
      ['function g(x: B<vec3<Foo>>): f32 {\n  return 1.;\n}\n', unknownType('Foo')],
      ['function g(x: B<mat3x3<Foo>>): f32 {\n  return 1.;\n}\n', unknownType('Foo')],
      [
        'function g(): f32 {\n  const b = new B<vec3<Foo>>();\n  return 1.;\n}\n',
        unknownType('Foo'),
      ],
      [
        'function g(x: B<vec3<float>>): f32 {\n  return 1.;\n}\n',
        `${TS_CODES.UNKNOWN_TYPE} Unknown type "float". GLSL's and HLSL's float is f32 here.`,
      ],
    ]) {
      expect(diagnosticsOf(`"use typeshade";\n${head}${line}${FS}`), line).toEqual([message]);
    }
  });

  it('as the base of a class or an interface, used or not', () => {
    // Each was TS8010 '"C" extends "Date", which this file does not declare as a struct', beside
    // TypeScript's TS2304 on `Date`; an interface no one used said nothing at all.
    for (const head of [
      'class C extends Date {\n  a: f32 = 1.;\n}\nfunction g(): f32 {\n  return new C().a;\n}\n',
      'interface I extends Date {\n  a: f32;\n}\nfunction g(i: I): f32 {\n  return i.a;\n}\n',
      'interface I extends Date {\n  a: f32;\n}\n',
    ]) {
      expect(diagnosticsOf(`"use typeshade";\n${head}${FS}`), head).toEqual([unknownType('Date')]);
    }
    // A class that holds a mixin applied is a base the file declares.
    const r =
      compile(`"use typeshade";\nclass B {\n  a: f32 = 1.;\n}\nfunction Tinted<TBase extends AnyClass>(Base: TBase) {\n  return class extends Base {\n    t: f32 = 2.;\n  };\n}\nconst TB = Tinted(B);\nclass C extends TB {\n  c: f32 = 3.;\n}\n@fragment
export function fs(): vec4 {
  const c = new C();
  return vec4(c.a, c.t, c.c, 1.);
}
`);
    expect(r.diagnostics).toEqual([]);
  });

  it('as the type of a binding, which a read of the binding adds nothing to', () => {
    // A read was also 'Unknown field "a" on Foo.', of the struct the binding was recovered as.
    expect(
      diagnosticsOf(
        `"use typeshade";\ndeclare const u: uniform<Foo>;\nfunction g(): f32 {\n  return u.a;\n}\n${FS}`,
      ),
    ).toEqual([unknownType('Foo')]);
  });

  it('a name the library declares is no unknown name in a constraint', () => {
    const r =
      compile(`"use typeshade";\nclass B {\n  a: f32 = 1.;\n}\nfunction Tinted<TBase extends AnyClass>(Base: TBase) {\n  return class extends Base {\n    t: f32 = 2.;\n  };\n}\nclass C extends Tinted(B) {}\n@fragment
export function fs(): vec4 {
  const c = new C();
  return vec4(c.a, c.t, 0., 1.);
}
`);
    expect(r.diagnostics).toEqual([]);
  });

  it('once, in a generic body lowered for two type arguments', () => {
    expect(
      diagnosticsOf(`"use typeshade";\nfunction mk<T>(x: T): f32 {\n  return fetch("x");\n}\n@fragment
export function fs(): vec4 {
  return vec4(mk(1.) + mk(vec2f(1.)));
}
`),
    ).toEqual([
      `${TS_CODES.UNKNOWN_FN} Unknown function "fetch". Declare it in this file, or import it from another shader module.`,
    ]);
  });
});

describe('a type nothing declares is one diagnostic in every position that reads it', () => {
  it('an argument of a WGSL generic, which says what it takes', () => {
    // Each was the generic's own sentence and a second TS8002 for the argument, one mistake.
    for (const [type, message] of [
      ['vec3<Foo>', 'vec3<T> T must be f32, i32, u32, or f64.'],
      ['vec3<float>', 'vec3<T> T must be f32, i32, u32, or f64.'],
      ['mat3x3<Foo>', 'mat3x3<T> T must be f32 or f64.'],
      ['ptr<function, f32>', 'Type arguments are not supported yet (got "ptr<...>").'],
    ]) {
      expect(
        diagnosticsOf(`"use typeshade";\nfunction g(x: ${type!}): f32 {\n  return 1.;\n}\n${FS}`),
        type,
      ).toEqual([`${TS_CODES.UNKNOWN_TYPE} ${message!}`]);
    }
  });

  it('a module let, a static field and a module const, which say nothing more', () => {
    // Each was TS8002 and then its initializer refused against a struct of the name, `"K" is
    // declared struct:Foo but its initializer is f32`, an IR key for a type nobody declared.
    for (const head of [
      'let K: Foo = 1.;\n',
      'class S {\n  a: f32 = 1.;\n  static K: Foo = 1.;\n  static bump(): void {\n    S.K = 1.;\n  }\n}\n',
      'const K: Foo = { a: 1. };\nfunction g(): f32 {\n  return K.a;\n}\n',
    ]) {
      expect(diagnosticsOf(`"use typeshade";\n${head}${FS}`), head).toEqual([unknownType('Foo')]);
    }
  });

  it('a type the library declares for TypeScript is declared, and no shader type', () => {
    // Each was 'Unknown type', which the editor contradicts: TypeScript resolves them.
    for (const [name, remedy] of [
      ['Number', ' Write f32, i32 or u32.'],
      ['Boolean', ' Write bool.'],
      ['AnyClass', ''],
    ]) {
      expect(
        diagnosticsOf(`"use typeshade";\nfunction g(x: ${name!}): f32 {\n  return 1.;\n}\n${FS}`),
        name,
      ).toEqual([
        `${TS_CODES.UNKNOWN_TYPE} "${name!}" is not a shader type: the library declares it for TypeScript's own use.${remedy!}`,
      ]);
    }
  });
});

describe('the editor says the one sentence the compiler says', () => {
  // Rule 12.4 and Rule 12.7 in the editor: TypeScript's own report of the same mistake (TS2304
  // on `Date`, TS2351 on an enum, TS2693 on a type, TS7009 on a function, TS2511 on an abstract
  // class) is merged into the compiler's, and a name the file declares draws nothing. Before
  // this each `new` read as the compiler's sentence beside TypeScript's.
  const editorOf = (src: string): string[] => {
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', src);
    return service
      .getDiagnostics('a.ts')
      .filter((d) => d.severity === 'error')
      .map((d) => `${d.source} ${d.code} ${d.message}`);
  };
  const body = (head: string, line: string) =>
    `"use typeshade";\n${head}function g(): f32 {\n  const d = ${line};\n  return 1.;\n}\n${FS}`;

  it('a name nothing declares, and a new of anything but a class', () => {
    for (const [head, line] of [
      ['', 'Date.now()'],
      ['', 'Map'],
      ['', 'document'],
      ['', 'new Date()'],
      ['', 'new Intl.NumberFormat()'],
      ['', 'new Math.Foo()'],
      ['', 'new Array(4)'],
      ['', 'fetch("x")'],
      ['', 'new vec3f(1.)'],
      ['function F(): f32 {\n  return 1.;\n}\n', 'new F()'],
      ['enum E {\n  A = 1,\n}\n', 'new E()'],
      ['', 'new Math()'],
      ['', 'new PI()'],
      ['', 'new sampler()'],
      ['interface I {\n  a: f32;\n}\n', 'new I()'],
      ['type S = vec3;\n', 'new S()'],
      ['abstract class B {\n  a: f32 = 1.;\n}\n', 'new B()'],
    ]) {
      const src = body(head!, line!);
      const compiled = diagnosticsOf(src);
      expect(compiled, line).toHaveLength(1);
      expect(editorOf(src), line).toEqual(compiled.map((c) => `typeshade ${c}`));
    }
  });

  it('a type the library declares, read, called or built, and a name in a body no call lowers', () => {
    for (const src of [
      body('', 'Number("1")'),
      body('', 'Number(1.)'),
      body('', 'Object.keys(1.)'),
      body('', 'Object'),
      body('', 'new Symbol()'),
      body('', 'process'),
      body('', 'require("x")'),
      body('', 'new globalThis.Date()'),
      `"use typeshade";\nfunction mk<T>(x: T): f32 {\n  const d = window;\n  return 1.;\n}\n${FS}`,
      `"use typeshade";\nclass C extends Date {\n  a: f32 = 1.;\n}\n${FS}`,
      `"use typeshade";\ninterface I extends Date {\n  a: f32;\n}\n${FS}`,
      `"use typeshade";\ndeclare const u: uniform<Foo>;\nfunction g(): f32 {\n  return u.a;\n}\n${FS}`,
    ]) {
      const compiled = diagnosticsOf(src);
      expect(compiled, src).toHaveLength(1);
      expect(editorOf(src), src).toEqual(compiled.map((c) => `typeshade ${c}`));
    }
  });

  it('a new of a name another document declares, which a file compiled on its own cannot see', () => {
    // TypeScript's TS7009 on `new g()` merges into the compiler's unknown name: the editor
    // compiles each document on its own, as it does a call of an imported function (TS8004).
    const service = createTypeshadeLanguageService();
    service.openDocument(
      '/lib.ts',
      `"use typeshade";\nexport function g(): f32 {\n  return 1.;\n}\n`,
    );
    service.openDocument(
      '/main.ts',
      `"use typeshade";\nimport { g } from "./lib";\nfunction f(): f32 {\n  const d = new g();\n  return 1.;\n}\n${FS}`,
    );
    expect(
      service
        .getDiagnostics('/main.ts')
        .filter((d) => d.severity === 'error')
        .map((d) => `${d.source} ${d.code} ${d.message}`),
    ).toEqual([`typeshade ${TS_CODES.UNKNOWN_NAME} Unknown identifier "g".`]);
  });

  it('a name the file declares, whatever it spells', () => {
    for (const src of [
      `"use typeshade";\nenum Status {\n  Ok = 0,\n  Error = 1,\n}\nfunction g(): i32 {\n  return Status.Error;\n}\n${FS}`,
      `"use typeshade";\nfunction hann(window: f32, n: f32): f32 {\n  return n / window;\n}\n${FS}`,
    ]) {
      expect(diagnosticsOf(src)).toEqual([]);
      expect(editorOf(src)).toEqual([]);
    }
  });
});
