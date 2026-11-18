import { describe, expect, it } from 'vitest';
import { bothTake } from '../../core/testing/both-halves.js';

const HEAD = `"use typeshade";
interface VsOut {
  pos: builtin<"position">;
  uv: vec2;
}
@vertex
export function vs(vi: builtin<"vertex_index">): VsOut {
  const p: vec2 = vec2(f32(vi), 0);
  return { pos: vec4(p, 0, 1), uv: p };
}
`;

const fragment = (body: string): string => `${HEAD}
@fragment
export function fs(v: VsOut): vec4 {
  ${body}
  return vec4(r, r, r, 1);
}`;

const emit = (body: string) => {
  const { result } = bothTake(fragment(body));
  return { wgsl: result.wgsl!, glsl: result.glsl!.fragment };
};

describe('local arrays reached only by literal indices', () => {
  it('drops a swap through an array from WGSL and GLSL', () => {
    const { wgsl, glsl } = emit(`
      let x = v.uv.x;
      let y = v.uv.y;
      const t = array<f32, 2>(y, x);
      x = t[0];
      y = t[1];
      const r = x * 2 + y;`);
    expect(wgsl).not.toContain('array<');
    expect(glsl).not.toMatch(/\[\d\]/);
    expect(wgsl).toMatch(/let t_0 = /);
  });

  it('drops an array whose elements are written by literal index', () => {
    const { wgsl, glsl } = emit(`
      let w = array<f32, 3>(v.uv.x, v.uv.y, 1);
      w[1] = w[0] * 2;
      w[2] += w[1];
      const r = w[2];`);
    expect(wgsl).not.toContain('array<');
    expect(glsl).not.toMatch(/\[\d\]/);
  });

  it('keeps the array a dynamic index reads', () => {
    const { wgsl, glsl } = emit(`
      const ys = array<f32, 3>(v.uv.x, v.uv.y, 1);
      const r = ys[u32(v.uv.x * 2)];`);
    expect(wgsl).toContain('array<f32, 3>');
    expect(glsl).toMatch(/\[3\]/);
  });
});
