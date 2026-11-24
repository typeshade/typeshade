import { describe, expect, it } from 'vitest';
import { steppedResult } from '../testing/stepped-run.js';

const SOURCE = `"use typeshade";
export function matTimesVec(m: mat2x3, v: vec2): vec3 { return m * v; }
export function vecTimesMat(m: mat2x3, v: vec3): vec2 { return v * m; }
export function matTimesMat(x: mat3x2, y: mat2x3): mat2x2 { return x * y; }
export function column(m: mat2x3, j: u32): vec3 { return m[j]; }
export function transposed(m: mat2x3): mat3x2 { return transpose(m); }
`;

const M = [1, 2, 3, 4, 5, 6];

describe('a stepped run multiplies and indexes a non-square matrix as its static type shapes it', () => {
  it('takes a matrix times a vector as a linear combination of the columns', () => {
    expect(steppedResult(SOURCE, 'matTimesVec', [M, [10, 100]])).toEqual([410, 520, 630]);
  });

  it('takes a vector times a matrix as the dot with each column', () => {
    expect(steppedResult(SOURCE, 'vecTimesMat', [M, [1, 10, 100]])).toEqual([321, 654]);
  });

  it('takes a matrix times a matrix with the left operand shaped by its own columns', () => {
    expect(steppedResult(SOURCE, 'matTimesMat', [M, [1, 0, 0, 0, 1, 0]])).toEqual([1, 2, 3, 4]);
  });

  it('reads a column of a matrix whole', () => {
    expect(steppedResult(SOURCE, 'column', [M, 1])).toEqual([4, 5, 6]);
  });

  it('transposes by the static shape of the matrix', () => {
    expect(steppedResult(SOURCE, 'transposed', [M])).toEqual([1, 4, 2, 5, 3, 6]);
  });
});
