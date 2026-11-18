import { describe, expect, it } from 'vitest';
import { keepHelpers } from '../../core/testing/keep-helpers.js';
import { compile } from './compile.js';

function compiled(source: string) {
  const c = compile(`"use typeshade"\n${source}`);
  expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return c;
}

describe('a padded array reached any other way keeps the type the author wrote', () => {
  const U = `interface U { xs: array<f32, 4>; k: f32 }
declare const U_: uniform<U>`;

  it.each([
    [
      'a helper argument',
      `export function pick(a: array<f32, 4>): f32 { return a[0] + a[1] + a[2] + a[3] }
@fragment export function fs(): vec4 { return vec4(pick(U_.xs) * U_.k + pick(U_.xs)) }`,
    ],
    [
      'a helper return',
      `export function grab(k: f32): array<f32, 4> { if (k > 0.) { return U_.xs } return U_.xs }
@fragment export function fs(): vec4 { return vec4(grab(U_.k)[1] + grab(U_.k)[2]) }`,
    ],
  ])('materialises the array where it is used as a value: %s', (_what, body) => {
    const c = compiled(`${U}\n${body}`);
    expect(c.wgsl).toContain('array<f32, 4>(U_.xs[0].v, U_.xs[1].v, U_.xs[2].v, U_.xs[3].v)');
    expect(c.wgsl).not.toMatch(/let \w+ = U_\.xs;/);
  });

  it('reads an element through a second name where the uniform keeps it', () => {
    const c = compiled(
      `${U}\n@fragment export function fs(): vec4 { const w = U_.xs; return vec4(w[1] * U_.k) }`,
    );
    expect(c.wgsl).toContain('U_.xs[1].v');
    expect(c.wgsl).not.toMatch(/let \w+ = U_\.xs;/);
  });

  it(
    'wraps each element when the struct is built by value',
    keepHelpers(() => {
      const c = compiled(`interface U { k: f32; xs: array<f32, 2> }
declare const U_: uniform<U>
export function mk(): U { return { k: 1., xs: [0., 1.] } }
@fragment export function fs(): vec4 { return vec4(mk().xs[1] + U_.k) }`);
      expect(c.wgsl).toContain('_Pad16_f32(');
      expect(c.wgsl).toContain('mk().xs[1].v');
    }),
  );
});
