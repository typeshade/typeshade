import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';

const SRC = `
"use typeshade";

interface Clip {
  pos: builtin<"position", vec4>;
}

interface Color {
  color: location<0, vec4>;
}

export const vs = vertex(function vs(i: builtin<"vertex_index", u32>): Clip {
  return { pos: vec4(0., 0., 0., 1.) };
});

export const fs = fragment(function fs(): Color {
  return { color: vec4(1., 0., 0., 1.) };
});
`;

describe('compile()', () => {
  it('returns module + wgsl + eval for Clip/Color', () => {
    const s = compile(SRC);
    expect(s.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(
      s.module.funcs
        .filter((f) => f.stage)
        .map((f) => f.stage)
        .sort(),
    ).toEqual(['fragment', 'vertex']);
    expect(s.wgsl).toMatch(/@builtin\(position\)/);
    expect(s.wgsl).toMatch(/@vertex/);
    expect(s.glsl?.vertex).toMatch(/#version 300 es/);
    const red = s.eval('fs') as { color: number[] };
    expect(red.color).toEqual([1, 0, 0, 1]);
    // Two constant vectors: nothing in the module may differ by driver.
    expect(s.determinism).toEqual([]);
  });
});
