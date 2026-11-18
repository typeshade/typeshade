import { describe, expect, it } from 'vitest';
import { compileTsSources } from './module.js';

describe('the multi-file path', () => {
  it('a function another file imports returns what its body does', () => {
    const r = compileTsSources([
      {
        fileName: 'math.ts',
        source: `"use typeshade";
export function square(x: f32) {
  return x * x;
}
export function cube(x: f32) {
  return square(x) * x;
}
`,
      },
      {
        fileName: 'app.ts',
        source: `"use typeshade";
import { cube } from "./math";
export function foo(x: f32) {
  return cube(x) + 1.;
}
`,
      },
    ]);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn square(x: f32) -> f32 {');
    expect(r.wgsl).toContain('fn cube(x: f32) -> f32 {');
    expect(r.wgsl).toContain('fn foo(x: f32) -> f32 {');
  });
});
