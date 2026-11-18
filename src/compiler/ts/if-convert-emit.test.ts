import { describe, expect, it } from 'vitest';
import { bothTake } from '../../core/testing/both-halves.js';

const SOURCE = `"use typeshade";
interface VsOut {
  pos: builtin<"position">;
  uv: vec2;
}
function swap(a: f32, b: f32): [f32, f32] {
  return [b, a];
}
function order(lo: f32, hi: f32): [f32, f32] {
  return lo > hi ? swap(lo, hi) : [lo, hi];
}
export function sorted(x: f32, y: f32): f32 {
  let a = x;
  let b = y;
  [a, b] = order(a, b);
  return a * 10 + b;
}
@vertex
export function vs(vi: builtin<"vertex_index">): VsOut {
  const p: vec2 = vec2(f32(vi), 0);
  return { pos: vec4(p, 0, 1), uv: p };
}
@fragment
export function fs(v: VsOut): vec4 {
  const r = sorted(v.uv.x, v.uv.y);
  return vec4(r, r, r, 1);
}`;

const sliceOf = (text: string, start: RegExp): string => {
  const at = text.search(start);
  expect(at).toBeGreaterThanOrEqual(0);
  return text.slice(at);
};

describe('an author-written helper that orders two numbers', () => {
  const { result } = bothTake(SOURCE);

  it('leaves no branch and no list temporary in the WGSL fragment stage', () => {
    const fs = sliceOf(result.wgsl!, /fn fs\(/);
    expect(fs).not.toMatch(/\bif\b/);
    expect(fs).not.toContain('_list_');
    expect(fs).toContain('select(');
  });

  it('leaves no branch and no list temporary in the GLSL fragment stage', () => {
    const fs = result.glsl!.fragment;
    expect(fs).not.toMatch(/\bif\b/);
    expect(fs).not.toContain('_list_');
  });

  it('puts the smaller number first, whichever comes first', () => {
    expect(result.eval('sorted', [2, 1])).toBe(12);
    expect(result.eval('sorted', [1, 2])).toBe(12);
    expect(result.eval('sorted', [3, 3])).toBe(33);
    expect(result.eval('sorted', [-1, -2])).toBe(-21);
  });
});
