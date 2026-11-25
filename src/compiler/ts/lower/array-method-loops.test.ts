import { describe, expect, it } from 'vitest';
import { bothRefuse, bothTake } from '../../../core/testing/both-halves.js';
import { keepHelpers } from '../../../core/testing/keep-helpers.js';

const STORAGE = `declare const cells: storage<array<Cell>, "read_write">;
declare const out: storage<array<f32>, "read_write">;`;

const inMain = (body: string, pre = ''): string => `"use typeshade"
${pre}
${STORAGE}
@compute([1]) export function main(gid: builtin<"global_invocation_id">) {
${body}
}
`;

const fn = (body: string): string => `"use typeshade"
export function t(k: f32): f32 {
${body}
}
`;

describe('the loop a method makes reads the array as TypeScript reads it (Rule 8.18)', () => {
  it(
    'each index on the way to a binding is read once, in the order the source reads them',
    keepHelpers(() => {
      const r = bothTake(
        inMain(
          '  let c = 0;\n  const next = (): i32 => { c += 1; return c; };\n  let s = 0.;\n' +
            '  cells[next()].rows[next()].forEach((x) => { s += x; });\n  out[0] = s;',
          'class Cell { rows: array<array<f32, 2>, 3>; }',
        ),
      ).result;
      expect(r.wgsl).toContain('cells[at].rows[at_1][0]');
      expect(r.wgsl).toContain('array_forEach_main_f(&s, _seq0, _seq1);');
    }),
  );

  it(
    'a local that copies a binding is the binding, so fill writes through to it',
    keepHelpers(() => {
      const r = bothTake(
        inMain('  const a = out;\n  a.fill(1.);', 'class Cell { w: f32; }'),
      ).result;
      expect(r.wgsl).toContain('arrayLength(&out)');
    }),
  );
});

describe('what the function handed over returns, and what it may leave off (Rule 8.18)', () => {
  it('findIndex gives the first match and findLastIndex the last', () => {
    const run = (method: string): number =>
      bothTake(
        `"use typeshade"\nexport function t(k: f32): i32 {\n  const xs = array<f32, 4>(1., 5., 3., 5.);\n` +
          `  return xs.${method}((x) => x > k);\n}\n`,
      ).result.eval('t', [2]) as number;
    expect(run('findIndex')).toBe(1);
    expect(run('findLastIndex')).toBe(3);
  });

  it('a function whose body did not lower says nothing it returns, only why it did not', () => {
    bothRefuse(
      fn(
        '  const xs = array<f32, 2>(1., 2.);\n  const m = xs.map((x) => nope + x);\n  return m[0];',
      ),
      'TS8022',
      'Unknown identifier "nope".',
    );
  });
});

describe('a search for a value, on every target (change 0079, change 0045)', () => {
  it(
    'includes tells a NaN by its bits, where indexOf has no such test',
    keepHelpers(() => {
      const source = (method: string, result: string): string =>
        `"use typeshade"\nexport function t(v: f32): ${result} {\n` +
        `  const xs = array<f32, 3>(1., 2., 3.);\n  return xs.${method}(v);\n}\n`;
      const includes = bothTake(source('includes', 'bool')).result.wgsl;
      expect(includes).toContain('(bitcast<u32>(v) & 2147483647u) > 2139095040u');
      const indexOf = bothTake(source('indexOf', 'i32')).result.wgsl;
      expect(indexOf).not.toContain('bitcast<u32>');
    }),
  );
});
