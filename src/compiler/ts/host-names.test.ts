// A name is what declares it, not how it is spelled (proposal 0008 §1, Rule 2.1). The front end
// kept a list of 59 JavaScript globals and refused an identifier by its TEXT, as TS8012 "is a
// host/JS API": at the declaration and at every use of an `enum Status { Error }`, a `window`
// parameter or a `class Date` the file declares, and a second time, beside the unknown-name
// sentence, where nothing declared it. `Uint8Array` was not on the list and was already one plain
// TS8022. The list and TS8012 are gone. What is pinned here:
//
//   - a name the file declares compiles whatever its spelling, as TypeScript takes it;
//   - a name nothing declares is one diagnostic where it is used, from the code that owns the
//     position: TS8022 for a value, TS8004 for a callee (said before its arguments are lowered,
//     so a failing argument cannot hide it), TS8002 for a type;
//   - a declaration of the file wins over a §9.3 constant of the same name, as it does in the
//     editor: `enum E`, `namespace PI`, `class TAU` and `function PI` are never e, π or τ.
//
// Verifies: Rule 2.1, Rule 12.4 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { TS_CODES } from './codes.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';

const diagnosticsOf = (src: string): string[] =>
  compile(src).diagnostics.map((d) => `${d.code} ${d.message}`);

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

  it('a callee is TS8004, said before its arguments are lowered', () => {
    // Each argument here fails on its own: a string, an unknown name, and a function handed to
    // a callee that does not exist. The callee is the one mistake on the line.
    for (const call of [
      'fetch("x")',
      'parseFloat("1.5")',
      'structuredClone("x")',
      'nope(zzz)',
      'map(xs, h)',
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
        `${TS_CODES.UNKNOWN_FN} Unknown function "${call}". Declare it in this file, or import it from another shader module.`,
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
      ).toEqual([`${TS_CODES.UNKNOWN_TYPE} Unknown type "${name}".`]);
    }
    expect(
      diagnosticsOf(
        `"use typeshade";\ninterface P {\n  a: Foo;\n  b: f32;\n}\ndeclare const u: uniform<P>;\n${FS}`,
      ),
    ).toEqual([`${TS_CODES.UNKNOWN_TYPE} Unknown type "Foo".`]);
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
