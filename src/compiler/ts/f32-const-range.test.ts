// An f32 constant expression past f32's range (#374). A literal past it was refused as it was
// written, and the value arithmetic folds to was not: each program below compiled with no
// diagnostic, and Tint refused its WGSL at every level. The front end now folds the value as
// the zero-divisor proof does (#68), through literals, negation, vector constructors and
// consts, and refuses it with the literal's sentence (Rule 12.6).
//
// Measured on Tint (Chromium, SwiftShader):
//
//   y + 1e30 * 1e30, and const K: f32 = 1e30 * 1e30   value 1e60 cannot be represented as 'f32'
//   const K: f32 = 1e30; … y + K * K        'K * K' cannot be represented as 'f32'
//   y + -1e30 * 1e30, y + 1e30 / 1e-30, a vector of 1e30 times 1e30, K + K over 2e38   the same
//   const K: f32 = 1e19; … y + K * K        accepted: 1e38 is in range
//   y + 1e-30 * 1e-30                       accepted: a value too small rounds, it does not overflow
//   y + 1e38 * 3.4028234                    accepted: just below the largest f32
//
// WGSL evaluates literals alone exactly and an expression over `f32` constants in `f32` steps,
// so a value is refused only where both readings leave the range. `1e38 * 3.40282348` is past
// the largest f32 exactly and inside it in `f32` steps, and Tint refuses it: that one is left to
// Tint, a false negative, never a false refusal.
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

const fs = (body: string, consts = ''): string => `"use typeshade"
${consts}
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  let y: f32 = uv.x
  let v: vec2 = uv
  ${body}
  return vec4(y, v.x, 0., 1.)
}
`;

const PAST = (text: string, value: string): string =>
  `${TS_CODES.TYPE_MISMATCH} "${text}" is about ${value}, outside the range of f32 ` +
  `(about ±3.4e38), and there is no wider type here for it to take.`;

describe('an f32 constant expression past the range (#374)', () => {
  it('refuses arithmetic over literals and over consts, in both halves', () => {
    const cases: [string, string, string, string][] = [
      ['y = y + 1e30 * 1e30', '', '1e30 * 1e30', '1e+60'],
      ['y = y + K', 'const K: f32 = 1e30 * 1e30', '1e30 * 1e30', '1e+60'],
      ['y = y + K * K', 'const K: f32 = 1e30', 'K * K', '1e+60'],
      ['y = y + -1e30 * 1e30', '', '-1e30 * 1e30', '-1e+60'],
      ['y = y + 1e30 / 1e-30', '', '1e30 / 1e-30', '1e+60'],
      ['y = y + (K + K)', 'const K: f32 = 2e38', 'K + K', '4e+38'],
      ['v = v + vec2(1e30) * 1e30', '', 'vec2(1e30) * 1e30', '1e+60'],
    ];
    for (const [body, consts, text, value] of cases) {
      const src = fs(body, consts);
      expect(errorsOf(src), body).toEqual([PAST(text, value)]);
      expect(editorOf(src), body).toEqual([PAST(text, value)]);
    }
  });

  it('takes what Tint takes, and leaves the one value the readings part on to Tint', () => {
    for (const [body, consts] of [
      ['y = y + K * K', 'const K: f32 = 1e19'],
      ['y = y + 1e-30 * 1e-30', ''],
      ['y = y + 1e38 * 3.4028234', ''],
      ['y = y + K * 1.', 'const K: f32 = 3.4e38'],
      // Past the largest f32 exactly, inside it in f32 steps: Tint refuses it, this does not.
      ['y = y + 1e38 * 3.40282348', ''],
      // A double holds 1e60: the check is for f32 alone.
      ['const d = f64(1e30)\n  y = f32(d * d * 1e-30 * 1e-30)', ''],
    ] as const) {
      const src = fs(body, consts);
      expect(errorsOf(src), body).toEqual([]);
      expect(editorOf(src), body).toEqual([]);
    }
  });
});
