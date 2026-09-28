// A clamp whose constant bounds cross (#373). WGSL makes `clamp(e, low, high)` with `low` above
// `high` a shader-creation error when both bounds are constant, and GLSL ES 3.00 leaves the
// result undefined. #372 writes a pair only the optimizer makes constant as
// `min(max(e, low), high)`, and that let a pair the author wrote compile too: `clamp(x, 5, 2)`
// came out as `min(max(x, 5u), 2u)`, on both targets and at every level. The front end now
// refuses it, where the two bounds can be named (Rule 12.6).
//
// Measured on Tint (Chromium, SwiftShader), with the WGSL an author would write:
//
//   clamp(x, 5u, 2u), clamp(s, -1, -5)      clamp called with 'low' (5) greater than 'high' (2)
//   clamp(y, 1.0, 0.5), through module consts   the same
//   clamp(v, vec2(0.0, 2.0), vec2(1.0))     the same, for 'low' (2.0) and 'high' (1.0)
//   clamp(x, 2u, 5u), clamp(x, 3u, 3u)      accepted
//   clamp(y, 1.00000001, 1.0)               accepted: the two are one f32
//   clamp(y, 0.0, -0.0)                     accepted
//   let lo = 1.0; let hi = 0.5; clamp(y, lo, hi)   accepted: not constant in WGSL
//
// A local `const` of TypeShade is a constant: the writer puts its value in its place, so
// `clamp(y, lo, hi)` over two of them reaches Tint as the literals.
//
// Verifies: Rule 12.6 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { emitModuleAt } from '../../core/backends/wgsl.js';
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
  let x: u32 = u32(uv.y * 8.)
  let s: i32 = i32(uv.y * 8.) - 4
  let v: vec2 = uv
  ${body}
  return vec4(y, f32(x), f32(s), v.x)
}
`;

const TAIL = (e: string, low: string, high: string): string =>
  ` on every invocation. WGSL refuses the pair when both are constant, and GLSL ES 3.00 leaves ` +
  `the result undefined. Swap them, or write min(max(${e}, ${low}), ${high}) for the answer a ` +
  `crossed pair gives.`;

describe('a clamp whose constant bounds cross (#373)', () => {
  it('refuses two numbers, in both halves', () => {
    const cases: [string, string, string, string][] = [
      ['x = clamp(x, 5, 2)', 'x', '5', '2'],
      ['s = clamp(s, -1, -5)', 's', '-1', '-5'],
      ['y = clamp(y, 1., 0.5)', 'y', '1.', '0.5'],
    ];
    for (const [body, e, low, high] of cases) {
      const want = [
        `${TS_CODES.TYPE_MISMATCH} Crossed clamp bounds: the low bound ${low} is above the ` +
          `high bound ${high}${TAIL(e, low, high)}`,
      ];
      expect(errorsOf(fs(body)), body).toEqual(want);
      expect(editorOf(fs(body)), body).toEqual(want);
    }
  });

  it('names the value of a module const, a local const and arithmetic over them', () => {
    const cases: [string, string, string, string, number, number][] = [
      ['y = clamp(y, LO, HI)', 'const LO: f32 = 1.\nconst HI: f32 = 0.5', 'LO', 'HI', 1, 0.5],
      ['const lo = 1.\n  const hi = 0.5\n  y = clamp(y, lo, hi)', '', 'lo', 'hi', 1, 0.5],
      ['x = clamp(x, N + 3, N)', 'const N: u32 = 2', 'N + 3', 'N', 5, 2],
    ];
    for (const [body, consts, low, high, lo, hi] of cases) {
      const e = body.includes('x =') ? 'x' : 'y';
      const want = [
        `${TS_CODES.TYPE_MISMATCH} Crossed clamp bounds: the low bound "${low}" is ` +
          `${String(lo)} and the high bound "${high}" is ${String(hi)}${TAIL(e, low, high)}`,
      ];
      expect(errorsOf(fs(body, consts)), body).toEqual(want);
      expect(editorOf(fs(body, consts)), body).toEqual(want);
    }
  });

  it('names the component of a vector pair that crosses', () => {
    const body = 'v = clamp(v, vec2(0., 2.), vec2(1.))';
    const want = [
      `${TS_CODES.TYPE_MISMATCH} Crossed clamp bounds: in .y, the low bound "vec2(0., 2.)" is 2 ` +
        `and the high bound "vec2(1.)" is 1${TAIL('v', 'vec2(0., 2.)', 'vec2(1.)')}`,
    ];
    expect(errorsOf(fs(body))).toEqual(want);
    expect(editorOf(fs(body))).toEqual(want);
  });

  it('takes what Tint takes: bounds in order, equal, one f32 apart from nothing, or not constant', () => {
    for (const body of [
      'x = clamp(x, 2, 5)',
      'x = clamp(x, 3, 3)',
      'y = clamp(y, 1.00000001, 1.)',
      'y = clamp(y, 0., -0.)',
      'v = clamp(v, vec2(0., 1.), vec2(1.))',
      'y = clamp(y, 1., uv.y)',
      // Constant only once the optimizer folds `k - k`: #372's `min(max(e, low), high)`.
      'const k = x\n  x = clamp(x, (k - k) + 5, (k - k) + 2)',
    ]) {
      expect(errorsOf(fs(body)), body).toEqual([]);
      expect(editorOf(fs(body)), body).toEqual([]);
    }
  });

  it('writes a pair the optimizer makes constant as min(max(e, low), high)', () => {
    const src = fs('const k = x\n  x = clamp(x, (k - k) + 5, (k - k) + 2)');
    const r = compile(src, { fileName: 'm.shade.ts' });
    expect(r.diagnostics).toEqual([]);
    const wgsl = emitModuleAt(r.module, 'O2');
    expect(wgsl).toContain('min(max(x, 5u), 2u)');
    expect(wgsl).not.toContain('clamp(');
  });
});
