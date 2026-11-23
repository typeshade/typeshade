// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).

import { describe, it } from 'vitest';
import { bothRefuse } from '../../core/testing/both-halves.js';

const H = `"use typeshade";\n`;
const REMEDY = 'Push onto it inside a for loop at the top level of "f".';
const NOT_TOP = (loop: string): string =>
  `"out.push(1.)" pushes onto "out" inside "${loop}", which is no for loop at the top level of ` +
  `"f", and that is not supported yet. ${REMEDY}`;
const UNKNOWN = (loop: string): string =>
  `"${loop}" pushes onto "out", and its start or bound reads a value the call does not know ` +
  `before it runs. It reads the value parameters, their components and fields, module ` +
  `constants, the length of an array parameter, number literals, u32, i32 and f32 of these, ` +
  `and top-level consts of these, with +, -, *, /, %, min and max; any other operand is not ` +
  `supported yet.`;
const ELEMENT = (text: string, verb: string): string =>
  `"${text}" ${verb} an element of "out", the array "f" grows with push, and that is not ` +
  `supported yet. Push onto it in a loop, read its length, and return it.`;
const MADE_OF = (t: string): string =>
  `This function makes and returns array<${t}>, an array of ${t} whose length the call gives. ` +
  `An array of ${t} made this way is not supported yet; an array of f32, i32 or u32, of a vector of them, or of a struct of these is.`;
const grows = (body: string, params = 'n: u32'): string =>
  `export function f(${params}): f32[] { const out: f32[] = []; ${body} return out; }`;

describe('what change 0114, S5d, refuses as not supported yet (TS8099)', () => {
  const cases: readonly (readonly [string, string, string | readonly string[]])[] = [
    [
      'a push outside every loop',
      grows('out.push(1.);'),
      `"out.push(1.)" pushes onto "out", the array "f" grows and returns, outside every loop, ` +
        `and that is not supported yet. ${REMEDY}`,
    ],
    [
      'a push in a while loop',
      grows('let i: u32 = 0; while (i < n) { out.push(1.); i++; }'),
      NOT_TOP('while (i < n)'),
    ],
    [
      'a push in a loop inside a loop',
      grows(
        'for (let i: u32 = 0; i < n; i++) { for (let j: u32 = 0; j < n; j++) { out.push(1.); } }',
      ),
      NOT_TOP('for (let j: u32 = 0; j < n; j++)'),
    ],
    [
      'a push in a loop under a branch',
      grows('if (c > 0) { for (let i: u32 = 0; i < n; i++) { out.push(1.); } }', 'n: u32, c: u32'),
      NOT_TOP('for (let i: u32 = 0; i < n; i++)'),
    ],
    [
      'a push in a loop whose range the device holds',
      grows('for (let i: u32 = 0; i < xs[0]; i++) { out.push(1.); }', 'xs: u32[]'),
      UNKNOWN('for (let i: u32 = 0; i < xs[0]; i++)'),
    ],
    [
      'a push in a loop whose bound reads an unlisted operand',
      grows('let m = n; m += 1; for (let i: u32 = 0; i < m; i++) { out.push(1.); }'),
      UNKNOWN('for (let i: u32 = 0; i < m; i++)'),
    ],
    [
      'a push in a loop that is not counted',
      grows('for (let i: u32 = 1; i < n; i *= 2) { out.push(1.); }'),
      '"for (let i: u32 = 1; i < n; i *= 2)" pushes onto "out", and its trip count is no count ' +
        'from a start to a bound by a constant whole step, so the call cannot reserve room for ' +
        '"out" before it runs; that is not supported yet.',
    ],
    [
      'an array of matrices',
      `export function f(n: u32): mat2x2f[] { const out: mat2x2f[] = []; for (let i: u32 = 0; i < n; i++) { out.push(mat2x2f()); } return out; }`,
      MADE_OF('mat2x2'),
    ],
    [
      'an array of structs that hold a bool',
      `class P { a: f32; b: bool; }\nexport function f(n: u32): P[] { const out: P[] = []; for (let i: u32 = 0; i < n; i++) { out.push(new P()); } return out; }`,
      MADE_OF('P'),
    ],
    [
      'an element read',
      grows('for (let i: u32 = 0; i < n; i++) { out.push(1.); } const x = out[0];'),
      ELEMENT('out[0]', 'reads'),
    ],
    [
      'an element write',
      grows('for (let i: u32 = 0; i < n; i++) { out.push(1.); out[i] = 2.; }'),
      ELEMENT('out[i]', 'writes'),
    ],
    [
      'a second name for it',
      grows('const o = out; for (let i: u32 = 0; i < n; i++) { out.push(1.); }'),
      [
        '"o = out" uses "out", the array "f" grows and returns, as a value, and that is not ' +
          'supported yet. Push onto it in a loop, read its length, and return it.',
        '"o" would copy "out", which is array<f32>, an array with no size. A local that holds an array with no size is not supported yet. Read "out" by its name instead.',
      ],
    ],
    [
      'a helper',
      `function g(n: u32): f32[] { const out: f32[] = []; for (let i: u32 = 0; i < n; i++) { out.push(1.); } return out; }\nexport function f(n: u32, xs: f32[]) { for (let i: u32 = 0; i < n; i++) { xs[i] = 1.; } }`,
      'This function makes and returns array<f32>, an array whose length the call gives. Only an exported kernel function makes such an array; in a helper or an entry it is not supported yet.',
    ],
    [
      'a path that returns a parameter',
      grows('if (n > 3) { return xs; }', 'n: u32, xs: f32[]'),
      '"return xs;" returns another value than "out", the array "f" makes. A function that makes the array it returns returns it on every path; any other return is not supported yet.',
    ],
  ];
  for (const [what, source, sentences] of cases)
    it(`refuses ${what} in both halves`, () => {
      bothRefuse(H + source, 'TS8099', sentences);
    });
});
