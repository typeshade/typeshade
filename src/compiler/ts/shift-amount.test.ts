// A shift by 32 or more (#71). WGSL requires the amount of `e1 << e2` on a 32-bit integer to
// be less than 32 when it is a constant (a shader-creation error otherwise) and masks a
// run-time amount to its low five bits; GLSL ES 3.00 leaves both undefined. So `x << 32` is
// `x << 0` on one target and anything on the other. Measured on `main` before this: `y <<= 32`,
// `x >> 33` and `x >> (16 + 16)` each compiled clean and emitted `32u` or `33u` for Tint to
// refuse.
//
// Verifies: Rule 7.4 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';
import { TS_CODES } from './codes.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`);

const fs = (body: string, type: 'u32' | 'i32' = 'u32') => `"use typeshade"
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  let x: ${type} = ${type}(uv.x)
  ${body}
  return vec4(f32(x), 0., 0., 1.)
}
`;

const RANGE = 'a 32-bit integer has no bit to shift into.';

describe('a shift amount of 32 or more (#71)', () => {
  it('refuses a compound shift by 32, in the words the binary path uses', () => {
    // ONE sentence for both paths: the two had their own wording for the same rule, which is
    // a rule that will be changed once. `shiftAmountMessage` is the authority now.
    expect(errorsOf(fs('x <<= 32'))).toEqual([
      `${TS_CODES.TYPE_MISMATCH} A shift amount must be between 0 and 31, got 32: ${RANGE}`,
    ]);
    expect(errorsOf(fs('x >>= 40', 'i32'))).toEqual([
      `${TS_CODES.TYPE_MISMATCH} A shift amount must be between 0 and 31, got 40: ${RANGE}`,
    ]);
    // The negative end of the same range, which the compound path also used to word its own
    // way. A non-shift compound on a u32 target keeps its own message: that is a different
    // rule about the TARGET, not about a shift amount.
    expect(errorsOf(fs('x <<= -1'))).toEqual([
      `${TS_CODES.TYPE_MISMATCH} A shift amount must be between 0 and 31, got -1: ${RANGE}`,
    ]);
  });

  it('refuses a shift expression by 33, and by an expression that folds to 32', () => {
    expect(errorsOf(fs('x = x >> 33'))).toEqual([
      `${TS_CODES.TYPE_MISMATCH} A shift amount must be between 0 and 31, got 33: ${RANGE}`,
    ]);
    expect(errorsOf(fs('x = x >> (16 + 16)'))).toEqual([
      `${TS_CODES.TYPE_MISMATCH} A shift amount must be between 0 and 31, got 32: ${RANGE}`,
    ]);
  });

  it('refuses a constant the author spelled through a const', () => {
    // The declaration is dropped, so the use below it reports an unknown name as well; the
    // first diagnostic is the one that says why.
    const errors = errorsOf(`"use typeshade";
const BITS: u32 = 32;
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  const x: u32 = u32(uv.x) << BITS;
  return vec4(f32(x), 0., 0., 1.);
}
`);
    expect(errors[0]).toBe(
      `${TS_CODES.TYPE_MISMATCH} A shift amount must be between 0 and 31, got 32: ${RANGE}`,
    );
  });

  it('takes 0 and 31, the whole range a 32-bit integer has', () => {
    for (const body of ['x = x >> 31', 'x <<= 0', 'x = x << 31', 'x >>= 31']) {
      expect(errorsOf(fs(body)), body).toEqual([]);
    }
  });

  it('leaves a run-time amount alone', () => {
    expect(errorsOf(fs('x = x << u32(uv.y)'))).toEqual([]);
    expect(errorsOf(fs('x <<= u32(uv.y)'))).toEqual([]);
  });
});

// A constant VECTOR amount (#241). WGSL checks each component of a const-expression amount, so
// `x << vec2u(32, 1)` is the scalar case in one lane. Measured on Tint (Chromium's WebGPU on
// SwiftShader, the compile gate's instrument, a broken shader reported first) on 2026-09-24
// (Rule 13.3): `x << vec2<u32>(32u, 1u)`, `y >> vec2<u32>(33u)`, `x << (vec2<u32>(16u) +
// vec2<u32>(16u, 0u))` and `y << vec2<u32>(vec2<i32>(-1i, 2i))` are each "shift left (right)
// value must be less than the bit width of the lhs, which is 32"; `x << vec2<u32>(31u, 0u)`
// and `x << vec2<u32>(u32(uv.y), 40u)`, which is not a const-expression, are accepted.
describe('a constant vector shift amount with a component of 32 or more (#241)', () => {
  const vec = (body: string, type: 'vec2u' | 'vec2i' = 'vec2u') => `"use typeshade";
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  let x: ${type} = ${type}(${type === 'vec2u' ? 'u32' : 'i32'}(uv.x), 1);
  ${body};
  return vec4(f32(x.x), 0., 0., 1.);
}
`;
  const editorOf = (src: string): string[] => {
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', src);
    return service.getDiagnostics('a.ts').map((d) => `${String(d.code)} ${d.message}`);
  };
  const refused = (got: number) =>
    `${TS_CODES.TYPE_MISMATCH} A shift amount must be between 0 and 31, got ${String(got)}: ${RANGE}`;

  it('refuses a component out of range, in both halves, with the scalar sentence', () => {
    const cases: [string, number, ('vec2u' | 'vec2i')?][] = [
      ['x = x << vec2u(32, 1)', 32],
      ['x = x >> vec2u(33)', 33],
      ['x = x << (vec2u(16) + vec2u(16, 0))', 32],
      ['x = x << vec2i(-1, 2)', -1, 'vec2i'],
    ];
    for (const [body, got, type] of cases) {
      const src = vec(body, type);
      expect(errorsOf(src), body).toEqual([refused(got)]);
      expect(editorOf(src), body).toEqual([refused(got)]);
    }
  });

  it('takes a vector of amounts in range, and one that is not constant', () => {
    for (const body of ['x = x << vec2u(31, 0)', 'x = x << vec2u(u32(uv.y), 40)']) {
      const src = vec(body);
      expect(errorsOf(src), body).toEqual([]);
      expect(editorOf(src), body).toEqual([]);
    }
  });
});
