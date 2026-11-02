// A `const` binds `Math` members to short names (change 0113): `const { sqrt, PI } = Math`,
// `const { sqrt: s } = Math` and `const s = Math.sqrt`, at module scope and in a function.
//
// A bound name is an alias (Rule 9.4): a call is the member's call, a constant member is its
// inlined `f32` literal, and nothing new is emitted on WGSL, GLSL or the CPU oracle. A bound name
// is a declaration of the file, so it hides a builtin of its name in its scope (Rule 9.5), and a
// vector handed to a bound `sqrt` is refused with the sentence that names the fix.
//
// Every row reads both halves of the same source (Rule 12.7): `compile()`, its diagnostics (code
// and text) or its emit and the oracle's values, and the language service's `getDiagnostics`,
// with `getHover` where the type is the point.
//
// Verifies: Rule 6.3, Rule 9.4, Rule 9.5 (docs/language-design.md; traced in reqs/).
// Change 0113.

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

/** The editor's diagnostics of `source`, as `source code: text`. */
function editorOf(source: string): readonly string[] {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', source);
  return service.getDiagnostics('a.ts').map((d) => `${d.source} ${String(d.code)}: ${d.message}`);
}

/** The compiler's error diagnostics of `source`, as `source code: text`, in the editor's shape. */
function compilerOf(source: string): readonly string[] {
  return compile(source)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `typeshade ${d.code}: ${d.message}`);
}

/** Both halves take `source`: no diagnostic from `compile()` or from the editor. */
function bothTake(source: string): ReturnType<typeof compile> {
  const c = compile(source);
  expect(c.diagnostics, 'compile()').toEqual([]);
  expect(editorOf(source), 'the editor').toEqual([]);
  return c;
}

/** Both halves refuse `source` with the one sentence, under the one code (Rule 12.5). */
function bothRefuse(source: string, code: string, text: string): void {
  const want = `typeshade ${code}: ${text}`;
  expect(compilerOf(source), 'compile()').toEqual([want]);
  expect(editorOf(source), 'the editor').toEqual([want]);
}

const fn = (body: string, params = 'x: f32', ret = 'f32'): string =>
  `"use typeshade";\nexport function f(${params}): ${ret} {\n  ${body}\n}\n`;

const LET_SENTENCE = (member: string): string =>
  `"Math.${member}" is a function, and a shader has no function values: bind it with const, ` +
  `const { ${member} } = Math. A let would hold a function value.`;

describe('a const binds Math members, and the emit is the Math.member spelling', () => {
  const written = `"use typeshade";
export function f(x: f32): f32 { return Math.sqrt(Math.abs(x)) + Math.sin(x) * Math.PI; }
`;

  it('takes a module-scope pattern, with the same WGSL, GLSL and values', () => {
    const bound = bothTake(`"use typeshade";
const { sqrt, sin, PI } = Math;
export function f(x: f32): f32 { return sqrt(Math.abs(x)) + sin(x) * PI; }
`);
    const base = compile(written);
    expect(bound.wgsl).toBe(base.wgsl);
    expect(bound.glsl).toEqual(base.glsl);
    for (const x of [-2, 0, 0.5, 4]) expect(bound.eval('f', [x])).toBe(base.eval('f', [x]));
  });

  it('takes a pattern in a function body, with a rename', () => {
    const bound = bothTake(
      fn('const { sqrt: s, abs: a, sin, PI } = Math;\n  return s(a(x)) + sin(x) * PI;'),
    );
    expect(bound.wgsl).toBe(compile(written).wgsl);
    expect(bound.glsl).toEqual(compile(written).glsl);
  });

  it('takes a const of one member, at module scope and in a function', () => {
    const module = bothTake(`"use typeshade";
const s = Math.sqrt;
export function f(x: f32): f32 { return s(x); }
`);
    const local = bothTake(fn('const s = Math.sqrt;\n  return s(x);'));
    const base = compile(fn('return Math.sqrt(x);'));
    expect(module.wgsl).toBe(base.wgsl);
    expect(local.wgsl).toBe(base.wgsl);
    expect(local.glsl).toEqual(base.glsl);
  });

  it('reads a constant member as its inlined f32 literal, and no module constant is declared', () => {
    const bound = bothTake(`"use typeshade";
const { PI, SQRT1_2: r } = Math;
export function f(x: f32): f32 { return x * PI + r; }
`);
    const base = compile(`"use typeshade";
export function f(x: f32): f32 { return x * Math.PI + Math.SQRT1_2; }
`);
    expect(bound.wgsl).toBe(base.wgsl);
    expect(bound.wgsl).not.toContain('const PI');
    expect(bound.glsl).toEqual(base.glsl);
  });

  it('gives the member values on the oracle and in the generated JavaScript', () => {
    const r = bothTake(`"use typeshade";
const { sqrt, atan2, log10, PI } = Math;
export function f(x: f32): f32 { return sqrt(x) * PI + atan2(x, 2.) + log10(x); }
`);
    const f64 = compileModule(r.module).fns;
    const js = compileModuleJs(r.module).fns;
    for (const x of [1, 4, 9.5]) {
      const want = Math.sqrt(x) * Math.PI + Math.atan2(x, 2) + Math.log10(x);
      expect(r.eval('f', [x]), `eval(${String(x)})`).toBeCloseTo(want, 12);
      expect(f64['f']!(x), `oracle(${String(x)})`).toBeCloseTo(want, 12);
      expect(js['f']!(x), `js(${String(x)})`).toBeCloseTo(want, 12);
    }
  });

  it('takes an expansion, and random, as the member does', () => {
    const r = bothTake(`"use typeshade";
const { cbrt, hypot } = Math;
export function f(x: f32): f32 { return cbrt(x) + hypot(x, 3.); }
`);
    expect(r.eval('f', [-8])).toBeCloseTo(Math.cbrt(-8) + Math.hypot(-8, 3), 12);
  });

  it('keeps a scope: a block, a parameter and a local of the name are their own', () => {
    // `sqrt` is a parameter of `g`, so `sqrt(x)` there is not the bound alias; in `f` it is.
    const r = bothTake(`"use typeshade";
const { abs } = Math;
function g(abs: f32): f32 { return abs * 2.; }
export function f(x: f32): f32 { return abs(x) + g(x); }
`);
    expect(r.eval('f', [-3])).toBe(3 + -6);
  });

  it('reads a name bound in a block only in that block', () => {
    bothTake(fn('if (x > 0.) {\n    const { PI } = Math;\n    return PI;\n  }\n  return 0.;'));
  });
});

describe('the editor types a bound name as the member', () => {
  it('hovers a bound function and a bound constant as the member the checker gives them', () => {
    const source = `"use typeshade";
const { sqrt, PI } = Math;
export function f(x: f32): f32 { return sqrt(x) * PI; }
`;
    bothTake(source);
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', source);
    const at = (needle: string): string =>
      service.getHover('a.ts', service.positionAt('a.ts', source.lastIndexOf(needle) + 1))
        ?.contents ?? '';
    expect(at('sqrt(x)')).toContain('(x: number) => number');
    expect(at('PI;')).toContain('number');
  });
});

describe('a bound name hides the builtin of its name (Rule 9.5)', () => {
  const OPEN = (member: string, written: string, fix: string): string =>
    `"${written}" here is Math.${member}, which takes a scalar; ${fix}.`;

  it('refuses sqrt(v) on a vector, in both halves, with the sentence that names the fix', () => {
    const source = `"use typeshade";
const { sqrt } = Math;
export function f(v: vec3): vec3 { return sqrt(v); }
`;
    bothRefuse(
      source,
      'TS8003',
      OPEN(
        'sqrt',
        'sqrt',
        'leave sqrt out of the pattern to call the builtin, which takes a vector',
      ),
    );
  });

  it('refuses it in a function body, and for a rename', () => {
    bothRefuse(
      fn('const { sqrt } = Math;\n  return sqrt(v);', 'v: vec3', 'vec3'),
      'TS8003',
      OPEN(
        'sqrt',
        'sqrt',
        'leave sqrt out of the pattern to call the builtin, which takes a vector',
      ),
    );
    bothRefuse(
      fn('const { sqrt: s } = Math;\n  return s(v);', 'v: vec3', 'vec3'),
      'TS8003',
      OPEN('sqrt', 's', 'call the builtin sqrt, which takes a vector'),
    );
    bothRefuse(
      fn('const s = Math.sqrt;\n  return s(v);', 'v: vec3', 'vec3'),
      'TS8003',
      OPEN('sqrt', 's', 'call the builtin sqrt, which takes a vector'),
    );
  });

  it('keeps the builtin where the name is not bound, and a vector min and max where it is', () => {
    const r = bothTake(`"use typeshade";
const { abs, min } = Math;
export function f(v: vec3): vec3 { return sqrt(v) + min(v, 1.) + vec3(abs(v.x)); }
`);
    expect(r.wgsl).toContain('sqrt(');
  });

  it('lets a function that binds the name leave it to the builtin elsewhere', () => {
    bothTake(`"use typeshade";
function g(x: f32): f32 { const { sqrt } = Math; return sqrt(x); }
export function f(v: vec3): vec3 { return sqrt(v) + g(v.x); }
`);
  });
});

describe('what stays refused', () => {
  it('a let of a function member', () => {
    bothRefuse(fn('let { sqrt } = Math;\n  return sqrt(x);'), 'TS8099', LET_SENTENCE('sqrt'));
    bothRefuse(fn('let s = Math.sqrt;\n  return s(x);'), 'TS8099', LET_SENTENCE('sqrt'));
    bothRefuse(
      `"use typeshade";\nlet { sin } = Math;\nexport function f(x: f32): f32 { return sin(x); }\n`,
      'TS8099',
      LET_SENTENCE('sin'),
    );
  });

  it('a let of a constant member copies the number, as let p = Math.PI does', () => {
    const r = bothTake(fn('let { PI } = Math;\n  PI = PI * 2.;\n  return x * PI;'));
    expect(r.eval('f', [1])).toBeCloseTo(Math.PI * 2, 6);
    bothTake(fn('let p = Math.PI;\n  p = p * 2.;\n  return x * p;'));
  });

  it('a rest element', () => {
    bothRefuse(
      fn('const { sqrt, ...r } = Math;\n  return sqrt(x);'),
      'TS8099',
      'A rest element has no shader form: Math has no remainder to name. Bind the members you call.',
    );
  });

  it('a default', () => {
    bothRefuse(
      fn('const { sqrt = Math.abs } = Math;\n  return sqrt(x);'),
      'TS8099',
      'A default in a pattern has no shader form: every member of Math is present, so there is ' +
        'nothing for it to stand in for.',
    );
  });

  it('a member Math does not have', () => {
    bothRefuse(
      fn('const { foo } = Math;\n  return x;'),
      'TS8022',
      '"Math.foo" is not a TypeShade alias.',
    );
  });

  it('an assignment pattern', () => {
    const source = fn('let s: f32 = 0.;\n  ({ s } = Math);\n  return s;');
    expect(compilerOf(source).map((d) => d.slice(0, 16))).toEqual(['typeshade TS8099']);
    expect(editorOf(source).some((d) => d.startsWith('typeshade TS8099'))).toBe(true);
  });

  it('an export of a bound member', () => {
    const text =
      '"sqrt" binds a Math member, which a module does not export. Write the const in each ' +
      'module that calls it.';
    bothRefuse(
      `"use typeshade";\nexport const { sqrt } = Math;\nexport function f(x: f32): f32 { return sqrt(x); }\n`,
      'TS8014',
      text,
    );
  });

  it('a member handed as a function, and a bound name read as a value', () => {
    const handed = `"use typeshade";
function ap(g: (x: f32) => f32, x: f32): f32 { return g(x); }
export function f(x: f32): f32 { return ap(Math.sqrt, x); }
`;
    const c = compilerOf(handed);
    expect(c).toHaveLength(1);
    expect(c[0]).toContain('typeshade TS8099');
    expect(editorOf(handed)).toEqual(c);
    const value = fn('const { sqrt } = Math;\n  const g = sqrt;\n  return x;');
    expect(compilerOf(value)[0]).toBe(
      'typeshade TS8099: "sqrt" is Math.sqrt, a function alias. Call it.',
    );
    expect(editorOf(value)[0]).toContain('typeshade TS8099');
  });

  it('console and a struct keep the sentences they had', () => {
    const c = fn('const { log } = console;\n  return x;');
    expect(compilerOf(c)[0]).toContain('typeshade TS8022: "console" is an object of functions');
    expect(editorOf(c)[0]).toContain('typeshade TS8022: "console" is an object of functions');
  });
});
