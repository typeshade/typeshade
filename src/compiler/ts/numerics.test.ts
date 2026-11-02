// Verifies: Rule 6.7, Rule 11.22 (docs/language-design.md; traced in reqs/).
// ═══ A numerical contract, opted into per function (change 0107, surface §78) ═══
//
// `numerics([...], f)` and a stage call's `numerics` option set `FuncDecl.numerics`; a wrong
// list, and the call anywhere but as a top-level `const`'s initializer, is `TS8078`. Each case
// reads both halves: compile() and the language service on the same source (Rule 12.7).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { TS_CODES } from './codes.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const source = (body: string): string => `"use typeshade";\n${body}\n`;

/** The compiler's and the editor's diagnostics of one source, which must be the same list. */
function bothHalves(body: string): { compiled: string[]; result: ReturnType<typeof compile> } {
  const src = source(body);
  const result = compile(src, { fileName: 'num.shade.ts' });
  const compiled = result.diagnostics.map((d) => `${d.code} ${d.message}`);
  const service = createTypeshadeLanguageService();
  service.openDocument('num.shade.ts', src);
  const edited = service
    .getDiagnostics('num.shade.ts')
    .map((d) => `${String(d.code)} ${d.message}`);
  expect(edited, 'the editor reads the program as the compiler does').toEqual(compiled);
  return { compiled, result };
}

const numericsOf = (result: ReturnType<typeof compile>, name: string) =>
  result.module?.funcs.find((f) => f.name === name)?.numerics;

const NT = TS_CODES.NUMERICS;
const CALL = 'const f = numerics(["finite-math"], function f(…) { … })';
const OPTION = '{ numerics: ["finite-math"] }';

describe('numerics opts a function in (change 0107)', () => {
  it('reads the call on a function of the file and the option on an entry', () => {
    const { compiled, result } =
      bothHalves(`const g = numerics(["finite-math"], function g(x: f32): f32 {
  return x + 1.;
});
const h = numerics(["finite-math", "reassociate"], (x: f32): f32 => x * 2.);
function plain(x: f32): f32 {
  return x - 1.;
}
export const fs = fragment(function fs(p: builtin<"position", vec4f>): vec4f {
  return vec4f(g(p.x), h(p.y), plain(p.z), 1.);
}, { numerics: ["reassociate"] });`);
    expect(compiled).toEqual([]);
    expect(numericsOf(result, 'g')).toEqual(['finite-math']);
    expect(numericsOf(result, 'h')).toEqual(['finite-math', 'reassociate']);
    expect(numericsOf(result, 'plain')).toBeUndefined();
    expect(numericsOf(result, 'fs')).toEqual(['reassociate']);
    // `numerics` is no WGSL attribute: nothing in the emitted text names it.
    expect(result.wgsl).not.toContain('numerics');
    expect(result.wgsl).toMatch(/fn g\(/);
  });

  it('reads the option on a kernel function beside its workgroup size', () => {
    const { compiled, result } =
      bothHalves(`export const scale = workgroup_size([128], function scale(xs: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    xs[i] = xs[i] * 2.;
  }
}, { numerics: ["finite-math"] });`);
    expect(compiled).toEqual([]);
    expect(numericsOf(result, 'scale')).toEqual(['finite-math']);
  });
});

describe('what TS8078 refuses (change 0107)', () => {
  it('refuses an unknown class, a repeated one, an empty list and a list of no strings', () => {
    const { compiled, result } =
      bothHalves(`const g = numerics(["fast", "finite-math"], function g(x: f32): f32 { return x; });
const h = numerics(["finite-math", "finite-math"], function h(x: f32): f32 { return x; });
const k = numerics([], function k(x: f32): f32 { return x; });
const m = numerics("finite-math", function m(x: f32): f32 { return x; });
export const fs = fragment(function fs(): vec4f {
  return vec4f(g(1.), h(1.), k(1.), m(1.));
}, { numerics: ["reassociate", 3] });`);
    expect(compiled).toEqual([
      `${NT} "fast" is not a numerics class. The classes are "finite-math" and "reassociate".`,
      `${NT} "finite-math" is named twice in this numerics list. Name each class once.`,
      `${NT} An empty numerics list opts into nothing. Name a class: "finite-math" or "reassociate".`,
      `${NT} numerics takes an array of class names, as strings: ${CALL}.`,
      `${NT} numerics takes an array of class names, as strings: ${OPTION}.`,
    ]);
    expect(result.wgsl).toBeUndefined();
  });

  it('refuses the call anywhere but as the initializer of a top-level const, once', () => {
    const misplaced =
      `${NT} numerics(...) wraps a function declared at the top of the file: ${CALL}. An entry ` +
      `or a kernel function takes ${OPTION} as its stage call's option.`;
    const { compiled } = bothHalves(`export function e(x: f32): f32 {
  const q = numerics(["finite-math"], (y: f32): f32 => y);
  return q(x);
}
namespace N {
  export const n = numerics(["finite-math"], function n(x: f32): f32 { return x; });
}
const w = 1. + numerics(["finite-math"], function w(x: f32): f32 { return x; })(2.);`);
    expect(compiled.filter((d) => d.startsWith(NT))).toEqual([misplaced, misplaced, misplaced]);
  });

  it('refuses a @numerics decorator as TS8028, like any decorator outside Rule 6.7', () => {
    const { compiled } = bothHalves(`@numerics(["finite-math"])
function g(x: f32): f32 {
  return x;
}`);
    expect(compiled).toHaveLength(1);
    expect(
      compiled[0]!.startsWith(`${TS_CODES.ATTRIBUTE_NAME} Unknown attribute "@numerics".`),
    ).toBe(true);
  });

  it('takes "numerics" and "diagnostic" as a stage call\'s two options, and no other', () => {
    const { compiled } = bothHalves(`export const fs = fragment(function fs(): vec4f {
  return vec4f(1.);
}, { numerics: ["finite-math"], fast: true });`);
    expect(compiled).toEqual([
      `${TS_CODES.ATTRIBUTE_NAME} A stage call takes two options, "diagnostic" and "numerics"; "fast: true" is not one.`,
    ]);
  });
});
