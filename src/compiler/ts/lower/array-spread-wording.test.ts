import { describe, it } from 'vitest';
import { bothRefuse } from '../../../core/testing/both-halves.js';

const ELEMENTS = 'which a shader array does not do: write';

function spreadOf(parameter: string, element: string): string {
  return `"use typeshade";
export function g(${parameter}): f32 {
  const xs: array<f32, 8> = [${element}, 3.];
  return xs[0];
}
`;
}

describe('the elements a refused spread names', () => {
  it('writes each element of a sized array of four or fewer', () => {
    bothRefuse(
      spreadOf('a: array<f32, 4>', '...a'),
      'TS8013',
      `"...a" spreads a list into a list, ${ELEMENTS} its elements, a[0], a[1], a[2], a[3].`,
    );
  });

  it('writes the first two and the last of a sized array of more than four, with an ellipsis', () => {
    bothRefuse(
      spreadOf('a: array<f32, 5>', '...a'),
      'TS8013',
      `"...a" spreads a list into a list, ${ELEMENTS} its elements, a[0], a[1], …, a[4].`,
    );
  });

  it('writes each component of a vector', () => {
    bothRefuse(
      spreadOf('v: vec3f', '...v'),
      'TS8013',
      `"...v" spreads a list into a list, ${ELEMENTS} its elements, v.x, v.y, v.z.`,
    );
  });

  it('writes each component of a double-precision vector', () => {
    bothRefuse(
      spreadOf('v: vec2f64', '...v'),
      'TS8013',
      `"...v" spreads a list into a list, ${ELEMENTS} its elements, v.x, v.y.`,
    );
  });

  it('wraps an operand that is not a name in parentheses', () => {
    bothRefuse(
      spreadOf('a: array<f32, 2>, b: array<f32, 2>, c: bool', '...c ? a : b'),
      'TS8013',
      `"...c ? a : b" spreads a list into a list, ${ELEMENTS} its elements, (c ? a : b)[0], (c ? a : b)[1].`,
    );
  });

  it('gives no slice hint for an element that is a struct', () => {
    bothRefuse(
      `"use typeshade";
interface P { x: f32; }
export function g(a: array<P, 2>): f32 {
  const xs: array<P, 2> = [...a];
  return xs[0].x;
}
`,
      'TS8013',
      `"...a" spreads a list into a list, ${ELEMENTS} its elements, a[0], a[1].`,
    );
  });

  it('gives no slice hint for an element that is an array', () => {
    bothRefuse(
      `"use typeshade";
export function g(a: array<array<f32, 2>, 2>): f32 {
  const xs: array<array<f32, 2>, 2> = [...a];
  return xs[0][0];
}
`,
      'TS8013',
      `"...a" spreads a list into a list, ${ELEMENTS} its elements, a[0], a[1].`,
    );
  });
});
