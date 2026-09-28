// WGSL's integer answers on GLSL ES 3.00 (Rule 11.12, change 0027, #382).
//
// GLSL ES 3.00 gives some inputs of an integer `/`, `%` and shift, and of a float's conversion to
// an integer, no result, and a WebGL2 driver answers otherwise than WGSL and the oracle there:
// `7 / 0` was -7, `-7 % 3` was 2 and `int(3e9)` the least `int`. The GLSL writer now spells each
// through a helper that settles those inputs, and keeps the bare operator where the operands
// cannot reach one. What a driver computes from the helpers is the GPU differential's WebGL2 arm
// (`scripts/gpu-differential.ts`), which holds them to the oracle on every input; this file holds
// the spelling, on both halves of the same source: the compiler's GLSL and WGSL, and the language
// service's diagnostics, which the change must not move.
//
// Verifies: Rule 11.12

import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const FS = (body: string): string => `"use typeshade"
class U {
  a: i32
  b: i32
  c: u32
  d: u32
  x: f32
  v: vec3
  w: vec3i
}
declare const u: uniform<U>
@fragment
export function fs(@location(0) uv: vec2): vec4 {
${body}
}
`;

/** The GLSL and WGSL `compile()` writes for `body`, after both halves accept it. */
function emitted(body: string): { glsl: string; wgsl: string } {
  const src = FS(body);
  const r = compile(src);
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', src);
  expect(service.getDiagnostics('a.ts')).toEqual([]);
  const glsl = r.glsl as unknown as { fragment: string };
  return { glsl: glsl.fragment, wgsl: r.wgsl! };
}

describe('the GLSL writer gives WGSL integer answers (Rule 11.12)', () => {
  it('divides and takes a remainder by a run-time divisor through the helpers', () => {
    const { glsl, wgsl } = emitted(
      '  const q = u.a / u.b + u.a % u.b\n  const p = u.c / u.d + u.c % u.d\n  return vec4(f32(q), f32(p), 0., 1.)',
    );
    expect(glsl).toContain('(_idiv(u.a, u.b) + _irem(u.a, u.b))');
    expect(glsl).toContain('(_udiv(u.c, u.d) + _urem(u.c, u.d))');
    // Each helper settles what GLSL leaves undefined and gives the bare operator's answer
    // elsewhere: a zero divisor, the least int over -1, a remainder that truncates.
    expect(glsl).toContain(`int _idiv(int a, int b) {
  return (b == 0 || (a == int(0x80000000u) && b == -1)) ? a : a / b;
}`);
    expect(glsl).toContain(`int _irem(int a, int b) {
  return (b == 0 || (a == int(0x80000000u) && b == -1)) ? 0 : a - (a / b) * b;
}`);
    expect(glsl).toContain(`uint _udiv(uint a, uint b) {
  return b == 0u ? a : a / b;
}`);
    expect(glsl).toContain(`uint _urem(uint a, uint b) {
  return b == 0u ? 0u : a % b;
}`);
    // WGSL settles every input itself, and keeps the operators.
    expect(wgsl).toContain('((u.a / u.b) + (u.a % u.b))');
    expect(wgsl).not.toContain('_idiv');
  });

  it('gives a vector the component-wise overload, after the scalar one it calls', () => {
    const { glsl } = emitted('  const v = u.w / u.w\n  return vec4(f32(v.x), 0., 0., 1.)');
    expect(glsl).toContain('_idiv(u.w, u.w)');
    const scalar = glsl.indexOf('int _idiv(int a, int b)');
    const vector = glsl.indexOf(`ivec3 _idiv(ivec3 a, ivec3 b) {
  return ivec3(_idiv(a.x, b.x), _idiv(a.y, b.y), _idiv(a.z, b.z));
}`);
    expect(scalar).toBeGreaterThanOrEqual(0);
    expect(vector).toBeGreaterThan(scalar);
  });

  it('keeps the bare operator where the divisor is a literal no input makes undefined', () => {
    const { glsl } = emitted(
      '  const p = u.c / 4 + u.c % 4\n  const q = u.a / 7 + u.a % 7 + u.a / -1\n  return vec4(f32(p), f32(q), 0., 1.)',
    );
    expect(glsl).toContain('((u.c / 4u) + (u.c % 4u))');
    expect(glsl).toContain('(u.a / 7)');
    // A remainder's dividend may be negative, and the least int over -1 is undefined.
    expect(glsl).toContain('_irem(u.a, 7)');
    expect(glsl).toMatch(/_idiv\(u\.a, \(?-1\)?\)/);
    expect(glsl).not.toContain('_udiv');
  });

  it('masks a run-time shift amount, and leaves a literal one alone', () => {
    const { glsl, wgsl } = emitted(
      '  const p = (u.c << u.d) + (u.c >> u.d) + (u.c << 3)\n  return vec4(f32(p), 0., 0., 1.)',
    );
    expect(glsl).toContain('(u.c << (u.d & 31u))');
    expect(glsl).toContain('(u.c >> (u.d & 31u))');
    expect(glsl).toContain('(u.c << 3u)');
    expect(wgsl).toContain('(u.c << u.d)');
  });

  it('spells a compound assignment through the same helper or mask', () => {
    const { glsl } = emitted(
      '  let q = u.a\n  q /= u.b\n  q %= u.b\n  let p = u.c\n  p <<= u.d\n  return vec4(f32(q), f32(p), 0., 1.)',
    );
    expect(glsl).toContain('q = _idiv(q, u.b);');
    expect(glsl).toContain('q = _irem(q, u.b);');
    expect(glsl).toContain('p = (p << (u.d & 31u));');
  });

  it('converts a float to an integer through _f2i and _f2u, and an integer as it was', () => {
    const { glsl, wgsl } = emitted(
      '  const k = i32(u.x) + i32(u.c)\n  const m = u32(u.x)\n  const iv = vec3i(u.v)\n  const uv3 = vec3u(u.v)\n  return vec4(f32(k), f32(m), f32(iv.x), f32(uv3.y))',
    );
    expect(glsl).toContain('(_f2i(u.x) + int(u.c))');
    expect(glsl).toContain('_f2u(u.x)');
    expect(glsl).toContain('_f2i(u.v)');
    expect(glsl).toContain('_f2u(u.v)');
    // WGSL saturates, a clamp to the largest integers an f32 holds; a NaN source, which WGSL
    // leaves indeterminate, gives 0 as in the oracle.
    expect(glsl).toContain(`int _f2i(float x) {
  return int(mix(clamp(x, -2147483648.0, 2147483520.0), 0.0, isnan(x)));
}`);
    expect(glsl).toContain(`uint _f2u(float x) {
  return uint(mix(clamp(x, 0.0, 4294967040.0), 0.0, isnan(x)));
}`);
    expect(glsl).toContain(`ivec3 _f2i(vec3 x) {
  return ivec3(_f2i(x.x), _f2i(x.y), _f2i(x.z));
}`);
    expect(wgsl).toContain('i32(u.x)');
    expect(wgsl).not.toContain('_f2i');
  });

  it('writes no helper for a module that needs none', () => {
    const { glsl } = emitted(
      '  const f = u.x / 2. + f32(u.c)\n  const n = u.c * 3 + (u.c << 1)\n  return vec4(f, f32(n), 0., 1.)',
    );
    for (const helper of ['_idiv', '_irem', '_udiv', '_urem', '_f2i', '_f2u'])
      expect(glsl).not.toContain(helper);
  });
});
