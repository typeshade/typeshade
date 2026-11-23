// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { bothHalves, bothRefuse } from '../../core/testing/both-halves.js';

describe('what stays refused as not supported yet (change 0114, A12 form 2)', () => {
  const H = `"use typeshade";\n`;
  const grows = (body: string, params = 'n: u32'): string =>
    `${H}export function f(${params}): f32[] { const out: f32[] = []; ${body} return out; }`;

  it('refuses a nest whose inner start reads the outer counter and whose read the proof cannot show in range', () => {
    const halves = bothRefuse(
      grows(
        'for (let i: u32 = 0; i < n; i++) { for (let j: u32 = i + 1; j < n; j++) { out.push(xs[j]); } }',
        'n: u32, xs: f32[]',
      ),
      'TS8099',
      '"for (let j: u32 = i + 1; j < n; j++)" pushes onto "out", and its start or bound reads a ' +
        'value the call does not know before it runs. It reads the value parameters, their ' +
        'components and fields, module constants, the length of an array parameter, number ' +
        'literals, u32, i32 and f32 of these, and top-level consts of these, with +, -, *, /, %, ' +
        'min and max; any other operand is not supported yet.',
    );
    expect(halves.compiler).toHaveLength(1);
  });

  it('refuses a branch whose condition reads a value the call does not know', () => {
    bothRefuse(
      grows(
        'if (xs[0] > 0) { for (let i: u32 = 0; i < n; i++) { out.push(1.); } }',
        'n: u32, xs: f32[]',
      ),
      'TS8099',
      '"if (xs[0] > 0)" decides whether a loop pushes onto "out", and its condition reads a ' +
        'value the call does not know before it runs. It reads the value parameters, their ' +
        'components and fields, module constants, the length of an array parameter, number ' +
        'literals, u32, i32 and f32 of these, and top-level consts of these, with +, -, *, /, %, ' +
        'min and max; any other operand is not supported yet.',
    );
  });

  it('refuses a loop under a branch inside a loop', () => {
    bothRefuse(
      grows(
        'for (let i: u32 = 0; i < n; i++) { if (i > 2) { for (let j: u32 = 0; j < n; j++) { out.push(1.); } } }',
      ),
      'TS8099',
      '"out.push(1.)" pushes onto "out" inside "for (let j: u32 = 0; j < n; j++)", which stands ' +
        'under a branch inside "for (let i: u32 = 0; i < n; i++)", and a loop under a branch ' +
        'inside a loop is not supported yet. Move the loop out of the branch.',
    );
  });

  it('refuses a while loop inside a counted loop', () => {
    bothRefuse(
      grows(
        'for (let i: u32 = 0; i < n; i++) { let j: u32 = 0; while (j < i) { out.push(1.); j++; } }',
      ),
      'TS8099',
      '"out.push(1.)" pushes onto "out" inside "while (j < i)", which is no for loop at the top ' +
        'level of "f", and that is not supported yet. Push onto it inside a for loop at the top ' +
        'level of "f".',
    );
  });

  it('refuses a for loop inside a while loop', () => {
    bothRefuse(
      grows(
        'let i: u32 = 0; while (i < n) { for (let j: u32 = 0; j < n; j++) { out.push(1.); } i++; }',
      ),
      'TS8099',
      '"out.push(1.)" pushes onto "out" inside "while (i < n)", which is no for loop at the top ' +
        'level of "f", and that is not supported yet. Push onto it inside a for loop at the top ' +
        'level of "f".',
    );
  });

  it('refuses a nested loop that is not counted, and a nest under a switch', () => {
    bothRefuse(
      grows(
        'for (let i: u32 = 0; i < n; i++) { for (let j: u32 = 1; j < n; j *= 2) { out.push(1.); } }',
      ),
      'TS8099',
      '"for (let j: u32 = 1; j < n; j *= 2)" pushes onto "out", and its trip count is no count ' +
        'from a start to a bound by a constant whole step, so the call cannot reserve room for ' +
        '"out" before it runs; that is not supported yet.',
    );
    bothRefuse(
      grows(
        'switch (n) { case 1: for (let i: u32 = 0; i < n; i++) { out.push(1.); } break; default: break; }',
      ),
      'TS8099',
      '"out.push(1.)" pushes onto "out" inside "for (let i: u32 = 0; i < n; i++)", which is no ' +
        'for loop at the top level of "f", and that is not supported yet. Push onto it inside a ' +
        'for loop at the top level of "f".',
    );
  });

  it('gives the TS8070 warning, not an error, for a program that runs on the CPU tier', () => {
    const halves = bothHalves(
      grows('if (c > 0) { for (let i: u32 = 0; i < n; i++) { out.push(1.); } }', 'n: u32, c: u32'),
    );
    expect(halves.compiler).toEqual([]);
    expect(halves.editor).toHaveLength(1);
    expect(halves.editor[0]).toContain('TS8070');
  });
});
