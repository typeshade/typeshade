// Two `pow` refusals said something false (#616).
//
//   1. `pow(x, n)` with an `f32` `x` and an `i32` `n` offered "Cast one side: f32(x) or i32(x)".
//      `pow` has no integer form in WGSL or GLSL ES 3.00, so the author who took the second
//      cast wrote `pow(i32(x), n)` and got the next TS8036. A builtin with no integer form now
//      offers the one cast that fixes the call, on the argument as written: `f32(n)`.
//   2. `x ** 2` on an `i32` said that WGSL defines `pow` "for f32 only". WGSL defines it for
//      AbstractFloat, f32 and f16 (§17.5.46). The sentence now says what TypeShade takes.
//
// Both halves read each source (Rule 12.5: the text is the contract), and each remedy a sentence
// names is compiled, in both halves, to show that it is one.
//
// Verifies: Rule 12.5 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';
import { TS_CODES } from './codes.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const fn = (params: string, ret: string, body: string): string => `"use typeshade"
export function f(${params}): ${ret} { return ${body} }
`;

const compilerOf = (src: string): string[] =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`);

const editorOf = (src: string): string[] => {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', src);
  return service.getDiagnostics('a.ts').map((d) => `${String(d.code)} ${d.message}`);
};

/** Both halves give exactly `expected`. */
const both = (src: string, expected: readonly string[]): void => {
  expect(compilerOf(src), 'compile()').toEqual(expected);
  expect(editorOf(src), 'the editor').toEqual(expected);
};

const M = TS_CODES.MATH_ARGUMENT;
const T = TS_CODES.TYPE_MISMATCH;

describe('the remedy of a builtin with no integer form names the float cast (#616)', () => {
  it('pow(f32, i32) names f32(n), and that remedy compiles', () => {
    both(fn('x: f32, n: i32', 'f32', 'pow(x, n)'), [
      `${M} pow takes arguments of one type; the first is f32, this one i32. Cast this one: f32(n).`,
    ]);
    both(fn('x: f32, n: i32', 'f32', 'pow(x, f32(n))'), []);
  });

  it('the old second remedy, pow(i32(x), n), is still refused, and no sentence names it now', () => {
    both(fn('x: f32, n: i32', 'f32', 'pow(i32(x), n)'), [
      `${M} pow takes an f32, or a vector of them; got i32.`,
    ]);
  });

  it('Math.pow, a vector, and an expression argument take the same remedy', () => {
    both(fn('x: f32, n: u32', 'f32', 'Math.pow(x, n + 1)'), [
      `${M} Math.pow takes arguments of one type; the first is f32, this one u32. Cast this one: f32(n + 1).`,
    ]);
    both(fn('x: f32, n: u32', 'f32', 'Math.pow(x, f32(n + 1))'), []);
    both(fn('v: vec2, k: vec2i', 'vec2', 'pow(v, k)'), [
      `${M} pow takes arguments of one type; the first is vec2, this one vec2i. Cast this one: vec2(k).`,
    ]);
    both(fn('v: vec2, k: vec2i', 'vec2', 'pow(v, vec2(k))'), []);
  });

  it('a builtin with an integer form keeps both casts, and each compiles', () => {
    both(fn('x: f32, n: i32', 'f32', 'max(x, n)'), [
      `${M} max takes arguments of one type; the first is f32, this one i32. Cast one side: f32(x) or i32(x).`,
    ]);
    both(fn('x: f32, n: i32', 'f32', 'max(x, f32(n))'), []);
    both(fn('x: f32, n: i32', 'i32', 'max(i32(x), n)'), []);
  });
});

describe('the ** refusal says what TypeShade takes, not what WGSL defines (#616)', () => {
  it('i32 ** i32 is refused without a claim about WGSL, and the remedy compiles', () => {
    const expected = [
      `${T} Cannot ** i32. ** is pow(a, b), which takes floating-point values only; ` +
        'cast first, e.g. f32(a) ** f32(b).',
    ];
    both(fn('x: i32', 'i32', 'x ** 2'), expected);
    expect(expected[0]).not.toContain('WGSL');
    both(fn('x: i32', 'f32', 'f32(x) ** f32(2)'), []);
    both(fn('x: f32', 'f32', 'x ** 2.'), []);
  });
});
