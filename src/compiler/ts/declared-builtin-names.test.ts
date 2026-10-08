// A function the file declares wins over every builtin function of its name (Rule 9.5, change
// 0029).
//
// The program of #403 had three answers. WebGPU called the author's `fract`, because WGSL lets a
// module-scope declaration hide a predeclared function; the CPU and the constant folder called the
// builtin, because the builtins that predate the rule kept their precedence over a function of the
// module; and WebGL2 had no answer at all, because GLSL ES 3.00 does not let a program redeclare
// one of its built-in functions. It is one answer now: the declaration wins in the folder, on the
// three CPU walks and on both targets, and each writer emits it under a name its target does not
// predeclare, so a call of the builtin, the author's or the compiler's own, still reaches the
// builtin. A value constructor keeps its precedence over a declaration, as a type name does over an
// alias (Rule 4.2).
//
// Each test reads both halves (CLAUDE.md, "A test reads both halves"): the compiler, its
// diagnostics and its emit, and the language service on the same source. The compile gate hands the
// emit to Tint and to ANGLE (`scripts/compile-gate.ts`, the declared-names leg), and to WebGPU, where
// the answer is the CPU oracle's.
//
// Verifies: Rule 3.2, Rule 9.5 (docs/language-design.md; traced in reqs/).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { builtinCalleeNames } from './lower/expression-call.js';
import { isValueConstructor } from './lower/constructors.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { startDebugSession } from '../../core/debug/session.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const errorsOf = (r: ReturnType<typeof compile>): string[] =>
  r.diagnostics.filter((d) => d.category === 'error').map((d) => `${d.code} ${d.message}`);

/** The editor's verdict on a source: every diagnostic the service reports, as text. */
function editorDiagnostics(source: string, uri = 'a.ts'): string[] {
  const service = createTypeshadeLanguageService();
  service.openDocument(uri, source);
  return service.getDiagnostics(uri).map((d) => `${d.source} ${String(d.code)}: ${d.message}`);
}

/** The editor's hover on the first `needle` of a source. */
function editorHover(source: string, needle: string, uri = 'a.ts'): string {
  const service = createTypeshadeLanguageService();
  service.openDocument(uri, source);
  const at = service.positionAt(uri, source.indexOf(needle));
  return service.getHover(uri, at)?.contents ?? '';
}

// The program of #403, as its table gives it: `out[1]` holds 1.25, so the author's `fract` answers
// 0.75 for the run-time argument and for the literal, and the builtin 0.25 for both.
const ISSUE_403 = `"use typeshade";
declare const out: storage<array<f32>, "read_write">;
function fract(x: f32): f32 { return x - floor(x) + 0.5; }
@compute([1])
export function main() { out[0] = fract(out[1]); out[2] = fract(1.25); }
`;

/** The same declaration, called from a fragment entry, which is what GLSL ES 3.00 has a program for. */
const ISSUE_403_FRAGMENT = `"use typeshade";
function fract(x: f32): f32 { return x - floor(x) + 0.5; }
class Color {
  @location(0) color: vec4;
}
@fragment
export function fs(@builtin("position") p: vec4): Color {
  const a = fract(p.x);
  const b = fract(1.25);
  return { color: vec4(a, b, 0., 1.) };
}
`;

describe('#403: a declared fract has one answer', () => {
  it('reaches the declaration in the constant folder, on every CPU walk and in the WGSL', () => {
    const c = compile(ISSUE_403);
    expect(errorsOf(c)).toEqual([]);
    // WebGPU. The declaration has a name WGSL does not predeclare, so no `fract(…)` of the module
    // reaches the builtin by accident, and the literal argument is a call of the declaration: the
    // folder folds `fract(1.25)` only for the builtin, whose 0.25 this line would be.
    expect(c.wgsl).toContain('fn fract_(x: f32) -> f32 {');
    expect(c.wgsl).toContain('out[0] = fract_(out[1]);');
    expect(c.wgsl).toContain('out[2] = fract_(1.25);');
    expect(c.wgsl).not.toMatch(/\bfract\(/);
    // The CPU: the interpreter and its `new Function` twin, each called and dispatched (which
    // runs the debugger's walk), and the debugger itself.
    const cases: { name: string; out: number[] }[] = [];
    for (const [name, make] of [
      ['interpreter', compileModule],
      ['codegen', compileModuleJs],
    ] as const) {
      for (const how of ['called', 'dispatched'] as const) {
        const cm = make(c.module);
        const out = [0, 1.25, 0];
        cm.setBinding('out', out);
        if (how === 'called') cm.fns.main!();
        else cm.dispatch('main', 1);
        cases.push({ name: `${name}, ${how}`, out });
      }
    }
    const out = [0, 1.25, 0];
    const session = startDebugSession(c.module, 'main', [], { bindings: { out } });
    while (session.continue() !== undefined) {
      // Runs to the end of the entry.
    }
    cases.push({ name: 'debugger', out });
    for (const { name, out: got } of cases) expect(got, name).toEqual([0.75, 1.25, 0.75]);
  });

  it('is the declaration on WebGL2 too, which has a program for it now', () => {
    const c = compile(ISSUE_403_FRAGMENT);
    expect(errorsOf(c)).toEqual([]);
    const fragment = c.glsl?.fragment ?? '';
    // A declaration of a built-in function's name is what ANGLE refuses; `fract_` is not one.
    expect(fragment).toContain('float fract_(float x) {');
    expect(fragment).not.toMatch(/float fract\(/);
    expect(fragment).toMatch(/fract_\(p\.x\)/);
    expect(fragment).toMatch(/fract_\(1\.25\)/);
    // Both targets spell the declaration the one way, and the oracle answers with it.
    expect(c.wgsl).toContain('fn fract_(x: f32) -> f32 {');
    expect(c.eval('fs', [[1.25, 0, 0, 1]])).toEqual({ color: [0.75, 0.75, 0, 1] });
  });

  it('is read the same way by the editor: no diagnostic, and the call is the declaration', () => {
    for (const source of [ISSUE_403, ISSUE_403_FRAGMENT]) {
      expect(editorDiagnostics(source)).toEqual([]);
    }
    expect(editorHover(ISSUE_403, 'fract(out[1])')).toContain('function fract(x: f32): f32');
    expect(editorHover(ISSUE_403_FRAGMENT, 'fract(p.x)')).toContain('function fract(x: f32): f32');
  });
});

describe('the builtin a call of the compiler names keeps its name', () => {
  // `random(x)` expands to `fract(sin(x) * 43758.5453123)`, a call of the builtin the author did
  // not write. Beside a declared `fract` it called the declaration on WebGPU and the builtin on the
  // CPU, and now reaches the builtin on every target.
  const RANDOM = (decl: string): string => `"use typeshade";
${decl}
export function g(x: f32): f32 {
  return fract(x) + random(x);
}
class Color {
  @location(0) color: vec4;
}
@fragment
export function fs(@builtin("position") p: vec4): Color {
  const v = g(p.x);
  return { color: vec4(v, v, v, 1.) };
}
`;
  const DECLARED = 'function fract(x: f32): f32 { return 99.; }';

  it('calls the builtin in random(), on both targets and on the CPU', () => {
    const c = compile(RANDOM(DECLARED));
    expect(errorsOf(c)).toEqual([]);
    for (const text of [c.wgsl ?? '', c.glsl?.fragment ?? '']) {
      // The author's call, and the compiler's, in one function, each under its own name.
      expect(text).toContain('fract_(x)');
      expect(text).toContain('fract((sin(x) * 43758.5453123))');
      expect(text).not.toMatch(/(?:fn|float) fract\(/);
    }
    // The CPU: 99 from the declaration, and random's own value, which the same expression gives
    // with no declaration in the module at all.
    const bare = compile(
      RANDOM('').replace('fract(x) + random(x)', 'random(x)').replace(DECLARED, ''),
    );
    expect(errorsOf(bare)).toEqual([]);
    for (const make of [compileModule, compileModuleJs]) {
      const declared = make(c.module).fns.g!(3) as number;
      const hash = make(bare.module).fns.g!(3) as number;
      expect(declared, make.name).toBe(99 + hash);
    }
    expect(editorDiagnostics(RANDOM(DECLARED))).toEqual([]);
  });

  it('is no recursion when a declared fract calls random()', () => {
    // `random` expands to a call of the builtin `fract`, and the function that makes it is named
    // `fract`: a call cycle by name, and none in fact.
    const source = `"use typeshade";
function fract(x: f32): f32 { return random(x); }
export function g(x: f32): f32 { return fract(x); }
`;
    const c = compile(source);
    expect(errorsOf(c)).toEqual([]);
    expect(editorDiagnostics(source)).toEqual([]);
    const bare = compile(
      `"use typeshade";\nexport function g(x: f32): f32 { return random(x); }\n`,
    );
    for (const make of [compileModule, compileModuleJs]) {
      expect(make(c.module).fns.g!(3), make.name).toBe(make(bare.module).fns.g!(3));
    }
  });

  // Each row: a builtin the compiler writes for a `Math` call, a function of the same name the
  // file declares with a signature the builtin does not have, and the value the call has.
  it.each([
    ['pow', 'function pow(a: f32): f32 { return 99.; }', 'pow(x) + Math.pow(x, 2.)', 99 + 9],
    [
      'min',
      'function min(a: f32, b: f32, c: f32): f32 { return 99.; }',
      'min(x, x, x) + Math.min(x, 2.)',
      99 + 2,
    ],
    [
      'sqrt',
      'function sqrt(a: vec2): f32 { return 99.; }',
      'sqrt(vec2(x, x)) + Math.sqrt(x)',
      99 + Math.sqrt(3),
    ],
    [
      'atan2',
      'function atan2(y: f32, x: f32): f32 { return 99.; }',
      'atan2(x, x) + Math.atan2(x, 2.)',
      99 + Math.atan2(3, 2),
    ],
  ])('leaves Math.%s the builtin beside a declared %s', (name, decl, expr, want) => {
    const source = `"use typeshade";
${decl}
export function g(x: f32): f32 { return ${expr}; }
class Color {
  @location(0) color: vec4;
}
@fragment
export function fs(@builtin("position") p: vec4): Color {
  const v = g(p.x);
  return { color: vec4(v, v, v, 1.) };
}
`;
    const c = compile(source);
    expect(errorsOf(c)).toEqual([]);
    // The validation every emit runs, and the CPU tiers, read a call of the builtin as one: it is
    // not checked against the declaration's parameters.
    for (const make of [compileModule, compileModuleJs]) {
      expect(make(c.module).fns.g!(3) as number, make.name).toBeCloseTo(want, 5);
    }
    // And the two targets name the declaration apart from the builtin the `Math` call reaches.
    expect(c.wgsl).toContain(`fn ${name}_(`);
    expect(c.glsl?.fragment).toContain(` ${name}_(`);
    expect(editorDiagnostics(source)).toEqual([]);
  });
});

describe('a value constructor keeps its precedence over a declaration of its name', () => {
  const SOURCE = `"use typeshade";
function f32(x: f32): f32 { return 99.; }
function vec3(x: f32): f32 { return 99.; }
function mat2x2f(x: f32): f32 { return 99.; }
function array(x: f32): f32 { return 99.; }
export function g(): f32 {
  const c = f32(i32(3));
  const v = vec3(1., 2., 3.);
  const m = mat2x2f(1., 2., 3., 4.);
  const a = array(5., 6.);
  return c + v.y + m[1].x + a[1];
}
`;

  it('builds the value, and the declaration is a function nothing calls by its name', () => {
    const c = compile(SOURCE);
    expect(errorsOf(c)).toEqual([]);
    // 3 + 2 + 3 + 6: every call is the constructor, and none is 99.
    for (const make of [compileModule, compileModuleJs]) {
      expect(make(c.module).fns.g!(), make.name).toBe(14);
    }
    // The declarations are emitted under names the target does not predeclare: a declared `f32`
    // hides the type in the whole module, and so does `array`.
    for (const name of ['f32', 'vec3', 'mat2x2f', 'array']) {
      expect(c.wgsl, name).toContain(`fn ${name}_(`);
      expect(c.wgsl, name).not.toContain(`fn ${name}(`);
    }
    expect(c.wgsl).toContain('vec3<f32>(1.0, 2.0, 3.0)');
  });

  it('is what isValueConstructor says, for the names the surface builds by', () => {
    for (const name of [
      'f32',
      'i32',
      'u32',
      'vec2',
      'vec3f',
      'vec4u',
      'vec2b',
      'mat2',
      'mat3x2f',
      'array',
    ]) {
      expect(isValueConstructor(name), name).toBe(true);
    }
    // `bool` and `f64` stay the declaration's, as before item 8 made them callable, and a
    // builtin function is never a constructor.
    for (const name of [
      'bool',
      'f64',
      'fract',
      'random',
      'sum',
      'fill',
      'select',
      'textureSample',
    ]) {
      expect(isValueConstructor(name), name).toBe(false);
    }
  });

  // A callback follows the call, and a call of the name is the constructor: no fold, method or
  // function takes one, so the declaration handed by that name is refused with the rule named,
  // where a builtin function's name hands the declaration over.
  it.each([
    [
      'a fold',
      'zip',
      `"use typeshade";
function f32(a: f32, b: f32): f32 { return a + b; }
export function g(xs: array<f32, 2>, ys: array<f32, 2>): array<f32, 2> { return zip(xs, ys, f32); }
`,
      'f32',
    ],
    [
      'an array method',
      '"xs.map"',
      `"use typeshade";
function u32(x: f32): f32 { return x * 100.; }
export function g(xs: array<f32, 2>): array<f32, 2> { return xs.map(u32); }
`,
      'u32',
    ],
    [
      'a function that takes one',
      '"apply"',
      `"use typeshade";
function vec3(a: f32): f32 { return a; }
function apply(f: (a: f32) => f32, x: f32): f32 { return f(x); }
export function g(x: f32): f32 { return apply(vec3, x); }
`,
      'vec3',
    ],
  ])(
    'refuses %s handed one, since a call of it would be the constructor',
    (_what, taker, source, name) => {
      const errors = compile(source).diagnostics.filter((d) => d.category === 'error');
      expect(errors.map((d) => `${d.code} ${d.message}`)).toEqual([
        expect.stringContaining(
          `"${name}" is a value constructor, and a declared function of that name`,
        ),
      ]);
      expect(errors[0]!.message).toContain(
        `(Rule 9.5); ${taker} takes a function declared in this file`,
      );
      // The editor says what the compiler says, at the same word.
      expect(editorDiagnostics(source)).toEqual([
        `typeshade ${errors[0]!.code}: ${errors[0]!.message}`,
      ]);
    },
  );

  it('hands over a local function or a parameter of the name, which the body declares', () => {
    const source = `"use typeshade";
function apply(u32: (a: f32) => f32, x: f32): f32 { return u32(x); }
export function g(x: f32): f32 {
  const vec3 = (a: f32): f32 => a * 2.;
  const xs = array<f32, 2>(x, 1.);
  return sum(xs.map(vec3)) + apply(vec3, 5.) + apply((a: f32) => a + 1., 1.);
}
`;
    expect(errorsOf(compile(source))).toEqual([]);
    const c = compile(source);
    // (3 * 2 + 1 * 2) + 10 + 2
    for (const make of [compileModule, compileModuleJs]) {
      expect(make(c.module).fns.g!(3), make.name).toBe(8 + 10 + 2);
    }
    expect(editorDiagnostics(source)).toEqual([]);
  });
});

describe('a fold follows the call', () => {
  it('hands the declaration to zip, where the name is a builtin function', () => {
    // `zip(xs, ys, atan2)` was refused, because the intrinsic won the name and a fold has no
    // intrinsic-valued callback; the call `atan2(a, b)` reaches the declaration now, and so does
    // the fold, as `zip(xs, ys, fma)` beside a declared `fma` always did.
    const source = `"use typeshade";
function atan2(a: f32, b: f32): f32 { return a * 10. + b; }
export function g(xs: array<f32, 2>, ys: array<f32, 2>): array<f32, 2> { return zip(xs, ys, atan2); }
`;
    const c = compile(source);
    expect(errorsOf(c)).toEqual([]);
    for (const make of [compileModule, compileModuleJs]) {
      expect(make(c.module).fns.g!([1, 2], [3, 4]), make.name).toEqual([13, 24]);
    }
    expect(c.wgsl).toContain('atan2_(xs[0], ys[0])');
    expect(editorDiagnostics(source)).toEqual([]);
  });
});

describe('the declaration stands where TypeScript finds it', () => {
  // A namespace member wins inside its namespace and is no name outside it, a generic function is
  // found by the types it is called with, a function handed to a fold or to `map` by its name is
  // the declaration, and a local function or a parameter hides nothing outside the block or the
  // function that declares it. Each program is worked out by hand: the builtin of the name is the
  // other reading, and it gives another number.
  const CASES: readonly (readonly [string, string, readonly unknown[], number])[] = [
    [
      'a member of a namespace, inside it and by its qualified name',
      `"use typeshade";
namespace A {
  export function abs(x: f32): f32 { return x + 1000.; }
  export function g(x: f32): f32 { return abs(x); }
}
export function f(x: f32): f32 { return A.g(x) + abs(x - 10.) + A.abs(1.); }
`,
      [3],
      // 1003 inside, the builtin outside (|3 - 10| = 7), 1001 by the qualified name.
      1003 + 7 + 1001,
    ],
    [
      'a generic function, and the Math member of its name',
      `"use typeshade";
function max<T extends f32 | vec2>(a: T, b: T): T { return a; }
export function f(x: f32): f32 { return max(x, 9.) + max(vec2(x, 1.), vec2(0., 0.)).y + Math.max(x, 100.); }
`,
      [3],
      3 + 1 + 100,
    ],
    [
      'a function a fold is handed',
      `"use typeshade";
function max(a: f32, b: f32): f32 { return a * 10. + b; }
export function f(x: f32): f32 {
  const xs = array<f32, 2>(x, 2.);
  const ys = array<f32, 2>(1., 2.);
  return sum(zip(xs, ys, max));
}
`,
      [3],
      31 + 22,
    ],
    [
      'a function `map` is handed by its name',
      `"use typeshade";
function abs(a: f32): f32 { return a * 2.; }
export function f(x: f32): f32 { const xs = array<f32, 2>(x, 2.); return sum(xs.map(abs)); }
`,
      [3],
      6 + 4,
    ],
    [
      'a local function of another block, which hides nothing outside it',
      `"use typeshade";
function sin(x: f32): f32 { return x + 7.; }
export function f(x: f32): f32 {
  let r = sin(x);
  if (x > 100.) { const cos = (a: f32): f32 => a; r = cos(x); }
  return r + cos(0.);
}
`,
      [3],
      // The module's `sin` (10), and WGSL's `cos(0)` (1) outside the block that declares `cos`.
      10 + 1,
    ],
    [
      'a parameter that takes a function, beside a function of the module',
      `"use typeshade";
function sin(x: f32): f32 { return x + 7.; }
export function f(x: f32): f32 {
  const g = (sin: (a: f32) => f32) => sin(x);
  return g((a: f32) => a * 2.) + sin(x);
}
`,
      [3],
      // The function handed over inside `g` (6), the module's `sin` outside it (10).
      6 + 10,
    ],
    [
      'a method of the name, which the call of a method never reaches',
      `"use typeshade";
class V { v: f32; min(o: f32): f32 { return this.v - o; } }
function min(a: f32, b: f32): f32 { return a + b; }
export function f(x: f32): f32 { const v: V = { v: x }; return v.min(1.) + min(x, 2.) + Math.min(x, 1.); }
`,
      [3],
      2 + 5 + 1,
    ],
  ];

  it.each(CASES)('%s', (_what, source, args, want) => {
    const c = compile(source);
    expect(errorsOf(c)).toEqual([]);
    for (const make of [compileModule, compileModuleJs]) {
      const f = make(c.module).fns.f as (...a: unknown[]) => unknown;
      expect(f(...args), make.name).toBe(want);
    }
    expect(editorDiagnostics(source)).toEqual([]);
  });
});

describe('every builtin function a file can call', () => {
  // The name of each builtin function `lowerCall` resolves, read from the tables it resolves
  // through (`builtinCalleeNames`): a name of `Math`, WGSL's built-in functions, and the extensions
  // that are functions. `mod` is refused for what it is in WGSL, a reserved word, before any
  // question of precedence arises.
  const NAMES = builtinCalleeNames().filter((n) => !isValueConstructor(n) && n !== 'mod');

  it('reads a scan that has something to scan', () => {
    expect(NAMES.length).toBeGreaterThan(100);
    for (const name of ['fract', 'pow', 'min', 'select', 'random', 'sum', 'fill', 'exp2', 'dpdx']) {
      expect(NAMES, name).toContain(name);
    }
    expect(NAMES).not.toContain('f32');
    expect(NAMES).not.toContain('vec3');
    expect(
      compile(`"use typeshade";\nfunction mod(x: f32): f32 { return x; }\n`).diagnostics,
    ).not.toEqual([]);
  });

  const source = (name: string): string => `"use typeshade";
export function ${name}(x: f32): f32 { return x + 99.; }
export function g(): f32 { return ${name}(1.); }
class Color {
  @location(0) color: vec4;
}
@fragment
export function fs(@builtin("position") p: vec4): Color {
  const v = ${name}(p.x);
  return { color: vec4(v, v, v, 1.) };
}
`;

  // WGSL's own names, from the specification (the baked fixture of `spec-conformance`), not from
  // the list the writer renames by: what the target predeclares is what the module may not hide.
  const wgslNames = JSON.parse(
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../core/spec-conformance/fixtures/wgsl-names.json',
      ),
      'utf8',
    ),
  ) as { builtinFunctions: { names: string[] } };
  const WGSL_BUILTINS = new Set(wgslNames.builtinFunctions.names);

  it.each(NAMES)(
    '%s: the declaration wins in the front end, on the CPU and in both writers',
    (name) => {
      const c = compile(source(name));
      expect(errorsOf(c)).toEqual([]);
      for (const make of [compileModule, compileModuleJs]) {
        expect(make(c.module).fns.g!(), make.name).toBe(100);
      }
      const wgsl = c.wgsl ?? '';
      if (WGSL_BUILTINS.has(name)) {
        expect(wgsl).toContain(`fn ${name}_(x: f32) -> f32 {`);
        expect(wgsl).toContain(`return ${name}_(1.0);`);
      }
      // No declared function of the module hides a builtin function of WGSL, whatever its name.
      for (const [, declared] of wgsl.matchAll(/^fn (\w+)\(/gm)) {
        expect(WGSL_BUILTINS.has(declared!), declared).toBe(false);
      }
      const fragment = c.glsl?.fragment ?? '';
      expect(fragment).toMatch(new RegExp(`float ${name}_?\\(float x\\) \\{`));
    },
  );

  it('is read the same way by the editor: one document that declares and calls every one', () => {
    // One document, so the editor's program is built once; a diagnostic names the line, which is
    // the function it is about.
    const body = NAMES.map((n) => `export function ${n}(x: f32): f32 { return x + 99.; }`).join(
      '\n',
    );
    const calls = NAMES.map(
      (n, i) => `export function g${String(i)}(): f32 { return ${n}(1.); }`,
    ).join('\n');
    const one = `"use typeshade";\n${body}\n${calls}\n`;
    const lines = one.split('\n');
    const named = (text: string): string => {
      const line = /:(\d+)/.exec(text);
      return line === null ? text : `${text} — ${lines[Number(line[1]) - 1] ?? ''}`;
    };
    expect(errorsOf(compile(one))).toEqual([]);
    expect(editorDiagnostics(one).map(named)).toEqual([]);
  });
});

describe('an entry point named like something WGSL predeclares (Rule 3.2)', () => {
  // A writer renames a module function whose name its target predeclares, and never an entry
  // point: the host creates the pipeline by the name written. WGSL hides the predeclared name in
  // the whole module beside a module-scope `fn fract`, so the `fract` that `random(p)` expands to
  // called the entry, a `fn f32` hid the type that `array<f32>` spells, and a `fn read` the access
  // mode of a read-only storage binding. Each module reached Tint with no diagnostic. An entry
  // named `step` in a module whose WGSL never spells `step` is a program Tint accepts, and stays
  // one (Rule 13.3). GLSL ES 3.00 spells every entry `main`, and adds no refusal.
  const REFUSED: readonly [name: string, source: string][] = [
    [
      'fract',
      `"use typeshade";
declare const out: storage<array<f32>, "read_write">;
@compute([1])
export function fract() { out[0] = random(out[1]); }
`,
    ],
    [
      'f32',
      `"use typeshade";
declare const out: storage<array<f32>, "read_write">;
@compute([1])
export function f32() { out[0] = out[1] + 1.; }
`,
    ],
    [
      'read',
      `"use typeshade";
declare const src: storage<array<f32>>;
declare const out: storage<array<f32>, "read_write">;
@compute([1])
export function read() { out[0] = src[0]; }
`,
    ],
  ];
  const refusal = (name: string): string =>
    `TS8068 "${name}" is predeclared in WGSL, and this module's WGSL uses it, so an entry point of that name, which is emitted under the name written, would hide it for the WebGPU target. Rename it.`;

  it.each(REFUSED)('refuses an entry named %s at its name, and emits no WGSL', (name, source) => {
    const c = compile(source);
    expect(errorsOf(c)).toEqual([refusal(name)]);
    const d = c.diagnostics.find((x) => x.code === 'TS8068')!;
    expect(source.slice(d.start, d.start + d.length)).toBe(name);
    expect(c.wgsl).toBeUndefined();
  });

  it.each(REFUSED)('is refused by the editor in the same words, entry %s', (name, source) => {
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', source);
    const errors = service
      .getDiagnostics('a.ts')
      .filter((d) => d.severity === 'error')
      .map((d) => `${String(d.code)} ${d.message}`);
    expect(errors).toEqual([refusal(name)]);
  });

  it('leaves an entry alone whose name the module never uses, as Tint does', () => {
    const source = `"use typeshade";
declare const out: storage<array<f32>, "read_write">;
@compute([1])
export function step() { out[0] = out[1] + 1.; }
`;
    const c = compile(source);
    expect(errorsOf(c)).toEqual([]);
    expect(c.wgsl).toContain('fn step() {');
    expect(editorDiagnostics(source)).toEqual([]);
  });

  it('leaves a helper of the name alone, which the writers rename', () => {
    const c = compile(`"use typeshade";
declare const out: storage<array<f32>, "read_write">;
function fract(x: f32): f32 { return x; }
@compute([1])
export function main() { out[0] = fract(out[1]); }
`);
    expect(errorsOf(c)).toEqual([]);
    expect(c.wgsl).toContain('fn fract_(x: f32) -> f32 {');
  });
});

describe('a declaration named like a stage-restricted builtin is no such builtin', () => {
  // `dpdx` is a fragment-only builtin, and the front end refused a call of the name from a
  // compute or a vertex entry by the call's name. Beside a declared `dpdx` the call reaches the
  // declaration, which differences nothing, so the call is the file's own function on every stage.
  const COMPUTE = `"use typeshade";
declare const out: storage<array<f32>, "read_write">;
function dpdx(x: f32): f32 { return x * 2.; }
@compute([1])
export function main() { out[0] = dpdx(out[1]); }
`;

  it('calls the declaration from a compute entry, in the compiler and in the editor', () => {
    const c = compile(COMPUTE);
    expect(errorsOf(c)).toEqual([]);
    expect(c.wgsl).toContain('out[0] = dpdx_(out[1]);');
    const cm = compileModule(c.module);
    const out = [0, 1.5];
    cm.setBinding('out', out);
    cm.fns.main!();
    expect(out[0]).toBe(3);
    expect(editorDiagnostics(COMPUTE)).toEqual([]);
  });
});
