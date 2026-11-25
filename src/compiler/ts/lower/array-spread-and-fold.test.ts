import { describe, expect, it } from 'vitest';
import { bothRefuse, bothTake } from '../../../core/testing/both-halves.js';
import { compileModule } from '../../../core/oracle.js';

describe('a function handed to a fold', () => {
  it('a local function named like a value constructor is the function handed over', () => {
    const halves = bothTake(`"use typeshade";
export function g(xs: array<f32, 2>, ys: array<f32, 2>): f32 {
  function vec2(a: f32, b: f32): f32 {
    return a * b;
  }
  const z = zip(xs, ys, vec2);
  return z[0] + z[1];
}
`);
    expect(compileModule(halves.result.module!).fns.g!([2, 3], [4, 5])).toBe(23);
  });

  it('a function declared later, with no return type, has its body lowered before the fold reads it', () => {
    const halves = bothTake(`"use typeshade";
export function g(xs: array<f32, 2>, ys: array<f32, 2>): f32 {
  const z = zip(xs, ys, mul);
  return z[0] + z[1];
}
function mul(a: f32, b: f32) {
  return a * b;
}
`);
    expect(compileModule(halves.result.module!).fns.g!([2, 3], [4, 5])).toBe(23);
  });
});

describe('a spread in a list', () => {
  it('gives one sentence, with no refusal of the operand beside it', () => {
    bothRefuse(
      `"use typeshade";
export function g(): f32 {
  const xs: array<f32, 2> = [...nope.ys];
  return xs[0];
}
`,
      'TS8013',
      '"...nope.ys" spreads into a list, which a shader array does not do: write the elements one by one.',
    );
  });

  it('is refused before the count of the elements it cannot see, wherever the list is written', () => {
    bothRefuse(
      `"use typeshade";
function mk(a: array<f32, 2>): array<f32, 3> {
  return [...a];
}
export function g(a: array<f32, 2>): f32 {
  return mk(a)[0];
}
`,
      'TS8013',
      '"...a" spreads a list into a list, which a shader array does not do: write its elements, a[0], a[1], or a.slice() for a copy of the whole array.',
    );
  });
});
