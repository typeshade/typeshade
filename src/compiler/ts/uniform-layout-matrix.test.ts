// Verifies: Rule 6.8 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { reflect } from '../../core/reflect.js';

function compiled(source: string) {
  const c = compile(`"use typeshade"\n${source}`);
  expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return c;
}

describe('the padding and the matrix layout rule compose (#149 × §51)', () => {
  it('pads the array and leaves every matrix whose stride is already 16 alone', () => {
    const c = compiled(`class U {
  count: f32
  weights: array<f32, 3>
  m: mat3x3
  n: mat2x4
}
declare const u: uniform<U>
@vertex export function vs(): vec4 { return vec4(u.count, 0., 0., 1.) }
@fragment export function fs(): vec4 {
  return vec4(u.weights[1] + u.m[0].x + u.n[0].x, 0., 0., 1.)
}`);
    expect(c.wgsl).toContain('@size(16) v: f32,');
    expect(c.wgsl).toContain('@align(16) weights: array<_Pad16_f32, 3>,');
    expect(c.wgsl).toContain('  m: mat3x3<f32>,');
    expect(c.wgsl).toContain('  n: mat2x4<f32>,');
    expect(c.wgsl).not.toContain('_Pad16_mat');
    const u = reflect(c.module).bindGroups[0]!.entries[0]!;
    expect(u.structName).toBe('U');
  });

  it('leaves an ARRAY of matrices alone for the same reason', () => {
    const c = compiled(`class U { ms: array<mat3x4, 2> }
declare const u: uniform<U>
@vertex export function vs(): vec4 { return vec4(u.ms[0][0].x, 0., 0., 1.) }
@fragment export function fs(): vec4 { return vec4(u.ms[1][0].x, 0., 0., 1.) }`);
    expect(c.wgsl).toContain('ms: array<mat3x4<f32>, 2>,');
    expect(c.wgsl).not.toContain('_Pad16_');
  });
});
