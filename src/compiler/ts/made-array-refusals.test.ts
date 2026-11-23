// Verifies: Rule 8.22 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).

import { describe, it } from 'vitest';
import { bothRefuse } from '../../core/testing/both-halves.js';

const H = `"use typeshade";\n`;
const NO_CONSTANT = (form: string, length: string): string =>
  `"${form}" takes its length from "${length}", which is no constant, and an array whose length ` +
  `is known only when the shader runs is not supported yet here. Write a constant length: an ` +
  `integer literal or a module constant.`;
const USES = (text: string): string =>
  `"${text}" uses "out", the array "f" makes and returns, as a value, and that is not ` +
  `supported yet. Read and write its elements, read its length, and return it.`;

describe('what slice 1 of change 0114, S5, refuses as not supported yet (TS8099)', () => {
  const cases: readonly (readonly [string, string, string | readonly string[]])[] = [
    [
      'an array of matrices',
      `export function f(n: u32): mat2x2f[] { const out = new Array(n).fill(mat2x2f()); return out; }`,
      'This function makes and returns array<mat2x2>, an array of mat2x2 whose length the call gives. An array of mat2x2 made this way is not supported yet; an array of f32, i32 or u32, of a vector of them, or of a struct of these is.',
    ],
    [
      'an array of structs that hold a bool',
      `class P { a: f32; b: bool; }\nexport function f(n: u32): P[] { const out = new Array(n).fill(new P()); return out; }`,
      'This function makes and returns array<P>, an array of P whose length the call gives. An array of P made this way is not supported yet; an array of f32, i32 or u32, of a vector of them, or of a struct of these is.',
    ],
    [
      'a field write into an element that fill made one object',
      `interface Q { a: f32; c: u32; }\nexport function f(n: u32, s: f32): Q[] { const out = new Array(n).fill({ a: s, c: 3 }); for (let i: u32 = 0; i < n; i++) { out[i].a = 5.; } return out; }`,
      '"new Array(n).fill({ a: s, c: 3 })" puts one object in every element, and the elements are then one object. One object under two names is not supported yet (change 0142, stage 3). Build each element in a loop.',
    ],
    [
      'a fill value that reads an element',
      `export function f(n: u32, xs: vec4f[]): vec4f[] { const out = new Array(n).fill(xs[0]); return out; }`,
      'The value "new Array(n).fill(xs[0])" fills its array with reads a value the call does not know before it runs. It reads the value parameters, their components and fields, module constants, the length of an array parameter, number literals, u32, i32 and f32 of these, vectors and structs built of these, and top-level consts of these, with +, -, *, /, %, min and max; any other operand is not supported yet.',
    ],
    [
      'a fill value that calls a constructor',
      `class P { a: f32; constructor(a: f32) { this.a = a; } }\nexport function f(n: u32, s: f32): P[] { const out = new Array(n).fill(new P(s)); return out; }`,
      'The value "new Array(n).fill(new P(s))" fills its array with reads a value the call does not know before it runs. It reads the value parameters, their components and fields, module constants, the length of an array parameter, number literals, u32, i32 and f32 of these, vectors and structs built of these, and top-level consts of these, with +, -, *, /, %, min and max; any other operand is not supported yet.',
    ],
    [
      'a helper',
      `function g(n: u32): f32[] { const out = new Float32Array(n); return out; }\nexport function f(n: u32, xs: f32[]) { for (let i: u32 = 0; i < n; i++) { xs[i] = 1.; } }`,
      'This function makes and returns array<f32>, an array whose length the call gives. Only an exported kernel function makes such an array; in a helper or an entry it is not supported yet.',
    ],
    [
      'an array made under a branch',
      `export function f(n: u32, c: u32): f32[] { if (c > 0) { const out = new Float32Array(n); return out; } const o2 = new Float32Array(n); return o2; }`,
      [
        '"out" is made inside a loop or under a branch of "f", and that is not supported yet: make the array it returns in a const at the top of its body.',
        NO_CONSTANT('new Float32Array(n)', 'n'),
      ],
    ],
    [
      'an array made after a loop',
      `export function f(n: u32, xs: f32[]): f32[] { for (let i: u32 = 0; i < n; i++) { xs[i] = 1.; } const out = new Float32Array(n); return out; }`,
      '"out" is made after a loop or a store of "f", and that is not supported yet: make the array it returns before its first loop and its first store.',
    ],
    [
      'a length that reads an element',
      `export function f(n: u32, xs: f32[]): f32[] { const out = new Float32Array(u32(xs[0])); return out; }`,
      '"new Float32Array(u32(xs[0]))" takes its length from "u32(xs[0])", which reads a value the call does not know before it runs. It reads the value parameters, their components and fields, module constants, the length of an array parameter, number literals, u32, i32 and f32 of these, and top-level consts of these, with +, -, *, /, %, min and max; any other operand is not supported yet.',
    ],
    [
      'Array.from with a length the call gives',
      `export function f(n: u32): f32[] { const out = Array.from({ length: n }, (_, i) => f32(i)); return out; }`,
      '"Array.from({ length: n }, (_, i) => f32(i))" makes the array "f" returns with a length the call gives, and Array.from is not supported yet there. Write new Array(n).fill(v) or new Float32Array(n), and a loop that stores each element.',
    ],
    [
      'a second new array',
      `export function f(n: u32): f32[] { const a = new Float32Array(n); const out = new Float32Array(n); return out; }`,
      NO_CONSTANT('new Float32Array(n)', 'n'),
    ],
    [
      'a path that returns a parameter',
      `export function f(n: u32, xs: f32[]): f32[] { const out = new Float32Array(n); if (n > 3) { return xs; } return out; }`,
      '"return xs;" returns another value than "out", the array "f" makes. A function that makes the array it returns returns it on every path; any other return is not supported yet.',
    ],
    [
      'a push onto it',
      `export function f(n: u32): f32[] { const out = new Float32Array(n); for (let i: u32 = 0; i < n; i++) { out.push(1.); } return out; }`,
      USES('out.push(1.)'),
    ],
    [
      'a second name for it',
      `export function f(n: u32): f32[] { const out = new Float32Array(n); const o = out; return out; }`,
      [
        USES('o = out'),
        '"o" would copy "out", which is array<f32>, an array with no size. A local that holds an array with no size is not supported yet. Read "out" by its name instead.',
      ],
    ],
    [
      'a 2D storage texture beside it',
      `export function f(n: u32, t: texture_storage_2d<"rgba8unorm", "write">): f32[] { const out = new Float32Array(n); return out; }`,
      '"f" takes a 2D storage texture and makes the array it returns, "out"; a kernel function that does both is not supported yet.',
    ],
  ];
  for (const [what, source, sentences] of cases)
    it(`refuses ${what} in both halves`, () => {
      bothRefuse(H + source, 'TS8099', sentences);
    });
});

describe('a result of an array with no size that is no new array stays TS8020', () => {
  it('refuses the return of a parameter as before', () => {
    bothRefuse(
      `${H}export function f(n: u32, xs: f32[]): f32[] { return xs; }`,
      'TS8020',
      'This function returns array<f32>, an array with no size. A result that holds an array with no size is not supported yet. Read the binding by its name where the value is needed.',
    );
  });
});
