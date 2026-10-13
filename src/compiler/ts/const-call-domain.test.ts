// A constant call of a builtin outside its domain, or past the range of f32 (#613).
//
// `pow` and `sqrt` are `@const` builtins (WGSL §17.5.46, §17.5.58): a call whose arguments are
// all constant is a const-expression, and one outside the domain, or one that overflows, is a
// shader-creation error (§15.7.2). Each program below compiled with no diagnostic, and Tint
// refused the WGSL. A module constant whose value the oracle folded to NaN drew TS8003 with a
// sentence about its type ("f32 is neither"), and one it folded to 4 compiled and reached Tint.
// The front end now refuses each call where it is written, in the author's words (Rule 12.6),
// and passes each neighbour Tint accepts.
//
// Measured on Tint (Chromium 141.0.7390.37, SwiftShader, 2026-10-13), as loop-bound.ts records:
//
//   pow(-2.0, 0.5), pow(-2.0, 2.0)      '-2.0 ^ 2.0' cannot be represented as 'abstract-float'
//   pow(0.0, -1.0)                      '0.0 ^ -1.0' cannot be represented as 'abstract-float'
//   pow(10.0, 40.0)                     value 1000…0752.0 cannot be represented as 'f32'
//   sqrt(-1.0)                          sqrt must be called with a value >= 0
//   const K: f32 = pow((-2.0), 2.0)     '-2.0 ^ 2.0' cannot be represented as 'abstract-float'
//   smoothstep(1.0, 1.0, x), x run-time smoothstep called with 'low' (1.0) equal to 'high' (1.0)
//
// and accepted: pow(2.0, 0.5), pow(10.0, 2.0), pow(-0.0, 2.0), pow(0.0, 2.0), pow(x, 2.0),
// pow(-2.0, x), pow(x, -1.0), sqrt(-0.0), exp(88.0), smoothstep(2.0, 1.0, x), x / sqrt(0.0).
// The compile gate's const-call leg compiles the accepted neighbours on Tint
// (scripts/compile-gate.ts).
//
// Both halves read each source: `compile()`'s diagnostics (code and text, Rule 12.5) and the
// language service's `getDiagnostics`.
//
// Verifies: Rule 12.6 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';
import { TS_CODES } from './codes.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const errorsOf = (src: string): string[] =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`);

const editorOf = (src: string): string[] => {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', src);
  return service.getDiagnostics('a.ts').map((d) => `${String(d.code)} ${d.message}`);
};

const both = (src: string, expected: readonly string[]): void => {
  expect(errorsOf(src), 'compile()').toEqual(expected);
  expect(editorOf(src), 'the editor').toEqual(expected);
};

const fs = (body: string, consts = ''): string => `"use typeshade"
${consts}
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  let y: f32 = uv.x
  ${body}
  return vec4(y, 0., 0., 1.)
}
`;

const T = TS_CODES.TYPE_MISMATCH;
const AT_CREATION =
  'WGSL evaluates a call whose arguments are all constant when it creates the shader, and ' +
  'refuses this one.';
const NO_VALUE = 'It has no value to write; change the argument.';

const outside = (text: string, fn: string, why: string, remedy: string): string =>
  `${T} "${text}" is outside the domain of ${fn}: ${why}. ${AT_CREATION} ${remedy}`;

const past = (text: string, value: string): string =>
  `${T} "${text}" is about ${value}, outside the range of f32 (about ±3.4e38), and there is no ` +
  'wider type here for it to take.';

describe('a constant call outside its domain is refused where it is written (#613)', () => {
  it('refuses each program of the issue, in both halves', () => {
    const rows: [string, string, string][] = [
      [
        'y = pow(-2., 0.5)',
        '',
        outside('pow(-2., 0.5)', 'pow', 'the base -2 is below 0', NO_VALUE),
      ],
      [
        'let p = pow(-2., 2.)\n  y = y + p',
        '',
        outside('pow(-2., 2.)', 'pow', 'the base -2 is below 0', 'Write its value, 4, instead.'),
      ],
      [
        'y = pow(0., -1.)',
        '',
        outside(
          'pow(0., -1.)',
          'pow',
          'the base is 0 and the exponent -1 is not above 0',
          NO_VALUE,
        ),
      ],
      ['y = 10. ** 40.', '', past('10. ** 40.', '1e+40')],
      ['y = sqrt(-1.)', '', outside('sqrt(-1.)', 'sqrt', '-1 is below 0', NO_VALUE)],
      [
        'y = y + K',
        'const K: f32 = pow(-2., 2.)',
        outside('pow(-2., 2.)', 'pow', 'the base -2 is below 0', 'Write its value, 4, instead.'),
      ],
    ];
    for (const [body, consts, expected] of rows) both(fs(body, consts), [expected]);
  });

  it('gives the module constant the call sentence, not the type sentence', () => {
    // The neighbour the issue quotes: refused before, with "f32 is neither".
    both(fs('y = y + K', 'const K: f32 = pow(-2., 0.5)'), [
      outside('pow(-2., 0.5)', 'pow', 'the base -2 is below 0', NO_VALUE),
    ]);
  });

  it('refuses through a constant, a vector, Math, and an expression', () => {
    both(fs('y = pow(K, 0.5)', 'const K: f32 = -2.'), [
      outside('pow(K, 0.5)', 'pow', 'the base -2 is below 0', NO_VALUE),
    ]);
    both(fs('const k = -2.\n  y = pow(k, 0.5)'), [
      outside('pow(k, 0.5)', 'pow', 'the base -2 is below 0', NO_VALUE),
    ]);
    both(fs('y = pow(vec2(-2., 2.), vec2(2.)).x'), [
      outside('pow(vec2(-2., 2.), vec2(2.))', 'pow', 'in .x, the base -2 is below 0', NO_VALUE),
    ]);
    both(fs('y = Math.sqrt(-4.)'), [
      outside('Math.sqrt(-4.)', 'Math.sqrt', '-4 is below 0', NO_VALUE),
    ]);
    both(fs('y = y + pow(1e19, 2.) * 10.'), [past('pow(1e19, 2.) * 10.', '1e+39')]);
  });

  it('refuses the other builtins Tint checks', () => {
    both(fs('y = inverseSqrt(0.)'), [
      outside('inverseSqrt(0.)', 'inverseSqrt', '0 is not above 0', NO_VALUE),
    ]);
    both(fs('y = log(0.)'), [outside('log(0.)', 'log', '0 is not above 0', NO_VALUE)]);
    both(fs('y = log2(-1.)'), [outside('log2(-1.)', 'log2', '-1 is not above 0', NO_VALUE)]);
    both(fs('y = acos(1.5)'), [outside('acos(1.5)', 'acos', '1.5 is outside [-1, 1]', NO_VALUE)]);
    both(fs('y = asin(-1.5)'), [
      outside('asin(-1.5)', 'asin', '-1.5 is outside [-1, 1]', NO_VALUE),
    ]);
    both(fs('y = acosh(0.5)'), [outside('acosh(0.5)', 'acosh', '0.5 is below 1', NO_VALUE)]);
    both(fs('y = atanh(1.)'), [outside('atanh(1.)', 'atanh', '1 is outside (-1, 1)', NO_VALUE)]);
    both(fs('y = normalize(vec2(0., 0.)).x'), [
      outside(
        'normalize(vec2(0., 0.))',
        'normalize',
        'the vector is zero, which has no direction',
        NO_VALUE,
      ),
    ]);
    both(fs('y = smoothstep(1., 1., y)'), [
      `${T} "smoothstep(1., 1., y)" is outside the domain of smoothstep: the low and the high ` +
        'edge are both 1. WGSL refuses two equal constant edges when it creates the shader, ' +
        'whatever x is. Give the edges two different values.',
    ]);
    both(fs('y = exp(89.)'), [past('exp(89.)', '4.49e+38')]);
    both(fs('y = exp2(128.)'), [past('exp2(128.)', '3.4e+38')]);
  });
});

describe('the neighbours Tint accepts compile, in both halves (#613)', () => {
  it('passes each one', () => {
    for (const body of [
      'y = pow(2., 0.5) + pow(10., 2.) + pow(y, 2.)',
      'y = pow(-0., 2.) + pow(0., 2.) + sqrt(-0.) + sqrt(0.)',
      'y = pow(-2., y) + pow(y, -1.) + sqrt(-1. * y)',
      'let k = -2.\n  y = pow(k, 0.5)',
      'y = log(1.) + acos(-1.) + asin(1.) + acosh(1.) + atanh(0.5) + inverseSqrt(4.)',
      'y = smoothstep(2., 1., y) + smoothstep(0., 1., y)',
      'y = y + exp(88.)\n  y = y + exp2(127.)\n  y = y + pow(2., 127.)',
      'y = y / sqrt(0.)',
    ])
      both(fs(body), []);
    both(fs('y = pow(K, 2.)', 'const K: f32 = 2.'), []);
    // A function of the file named pow is not the builtin (Rule 9.5).
    both(fs('y = pow(-2.)', 'function pow(x: f32): f32 { return x * x; }'), []);
  });
});
