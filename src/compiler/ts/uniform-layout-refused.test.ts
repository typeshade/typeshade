import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileTsSource } from './source-file.js';

function compiled(source: string) {
  const c = compile(`"use typeshade"\n${source}`);
  expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return c;
}

describe('what the padding cannot reach is refused, not emitted', () => {
  it.each([
    [
      'a list of lists',
      `interface U { g: array<array<f32, 2>, 3> }
declare const U_: uniform<U>
@fragment export function fs(): vec4 { return vec4(U_.g[1][0]) }`,
      /list of lists would need that at both levels/,
    ],
    [
      'a bare list as the whole uniform',
      `declare const U_: uniform<array<f32, 4>>
@fragment export function fs(): vec4 { return vec4(U_[1]) }`,
      /a bare list has no member to carry that/,
    ],
    [
      'one struct bound to both address spaces',
      `interface U { xs: array<f32, 4> }
declare const A_: uniform<U>
declare const B_: storage<U>
@fragment export function fs(): vec4 { return vec4(A_.xs[1] + B_.xs[2]) }`,
      /bound as a uniform AND as storage/,
    ],
  ])('refuses %s', (_what, source, match) => {
    const r = compileTsSource(`"use typeshade"\n${source}`);
    const d = r.diagnostics.find((x) => x.category === 'error');
    expect(d?.message, `expected a refusal for ${_what}`).toMatch(match);
  });

  it('leaves the shapes that need no padding alone', () => {
    const bare = compiled(`declare const U_: uniform<array<vec4, 4>>
@fragment export function fs(): vec4 { return U_[1] }`);
    expect(bare.wgsl).toContain('var<uniform> U_: array<vec4<f32>, 4>;');
    expect(bare.wgsl).not.toContain('_Pad16');
  });
});
