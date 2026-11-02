// Verifies: Rule 9.9 (docs/language-design.md; traced in reqs/).

// A name an ECMAScript spelling carries in every case is not authorable (Rule 9.9). Each removed
// spelling is read through both halves on one source (CLAUDE.md, "A test reads both halves"):
// `compile()`'s diagnostic, code and sentence, and the language service's `getDiagnostics`, which
// merges the compiler's report with TypeScript's. Each replacement is read the same way, clean in
// both, and its emit and its CPU result are held to what the removed spelling computed.

import { describe, expect, it } from 'vitest';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { SHADE_DTS } from '../../language-service/ambient.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { compile } from './compile.js';
import { TS_CODES } from './codes.js';
import {
  REMOVED_CALLS,
  REMOVED_CONSTANTS,
  isRemovedCall,
  isRemovedConstant,
} from './removed-names.js';

/** One entry-point program, with `decl` at module scope and `body` inside a fragment entry. */
const FS = (decl: string, body: string): string => `"use typeshade";
${decl}
@fragment
export function fs(@location(0) uv: vec2): vec4 {
${body}
}
`;

const XS = '  const xs: array<f32, 3> = [1., 2., 3.];\n';
const STORAGE = 'declare const xs: storage<array<f32>>;';

/** The errors `compile()` reports, as `code: message`. */
const compilerSays = (src: string): string[] =>
  compile(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${String(d.code)}: ${d.message}`);

/** The diagnostics of the language service from every source, as `source code: message`. */
const editorAll = (src: string): { source: string; text: string }[] => {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', src);
  return service
    .getDiagnostics('a.ts')
    .map((d) => ({ source: String(d.source), text: `${String(d.code)}: ${String(d.message)}` }));
};

/** What the editor says that TypeShade says: the compiler's own diagnostics, merged. */
const editorSays = (src: string): string[] =>
  editorAll(src)
    .filter((d) => d.source === 'typeshade')
    .map((d) => d.text);

describe('a removed call is refused on both halves, with the spelling to write', () => {
  const calls: readonly (readonly [string, string, string])[] = [
    [
      'arrayLength',
      FS(STORAGE, '  return vec4(f32(arrayLength(xs)), 0., 0., 1.);'),
      `${TS_CODES.UNKNOWN_FN}: arrayLength was removed: write xs.length.`,
    ],
    [
      'pow',
      FS('', '  return vec4(pow(uv.x, 2.), 0., 0., 1.);'),
      `${TS_CODES.UNKNOWN_FN}: pow was removed: write a ** b.`,
    ],
    [
      'log10',
      FS('', '  return vec4(log10(uv.x), 0., 0., 1.);'),
      `${TS_CODES.UNKNOWN_FN}: log10 was removed: write Math.log10.`,
    ],
    [
      'log1p',
      FS('', '  return vec4(log1p(uv.x), 0., 0., 1.);'),
      `${TS_CODES.UNKNOWN_FN}: log1p was removed: write Math.log1p.`,
    ],
    [
      'expm1',
      FS('', '  return vec4(expm1(uv.x), 0., 0., 1.);'),
      `${TS_CODES.UNKNOWN_FN}: expm1 was removed: write Math.expm1.`,
    ],
    [
      'cbrt',
      FS('', '  return vec4(cbrt(uv.x), 0., 0., 1.);'),
      `${TS_CODES.UNKNOWN_FN}: cbrt was removed: write Math.cbrt.`,
    ],
    [
      'hypot',
      FS('', '  return vec4(hypot(uv.x, uv.y), 0., 0., 1.);'),
      `${TS_CODES.UNKNOWN_FN}: hypot was removed: write Math.hypot.`,
    ],
    [
      'sum',
      FS('', `${XS}  return vec4(sum(xs), 0., 0., 1.);`),
      `${TS_CODES.UNKNOWN_FN}: sum was removed: write xs.reduce((a, b) => a + b).`,
    ],
    [
      'none',
      FS('', `${XS}  return vec4(none(xs, (x) => x > 1.) ? 1. : 0., 0., 0., 1.);`),
      `${TS_CODES.UNKNOWN_FN}: none was removed: write !xs.some(p).`,
    ],
  ];

  for (const [name, src, expected] of calls) {
    it(`${name}(...)`, () => {
      expect(compilerSays(src)).toEqual([expected]);
      // The editor says it once, in the compiler's words: TypeScript's own report of an unknown
      // name, and of the callback's parameter, is dropped for the compiler's sentence.
      expect(editorAll(src)).toEqual([{ source: 'typeshade', text: expected }]);
    });
  }

  it('every removed call is in the table, and no other name is', () => {
    expect(Object.keys(REMOVED_CALLS).sort()).toEqual(
      ['arrayLength', 'cbrt', 'expm1', 'hypot', 'log10', 'log1p', 'none', 'pow', 'sum'].sort(),
    );
    expect(calls.map(([name]) => name).sort()).toEqual(Object.keys(REMOVED_CALLS).sort());
  });
});

describe('a removed constant is refused on both halves, with the Math member to read', () => {
  for (const [name, member] of Object.entries(REMOVED_CONSTANTS)) {
    it(name, () => {
      const src = FS('', `  return vec4(${name}, 0., 0., 1.);`);
      const expected = `${TS_CODES.UNKNOWN_NAME}: ${name} was removed: write ${member}.`;
      expect(member).toBe(`Math.${name}`);
      expect(compilerSays(src)).toEqual([expected]);
      expect(editorAll(src)).toEqual([{ source: 'typeshade', text: expected }]);
    });
  }

  it('TAU stays, on both halves', () => {
    const src = FS('', '  return vec4(TAU, 0., 0., 1.);');
    expect(compilerSays(src)).toEqual([]);
    expect(editorAll(src)).toEqual([]);
    expect(compile(src).wgsl).toContain('6.2831');
  });

  it('is exactly the six', () => {
    expect(Object.keys(REMOVED_CONSTANTS)).toEqual(['PI', 'E', 'LN2', 'LN10', 'LOG2E', 'LOG10E']);
  });
});

describe('the array folds of any and all are refused with the arity code, and the fix', () => {
  const folds: readonly (readonly [string, string, string])[] = [
    [
      'any(xs, p)',
      `${XS}  return vec4(any(xs, (x) => x > 1.) ? 1. : 0., 0., 0., 1.);`,
      `${TS_CODES.ARITY_MISMATCH}: any expects 1 argument, got 2; the array fold was removed: write xs.some(p).`,
    ],
    [
      'all(xs, p)',
      `${XS}  return vec4(all(xs, (x) => x > 1.) ? 1. : 0., 0., 0., 1.);`,
      `${TS_CODES.ARITY_MISMATCH}: all expects 1 argument, got 2; the array fold was removed: write xs.every(p).`,
    ],
    [
      'any() with no argument',
      '  return vec4(any() ? 1. : 0., 0., 0., 1.);',
      `${TS_CODES.ARITY_MISMATCH}: any expects 1 argument, got 0.`,
    ],
  ];
  for (const [label, body, expected] of folds) {
    it(label, () => {
      const src = FS('', body);
      expect(compilerSays(src)).toEqual([expected]);
      expect(editorSays(src)).toEqual([expected]);
      // TypeScript's callback-parameter report is dropped, so the editor shows no second line.
      expect(editorAll(src).map((d) => d.source)).not.toContain('typescript 7006');
      expect(editorAll(src).filter((d) => d.text.startsWith('7006'))).toEqual([]);
    });
  }

  it('an array handed to any(xs) is a type mismatch that names the method', () => {
    const src = FS('', `${XS}  return vec4(any(xs) ? 1. : 0., 0., 0., 1.);`);
    const expected =
      `${TS_CODES.TYPE_MISMATCH}: any(v) takes a bool or a vector of bools, which a comparison of two ` +
      'vectors gives (§27); got array<f32, 3>. For an array, any(xs, p) was removed: write xs.some(p).';
    expect(compilerSays(src)).toEqual([expected]);
    expect(editorSays(src)).toContain(expected);
  });

  it('any(v) and all(v) on a bool and a bool vector stay, on both halves', () => {
    const src = FS(
      '',
      '  const m = uv > vec2(0.5);\n  return vec4(any(m) ? 1. : 0., all(m) ? 1. : 0., any(uv.x > 0.5) ? 1. : 0., 1.);',
    );
    expect(compilerSays(src)).toEqual([]);
    expect(editorAll(src)).toEqual([]);
    expect(compile(src).wgsl).toContain('any(');
  });
});

describe('a removed name is not declared by the ambient library', () => {
  const declared = (name: string): boolean =>
    new RegExp(`declare (function|const) ${name}\\b`).test(SHADE_DTS);

  it('declares none of the names, and still declares TAU, any and all', () => {
    for (const name of [...Object.keys(REMOVED_CALLS), ...Object.keys(REMOVED_CONSTANTS)]) {
      expect(declared(name), name).toBe(false);
    }
    expect(declared('TAU')).toBe(true);
    expect(declared('any')).toBe(true);
    expect(declared('all')).toBe(true);
    expect(SHADE_DTS).not.toMatch(/declare function (any|all)<T>\(xs/);
  });

  it('tells a removed name from a name the table does not hold', () => {
    expect(isRemovedCall('pow')).toBe(true);
    expect(isRemovedCall('atan2')).toBe(false);
    expect(isRemovedCall('any')).toBe(false);
    expect(isRemovedConstant('PI')).toBe(true);
    expect(isRemovedConstant('TAU')).toBe(false);
  });

  it('keeps Math.pow and the Math members of the removed free names', () => {
    const src = FS(
      '',
      '  return vec4(Math.pow(uv.x, 2.), Math.log10(uv.x), Math.hypot(uv.x, uv.y), Math.cbrt(uv.y));',
    );
    expect(compilerSays(src)).toEqual([]);
    expect(editorAll(src)).toEqual([]);
  });
});

describe('a name the file declares is the file own (Rule 9.5)', () => {
  const cases: readonly (readonly [string, string, string])[] = [
    ['sum', 'function sum(xs: array<f32, 3>): f32 { return xs[0] + xs[1]; }', 'sum(xs)'],
    ['pow', 'function pow(x: f32): f32 { return x * 3.; }', 'pow(uv.x)'],
    ['arrayLength', 'function arrayLength(x: f32): f32 { return x * 2.; }', 'arrayLength(uv.x)'],
    ['PI', 'const PI: f32 = 3.;', 'PI'],
  ];
  for (const [name, decl, use] of cases) {
    it(name, () => {
      const src = FS(decl, `${XS}  return vec4(${use}, 0., 0., 1.);`);
      expect(compilerSays(src)).toEqual([]);
      expect(editorAll(src)).toEqual([]);
    });
  }
});

describe('each replacement is clean on both halves and computes what the removed name did', () => {
  const clean = (src: string): void => {
    expect(compilerSays(src)).toEqual([]);
    expect(editorAll(src)).toEqual([]);
  };

  /** The oracle and the JavaScript CPU tier give the same value for `f(...args)`. */
  const valueOf = (src: string, ...args: number[]): number => {
    const r = compile(src);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const [a, b] = [compileModule, compileModuleJs].map((make) => {
      const cm = make(r.module);
      return (cm.fns['f'] as (...a: number[]) => number)(...args);
    });
    expect(b).toBe(a);
    return a as number;
  };

  const FN = (params: string, body: string): string =>
    `"use typeshade";\nexport function f(${params}): f32 {\n${body}\n}\n`;

  it('xs.length is the read arrayLength(xs) was, and lowers to the same builtin', () => {
    const kernel = (read: string): string => `"use typeshade";
declare const src: storage<array<f32>>;
declare const dst: storage<array<f32>, "read_write">;
@compute([64, 1, 1])
export function main_k(@builtin("global_invocation_id") gid: vec3u): void {
  if (gid.x >= ${read}) {
    return;
  }
  dst[gid.x] = src[gid.x] * 2.;
}
`;
    clean(kernel('src.length'));
    expect(compile(kernel('src.length')).wgsl).toContain('if ((gid.x >= arrayLength(&src))) {');
    const cm = compileModule(compile(kernel('src.length')).module);
    const dst = [0, 0, 0, 0];
    cm.setBinding('src', [1, 2, 3]);
    cm.setBinding('dst', dst);
    for (let g = 0; g < 4; g++) cm.fns['main_k']!([g, 0, 0]);
    expect(dst).toEqual([2, 4, 6, 0]);
  });

  it('a ** b is pow(a, b), for a scalar and for a vector', () => {
    const scalar = FN('a: f32, b: f32', '  return a ** b;');
    clean(scalar);
    expect(compile(scalar).wgsl).toContain('pow(a, b)');
    expect(valueOf(scalar, 2, 3)).toBe(8);
    expect(valueOf(scalar, 9, 0.5)).toBe(3);
    const vector = `"use typeshade";\nexport function f(a: vec3, b: vec3): vec3 {\n  return a ** b;\n}\n`;
    clean(vector);
    expect(compile(vector).wgsl).toContain('pow(a, b)');
  });

  it('a ** b keeps the shapes pow(a, b) refused: a vector beside a scalar, on both halves', () => {
    // Tint refuses `pow(vec3<f32>, f32)`, and so did the free name; `**` says so in one sentence.
    const src = `"use typeshade";\nexport function f(a: vec3, s: f32): vec3 {\n  return a ** s;\n}\n`;
    const expected = `${TS_CODES.TYPE_MISMATCH}: Type mismatch: cannot ** vec3 and f32. ** is pow(a, b), which takes two values of one type; splat the exponent, e.g. v ** vec3(2.).`;
    expect(compilerSays(src)).toEqual([expected]);
    expect(editorSays(src)).toEqual([expected]);
  });

  it('Math.PI, E, LN2, LN10, LOG2E and LOG10E read the value the free name did', () => {
    for (const name of ['PI', 'E', 'LN2', 'LN10', 'LOG2E', 'LOG10E'] as const) {
      const src = FN('x: f32', `  return Math.${name} * x;`);
      clean(src);
      expect(valueOf(src, 1)).toBeCloseTo(Math[name], 6);
    }
  });

  it('Math.log10, log1p, expm1, cbrt and hypot compute the expansion the free name had', () => {
    const one = (name: string): string => FN('x: f32', `  return Math.${name}(x);`);
    for (const name of ['log10', 'log1p', 'expm1', 'cbrt'] as const) clean(one(name));
    expect(valueOf(one('log10'), 100)).toBeCloseTo(2, 5);
    expect(valueOf(one('log1p'), 1)).toBeCloseTo(Math.LN2, 5);
    expect(valueOf(one('expm1'), 1)).toBeCloseTo(Math.E - 1, 5);
    expect(valueOf(one('cbrt'), -8)).toBeCloseTo(-2, 5);
    const hypot = FN('a: f32, b: f32', '  return Math.hypot(a, b);');
    clean(hypot);
    expect(valueOf(hypot, 3, 4)).toBeCloseTo(5, 5);
  });

  it('xs.reduce((a, b) => a + b) adds in the order sum(xs) did, and the oracle agrees', () => {
    const src = FN(
      'a: f32, b: f32',
      '  const xs: array<f32, 4> = [a, b, 1., 1.];\n  return xs.reduce((p, q) => p + q);',
    );
    clean(src);
    expect(valueOf(src, 1, 2)).toBe(5);
    // The order is the unrolled left fold, (((a + b) + 1) + 1), so a sum that depends on it agrees.
    // The oracle adds in f64, so the witness is one where f64 addition is not associative.
    expect(valueOf(src, 1e16, 1)).toBe(1e16 + 1 + 1 + 1);
    expect(1e16 + 1 + 1 + 1).not.toBe(1e16 + (1 + 1 + 1));
  });

  it('xs.some(p), xs.every(p) and !xs.some(p) answer what any, all and none did', () => {
    const body = (expr: string): string =>
      FN('k: f32', `  const xs: array<f32, 3> = [1., 2., 3.];\n  return ${expr} ? 1. : 0.;`);
    const some = body('xs.some((x) => x > k)');
    const every = body('xs.every((x) => x > k)');
    const none = body('!xs.some((x) => x > k)');
    for (const src of [some, every, none]) clean(src);
    expect([valueOf(some, 2), valueOf(some, 3)]).toEqual([1, 0]);
    expect([valueOf(every, 0), valueOf(every, 1)]).toEqual([1, 0]);
    expect([valueOf(none, 2), valueOf(none, 3)]).toEqual([0, 1]);
  });
});
